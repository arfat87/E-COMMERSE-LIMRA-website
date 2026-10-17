-- =============================================================================
-- MIGRATION: 20261017010000_table_session_lifecycle_and_notifications.sql
-- Description: Harden table session lifecycle, place_table_round RPC with advisory
--              locks & idempotency keys, and implement request_table_service RPC
--              for Call Waiter & Request Bill actions.
-- =============================================================================

-- 1. UPGRADE place_table_round RPC WITH ADVISORY LOCK & IDEMPOTENCY KEY
-- Prevents concurrent requests from creating duplicate tickets or conflicting sessions.
-- Replays identical round submissions idempotently without creating duplicate line items.
-- Enforces that closed and cancelled tickets are never reopened or reused.
CREATE OR REPLACE FUNCTION public.place_table_round(
  p_table_number    integer,
  p_table_zone      text    DEFAULT NULL,
  p_customer_name   text    DEFAULT 'Dine-in Guest',
  p_customer_phone  text    DEFAULT '0000000000',
  p_items           jsonb   DEFAULT '[]'::jsonb,
  p_notes           text    DEFAULT NULL,
  p_round_number    integer DEFAULT 1,
  p_idempotency_key text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_active_ticket   public.orders%ROWTYPE;
  v_new_order       public.orders%ROWTYPE;
  v_item            jsonb;
  v_round_total     numeric := 0;
  v_round_num       integer := 1;
  v_dish_count      integer;
  v_notif_title     text;
  v_notif_msg       text;
  v_round_notes     text;
  v_is_subsequent   boolean := false;
  v_parent_id       uuid    := NULL;
  v_order_num       integer;
  v_clean_key       text    := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_zone            text;
BEGIN
  -- 1.1 Input Validation
  IF p_table_number IS NULL OR p_table_number < 1 OR p_table_number > 19 THEN
    RAISE EXCEPTION 'Invalid table number: %. Must be between 1 and 19', p_table_number;
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  -- 1.2 Idempotency Replay Protection: Check if this specific round was already submitted
  IF v_clean_key IS NOT NULL THEN
    SELECT * INTO v_new_order
    FROM public.orders
    WHERE idempotency_key = v_clean_key;

    IF FOUND THEN
      v_round_num := COALESCE(
        (regexp_match(v_new_order.notes, '\[ROUND:\s*(\d+)\]'))[1]::integer,
        1
      );
      v_parent_id := NULL;
      IF v_new_order.notes ~ '\[PARENT_ORDER_ID:\s*([0-9a-fA-F-]+)\]' THEN
        v_parent_id := (regexp_match(v_new_order.notes, '\[PARENT_ORDER_ID:\s*([0-9a-fA-F-]+)\]'))[1]::uuid;
      END IF;

      RETURN jsonb_build_object(
        'id',                  v_new_order.id,
        'order_number',        v_new_order.order_number,
        'session_id',          COALESCE(v_parent_id, v_new_order.id),
        'total_amount',        v_new_order.total_amount,
        'status',              v_new_order.status,
        'ticket_status',       v_new_order.ticket_status,
        'round_number',        v_round_num,
        'parent_order_id',     v_parent_id,
        'is_subsequent_round', (v_round_num > 1),
        'idempotent_replay',   true,
        'table_number',        v_new_order.table_number,
        'table_zone',          v_new_order.table_zone
      );
    END IF;
  END IF;

  -- 1.3 Advisory Transaction Lock: Serializes concurrent round submissions for the SAME table
  -- Guarantees that two concurrent checkouts at the same table do not create split sessions
  PERFORM pg_advisory_xact_lock(hashtext('limra_table_session_' || p_table_number::text));

  -- 1.4 Compute round total amount
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_round_total := v_round_total + COALESCE((v_item->>'line_total')::numeric, 0);
  END LOOP;

  -- 1.5 Determine Table Zone (1-9 = indoor, 10-19 = outdoor)
  v_zone := COALESCE(NULLIF(trim(p_table_zone), ''), CASE WHEN p_table_number <= 9 THEN 'indoor' ELSE 'outdoor' END);

  -- 1.6 Query for existing ACTIVE ticket at this table
  -- STRICT RULE: Closed, Billed, Paid, or Cancelled tickets are NEVER matched or reopened!
  SELECT *
    INTO v_active_ticket
    FROM public.orders
   WHERE order_type = 'table'
     AND table_number = p_table_number
     AND ticket_status IN ('OPEN', 'HOLD')
     AND status NOT IN ('delivered', 'cancelled')
     AND payment_status != 'paid'
     AND created_at >= (now() - interval '12 hours')
   ORDER BY created_at ASC
   LIMIT 1
     FOR UPDATE;

  -- 1.7 Session Decision Logic
  IF FOUND AND v_active_ticket.id IS NOT NULL THEN
    -- Active session exists: attach as next sequential round
    v_is_subsequent := true;
    v_parent_id     := v_active_ticket.id;
    v_order_num     := v_active_ticket.order_number;
    v_zone          := COALESCE(v_active_ticket.table_zone, v_zone);

    -- Calculate round number based on existing non-cancelled orders in this session
    SELECT COALESCE(MAX(
      CASE
        WHEN o.notes ~ '\[ROUND:\s*(\d+)\]'
        THEN (regexp_match(o.notes, '\[ROUND:\s*(\d+)\]'))[1]::integer
        ELSE 1
      END
    ), 1) + 1
    INTO v_round_num
    FROM public.orders o
    WHERE o.order_type = 'table'
      AND o.table_number = p_table_number
      AND (o.id = v_active_ticket.id OR o.notes LIKE '%[PARENT_ORDER_ID: ' || v_active_ticket.id || '%')
      AND o.ticket_status IN ('OPEN', 'HOLD')
      AND o.status != 'cancelled';

    v_round_notes := '[ROUND: ' || v_round_num
                  || '] [PARENT_ORDER_ID: ' || v_active_ticket.id
                  || '] [TABLE: ' || p_table_number || ']';
    IF p_notes IS NOT NULL AND trim(p_notes) <> '' THEN
      v_round_notes := v_round_notes || ' ' || trim(p_notes);
    END IF;

    v_dish_count  := jsonb_array_length(p_items);
    v_notif_title := '🍽️ Table ' || p_table_number || ' - Round ' || v_round_num;
    v_notif_msg   := 'Table ' || p_table_number || ' (' || UPPER(v_zone) || ') placed Round ' || v_round_num
                  || ' (' || v_dish_count || ' item' || CASE WHEN v_dish_count > 1 THEN 's' ELSE '' END || ' · ₹' || v_round_total || ')';

  ELSE
    -- No active ticket exists (or previous session was closed/cancelled) -> Brand new session!
    v_is_subsequent := false;
    v_parent_id     := NULL;
    v_round_num     := 1;
    v_order_num     := (SELECT COALESCE(MAX(order_number), 1000) + 1 FROM public.orders);

    v_round_notes := '[ROUND: 1] [TABLE: ' || p_table_number || ']';
    IF p_notes IS NOT NULL AND trim(p_notes) <> '' THEN
      v_round_notes := v_round_notes || ' ' || trim(p_notes);
    END IF;

    v_dish_count  := jsonb_array_length(p_items);
    v_notif_title := '🍽️ Table ' || p_table_number || ' - New Order';
    v_notif_msg   := 'New Dine-In Order received for ₹' || v_round_total
                  || ' at Table ' || p_table_number || ' (' || UPPER(v_zone) || ')';
  END IF;

  -- 1.8 Insert Order Header Record
  INSERT INTO public.orders (
    order_number,
    customer_name,
    customer_phone,
    order_type,
    table_number,
    table_zone,
    total_amount,
    status,
    payment_status,
    ticket_status,
    notes,
    idempotency_key
  )
  VALUES (
    v_order_num,
    COALESCE(NULLIF(trim(p_customer_name), ''), CASE WHEN v_active_ticket.customer_name IS NOT NULL THEN v_active_ticket.customer_name ELSE 'Dine-in Guest' END),
    COALESCE(NULLIF(trim(p_customer_phone), ''), CASE WHEN v_active_ticket.customer_phone IS NOT NULL THEN v_active_ticket.customer_phone ELSE '0000000000' END),
    'table',
    p_table_number,
    v_zone,
    v_round_total,
    'pending',
    'unpaid',
    'OPEN',
    v_round_notes,
    v_clean_key
  )
  RETURNING * INTO v_new_order;

  -- 1.9 Insert Order Items
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.order_items (
      order_id,
      menu_item_id,
      item_name,
      quantity,
      unit_price,
      line_total
    )
    VALUES (
      v_new_order.id,
      CASE WHEN v_item ? 'menu_item_id' AND v_item->>'menu_item_id' IS NOT NULL
           THEN (v_item->>'menu_item_id')::integer ELSE NULL END,
      v_item->>'item_name',
      GREATEST(COALESCE((v_item->>'quantity')::integer, (v_item->>'qty')::integer, 1), 1),
      COALESCE((v_item->>'unit_price')::numeric, (v_item->>'price')::numeric, 0),
      COALESCE((v_item->>'line_total')::numeric, 0)
    );
  END LOOP;

  -- 1.10 Insert Staff Notification (Reflects committed state)
  INSERT INTO public.notifications (
    type,
    title,
    message,
    description,
    order_id,
    item_id,
    customer_phone,
    is_read
  )
  VALUES (
    'order',
    v_notif_title,
    v_notif_msg,
    v_notif_msg,
    v_new_order.id,
    'order-' || v_new_order.id::text,
    v_new_order.customer_phone,
    false
  );

  -- 1.11 Return Structured Session Lifecycle Response
  RETURN jsonb_build_object(
    'id',                  v_new_order.id,
    'order_number',        v_new_order.order_number,
    'session_id',          COALESCE(v_parent_id, v_new_order.id),
    'total_amount',        v_new_order.total_amount,
    'status',              v_new_order.status,
    'ticket_status',       v_new_order.ticket_status,
    'round_number',        v_round_num,
    'parent_order_id',     v_parent_id,
    'is_subsequent_round', v_is_subsequent,
    'idempotent_replay',   false,
    'table_number',        p_table_number,
    'table_zone',          v_zone
  );
END;
$$;

-- Overload for backward compatibility with 7 arguments
CREATE OR REPLACE FUNCTION public.place_table_round(
  p_table_number   integer,
  p_table_zone     text,
  p_customer_name  text,
  p_customer_phone text,
  p_items          jsonb,
  p_notes          text,
  p_round_number   integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.place_table_round(
    p_table_number, p_table_zone, p_customer_name, p_customer_phone, p_items, p_notes, p_round_number, NULL
  );
END;
$$;

-- Overload for backward compatibility with 6 arguments
CREATE OR REPLACE FUNCTION public.place_table_round(
  p_table_number   integer,
  p_table_zone     text,
  p_customer_name  text,
  p_customer_phone text,
  p_items          jsonb,
  p_notes          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.place_table_round(
    p_table_number, p_table_zone, p_customer_name, p_customer_phone, p_items, p_notes, 1, NULL
  );
END;
$$;


-- 2. CREATE request_table_service RPC (CALL WAITER & REQUEST BILL)
-- Routes immediate service signals to POS & Admin dashboards.
-- Correctly associates with active table session if present,
-- safely alerts staff even if table is currently empty or closed,
-- and enforces rate-limiting against duplicate spam.
CREATE OR REPLACE FUNCTION public.request_table_service(
  p_table_number  integer,
  p_service_type  text,
  p_customer_name text DEFAULT NULL,
  p_notes         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_active_ticket  public.orders%ROWTYPE;
  v_title          text;
  v_msg            text;
  v_recent_exists  boolean := false;
  v_notif          public.notifications%ROWTYPE;
  v_zone           text;
BEGIN
  -- 2.1 Input Validation
  IF p_table_number IS NULL OR p_table_number < 1 OR p_table_number > 19 THEN
    RAISE EXCEPTION 'Invalid table number: %. Must be between 1 and 19', p_table_number;
  END IF;

  IF p_service_type NOT IN ('call_waiter', 'request_bill') THEN
    RAISE EXCEPTION 'Invalid service type: %. Must be call_waiter or request_bill', p_service_type;
  END IF;

  v_zone := CASE WHEN p_table_number <= 9 THEN 'Indoor' ELSE 'Outdoor' END;

  -- 2.2 Rate-limiting: prevent flooding notifications within 60 seconds
  SELECT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE item_id = 'table-' || p_table_number
      AND type = p_service_type
      AND is_read = false
      AND created_at >= (now() - interval '60 seconds')
  ) INTO v_recent_exists;

  IF v_recent_exists THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_notified', true,
      'message', CASE 
        WHEN p_service_type = 'call_waiter' 
          THEN 'Staff has already been notified for Table ' || p_table_number || '. A waiter is on the way!'
        ELSE 'Bill request already received for Table ' || p_table_number || '. Cashier is preparing your bill!'
      END,
      'table_number', p_table_number,
      'service_type', p_service_type
    );
  END IF;

  -- 2.3 Query for active table session
  SELECT *
    INTO v_active_ticket
    FROM public.orders
   WHERE order_type = 'table'
     AND table_number = p_table_number
     AND ticket_status IN ('OPEN', 'HOLD')
     AND status NOT IN ('delivered', 'cancelled')
     AND payment_status != 'paid'
     AND created_at >= (now() - interval '12 hours')
   ORDER BY created_at ASC
   LIMIT 1;

  -- 2.4 Construct Notification
  IF v_active_ticket.id IS NOT NULL THEN
    -- Active session exists
    IF p_service_type = 'call_waiter' THEN
      v_title := '🔔 Table ' || p_table_number || ' - Waiter Called';
      v_msg   := 'Table ' || p_table_number || ' (' || v_zone || ' · Order #' || v_active_ticket.order_number || ') is calling for a waiter.';
    ELSE
      v_title := '🧾 Table ' || p_table_number || ' - Bill Requested';
      v_msg   := 'Table ' || p_table_number || ' (' || v_zone || ' · Order #' || v_active_ticket.order_number || ') has requested the bill (₹' || v_active_ticket.total_amount || ').';
    END IF;
  ELSE
    -- No active ticket (empty table or closed ticket)
    IF p_service_type = 'call_waiter' THEN
      v_title := '🔔 Table ' || p_table_number || ' - Waiter Called';
      v_msg   := 'Guest at Table ' || p_table_number || ' (' || v_zone || ') is requesting a waiter (no active food order).';
    ELSE
      v_title := '🧾 Table ' || p_table_number || ' - Bill Requested';
      v_msg   := 'Guest at Table ' || p_table_number || ' (' || v_zone || ') requested bill, but no active order is open.';
    END IF;
  END IF;

  IF p_notes IS NOT NULL AND trim(p_notes) <> '' THEN
    v_msg := v_msg || ' Note: ' || trim(p_notes);
  END IF;

  -- 2.5 Insert Notification into Database
  INSERT INTO public.notifications (
    type,
    title,
    message,
    description,
    order_id,
    item_id,
    customer_phone,
    is_read,
    created_at
  )
  VALUES (
    p_service_type,
    v_title,
    v_msg,
    v_msg,
    v_active_ticket.id,
    'table-' || p_table_number,
    COALESCE(v_active_ticket.customer_phone, '0000000000'),
    false,
    now()
  )
  RETURNING * INTO v_notif;

  RETURN jsonb_build_object(
    'success',            true,
    'already_notified',   false,
    'notification_id',    v_notif.id,
    'table_number',       p_table_number,
    'table_zone',         v_zone,
    'service_type',       p_service_type,
    'has_active_session', (v_active_ticket.id IS NOT NULL),
    'order_id',           v_active_ticket.id,
    'order_number',       v_active_ticket.order_number,
    'session_id',         v_active_ticket.id,
    'message',            CASE
      WHEN p_service_type = 'call_waiter'
        THEN 'Waiter has been called to Table ' || p_table_number || '! 🔔 Staff will assist you shortly.'
      ELSE 'Bill requested for Table ' || p_table_number || '! 🧾 Cashier will bring your bill.'
    END
  );
END;
$$;

-- 3. GRANT PERMISSIONS
GRANT EXECUTE ON FUNCTION public.place_table_round(integer, text, text, text, jsonb, text, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_table_round(integer, text, text, text, jsonb, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_table_round(integer, text, text, text, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_table_service(integer, text, text, text) TO anon, authenticated;
