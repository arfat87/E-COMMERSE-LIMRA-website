-- Migration to fix notifications item_id not-null constraint violation

-- 1. Recreate create_notification with item_id populated
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


-- 2. Recreate tr_on_order_status_update with item_id populated
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
