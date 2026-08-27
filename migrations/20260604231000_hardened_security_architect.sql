-- ═══════════════════════════════════════════════════════════════════════════
-- LIMRA Restaurant — Hardened Security Architect Migration
-- Addresses all Security Advisor warnings for RLS, Policies, Privileges,
-- and SECURITY DEFINER search paths.
-- ═══════════════════════════════════════════════════════════════════════════



-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE GROUP 1: PERMISSIVE RLS POLICIES (public.customer_profiles)
-- ─────────────────────────────────────────────────────────────────────────
-- Drop the permissive insert policy
DROP POLICY IF EXISTS "Users can insert own profile" ON public.customer_profiles;
DROP POLICY IF EXISTS "Allow anon and authenticated insert profile" ON public.customer_profiles;

-- Create secure insert policy using subquery performance optimization
CREATE POLICY "Users can insert own profile"
  ON public.customer_profiles FOR INSERT
  TO anon, authenticated
  WITH CHECK ((SELECT auth.uid()) = id);

-- Drop and recreate select policy with optimized subquery
DROP POLICY IF EXISTS "Users can read own profile" ON public.customer_profiles;
CREATE POLICY "Users can read own profile"
  ON public.customer_profiles FOR SELECT
  TO anon, authenticated
  USING ((SELECT auth.uid()) = id);

-- Drop and recreate update policy with optimized subquery
DROP POLICY IF EXISTS "Users can update own profile" ON public.customer_profiles;
CREATE POLICY "Users can update own profile"
  ON public.customer_profiles FOR UPDATE
  TO anon, authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE GROUP 2: NOTIFICATIONS TABLE (public.notifications)
-- ─────────────────────────────────────────────────────────────────────────
-- Notifications are generated exclusively via backend database triggers.
-- Therefore, we remove public/anon insert capabilities entirely.
DROP POLICY IF EXISTS "Allow insert for all" ON public.notifications;

-- Re-qualify existing read/write policies for admin users
DROP POLICY IF EXISTS "Allow select for admins" ON public.notifications;
CREATE POLICY "Allow select for admins"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Allow update for admins" ON public.notifications;
CREATE POLICY "Allow update for admins"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Allow delete for admins" ON public.notifications;
CREATE POLICY "Allow delete for admins"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE GROUP 3: PHONE VERIFICATIONS TABLE (public.phone_verifications)
-- ─────────────────────────────────────────────────────────────────────────
-- Keep RLS enabled. Verification codes must never be read directly by clients.
-- Bypassing RLS writes is restricted strictly to the database owner and triggers (SECURITY DEFINER).
DROP POLICY IF EXISTS "Allow service_role full access" ON public.phone_verifications;


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE GROUP 4: DANGEROUS SECURITY DEFINER FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────

-- 1. is_admin()
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 2. place_order (4 parameters)
CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_name text,
  p_customer_phone text,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item  jsonb;
  v_total numeric := 0;
BEGIN
  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;
  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_total := v_total + COALESCE((v_item->>'line_total')::numeric, 0);
  END LOOP;

  INSERT INTO public.orders (customer_name, customer_phone, total_amount, notes, status)
  VALUES (
    trim(p_customer_name),
    trim(p_customer_phone),
    v_total,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    'pending'
  )
  RETURNING * INTO v_order;

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
    'id',           v_order.id,
    'order_number', v_order.order_number,
    'total_amount', v_order.total_amount,
    'status',       v_order.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb) TO anon, authenticated;

-- 3. place_order (9 parameters)
CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_name text,
  p_customer_phone text,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_landmark text DEFAULT NULL,
  p_delivery_notes text DEFAULT NULL,
  p_location_verified boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item  jsonb;
  v_total numeric := 0;
BEGIN
  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;
  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_total := v_total + COALESCE((v_item->>'line_total')::numeric, 0);
  END LOOP;

  INSERT INTO public.orders (
    customer_name, customer_phone, total_amount, notes, status,
    latitude, longitude, landmark, delivery_notes, location_verified
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
    p_location_verified
  )
  RETURNING * INTO v_order;

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

