-- =============================================================================
-- MIGRATION: 20261017060000_table_transfer_swap_and_floor_plan.sql
-- DESCRIPTION: Atomic Table Transfer, Table Swap RPCs and Dynamic Floor Plan Schema
-- TASK: 2.3
-- =============================================================================

-- 1. Ensure total_tables column exists on printer_settings
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

-- 2. Atomic Table Session Transfer RPC
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

-- 3. Atomic Table Session Swap RPC
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
  -- Step 5a: Move Table A to -999
  UPDATE public.orders
  SET table_number = -999,
      updated_at = now()
  WHERE id = ANY(v_orders_a);

  -- Step 5b: Move Table B to Table A
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

  -- Step 5c: Move sentinel (-999) Table A to Table B
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
