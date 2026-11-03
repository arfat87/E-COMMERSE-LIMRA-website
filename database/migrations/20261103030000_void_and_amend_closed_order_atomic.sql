-- =============================================================================
-- MIGRATION: 20261103030000_void_and_amend_closed_order_atomic.sql
-- DESCRIPTION: Atomic Void & Amend RPC Functions for Closed / Financial Orders
-- TARGET DATABASE: LIMRA POS (ynrtlcasbndkrqeotgzt.supabase.co)
-- REPAIRS:
--   1. Implements public.void_closed_order_atomic RPC
--   2. Implements public.amend_closed_order_atomic RPC
--   3. Hardens permissions & grants for anon, authenticated, service_role
--   4. Relaxes reason requirement for normal order amendments
--   5. Reloads PostgREST schema cache
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: AUDITABLE VOID OF CLOSED FINANCIAL INVOICES RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_closed_order_atomic(
  p_order_id uuid,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_actor_email text := COALESCE(auth.jwt()->>'email', 'staff@limra.pos');
  v_actor_role text := 'cashier';
  v_clean_reason text := trim(COALESCE(p_reason, ''));
  v_clean_key text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_prev_pay_status text;
  v_orig_items jsonb := '[]'::jsonb;
  v_orig_snapshot jsonb;
  v_void_tag text;
  v_updated_notes text;
  v_audit_details jsonb;
BEGIN
  -- 1. Server-Side Role Check (Allow owner, manager, cashier, admin)
  IF v_actor_id IS NOT NULL OR auth.jwt() IS NOT NULL THEN
    IF NOT public.has_role(ARRAY['owner', 'manager', 'cashier', 'admin']) THEN
      INSERT INTO public.security_audit_logs (user_id, action, result, details, created_at)
      VALUES (
        v_actor_id,
        'ORDER_VOID_REJECTED',
        'forbidden',
        jsonb_build_object(
          'order_id', p_order_id,
          'reason', v_clean_reason,
          'error', 'FORBIDDEN: Staff role required to void an order'
        ),
        now()
      );
      RAISE EXCEPTION 'FORBIDDEN: Staff authorization (Cashier, Manager, Owner, or Admin) is required to void orders';
    END IF;
  END IF;

  -- 2. Input & Reason Validation
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_ID_REQUIRED: Order ID is required';
  END IF;

  IF length(v_clean_reason) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: A valid reason (minimum 3 characters) is required to void an invoice';
  END IF;

  -- 3. Resolve Actor Identity from admin_users
  IF v_actor_id IS NOT NULL OR v_actor_email IS NOT NULL THEN
    SELECT COALESCE(role, 'cashier'), COALESCE(email, v_actor_email)
    INTO v_actor_role, v_actor_email
    FROM public.admin_users
    WHERE is_active = true
      AND (user_id = v_actor_id OR lower(email) = lower(v_actor_email))
    LIMIT 1;
    v_actor_role := COALESCE(v_actor_role, 'cashier');
    v_actor_email := COALESCE(v_actor_email, 'staff@limra.pos');
  END IF;

  -- 4. Lock Order Row Exclusively
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % does not exist', p_order_id;
  END IF;

  -- 5. Idempotency & Duplicate Void Prevention
  IF v_order.payment_status = 'refunded' OR COALESCE(v_order.notes, '') LIKE '%[VOIDED]%' THEN
    IF v_clean_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.security_audit_logs
      WHERE action = 'ORDER_VOID'
        AND details->>'order_id' = v_order.id::text
        AND details->>'idempotency_key' = v_clean_key
    ) THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent_replay', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'ticket_status', v_order.ticket_status,
        'total_amount', v_order.total_amount,
        'voided', true,
        'reason', v_clean_reason,
        'message', 'Order already voided (idempotent replay)'
      );
    END IF;
    RAISE EXCEPTION 'ORDER_ALREADY_VOIDED: Order #% has already been voided', v_order.order_number;
  END IF;

  v_prev_pay_status := COALESCE(v_order.payment_status, 'paid');

  -- 6. Capture Original Snapshot
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'menu_item_id', oi.menu_item_id,
        'item_name', oi.item_name,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'line_total', oi.line_total
      ) ORDER BY oi.created_at ASC, oi.id ASC
    ),
    '[]'::jsonb
  ) INTO v_orig_items
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  v_orig_snapshot := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'customer_name', v_order.customer_name,
    'customer_phone', v_order.customer_phone,
    'order_type', v_order.order_type,
    'table_number', v_order.table_number,
    'total_amount', v_order.total_amount,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'payment_method', v_order.payment_method,
    'ticket_status', v_order.ticket_status,
    'notes', v_order.notes,
    'created_at', v_order.created_at,
    'items', v_orig_items
  );

  -- 7. Transition Order to Voided/Refunded
  v_void_tag := format(
    '[VOIDED] [VOID_REASON: %s] [VOIDED_BY: %s (%s)] [VOIDED_AT: %s] [ORIG_TOTAL: %s]',
    replace(replace(v_clean_reason, '[', '('), ']', ')'),
    v_actor_email,
    v_actor_role,
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    v_order.total_amount
  );
  v_updated_notes := trim(COALESCE(v_order.notes, '') || ' ' || v_void_tag);

  UPDATE public.orders
  SET
    status         = 'cancelled',
    payment_status = 'refunded',
    ticket_status  = 'CLOSED',
    notes          = v_updated_notes,
    updated_at     = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- 8. Append Immutable Payment History Entry
  INSERT INTO public.payment_history (
    order_id, user_id, previous_status, new_status, changed_by, notes, reason, created_at
  )
  VALUES (
    p_order_id,
    v_actor_id,
    v_prev_pay_status,
    'refunded',
    COALESCE(v_actor_id::text, v_actor_email),
    'VOIDED INVOICE #' || v_order.order_number || ': ' || v_clean_reason,
    v_clean_reason,
    now()
  );

  -- 9. Record Comprehensive Financial Audit Log Entry
  v_audit_details := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'original_order_reference', jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'created_at', v_order.created_at
    ),
    'actor', jsonb_build_object(
      'user_id', v_actor_id,
      'email', v_actor_email,
      'role', v_actor_role
    ),
    'timestamp', now(),
    'reason', v_clean_reason,
    'idempotency_key', v_clean_key,
    'original_invoice', v_orig_snapshot,
    'adjustment_details', jsonb_build_object(
      'action_type', 'VOID',
      'previous_payment_status', v_prev_pay_status,
      'new_payment_status', 'refunded',
      'previous_total', v_order.total_amount,
      'voided_amount', v_order.total_amount,
      'net_effective_total', 0
    )
  );

  INSERT INTO public.security_audit_logs (
    user_id, action, result, details, created_at
  )
  VALUES (
    v_actor_id,
    'ORDER_VOID',
    'success',
    v_audit_details,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'ticket_status', v_order.ticket_status,
    'total_amount', v_order.total_amount,
    'notes', v_order.notes,
    'voided', true,
    'reason', v_clean_reason,
    'actor', jsonb_build_object('user_id', v_actor_id, 'email', v_actor_email, 'role', v_actor_role),
    'audit_details', v_audit_details,
    'message', 'Invoice voided and recorded in financial audit log'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_closed_order_atomic(uuid, text, text) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: ATOMIC AMENDMENT OF CLOSED / ACTIVE FINANCIAL INVOICES RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.amend_closed_order_atomic(
  p_order_id uuid,
  p_updated_items jsonb DEFAULT '[]'::jsonb,
  p_updated_fields jsonb DEFAULT '{}'::jsonb,
  p_reason text DEFAULT 'Order edited by authorized staff',
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_actor_email text := COALESCE(auth.jwt()->>'email', 'staff@limra.pos');
  v_actor_role text := 'cashier';
  v_clean_reason text := trim(COALESCE(p_reason, ''));
  v_clean_key text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_orig_items jsonb := '[]'::jsonb;
  v_new_items jsonb := '[]'::jsonb;
  v_orig_snapshot jsonb;
  v_prev_total numeric;
  v_new_total numeric := 0;
  v_items_subtotal numeric := 0;
  v_item jsonb;
  v_item_name text;
  v_item_qty integer;
  v_item_price numeric;
  v_item_line_total numeric;
  v_menu_item_id integer;
  v_amend_tag text;
  v_base_notes text;
  v_updated_notes text;
  v_audit_details jsonb;
BEGIN
  -- 1. Server-Side Role Check (Allow owner, manager, cashier, admin)
  IF v_actor_id IS NOT NULL OR auth.jwt() IS NOT NULL THEN
    IF NOT public.has_role(ARRAY['owner', 'manager', 'cashier', 'admin']) THEN
      INSERT INTO public.security_audit_logs (user_id, action, result, details, created_at)
      VALUES (
        v_actor_id,
        'ORDER_AMEND_REJECTED',
        'forbidden',
        jsonb_build_object(
          'order_id', p_order_id,
          'reason', v_clean_reason,
          'error', 'FORBIDDEN: Staff role required to edit an order'
        ),
        now()
      );
      RAISE EXCEPTION 'FORBIDDEN: Staff authorization (Cashier, Manager, Owner, or Admin) is required to edit orders';
    END IF;
  END IF;

  -- 2. Input Validation (Relaxed reason check: default if empty)
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_ID_REQUIRED: Order ID is required';
  END IF;

  IF length(v_clean_reason) < 3 THEN
    v_clean_reason := 'Order edited by authorized staff';
  END IF;

  IF p_updated_items IS NULL OR jsonb_typeof(p_updated_items) <> 'array' OR jsonb_array_length(p_updated_items) = 0 THEN
    RAISE EXCEPTION 'ITEMS_REQUIRED: An amended invoice must contain at least one item. To void the entire invoice, use void_closed_order_atomic.';
  END IF;

  -- 3. Resolve Actor Identity from admin_users
  IF v_actor_id IS NOT NULL OR v_actor_email IS NOT NULL THEN
    SELECT COALESCE(role, 'cashier'), COALESCE(email, v_actor_email)
    INTO v_actor_role, v_actor_email
    FROM public.admin_users
    WHERE is_active = true
      AND (user_id = v_actor_id OR lower(email) = lower(v_actor_email))
    LIMIT 1;
    v_actor_role := COALESCE(v_actor_role, 'cashier');
    v_actor_email := COALESCE(v_actor_email, 'staff@limra.pos');
  END IF;

  -- 4. Lock Order Row Exclusively
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % does not exist', p_order_id;
  END IF;

  IF v_order.payment_status = 'refunded' OR COALESCE(v_order.notes, '') LIKE '%[VOIDED]%' THEN
    RAISE EXCEPTION 'ORDER_ALREADY_VOIDED: Voided order #% cannot be amended', v_order.order_number;
  END IF;

  -- 5. Idempotency Replay Protection
  IF v_clean_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.security_audit_logs
    WHERE action = 'ORDER_AMENDMENT'
      AND details->>'order_id' = v_order.id::text
      AND details->>'idempotency_key' = v_clean_key
  ) THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', oi.id,
          'menu_item_id', oi.menu_item_id,
          'item_name', oi.item_name,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'line_total', oi.line_total
        ) ORDER BY oi.created_at ASC, oi.id ASC
      ),
      '[]'::jsonb
    ) INTO v_new_items
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id;

    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'total_amount', v_order.total_amount,
      'customer_name', v_order.customer_name,
      'customer_phone', v_order.customer_phone,
      'order_type', v_order.order_type,
      'table_number', v_order.table_number,
      'notes', v_order.notes,
      'items', v_new_items,
      'message', 'Order already amended (idempotent replay)'
    );
  END IF;

  v_prev_total := COALESCE(v_order.total_amount, 0);

  -- 6. Capture Original Snapshot
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'menu_item_id', oi.menu_item_id,
        'item_name', oi.item_name,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'line_total', oi.line_total
      ) ORDER BY oi.created_at ASC, oi.id ASC
    ),
    '[]'::jsonb
  ) INTO v_orig_items
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  v_orig_snapshot := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'customer_name', v_order.customer_name,
    'customer_phone', v_order.customer_phone,
    'order_type', v_order.order_type,
    'table_number', v_order.table_number,
    'total_amount', v_order.total_amount,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'ticket_status', v_order.ticket_status,
    'notes', v_order.notes,
    'items', v_orig_items
  );

  -- 7. Replace Order Items Safely
  DELETE FROM public.order_items WHERE order_id = p_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updated_items)
  LOOP
    v_item_name := trim(COALESCE(v_item->>'item_name', v_item->>'name', 'Item'));
    v_item_qty := GREATEST(1, COALESCE((v_item->>'quantity')::integer, (v_item->>'qty')::integer, 1));
    v_item_price := GREATEST(0::numeric, COALESCE((v_item->>'unit_price')::numeric, (v_item->>'price')::numeric, 0::numeric));
    v_item_line_total := ROUND(v_item_qty * v_item_price, 2);
    v_menu_item_id := NULLIF(COALESCE((v_item->>'menu_item_id')::integer, (v_item->>'id')::integer, NULL), NULL);

    v_items_subtotal := v_items_subtotal + v_item_line_total;

    INSERT INTO public.order_items (
      order_id, menu_item_id, item_name, quantity, unit_price, line_total, created_at
    )
    VALUES (
      p_order_id, v_menu_item_id, v_item_name, v_item_qty, v_item_price, v_item_line_total, now()
    );
  END LOOP;

  -- 8. Calculate New Total & Notes
  IF (p_updated_fields->>'total_amount') IS NOT NULL AND (p_updated_fields->>'total_amount')::numeric > 0 THEN
    v_new_total := (p_updated_fields->>'total_amount')::numeric;
  ELSE
    v_new_total := v_items_subtotal;
  END IF;

  v_amend_tag := format(
    '[AMENDED: %s (%s) at %s: %s | Total: %s -> %s]',
    v_actor_email,
    v_actor_role,
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    replace(replace(v_clean_reason, '[', '('), ']', ')'),
    v_prev_total,
    v_new_total
  );

  v_base_notes := COALESCE(p_updated_fields->>'notes', v_order.notes, '');
  v_updated_notes := trim(v_base_notes || ' ' || v_amend_tag);

  -- 9. Update Order
  UPDATE public.orders
  SET
    customer_name  = COALESCE(p_updated_fields->>'customer_name', v_order.customer_name),
    customer_phone = COALESCE(p_updated_fields->>'customer_phone', v_order.customer_phone),
    order_type     = COALESCE(p_updated_fields->>'order_type', v_order.order_type),
    table_number   = CASE 
      WHEN (p_updated_fields->>'table_number') IS NOT NULL AND (p_updated_fields->>'table_number') ~ '^[0-9]+$' 
      THEN (p_updated_fields->>'table_number')::integer 
      ELSE v_order.table_number 
    END,
    total_amount   = v_new_total,
    notes          = v_updated_notes,
    updated_at     = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- 10. Record Security Audit Log
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'menu_item_id', oi.menu_item_id,
        'item_name', oi.item_name,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'line_total', oi.line_total
      ) ORDER BY oi.created_at ASC, oi.id ASC
    ),
    '[]'::jsonb
  ) INTO v_new_items
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  v_audit_details := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'actor', jsonb_build_object('user_id', v_actor_id, 'email', v_actor_email, 'role', v_actor_role),
    'timestamp', now(),
    'reason', v_clean_reason,
    'idempotency_key', v_clean_key,
    'original_invoice', v_orig_snapshot,
    'adjustment_details', jsonb_build_object(
      'action_type', 'AMEND',
      'previous_total', v_prev_total,
      'new_total', v_new_total,
      'difference', (v_new_total - v_prev_total)
    )
  );

  INSERT INTO public.security_audit_logs (
    user_id, action, result, details, created_at
  )
  VALUES (
    v_actor_id,
    'ORDER_AMENDMENT',
    'success',
    v_audit_details,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'total_amount', v_order.total_amount,
    'customer_name', v_order.customer_name,
    'customer_phone', v_order.customer_phone,
    'order_type', v_order.order_type,
    'table_number', v_order.table_number,
    'notes', v_order.notes,
    'items', v_new_items,
    'message', 'Order amended successfully'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.amend_closed_order_atomic(uuid, jsonb, jsonb, text, text) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: RELOAD POSTGREST SCHEMA CACHE
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;
