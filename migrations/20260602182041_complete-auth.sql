-- Make email and phone nullable in customer_profiles
ALTER TABLE public.customer_profiles ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.customer_profiles ALTER COLUMN phone DROP NOT NULL;

-- Remove old unique constraints/indexes if they exist
ALTER TABLE public.customer_profiles DROP CONSTRAINT IF EXISTS customer_profiles_email_key;
ALTER TABLE public.customer_profiles DROP CONSTRAINT IF EXISTS customer_profiles_phone_key;

-- Drop check constraint if it exists and add it
ALTER TABLE public.customer_profiles DROP CONSTRAINT IF EXISTS check_email_or_phone;
ALTER TABLE public.customer_profiles ADD CONSTRAINT check_email_or_phone 
  CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- Create unique indexes that ignore nulls and ignore mock phone emails
DROP INDEX IF EXISTS public.idx_customer_profiles_unique_email;
CREATE UNIQUE INDEX idx_customer_profiles_unique_email 
  ON public.customer_profiles (email) 
  WHERE email IS NOT NULL AND email NOT LIKE '%@limraresturent.in';

DROP INDEX IF EXISTS public.idx_customer_profiles_unique_phone;
CREATE UNIQUE INDEX idx_customer_profiles_unique_phone 
  ON public.customer_profiles (phone) 
  WHERE phone IS NOT NULL AND phone <> '';

-- Add new user structure fields to customer_profiles
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS verification_code TEXT;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS verification_code_expiry TIMESTAMPTZ;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Create temporary phone verification codes table
CREATE TABLE IF NOT EXISTS public.phone_verifications (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expiry TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on verification table
ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;

-- 1. Helper function to generate and send phone signup OTP code
CREATE OR REPLACE FUNCTION public.send_phone_signup_code(p_phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean_phone text := regexp_replace(p_phone, '\D', '', 'g');
  v_code text;
BEGIN
  IF length(v_clean_phone) <> 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number';
  END IF;

  -- Check duplicate phone number
  IF EXISTS (SELECT 1 FROM public.customer_profiles WHERE phone = v_clean_phone) THEN
    RAISE EXCEPTION 'An account with this phone number already exists';
  END IF;

  -- Generate 6-digit numeric OTP code
  v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');

  INSERT INTO public.phone_verifications (phone, code, expiry)
  VALUES (v_clean_phone, v_code, now() + interval '5 minutes')
  ON CONFLICT (phone) DO UPDATE
  SET code = excluded.code,
      expiry = excluded.expiry,
      created_at = now();

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_phone_signup_code(text) TO anon, authenticated;

-- 2. Helper function to generate and send phone reset password OTP code
CREATE OR REPLACE FUNCTION public.send_phone_reset_code(p_phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean_phone text := regexp_replace(p_phone, '\D', '', 'g');
  v_code text;
BEGIN
  IF length(v_clean_phone) <> 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number';
  END IF;

  -- Check if user exists
  IF NOT EXISTS (SELECT 1 FROM public.customer_profiles WHERE phone = v_clean_phone) THEN
    RAISE EXCEPTION 'Account with this phone number does not exist';
  END IF;

  -- Generate 6-digit numeric OTP code
  v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');

  INSERT INTO public.phone_verifications (phone, code, expiry)
  VALUES (v_clean_phone, v_code, now() + interval '5 minutes')
  ON CONFLICT (phone) DO UPDATE
  SET code = excluded.code,
      expiry = excluded.expiry,
      created_at = now();

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_phone_reset_code(text) TO anon, authenticated;

-- 3. Helper function to verify phone OTP and update password
CREATE OR REPLACE FUNCTION public.verify_phone_reset_password(p_phone text, p_code text, p_new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean_phone text := regexp_replace(p_phone, '\D', '', 'g');
  v_email text := v_clean_phone || '@limraresturent.in';
  v_record record;
BEGIN
  IF length(v_clean_phone) <> 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number';
  END IF;

  -- Lookup phone verification
  SELECT * INTO v_record FROM public.phone_verifications WHERE phone = v_clean_phone;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incorrect verification code';
  END IF;

  IF v_record.code <> p_code THEN
    RAISE EXCEPTION 'Incorrect verification code';
  END IF;

  IF v_record.expiry < now() THEN
    RAISE EXCEPTION 'Verification code expired. Please request a new code';
  END IF;

  -- Delete OTP verification code to prevent reuse
  DELETE FROM public.phone_verifications WHERE phone = v_clean_phone;

  -- Update auth.users password using crypt
  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf'))
  WHERE email = v_email;

  -- Mark phone as verified in profile
  UPDATE public.customer_profiles
  SET phone_verified = true,
      updated_at = now()
  WHERE phone = v_clean_phone;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_phone_reset_password(text, text, text) TO anon, authenticated;
