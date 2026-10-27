-- =============================================================================
-- MIGRATION: 20261017040000_billing_gst_discounts_state_integrity.sql
-- Description: Authoritative billing, GST tax calculation, proportional discount
--              allocation, and state machine transition integrity for LIMRA Restaurant.
-- =============================================================================

-- 1. STATE MACHINE TRANSITION INTEGRITY TRIGGER ON ORDERS
CREATE OR REPLACE FUNCTION public.validate_order_state_transitions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 1.1 Payment Status Transition Invariants
  -- Cannot revert settled 'paid' orders back to 'unpaid'
  IF OLD.payment_status = 'paid' AND NEW.payment_status = 'unpaid' THEN
    RAISE EXCEPTION 'Invalid payment transition: Settled paid orders cannot be reverted to unpaid. Use refund workflow instead.';
  END IF;

  -- Cannot alter 'refunded' orders back to paid or unpaid
  IF OLD.payment_status = 'refunded' AND NEW.payment_status <> 'refunded' THEN
    RAISE EXCEPTION 'Invalid payment transition: Refunded orders cannot be altered back to paid or unpaid.';
  END IF;

  -- 1.2 Ticket Lifecycle Transition Invariants
  -- Closed tickets cannot be reopened
  IF OLD.ticket_status = 'CLOSED' AND NEW.ticket_status <> 'CLOSED' THEN
    RAISE EXCEPTION 'Invalid ticket transition: Closed tickets cannot be reopened.';
  END IF;

  -- Cancelled tickets cannot be reopened
  IF OLD.ticket_status = 'CANCELLED' AND NEW.ticket_status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'Invalid ticket transition: Cancelled tickets cannot be reopened.';
  END IF;

  -- Closed ticket total_amount cannot be tampered with
  IF OLD.ticket_status = 'CLOSED' AND NEW.total_amount <> OLD.total_amount THEN
    RAISE EXCEPTION 'Invalid operation: Total amount of a closed ticket cannot be modified.';
  END IF;

  -- 1.3 Fulfillment Status Transition Invariants
  -- Cancelled orders cannot be un-cancelled
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Invalid fulfillment transition: Cancelled orders cannot be reactivated.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_order_state_transitions ON public.orders;
CREATE TRIGGER trg_validate_order_state_transitions
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_order_state_transitions();


-- 2. UPGRADE place_order RPC WITH AUTHORITATIVE GST & PROPORTIONAL DISCOUNT CALCULATION
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
  v_subtotal           numeric := 0;
  v_taxable_subtotal   numeric := 0;
  v_is_taxable         boolean := true;
  v_discount_amt       numeric := 0;
  v_discount_pct       numeric := 0;
  v_taxable_discount   numeric := 0;
  v_net_taxable        numeric := 0;
  v_cgst               numeric := 0;
  v_sgst               numeric := 0;
  v_total_gst          numeric := 0;
  v_delivery_fee       numeric := 0;
  v_grand_total        numeric := 0;
  v_clean_key          text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_verified_payment   public.verified_payments%ROWTYPE;
  v_initial_pay_status text := 'unpaid';
  v_initial_pay_method text := 'cash';
  v_item_name          text;
  v_raw_notes          text := COALESCE(p_notes, '');
  v_match              text[];
  v_coupon_code        text;
  v_coupon             public.coupons%ROWTYPE;
