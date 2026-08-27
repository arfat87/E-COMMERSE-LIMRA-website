-- Migration to alter notifications and create customer notification RPC functions

-- 1. Extend notifications table
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_customer_phone ON public.notifications(customer_phone);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_order_id ON public.notifications(order_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);

-- 3. Create RPC to confirm order (admin only)
CREATE OR REPLACE FUNCTION public.confirm_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  -- Check if caller is admin
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Update order status
  UPDATE public.orders
  SET status = 'confirmed', updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'customer_phone', v_order.customer_phone
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_order(uuid) TO authenticated;

-- 4. Create RPC to manually insert notification (admin only)
CREATE OR REPLACE FUNCTION public.create_notification(
  p_customer_phone text,
  p_order_id uuid,
  p_title text,
  p_message text,
  p_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_notif public.notifications%ROWTYPE;
  v_user_id uuid;
BEGIN
  -- Check if caller is admin
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Try to resolve user_id from customer_profiles
  SELECT id INTO v_user_id
  FROM public.customer_profiles
  WHERE regexp_replace(phone, '\D', '', 'g') = regexp_replace(p_customer_phone, '\D', '', 'g')
  LIMIT 1;

  INSERT INTO public.notifications (
    user_id,
    customer_phone,
    order_id,
    item_id,
    title,
    message,
    description,
    type,
    is_read,
    created_at,
    updated_at
  )
  VALUES (
    v_user_id,
    p_customer_phone,
    p_order_id,
    p_order_id,
    p_title,
    p_message,
    p_message,
    p_type,
    false,
    now(),
    now()
  )
  RETURNING * INTO v_notif;

  RETURN jsonb_build_object(
    'id', v_notif.id,
    'customer_phone', v_notif.customer_phone,
    'title', v_notif.title,
    'message', v_notif.message,
    'type', v_notif.type,
    'created_at', v_notif.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_notification(text, uuid, text, text, text) TO authenticated;

-- 5. Create RPC to fetch customer notifications
CREATE OR REPLACE FUNCTION public.get_customer_notifications(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
BEGIN
  IF length(v_phone) < 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
    FROM (
      SELECT
        id,
        user_id,
        order_id,
        title,
        COALESCE(message, description) AS message,
        type,
        is_read,
        created_at,
        updated_at
      FROM public.notifications
      WHERE regexp_replace(customer_phone, '\D', '', 'g') = v_phone
         OR regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone
         OR v_phone LIKE '%' || regexp_replace(customer_phone, '\D', '', 'g')
      ORDER BY created_at DESC
      LIMIT 50
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_notifications(text) TO anon, authenticated;

-- 6. Create RPC to mark notification as read
CREATE OR REPLACE FUNCTION public.mark_notification_as_read(p_notification_id uuid, p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
BEGIN
  IF length(v_phone) < 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number';
  END IF;

  UPDATE public.notifications
  SET is_read = true, updated_at = now()
  WHERE id = p_notification_id
    AND (
      regexp_replace(customer_phone, '\D', '', 'g') = v_phone
      OR regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone
      OR v_phone LIKE '%' || regexp_replace(customer_phone, '\D', '', 'g')
    );
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notification_as_read(uuid, text) TO anon, authenticated;

-- 7. Create RPC to mark all notifications as read
CREATE OR REPLACE FUNCTION public.mark_all_notifications_as_read(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
BEGIN
  IF length(v_phone) < 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number';
  END IF;

  UPDATE public.notifications
  SET is_read = true, updated_at = now()
  WHERE is_read = false
    AND (
      regexp_replace(customer_phone, '\D', '', 'g') = v_phone
      OR regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone
      OR v_phone LIKE '%' || regexp_replace(customer_phone, '\D', '', 'g')
    );
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_notifications_as_read(text) TO anon, authenticated;

-- 8. Create RPC to get unread count
CREATE OR REPLACE FUNCTION public.get_customer_unread_count(p_phone text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
  v_count integer := 0;
BEGIN
  IF length(v_phone) < 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.notifications
  WHERE is_read = false
    AND (
      regexp_replace(customer_phone, '\D', '', 'g') = v_phone
      OR regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone
      OR v_phone LIKE '%' || regexp_replace(customer_phone, '\D', '', 'g')
    );

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_unread_count(text) TO anon, authenticated;

-- 9. Trigger for order status updates
CREATE OR REPLACE FUNCTION public.tr_on_order_status_update()
RETURNS trigger AS $$
DECLARE
  v_title text;
  v_message text;
  v_type text;
  v_user_id uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.tr_on_order_status_update()
RETURNS trigger AS $$
DECLARE
  v_title text;
  v_message text;
  v_type text;
  v_user_id uuid;
BEGIN
  -- Trigger only when status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    
    -- Try to resolve user_id
    SELECT id INTO v_user_id
    FROM public.customer_profiles
    WHERE regexp_replace(phone, '\D', '', 'g') = regexp_replace(NEW.customer_phone, '\D', '', 'g')
    LIMIT 1;

    -- Determine notification details
    CASE NEW.status
      WHEN 'confirmed' THEN
        v_title := 'Order Confirmed';
        v_message := 'Your order #' || NEW.order_number || ' has been confirmed and is now being prepared.';
        v_type := 'order_confirmed';
      WHEN 'preparing' THEN
        v_title := 'Order Preparing';
        v_message := 'Your order #' || NEW.order_number || ' is being prepared in the kitchen.';
        v_type := 'order_preparing';
      WHEN 'ready' THEN
        v_title := 'Out For Delivery';
        v_message := 'Your order #' || NEW.order_number || ' is ready and out for delivery.';
        v_type := 'out_for_delivery';
      WHEN 'delivered' THEN
        v_title := 'Order Delivered';
        v_message := 'Your order #' || NEW.order_number || ' has been delivered. Enjoy your meal!';
        v_type := 'delivered';
      WHEN 'cancelled' THEN
        v_title := 'Order Rejected';
        v_message := 'Your order #' || NEW.order_number || ' has been cancelled.';
        v_type := 'order_rejected';
      ELSE
        RETURN NEW;
    END CASE;

    -- Insert customer notification with item_id populated to satisfy not-null constraint
    INSERT INTO public.notifications (
      user_id,
      customer_phone,
      order_id,
      item_id,
      title,
      message,
      description,
      type,
      is_read,
      created_at,
      updated_at
    )
    VALUES (
      v_user_id,
      NEW.customer_phone,
      NEW.id,
      NEW.id,
      v_title,
      v_message,
      v_message,
      v_type,
      false,
      now(),
      now()
    );

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS tr_order_status_update ON public.orders;
CREATE TRIGGER tr_order_status_update
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tr_on_order_status_update();

-- 10. Add policy for admin inserts to notifications (if not exists)
DROP POLICY IF EXISTS "Admins can insert notifications" ON public.notifications;
CREATE POLICY "Admins can insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());
