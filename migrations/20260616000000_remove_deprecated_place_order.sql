-- Migration to drop deprecated place_order functions with SECURITY DEFINER vulnerabilities
-- And lock down search_path for place_booking

-- 1. Drop old 4-parameter version of place_order
DROP FUNCTION IF EXISTS public.place_order(text, text, text, jsonb);

-- 2. Drop old 9-parameter version of place_order
DROP FUNCTION IF EXISTS public.place_order(text, text, text, jsonb, numeric, numeric, text, text, boolean);

-- 3. Lock down search_path to prevent hijacking on place_booking
ALTER FUNCTION public.place_booking(text, text, text, date, text, integer, text, text, text, text, text, text, text, text) SET search_path = '';
