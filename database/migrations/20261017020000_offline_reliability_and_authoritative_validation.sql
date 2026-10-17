-- =============================================================================
-- MIGRATION: 20261017020000_offline_reliability_and_authoritative_validation.sql
-- Description: Enforce server-authoritative price & availability validation in
--              place_order and place_table_round RPCs to prevent stale client
--              caches from bypassing sold-out states or price updates.
-- =============================================================================

-- 1. UPGRADE place_order RPC WITH SERVER-AUTHORITATIVE PRICE & AVAILABILITY CHECK
CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_name    text,
  p_customer_phone   text,
  p_notes            text    DEFAULT NULL,
  p_items            jsonb   DEFAULT '[]'::jsonb,
  p_latitude         numeric DEFAULT NULL,
  p_longitude        numeric DEFAULT NULL,
  p_landmark         text    DEFAULT NULL,
  p_delivery_notes   text    DEFAULT NULL,
  p_location_verified boolean DEFAULT false,
  p_order_type       text    DEFAULT 'delivery',
  p_table_number     integer DEFAULT NULL,
  p_table_zone       text    DEFAULT NULL,
  p_txn_ref          text    DEFAULT NULL,
  p_idempotency_key  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order              public.orders%ROWTYPE;
  v_item               jsonb;
  v_item_id            integer;
  v_override_price     numeric;
  v_is_available       boolean;
  v_item_price         numeric;
  v_item_qty           integer;
  v_item_total         numeric;
  v_total              numeric := 0;
  v_clean_key          text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_verified_payment   public.verified_payments%ROWTYPE;
  v_initial_pay_status text := 'unpaid';
  v_initial_pay_method text := 'cash';
  v_item_name          text;
BEGIN
  -- 1.1 Idempotency Replay Protection
  IF v_clean_key IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE idempotency_key = v_clean_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'id', v_order.id,
        'order_number', v_order.order_number,
        'customer_name', v_order.customer_name,
        'customer_phone', v_order.customer_phone,
        'total_amount', v_order.total_amount,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'ticket_status', v_order.ticket_status,
        'idempotent_replay', true,
        'created_at', v_order.created_at
      );
    END IF;
  END IF;

  -- 1.2 Basic input validation
  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;
  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  -- 1.3 Validate each item and calculate server-authoritative total
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id   := NULLIF(v_item->>'menu_item_id', '')::integer;
    v_item_name := COALESCE(v_item->>'item_name', v_item->>'name', 'Item');
    v_item_qty  := GREATEST(1, COALESCE((v_item->>'quantity')::integer, (v_item->>'qty')::integer, 1));
    v_item_price := COALESCE((v_item->>'unit_price')::numeric, (v_item->>'price')::numeric, 0);

    -- If menu_item_id is mapped, enforce database availability and authoritative price
    IF v_item_id IS NOT NULL AND v_item_id < 9000 THEN
      SELECT available, price
        INTO v_is_available, v_override_price
        FROM public.menu_overrides
       WHERE id = v_item_id;

      IF FOUND THEN
        IF v_is_available = false THEN
          RAISE EXCEPTION 'Item "%" is currently sold out / unavailable', v_item_name;
        END IF;
        IF v_override_price IS NOT NULL THEN
          v_item_price := v_override_price;
        END IF;
      END IF;
    END IF;

    v_item_total := v_item_qty * v_item_price;
    v_total := v_total + v_item_total;
  END LOOP;

  -- 1.4 Strict payment verification against verified_payments (anti-forgery & anti-replay)
  IF p_txn_ref IS NOT NULL AND trim(p_txn_ref) <> '' THEN
    SELECT * INTO v_verified_payment
    FROM public.verified_payments
    WHERE utr = trim(p_txn_ref)
      AND status = 'success'
      AND amount >= v_total
      AND order_id IS NULL
    FOR UPDATE;

    IF FOUND THEN
      v_initial_pay_status := 'paid';
      v_initial_pay_method := 'online';
    ELSE
      v_initial_pay_status := 'unpaid';
      v_initial_pay_method := 'cash';
    END IF;
  END IF;

  -- 1.5 Insert Order Header
  INSERT INTO public.orders (
    customer_name, customer_phone, total_amount, notes, status,
    latitude, longitude, landmark, delivery_notes, location_verified,
    order_type, table_number, table_zone, user_id, txn_ref,
    payment_status, payment_method, ticket_status, idempotency_key
  )
  VALUES (
    trim(p_customer_name),
    trim(p_customer_phone),
    v_total,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    'pending',
    p_latitude,
    p_longitude,
    p_landmark,
    p_delivery_notes,
    p_location_verified,
    COALESCE(p_order_type, 'delivery'),
    p_table_number,
    p_table_zone,
    auth.uid(),
    trim(COALESCE(p_txn_ref, '')),
    v_initial_pay_status,
    v_initial_pay_method,
    'OPEN',
    v_clean_key
  )
  RETURNING * INTO v_order;

  -- 1.6 Associate verified payment if verified
  IF v_verified_payment.id IS NOT NULL THEN
    UPDATE public.verified_payments
    SET order_id = v_order.id
    WHERE id = v_verified_payment.id;
  END IF;

  -- 1.7 Insert Order Items
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id   := NULLIF(v_item->>'menu_item_id', '')::integer;
    v_item_name := COALESCE(v_item->>'item_name', v_item->>'name', 'Item');
    v_item_qty  := GREATEST(1, COALESCE((v_item->>'quantity')::integer, (v_item->>'qty')::integer, 1));
    v_item_price := COALESCE((v_item->>'unit_price')::numeric, (v_item->>'price')::numeric, 0);

    IF v_item_id IS NOT NULL AND v_item_id < 9000 THEN
      SELECT price INTO v_override_price FROM public.menu_overrides WHERE id = v_item_id;
      IF FOUND AND v_override_price IS NOT NULL THEN
        v_item_price := v_override_price;
      END IF;
    END IF;

    INSERT INTO public.order_items (
      order_id, item_name, quantity, unit_price, line_total, menu_item_id
    )
    VALUES (
      v_order.id,
      v_item_name,
      v_item_qty,
      v_item_price,
      (v_item_qty * v_item_price),
      v_item_id
    );
  END LOOP;

  -- 1.8 Create In-App Notification
  INSERT INTO public.notifications (
    title, message, type, order_id, read
  )
  VALUES (
    'New Order #' || v_order.order_number,
    'Order of ₹' || v_total::text || ' received from ' || trim(p_customer_name),
    'order',
    v_order.id,
    false
  );

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'customer_name', v_order.customer_name,
    'customer_phone', v_order.customer_phone,
    'total_amount', v_order.total_amount,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'ticket_status', v_order.ticket_status,
    'idempotent_replay', false,
    'created_at', v_order.created_at
  );
