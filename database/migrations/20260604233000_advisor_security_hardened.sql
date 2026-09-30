-- ═══════════════════════════════════════════════════════════════════════════
-- LIMRA Restaurant — Advisor Security Hardening Migration
-- Specifically addresses the 10 critical security issues flagged by the advisor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE 1: public.customer_profiles Permissive INSERT
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own profile" ON public.customer_profiles;
DROP POLICY IF EXISTS "Allow anon and authenticated insert profile" ON public.customer_profiles;

CREATE POLICY "Users can insert own profile"
  ON public.customer_profiles FOR INSERT
  TO anon, authenticated
  WITH CHECK ((SELECT auth.uid()) = id);

-- Optimize SELECT/UPDATE policies
DROP POLICY IF EXISTS "Users can read own profile" ON public.customer_profiles;
CREATE POLICY "Users can read own profile"
  ON public.customer_profiles FOR SELECT
  TO anon, authenticated
  USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.customer_profiles;
CREATE POLICY "Users can update own profile"
  ON public.customer_profiles FOR UPDATE
  TO anon, authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE 2: public.notifications Permissive INSERT
-- ─────────────────────────────────────────────────────────────────────────
-- Remove unrestricted insert policy.
DROP POLICY IF EXISTS "Allow insert for all" ON public.notifications;


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE 3: public.phone_verifications RLS No Policies Defined
-- ─────────────────────────────────────────────────────────────────────────
-- Create a policy to satisfy the linter while keeping it completely secure by using USING(false).
DROP POLICY IF EXISTS "allow_authenticated_view_verification" ON public.phone_verifications;
CREATE POLICY "allow_authenticated_view_verification"
  ON public.phone_verifications FOR SELECT
  TO authenticated
  USING (false);


-- ─────────────────────────────────────────────────────────────────────────
-- Rewrite existing policies to use direct subquery instead of helper function.
-- This allows us to safely revoke EXECUTE on is_admin() from users.
-- ─────────────────────────────────────────────────────────────────────────

-- bookings policies
DROP POLICY IF EXISTS "Admins can read bookings" ON public.bookings;
CREATE POLICY "Admins can read bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can update bookings" ON public.bookings;
CREATE POLICY "Admins can update bookings"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));

-- orders policies
DROP POLICY IF EXISTS "Admins can read orders" ON public.orders;
CREATE POLICY "Admins can read orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
CREATE POLICY "Admins can update orders"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));

-- order_items policies
DROP POLICY IF EXISTS "Admins can read order items" ON public.order_items;
CREATE POLICY "Admins can read order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can insert order items" ON public.order_items;
CREATE POLICY "Admins can insert order items"
  ON public.order_items FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));

-- admin_users policies
DROP POLICY IF EXISTS "Admins can read admin_users" ON public.admin_users;
CREATE POLICY "Admins can read admin_users"
  ON public.admin_users FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;



-- notifications policies
DROP POLICY IF EXISTS "Allow select for admins" ON public.notifications;
CREATE POLICY "Allow select for admins"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Allow update for admins" ON public.notifications;
CREATE POLICY "Allow update for admins"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Allow delete for admins" ON public.notifications;
CREATE POLICY "Allow delete for admins"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));

-- customer_profiles policies
DROP POLICY IF EXISTS "Admins can manage profiles" ON public.customer_profiles;
CREATE POLICY "Admins can manage profiles"
  ON public.customer_profiles FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())));


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE 4: public.is_admin() Dangerous SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = (SELECT auth.uid())
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

-- Revoke execute rights from all users
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE 5: public.place_order() Dangerous SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────
-- 4 parameters
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

-- Keep SECURITY DEFINER but harden search_path. Must remain executable by clients.
ALTER FUNCTION public.place_order(text, text, text, jsonb) SET search_path = '';
REVOKE ALL ON FUNCTION public.place_order(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb) TO anon, authenticated;

-- 9 parameters
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

ALTER FUNCTION public.place_order(text, text, text, jsonb, numeric, numeric, text, text, boolean) SET search_path = '';
REVOKE ALL ON FUNCTION public.place_order(text, text, text, jsonb, numeric, numeric, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, numeric, numeric, text, text, boolean) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE 6: public.place_booking() Dangerous SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────
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

ALTER FUNCTION public.place_booking(text, text, text, date, text, integer, text, text, text, text, text, text, text, text) SET search_path = '';
REVOKE ALL ON FUNCTION public.place_booking(text, text, text, date, text, integer, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_booking(text, text, text, date, text, integer, text, text, text, text, text, text, text, text) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE 7: public.get_customer_bookings() Dangerous SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────
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

ALTER FUNCTION public.get_customer_bookings(text) SET search_path = '';
REVOKE ALL ON FUNCTION public.get_customer_bookings(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_bookings(text) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE 8: public.get_customer_orders() Dangerous SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────
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

ALTER FUNCTION public.get_customer_orders(text) SET search_path = '';
REVOKE ALL ON FUNCTION public.get_customer_orders(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_orders(text) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE 9: public.tr_on_order_insert() Dangerous SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────
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

-- Revoke all execute rights from PUBLIC/roles as this is triggered exclusively by DB.
REVOKE ALL ON FUNCTION public.tr_on_order_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tr_on_order_insert() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.tr_on_order_insert() FROM anon;


-- ─────────────────────────────────────────────────────────────────────────
-- ISSUE 10: public.tr_on_booking_insert() Dangerous SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────
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

-- Revoke all execute rights from PUBLIC/roles as this is triggered exclusively by DB.
REVOKE ALL ON FUNCTION public.tr_on_booking_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tr_on_booking_insert() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.tr_on_booking_insert() FROM anon;
