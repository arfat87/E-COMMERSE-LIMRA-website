-- =============================================================================
-- MIGRATION: 20261017000000_transaction_integrity_and_idempotency.sql
-- Description: Enforce atomic database transactions, idempotency keys,
--              concurrency row locking (FOR UPDATE) for POS settlements and
--              stock deductions, and transactional outbox queue for external side effects.
-- =============================================================================

-- 1. ADD IDEMPOTENCY KEY COLUMN TO ORDERS
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key 
  ON public.orders(idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

-- 2. CREATE TRANSACTIONAL SYNC QUEUE (OUTBOX PATTERN FOR EXTERNAL SIDE EFFECTS)
-- External operations (thermal printing, Google Sheets sync, external webhooks)
-- are decoupled from core database commits. If an external service fails,
-- the committed database transaction remains intact and the side effect is retried.
CREATE TABLE IF NOT EXISTS public.sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('order_print', 'google_sheet', 'webhook_outbound', 'stock_sync')),
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_pending 
  ON public.sync_queue(status, created_at) 
  WHERE status = 'pending';

ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage sync_queue" ON public.sync_queue;
CREATE POLICY "Admins can manage sync_queue" 
  ON public.sync_queue 
  FOR ALL 
  TO authenticated 
  USING (public.is_admin()) 
  WITH CHECK (public.is_admin());

-- 3. HARDEN PLACE_ORDER RPC FOR FULL ATOMICITY & IDEMPOTENCY
-- Creates order header, line items, claims payment reference, and logs notification
-- within a single indivisible database transaction.
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
  p_txn_ref text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
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
  v_clean_key text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  -- 3.1 Idempotency check: Return existing order if identical idempotency_key is replayed
  IF v_clean_key IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE idempotency_key = v_clean_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'id', v_order.id,
        'order_number', v_order.order_number,
        'customer_name', v_order.customer_name,
        'customer_phone', v_order.customer_phone,
        'total_amount', v_order.total_amount,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'ticket_status', v_order.ticket_status,
        'idempotent_replay', true,
        'created_at', v_order.created_at
      );
    END IF;
  END IF;

  -- 3.2 Basic input validation
  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;
  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  -- 3.3 Compute order total from items
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_total := v_total + COALESCE((v_item->>'line_total')::numeric, 0);
  END LOOP;

  -- 3.4 Strict payment verification against verified_payments (anti-forgery & anti-replay)
  IF p_txn_ref IS NOT NULL AND trim(p_txn_ref) <> '' THEN
    SELECT * INTO v_verified_payment
    FROM public.verified_payments
    WHERE utr = trim(p_txn_ref)
      AND status = 'success'
      AND amount >= v_total
      AND order_id IS NULL
    FOR UPDATE;

    IF FOUND THEN
      v_initial_pay_status := 'paid';
      v_initial_pay_method := 'online';
    ELSE
      v_initial_pay_status := 'unpaid';
      v_initial_pay_method := 'cash';
    END IF;
  END IF;

  -- 3.5 Insert Order Header
  INSERT INTO public.orders (
    customer_name, customer_phone, total_amount, notes, status,
    latitude, longitude, landmark, delivery_notes, location_verified,
    order_type, table_number, table_zone, user_id, txn_ref,
    payment_status, payment_method, ticket_status, idempotency_key
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
    COALESCE(p_order_type, 'delivery'),
    p_table_number,
    p_table_zone,
    v_uid,
    CASE WHEN v_initial_pay_status = 'paid' THEN trim(p_txn_ref) ELSE NULL END,
    v_initial_pay_status,
    v_initial_pay_method,
    'OPEN',
    v_clean_key
  )
  RETURNING * INTO v_order;

  -- 3.6 Atomically bind verified payment to this order ID
  IF v_initial_pay_status = 'paid' AND p_txn_ref IS NOT NULL THEN
    UPDATE public.verified_payments 
    SET order_id = v_order.id 
    WHERE utr = trim(p_txn_ref) AND order_id IS NULL;

    INSERT INTO public.payment_history (
      order_id, previous_status, new_status, change_reason, changed_by, created_at
    )
    VALUES (
      v_order.id, 'unpaid', 'paid', 'Initial online order creation with verified UTR ' || trim(p_txn_ref), v_uid, now()
    );
  END IF;

  -- 3.7 Insert Order Items
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

  -- 3.8 Insert Automatic Notification
  INSERT INTO public.notifications (
    type, title, message, description, order_id, item_id, customer_phone, is_read
  )
  VALUES (
    'order',
    '📦 New ' || UPPER(v_order.order_type) || ' Order #' || v_order.order_number,
    'Order received for ₹' || v_order.total_amount || ' from ' || v_order.customer_name,
    'Order received for ₹' || v_order.total_amount || ' from ' || v_order.customer_name,
    v_order.id,
    'order-' || v_order.id,
    v_order.customer_phone,
    false
  );

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'customer_name', v_order.customer_name,
    'customer_phone', v_order.customer_phone,
    'total_amount', v_order.total_amount,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'ticket_status', v_order.ticket_status,
    'idempotent_replay', false,
    'created_at', v_order.created_at
  );
END;
$$;

