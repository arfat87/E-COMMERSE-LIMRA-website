-- ═══════════════════════════════════════════════════════════════════════════
-- LIMRA Restaurant — Row-Level Security Policy Qualification Migration
-- Qualifies all admin policy expressions to use public.is_admin() to prevent
-- search_path hijacking.
-- ═══════════════════════════════════════════════════════════════════════════

-- Ensure execute permissions on public.is_admin() are granted so policies evaluate successfully.
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- 1. admin_users policies
DROP POLICY IF EXISTS "Admins can read admin_users" ON public.admin_users;
CREATE POLICY "Admins can read admin_users"
  ON public.admin_users FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- 2. bookings policies
DROP POLICY IF EXISTS "Admins can read bookings" ON public.bookings;
CREATE POLICY "Admins can read bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update bookings" ON public.bookings;
CREATE POLICY "Admins can update bookings"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3. customer_profiles policies
DROP POLICY IF EXISTS "Admins can manage profiles" ON public.customer_profiles;
CREATE POLICY "Admins can manage profiles"
  ON public.customer_profiles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 4. notifications policies
DROP POLICY IF EXISTS "Admins can insert notifications" ON public.notifications;
CREATE POLICY "Admins can insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Allow select for admins" ON public.notifications;
CREATE POLICY "Allow select for admins"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Allow update for admins" ON public.notifications;
CREATE POLICY "Allow update for admins"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Allow delete for admins" ON public.notifications;
CREATE POLICY "Allow delete for admins"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 5. order_items policies
DROP POLICY IF EXISTS "Admins can read order items" ON public.order_items;
CREATE POLICY "Admins can read order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert order items" ON public.order_items;
CREATE POLICY "Admins can insert order items"
  ON public.order_items FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- 6. orders policies
DROP POLICY IF EXISTS "Admins can read orders" ON public.orders;
CREATE POLICY "Admins can read orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
CREATE POLICY "Admins can update orders"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 7. payment_history policies
DROP POLICY IF EXISTS "Admins can insert payment history" ON public.payment_history;
CREATE POLICY "Admins can insert payment history"
  ON public.payment_history FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can select payment history" ON public.payment_history;
CREATE POLICY "Admins can select payment history"
  ON public.payment_history FOR SELECT
  TO authenticated
  USING (public.is_admin());
