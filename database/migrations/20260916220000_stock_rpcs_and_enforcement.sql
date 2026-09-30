-- Migration: 20260916220000_stock_rpcs_and_enforcement.sql
-- Stock management RPCs: negative stock prevention, stock in/out logging, and daily summary computation.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RECORD STOCK OUT (WITH HARD BALANCE CHECK)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_stock_out(
  p_item_id text,
  p_qty numeric,
  p_reason text DEFAULT 'Kitchen Prep',
  p_used_by text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_allow_negative boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.stock_items%ROWTYPE;
  v_new_qty numeric;
  v_out_id text := 'out_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 4);
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

  -- Lock item row for update to prevent concurrent race conditions
  SELECT * INTO v_item
  FROM public.stock_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock item not found';
  END IF;

  -- Hard balance validation
  IF (COALESCE(v_item.qty, 0) - p_qty) < 0 THEN
    IF NOT p_allow_negative THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: Available balance is % %, cannot deduct % % without authorized override.',
        COALESCE(v_item.qty, 0), COALESCE(v_item.unit, 'pcs'), p_qty, COALESCE(v_item.unit, 'pcs');
    ELSE
      v_is_override := true;
    END IF;
  END IF;

  v_new_qty := COALESCE(v_item.qty, 0) - p_qty;

  -- Update item quantity
  UPDATE public.stock_items
  SET qty = v_new_qty,
      updated_at = now()
  WHERE id = p_item_id;

  -- Insert stock_out entry
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

  -- Log action
  v_details := 'Deducted ' || p_qty || ' ' || COALESCE(v_item.unit, 'pcs') || ' of ' || v_item.name
            || ' (Reason: ' || COALESCE(p_reason, 'Kitchen Prep') || ', Balance: ' || v_new_qty || ')';
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

GRANT EXECUTE ON FUNCTION public.record_stock_out(text, numeric, text, text, text, boolean) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RECORD STOCK IN
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_stock_in(
  p_item_id text,
  p_qty numeric,
  p_cost_price numeric DEFAULT NULL,
  p_supplier text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.stock_items%ROWTYPE;
  v_new_qty numeric;
  v_in_id text := 'in_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 4);
  v_log_id text := 'log_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 4);
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'Item ID is required';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Stock in quantity must be greater than 0';
  END IF;

  SELECT * INTO v_item
  FROM public.stock_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock item not found';
  END IF;

  v_new_qty := COALESCE(v_item.qty, 0) + p_qty;

  -- Update item quantity & optionally cost price
  UPDATE public.stock_items
  SET qty = v_new_qty,
      cost_price = COALESCE(p_cost_price, v_item.cost_price),
      supplier = COALESCE(NULLIF(trim(p_supplier), ''), v_item.supplier),
      updated_at = now()
  WHERE id = p_item_id;

  -- Insert stock_in entry
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

  -- Log action
  INSERT INTO public.stock_logs (
    id, action, details, created_at
  )
  VALUES (
    v_log_id,
    'STOCK_IN',
    'Added ' || p_qty || ' ' || COALESCE(v_item.unit, 'pcs') || ' of ' || v_item.name
    || ' (New Balance: ' || v_new_qty || ')',
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'item_id', v_item.id,
    'item_name', v_item.name,
    'previous_qty', v_item.qty,
    'added_qty', p_qty,
    'new_qty', v_new_qty,
    'unit', v_item.unit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_stock_in(text, numeric, numeric, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. COMPUTED DAILY STOCK SUMMARY RPC
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_stock_daily_summary(
  p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_start_of_day timestamptz := p_date::timestamptz;
  v_end_of_day   timestamptz := (p_date + interval '1 day')::timestamptz;
  v_total_items  integer := 0;
  v_low_stock    integer := 0;
  v_in_today     numeric := 0;
  v_out_today    numeric := 0;
  v_current_total numeric := 0;
  v_opening_total numeric := 0;
BEGIN
  -- Total items and current balance sum
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE COALESCE(qty, 0) <= COALESCE(min_qty, 5)),
         COALESCE(SUM(COALESCE(qty, 0)), 0)
    INTO v_total_items, v_low_stock, v_current_total
    FROM public.stock_items;

  -- Stock in today
  SELECT COALESCE(SUM(COALESCE(qty, 0)), 0)
    INTO v_in_today
    FROM public.stock_in
   WHERE created_at >= v_start_of_day AND created_at < v_end_of_day;

  -- Stock out today
  SELECT COALESCE(SUM(COALESCE(qty, 0)), 0)
    INTO v_out_today
    FROM public.stock_out
   WHERE created_at >= v_start_of_day AND created_at < v_end_of_day;

  -- Calculated opening balance = current - in_today + out_today
  v_opening_total := v_current_total - v_in_today + v_out_today;

  RETURN jsonb_build_object(
    'date',             p_date,
    'total_items',      v_total_items,
    'low_stock_count',  v_low_stock,
    'opening_balance',  v_opening_total,
    'stock_in_today',   v_in_today,
    'stock_out_today',  v_out_today,
    'adjustments',      0,
    'current_balance',  v_current_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_stock_daily_summary(date) TO anon, authenticated;
