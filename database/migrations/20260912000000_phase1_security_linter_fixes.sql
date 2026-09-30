-- ═══════════════════════════════════════════════════════════════════════════
-- LIMRA Restaurant — Phase 1 Security Hardening Migration
-- 1. Fix mutable search_path on public.update_updated_at()
-- 2. Revoke public/anon access to internal trigger & helper procedures
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Fix function_search_path_mutable for update_updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Revoke direct execution on update_updated_at trigger function
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;

-- 2. Revoke execute on tr_on_profile_upsert_or_verify trigger function
REVOKE ALL ON FUNCTION public.tr_on_profile_upsert_or_verify() FROM PUBLIC, anon, authenticated;

-- 3. Revoke direct execute on internal log_security_event function
REVOKE ALL ON FUNCTION public.log_security_event(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- 4. Revoke execute on is_admin() from anonymous users (retain for authenticated users)
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 5. Revoke execute on rls_auto_enable if it exists in the database
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rls_auto_enable') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;';
  END IF;
END $$;
