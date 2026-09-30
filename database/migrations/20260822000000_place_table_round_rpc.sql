-- Migration: place_table_round RPC
-- SECURITY DEFINER function for multi-round table ordering.
-- Handles: session detection, round numbering, order insert, items insert, notification insert.
-- Must be SECURITY DEFINER — table client (anon) cannot write to orders/order_items/notifications directly (RLS-blocked).

CREATE OR REPLACE FUNCTION public.place_table_round(
  p_table_number   integer,
  p_table_zone     text    DEFAULT 'indoor',
  p_customer_name  text    DEFAULT 'Dine-in Guest',
  p_customer_phone text    DEFAULT '0000000000',
  p_items          jsonb   DEFAULT '[]'::jsonb,
  p_notes          text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_primary_order  public.orders%ROWTYPE;
  v_new_order      public.orders%ROWTYPE;
  v_item           jsonb;
  v_round_total    numeric   := 0;
  v_round_num      integer   := 2;
  v_max_round      integer   := 1;
  v_existing_count integer   := 0;
  v_round_notes    text;
  v_active_window  timestamptz := now() - interval '12 hours';
  v_notif_msg      text;
  v_dish_count     integer;
BEGIN
  -- Validate
  IF p_table_number IS NULL OR p_table_number < 1 THEN
    RAISE EXCEPTION 'Invalid table number';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  -- Compute subtotal
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_round_total := v_round_total + COALESCE((v_item->>'line_total')::numeric, 0);
  END LOOP;

  -- Find the oldest active order for this table (the primary / Round-1 order)
  SELECT o.*
    INTO v_primary_order
    FROM public.orders o
   WHERE o.order_type = 'table'
     AND o.table_number = p_table_number
     AND o.status IN ('pending', 'confirmed', 'preparing', 'ready', 'hold')
     AND o.created_at >= v_active_window
   ORDER BY o.created_at ASC
   LIMIT 1
     FOR UPDATE SKIP LOCKED;

  -- If no active session found, signal caller to use place_order instead
  IF NOT FOUND OR v_primary_order.id IS NULL THEN
    RAISE EXCEPTION 'NO_ACTIVE_SESSION';
  END IF;

  -- Count active orders and find the highest existing round number
  SELECT COUNT(*),
         COALESCE(MAX(
           CASE
             WHEN o.notes ~ '\[ROUND:\s*\d+\]'
             THEN (regexp_match(o.notes, '\[ROUND:\s*(\d+)\]'))[1]::integer
             ELSE 1
           END
         ), 1)
    INTO v_existing_count, v_max_round
    FROM public.orders o
   WHERE o.order_type = 'table'
     AND o.table_number = p_table_number
     AND o.status IN ('pending', 'confirmed', 'preparing', 'ready', 'hold')
     AND o.created_at >= v_active_window;

  -- Next round = max of (count+1, maxRound+1)
  v_round_num := GREATEST(v_existing_count + 1, v_max_round + 1);

  -- Build notes string
  v_round_notes := '[ROUND: ' || v_round_num
                || '] [PARENT_ORDER_ID: ' || v_primary_order.id
                || '] [TABLE: ' || p_table_number || ']';
  IF p_notes IS NOT NULL AND trim(p_notes) <> '' THEN
    v_round_notes := v_round_notes || ' ' || trim(p_notes);
  END IF;

  -- Insert the new round order (distinct entry, same order_number as primary)
  INSERT INTO public.orders (
    order_number,
    customer_name,   customer_phone,
    order_type,      table_number,   table_zone,
    total_amount,    status,         payment_status,
    notes
  )
  VALUES (
    v_primary_order.order_number,
    COALESCE(NULLIF(trim(p_customer_name), ''), v_primary_order.customer_name, 'Dine-in Guest'),
    COALESCE(NULLIF(trim(p_customer_phone), ''), v_primary_order.customer_phone, '0000000000'),
    'table',
    p_table_number,
    COALESCE(NULLIF(trim(p_table_zone), ''), v_primary_order.table_zone, 'indoor'),
    v_round_total,
    'pending',
    'unpaid',
    v_round_notes
  )
  RETURNING * INTO v_new_order;

  -- Insert order items
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.order_items (
      order_id, menu_item_id, item_name, quantity, unit_price, line_total
    )
    VALUES (
      v_new_order.id,
      CASE
        WHEN v_item ? 'menu_item_id' AND v_item->>'menu_item_id' IS NOT NULL
        THEN (v_item->>'menu_item_id')::integer
        ELSE NULL
      END,
      v_item->>'item_name',
      GREATEST((v_item->>'quantity')::integer, 1),
      (v_item->>'unit_price')::numeric,
      (v_item->>'line_total')::numeric
    );
  END LOOP;

  -- Insert staff notification
  v_dish_count := jsonb_array_length(p_items);
  v_notif_msg  := 'Table ' || p_table_number
               || ' placed Round ' || v_round_num
               || ' (' || v_dish_count || ' dish'
               || CASE WHEN v_dish_count > 1 THEN 'es' ELSE '' END || ')';

  INSERT INTO public.notifications (
    type, title, message, description,
    order_id, item_id, customer_phone, is_read
  )
  VALUES (
    'order',
    chr(127869) || chr(65039) || ' Table ' || p_table_number || ' - Round ' || v_round_num,
    v_notif_msg,
    v_notif_msg,
    v_new_order.id,
    v_new_order.id,
    v_primary_order.customer_phone,
    false
  );

  RETURN jsonb_build_object(
    'id',                  v_new_order.id,
    'order_number',        v_new_order.order_number,
    'total_amount',        v_new_order.total_amount,
    'status',              v_new_order.status,
    'round_number',        v_round_num,
    'parent_order_id',     v_primary_order.id,
    'is_subsequent_round', true
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.place_table_round(integer, text, text, text, jsonb, text) TO anon, authenticated;
