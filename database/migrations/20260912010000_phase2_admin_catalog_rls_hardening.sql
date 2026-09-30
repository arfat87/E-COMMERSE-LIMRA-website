-- ═══════════════════════════════════════════════════════════════════════════
-- LIMRA Restaurant — Phase 2 Security Hardening Migration
-- 1. Replace permissive "Public full access" policies on Catalog tables
-- 2. Restrict Administrative, Internal & Inventory tables to verified admins
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. STORE CATALOG & PUBLIC READ TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1 delivery_areas (Public can view, only admins can modify)
DROP POLICY IF EXISTS "Public full access delivery_areas" ON public.delivery_areas;
DROP POLICY IF EXISTS "Public can view delivery areas" ON public.delivery_areas;
DROP POLICY IF EXISTS "Admins can manage delivery areas" ON public.delivery_areas;

CREATE POLICY "Public can view delivery areas"
  ON public.delivery_areas FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage delivery areas"
  ON public.delivery_areas FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 1.2 combos (Public can view, only admins can modify)
DROP POLICY IF EXISTS "Public full access combos" ON public.combos;
DROP POLICY IF EXISTS "Public can view combos" ON public.combos;
DROP POLICY IF EXISTS "Admins can manage combos" ON public.combos;

CREATE POLICY "Public can view combos"
  ON public.combos FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage combos"
  ON public.combos FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 1.3 menu_overrides (Public can view, only admins can modify)
DROP POLICY IF EXISTS "Public full access menu_overrides" ON public.menu_overrides;
DROP POLICY IF EXISTS "Public can view menu overrides" ON public.menu_overrides;
DROP POLICY IF EXISTS "Admins can manage menu overrides" ON public.menu_overrides;

CREATE POLICY "Public can view menu overrides"
  ON public.menu_overrides FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage menu overrides"
  ON public.menu_overrides FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 1.4 coupons (Public can view coupons, customers can update used_count, admins manage)
DROP POLICY IF EXISTS "Public full access coupons" ON public.coupons;
DROP POLICY IF EXISTS "Public can view coupons" ON public.coupons;
DROP POLICY IF EXISTS "Public can increment coupon usage" ON public.coupons;
DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;

CREATE POLICY "Public can view coupons"
  ON public.coupons FOR SELECT
  USING (true);

CREATE POLICY "Public can increment coupon usage"
  ON public.coupons FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can manage coupons"
  ON public.coupons FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 1.5 coupon_usage (Public can check & record usage, admins manage)
DROP POLICY IF EXISTS "Public full access coupon_usage" ON public.coupon_usage;
DROP POLICY IF EXISTS "Public can check coupon usage" ON public.coupon_usage;
DROP POLICY IF EXISTS "Public can insert coupon usage" ON public.coupon_usage;
DROP POLICY IF EXISTS "Admins can manage coupon usage" ON public.coupon_usage;

CREATE POLICY "Public can check coupon usage"
  ON public.coupon_usage FOR SELECT
  USING (true);

CREATE POLICY "Public can insert coupon usage"
  ON public.coupon_usage FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can manage coupon usage"
  ON public.coupon_usage FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 1.6 reviews (Public can view & submit reviews, admins manage)
DROP POLICY IF EXISTS "Public full access reviews" ON public.reviews;
DROP POLICY IF EXISTS "Public can view reviews" ON public.reviews;
DROP POLICY IF EXISTS "Public can insert reviews" ON public.reviews;
DROP POLICY IF EXISTS "Admins can manage reviews" ON public.reviews;

CREATE POLICY "Public can view reviews"
  ON public.reviews FOR SELECT
  USING (true);

CREATE POLICY "Public can insert reviews"
  ON public.reviews FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can manage reviews"
  ON public.reviews FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ADMINISTRATIVE & SECURITY TABLES (ADMIN-ONLY ACCESS)
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1 admin_users
DROP POLICY IF EXISTS "Public full access admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can read admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can manage admin_users" ON public.admin_users;

