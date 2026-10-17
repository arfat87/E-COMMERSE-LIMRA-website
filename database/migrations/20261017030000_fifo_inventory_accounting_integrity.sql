-- Migration: 20261017030000_fifo_inventory_accounting_integrity.sql
-- FIFO Inventory Accounting Integrity: Idempotent Stock Movements,
-- Reversal Audit Trails, Negative Deficit Controls, and Relational Synchronization.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RECORD STOCK IN (IDEMPOTENT & AUDITABLE)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_stock_in(
  p_item_id text,
  p_qty numeric,
  p_cost_price numeric DEFAULT NULL,
  p_supplier text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_entry_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.stock_items%ROWTYPE;
  v_new_qty numeric;
  v_in_id text := COALESCE(NULLIF(trim(p_entry_id), ''), 'in_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 4));
  v_log_id text := 'log_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 4);
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'Item ID is required';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Stock in quantity must be greater than 0';
  END IF;
  IF p_cost_price IS NOT NULL AND p_cost_price <= 0 THEN
    RAISE EXCEPTION 'Purchase rate / cost price must be greater than 0';
  END IF;

  -- 1. Idempotency Check: Return existing record if already committed
  IF p_entry_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.stock_in WHERE id = p_entry_id) THEN
      SELECT * INTO v_item FROM public.stock_items WHERE id = p_item_id;
      RETURN jsonb_build_object(
        'success', true,
        'idempotent_replay', true,
        'entry_id', p_entry_id,
        'item_id', v_item.id,
        'item_name', v_item.name,
        'current_qty', v_item.qty,
        'unit', v_item.unit
      );
    END IF;
  END IF;

  -- 2. Lock item row for update to prevent concurrent race conditions
  SELECT * INTO v_item
  FROM public.stock_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock item not found: %', p_item_id;
  END IF;

  v_new_qty := COALESCE(v_item.qty, 0) + p_qty;

  -- 3. Update master item record
  UPDATE public.stock_items
  SET qty = v_new_qty,
      cost_price = COALESCE(p_cost_price, v_item.cost_price),
      supplier = COALESCE(NULLIF(trim(p_supplier), ''), v_item.supplier),
      updated_at = now()
  WHERE id = p_item_id;

  -- 4. Insert into stock_in ledger
  INSERT INTO public.stock_in (
    id, item_id, item_sku, item_name, unit, qty, cost_price, supplier, date, notes, created_at
  )
  VALUES (
    v_in_id,
    v_item.id,
    COALESCE(v_item.sku, ''),
    v_item.name,
    COALESCE(v_item.unit, 'pcs'),
    p_qty,
    COALESCE(p_cost_price, v_item.cost_price, 0),
    COALESCE(p_supplier, v_item.supplier, ''),
    to_char(now(), 'YYYY-MM-DD'),
    p_notes,
    now()
  );

  -- 5. Append auditable log entry
  INSERT INTO public.stock_logs (
    id, action, details, created_at
  )
  VALUES (
    v_log_id,
    'STOCK_IN',
    'Added ' || p_qty || ' ' || COALESCE(v_item.unit, 'pcs') || ' of ' || v_item.name
    || ' @ ₹' || COALESCE(p_cost_price, v_item.cost_price, 0)
    || ' (New Balance: ' || v_new_qty || ', Entry: ' || v_in_id || ')',
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_in_id,
    'item_id', v_item.id,
    'item_name', v_item.name,
    'previous_qty', v_item.qty,
    'added_qty', p_qty,
    'new_qty', v_new_qty,
    'unit', v_item.unit,
    'cost_price', COALESCE(p_cost_price, v_item.cost_price, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_stock_in(text, numeric, numeric, text, text, text) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RECORD STOCK OUT (IDEMPOTENT & AUDITABLE)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_stock_out(
  p_item_id text,
  p_qty numeric,
  p_reason text DEFAULT 'Kitchen Prep',
  p_used_by text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_allow_negative boolean DEFAULT false,
  p_entry_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.stock_items%ROWTYPE;
  v_new_qty numeric;
  v_out_id text := COALESCE(NULLIF(trim(p_entry_id), ''), 'out_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 4));
  v_log_id text := 'log_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 4);
  v_is_override boolean := false;
  v_details text;
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'Item ID is required';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Stock out quantity must be greater than 0';
  END IF;

  -- 1. Idempotency Check: Return existing record if already committed
  IF p_entry_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.stock_out WHERE id = p_entry_id) THEN
      SELECT * INTO v_item FROM public.stock_items WHERE id = p_item_id;
      RETURN jsonb_build_object(
        'success', true,
        'idempotent_replay', true,
        'entry_id', p_entry_id,
        'item_id', v_item.id,
        'item_name', v_item.name,
        'current_qty', v_item.qty,
        'unit', v_item.unit
      );
    END IF;
  END IF;

  -- 2. Lock item row for update to prevent concurrent race conditions
  SELECT * INTO v_item
  FROM public.stock_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock item not found: %', p_item_id;
  END IF;

  -- 3. Hard balance validation
  IF (COALESCE(v_item.qty, 0) - p_qty) < 0 THEN
    IF NOT p_allow_negative THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: Available balance is % %, cannot deduct % % without authorized override.',
        COALESCE(v_item.qty, 0), COALESCE(v_item.unit, 'pcs'), p_qty, COALESCE(v_item.unit, 'pcs');
    ELSE
      v_is_override := true;
    END IF;
  END IF;

  v_new_qty := COALESCE(v_item.qty, 0) - p_qty;

  -- 4. Update item quantity
  UPDATE public.stock_items
  SET qty = v_new_qty,
      updated_at = now()
  WHERE id = p_item_id;

  -- 5. Insert into stock_out ledger
  INSERT INTO public.stock_out (
    id, item_id, item_sku, item_name, unit, qty, date, used_by, notes, created_at
  )
  VALUES (
    v_out_id,
    v_item.id,
    COALESCE(v_item.sku, ''),
    v_item.name,
    COALESCE(v_item.unit, 'pcs'),
    p_qty,
    to_char(now(), 'YYYY-MM-DD'),
    COALESCE(p_used_by, 'Kitchen Staff'),
    p_notes,
    now()
  );

  -- 6. Append auditable log entry
  v_details := 'Deducted ' || p_qty || ' ' || COALESCE(v_item.unit, 'pcs') || ' of ' || v_item.name
            || ' (Reason: ' || COALESCE(p_reason, 'Kitchen Prep') || ', Balance: ' || v_new_qty || ', Entry: ' || v_out_id || ')';
  IF v_is_override THEN
    v_details := '[OVERRIDE: Negative Stock Allowed] ' || v_details;
  END IF;

  INSERT INTO public.stock_logs (
    id, action, details, created_at
  )
  VALUES (
    v_log_id,
    CASE WHEN v_is_override THEN 'STOCK_OUT_OVERRIDE' ELSE 'STOCK_OUT' END,
    v_details,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_out_id,
    'item_id', v_item.id,
    'item_name', v_item.name,
    'previous_qty', v_item.qty,
    'deducted_qty', p_qty,
    'new_qty', v_new_qty,
    'unit', v_item.unit,
    'is_override', v_is_override
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_stock_out(text, numeric, text, text, text, boolean, text) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. REVERSE STOCK ENTRY (ATOMIC AUDITABLE REVERSAL)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reverse_stock_entry(
  p_type text,
  p_entry_id text,
  p_reason text DEFAULT 'User manual correction'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_in public.stock_in%ROWTYPE;
  v_out public.stock_out%ROWTYPE;
  v_item public.stock_items%ROWTYPE;
  v_new_qty numeric;
  v_log_id text := 'log_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 4);
BEGIN
  IF p_type IS NULL OR (lower(trim(p_type)) NOT IN ('in', 'out')) THEN
    RAISE EXCEPTION 'Invalid entry type. Must be "IN" or "OUT".';
  END IF;
  IF p_entry_id IS NULL OR trim(p_entry_id) = '' THEN
    RAISE EXCEPTION 'Entry ID is required for reversal.';
  END IF;

  IF upper(trim(p_type)) = 'IN' THEN
    SELECT * INTO v_in FROM public.stock_in WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock IN entry "%" not found.', p_entry_id;
    END IF;

    -- Find and lock stock item
    SELECT * INTO v_item FROM public.stock_items
    WHERE id = v_in.item_id OR (v_in.item_sku IS NOT NULL AND sku = v_in.item_sku)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock item not found for reversed entry.';
    END IF;

    v_new_qty := GREATEST(0, COALESCE(v_item.qty, 0) - v_in.qty);

    UPDATE public.stock_items
    SET qty = v_new_qty,
        updated_at = now()
    WHERE id = v_item.id;

    DELETE FROM public.stock_in WHERE id = p_entry_id;

    INSERT INTO public.stock_logs (
      id, action, details, created_at
    )
    VALUES (
      v_log_id,
      'STOCK_IN_REVERSED',
      'Reversed Stock IN of ' || v_in.qty || ' ' || COALESCE(v_in.unit, 'pcs') || ' for ' || v_item.name
      || ' (Reason: ' || COALESCE(p_reason, 'Correction') || ', New Balance: ' || v_new_qty || ', Deleted Entry: ' || p_entry_id || ')',
      now()
    );

    RETURN jsonb_build_object(
      'success', true,
      'type', 'IN',
      'entry_id', p_entry_id,
      'item_id', v_item.id,
      'reversed_qty', v_in.qty,
      'new_qty', v_new_qty
    );

  ELSE
    SELECT * INTO v_out FROM public.stock_out WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock OUT entry "%" not found.', p_entry_id;
    END IF;

    -- Find and lock stock item
    SELECT * INTO v_item FROM public.stock_items
    WHERE id = v_out.item_id OR (v_out.item_sku IS NOT NULL AND sku = v_out.item_sku)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock item not found for reversed entry.';
    END IF;

    v_new_qty := COALESCE(v_item.qty, 0) + v_out.qty;

    UPDATE public.stock_items
    SET qty = v_new_qty,
        updated_at = now()
    WHERE id = v_item.id;

    DELETE FROM public.stock_out WHERE id = p_entry_id;

    INSERT INTO public.stock_logs (
      id, action, details, created_at
    )
    VALUES (
      v_log_id,
      'STOCK_OUT_REVERSED',
      'Reversed Stock OUT of ' || v_out.qty || ' ' || COALESCE(v_out.unit, 'pcs') || ' for ' || v_item.name
      || ' (Reason: ' || COALESCE(p_reason, 'Correction') || ', New Balance: ' || v_new_qty || ', Deleted Entry: ' || p_entry_id || ')',
      now()
    );

    RETURN jsonb_build_object(
      'success', true,
      'type', 'OUT',
      'entry_id', p_entry_id,
      'item_id', v_item.id,
      'reversed_qty', v_out.qty,
      'new_qty', v_new_qty
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_stock_entry(text, text, text) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FIX DEDUCT_ORDER_INVENTORY_ATOMIC TO POPULATE ITEM_ID
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- Idempotency Check: Prevent duplicate deductions for the same order
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

  -- Deduct each item atomically with row-level locking
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1));
    v_name := trim(COALESCE(v_item->>'name', v_item->>'item_name', ''));

    IF v_name <> '' THEN
      SELECT * INTO v_stk
      FROM public.stock_items
      WHERE lower(trim(name)) = lower(v_name)
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.stock_items
        SET qty = GREATEST(0, (COALESCE(qty, 0) - v_qty)),
            updated_at = now()
        WHERE id = v_stk.id;

        INSERT INTO public.stock_logs (
          id, action, details, created_at
        )
        VALUES (
          gen_random_uuid(),
          'ORDER_DEDUCT',
          v_stk.name || ' deducted ' || v_qty || ' ' || COALESCE(v_stk.unit, 'pcs') || ' for Order #' || p_order_number,
          now()
        );

        INSERT INTO public.stock_out (
          id, item_id, item_sku, item_name, unit, qty, date, used_by, notes, created_at
        )
        VALUES (
          gen_random_uuid()::text,
          v_stk.id,
          v_stk.sku,
          v_stk.name,
          COALESCE(v_stk.unit, 'pcs'),
          v_qty,
          to_char(now(), 'YYYY-MM-DD'),
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
    'order_id', p_order_id,
    'order_number', p_order_number,
    'deducted_count', v_deducted_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_order_inventory_atomic(uuid, integer, jsonb) TO authenticated, service_role;
