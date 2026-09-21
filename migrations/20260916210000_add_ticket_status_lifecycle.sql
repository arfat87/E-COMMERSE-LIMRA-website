-- Migration: 20260916210000_add_ticket_status_lifecycle.sql
-- Add explicit ticket_status column to orders table, backfill existing records,
-- add constraint trigger preventing attachment to closed/cancelled tickets,
-- and upgrade place_table_round RPC to enforce server-side round lifecycle.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ADD ticket_status COLUMN & INDEX
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS ticket_status TEXT DEFAULT 'OPEN';

-- Add check constraint for valid lifecycle values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_ticket_status'
  ) THEN
    ALTER TABLE public.orders
    ADD CONSTRAINT chk_orders_ticket_status
    CHECK (ticket_status IN ('OPEN', 'HOLD', 'BILLED', 'PAID', 'CLOSED', 'CANCELLED'));
  END IF;
END $$;

-- Add index for fast active-ticket lookups by table
CREATE INDEX IF NOT EXISTS idx_orders_table_ticket_status
ON public.orders (table_number, ticket_status)
WHERE order_type = 'table';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BACKFILL EXISTING ORDERS (SAFE & ADDITIVE)
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1 Cancelled orders -> CANCELLED
UPDATE public.orders
SET ticket_status = 'CANCELLED'
WHERE status = 'cancelled';

-- 2.2 Delivered or completed orders -> CLOSED
UPDATE public.orders
SET ticket_status = 'CLOSED'
WHERE status IN ('delivered', 'closed')
  AND ticket_status <> 'CANCELLED';

-- 2.3 Historical paid orders (older than 6 hours) -> CLOSED
UPDATE public.orders
SET ticket_status = 'CLOSED'
WHERE payment_status = 'paid'
  AND created_at < (now() - interval '6 hours')
  AND ticket_status NOT IN ('CANCELLED', 'CLOSED');

-- 2.4 Hold orders -> HOLD
UPDATE public.orders
SET ticket_status = 'HOLD'
WHERE status = 'hold'
  AND ticket_status NOT IN ('CANCELLED', 'CLOSED');

-- 2.5 Paid recent orders -> PAID
UPDATE public.orders
SET ticket_status = 'PAID'
WHERE payment_status = 'paid'
  AND created_at >= (now() - interval '6 hours')
  AND ticket_status NOT IN ('CANCELLED', 'CLOSED', 'HOLD');

-- 2.6 Active recent orders -> OPEN
UPDATE public.orders
SET ticket_status = 'OPEN'
WHERE status IN ('pending', 'confirmed', 'preparing', 'ready')
  AND created_at >= (now() - interval '6 hours')
  AND (ticket_status IS NULL OR ticket_status = 'OPEN');

-- 2.7 Any remaining old orders (>12 hours old) defaulted to CLOSED
UPDATE public.orders
SET ticket_status = 'CLOSED'
WHERE created_at < (now() - interval '12 hours')
  AND ticket_status NOT IN ('CANCELLED', 'CLOSED');