CREATE POLICY "Admins can read admin_users"
  ON public.admin_users FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR lower(email) = lower(auth.jwt()->>'email') OR public.is_admin());

CREATE POLICY "Admins can manage admin_users"
  ON public.admin_users FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 2.2 printer_settings
DROP POLICY IF EXISTS "Public full access printer_settings" ON public.printer_settings;
DROP POLICY IF EXISTS "Admins can manage printer settings" ON public.printer_settings;

CREATE POLICY "Admins can manage printer settings"
  ON public.printer_settings FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 2.3 phone_verifications (OTP codes — NEVER readable by public)
DROP POLICY IF EXISTS "Public full access phone_verifications" ON public.phone_verifications;
DROP POLICY IF EXISTS "Admins can view phone verifications" ON public.phone_verifications;

CREATE POLICY "Admins can view phone verifications"
  ON public.phone_verifications FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- 2.4 security_audit_logs
DROP POLICY IF EXISTS "Public full access security_audit_logs" ON public.security_audit_logs;
DROP POLICY IF EXISTS "Admins can view security logs" ON public.security_audit_logs;

CREATE POLICY "Admins can view security logs"
  ON public.security_audit_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- 2.5 verified_payments
DROP POLICY IF EXISTS "Public full access verified_payments" ON public.verified_payments;
DROP POLICY IF EXISTS "Admins can view verified payments" ON public.verified_payments;

CREATE POLICY "Admins can view verified payments"
  ON public.verified_payments FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- 2.6 payment_history
DROP POLICY IF EXISTS "Public full access payment_history" ON public.payment_history;
DROP POLICY IF EXISTS "Admins can manage payment history" ON public.payment_history;
DROP POLICY IF EXISTS "Users can read own payment history" ON public.payment_history;

CREATE POLICY "Admins can manage payment history"
  ON public.payment_history FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Users can read own payment history"
  ON public.payment_history FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = payment_history.order_id
      AND (o.user_id = auth.uid() OR regexp_replace(o.customer_phone, '\D', '', 'g') = (SELECT regexp_replace(phone, '\D', '', 'g') FROM public.customer_profiles WHERE id = auth.uid()))
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. STOCK & INVENTORY MANAGEMENT TABLES (ADMIN-ONLY ACCESS)
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 stock_items
DROP POLICY IF EXISTS "Public full access stock_items" ON public.stock_items;
DROP POLICY IF EXISTS "Admins can manage stock items" ON public.stock_items;

CREATE POLICY "Admins can manage stock items"
  ON public.stock_items FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3.2 stock_in & stock_in_entries
DROP POLICY IF EXISTS "Public full access stock_in" ON public.stock_in;
DROP POLICY IF EXISTS "Public full access stock_in_entries" ON public.stock_in_entries;
DROP POLICY IF EXISTS "Admins can manage stock in" ON public.stock_in;
DROP POLICY IF EXISTS "Admins can manage stock in entries" ON public.stock_in_entries;

CREATE POLICY "Admins can manage stock in"
  ON public.stock_in FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can manage stock in entries"
  ON public.stock_in_entries FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3.3 stock_out & stock_out_entries
DROP POLICY IF EXISTS "Public full access stock_out" ON public.stock_out;
DROP POLICY IF EXISTS "Public full access stock_out_entries" ON public.stock_out_entries;
DROP POLICY IF EXISTS "Admins can manage stock out" ON public.stock_out;
DROP POLICY IF EXISTS "Admins can manage stock out entries" ON public.stock_out_entries;

CREATE POLICY "Admins can manage stock out"
  ON public.stock_out FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can manage stock out entries"
  ON public.stock_out_entries FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3.4 stock_logs
DROP POLICY IF EXISTS "Public full access stock_logs" ON public.stock_logs;
DROP POLICY IF EXISTS "Admins can manage stock logs" ON public.stock_logs;

CREATE POLICY "Admins can manage stock logs"
  ON public.stock_logs FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
