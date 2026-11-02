-- =============================================================================
-- MIGRATION: 20261017080000_staff_rbac_and_admin_users.sql
-- DESCRIPTION: Database-Backed Staff Directory & Granular RBAC Security Policies
-- TASK: 4.2 (Fixes SEC-02 & SEC-03)
-- =============================================================================

-- 1. Ensure public.admin_users contains staff directory fields
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Staff Member';
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS shift TEXT DEFAULT '10:00 AM - 08:00 PM';
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'on_duty';
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Performance indexes on admin_users lookup paths
CREATE INDEX IF NOT EXISTS admin_users_email_idx ON public.admin_users(lower(email));
CREATE INDEX IF NOT EXISTS admin_users_user_id_idx ON public.admin_users(user_id);
CREATE INDEX IF NOT EXISTS admin_users_role_idx ON public.admin_users(lower(role));
CREATE INDEX IF NOT EXISTS admin_users_is_active_idx ON public.admin_users(is_active);

-- 3. Granular RLS Policies on admin_users (SEC-02 Remediation)
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read admin_users" ON public.admin_users;
CREATE POLICY "Admins can read admin_users"
  ON public.admin_users FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() 
    OR lower(email) = lower(auth.jwt()->>'email') 
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Admins can manage admin_users" ON public.admin_users;
CREATE POLICY "Admins can manage admin_users"
  ON public.admin_users FOR ALL
  TO authenticated
  USING (public.has_role(ARRAY['owner', 'manager', 'admin']))
  WITH CHECK (public.has_role(ARRAY['owner', 'manager', 'admin']));

-- 4. Granular RLS Policies on Sensitive Operational Tables (SEC-03 Remediation)
-- Only Owner and Manager roles can modify hardware, billing, printer settings, coupons, combos, and delivery areas
DROP POLICY IF EXISTS "Admins can manage printer settings" ON public.printer_settings;
CREATE POLICY "Admins can manage printer settings"
  ON public.printer_settings FOR ALL
  TO authenticated
  USING (public.has_role(ARRAY['owner', 'manager', 'admin']))
  WITH CHECK (public.has_role(ARRAY['owner', 'manager', 'admin']));

DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;
CREATE POLICY "Admins can manage coupons"
  ON public.coupons FOR ALL
  TO authenticated
  USING (public.has_role(ARRAY['owner', 'manager', 'admin']))
  WITH CHECK (public.has_role(ARRAY['owner', 'manager', 'admin']));

DROP POLICY IF EXISTS "Admins can manage combos" ON public.combos;
CREATE POLICY "Admins can manage combos"
  ON public.combos FOR ALL
  TO authenticated
  USING (public.has_role(ARRAY['owner', 'manager', 'admin']))
  WITH CHECK (public.has_role(ARRAY['owner', 'manager', 'admin']));

DROP POLICY IF EXISTS "Admins can manage delivery areas" ON public.delivery_areas;
CREATE POLICY "Admins can manage delivery areas"
  ON public.delivery_areas FOR ALL
  TO authenticated
  USING (public.has_role(ARRAY['owner', 'manager', 'admin']))
  WITH CHECK (public.has_role(ARRAY['owner', 'manager', 'admin']));

-- 5. Seed Core Staff Members if Table is Fresh
INSERT INTO public.admin_users (name, email, role, phone, shift, status, is_active, notes)
VALUES
  ('Salim Khan', 'salim@limra.com', 'owner', '+91 99887 76655', '10:00 AM - 08:00 PM', 'on_duty', true, 'Master admin & operations head'),
  ('Rahul Sharma', 'rahul@limra.com', 'kitchen', '+91 98765 43210', '11:00 AM - 11:00 PM', 'on_duty', true, 'Head Chef / Kitchen in-charge'),
  ('Imran Ansari', 'imran@limra.com', 'manager', '+91 98123 45678', '12:00 PM - 11:30 PM', 'on_duty', true, 'Dining room captain & floor manager'),
  ('Afzal Qureshi', 'afzal@limra.com', 'cashier', '+91 96345 67890', '10:00 AM - 07:00 PM', 'on_duty', true, 'Front desk cashier & POS billing'),
  ('Danish Ali', 'danish@limra.com', 'cashier', '+91 97234 56789', '01:00 PM - 11:00 PM', 'on_duty', true, 'Counter service & online dispatch')
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  phone = EXCLUDED.phone,
  shift = EXCLUDED.shift,
  status = EXCLUDED.status,
  is_active = EXCLUDED.is_active,
  notes = EXCLUDED.notes;
