-- Let customers look up their own bookings by phone (public website)

CREATE OR REPLACE FUNCTION public.get_customer_bookings(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        booking_number,
        type,
        customer_name,
        booking_date,
        booking_time,
        guests,
        seat_label,
        status,
        created_at
      FROM bookings
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

CREATE OR REPLACE FUNCTION public.get_customer_orders(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        (
          SELECT jsonb_agg(jsonb_build_object(
            'item_name', oi.item_name,
            'quantity', oi.quantity,
            'line_total', oi.line_total
          ) ORDER BY oi.item_name)
          FROM order_items oi
          WHERE oi.order_id = o.id
        ) AS items
      FROM orders o
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
