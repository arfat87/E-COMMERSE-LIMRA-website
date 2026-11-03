-- =============================================================================
-- MIGRATION: 20261103010000_grant_pos_anon_permissions.sql
-- DESCRIPTION: Enable POS Client and Table Sync Permissions for Bill Settlement and Orders
-- TARGET DATABASE: LIMRA POS (ynrtlcasbndkrqeotgzt.supabase.co)
-- REPAIRS:
--   1. Fixes Postgres 42501 on settle_order_atomic for POS cashiers / anon role
--   2. Fixes Postgres 42501 RLS policy violations on orders and order_items
--   3. Fixes table transfer & swap RPC execution permissions
--   4. Grants select on printer_settings and notifications for POS operations
--   5. Reloads PostgREST schema cache
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: HELPER FUNCTIONS EXECUTE GRANTS
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.has_role(text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deduct_order_inventory_atomic(uuid, integer, jsonb) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: SETTLE ORDER ATOMIC RPC (Fixes Permission Denied & Staff Check)
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
  -- Authenticated non-staff users (e.g. online customers) cannot settle orders
  IF auth.role() = 'authenticated' AND NOT public.is_admin() THEN
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
        'message', 'Order already settled',
        'order', row_to_json(v_order)
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
    'idempotent_replay', false,
    'order', row_to_json(v_order)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_order_atomic(uuid, text, text, text) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: TABLE TRANSFER & SWAP ATOMIC RPCS
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
  -- Authenticated non-staff users cannot transfer table sessions
  IF auth.role() = 'authenticated' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff credentials required to transfer table sessions';
  END IF;

  IF v_actor_id IS NOT NULL THEN
    SELECT email, role INTO v_actor_email, v_actor_role
    FROM public.admin_users
    WHERE user_id = v_actor_id;
  END IF;

  IF v_clean_staff IS NULL THEN
    v_clean_staff := COALESCE(v_actor_email, 'Staff');
  END IF;

  -- Validate table numbers
  IF p_source_table IS NULL OR p_source_table <= 0 THEN
    RAISE EXCEPTION 'INVALID_SOURCE_TABLE: Source table must be a positive integer.';
  END IF;

  IF p_target_table IS NULL OR p_target_table <= 0 THEN
    RAISE EXCEPTION 'INVALID_TARGET_TABLE: Target table must be a positive integer.';
  END IF;

  IF p_source_table = p_target_table THEN
    RAISE EXCEPTION 'SAME_TABLE: Source and target table cannot be the same (Table %).', p_source_table;
  END IF;

  -- Lock advisory keys in sorted order to prevent deadlocks
  PERFORM pg_advisory_xact_lock(hashtext('table_lock_' || LEAST(p_source_table, p_target_table)::text));
  PERFORM pg_advisory_xact_lock(hashtext('table_lock_' || GREATEST(p_source_table, p_target_table)::text));

  -- Find and lock active source orders
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

  -- Verify target table is free
  SELECT array_agg(id) INTO v_target_order_ids
  FROM public.orders
  WHERE (table_number = p_target_table OR notes ~* ('\[TABLE:\s*' || p_target_table || '\]'))
    AND status NOT IN ('delivered', 'cancelled')
    AND ticket_status NOT IN ('CLOSED', 'CANCELLED')
  FOR UPDATE;

  IF v_target_order_ids IS NOT NULL AND array_length(v_target_order_ids, 1) > 0 THEN
    RAISE EXCEPTION 'TARGET_TABLE_OCCUPIED: Table % is currently occupied or has an active/billed session. Use Table Swap if both tables have active guests.', p_target_table;
  END IF;

  -- Atomically update orders to target table
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

  -- Audit log insertion
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

GRANT EXECUTE ON FUNCTION public.transfer_table_session_atomic(integer, integer, text, text) TO anon, authenticated, service_role;

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
  -- Authenticated non-staff users cannot swap table sessions
  IF auth.role() = 'authenticated' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff credentials required to swap table sessions';
  END IF;

  IF v_actor_id IS NOT NULL THEN
    SELECT email, role INTO v_actor_email, v_actor_role
    FROM public.admin_users
    WHERE user_id = v_actor_id;
  END IF;

  IF v_clean_staff IS NULL THEN
    v_clean_staff := COALESCE(v_actor_email, 'Staff');
  END IF;

  IF p_table_a IS NULL OR p_table_a <= 0 OR p_table_b IS NULL OR p_table_b <= 0 THEN
    RAISE EXCEPTION 'INVALID_TABLE_NUMBERS: Both table numbers must be positive integers.';
  END IF;

  IF p_table_a = p_table_b THEN
    RAISE EXCEPTION 'SAME_TABLE: Cannot swap Table % with itself.', p_table_a;
  END IF;

  -- Lock advisory keys in sorted order
  PERFORM pg_advisory_xact_lock(hashtext('table_lock_' || LEAST(p_table_a, p_table_b)::text));
  PERFORM pg_advisory_xact_lock(hashtext('table_lock_' || GREATEST(p_table_a, p_table_b)::text));

  -- Lock orders for table A
  SELECT array_agg(id) INTO v_orders_a
  FROM public.orders
  WHERE (table_number = p_table_a OR notes ~* ('\[TABLE:\s*' || p_table_a || '\]'))
    AND status NOT IN ('delivered', 'cancelled')
    AND ticket_status NOT IN ('CLOSED', 'CANCELLED')
  FOR UPDATE;

  -- Lock orders for table B
  SELECT array_agg(id) INTO v_orders_b
  FROM public.orders
  WHERE (table_number = p_table_b OR notes ~* ('\[TABLE:\s*' || p_table_b || '\]'))
    AND status NOT IN ('delivered', 'cancelled')
    AND ticket_status NOT IN ('CLOSED', 'CANCELLED')
  FOR UPDATE;

  v_count_a := COALESCE(array_length(v_orders_a, 1), 0);
  v_count_b := COALESCE(array_length(v_orders_b, 1), 0);

  IF v_count_a = 0 AND v_count_b = 0 THEN
    RAISE EXCEPTION 'BOTH_TABLES_EMPTY: Neither Table % nor Table % has active running sessions to swap.', p_table_a, p_table_b;
  END IF;

  -- Swap table assignments
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

  -- Audit Logging
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

GRANT EXECUTE ON FUNCTION public.swap_table_sessions_atomic(integer, integer, text, text) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: RLS POLICIES FOR ORDERS & ORDER_ITEMS (Restores POS & Website Sync)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can create orders" ON public.orders;
CREATE POLICY "Public can create orders" 
  ON public.orders 
  FOR INSERT 
  TO anon, authenticated 
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public can update orders" ON public.orders;
CREATE POLICY "Public can update orders" 
  ON public.orders 
  FOR UPDATE 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public can manage order items" ON public.order_items;
CREATE POLICY "Public can manage order items" 
  ON public.order_items 
  FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: RLS POLICIES FOR PRINTER SETTINGS & NOTIFICATIONS & PAYMENT HISTORY
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view printer settings" ON public.printer_settings;
CREATE POLICY "Public can view printer settings" 
  ON public.printer_settings 
  FOR SELECT 
  TO anon, authenticated 
  USING (true);

DROP POLICY IF EXISTS "Public can manage notifications" ON public.notifications;
CREATE POLICY "Public can manage notifications" 
  ON public.notifications 
  FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public can view payment history" ON public.payment_history;
CREATE POLICY "Public can view payment history" 
  ON public.payment_history 
  FOR SELECT 
  TO anon, authenticated 
  USING (true);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: POSTGREST SCHEMA CACHE RELOAD
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