END;
$$;


-- 2. UPGRADE place_table_round RPC WITH SERVER-AUTHORITATIVE PRICE & AVAILABILITY CHECK
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
  v_item_id         integer;
  v_override_price  numeric;
  v_is_available    boolean;
  v_item_price      numeric;
  v_item_qty        integer;
  v_item_total      numeric;
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
  v_item_name       text;
BEGIN
  -- 2.1 Input Validation
  IF p_table_number IS NULL OR p_table_number < 1 OR p_table_number > 19 THEN
    RAISE EXCEPTION 'Invalid table number: %. Must be between 1 and 19', p_table_number;
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  -- 2.2 Idempotency Replay Protection
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

  -- 2.3 Advisory Transaction Lock
  PERFORM pg_advisory_xact_lock(hashtext('limra_table_session_' || p_table_number::text));

  -- 2.4 Validate items and compute round total authoritatively
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id   := NULLIF(v_item->>'menu_item_id', '')::integer;
    v_item_name := COALESCE(v_item->>'item_name', v_item->>'name', 'Item');
    v_item_qty  := GREATEST(1, COALESCE((v_item->>'quantity')::integer, (v_item->>'qty')::integer, 1));
    v_item_price := COALESCE((v_item->>'unit_price')::numeric, (v_item->>'price')::numeric, 0);

    IF v_item_id IS NOT NULL AND v_item_id < 9000 THEN
      SELECT available, price
        INTO v_is_available, v_override_price
        FROM public.menu_overrides
       WHERE id = v_item_id;

      IF FOUND THEN
        IF v_is_available = false THEN
          RAISE EXCEPTION 'Item "%" is currently sold out / unavailable', v_item_name;
        END IF;
        IF v_override_price IS NOT NULL THEN
          v_item_price := v_override_price;
        END IF;
      END IF;
    END IF;

    v_item_total := v_item_qty * v_item_price;
    v_round_total := v_round_total + v_item_total;
  END LOOP;

  -- 2.5 Determine Table Zone
  v_zone := COALESCE(NULLIF(trim(p_table_zone), ''), CASE WHEN p_table_number <= 9 THEN 'indoor' ELSE 'outdoor' END);

  -- 2.6 Query for existing ACTIVE ticket at this table
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

  IF FOUND AND v_active_ticket.id IS NOT NULL THEN
    v_is_subsequent := true;
    v_parent_id     := v_active_ticket.id;
    v_order_num     := v_active_ticket.order_number;
    v_zone          := COALESCE(v_active_ticket.table_zone, v_zone);

    SELECT COUNT(*) + 1
      INTO v_round_num
      FROM public.orders
     WHERE order_type = 'table'
       AND table_number = p_table_number
       AND status NOT IN ('cancelled')
       AND (id = v_active_ticket.id OR notes LIKE '%[PARENT_ORDER_ID: ' || v_active_ticket.id::text || ']%');
  ELSE
    v_is_subsequent := false;
    v_parent_id     := NULL;
    v_order_num     := NULL;
    v_round_num     := 1;
  END IF;

  v_round_notes := '[ROUND: ' || v_round_num::text || ']';
  IF v_parent_id IS NOT NULL THEN
    v_round_notes := v_round_notes || ' [PARENT_ORDER_ID: ' || v_parent_id::text || ']';
  END IF;
  IF p_notes IS NOT NULL AND trim(p_notes) <> '' THEN
    v_round_notes := v_round_notes || ' | ' || trim(p_notes);
  END IF;

  -- 2.7 Insert the round order
  INSERT INTO public.orders (
    customer_name, customer_phone, total_amount, notes, status,
    order_type, table_number, table_zone, payment_status, payment_method,
    ticket_status, idempotency_key, created_at, updated_at
  )
  VALUES (
    COALESCE(NULLIF(trim(p_customer_name), ''), 'Dine-in Guest'),
    COALESCE(NULLIF(trim(p_customer_phone), ''), '0000000000'),
    v_round_total,
    v_round_notes,
    'pending',
    'table',
    p_table_number,
    v_zone,
    'unpaid',
    'cash',
    'OPEN',
    v_clean_key,
    now(),
    now()
  )
  RETURNING * INTO v_new_order;

  -- 2.8 Insert the order items
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id   := NULLIF(v_item->>'menu_item_id', '')::integer;
    v_item_name := COALESCE(v_item->>'item_name', v_item->>'name', 'Item');
    v_item_qty  := GREATEST(1, COALESCE((v_item->>'quantity')::integer, (v_item->>'qty')::integer, 1));
    v_item_price := COALESCE((v_item->>'unit_price')::numeric, (v_item->>'price')::numeric, 0);

    IF v_item_id IS NOT NULL AND v_item_id < 9000 THEN
      SELECT price INTO v_override_price FROM public.menu_overrides WHERE id = v_item_id;
      IF FOUND AND v_override_price IS NOT NULL THEN
        v_item_price := v_override_price;
      END IF;
    END IF;

    INSERT INTO public.order_items (
      order_id, item_name, quantity, unit_price, line_total, menu_item_id
    )
    VALUES (
      v_new_order.id,
      v_item_name,
      v_item_qty,
      v_item_price,
      (v_item_qty * v_item_price),
      v_item_id
    );
  END LOOP;

  -- 2.9 Notifications
  SELECT COUNT(*) INTO v_dish_count FROM jsonb_array_elements(p_items);
  IF v_round_num = 1 THEN
    v_notif_title := 'Table ' || p_table_number::text || ' — New Table Order (#' || v_new_order.order_number::text || ')';
    v_notif_msg   := v_dish_count::text || ' dishes ordered (₹' || v_round_total::text || ') — ' || v_zone || ' zone';
  ELSE
    v_notif_title := 'Table ' || p_table_number::text || ' — Round ' || v_round_num::text || ' Added (Order #' || v_new_order.order_number::text || ')';
    v_notif_msg   := '+' || v_dish_count::text || ' more dishes ordered for kitchen (₹' || v_round_total::text || ')';
  END IF;

  INSERT INTO public.notifications (
    title, message, type, order_id, read, created_at
  )
  VALUES (
    v_notif_title,
    v_notif_msg,
    'table_order',
    v_new_order.id,
    false,
    now()
  );

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
    'table_number',        v_new_order.table_number,
    'table_zone',          v_new_order.table_zone
  );
END;
$$;
