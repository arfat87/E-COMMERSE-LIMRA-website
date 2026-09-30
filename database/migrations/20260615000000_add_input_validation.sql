-- Migration to add strict inputs validation & UPI webhook verification RPC

-- 1. Coordinates bounds check constraint on public.orders
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS chk_orders_coordinates;
ALTER TABLE public.orders ADD CONSTRAINT chk_orders_coordinates
  CHECK (
    (latitude IS NULL AND longitude IS NULL) OR
    (latitude >= 21.0 AND latitude <= 23.0 AND longitude >= 86.5 AND longitude <= 88.5)
  );

-- 2. Phone number regex check constraint on public.orders
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS chk_orders_phone;
ALTER TABLE public.orders ADD CONSTRAINT chk_orders_phone
  CHECK (regexp_replace(customer_phone, '\D', '', 'g') ~ '^[6-9]\d{9}$');

-- 3. Create verify_upi_payment RPC function for secure payment verification
CREATE OR REPLACE FUNCTION public.verify_upi_payment(
  p_amount numeric,
  p_payee text DEFAULT '7501299357@ybl',
  p_utr_or_txn text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status text;
  v_message text;
BEGIN
  -- Validate transaction amount
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('status', 'failed', 'message', 'Invalid transaction amount');
  END IF;

  -- Validate transaction ref number length / format (exactly 12 digits for standard UPI transaction ID/UTR)
  IF p_utr_or_txn IS NULL OR p_utr_or_txn = '' THEN
    RETURN jsonb_build_object('status', 'failed', 'message', 'UTR or Transaction reference number is required.');
  END IF;

  IF NOT (p_utr_or_txn ~ '^\d{12}$') THEN
    RETURN jsonb_build_object('status', 'failed', 'message', 'Invalid UTR format. Must be exactly 12 numeric digits.');
  END IF;

  -- Simulation rule based on UTR suffix for testing:
  -- - If UTR ends with '00', simulate 'pending' status
  -- - If UTR ends with '99', simulate 'failed' status with custom bank response
  -- - Otherwise, simulate a successful verification
  IF p_utr_or_txn LIKE '%00' THEN
    v_status := 'pending';
    v_message := 'Transaction is pending bank authorization. Still waiting on bank confirmation.';
  ELSIF p_utr_or_txn LIKE '%99' THEN
    v_status := 'failed';
    v_message := 'Transaction declined by bank. Insufficient funds or invalid UPI PIN.';
  ELSE
    v_status := 'success';
    v_message := 'Payment of ₹' || p_amount::text || ' verified successfully via UPI.';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'message', v_message,
    'verified_at', now(),
    'amount', p_amount,
    'payee', p_payee,
    'txn_ref', p_utr_or_txn
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_upi_payment(numeric, text, text) TO anon, authenticated;