BEGIN
  -- 2.1 Idempotency Replay Protection
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

  -- 2.2 Basic input validation
  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;
  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  -- 2.3 Parse Delivery Fee, Discounts, and Coupons from Notes metadata
  -- Delivery Fee
  IF p_order_type = 'delivery' THEN
    v_match := regexp_matches(v_raw_notes, '\[(?:DELIVERY_FEE|DELIVERY_CHARGE):\s*([0-9.]+)\]', 'i');
    IF v_match IS NOT NULL AND array_length(v_match, 1) > 0 THEN
      v_delivery_fee := GREATEST(0, v_match[1]::numeric);
    ELSE
      v_match := regexp_matches(v_raw_notes, 'Delivery\s*(?:charge|fee):\s*₹?\s*([0-9.]+)', 'i');
      IF v_match IS NOT NULL AND array_length(v_match, 1) > 0 THEN
        v_delivery_fee := GREATEST(0, v_match[1]::numeric);
      END IF;
    END IF;
  ELSE
    v_delivery_fee := 0;
  END IF;

  -- Coupon check
  v_match := regexp_matches(v_raw_notes, '\[COUPON:\s*([^\]|]+)\]', 'i');
  IF v_match IS NOT NULL AND array_length(v_match, 1) > 0 THEN
    v_coupon_code := trim(v_match[1]);
    SELECT * INTO v_coupon
    FROM public.coupons
    WHERE code = v_coupon_code
      AND active = true
      AND (expiry_date IS NULL OR expiry_date > now());
    IF FOUND THEN
      v_discount_pct := v_coupon.discount_pct;
    END IF;
  END IF;

  -- Discount percent / amount fallback if coupon not found
  IF v_discount_pct = 0 THEN
    v_match := regexp_matches(v_raw_notes, '\[(?:DISCOUNT_PCT|DISCOUNT):\s*([0-9.]+)%?\]', 'i');
    IF v_match IS NOT NULL AND array_length(v_match, 1) > 0 THEN
      v_discount_pct := v_match[1]::numeric;
    END IF;
  END IF;

  v_match := regexp_matches(v_raw_notes, '\[DISCOUNT_AMT:\s*([0-9.]+)\]', 'i');
  IF v_match IS NOT NULL AND array_length(v_match, 1) > 0 THEN
    v_discount_amt := v_match[1]::numeric;
  END IF;

  -- 2.4 Validate each item and calculate server-authoritative subtotal and taxability
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id   := NULLIF(v_item->>'menu_item_id', '')::integer;
    v_item_name := COALESCE(v_item->>'item_name', v_item->>'name', 'Item');
    v_item_qty  := GREATEST(1, COALESCE((v_item->>'quantity')::integer, (v_item->>'qty')::integer, 1));
    v_item_price := COALESCE((v_item->>'unit_price')::numeric, (v_item->>'price')::numeric, 0);

    -- Taxability check: taxable unless marked false or note has [NO_GST]
    v_is_taxable := COALESCE((v_item->>'gst_applicable')::boolean, true);
    IF (v_item->>'notes') IS NOT NULL AND (v_item->>'notes') LIKE '%[NO_GST]%' THEN
      v_is_taxable := false;
    END IF;

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

    v_item_total := round((v_item_qty * v_item_price), 2);
    v_subtotal := v_subtotal + v_item_total;
    IF v_is_taxable THEN
      v_taxable_subtotal := v_taxable_subtotal + v_item_total;
    END IF;
  END LOOP;

  -- 2.5 Compute Discount & Proportional Allocation
  IF v_coupon.code IS NOT NULL AND v_subtotal >= v_coupon.min_bill THEN
    v_discount_amt := round(v_subtotal * (v_coupon.discount_pct / 100.0), 2);
  ELSIF v_discount_amt = 0 AND v_discount_pct > 0 THEN
    v_discount_amt := round(v_subtotal * (v_discount_pct / 100.0), 2);
  END IF;
  v_discount_amt := LEAST(v_subtotal, GREATEST(0, v_discount_amt));

  -- Proportional allocation across taxable subtotal
  IF v_subtotal > 0 AND v_discount_amt > 0 THEN
    v_taxable_discount := round(v_discount_amt * (v_taxable_subtotal / v_subtotal), 2);
  ELSE
    v_taxable_discount := 0;
  END IF;

  v_net_taxable := GREATEST(0, v_taxable_subtotal - v_taxable_discount);

  -- 2.6 Calculate GST (5% Intrastate: 2.5% CGST + 2.5% SGST)
  v_cgst := round(v_net_taxable * 0.025, 2);
  v_sgst := round(v_net_taxable * 0.025, 2);
  v_total_gst := v_cgst + v_sgst;

  -- 2.7 Grand Total
  v_grand_total := round((v_subtotal - v_discount_amt) + v_total_gst + v_delivery_fee, 2);

  -- 2.8 Strict payment verification against verified_payments (anti-forgery & anti-replay)
  IF p_txn_ref IS NOT NULL AND trim(p_txn_ref) <> '' THEN
    SELECT * INTO v_verified_payment
    FROM public.verified_payments
    WHERE utr = trim(p_txn_ref)
      AND status = 'success'
      AND amount >= v_grand_total
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

  -- 2.9 Insert Order Header with Authoritative Grand Total
  INSERT INTO public.orders (
    customer_name, customer_phone, total_amount, notes, status,
    latitude, longitude, landmark, delivery_notes, location_verified,
    order_type, table_number, table_zone, user_id, txn_ref,
    payment_status, payment_method, ticket_status, idempotency_key
  )
  VALUES (
    trim(p_customer_name),
    trim(p_customer_phone),
    v_grand_total,
    NULLIF(trim(v_raw_notes), ''),
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

  -- 2.10 Associate verified payment if verified
  IF v_verified_payment.id IS NOT NULL THEN
    UPDATE public.verified_payments
    SET order_id = v_order.id
    WHERE id = v_verified_payment.id;
  END IF;

  -- 2.11 Insert Order Items
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
      round(v_item_qty * v_item_price, 2),
      v_item_id
    );
  END LOOP;

  -- 2.12 Create In-App Notification
  INSERT INTO public.notifications (
    title, message, type, order_id, is_read
  )
  VALUES (
    'New Order #' || v_order.order_number,
    'Order of ₹' || v_grand_total::text || ' received from ' || trim(p_customer_name),
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
