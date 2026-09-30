-- Upgrade public.orders and public.customer_profiles with map location and delivery geocode columns
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS landmark TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_notes TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS location_verified BOOLEAN DEFAULT false;

ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS landmark TEXT;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS delivery_notes TEXT;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS location_verified BOOLEAN DEFAULT false;

-- Recreate place_order with coordinate columns
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
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, numeric, numeric, text, text, boolean) TO anon, authenticated;

-- Recreate get_customer_orders to return coordinate columns
CREATE OR REPLACE FUNCTION public.get_customer_orders(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

GRANT EXECUTE ON FUNCTION public.get_customer_orders(text) TO anon, authenticated;
