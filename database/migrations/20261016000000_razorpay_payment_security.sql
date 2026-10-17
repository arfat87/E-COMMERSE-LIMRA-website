-- ═══════════════════════════════════════════════════════════════════════════════
-- LIMRA RESTAURANT — Razorpay & Payment Security Hardening Migration
-- 1. Hardens place_order RPC: prevents arbitrary 'paid' status and fake UTR caching
-- 2. Hardens update_order_payment_status RPC: strictly restricts to staff/admin
-- 3. Enforces state transitions (unpaid -> paid -> refunded, disallow paid -> unpaid)
-- 4. Prevents duplicate payment claiming and replay attacks
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. HARDEN place_order RPC
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_item jsonb;
  v_total numeric := 0;
  v_uid uuid := auth.uid();
  v_clean_phone text := regexp_replace(COALESCE(p_customer_phone, ''), '\D', '', 'g');
  v_verified_payment public.verified_payments%ROWTYPE;
  v_initial_pay_status text := 'unpaid';
  v_initial_pay_method text := 'cash';
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

  -- Compute order total
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_total := v_total + COALESCE((v_item->>'line_total')::numeric, 0);
  END LOOP;

  -- Verify payment if transaction reference is supplied
  -- CRITICAL SECURITY: Never auto-insert fake verified payments!
  -- Only mark as 'paid' if verified_payments ALREADY contains an unclaimed successful record
  IF p_txn_ref IS NOT NULL AND trim(p_txn_ref) <> '' THEN
    SELECT * INTO v_verified_payment
    FROM public.verified_payments
    WHERE utr = trim(p_txn_ref)
      AND status = 'success'
      AND amount >= v_total
      AND order_id IS NULL;

    IF FOUND THEN
      v_initial_pay_status := 'paid';
      v_initial_pay_method := 'online';
    ELSE
      -- Payment not verified or already claimed: order must remain unpaid
      v_initial_pay_status := 'unpaid';
      v_initial_pay_method := 'cash';
    END IF;
  END IF;

  -- Insert order
  INSERT INTO public.orders (
    customer_name, customer_phone, total_amount, notes, status,
    latitude, longitude, landmark, delivery_notes, location_verified,
    order_type, table_number, table_zone, user_id, txn_ref, payment_status, payment_method
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
    CASE WHEN v_initial_pay_status = 'paid' THEN trim(p_txn_ref) ELSE NULL END,
    v_initial_pay_status,
    v_initial_pay_method
  )
  RETURNING * INTO v_order;

  -- Atomically claim the verified payment for this order to prevent replay attacks
  IF v_initial_pay_status = 'paid' AND p_txn_ref IS NOT NULL THEN
    UPDATE public.verified_payments
    SET order_id = v_order.id
    WHERE utr = trim(p_txn_ref);
  END IF;

  -- Insert order items
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.order_items (
      order_id, menu_item_id, item_name, quantity, unit_price, line_total
    )
    VALUES (
      v_order.id,
      CASE WHEN v_item ? 'menu_item_id' AND v_item->>'menu_item_id' IS NOT NULL
        THEN (v_item->>'menu_item_id')::integer ELSE NULL END,
      v_item->>'item_name',
      GREATEST(COALESCE((v_item->>'quantity')::integer, (v_item->>'qty')::integer, 1), 1),
      COALESCE((v_item->>'unit_price')::numeric, (v_item->>'price')::numeric, 0),
      COALESCE((v_item->>'line_total')::numeric, 0)
    );
  END LOOP;

  -- Insert automatic staff notification
  INSERT INTO public.notifications (
    type, title, message, description, order_id, item_id, customer_phone, is_read
  )
  VALUES (
    'order',
    '📦 New ' || UPPER(p_order_type) || ' Order #' || v_order.order_number,
    'Order received for ₹' || v_total::text || ' from ' || p_customer_name || ' (' || UPPER(v_initial_pay_status) || ')',
    'Order received for ₹' || v_total::text || ' from ' || p_customer_name || ' (' || UPPER(v_initial_pay_status) || ')',
    v_order.id,
    v_order.id::text,
    p_customer_phone,
    false
  );

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'total_amount', v_order.total_amount,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'payment_method', v_order.payment_method
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, numeric, numeric, text, text, boolean, text, integer, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. HARDEN update_order_payment_status RPC (ADMIN ONLY & STATE VALIDATION)
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_user_id uuid;
  v_clean_status text := lower(trim(p_payment_status));
BEGIN
  -- Strict authorization: only authenticated admin/staff can invoke
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only administrative staff can update payment status';
  END IF;

  -- Validate permitted status values
  IF v_clean_status NOT IN ('unpaid', 'paid', 'refunded', 'failed') THEN
    RAISE EXCEPTION 'Invalid payment status: %. Allowed values: unpaid, paid, refunded, failed', p_payment_status;
  END IF;

  -- Select order with lock to prevent race conditions
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_prev_status := v_order.payment_status;

  -- Idempotency check: if already at target status, return success
  IF v_prev_status = v_clean_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Payment status is already ' || v_clean_status,
      'order_id', p_order_id,
      'payment_status', v_clean_status,
      'idempotent', true
    );
  END IF;

  -- State Transition Enforcement:
  -- Disallow reverting a settled 'paid' order to 'unpaid' (must use 'refunded')
  IF v_prev_status = 'paid' AND v_clean_status = 'unpaid' THEN
    RAISE EXCEPTION 'Invalid transition: Settled paid orders cannot be reverted to unpaid. Use refund workflow instead.';
  END IF;

  -- Disallow re-opening a 'refunded' order
  IF v_prev_status = 'refunded' AND v_clean_status != 'refunded' THEN
    RAISE EXCEPTION 'Invalid transition: Refunded orders cannot be modified or re-opened.';
  END IF;

  -- Resolve active admin identity
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_changed_by FROM public.admin_users WHERE user_id = v_user_id LIMIT 1;
    IF v_changed_by IS NULL THEN
      v_changed_by := 'Admin (' || v_user_id::text || ')';
    END IF;
  ELSE
    v_changed_by := 'system/payment-service';
  END IF;

  -- Update order payment status
  UPDATE public.orders
  SET payment_status = v_clean_status,
      updated_at = now()
  WHERE id = p_order_id;

  -- Insert history record
  INSERT INTO public.payment_history (
    order_id,
    user_id,
    previous_status,
    new_status,
    changed_by,
    notes,
    created_at,
    updated_at
  )
  VALUES (
    p_order_id,
    v_user_id,
    v_prev_status,
    v_clean_status,
    v_changed_by,
    COALESCE(p_notes, 'Payment status updated from ' || v_prev_status || ' to ' || v_clean_status),
    now(),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'payment_status', v_clean_status,
    'previous_status', v_prev_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_order_payment_status(uuid, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_order_payment_status(uuid, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. EXTEND PAYMENT TABLES CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Ensure orders check constraint includes refunded and failed
  ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
  ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check
    CHECK (payment_status IN ('unpaid', 'paid', 'refunded', 'failed'));
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$
BEGIN
  -- Ensure payment_history check constraints include refunded and failed
  ALTER TABLE public.payment_history DROP CONSTRAINT IF EXISTS payment_history_new_status_check;
  ALTER TABLE public.payment_history ADD CONSTRAINT payment_history_new_status_check
    CHECK (new_status IN ('unpaid', 'paid', 'refunded', 'failed'));
EXCEPTION WHEN OTHERS THEN NULL; END $$;