-- Ensure no nulls
UPDATE public.orders
SET ticket_status = 'OPEN'
WHERE ticket_status IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TRIGGER: PREVENT INSERTING ITEMS INTO CLOSED OR CANCELLED TICKETS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_ticket_not_closed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ticket_status text;
BEGIN
  SELECT ticket_status INTO v_ticket_status
  FROM public.orders
  WHERE id = NEW.order_id;

  IF v_ticket_status IN ('CLOSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot attach items to a % ticket (order_id: %)', v_ticket_status, NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_ticket_not_closed ON public.order_items;
CREATE TRIGGER trg_check_ticket_not_closed
  BEFORE INSERT ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.check_ticket_not_closed();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. UPGRADE place_table_round RPC (SERVER-SIDE DECISION LOGIC)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.place_table_round(
  p_table_number   integer,
  p_table_zone     text    DEFAULT 'indoor',
  p_customer_name  text    DEFAULT 'Dine-in Guest',
  p_customer_phone text    DEFAULT '0000000000',
  p_items          jsonb   DEFAULT '[]'::jsonb,
  p_notes          text    DEFAULT NULL,
  p_round_number   integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_active_ticket  public.orders%ROWTYPE;
  v_new_order      public.orders%ROWTYPE;
  v_item           jsonb;
  v_round_total    numeric := 0;
  v_round_num      integer := 1;
  v_dish_count     integer;
  v_notif_title    text;
  v_notif_msg      text;
  v_round_notes    text;
  v_is_subsequent  boolean := false;
  v_parent_id      uuid    := NULL;
  v_order_num      integer;
BEGIN
  -- 4.1 Validate input
  IF p_table_number IS NULL OR p_table_number < 1 THEN
    RAISE EXCEPTION 'Invalid table number';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  -- 4.2 Compute total amount
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_round_total := v_round_total + COALESCE((v_item->>'line_total')::numeric, 0);
  END LOOP;

  -- 4.3 Query for active unbilled ticket at this table (OPEN or HOLD)
  SELECT *
    INTO v_active_ticket
    FROM public.orders
   WHERE order_type = 'table'
     AND table_number = p_table_number
     AND ticket_status IN ('OPEN', 'HOLD')
     AND created_at >= (now() - interval '12 hours')
   ORDER BY created_at ASC
   LIMIT 1
     FOR UPDATE SKIP LOCKED;

  -- 4.4 Decision Logic
  IF FOUND AND v_active_ticket.id IS NOT NULL THEN
    -- Table has an active ticket -> Attach as next round
    v_is_subsequent := true;
    v_parent_id     := v_active_ticket.id;
    v_order_num     := v_active_ticket.order_number;

    -- Calculate round number based on existing orders in this active ticket session
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
      AND (o.id = v_active_ticket.id OR o.notes LIKE '%[PARENT_ORDER_ID: ' || v_active_ticket.id || '%');

    v_round_notes := '[ROUND: ' || v_round_num
                  || '] [PARENT_ORDER_ID: ' || v_active_ticket.id
                  || '] [TABLE: ' || p_table_number || ']';
    IF p_notes IS NOT NULL AND trim(p_notes) <> '' THEN
      v_round_notes := v_round_notes || ' ' || trim(p_notes);
    END IF;

    v_dish_count  := jsonb_array_length(p_items);
    v_notif_title := '🍽️ Table ' || p_table_number || ' - Round ' || v_round_num;
    v_notif_msg   := 'Table ' || p_table_number || ' placed Round ' || v_round_num
                  || ' (' || v_dish_count || ' item' || CASE WHEN v_dish_count > 1 THEN 's' ELSE '' END || ')';

  ELSE
    -- No active ticket (or previous ticket was BILLED/PAID/CLOSED/CANCELLED) -> Brand new ticket
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
                  || ' at Table ' || p_table_number;
  END IF;

  -- 4.5 Insert order record
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
    notes
  )
  VALUES (
    v_order_num,
    COALESCE(NULLIF(trim(p_customer_name), ''), CASE WHEN v_active_ticket.customer_name IS NOT NULL THEN v_active_ticket.customer_name ELSE 'Dine-in Guest' END),
    COALESCE(NULLIF(trim(p_customer_phone), ''), CASE WHEN v_active_ticket.customer_phone IS NOT NULL THEN v_active_ticket.customer_phone ELSE '0000000000' END),
    'table',
    p_table_number,
    COALESCE(NULLIF(trim(p_table_zone), ''), CASE WHEN v_active_ticket.table_zone IS NOT NULL THEN v_active_ticket.table_zone ELSE 'indoor' END),
    v_round_total,
    'pending',
    'unpaid',
    'OPEN',
    v_round_notes
  )
  RETURNING * INTO v_new_order;

  -- 4.6 Insert order items
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

  -- 4.7 Insert staff notification
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
    v_new_order.id::text,
    v_new_order.customer_phone,
    false
  );

  -- 4.8 Return structured response
  RETURN jsonb_build_object(
    'id',                  v_new_order.id,
    'order_number',        v_new_order.order_number,
    'total_amount',        v_new_order.total_amount,
    'status',              v_new_order.status,
    'ticket_status',       v_new_order.ticket_status,
    'round_number',        v_round_num,
    'parent_order_id',     v_parent_id,
    'is_subsequent_round', v_is_subsequent
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_table_round(integer, text, text, text, jsonb, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_table_round(integer, text, text, text, jsonb, text) TO anon, authenticated;
