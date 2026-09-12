-- ═══════════════════════════════════════════════════════════════════════════
-- LIMRA Restaurant — Phase 3 Security Hardening Migration
-- Harden Orders, Order Items, Bookings, Notifications & Customer Profiles
-- Eliminates remaining "Public full access" permissive policies
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ORDERS & ORDER ITEMS
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1 orders (Public read for tracking/realtime, only admins can update/delete/POS-insert)
DROP POLICY IF EXISTS "Public full access orders" ON public.orders;
DROP POLICY IF EXISTS "Public can view orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can manage orders" ON public.orders;
DROP POLICY IF EXISTS "Users can read own orders" ON public.orders;

CREATE POLICY "Public can view orders"
  ON public.orders FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage orders"
  ON public.orders FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 1.2 order_items (Public read for display, only admins can directly modify/insert)
DROP POLICY IF EXISTS "Public full access order_items" ON public.order_items;
DROP POLICY IF EXISTS "Public can view order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins can manage order items" ON public.order_items;

CREATE POLICY "Public can view order items"
  ON public.order_items FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage order items"
  ON public.order_items FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BOOKINGS
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1 bookings (Admins full access, authenticated users view own, RPCs handle guest placement)
DROP POLICY IF EXISTS "Public full access bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins can manage bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can read own bookings" ON public.bookings;

CREATE POLICY "Admins can manage bookings"
  ON public.bookings FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Users can read own bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 notifications (Admins full access, authenticated users view/update own)
DROP POLICY IF EXISTS "Public full access notifications" ON public.notifications;
DROP POLICY IF EXISTS "Admins can manage notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;

CREATE POLICY "Admins can manage notifications"
  ON public.notifications FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Users can read own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CUSTOMER PROFILES
-- ─────────────────────────────────────────────────────────────────────────────

-- 4.1 customer_profiles (Admins full access, authenticated users manage their own profile)
DROP POLICY IF EXISTS "Public full access customer_profiles" ON public.customer_profiles;
DROP POLICY IF EXISTS "Admins can manage customer profiles" ON public.customer_profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.customer_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.customer_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.customer_profiles;

CREATE POLICY "Admins can manage customer profiles"
  ON public.customer_profiles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Users can view own profile"
  ON public.customer_profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON public.customer_profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON public.customer_profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
