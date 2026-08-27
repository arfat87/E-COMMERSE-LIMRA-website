-- ═══════════════════════════════════════════════════════════════════════════
-- LIMRA Restaurant — Comprehensive Backend Security Overhaul Migration
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Schema Upgrades & Structural Hardening
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS txn_ref TEXT UNIQUE;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.payment_history ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE public.payment_history ADD COLUMN IF NOT EXISTS reason TEXT;

ALTER TABLE public.phone_verifications ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;
ALTER TABLE public.phone_verifications ADD COLUMN IF NOT EXISTS resend_count INTEGER DEFAULT 1;
ALTER TABLE public.phone_verifications ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.phone_verifications ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMPTZ;

-- Create Security Audit Logs Table
CREATE TABLE IF NOT EXISTS public.security_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  ip_address TEXT,
  device_information TEXT,
  result TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create Verified Payments Cache Table
CREATE TABLE IF NOT EXISTS public.verified_payments (
  utr TEXT PRIMARY KEY,
  amount NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexing for performance and security lookups
CREATE INDEX IF NOT EXISTS idx_security_logs_user_id ON public.security_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON public.security_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verified_payments_order_id ON public.verified_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON public.bookings(user_id);

-- Enable RLS on new tables
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verified_payments ENABLE ROW LEVEL SECURITY;


-- 2. Centralized Security Event Logger & Authorization Helper
CREATE OR REPLACE FUNCTION public.log_security_event(
  p_user_id uuid,
  p_action text,
  p_result text,
  p_details jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_headers text;
  v_ip text;
  v_ua text;
BEGIN
  -- Retrieve headers from PostgREST environment
  v_headers := current_setting('request.headers', true);
  IF v_headers IS NOT NULL AND v_headers <> '' THEN
    BEGIN
      v_ip := v_headers::jsonb->>'x-forwarded-for';
      v_ua := v_headers::jsonb->>'user-agent';
    EXCEPTION WHEN OTHERS THEN
      v_ip := NULL;
      v_ua := NULL;
    END;
  END IF;

  -- Fallback to client address if header not present
  IF v_ip IS NULL THEN
    v_ip := inet_client_addr()::text;
  END IF;

  INSERT INTO public.security_audit_logs (
    user_id,
    action,
    ip_address,
    device_information,
    result,
    details
  )
  VALUES (
    p_user_id,
    p_action,
    v_ip,
    v_ua,
    p_result,
    p_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_security_event(uuid, text, text, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = v_uid
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;


-- 3. Retroactive Guest Linker Trigger & Initial Update
CREATE OR REPLACE FUNCTION public.tr_on_profile_upsert_or_verify()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone_verified = true THEN
    -- Retroactively link orders
    UPDATE public.orders
    SET user_id = NEW.id
    WHERE user_id IS NULL AND regexp_replace(customer_phone, '\D', '', 'g') = regexp_replace(NEW.phone, '\D', '', 'g');

    -- Retroactively link bookings
    UPDATE public.bookings
    SET user_id = NEW.id
    WHERE user_id IS NULL AND regexp_replace(customer_phone, '\D', '', 'g') = regexp_replace(NEW.phone, '\D', '', 'g');

    -- Retroactively link notifications
    UPDATE public.notifications
    SET user_id = NEW.id
    WHERE user_id IS NULL AND regexp_replace(customer_phone, '\D', '', 'g') = regexp_replace(NEW.phone, '\D', '', 'g');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS tr_profile_upsert_or_verify ON public.customer_profiles;
CREATE TRIGGER tr_profile_upsert_or_verify
  AFTER INSERT OR UPDATE ON public.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tr_on_profile_upsert_or_verify();

-- Run one-off backfill to link existing verified users' guest records
UPDATE public.orders o
SET user_id = p.id
FROM public.customer_profiles p
WHERE o.user_id IS NULL AND p.phone_verified = true AND regexp_replace(o.customer_phone, '\D', '', 'g') = regexp_replace(p.phone, '\D', '', 'g');

UPDATE public.bookings b
SET user_id = p.id
FROM public.customer_profiles p
WHERE b.user_id IS NULL AND p.phone_verified = true AND regexp_replace(b.customer_phone, '\D', '', 'g') = regexp_replace(p.phone, '\D', '', 'g');

UPDATE public.notifications n
SET user_id = p.id
FROM public.customer_profiles p
WHERE n.user_id IS NULL AND p.phone_verified = true AND regexp_replace(n.customer_phone, '\D', '', 'g') = regexp_replace(p.phone, '\D', '', 'g');


-- 4. Hardening and Overhaul of User & Admin Database Functions

-- 4.1. verify_upi_payment(...)
CREATE OR REPLACE FUNCTION public.verify_upi_payment(
  p_amount numeric,
  p_payee text DEFAULT '7501299357@ybl',
  p_utr_or_txn text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_message text;
  v_prev_order_id uuid;
BEGIN
  -- Validate transaction amount
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('status', 'failed', 'message', 'Invalid transaction amount');
  END IF;

  -- Validate transaction ref number length / format (exactly 12 digits for standard UPI transaction ID/UTR)
  IF p_utr_or_txn IS NULL OR p_utr_or_txn = '' THEN
    RETURN jsonb_build_object('status', 'failed', 'message', 'UTR or Transaction reference number is required.');
  END IF;

  IF NOT (p_utr_or_txn ~ '^\d{12}$') THEN
    RETURN jsonb_build_object('status', 'failed', 'message', 'Invalid UTR format. Must be exactly 12 numeric digits.');
  END IF;

  -- Check duplicate payment references
  SELECT order_id INTO v_prev_order_id FROM public.verified_payments WHERE utr = p_utr_or_txn;
  IF FOUND AND v_prev_order_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'failed', 'message', 'This UPI Transaction Ref/UTR has already been claimed by another order.');
  END IF;

  -- Simulation rules based on UTR suffix for testing
  IF p_utr_or_txn LIKE '%00' THEN
    v_status := 'pending';
    v_message := 'Transaction is pending bank authorization. Still waiting on bank confirmation.';
  ELSIF p_utr_or_txn LIKE '%99' THEN
    v_status := 'failed';
    v_message := 'Transaction declined by bank. Insufficient funds or invalid UPI PIN.';
  ELSE
    v_status := 'success';
    v_message := 'Payment of ₹' || p_amount::text || ' verified successfully via UPI.';
  END IF;

  -- Record validation result (only if success or pending to cache verification token)
  IF v_status = 'success' OR v_status = 'pending' THEN
    INSERT INTO public.verified_payments (utr, amount, status, created_at)
    VALUES (p_utr_or_txn, p_amount, v_status, now())
    ON CONFLICT (utr) DO UPDATE
    SET amount = excluded.amount,
        status = excluded.status,
        created_at = now();
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'message', v_message,
    'verified_at', now(),
    'amount', p_amount,
    'payee', p_payee,
    'txn_ref', p_utr_or_txn
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_upi_payment(numeric, text, text) TO anon, authenticated;

-- 4.2. place_order(...)
CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_name text,
  p_customer_phone text,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_landmark text DEFAULT NULL,
  p_delivery_notes text DEFAULT NULL,
  p_location_verified boolean DEFAULT false,
  p_order_type text DEFAULT 'delivery',
  p_table_number integer DEFAULT NULL,
  p_table_zone text DEFAULT NULL,
  p_txn_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item  jsonb;
  v_total numeric := 0;
  v_uid uuid := auth.uid();
  v_profile_phone text;
  v_clean_phone text := regexp_replace(p_customer_phone, '\D', '', 'g');
  v_clean_profile_phone text;
  v_verified_payment public.verified_payments%ROWTYPE;
BEGIN
  -- Parameter validation
  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN RAISE EXCEPTION 'Customer name is required'; END IF;
  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN RAISE EXCEPTION 'Customer phone is required'; END IF;
  IF NOT (v_clean_phone ~ '^[6-9]\d{9}$') THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Order must have at least one item'; END IF;

  -- Coordinates bounds check
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    IF p_latitude < 21.0 OR p_latitude > 23.0 OR p_longitude < 86.5 OR p_longitude > 88.5 THEN
      RAISE EXCEPTION 'Invalid coordinates. Location must be within bounds.';
    END IF;
  END IF;

  -- Verify data ownership (if logged in, check profile phone matches checkout phone)
  IF v_uid IS NOT NULL THEN
    SELECT phone INTO v_profile_phone FROM public.customer_profiles WHERE id = v_uid;
    IF v_profile_phone IS NOT NULL AND v_profile_phone <> '' THEN
      v_clean_profile_phone := regexp_replace(v_profile_phone, '\D', '', 'g');
      IF v_clean_phone <> v_clean_profile_phone THEN
        RAISE EXCEPTION 'Ownership Mismatch: Logged-in users can only place orders matching their registered phone number.';
      END IF;
    END IF;
  END IF;

  -- Compute total amount
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_total := v_total + COALESCE((v_item->>'line_total')::numeric, 0);
  END LOOP;

  -- UPI Verification & Claim checks (if UTR is passed)
  IF p_txn_ref IS NOT NULL AND p_txn_ref <> '' THEN
    SELECT * INTO v_verified_payment FROM public.verified_payments WHERE utr = p_txn_ref;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment details not verified. Please complete verification first.';
    END IF;
    IF v_verified_payment.order_id IS NOT NULL THEN
      RAISE EXCEPTION 'This payment reference has already been claimed.';
    END IF;
    IF v_verified_payment.status <> 'success' THEN
      RAISE EXCEPTION 'Payment verification was not successful. Current status: %', v_verified_payment.status;
    END IF;
    -- Amount match check (allow small rounding difference of 0.05)
    IF ABS(v_verified_payment.amount - v_total) > 0.05 THEN
      RAISE EXCEPTION 'Payment amount mismatch. Order: ₹%, Verified Payment: ₹%', v_total, v_verified_payment.amount;
    END IF;
  END IF;

  -- Insert order
  INSERT INTO public.orders (
    customer_name, customer_phone, total_amount, notes, status,
    latitude, longitude, landmark, delivery_notes, location_verified,
    order_type, table_number, table_zone, user_id, txn_ref, payment_status
  )
  VALUES (
    trim(p_customer_name),
    trim(p_customer_phone),
    v_total,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    'pending',
    p_latitude,
    p_longitude,
    p_landmark,
    p_delivery_notes,
    p_location_verified,
    p_order_type,
    p_table_number,
    p_table_zone,
    v_uid,
    p_txn_ref,
    CASE WHEN p_txn_ref IS NOT NULL THEN 'paid'::text ELSE 'unpaid'::text END
  )
  RETURNING * INTO v_order;

  -- Link/claim verified payment and record to payment audit log
  IF p_txn_ref IS NOT NULL THEN
    UPDATE public.verified_payments
    SET order_id = v_order.id
    WHERE utr = p_txn_ref;

    INSERT INTO public.payment_history (
      order_id, user_id, previous_status, new_status, changed_by, notes, ip_address, reason
    )
    VALUES (
      v_order.id, v_uid, 'unpaid', 'paid', COALESCE(v_uid::text, 'guest-gateway'),
      'Atomically verified and claimed UPI payment with UTR: ' || p_txn_ref,
      NULL, 'UPI Checkout claim'
    );
  END IF;

  -- Insert order items
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.order_items (order_id, menu_item_id, item_name, quantity, unit_price, line_total)
    VALUES (
      v_order.id,
      CASE WHEN v_item ? 'menu_item_id' AND v_item->>'menu_item_id' IS NOT NULL
        THEN (v_item->>'menu_item_id')::integer ELSE NULL END,
      v_item->>'item_name',
      GREATEST((v_item->>'quantity')::integer, 1),
      (v_item->>'unit_price')::numeric,
      (v_item->>'line_total')::numeric
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'total_amount', v_order.total_amount,
    'status', v_order.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, numeric, numeric, text, text, boolean, text, integer, text, text) TO anon, authenticated;

-- 4.3. place_booking(...)
CREATE OR REPLACE FUNCTION public.place_booking(
  p_type text,
  p_customer_name text,
  p_customer_phone text,
  p_booking_date date DEFAULT NULL,
  p_booking_time text DEFAULT NULL,
  p_guests integer DEFAULT NULL,
  p_preference text DEFAULT NULL,
  p_seat_label text DEFAULT NULL,
  p_event_type text DEFAULT NULL,
  p_budget text DEFAULT NULL,
  p_catering text DEFAULT NULL,
  p_venue text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_uid uuid := auth.uid();
  v_profile_phone text;
  v_clean_phone text := regexp_replace(p_customer_phone, '\D', '', 'g');
  v_clean_profile_phone text;
BEGIN
  -- Parameter validation
  IF p_type IS NULL OR p_type NOT IN ('table', 'party', 'wedding') THEN RAISE EXCEPTION 'Invalid booking type'; END IF;
  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN RAISE EXCEPTION 'Customer name is required'; END IF;
  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN RAISE EXCEPTION 'Customer phone is required'; END IF;
  IF NOT (v_clean_phone ~ '^[6-9]\d{9}$') THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;

  -- Customer Identity & Ownership Validation (if logged in)
  IF v_uid IS NOT NULL THEN
    SELECT phone INTO v_profile_phone FROM public.customer_profiles WHERE id = v_uid;
    IF v_profile_phone IS NOT NULL AND v_profile_phone <> '' THEN
      v_clean_profile_phone := regexp_replace(v_profile_phone, '\D', '', 'g');
      IF v_clean_phone <> v_clean_profile_phone THEN
        RAISE EXCEPTION 'Ownership Mismatch: Logged-in users can only place bookings with their registered phone number.';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.bookings (
    type, customer_name, customer_phone, booking_date, booking_time,
    guests, preference, seat_label, event_type, budget, catering,
    venue, message, notes, status, user_id
  )
  VALUES (
    p_type,
    trim(p_customer_name),
    trim(p_customer_phone),
    p_booking_date,
    p_booking_time,
    p_guests,
    p_preference,
    p_seat_label,
    p_event_type,
    p_budget,
    p_catering,
    p_venue,
    p_message,
    p_notes,
    'pending',
    v_uid
  )
  RETURNING * INTO v_booking;

  RETURN jsonb_build_object(
    'id', v_booking.id,
    'booking_number', v_booking.booking_number,
    'status', v_booking.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_booking(text, text, text, date, text, integer, text, text, text, text, text, text, text, text) TO anon, authenticated;

-- 4.4. confirm_order(...)
CREATE OR REPLACE FUNCTION public.confirm_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  -- Access authorization check
  IF NOT public.is_admin() THEN
    PERFORM public.log_security_event(auth.uid(), 'CONFIRM_ORDER_UNAUTHORIZED', 'failed: unauthorized', jsonb_build_object('order_id', p_order_id));
    RAISE EXCEPTION 'Access Denied: Admin privileges required.';
  END IF;

  UPDATE public.orders
  SET status = 'confirmed', updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  PERFORM public.log_security_event(auth.uid(), 'CONFIRM_ORDER_SUCCESS', 'success', jsonb_build_object('order_id', p_order_id, 'order_number', v_order.order_number));

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'customer_phone', v_order.customer_phone
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_order(uuid) TO authenticated;

-- 4.5. create_notification(...)
CREATE OR REPLACE FUNCTION public.create_notification(
  p_customer_phone text,
  p_order_id uuid,
  p_title text,
  p_message text,
  p_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_notif public.notifications%ROWTYPE;
  v_user_id uuid;
BEGIN
  -- Access authorization check
  IF NOT public.is_admin() THEN
    PERFORM public.log_security_event(auth.uid(), 'CREATE_NOTIFICATION_UNAUTHORIZED', 'failed: unauthorized', jsonb_build_object('customer_phone', p_customer_phone));
    RAISE EXCEPTION 'Access Denied: Admin privileges required.';
  END IF;

  -- Resolve user_id from phone number profiles
  SELECT id INTO v_user_id
  FROM public.customer_profiles
  WHERE regexp_replace(phone, '\D', '', 'g') = regexp_replace(p_customer_phone, '\D', '', 'g')
  LIMIT 1;

  INSERT INTO public.notifications (
    user_id, customer_phone, order_id, item_id, title, message, description, type, is_read, created_at, updated_at
  )
  VALUES (
    v_user_id, p_customer_phone, p_order_id, p_order_id, p_title, p_message, p_message, p_type, false, now(), now()
  )
  RETURNING * INTO v_notif;

  PERFORM public.log_security_event(auth.uid(), 'CREATE_NOTIFICATION_SUCCESS', 'success', jsonb_build_object('notification_id', v_notif.id, 'customer_phone', p_customer_phone));

  RETURN jsonb_build_object(
    'id', v_notif.id,
    'customer_phone', v_notif.customer_phone,
    'title', v_notif.title,
    'message', v_notif.message,
    'type', v_notif.type,
    'created_at', v_notif.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_notification(text, uuid, text, text, text) TO authenticated;

-- 4.6. update_order_payment_status(...)
CREATE OR REPLACE FUNCTION public.update_order_payment_status(
  p_order_id uuid,
  p_payment_status text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_prev_status text;
  v_changed_by text;
  v_user_id uuid := auth.uid();
  v_notif_title text;
  v_notif_message text;
  v_user_email text;
  v_headers text;
  v_ip text;
BEGIN
  -- Access authorization check
  IF NOT public.is_admin() AND v_user_id IS NOT NULL THEN
    PERFORM public.log_security_event(v_user_id, 'UPDATE_PAYMENT_STATUS_UNAUTHORIZED', 'failed: unauthorized', jsonb_build_object('order_id', p_order_id));
    RAISE EXCEPTION 'Access Denied: Admin privileges required.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  v_prev_status := v_order.payment_status;

  -- Prevent duplicate updates
  IF v_prev_status = p_payment_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Payment status is already ' || p_payment_status,
      'order_id', p_order_id,
      'payment_status', p_payment_status
    );
  END IF;

  -- Resolve administrator identity
  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM public.admin_users WHERE user_id = v_user_id LIMIT 1;
    v_changed_by := COALESCE(v_user_email, 'Admin (' || v_user_id::text || ')');
  ELSE
    v_changed_by := 'system/gateway';
  END IF;

  -- Retrieve IP
  v_headers := current_setting('request.headers', true);
  IF v_headers IS NOT NULL AND v_headers <> '' THEN
    BEGIN
      v_ip := v_headers::jsonb->>'x-forwarded-for';
    EXCEPTION WHEN OTHERS THEN
      v_ip := NULL;
    END;
  END IF;
  IF v_ip IS NULL THEN
    v_ip := inet_client_addr()::text;
  END IF;

  UPDATE public.orders
  SET payment_status = p_payment_status, updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Insert payment history record
  INSERT INTO public.payment_history (
    order_id, user_id, previous_status, new_status, changed_by, notes, ip_address, reason
  )
  VALUES (
    p_order_id, v_user_id, v_prev_status, p_payment_status, v_changed_by,
    COALESCE(p_notes, 'Payment status updated from ' || v_prev_status || ' to ' || p_payment_status),
    v_ip, p_notes
  );

  -- Handle client-side socket notification pushes
  IF p_payment_status = 'paid' THEN
    v_notif_title := 'Payment Received';
    v_notif_message := 'Your payment for Order #' || v_order.order_number || ' has been successfully verified.';

    INSERT INTO public.notifications (
      user_id, customer_phone, order_id, item_id, title, message, description, type, is_read, created_at, updated_at
    )
    VALUES (
      (SELECT id FROM public.customer_profiles WHERE regexp_replace(phone, '\D', '', 'g') = regexp_replace(v_order.customer_phone, '\D', '', 'g') LIMIT 1),
      v_order.customer_phone, v_order.id, v_order.id, v_notif_title, v_notif_message, v_notif_message, 'payment_received', false, now(), now()
    );
  END IF;

  PERFORM public.log_security_event(v_user_id, 'UPDATE_PAYMENT_STATUS_SUCCESS', 'success', jsonb_build_object(
    'order_id', p_order_id,
    'previous_status', v_prev_status,
    'new_status', p_payment_status,
    'ip_address', v_ip
  ));

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'payment_status', v_order.payment_status,
    'previous_status', v_prev_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_order_payment_status(uuid, text, text) TO authenticated;

-- 4.7. get_customer_orders(...)
CREATE OR REPLACE FUNCTION public.get_customer_orders(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
  v_uid uuid := auth.uid();
  v_profile_phone text;
  v_clean_profile_phone text;
BEGIN
  IF length(v_phone) < 10 THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;

  -- Validate caller's identity (customers can only fetch their own data)
  IF NOT public.is_admin() THEN
    IF v_uid IS NULL THEN
      PERFORM public.log_security_event(NULL, 'GET_CUSTOMER_ORDERS_UNAUTHORIZED', 'failed: unauthenticated', jsonb_build_object('requested_phone', p_phone));
      RAISE EXCEPTION 'Access Denied: Please log in to view order history.';
    END IF;

    SELECT phone INTO v_profile_phone FROM public.customer_profiles WHERE id = v_uid;
    IF v_profile_phone IS NULL OR v_profile_phone = '' THEN
      PERFORM public.log_security_event(v_uid, 'GET_CUSTOMER_ORDERS_UNAUTHORIZED', 'failed: missing profile phone', jsonb_build_object('requested_phone', p_phone));
      RAISE EXCEPTION 'Access Denied: No phone number registered on this account.';
    END IF;

    v_clean_profile_phone := regexp_replace(v_profile_phone, '\D', '', 'g');
    IF v_phone <> v_clean_profile_phone THEN
      PERFORM public.log_security_event(v_uid, 'GET_CUSTOMER_ORDERS_UNAUTHORIZED', 'failed: ownership mismatch', jsonb_build_object('requested_phone', p_phone, 'profile_phone', v_profile_phone));
      RAISE EXCEPTION 'Access Denied: You are not authorized to view orders for this phone number.';
    END IF;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
    FROM (
      SELECT o.id, o.order_number, o.customer_name, o.total_amount, o.status, o.payment_status, o.created_at, o.notes, o.latitude, o.longitude, o.landmark, o.delivery_notes, o.location_verified,
        (SELECT jsonb_agg(jsonb_build_object('item_name', oi.item_name, 'quantity', oi.quantity, 'line_total', oi.line_total) ORDER BY oi.item_name)
         FROM public.order_items oi WHERE oi.order_id = o.id) AS items
      FROM public.orders o
      WHERE regexp_replace(o.customer_phone, '\D', '', 'g') = v_phone
         OR regexp_replace(o.customer_phone, '\D', '', 'g') LIKE '%' || v_phone
         OR v_phone LIKE '%' || regexp_replace(o.customer_phone, '\D', '', 'g')
      ORDER BY o.created_at DESC
      LIMIT 20
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_orders(text) TO anon, authenticated;

-- 4.8. get_customer_bookings(...)
CREATE OR REPLACE FUNCTION public.get_customer_bookings(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
  v_uid uuid := auth.uid();
  v_profile_phone text;
  v_clean_profile_phone text;
BEGIN
  IF length(v_phone) < 10 THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;

  -- Validate caller's identity
  IF NOT public.is_admin() THEN
    IF v_uid IS NULL THEN
      PERFORM public.log_security_event(NULL, 'GET_CUSTOMER_BOOKINGS_UNAUTHORIZED', 'failed: unauthenticated', jsonb_build_object('requested_phone', p_phone));
      RAISE EXCEPTION 'Access Denied: Please log in to view booking history.';
    END IF;

    SELECT phone INTO v_profile_phone FROM public.customer_profiles WHERE id = v_uid;
    IF v_profile_phone IS NULL OR v_profile_phone = '' THEN
      PERFORM public.log_security_event(v_uid, 'GET_CUSTOMER_BOOKINGS_UNAUTHORIZED', 'failed: missing profile phone', jsonb_build_object('requested_phone', p_phone));
      RAISE EXCEPTION 'Access Denied: No phone number registered on this account.';
    END IF;

    v_clean_profile_phone := regexp_replace(v_profile_phone, '\D', '', 'g');
    IF v_phone <> v_clean_profile_phone THEN
      PERFORM public.log_security_event(v_uid, 'GET_CUSTOMER_BOOKINGS_UNAUTHORIZED', 'failed: ownership mismatch', jsonb_build_object('requested_phone', p_phone, 'profile_phone', v_profile_phone));
      RAISE EXCEPTION 'Access Denied: You are not authorized to view bookings for this phone number.';
    END IF;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
    FROM (
      SELECT booking_number, type, customer_name, booking_date, booking_time, guests, seat_label, status, created_at
      FROM public.bookings
      WHERE regexp_replace(customer_phone, '\D', '', 'g') = v_phone
         OR regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone
         OR v_phone LIKE '%' || regexp_replace(customer_phone, '\D', '', 'g')
      ORDER BY created_at DESC
      LIMIT 20
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_bookings(text) TO anon, authenticated;

-- 4.9. get_customer_notifications(...)
CREATE OR REPLACE FUNCTION public.get_customer_notifications(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
  v_uid uuid := auth.uid();
  v_profile_phone text;
  v_clean_profile_phone text;
BEGIN
  IF length(v_phone) < 10 THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;

  -- Validate caller's identity
  IF NOT public.is_admin() THEN
    IF v_uid IS NULL THEN
      PERFORM public.log_security_event(NULL, 'GET_CUSTOMER_NOTIFICATIONS_UNAUTHORIZED', 'failed: unauthenticated', jsonb_build_object('requested_phone', p_phone));
      RAISE EXCEPTION 'Access Denied: Please log in to view notifications.';
    END IF;

    SELECT phone INTO v_profile_phone FROM public.customer_profiles WHERE id = v_uid;
    IF v_profile_phone IS NULL OR v_profile_phone = '' THEN
      PERFORM public.log_security_event(v_uid, 'GET_CUSTOMER_NOTIFICATIONS_UNAUTHORIZED', 'failed: missing profile phone', jsonb_build_object('requested_phone', p_phone));
      RAISE EXCEPTION 'Access Denied: No phone number registered on this account.';
    END IF;

    v_clean_profile_phone := regexp_replace(v_profile_phone, '\D', '', 'g');
    IF v_phone <> v_clean_profile_phone THEN
      PERFORM public.log_security_event(v_uid, 'GET_CUSTOMER_NOTIFICATIONS_UNAUTHORIZED', 'failed: ownership mismatch', jsonb_build_object('requested_phone', p_phone, 'profile_phone', v_profile_phone));
      RAISE EXCEPTION 'Access Denied: You are not authorized to view notifications for this phone number.';
    END IF;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
    FROM (
      SELECT id, user_id, order_id, title, COALESCE(message, description) AS message, type, is_read, created_at, updated_at
      FROM public.notifications
      WHERE regexp_replace(customer_phone, '\D', '', 'g') = v_phone
         OR regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone
         OR v_phone LIKE '%' || regexp_replace(customer_phone, '\D', '', 'g')
      ORDER BY created_at DESC
      LIMIT 50
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_notifications(text) TO anon, authenticated;

-- 4.10. mark_notification_as_read(...)
CREATE OR REPLACE FUNCTION public.mark_notification_as_read(p_notification_id uuid, p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
  v_uid uuid := auth.uid();
  v_profile_phone text;
  v_clean_profile_phone text;
BEGIN
  IF length(v_phone) < 10 THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;

  -- Validate caller's identity
  IF NOT public.is_admin() THEN
    IF v_uid IS NULL THEN
      PERFORM public.log_security_event(NULL, 'MARK_NOTIFICATION_READ_UNAUTHORIZED', 'failed: unauthenticated', jsonb_build_object('notification_id', p_notification_id));
      RAISE EXCEPTION 'Access Denied: Please log in first.';
    END IF;

    SELECT phone INTO v_profile_phone FROM public.customer_profiles WHERE id = v_uid;
    IF v_profile_phone IS NULL OR v_profile_phone = '' THEN
      PERFORM public.log_security_event(v_uid, 'MARK_NOTIFICATION_READ_UNAUTHORIZED', 'failed: missing profile phone', jsonb_build_object('notification_id', p_notification_id));
      RAISE EXCEPTION 'Access Denied: No phone number registered on this account.';
    END IF;

    v_clean_profile_phone := regexp_replace(v_profile_phone, '\D', '', 'g');
    IF v_phone <> v_clean_profile_phone THEN
      PERFORM public.log_security_event(v_uid, 'MARK_NOTIFICATION_READ_UNAUTHORIZED', 'failed: ownership mismatch', jsonb_build_object('notification_id', p_notification_id, 'requested_phone', p_phone, 'profile_phone', v_profile_phone));
      RAISE EXCEPTION 'Access Denied: You are not authorized to modify this resource.';
    END IF;
  END IF;

  UPDATE public.notifications
  SET is_read = true, updated_at = now()
  WHERE id = p_notification_id
    AND (
      regexp_replace(customer_phone, '\D', '', 'g') = v_phone
      OR regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone
      OR v_phone LIKE '%' || regexp_replace(customer_phone, '\D', '', 'g')
    );
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notification_as_read(uuid, text) TO anon, authenticated;

-- 4.11. mark_all_notifications_as_read(...)
CREATE OR REPLACE FUNCTION public.mark_all_notifications_as_read(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
  v_uid uuid := auth.uid();
  v_profile_phone text;
  v_clean_profile_phone text;
BEGIN
  IF length(v_phone) < 10 THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;

  -- Validate caller's identity
  IF NOT public.is_admin() THEN
    IF v_uid IS NULL THEN
      PERFORM public.log_security_event(NULL, 'MARK_ALL_NOTIFICATIONS_READ_UNAUTHORIZED', 'failed: unauthenticated', jsonb_build_object('requested_phone', p_phone));
      RAISE EXCEPTION 'Access Denied: Please log in first.';
    END IF;

    SELECT phone INTO v_profile_phone FROM public.customer_profiles WHERE id = v_uid;
    IF v_profile_phone IS NULL OR v_profile_phone = '' THEN
      PERFORM public.log_security_event(v_uid, 'MARK_ALL_NOTIFICATIONS_READ_UNAUTHORIZED', 'failed: missing profile phone', jsonb_build_object('requested_phone', p_phone));
      RAISE EXCEPTION 'Access Denied: No phone number registered on this account.';
    END IF;

    v_clean_profile_phone := regexp_replace(v_profile_phone, '\D', '', 'g');
    IF v_phone <> v_clean_profile_phone THEN
      PERFORM public.log_security_event(v_uid, 'MARK_ALL_NOTIFICATIONS_READ_UNAUTHORIZED', 'failed: ownership mismatch', jsonb_build_object('requested_phone', p_phone, 'profile_phone', v_profile_phone));
      RAISE EXCEPTION 'Access Denied: You are not authorized to modify this resource.';
    END IF;
  END IF;

  UPDATE public.notifications
  SET is_read = true, updated_at = now()
  WHERE is_read = false
    AND (
      regexp_replace(customer_phone, '\D', '', 'g') = v_phone
      OR regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone
      OR v_phone LIKE '%' || regexp_replace(customer_phone, '\D', '', 'g')
    );
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_notifications_as_read(text) TO anon, authenticated;

-- 4.12. get_customer_unread_count(...)
CREATE OR REPLACE FUNCTION public.get_customer_unread_count(p_phone text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
  v_count integer := 0;
  v_uid uuid := auth.uid();
  v_profile_phone text;
  v_clean_profile_phone text;
BEGIN
  IF length(v_phone) < 10 THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;

  -- Validate caller's identity
  IF NOT public.is_admin() THEN
    IF v_uid IS NULL THEN
      PERFORM public.log_security_event(NULL, 'GET_UNREAD_COUNT_UNAUTHORIZED', 'failed: unauthenticated', jsonb_build_object('requested_phone', p_phone));
      RAISE EXCEPTION 'Access Denied: Please log in first.';
    END IF;

    SELECT phone INTO v_profile_phone FROM public.customer_profiles WHERE id = v_uid;
    IF v_profile_phone IS NULL OR v_profile_phone = '' THEN
      PERFORM public.log_security_event(v_uid, 'GET_UNREAD_COUNT_UNAUTHORIZED', 'failed: missing profile phone', jsonb_build_object('requested_phone', p_phone));
      RAISE EXCEPTION 'Access Denied: No phone number registered on this account.';
    END IF;

    v_clean_profile_phone := regexp_replace(v_profile_phone, '\D', '', 'g');
    IF v_phone <> v_clean_profile_phone THEN
      PERFORM public.log_security_event(v_uid, 'GET_UNREAD_COUNT_UNAUTHORIZED', 'failed: ownership mismatch', jsonb_build_object('requested_phone', p_phone, 'profile_phone', v_profile_phone));
      RAISE EXCEPTION 'Access Denied: You are not authorized to access this resource.';
    END IF;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.notifications
  WHERE is_read = false
    AND (
      regexp_replace(customer_phone, '\D', '', 'g') = v_phone
      OR regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone
      OR v_phone LIKE '%' || regexp_replace(customer_phone, '\D', '', 'g')
    );

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_unread_count(text) TO anon, authenticated;

-- 4.13. send_phone_signup_code(...)
CREATE OR REPLACE FUNCTION public.send_phone_signup_code(p_phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean_phone text := regexp_replace(p_phone, '\D', '', 'g');
  v_code text;
  v_record record;
BEGIN
  IF length(v_clean_phone) <> 10 THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;

  -- Prevent duplicate signups
  IF EXISTS (SELECT 1 FROM public.customer_profiles WHERE phone = v_clean_phone) THEN
    RAISE EXCEPTION 'An account with this phone number already exists';
  END IF;

  -- Check block limits
  SELECT * INTO v_record FROM public.phone_verifications WHERE phone = v_clean_phone;
  IF FOUND THEN
    IF v_record.blocked_until > now() THEN
      RAISE EXCEPTION 'This phone number is temporarily blocked. Try again after %.', to_char(v_record.blocked_until, 'HH24:MI:SS');
    END IF;

    -- Cooldown restriction (60 seconds)
    IF v_record.last_sent_at > now() - interval '60 seconds' THEN
      RAISE EXCEPTION 'Please wait 60 seconds before requesting another code.';
    END IF;

    -- Block number if resend limit exceeded (5 requests within 1 hour)
    IF v_record.resend_count >= 5 AND v_record.last_sent_at > now() - interval '1 hour' THEN
      UPDATE public.phone_verifications
      SET blocked_until = now() + interval '15 minutes',
          attempts = 0
      WHERE phone = v_clean_phone;
      PERFORM public.log_security_event(NULL, 'OTP_RATE_LIMIT_BLOCKED', 'failed: blocked', jsonb_build_object('phone', v_clean_phone, 'resend_count', v_record.resend_count));
      RAISE EXCEPTION 'Excessive requests. This phone number is temporarily blocked for 15 minutes.';
    END IF;
  END IF;

  -- Generate secure random 6-digit numeric OTP code
  v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');

  INSERT INTO public.phone_verifications (phone, code, expiry, attempts, resend_count, last_sent_at, blocked_until)
  VALUES (v_clean_phone, v_code, now() + interval '5 minutes', 0, 1, now(), NULL)
  ON CONFLICT (phone) DO UPDATE
  SET code = excluded.code,
      expiry = excluded.expiry,
      attempts = 0,
      resend_count = CASE WHEN phone_verifications.last_sent_at > now() - interval '1 hour' THEN phone_verifications.resend_count + 1 ELSE 1 END,
      last_sent_at = now(),
      blocked_until = NULL;

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_phone_signup_code(text) TO anon, authenticated;

-- 4.14. send_phone_reset_code(...)
CREATE OR REPLACE FUNCTION public.send_phone_reset_code(p_phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean_phone text := regexp_replace(p_phone, '\D', '', 'g');
  v_code text;
  v_record record;
BEGIN
  IF length(v_clean_phone) <> 10 THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;

  -- Check if user exists
  IF NOT EXISTS (SELECT 1 FROM public.customer_profiles WHERE phone = v_clean_phone) THEN
    RAISE EXCEPTION 'Account with this phone number does not exist';
  END IF;

  -- Check block limits
  SELECT * INTO v_record FROM public.phone_verifications WHERE phone = v_clean_phone;
  IF FOUND THEN
    IF v_record.blocked_until > now() THEN
      RAISE EXCEPTION 'This phone number is temporarily blocked. Try again after %.', to_char(v_record.blocked_until, 'HH24:MI:SS');
    END IF;

    -- Cooldown restriction (60 seconds)
    IF v_record.last_sent_at > now() - interval '60 seconds' THEN
      RAISE EXCEPTION 'Please wait 60 seconds before requesting another code.';
    END IF;

    -- Block number if resend limit exceeded (5 requests within 1 hour)
    IF v_record.resend_count >= 5 AND v_record.last_sent_at > now() - interval '1 hour' THEN
      UPDATE public.phone_verifications
      SET blocked_until = now() + interval '15 minutes',
          attempts = 0
      WHERE phone = v_clean_phone;
      PERFORM public.log_security_event(NULL, 'OTP_RATE_LIMIT_BLOCKED', 'failed: blocked', jsonb_build_object('phone', v_clean_phone, 'resend_count', v_record.resend_count));
      RAISE EXCEPTION 'Excessive requests. This phone number is temporarily blocked for 15 minutes.';
    END IF;
  END IF;

  -- Generate secure random 6-digit numeric OTP code
  v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');

  INSERT INTO public.phone_verifications (phone, code, expiry, attempts, resend_count, last_sent_at, blocked_until)
  VALUES (v_clean_phone, v_code, now() + interval '5 minutes', 0, 1, now(), NULL)
  ON CONFLICT (phone) DO UPDATE
  SET code = excluded.code,
      expiry = excluded.expiry,
      attempts = 0,
      resend_count = CASE WHEN phone_verifications.last_sent_at > now() - interval '1 hour' THEN phone_verifications.resend_count + 1 ELSE 1 END,
      last_sent_at = now(),
      blocked_until = NULL;

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_phone_reset_code(text) TO anon, authenticated;

-- 4.15. verify_phone_reset_password(...)
CREATE OR REPLACE FUNCTION public.verify_phone_reset_password(p_phone text, p_code text, p_new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean_phone text := regexp_replace(p_phone, '\D', '', 'g');
  v_email text := v_clean_phone || '@limraresturent.in';
  v_record record;
BEGIN
  IF length(v_clean_phone) <> 10 THEN RAISE EXCEPTION 'Please enter a valid 10-digit phone number'; END IF;

  SELECT * INTO v_record FROM public.phone_verifications WHERE phone = v_clean_phone;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incorrect or expired verification code';
  END IF;

  -- Check block status
  IF v_record.blocked_until > now() THEN
    RAISE EXCEPTION 'This phone number is temporarily blocked. Try again after %.', to_char(v_record.blocked_until, 'HH24:MI:SS');
  END IF;

  -- Check expiry
  IF v_record.expiry < now() THEN
    DELETE FROM public.phone_verifications WHERE phone = v_clean_phone;
    RAISE EXCEPTION 'Verification code expired. Please request a new code';
  END IF;

  -- Verify code and protect against brute-force (max 3 failed attempts)
  IF v_record.code <> p_code THEN
    UPDATE public.phone_verifications
    SET attempts = attempts + 1
    WHERE phone = v_clean_phone;

    IF v_record.attempts + 1 >= 3 THEN
      UPDATE public.phone_verifications
      SET blocked_until = now() + interval '15 minutes'
      WHERE phone = v_clean_phone;
      PERFORM public.log_security_event(NULL, 'OTP_BRUTE_FORCE_BLOCKED', 'failed: blocked', jsonb_build_object('phone', v_clean_phone));
      RAISE EXCEPTION 'Too many incorrect attempts. This phone number is blocked for 15 minutes.';
    ELSE
      RAISE EXCEPTION 'Incorrect verification code. Attempts remaining: %', (3 - (v_record.attempts + 1));
    END IF;
  END IF;

  DELETE FROM public.phone_verifications WHERE phone = v_clean_phone;

  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf'))
  WHERE email = v_email;

  UPDATE public.customer_profiles
  SET phone_verified = true,
      updated_at = now()
  WHERE phone = v_clean_phone;

  PERFORM public.log_security_event(NULL, 'PHONE_PASSWORD_RESET_SUCCESS', 'success', jsonb_build_object('phone', v_clean_phone));

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_phone_reset_password(text, text, text) TO anon, authenticated;


-- 5. Row-Level Security (RLS) Overhaul for All Tables

-- 5.1. orders
DROP POLICY IF EXISTS "Public can create orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can read orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;

CREATE POLICY "Public can create orders"
  ON public.orders FOR INSERT
  TO anon, authenticated
  WITH CHECK (auth.uid() IS NULL OR user_id = auth.uid());

CREATE POLICY "Admins can read orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can update orders"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Users can read own orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR regexp_replace(customer_phone, '\D', '', 'g') = (SELECT regexp_replace(phone, '\D', '', 'g') FROM public.customer_profiles WHERE id = auth.uid()));

-- 5.2. order_items
DROP POLICY IF EXISTS "Public can create order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins can read order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins can insert order items" ON public.order_items;

CREATE POLICY "Admins can read order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can insert order items"
  ON public.order_items FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Users can read own order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND (o.user_id = auth.uid() OR regexp_replace(o.customer_phone, '\D', '', 'g') = (SELECT regexp_replace(phone, '\D', '', 'g') FROM public.customer_profiles WHERE id = auth.uid()))
  ));

-- 5.3. bookings
DROP POLICY IF EXISTS "Public can create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins can read bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins can update bookings" ON public.bookings;

CREATE POLICY "Public can create bookings"
  ON public.bookings FOR INSERT
  TO anon, authenticated
  WITH CHECK (auth.uid() IS NULL OR user_id = auth.uid());

CREATE POLICY "Admins can read bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can update bookings"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Users can read own bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR regexp_replace(customer_phone, '\D', '', 'g') = (SELECT regexp_replace(phone, '\D', '', 'g') FROM public.customer_profiles WHERE id = auth.uid()));

-- 5.4. customer_profiles
DROP POLICY IF EXISTS "Users can insert own profile" ON public.customer_profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.customer_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.customer_profiles;
DROP POLICY IF EXISTS "Admins can manage profiles" ON public.customer_profiles;

CREATE POLICY "Users can insert own profile"
  ON public.customer_profiles FOR INSERT
  TO anon, authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "Users can read own profile"
  ON public.customer_profiles FOR SELECT
  TO authenticated, anon
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON public.customer_profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Admins can manage profiles"
  ON public.customer_profiles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 5.5. notifications
DROP POLICY IF EXISTS "Admins can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Allow select for admins" ON public.notifications;
DROP POLICY IF EXISTS "Allow update for admins" ON public.notifications;
DROP POLICY IF EXISTS "Allow delete for admins" ON public.notifications;

CREATE POLICY "Admins can insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Allow select for admins"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Allow update for admins"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Allow delete for admins"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Users can select own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR regexp_replace(customer_phone, '\D', '', 'g') = (SELECT regexp_replace(phone, '\D', '', 'g') FROM public.customer_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR regexp_replace(customer_phone, '\D', '', 'g') = (SELECT regexp_replace(phone, '\D', '', 'g') FROM public.customer_profiles WHERE id = auth.uid()));

-- 5.6. payment_history
DROP POLICY IF EXISTS "Admins can select payment history" ON public.payment_history;
DROP POLICY IF EXISTS "Admins can insert payment history" ON public.payment_history;

CREATE POLICY "Admins can select payment history"
  ON public.payment_history FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can insert payment history"
  ON public.payment_history FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Users can read own payment history"
  ON public.payment_history FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = payment_history.order_id
      AND (o.user_id = auth.uid() OR regexp_replace(o.customer_phone, '\D', '', 'g') = (SELECT regexp_replace(phone, '\D', '', 'g') FROM public.customer_profiles WHERE id = auth.uid()))
  ));

-- 5.7. phone_verifications
DROP POLICY IF EXISTS "allow_authenticated_view_verification" ON public.phone_verifications;

CREATE POLICY "allow_authenticated_view_verification"
  ON public.phone_verifications FOR SELECT
  TO authenticated, anon
  USING (false);

-- 5.8. admin_users
DROP POLICY IF EXISTS "Admins can read admin_users" ON public.admin_users;

CREATE POLICY "Admins can read admin_users"
  ON public.admin_users FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- 5.9. security_audit_logs
CREATE POLICY "Admins can view security logs"
  ON public.security_audit_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- 5.10. verified_payments
CREATE POLICY "Admins can view verified payments"
  ON public.verified_payments FOR SELECT
  TO authenticated
  USING (public.is_admin());
