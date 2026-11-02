-- =============================================================================
-- MIGRATION: 20261017090000_normalize_orders_financial_lifecycle.sql
-- DESCRIPTION: Normalize Financial & Order Lifecycle Data on public.orders
-- TASK: 5.1 (Remediates Fragile Regex Note Metadata & Historical Tax Rate Drift)
-- =============================================================================

-- 1. Ensure public.orders contains structured financial & lifecycle columns
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS packaging_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS round_off_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS consolidated_into_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;

-- 2. Domain constraints on financial columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_subtotal') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_subtotal CHECK (subtotal_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_discount_pct') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_discount_pct CHECK (discount_pct >= 0 AND discount_pct <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_discount_amount') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_discount_amount CHECK (discount_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_taxable_amount') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_taxable_amount CHECK (taxable_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_cgst_amount') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_cgst_amount CHECK (cgst_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_sgst_amount') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_sgst_amount CHECK (sgst_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_delivery_fee') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_delivery_fee CHECK (delivery_fee >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_packaging_fee') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_packaging_fee CHECK (packaging_fee >= 0);
  END IF;
END $$;

-- 3. Performance indexes on lookup and reporting paths
CREATE INDEX IF NOT EXISTS idx_orders_settled_at ON public.orders(settled_at DESC) WHERE settled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_consolidated_into ON public.orders(consolidated_into_order_id) WHERE consolidated_into_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_taxable_amount ON public.orders(taxable_amount) WHERE taxable_amount > 0;

-- 4. Safe backward-compatible data backfill for legacy rows
-- Backfill settled_at for paid/closed orders where missing
UPDATE public.orders
SET settled_at = updated_at
WHERE (ticket_status = 'CLOSED' OR payment_status = 'paid')
  AND settled_at IS NULL;

-- Backfill consolidated_into_order_id from notes regex tags
UPDATE public.orders
SET consolidated_into_order_id = (regexp_match(notes, '\[PARENT_ORDER_ID:\s*([0-9a-fA-F-]+)\]'))[1]::uuid
WHERE consolidated_into_order_id IS NULL
  AND notes ~ '\[PARENT_ORDER_ID:\s*([0-9a-fA-F-]+)\]';

-- 5. Update settle_order_atomic to automatically timestamp settled_at
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
  v_prev_pay_status text;
  v_items jsonb;
  v_inv_result jsonb := jsonb_build_object('success', true, 'already_deducted', false, 'deducted_count', 0);
  v_cashier_id uuid := auth.uid();
  v_clean_key text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_clean_method text := lower(trim(COALESCE(NULLIF(trim(COALESCE(p_payment_method, '')), ''), 'cash')));
  v_history_inserted boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff credentials required to settle orders';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % does not exist', p_order_id;
  END IF;

  IF v_order.status = 'cancelled' OR v_order.ticket_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'ORDER_CANCELLED: Order #% is cancelled and cannot be settled.', v_order.order_number;
  END IF;

  IF v_order.ticket_status = 'CLOSED' AND v_order.payment_status = 'paid' THEN
    IF v_clean_key IS NOT NULL AND v_order.idempotency_key = v_clean_key THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'ticket_status', v_order.ticket_status,
        'payment_method', v_order.payment_method,
        'total_amount', v_order.total_amount,
        'settled_at', v_order.settled_at,
        'idempotent_replay', true,
        'message', 'Order already settled'
      );
    ELSE
      RAISE EXCEPTION 'ORDER_ALREADY_SETTLED: Order #% has already been settled and closed by another cashier.', v_order.order_number;
    END IF;
  END IF;

  v_prev_pay_status := COALESCE(v_order.payment_status, 'unpaid');
  IF v_clean_method = 'online' THEN
    v_clean_method := 'upi';
  END IF;

  -- 1. Update Order Settlement, Payment Status & settled_at Atomically
  UPDATE public.orders
  SET status = 'delivered',
      payment_status = 'paid',
      ticket_status = 'CLOSED',
      payment_method = COALESCE(v_clean_method, v_order.payment_method, 'cash'),
      notes = COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), v_order.notes),
      idempotency_key = COALESCE(v_clean_key, v_order.idempotency_key),
      settled_at = COALESCE(v_order.settled_at, now()),
      updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- 2. Insert Payment History (Idempotent per order)
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_history
    WHERE order_id = p_order_id
      AND new_status = 'paid'
  ) THEN
    INSERT INTO public.payment_history (
      order_id, user_id, previous_status, new_status, changed_by, notes, reason, created_at
    )
    VALUES (
      p_order_id,
      v_cashier_id,
      v_prev_pay_status,
      'paid',
      COALESCE(v_cashier_id::text, 'pos_cashier'),
      COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), 'POS Final Bill Settlement (' || UPPER(v_order.payment_method) || ')'),
      'POS Final Bill Settlement (' || UPPER(v_order.payment_method) || ')',
      now()
    );
    v_history_inserted := true;
  END IF;

  -- 3. Deduct Required Inventory Atomically (Idempotent per order)
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', item_name,
      'quantity', quantity
    )
  ) INTO v_items
  FROM public.order_items
  WHERE order_id = p_order_id;

  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    v_inv_result := public.deduct_order_inventory_atomic(p_order_id, v_order.order_number, v_items);
  END IF;

  -- 4. Enqueue Outbox Sync (Idempotent per order settlement)
  IF NOT EXISTS (
    SELECT 1 FROM public.sync_queue
    WHERE entity_type = 'google_sheet'
      AND entity_id = v_order.id::text
  ) THEN
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
        'settled_at', v_order.settled_at
      ),
      'pending',
      now(),
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'ticket_status', v_order.ticket_status,
    'payment_method', v_order.payment_method,
    'total_amount', v_order.total_amount,
    'settled_at', v_order.settled_at,
    'payment_history_logged', v_history_inserted,
    'inventory_deduction', v_inv_result,
    'idempotent_replay', false
  );
END;
$$;
