-- ═══════════════════════════════════════════════════════════════════════════════
-- LIMRA RESTAURANT — Security Hardening Migration
-- 1. Drops permissive 'Public can view orders' and 'Public can view order items'
-- 2. Restricts orders and order_items access to authenticated owners and staff
-- 3. Revokes unauthenticated anon execution on stock management RPCs
-- 4. Enforces RBAC roles ('owner', 'manager', 'cashier', 'kitchen', 'admin')
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ORDERS & ORDER ITEMS RLS HARDENING
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1 Drop permissive public read policies
DROP POLICY IF EXISTS "Public can view orders" ON public.orders;
DROP POLICY IF EXISTS "Public can view order items" ON public.order_items;

-- 1.2 Restrict orders to authenticated customer owner and staff
DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
CREATE POLICY "Users can view own orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can manage orders" ON public.orders;
CREATE POLICY "Admins can manage orders"
  ON public.orders FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 1.3 Restrict order_items to authenticated customer owner and staff
DROP POLICY IF EXISTS "Users can view own order items" ON public.order_items;
CREATE POLICY "Users can view own order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins can manage order items" ON public.order_items;
CREATE POLICY "Admins can manage order items"
  ON public.order_items FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REVOKE ANONYMOUS EXECUTION ON STOCK MANAGEMENT RPCs
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.record_stock_out(text, numeric, text, text, text, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_stock_in(text, numeric, numeric, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_stock_daily_summary(date) FROM anon, PUBLIC;

-- Safe handling for overloaded uuid signatures if previously installed
DO $$
BEGIN
  BEGIN
    REVOKE EXECUTE ON FUNCTION public.record_stock_out(uuid, numeric, text, text, text, boolean) FROM anon, PUBLIC;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    REVOKE EXECUTE ON FUNCTION public.record_stock_in(uuid, numeric, numeric, text, text) FROM anon, PUBLIC;
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ENFORCE ROLE HIERARCHY & ROLE CHECK FUNCTION
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := auth.jwt()->>'email';
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE (user_id = v_uid OR lower(email) = lower(v_email))
      AND lower(COALESCE(role, 'admin')) IN ('owner', 'manager', 'cashier', 'kitchen', 'admin')
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Role checking helper for granular operations
CREATE OR REPLACE FUNCTION public.has_role(required_roles text[])
RETURNS BOOLEAN AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := auth.jwt()->>'email';
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;
  SELECT lower(role) INTO v_role
  FROM public.admin_users
  WHERE user_id = v_uid OR lower(email) = lower(v_email)
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_role = 'owner' THEN
    RETURN TRUE;
  END IF;

  RETURN v_role = ANY(required_roles);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.has_role(text[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(text[]) TO authenticated;