-- 4. ATOMIC ORDER INVENTORY DEDUCTION RPC
-- Prevents double stock deductions using idempotency tracking on stock_logs
-- and protects stock balances against concurrent orders with row-level locking (FOR UPDATE).
CREATE OR REPLACE FUNCTION public.deduct_order_inventory_atomic(
  p_order_id uuid,
  p_order_number integer,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_qty numeric;
  v_name text;
  v_stk public.stock_items%ROWTYPE;
  v_deducted_count integer := 0;
  v_already_logged boolean := false;
BEGIN
  -- 4.1 Idempotency Check: Prevent duplicate deductions for the same order
  SELECT EXISTS (
    SELECT 1 FROM public.stock_logs
    WHERE action = 'ORDER_DEDUCT'
      AND details ILIKE '%Order #' || p_order_number || '%'
  ) INTO v_already_logged;

  IF v_already_logged THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_deducted', true,
      'message', 'Inventory was already deducted for Order #' || p_order_number
    );
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', true, 'deducted_count', 0);
  END IF;

  -- 4.2 Deduct each item atomically with row-level locking
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1));
    v_name := trim(COALESCE(v_item->>'name', v_item->>'item_name', ''));

    IF v_name <> '' THEN
      -- Lock the stock_item row exclusively to prevent race conditions
      SELECT * INTO v_stk
      FROM public.stock_items
      WHERE lower(trim(name)) = lower(v_name)
      FOR UPDATE;

      IF FOUND THEN
        -- Atomic decrement with floor at zero
        UPDATE public.stock_items
        SET qty = GREATEST(0, (COALESCE(qty, 0) - v_qty)),
            updated_at = now()
        WHERE id = v_stk.id;

        -- Record audit log
        INSERT INTO public.stock_logs (
          id, action, details, created_at
        )
        VALUES (
          gen_random_uuid(),
          'ORDER_DEDUCT',
          v_stk.name || ' deducted ' || v_qty || ' ' || COALESCE(v_stk.unit, 'pcs') || ' for Order #' || p_order_number,
          now()
        );

        -- Record stock_out entry
        INSERT INTO public.stock_out (
          id, item_sku, item_name, unit, qty, date, used_by, notes, created_at
        )
        VALUES (
          gen_random_uuid()::text,
          v_stk.sku,
          v_stk.name,
          COALESCE(v_stk.unit, 'pcs'),
          v_qty,
          to_char(now(), 'DD-MM-YYYY'),
          'System Order Settlement',
          'Auto deduction for Order #' || p_order_number,
          now()
        );

        v_deducted_count := v_deducted_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'already_deducted', false,
    'deducted_count', v_deducted_count
  );
END;
$$;

-- 5. ATOMIC POS BILL SETTLEMENT RPC
-- Prevents two cashiers from settling the same order concurrently using row-level locking.
-- Enforces valid transition (OPEN/HOLD -> CLOSED, unpaid -> paid).
CREATE OR REPLACE FUNCTION public.settle_order_atomic(
  p_order_id uuid,
  p_payment_method text DEFAULT 'cash',
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_items jsonb;
  v_cashier_id uuid := auth.uid();
  v_clean_key text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  -- 5.1 RBAC Enforcement: Staff authorization required
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff credentials required to settle orders';
  END IF;

  -- 5.2 Lock the order row exclusively for update
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % does not exist', p_order_id;
  END IF;

  -- 5.3 Concurrency Protection: If already settled, check idempotency or reject
  IF v_order.ticket_status = 'CLOSED' AND v_order.payment_status = 'paid' THEN
    -- If same cashier/client is retrying with idempotency key, return existing settlement
    IF v_clean_key IS NOT NULL AND v_order.idempotency_key = v_clean_key THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'ticket_status', v_order.ticket_status,
        'total_amount', v_order.total_amount,
        'idempotent_replay', true,
        'message', 'Order already settled'
      );
    ELSE
      RAISE EXCEPTION 'ORDER_ALREADY_SETTLED: Order #% has already been settled and closed by another cashier.', v_order.order_number;
    END IF;
  END IF;

  -- 5.4 Update Order State Atomically
  UPDATE public.orders
  SET status = 'delivered',
      payment_status = 'paid',
      ticket_status = 'CLOSED',
      payment_method = COALESCE(p_payment_method, v_order.payment_method, 'cash'),
      idempotency_key = COALESCE(v_clean_key, v_order.idempotency_key),
      updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- 5.5 Record Payment Audit Log
  INSERT INTO public.payment_history (
    order_id, previous_status, new_status, change_reason, changed_by, created_at
  )
  VALUES (
    p_order_id,
    'unpaid',
    'paid',
    COALESCE(p_notes, 'POS Final Bill Settlement'),
    v_cashier_id,
    now()
  );

  -- 5.6 Fetch order items for inventory deduction
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', item_name,
      'quantity', quantity
    )
  ) INTO v_items
  FROM public.order_items
  WHERE order_id = p_order_id;

  -- 5.7 Trigger Atomic Inventory Deduction
  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    PERFORM public.deduct_order_inventory_atomic(p_order_id, v_order.order_number, v_items);
  END IF;

  -- 5.8 Enqueue External Side Effect (Google Sheets Sync) into Outbox Queue
  INSERT INTO public.sync_queue (
    entity_type, entity_id, payload, status, created_at, updated_at
  )
  VALUES (
    'google_sheet',
    v_order.id::text,
    jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'total_amount', v_order.total_amount,
      'order_type', v_order.order_type,
      'payment_method', v_order.payment_method,
      'table_number', v_order.table_number,
      'customer_name', v_order.customer_name,
      'customer_phone', v_order.customer_phone,
      'settled_at', now()
    ),
    'pending',
    now(),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'ticket_status', v_order.ticket_status,
    'total_amount', v_order.total_amount,
    'idempotent_replay', false,
    'message', 'Order settled and closed successfully'
  );
END;
$$;

-- Grant permissions on new RPCs
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, numeric, numeric, text, text, boolean, text, integer, text, text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.deduct_order_inventory_atomic(uuid, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_order_atomic(uuid, text, text, text) TO authenticated;