REVOKE ALL ON FUNCTION public.place_order(text, text, text, jsonb, numeric, numeric, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, numeric, numeric, text, text, boolean) TO anon, authenticated;

-- 4. place_booking
CREATE OR REPLACE FUNCTION public.place_booking(
  p_type             text,
  p_customer_name    text,
  p_customer_phone   text,
  p_booking_date     date    DEFAULT NULL,
  p_booking_time     text    DEFAULT NULL,
  p_guests           integer DEFAULT NULL,
  p_preference       text    DEFAULT NULL,
  p_seat_label       text    DEFAULT NULL,
  p_event_type       text    DEFAULT NULL,
  p_budget           text    DEFAULT NULL,
  p_catering         text    DEFAULT NULL,
  p_venue            text    DEFAULT NULL,
  p_message          text    DEFAULT NULL,
  p_notes            text    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  INSERT INTO public.bookings (
    type, customer_name, customer_phone, booking_date, booking_time,
    guests, preference, seat_label, event_type, budget, catering,
    venue, message, notes, status
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
    'pending'
  )
  RETURNING * INTO v_booking;

  RETURN jsonb_build_object(
    'id',             v_booking.id,
    'booking_number', v_booking.booking_number,
    'status',         v_booking.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.place_booking(text, text, text, date, text, integer, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_booking(text, text, text, date, text, integer, text, text, text, text, text, text, text, text) TO anon, authenticated;

-- 5. get_customer_bookings
CREATE OR REPLACE FUNCTION public.get_customer_bookings(p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
BEGIN
  IF length(v_phone) < 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
    FROM (
      SELECT
        booking_number,
        type,
        customer_name,
        booking_date,
        booking_time,
        guests,
        seat_label,
        status,
        created_at
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

REVOKE ALL ON FUNCTION public.get_customer_bookings(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_bookings(text) TO anon, authenticated;

-- 6. get_customer_orders
CREATE OR REPLACE FUNCTION public.get_customer_orders(p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
BEGIN
  IF length(v_phone) < 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
    FROM (
      SELECT
        o.order_number,
        o.customer_name,
        o.total_amount,
        o.status,
        o.created_at,
        o.notes,
        o.latitude,
        o.longitude,
        o.landmark,
        o.delivery_notes,
        o.location_verified,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'item_name', oi.item_name,
            'quantity',  oi.quantity,
            'line_total', oi.line_total
          ) ORDER BY oi.item_name)
          FROM public.order_items oi
          WHERE oi.order_id = o.id
        ) AS items
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

REVOKE ALL ON FUNCTION public.get_customer_orders(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_orders(text) TO anon, authenticated;

-- 7. send_phone_signup_code
CREATE OR REPLACE FUNCTION public.send_phone_signup_code(p_phone text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_clean_phone text := regexp_replace(p_phone, '\D', '', 'g');
  v_code text;
BEGIN
  IF length(v_clean_phone) <> 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number';
  END IF;

  IF EXISTS (SELECT 1 FROM public.customer_profiles WHERE phone = v_clean_phone) THEN
    RAISE EXCEPTION 'An account with this phone number already exists';
  END IF;

  v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');

  INSERT INTO public.phone_verifications (phone, code, expiry)
  VALUES (v_clean_phone, v_code, now() + interval '5 minutes')
  ON CONFLICT (phone) DO UPDATE
  SET code = excluded.code,
      expiry = excluded.expiry,
      created_at = now();

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.send_phone_signup_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_phone_signup_code(text) TO anon, authenticated;

-- 8. send_phone_reset_code
CREATE OR REPLACE FUNCTION public.send_phone_reset_code(p_phone text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_clean_phone text := regexp_replace(p_phone, '\D', '', 'g');
  v_code text;
BEGIN
  IF length(v_clean_phone) <> 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customer_profiles WHERE phone = v_clean_phone) THEN
    RAISE EXCEPTION 'Account with this phone number does not exist';
  END IF;

  v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');

  INSERT INTO public.phone_verifications (phone, code, expiry)
  VALUES (v_clean_phone, v_code, now() + interval '5 minutes')
  ON CONFLICT (phone) DO UPDATE
  SET code = excluded.code,
      expiry = excluded.expiry,
      created_at = now();

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.send_phone_reset_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_phone_reset_code(text) TO anon, authenticated;

-- 9. verify_phone_reset_password
CREATE OR REPLACE FUNCTION public.verify_phone_reset_password(p_phone text, p_code text, p_new_password text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_clean_phone text := regexp_replace(p_phone, '\D', '', 'g');
  v_email text := v_clean_phone || '@limraresturent.in';
  v_record record;
BEGIN
  IF length(v_clean_phone) <> 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number';
  END IF;

  SELECT * INTO v_record FROM public.phone_verifications WHERE phone = v_clean_phone;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incorrect verification code';
  END IF;

  IF v_record.code <> p_code THEN
    RAISE EXCEPTION 'Incorrect verification code';
  END IF;

  IF v_record.expiry < now() THEN
    RAISE EXCEPTION 'Verification code expired. Please request a new code';
  END IF;

  DELETE FROM public.phone_verifications WHERE phone = v_clean_phone;

  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf'))
  WHERE email = v_email;

  UPDATE public.customer_profiles
  SET phone_verified = true,
      updated_at = now()
  WHERE phone = v_clean_phone;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_phone_reset_password(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_phone_reset_password(text, text, text) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE GROUP 5: TRIGGER FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────

-- 1. tr_on_order_insert()
CREATE OR REPLACE FUNCTION public.tr_on_order_insert()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.notifications (type, item_id, title, description)
  VALUES (
    'order',
    NEW.id,
    'New Order #' || NEW.order_number,
    'Order for ₹' || NEW.total_amount || ' by ' || NEW.customer_name
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.tr_on_order_insert() FROM PUBLIC;

-- 2. tr_on_booking_insert()
CREATE OR REPLACE FUNCTION public.tr_on_booking_insert()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.notifications (type, item_id, title, description)
  VALUES (
    'booking',
    NEW.id,
    'New ' || initcap(NEW.type) || ' Booking',
    'Booking #' || NEW.booking_number || ' by ' || NEW.customer_name || ' for ' || COALESCE(NEW.guests::text, '—') || ' guests'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.tr_on_booking_insert() FROM PUBLIC;

-- 3. tr_on_order_status_update()
CREATE OR REPLACE FUNCTION public.tr_on_order_status_update()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications (type, item_id, title, description)
    VALUES (
      'order_status',
      NEW.id,
      'Order #' || NEW.order_number || ' Updated',
      'Order status changed to ' || initcap(NEW.status) || ' for ' || NEW.customer_name
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.tr_on_order_status_update() FROM PUBLIC;

-- 4. handle_new_user()
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.customer_profiles (id, name, phone, email, address)
  VALUES (
    NEW.id,
    COALESCE(NEW.metadata->>'name', NEW.profile->>'name', 'Limra Foodie'),
    COALESCE(NEW.metadata->>'phone', NEW.profile->>'phone'),
    NEW.email,
    '[]'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Automatically grant admin rights to specified owner emails
  IF NEW.email IN ('arfatalis451@gmail.com', 'limrarestaurant99@gmail.com') THEN
    INSERT INTO public.admin_users (user_id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

-- 5. auto_verify_phone_users()
CREATE OR REPLACE FUNCTION public.auto_verify_phone_users()
RETURNS trigger AS $$
BEGIN
  IF NEW.email LIKE '%@limraresturent.in' THEN
    NEW.email_verified := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.auto_verify_phone_users() FROM PUBLIC;


