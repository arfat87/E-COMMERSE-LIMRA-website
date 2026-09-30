-- Migration to implement Payment Status Management System

-- 1. Add payment_status column to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid'));

-- 2. Add index for payment status
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders(payment_status);

-- 3. Create payment_history table for auditing
CREATE TABLE IF NOT EXISTS public.payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_status TEXT NOT NULL CHECK (previous_status IN ('unpaid', 'paid')),
  new_status TEXT NOT NULL CHECK (new_status IN ('unpaid', 'paid')),
  changed_by TEXT NOT NULL, -- Email address or system name
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Create index for payment history
CREATE INDEX IF NOT EXISTS idx_payment_history_order_id ON public.payment_history(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_history_created_at ON public.payment_history(created_at DESC);

-- 5. Trigger to update updated_at on payment_history
DROP TRIGGER IF EXISTS payment_history_updated_at ON public.payment_history;
CREATE TRIGGER payment_history_updated_at
  BEFORE UPDATE ON public.payment_history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 6. Enable Row Level Security on payment_history
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies for payment_history
DROP POLICY IF EXISTS "Admins can select payment history" ON public.payment_history;
CREATE POLICY "Admins can select payment history"
  ON public.payment_history FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert payment history" ON public.payment_history;
CREATE POLICY "Admins can insert payment history"
  ON public.payment_history FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- 8. Recreate get_customer_orders to return payment_status and order ID
CREATE OR REPLACE FUNCTION public.get_customer_orders(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
         o.id,
         o.order_number,
         o.customer_name,
         o.total_amount,
         o.status,
         o.payment_status,
         o.created_at,
         o.notes,
         o.latitude,
         o.longitude,
         o.landmark,
         o.delivery_notes,
         o.location_verified,
         (
           SELECT jsonb_agg(jsonb_build_object(
             'item_name', oi.item_name,
             'quantity',  oi.quantity,
             'line_total', oi.line_total
           ) ORDER BY oi.item_name)
           FROM public.order_items oi
           WHERE oi.order_id = o.id
         ) AS items
       FROM public.orders o
       WHERE regexp_replace(o.customer_phone, '\D', '', 'g') = v_phone
          OR regexp_replace(o.customer_phone, '\D', '', 'g') LIKE '%' || v_phone
          OR v_phone LIKE '%' || regexp_replace(o.customer_phone, '\D', '', 'g')
       ORDER BY o.created_at DESC
       LIMIT 20
     ) t
   ), '[]'::jsonb);
 END;
 $$;

GRANT EXECUTE ON FUNCTION public.get_customer_orders(text) TO anon, authenticated;

-- 9. Create update_order_payment_status RPC (Admin only)
CREATE OR REPLACE FUNCTION public.update_order_payment_status(
  p_order_id uuid,
  p_payment_status text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_prev_status text;
  v_changed_by text;
  v_user_id uuid;
  v_notif_title text;
  v_notif_message text;
  v_user_email text;
BEGIN
  -- Security check: Require admin role (or service key calling from server, where auth.uid() is null)
  IF NOT public.is_admin() AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Validate order existence
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_prev_status := v_order.payment_status;

  -- Prevent duplicate updates
  IF v_prev_status = p_payment_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Payment status is already ' || p_payment_status,
      'order_id', p_order_id,
      'payment_status', p_payment_status
    );
  END IF;

  -- Resolve active admin identity
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM public.admin_users WHERE user_id = v_user_id LIMIT 1;
    IF v_user_email IS NULL THEN
      v_changed_by := 'Admin (' || v_user_id::text || ')';
    ELSE
      v_changed_by := v_user_email;
    END IF;
  ELSE
    v_changed_by := 'system/gateway';
  END IF;

  -- Update order payment status
  UPDATE public.orders
  SET payment_status = p_payment_status, updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Insert history record
  INSERT INTO public.payment_history (
    order_id,
    user_id,
    previous_status,
    new_status,
    changed_by,
    notes,
    created_at,
    updated_at
  )
  VALUES (
    p_order_id,
    v_user_id,
    v_prev_status,
    p_payment_status,
    v_changed_by,
    COALESCE(p_notes, 'Payment status manually updated from ' || v_prev_status || ' to ' || p_payment_status),
    now(),
    now()
  );

  -- If status updated to 'paid', create customer notification
  IF p_payment_status = 'paid' THEN
    v_notif_title := 'Payment Received';
    v_notif_message := 'Your payment for Order #' || v_order.order_number || ' has been successfully verified.';

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
      (SELECT id FROM public.customer_profiles WHERE regexp_replace(phone, '\D', '', 'g') = regexp_replace(v_order.customer_phone, '\D', '', 'g') LIMIT 1),
      v_order.customer_phone,
      v_order.id,
      v_order.id,
      v_notif_title,
      v_notif_message,
      v_notif_message,
      'payment_received',
      false,
      now(),
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'payment_status', v_order.payment_status,
    'previous_status', v_prev_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_order_payment_status(uuid, text, text) TO authenticated;
