-- Migration: append_to_table_order RPC function
-- Safely appends new items to an active table order without creating duplicate orders or notifications

CREATE OR REPLACE FUNCTION public.append_to_table_order(
  p_order_id uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_additional_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS \$\$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item jsonb;
  v_added_total numeric := 0;
  v_new_notes text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Items list is empty';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_added_total := v_added_total + COALESCE((v_item->>'line_total')::numeric, 0);
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

  v_new_notes := v_order.notes;
  IF p_additional_notes IS NOT NULL AND trim(p_additional_notes) <> '' THEN
    v_new_notes := COALESCE(v_new_notes || ' | ', '') || trim(p_additional_notes);
  END IF;

  UPDATE public.orders
  SET total_amount = total_amount + v_added_total,
      notes = v_new_notes,
      updated_at = now()
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'total_amount', v_order.total_amount,
    'status', v_order.status,
    'is_appended', true
  );
END;
\$\$;

GRANT EXECUTE ON FUNCTION public.append_to_table_order(uuid, jsonb, text) TO anon, authenticated;
