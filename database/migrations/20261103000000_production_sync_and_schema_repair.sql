-- =============================================================================
-- MIGRATION: 20261103000000_production_sync_and_schema_repair.sql
-- DESCRIPTION: Idempotent production schema synchronization and repair
-- TARGET DATABASE: LIMRA POS (ynrtlcasbndkrqeotgzt.supabase.co)
-- REPAIRS:
--   1. Fixes Postgres 42703 (Missing financial columns on public.orders)
--   2. Fixes PostgREST PGRST202 (Missing settle_order_atomic, transfer_table_session_atomic, swap_table_sessions_atomic)
--   3. Adds missing public.has_role() function required for Granular Staff RBAC
--   4. Creates public.sync_queue transactional outbox table
--   5. Creates public.deduct_order_inventory_atomic() required for settlement
--   6. Extends public.admin_users with staff directory columns and indexes
--   7. Adds total_tables to public.printer_settings
--   8. Idempotent check constraints, performance indexes, and schema cache reload
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: RBAC HELPER FUNCTION (Prerequisite for RLS policies)
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: TRANSACTIONAL SYNC QUEUE (Outbox pattern for settlements/external sync)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('order_print', 'google_sheet', 'webhook_outbound', 'stock_sync')),
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_pending 
  ON public.sync_queue(status, created_at) 
  WHERE status = 'pending';

ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage sync_queue" ON public.sync_queue;
CREATE POLICY "Admins can manage sync_queue" 
  ON public.sync_queue 
  FOR ALL 
  TO authenticated 
  USING (public.is_admin()) 
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: ATOMIC INVENTORY DEDUCTION FUNCTION (Prerequisite for settle_order_atomic)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deduct_order_inventory_atomic(
  p_order_id uuid,
  p_order_number integer,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_qty numeric;
  v_name text;
  v_stk public.stock_items%ROWTYPE;
  v_deducted_count integer := 0;
  v_already_logged boolean := false;
BEGIN
  -- Idempotency Check: Prevent duplicate deductions for the same order
  SELECT EXISTS (
    SELECT 1 FROM public.stock_logs
    WHERE action = 'ORDER_DEDUCT'
      AND details ILIKE '%Order #' || p_order_number || '%'
  ) INTO v_already_logged;

  IF v_already_logged THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_deducted', true,
      'message', 'Inventory was already deducted for Order #' || p_order_number
    );
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', true, 'deducted_count', 0);
  END IF;

  -- Deduct each item atomically with row-level locking
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1));
    v_name := trim(COALESCE(v_item->>'name', v_item->>'item_name', ''));

    IF v_name <> '' THEN
      SELECT * INTO v_stk
      FROM public.stock_items
      WHERE lower(trim(name)) = lower(v_name)
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.stock_items
        SET qty = GREATEST(0, (COALESCE(qty, 0) - v_qty)),
            updated_at = now()
        WHERE id = v_stk.id;

        INSERT INTO public.stock_logs (
          id, action, details, created_at
        )
        VALUES (
          gen_random_uuid(),
          'ORDER_DEDUCT',
          'Deducted ' || v_qty || ' for Order #' || p_order_number || ' (' || v_name || ')',
          now()
        );
        v_deducted_count := v_deducted_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'already_deducted', false,
    'deducted_count', v_deducted_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deduct_order_inventory_atomic(uuid, integer, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.deduct_order_inventory_atomic(uuid, integer, jsonb) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: PRINTER SETTINGS FLOOR PLAN COLUMN
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'printer_settings' 
      AND column_name = 'total_tables'
  ) THEN
    ALTER TABLE public.printer_settings ADD COLUMN total_tables INTEGER DEFAULT 19;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: TABLE TRANSFER & SWAP ATOMIC RPCS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_table_session_atomic(
  p_source_table integer,
  p_target_table integer,
  p_staff_name text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_email text := '';
  v_actor_role text := 'staff';
  v_source_order_ids uuid[];
  v_target_order_ids uuid[];
  v_source_count integer;
  v_audit_details jsonb;
  v_clean_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_clean_staff text := NULLIF(trim(COALESCE(p_staff_name, '')), '');
BEGIN
  -- 1. Authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff credentials required to transfer table sessions';
  END IF;

  SELECT email, role INTO v_actor_email, v_actor_role
  FROM public.admin_users
  WHERE id = v_actor_id;

  IF v_clean_staff IS NULL THEN
    v_clean_staff := COALESCE(v_actor_email, 'Staff');
  END IF;

  -- 2. Validate table numbers
  IF p_source_table IS NULL OR p_source_table <= 0 THEN
    RAISE EXCEPTION 'INVALID_SOURCE_TABLE: Source table must be a positive integer.';
  END IF;

  IF p_target_table IS NULL OR p_target_table <= 0 THEN
    RAISE EXCEPTION 'INVALID_TARGET_TABLE: Target table must be a positive integer.';
  END IF;

  IF p_source_table = p_target_table THEN
    RAISE EXCEPTION 'SAME_TABLE: Source and target table cannot be the same (Table %).', p_source_table;
  END IF;

  -- 3. Deadlock prevention: Lock advisory keys in sorted order
  PERFORM pg_advisory_xact_lock(hashtext('table_lock_' || LEAST(p_source_table, p_target_table)::text));
  PERFORM pg_advisory_xact_lock(hashtext('table_lock_' || GREATEST(p_source_table, p_target_table)::text));

  -- 4. Find and lock active source orders
  SELECT array_agg(id) INTO v_source_order_ids
  FROM public.orders
  WHERE (table_number = p_source_table OR notes ~* ('\[TABLE:\s*' || p_source_table || '\]'))
    AND status NOT IN ('delivered', 'cancelled', 'billed')
    AND ticket_status NOT IN ('CLOSED', 'CANCELLED', 'BILLED')
  FOR UPDATE;

  v_source_count := COALESCE(array_length(v_source_order_ids, 1), 0);
  IF v_source_count = 0 THEN
    RAISE EXCEPTION 'SOURCE_TABLE_EMPTY: Table % has no active running sessions to transfer.', p_source_table;
  END IF;

  -- 5. Verify target table is free (not occupied or pending unpaid bill)
  SELECT array_agg(id) INTO v_target_order_ids
  FROM public.orders
  WHERE (table_number = p_target_table OR notes ~* ('\[TABLE:\s*' || p_target_table || '\]'))
    AND status NOT IN ('delivered', 'cancelled')
    AND ticket_status NOT IN ('CLOSED', 'CANCELLED')
  FOR UPDATE;

  IF v_target_order_ids IS NOT NULL AND array_length(v_target_order_ids, 1) > 0 THEN
    RAISE EXCEPTION 'TARGET_TABLE_OCCUPIED: Table % is currently occupied or has an active/billed session. Use Table Swap if both tables have active guests.', p_target_table;
  END IF;

  -- 6. Atomically update orders to target table
  UPDATE public.orders
  SET table_number = p_target_table,
      notes = regexp_replace(
        regexp_replace(COALESCE(notes, ''), '\[TABLE:\s*' || p_source_table || '\]', '[TABLE: ' || p_target_table || ']', 'gi'),
        '\[TABLE:\s*Table\s*' || p_source_table || '\]',
        '[TABLE: Table ' || p_target_table || ']',
        'gi'
      ) || ' [TRANSFERRED_FROM_TABLE_' || p_source_table || '_BY_' || v_clean_staff || ']',
      updated_at = now()
  WHERE id = ANY(v_source_order_ids);

  -- 7. Audit log insertion
  v_audit_details := jsonb_build_object(
    'operation', 'TABLE_TRANSFER',
    'source_table', p_source_table,
    'target_table', p_target_table,
    'orders_count', v_source_count,
    'order_ids', v_source_order_ids,
    'reason', v_clean_reason,
    'staff_name', v_clean_staff,
    'actor', jsonb_build_object(
      'id', v_actor_id,
      'email', v_actor_email,
      'role', v_actor_role
    ),
    'timestamp', now()
  );

  INSERT INTO public.security_audit_logs (
    user_id, action, result, details, created_at
  )
  VALUES (
    v_actor_id,
    'TABLE_TRANSFER',
    'success',
    v_audit_details,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'source_table', p_source_table,
    'target_table', p_target_table,
    'transferred_orders_count', v_source_count,
    'order_ids', v_source_order_ids,
    'staff_name', v_clean_staff,
    'message', format('Table %s successfully transferred to Table %s (%s active tickets moved)', p_source_table, p_target_table, v_source_count)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transfer_table_session_atomic(integer, integer, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_table_session_atomic(integer, integer, text, text) TO authenticated;

-- Table Swap RPC
CREATE OR REPLACE FUNCTION public.swap_table_sessions_atomic(
  p_table_a integer,
  p_table_b integer,
  p_staff_name text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_email text := '';
  v_actor_role text := 'staff';
  v_orders_a uuid[];
  v_orders_b uuid[];
  v_count_a integer;
  v_count_b integer;
  v_audit_details jsonb;
  v_clean_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_clean_staff text := NULLIF(trim(COALESCE(p_staff_name, '')), '');
BEGIN
  -- 1. Authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff credentials required to swap table sessions';
  END IF;

  SELECT email, role INTO v_actor_email, v_actor_role
  FROM public.admin_users
  WHERE id = v_actor_id;

  IF v_clean_staff IS NULL THEN
    v_clean_staff := COALESCE(v_actor_email, 'Staff');
  END IF;

  -- 2. Validate table numbers
  IF p_table_a IS NULL OR p_table_a <= 0 THEN
    RAISE EXCEPTION 'INVALID_TABLE_A: Table A must be a positive integer.';
  END IF;

  IF p_table_b IS NULL OR p_table_b <= 0 THEN
    RAISE EXCEPTION 'INVALID_TABLE_B: Table B must be a positive integer.';
  END IF;

  IF p_table_a = p_table_b THEN
    RAISE EXCEPTION 'SAME_TABLE: Cannot swap a table with itself (Table %).', p_table_a;
  END IF;

  -- 3. Deadlock prevention: Lock advisory keys in sorted order
  PERFORM pg_advisory_xact_lock(hashtext('table_lock_' || LEAST(p_table_a, p_table_b)::text));
  PERFORM pg_advisory_xact_lock(hashtext('table_lock_' || GREATEST(p_table_a, p_table_b)::text));

  -- 4. Find and lock active orders for Table A and Table B
  SELECT array_agg(id) INTO v_orders_a
  FROM public.orders
  WHERE (table_number = p_table_a OR notes ~* ('\[TABLE:\s*' || p_table_a || '\]'))
    AND status NOT IN ('delivered', 'cancelled', 'billed')
    AND ticket_status NOT IN ('CLOSED', 'CANCELLED', 'BILLED')
  FOR UPDATE;

  SELECT array_agg(id) INTO v_orders_b
  FROM public.orders
  WHERE (table_number = p_table_b OR notes ~* ('\[TABLE:\s*' || p_table_b || '\]'))
    AND status NOT IN ('delivered', 'cancelled', 'billed')
    AND ticket_status NOT IN ('CLOSED', 'CANCELLED', 'BILLED')
  FOR UPDATE;

  v_count_a := COALESCE(array_length(v_orders_a, 1), 0);
  v_count_b := COALESCE(array_length(v_orders_b, 1), 0);

  IF v_count_a = 0 THEN
    RAISE EXCEPTION 'TABLE_A_EMPTY: Table % has no active session to swap.', p_table_a;
  END IF;

  IF v_count_b = 0 THEN
    RAISE EXCEPTION 'TABLE_B_EMPTY: Table % has no active session to swap.', p_table_b;
  END IF;

  -- 5. Safe atomic swap using temporary sentinel -999 for Table A
  UPDATE public.orders
  SET table_number = -999,
      updated_at = now()
  WHERE id = ANY(v_orders_a);

  UPDATE public.orders
  SET table_number = p_table_a,
      notes = regexp_replace(
        regexp_replace(COALESCE(notes, ''), '\[TABLE:\s*' || p_table_b || '\]', '[TABLE: ' || p_table_a || ']', 'gi'),
        '\[TABLE:\s*Table\s*' || p_table_b || '\]',
        '[TABLE: Table ' || p_table_a || ']',
        'gi'
      ) || ' [SWAPPED_FROM_TABLE_' || p_table_b || '_BY_' || v_clean_staff || ']',
      updated_at = now()
  WHERE id = ANY(v_orders_b);

  UPDATE public.orders
  SET table_number = p_table_b,
      notes = regexp_replace(
        regexp_replace(COALESCE(notes, ''), '\[TABLE:\s*' || p_table_a || '\]', '[TABLE: ' || p_table_b || ']', 'gi'),
        '\[TABLE:\s*Table\s*' || p_table_a || '\]',
        '[TABLE: Table ' || p_table_b || ']',
        'gi'
      ) || ' [SWAPPED_FROM_TABLE_' || p_table_a || '_BY_' || v_clean_staff || ']',
      updated_at = now()
  WHERE id = ANY(v_orders_a);

  -- 6. Audit Logging
  v_audit_details := jsonb_build_object(
    'operation', 'TABLE_SWAP',
    'table_a', p_table_a,
    'table_b', p_table_b,
    'table_a_orders_count', v_count_a,
    'table_b_orders_count', v_count_b,
    'table_a_order_ids', v_orders_a,
    'table_b_order_ids', v_orders_b,
    'reason', v_clean_reason,
    'staff_name', v_clean_staff,
    'actor', jsonb_build_object(
      'id', v_actor_id,
      'email', v_actor_email,
      'role', v_actor_role
    ),
    'timestamp', now()
  );

  INSERT INTO public.security_audit_logs (
    user_id, action, result, details, created_at
  )
  VALUES (
    v_actor_id,
    'TABLE_SWAP',
    'success',
    v_audit_details,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'table_a', p_table_a,
    'table_b', p_table_b,
    'table_a_orders_count', v_count_a,
    'table_b_orders_count', v_count_b,
    'staff_name', v_clean_staff,
    'message', format('Table %s and Table %s successfully swapped (%s and %s tickets interchanged)', p_table_a, p_table_b, v_count_a, v_count_b)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.swap_table_sessions_atomic(integer, integer, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.swap_table_sessions_atomic(integer, integer, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: ADMIN USERS STAFF DIRECTORY & RBAC POLICIES
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Staff Member';
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS shift TEXT DEFAULT '10:00 AM - 08:00 PM';
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'on_duty';
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS admin_users_email_idx ON public.admin_users(lower(email));
CREATE INDEX IF NOT EXISTS admin_users_user_id_idx ON public.admin_users(user_id);
CREATE INDEX IF NOT EXISTS admin_users_role_idx ON public.admin_users(lower(role));
CREATE INDEX IF NOT EXISTS admin_users_is_active_idx ON public.admin_users(is_active);

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

-- Granular RLS Policies on Sensitive Operational Tables
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

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 7: ORDERS FINANCIAL & LIFECYCLE STRUCTURED COLUMNS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key 
  ON public.orders(idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS packaging_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS round_off_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS consolidated_into_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_subtotal') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_subtotal CHECK (subtotal_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_discount_pct') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_discount_pct CHECK (discount_pct >= 0 AND discount_pct <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_discount_amount') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_discount_amount CHECK (discount_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_taxable_amount') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_taxable_amount CHECK (taxable_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_cgst_amount') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_cgst_amount CHECK (cgst_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_sgst_amount') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_sgst_amount CHECK (sgst_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_delivery_fee') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_delivery_fee CHECK (delivery_fee >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_packaging_fee') THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_packaging_fee CHECK (packaging_fee >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_settled_at ON public.orders(settled_at DESC) WHERE settled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_consolidated_into ON public.orders(consolidated_into_order_id) WHERE consolidated_into_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_taxable_amount ON public.orders(taxable_amount) WHERE taxable_amount > 0;

-- Safe backward-compatible data backfill for historical rows
UPDATE public.orders
SET settled_at = updated_at
WHERE (ticket_status = 'CLOSED' OR payment_status = 'paid')
  AND settled_at IS NULL;

UPDATE public.orders
SET consolidated_into_order_id = (regexp_match(notes, '\[PARENT_ORDER_ID:\s*([0-9a-fA-F-]+)\]'))[1]::uuid
WHERE consolidated_into_order_id IS NULL
  AND notes ~ '\[PARENT_ORDER_ID:\s*([0-9a-fA-F-]+)\]';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 8: ATOMIC ORDER SETTLEMENT RPC (settle_order_atomic)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_order_atomic(
  p_order_id uuid,
  p_payment_method text DEFAULT 'cash',
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_prev_pay_status text;
  v_items jsonb;
  v_inv_result jsonb := jsonb_build_object('success', true, 'already_deducted', false, 'deducted_count', 0);
  v_cashier_id uuid := auth.uid();
  v_clean_key text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_clean_method text := lower(trim(COALESCE(NULLIF(trim(COALESCE(p_payment_method, '')), ''), 'cash')));
  v_history_inserted boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff credentials required to settle orders';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % does not exist', p_order_id;
  END IF;

  IF v_order.status = 'cancelled' OR v_order.ticket_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'ORDER_CANCELLED: Order #% is cancelled and cannot be settled.', v_order.order_number;
  END IF;

  IF v_order.ticket_status = 'CLOSED' AND v_order.payment_status = 'paid' THEN
    IF v_clean_key IS NOT NULL AND v_order.idempotency_key = v_clean_key THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'ticket_status', v_order.ticket_status,
        'payment_method', v_order.payment_method,
        'total_amount', v_order.total_amount,
        'settled_at', v_order.settled_at,
        'idempotent_replay', true,
        'message', 'Order already settled'
      );
    ELSE
      RAISE EXCEPTION 'ORDER_ALREADY_SETTLED: Order #% has already been settled and closed by another cashier.', v_order.order_number;
    END IF;
  END IF;

  v_prev_pay_status := COALESCE(v_order.payment_status, 'unpaid');
  IF v_clean_method = 'online' THEN
    v_clean_method := 'upi';
  END IF;

  -- 1. Update Order Settlement, Payment Status & settled_at Atomically
  UPDATE public.orders
  SET status = 'delivered',
      payment_status = 'paid',
      ticket_status = 'CLOSED',
      payment_method = COALESCE(v_clean_method, v_order.payment_method, 'cash'),
      notes = COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), v_order.notes),
      idempotency_key = COALESCE(v_clean_key, v_order.idempotency_key),
      settled_at = COALESCE(v_order.settled_at, now()),
      updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- 2. Insert Payment History (Idempotent per order)
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_history
    WHERE order_id = p_order_id
      AND new_status = 'paid'
  ) THEN
    INSERT INTO public.payment_history (
      order_id, user_id, previous_status, new_status, changed_by, notes, reason, created_at
    )
    VALUES (
      p_order_id,
      v_cashier_id,
      v_prev_pay_status,
      'paid',
      COALESCE(v_cashier_id::text, 'pos_cashier'),
      COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), 'POS Final Bill Settlement (' || UPPER(v_order.payment_method) || ')'),
      'POS Final Bill Settlement (' || UPPER(v_order.payment_method) || ')',
      now()
    );
    v_history_inserted := true;
  END IF;

  -- 3. Deduct Required Inventory Atomically (Idempotent per order)
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', item_name,
      'quantity', quantity
    )
  ) INTO v_items
  FROM public.order_items
  WHERE order_id = p_order_id;

  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    v_inv_result := public.deduct_order_inventory_atomic(p_order_id, v_order.order_number, v_items);
  END IF;

  -- 4. Enqueue Outbox Sync (Idempotent per order settlement)
  IF NOT EXISTS (
    SELECT 1 FROM public.sync_queue
    WHERE entity_type = 'google_sheet'
      AND entity_id = v_order.id::text
  ) THEN
    INSERT INTO public.sync_queue (
      entity_type, entity_id, payload, status, created_at, updated_at
    )
    VALUES (
      'google_sheet',
      v_order.id::text,
      jsonb_build_object(
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'total_amount', v_order.total_amount,
        'order_type', v_order.order_type,
        'payment_method', v_order.payment_method,
        'table_number', v_order.table_number,
        'customer_name', v_order.customer_name,
        'customer_phone', v_order.customer_phone,
        'settled_at', v_order.settled_at
      ),
      'pending',
      now(),
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'ticket_status', v_order.ticket_status,
    'payment_method', v_order.payment_method,
    'total_amount', v_order.total_amount,
    'settled_at', v_order.settled_at,
    'payment_history_logged', v_history_inserted,
    'inventory_deduction', v_inv_result,
    'idempotent_replay', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_order_atomic(uuid, text, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_order_atomic(uuid, text, text, text) TO authenticated;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 9: POSTGREST SCHEMA CACHE RELOAD
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
