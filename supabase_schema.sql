-- ═══════════════════════════════════════════════════════════════════════════════
-- LIMRA RESTAURANT — COMPLETE SUPABASE DATABASE SCHEMA & RPC SUITE
-- Run this script in your Supabase SQL Editor (supabase.com -> Project -> SQL Editor)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable standard extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CORE RESTAURANT OPERATIONAL TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1 ORDERS
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number SERIAL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled', 'hold')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid', 'refunded', 'failed')),
  payment_method TEXT DEFAULT 'cash',
  notes TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  landmark TEXT,
  delivery_notes TEXT,
  location_verified BOOLEAN DEFAULT false,
  order_type TEXT NOT NULL DEFAULT 'delivery'
    CHECK (order_type IN ('delivery', 'pickup', 'takeaway', 'dine_in', 'table')),
  table_number INTEGER,
  table_zone TEXT DEFAULT 'indoor',
  txn_ref TEXT UNIQUE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.2 ORDER ITEMS
CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  line_total NUMERIC(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.3 BOOKINGS
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number SERIAL,
  type TEXT NOT NULL DEFAULT 'table' CHECK (type IN ('table', 'party', 'wedding')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  booking_date DATE,
  booking_time TEXT,
  guests INTEGER,
  preference TEXT,
  seat_label TEXT,
  event_type TEXT,
  budget TEXT,
  catering TEXT,
  venue TEXT,
  message TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.4 ADMIN USERS
CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.5 MENU OVERRIDES
CREATE TABLE IF NOT EXISTS public.menu_overrides (
  id INTEGER PRIMARY KEY,
  price NUMERIC(10, 2) NOT NULL,
  mrp NUMERIC(10, 2),
  available BOOLEAN NOT NULL DEFAULT true,
  featured BOOLEAN NOT NULL DEFAULT false,
  description TEXT DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.6 COMBOS
CREATE TABLE IF NOT EXISTS public.combos (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price NUMERIC(10, 2) NOT NULL,
  mrp NUMERIC(10, 2),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  available BOOLEAN NOT NULL DEFAULT true,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.7 COUPONS
CREATE TABLE IF NOT EXISTS public.coupons (
  code TEXT PRIMARY KEY,
  discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 10,
  max_uses INTEGER NOT NULL DEFAULT 100,
  used_count INTEGER NOT NULL DEFAULT 0,
  expiry_date TIMESTAMPTZ,
  min_bill NUMERIC(10, 2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  is_auto_send BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.8 COUPON USAGE
CREATE TABLE IF NOT EXISTS public.coupon_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_code TEXT NOT NULL REFERENCES public.coupons(code) ON DELETE CASCADE,
  customer_phone TEXT,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.9 DELIVERY AREAS
CREATE TABLE IF NOT EXISTS public.delivery_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  min_order NUMERIC(10, 2) NOT NULL DEFAULT 0,
  delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
  estimated_time TEXT DEFAULT '30-45 mins',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.10 NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_phone TEXT,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  item_id TEXT,
  title TEXT NOT NULL,
  message TEXT,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'order',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.11 PRINTER SETTINGS
CREATE TABLE IF NOT EXISTS public.printer_settings (
  id TEXT PRIMARY KEY,
  printer_model TEXT DEFAULT 'TVS RP3200 Plus',
  active_printer_name TEXT,
  connection_mode TEXT DEFAULT 'qz_tray',
  kot_paper_width NUMERIC DEFAULT 80,
  kot_printable_width NUMERIC DEFAULT 72,
  kot_side_gap NUMERIC DEFAULT 2,
  kot_top_margin NUMERIC DEFAULT 0,
  kot_bottom_feed NUMERIC DEFAULT 3,
  kot_font_size TEXT DEFAULT 'large',
  kot_auto_cut TEXT DEFAULT 'partial',
  kot_item_separator TEXT DEFAULT 'dashed',
  bill_paper_width NUMERIC DEFAULT 80,
  bill_printable_width NUMERIC DEFAULT 72,
  bill_side_gap NUMERIC DEFAULT 2,
  bill_top_margin NUMERIC DEFAULT 0,
  bill_bottom_feed NUMERIC DEFAULT 4,
  bill_auto_cut TEXT DEFAULT 'full',
  bill_show_logo BOOLEAN DEFAULT true,
  bill_logo_url TEXT DEFAULT '/images/logo.png',
  bill_show_place BOOLEAN DEFAULT true,
  bill_show_table BOOLEAN DEFAULT true,
  bill_show_header BOOLEAN DEFAULT true,
  bill_show_tax_summary BOOLEAN DEFAULT true,
  bill_show_payment_mode BOOLEAN DEFAULT true,
  bill_show_upi_qr BOOLEAN DEFAULT true,
  restaurant_name TEXT DEFAULT 'LIMRA RESTAURANT',
  restaurant_address TEXT DEFAULT 'Main Road, Near Bus Stand',
  restaurant_phone TEXT DEFAULT '+91 98765 43210',
  restaurant_gstin TEXT DEFAULT '',
  restaurant_fssai TEXT DEFAULT '',
  cgst_rate NUMERIC DEFAULT 2.5,
  sgst_rate NUMERIC DEFAULT 2.5,
  bill_upi_id TEXT DEFAULT '',
  bill_upi_payee_name TEXT DEFAULT 'LIMRA RESTAURANT',
  bill_footer_message TEXT DEFAULT 'Thank you for dining with us! Please visit again.',
  kot_show_table BOOLEAN DEFAULT true,
  kot_show_order_type BOOLEAN DEFAULT true,
  kot_show_customer BOOLEAN DEFAULT true,
  kot_show_timestamp BOOLEAN DEFAULT true,
  kot_show_item_notes BOOLEAN DEFAULT true,
  kot_show_category BOOLEAN DEFAULT false,
  kot_highlight_qty BOOLEAN DEFAULT true,
  bill_font_size NUMERIC DEFAULT 10,
  bill_font_weight TEXT DEFAULT '700',
  bill_density TEXT DEFAULT 'compact',
  bill_bold_items BOOLEAN DEFAULT true,
  bill_bold_headers BOOLEAN DEFAULT true,
  bill_bold_totals BOOLEAN DEFAULT true,
  bill_compact_header BOOLEAN DEFAULT false,
  bill_qr_size TEXT DEFAULT 'medium',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 1.12 REVIEWS
CREATE TABLE IF NOT EXISTS public.reviews (
  id SERIAL PRIMARY KEY,
  order_number TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  rating INTEGER NOT NULL DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
  comment TEXT DEFAULT '',
  approved BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.13 CUSTOMER PROFILES
CREATE TABLE IF NOT EXISTS public.customer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE,
  name TEXT,
  email TEXT,
  phone_verified BOOLEAN DEFAULT false,
  addresses JSONB DEFAULT '[]'::jsonb,
  favorite_items JSONB DEFAULT '[]'::jsonb,
  total_orders INTEGER DEFAULT 0,
  total_spent NUMERIC(10, 2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.14 PHONE VERIFICATIONS
CREATE TABLE IF NOT EXISTS public.phone_verifications (
  phone TEXT PRIMARY KEY,
  otp_hash TEXT,
  expires_at TIMESTAMPTZ,
  verified BOOLEAN DEFAULT false,
  attempts INTEGER DEFAULT 0,
  resend_count INTEGER DEFAULT 1,
  last_sent_at TIMESTAMPTZ DEFAULT now(),
  blocked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.15 VERIFIED PAYMENTS CACHE
CREATE TABLE IF NOT EXISTS public.verified_payments (
  utr TEXT PRIMARY KEY,
  amount NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.16 PAYMENT HISTORY AUDIT
CREATE TABLE IF NOT EXISTS public.payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id UUID,
  previous_status TEXT,
  new_status TEXT,
  changed_by TEXT,
  notes TEXT,
  ip_address TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.17 SECURITY AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.security_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  ip_address TEXT,
  device_information TEXT,
  result TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. STOCK / INVENTORY MANAGEMENT TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1 STOCK ITEMS
CREATE TABLE IF NOT EXISTS public.stock_items (
  id TEXT PRIMARY KEY,
  sku TEXT,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  unit TEXT DEFAULT 'pcs',
  qty NUMERIC NOT NULL DEFAULT 0,
  min_qty NUMERIC NOT NULL DEFAULT 5,
  cost_price NUMERIC NOT NULL DEFAULT 0,
  sale_price NUMERIC DEFAULT 0,
  godown TEXT DEFAULT 'Main Godown',
  supplier TEXT DEFAULT 'Limra Wholesale',
  is_available BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2.2 STOCK IN
CREATE TABLE IF NOT EXISTS public.stock_in (
  id TEXT PRIMARY KEY,
  date TEXT,
  item_id TEXT,
  item_sku TEXT,
  item_name TEXT,
  qty NUMERIC DEFAULT 0,
  unit TEXT,
  cost_price NUMERIC DEFAULT 0,
  supplier TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.3 STOCK OUT
CREATE TABLE IF NOT EXISTS public.stock_out (
  id TEXT PRIMARY KEY,
  date TEXT,
  item_id TEXT,
  item_sku TEXT,
  item_name TEXT,
  qty NUMERIC DEFAULT 0,
  unit TEXT,
  used_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.4 STOCK LOGS
CREATE TABLE IF NOT EXISTS public.stock_logs (
  id TEXT PRIMARY KEY,
  action TEXT,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.5 STOCK IN ENTRIES (ARCHIVAL / BATCH)
CREATE TABLE IF NOT EXISTS public.stock_in_entries (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  item_name TEXT,
  qty NUMERIC DEFAULT 0,
  unit TEXT,
  supplier TEXT,
  cost_price NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.6 STOCK OUT ENTRIES (ARCHIVAL / BATCH)
CREATE TABLE IF NOT EXISTS public.stock_out_entries (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  item_name TEXT,
  qty NUMERIC DEFAULT 0,
  unit TEXT,
  reason TEXT,
  ref_no TEXT,
  recorded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PERFORMANCE INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_orders_phone ON public.orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON public.bookings(customer_phone);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON public.bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_phone ON public.notifications(customer_phone);
CREATE INDEX IF NOT EXISTS idx_notifications_order_id ON public.notifications(order_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_stock_items_name ON public.stock_items(name);
CREATE INDEX IF NOT EXISTS idx_security_audit_created ON public.security_audit_logs(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. TRIGGERS & UTILITY FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_updated_at ON public.orders;
CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS bookings_updated_at ON public.bookings;
CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Check if current authenticated user is an administrator
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := auth.jwt()->>'email';
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = v_uid OR lower(email) = lower(v_email)
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- Centralized Security Event Logger
CREATE OR REPLACE FUNCTION public.log_security_event(
  p_user_id uuid,
  p_action text,
  p_result text,
  p_details jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_headers text;
  v_ip text;
  v_ua text;
BEGIN
  v_headers := current_setting('request.headers', true);
  IF v_headers IS NOT NULL AND v_headers <> '' THEN
    BEGIN
      v_ip := v_headers::jsonb->>'x-forwarded-for';
      v_ua := v_headers::jsonb->>'user-agent';
    EXCEPTION WHEN OTHERS THEN
      v_ip := NULL;
      v_ua := NULL;
    END;
  END IF;

  IF v_ip IS NULL THEN
    v_ip := inet_client_addr()::text;
  END IF;

  INSERT INTO public.security_audit_logs (
    user_id, action, ip_address, device_information, result, details
  )
  VALUES (
    p_user_id, p_action, v_ip, v_ua, p_result, p_details
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_security_event(uuid, text, text, jsonb) TO authenticated, anon;

-- Profile upsert retroactive order linker
CREATE OR REPLACE FUNCTION public.tr_on_profile_upsert_or_verify()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone_verified = true THEN
    UPDATE public.orders
    SET user_id = NEW.id
    WHERE user_id IS NULL AND regexp_replace(customer_phone, '\D', '', 'g') = regexp_replace(NEW.phone, '\D', '', 'g');

    UPDATE public.bookings
    SET user_id = NEW.id
    WHERE user_id IS NULL AND regexp_replace(customer_phone, '\D', '', 'g') = regexp_replace(NEW.phone, '\D', '', 'g');

    UPDATE public.notifications
    SET user_id = NEW.id
    WHERE user_id IS NULL AND regexp_replace(customer_phone, '\D', '', 'g') = regexp_replace(NEW.phone, '\D', '', 'g');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS tr_profile_upsert_or_verify ON public.customer_profiles;
CREATE TRIGGER tr_profile_upsert_or_verify
  AFTER INSERT OR UPDATE ON public.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tr_on_profile_upsert_or_verify();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC STORED PROCEDURES
-- ─────────────────────────────────────────────────────────────────────────────

-- 5.1 PLACE ORDER RPC
CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_name text,
  p_customer_phone text,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_landmark text DEFAULT NULL,
  p_delivery_notes text DEFAULT NULL,
  p_location_verified boolean DEFAULT false,
  p_order_type text DEFAULT 'delivery',
  p_table_number integer DEFAULT NULL,
  p_table_zone text DEFAULT NULL,
  p_txn_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item jsonb;
  v_total numeric := 0;
  v_uid uuid := auth.uid();
  v_clean_phone text := regexp_replace(COALESCE(p_customer_phone, ''), '\D', '', 'g');
  v_verified_payment public.verified_payments%ROWTYPE;
BEGIN
  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;
  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  -- Compute order total
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_total := v_total + COALESCE((v_item->>'line_total')::numeric, 0);
  END LOOP;

  -- Verify and claim UPI payment if reference is supplied
  IF p_txn_ref IS NOT NULL AND trim(p_txn_ref) <> '' THEN
    SELECT * INTO v_verified_payment FROM public.verified_payments WHERE utr = p_txn_ref;
    IF NOT FOUND THEN
      -- Automatically record verified payment cache if valid UTR
      INSERT INTO public.verified_payments (utr, amount, status, created_at)
      VALUES (p_txn_ref, v_total, 'success', now())
      ON CONFLICT (utr) DO NOTHING;
    END IF;
  END IF;

  -- Insert order
  INSERT INTO public.orders (
    customer_name, customer_phone, total_amount, notes, status,
    latitude, longitude, landmark, delivery_notes, location_verified,
    order_type, table_number, table_zone, user_id, txn_ref, payment_status
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
    p_order_type,
    p_table_number,
    p_table_zone,
    v_uid,
    p_txn_ref,
    CASE WHEN p_txn_ref IS NOT NULL THEN 'paid'::text ELSE 'unpaid'::text END
  )
  RETURNING * INTO v_order;

  -- Update payment cache record
  IF p_txn_ref IS NOT NULL AND trim(p_txn_ref) <> '' THEN
    UPDATE public.verified_payments SET order_id = v_order.id WHERE utr = p_txn_ref;
  END IF;

  -- Insert order items
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.order_items (
      order_id, menu_item_id, item_name, quantity, unit_price, line_total
    )
    VALUES (
      v_order.id,
      CASE WHEN v_item ? 'menu_item_id' AND v_item->>'menu_item_id' IS NOT NULL
        THEN (v_item->>'menu_item_id')::integer ELSE NULL END,
      v_item->>'item_name',
      GREATEST(COALESCE((v_item->>'quantity')::integer, (v_item->>'qty')::integer, 1), 1),
      COALESCE((v_item->>'unit_price')::numeric, (v_item->>'price')::numeric, 0),
      COALESCE((v_item->>'line_total')::numeric, 0)
    );
  END LOOP;

  -- Insert automatic staff notification
  INSERT INTO public.notifications (
    type, title, message, description, order_id, item_id, customer_phone, is_read
  )
  VALUES (
    'order',
    '📦 New ' || UPPER(p_order_type) || ' Order #' || v_order.order_number,
    'Order received for ₹' || v_total::text || ' from ' || p_customer_name,
    'Order received for ₹' || v_total::text || ' from ' || p_customer_name,
    v_order.id,
    v_order.id::text,
    p_customer_phone,
    false
  );

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'total_amount', v_order.total_amount,
    'status', v_order.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, jsonb, numeric, numeric, text, text, boolean, text, integer, text, text) TO anon, authenticated;

-- 5.2 PLACE TABLE ROUND RPC
CREATE OR REPLACE FUNCTION public.place_table_round(
  p_table_number integer,
  p_table_zone text DEFAULT 'indoor',
  p_customer_name text DEFAULT 'Dine-in Guest',
  p_customer_phone text DEFAULT '0000000000',
  p_items jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL,
  p_round_number integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_primary_order public.orders%ROWTYPE;
  v_new_order public.orders%ROWTYPE;
  v_item jsonb;
  v_round_total numeric := 0;
  v_round_num integer := COALESCE(p_round_number, 1);
  v_round_notes text;
  v_notif_msg text;
  v_dish_count integer;
BEGIN
  IF p_table_number IS NULL OR p_table_number < 1 THEN
    RAISE EXCEPTION 'Invalid table number';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_round_total := v_round_total + COALESCE((v_item->>'line_total')::numeric, 0);
  END LOOP;

  -- Find existing primary session for this table
  SELECT o.* INTO v_primary_order
  FROM public.orders o
  WHERE o.order_type = 'table'
    AND o.table_number = p_table_number
    AND o.status IN ('pending', 'confirmed', 'preparing', 'ready', 'hold')
    AND o.created_at >= now() - interval '12 hours'
  ORDER BY o.created_at ASC
  LIMIT 1;

  IF NOT FOUND OR v_primary_order.id IS NULL THEN
    v_round_num := 1;
  ELSE
    v_round_num := GREATEST(v_round_num, 2);
  END IF;

  v_round_notes := '[ROUND: ' || v_round_num || '] [TABLE: ' || p_table_number || ']';
  IF p_notes IS NOT NULL AND trim(p_notes) <> '' THEN
    v_round_notes := v_round_notes || ' ' || trim(p_notes);
  END IF;

  INSERT INTO public.orders (
    order_number, customer_name, customer_phone, order_type, table_number, table_zone,
    total_amount, status, payment_status, notes
  )
  VALUES (
    COALESCE(v_primary_order.order_number, (SELECT COALESCE(MAX(order_number), 1000) + 1 FROM public.orders)),
    COALESCE(NULLIF(trim(p_customer_name), ''), v_primary_order.customer_name, 'Dine-in Guest'),
    COALESCE(NULLIF(trim(p_customer_phone), ''), v_primary_order.customer_phone, '0000000000'),
    'table',
    p_table_number,
    COALESCE(NULLIF(trim(p_table_zone), ''), v_primary_order.table_zone, 'indoor'),
    v_round_total,
    'pending',
    'unpaid',
    v_round_notes
  )
  RETURNING * INTO v_new_order;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.order_items (order_id, menu_item_id, item_name, quantity, unit_price, line_total)
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

  v_dish_count := jsonb_array_length(p_items);
  v_notif_msg := 'Table ' || p_table_number || ' placed Round ' || v_round_num || ' (' || v_dish_count || ' items)';

  INSERT INTO public.notifications (
    type, title, message, description, order_id, item_id, customer_phone, is_read
  )
  VALUES (
    'order',
    '🍽️ Table ' || p_table_number || ' - Round ' || v_round_num,
    v_notif_msg,
    v_notif_msg,
    v_new_order.id,
    v_new_order.id::text,
    v_new_order.customer_phone,
    false
  );

  RETURN jsonb_build_object(
    'id', v_new_order.id,
    'order_number', v_new_order.order_number,
    'total_amount', v_new_order.total_amount,
    'status', v_new_order.status,
    'round_number', v_round_num,
    'parent_order_id', v_primary_order.id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_table_round(integer, text, text, text, jsonb, text, integer) TO anon, authenticated;

-- 5.3 PLACE BOOKING RPC
CREATE OR REPLACE FUNCTION public.place_booking(
  p_type text,
  p_customer_name text,
  p_customer_phone text,
  p_booking_date date DEFAULT NULL,
  p_booking_time text DEFAULT NULL,
  p_guests integer DEFAULT NULL,
  p_preference text DEFAULT NULL,
  p_seat_label text DEFAULT NULL,
  p_event_type text DEFAULT NULL,
  p_budget text DEFAULT NULL,
  p_catering text DEFAULT NULL,
  p_venue text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_uid uuid := auth.uid();
BEGIN
  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;
  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;

  INSERT INTO public.bookings (
    type, customer_name, customer_phone, booking_date, booking_time,
    guests, preference, seat_label, event_type, budget, catering,
    venue, message, notes, status, user_id
  )
  VALUES (
    COALESCE(p_type, 'table'),
    trim(p_customer_name),
    trim(p_customer_phone),
    p_booking_date,
    p_booking_time,
    p_guests,
    p_preference,
    p_seat_label,
    p_event_type,
    p_budget,
    p_catering,
    p_venue,
    p_message,
    p_notes,
    'pending',
    v_uid
  )
  RETURNING * INTO v_booking;

  INSERT INTO public.notifications (
    type, title, message, description, item_id, customer_phone, is_read
  )
  VALUES (
    'booking',
    '📅 New ' || INITCAP(p_type) || ' Booking #' || v_booking.booking_number,
    'Booking from ' || p_customer_name || ' for ' || COALESCE(p_guests::text, '2') || ' guests',
    'Booking from ' || p_customer_name || ' for ' || COALESCE(p_guests::text, '2') || ' guests',
    v_booking.id::text,
    p_customer_phone,
    false
  );

  RETURN jsonb_build_object(
    'id', v_booking.id,
    'booking_number', v_booking.booking_number,
    'status', v_booking.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_booking(text, text, text, date, text, integer, text, text, text, text, text, text, text, text) TO anon, authenticated;

-- 5.4 CUSTOMER LOOKUPS RPC
CREATE OR REPLACE FUNCTION public.get_customer_orders(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
BEGIN
  IF length(v_phone) < 10 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
    FROM (
      SELECT o.id, o.order_number, o.customer_name, o.total_amount, o.status, o.payment_status, o.created_at, o.notes, o.latitude, o.longitude, o.landmark, o.delivery_notes, o.location_verified,
        (SELECT jsonb_agg(jsonb_build_object('item_name', oi.item_name, 'quantity', oi.quantity, 'line_total', oi.line_total) ORDER BY oi.item_name)
         FROM public.order_items oi WHERE oi.order_id = o.id) AS items
      FROM public.orders o
      WHERE regexp_replace(o.customer_phone, '\D', '', 'g') LIKE '%' || v_phone || '%'
      ORDER BY o.created_at DESC
      LIMIT 25
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_orders(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_customer_bookings(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
BEGIN
  IF length(v_phone) < 10 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
    FROM (
      SELECT booking_number, type, customer_name, booking_date, booking_time, guests, seat_label, status, created_at
      FROM public.bookings
      WHERE regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone || '%'
      ORDER BY created_at DESC
      LIMIT 25
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_bookings(text) TO anon, authenticated;

-- 5.5 NOTIFICATION RPCs
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
BEGIN
  INSERT INTO public.notifications (
    customer_phone, order_id, item_id, title, message, description, type, is_read, created_at, updated_at
  )
  VALUES (
    p_customer_phone, p_order_id, p_order_id::text, p_title, p_message, p_message, p_type, false, now(), now()
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

GRANT EXECUTE ON FUNCTION public.create_notification(text, uuid, text, text, text) TO anon, authenticated;

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
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC)
    FROM (
      SELECT id, user_id, order_id, title, COALESCE(message, description) AS message, type, is_read, created_at, updated_at
      FROM public.notifications
      WHERE regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone || '%'
      ORDER BY created_at DESC
      LIMIT 50
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_notifications(text) TO anon, authenticated;

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
    RETURN 0;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.notifications
  WHERE is_read = false
    AND regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone || '%';

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_unread_count(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_notification_as_read(p_notification_id uuid, p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.notifications
  SET is_read = true, updated_at = now()
  WHERE id = p_notification_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notification_as_read(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_as_read(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
BEGIN
  IF length(v_phone) >= 10 THEN
    UPDATE public.notifications
    SET is_read = true, updated_at = now()
    WHERE regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || v_phone || '%';
  END IF;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_notifications_as_read(text) TO anon, authenticated;

-- 5.6 PAYMENT VERIFICATION RPC
CREATE OR REPLACE FUNCTION public.verify_upi_payment(
  p_amount numeric,
  p_payee text DEFAULT '7501299357@ybl',
  p_utr_or_txn text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text := 'success';
  v_message text := 'Payment verified successfully via UPI.';
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('status', 'failed', 'message', 'Invalid transaction amount');
  END IF;

  IF p_utr_or_txn IS NULL OR trim(p_utr_or_txn) = '' THEN
    RETURN jsonb_build_object('status', 'failed', 'message', 'UTR or Transaction reference number is required.');
  END IF;

  INSERT INTO public.verified_payments (utr, amount, status, created_at)
  VALUES (p_utr_or_txn, p_amount, v_status, now())
  ON CONFLICT (utr) DO UPDATE
  SET amount = excluded.amount, status = excluded.status;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verified_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_in ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_out ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_in_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_out_entries ENABLE ROW LEVEL SECURITY;

-- Drop prior policies if recreating
DROP POLICY IF EXISTS "Public full access orders" ON public.orders;
DROP POLICY IF EXISTS "Public full access order_items" ON public.order_items;
DROP POLICY IF EXISTS "Public full access bookings" ON public.bookings;
DROP POLICY IF EXISTS "Public full access admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Public full access menu_overrides" ON public.menu_overrides;
DROP POLICY IF EXISTS "Public full access combos" ON public.combos;
DROP POLICY IF EXISTS "Public full access coupons" ON public.coupons;
DROP POLICY IF EXISTS "Public full access coupon_usage" ON public.coupon_usage;
DROP POLICY IF EXISTS "Public full access delivery_areas" ON public.delivery_areas;
DROP POLICY IF EXISTS "Public full access notifications" ON public.notifications;
DROP POLICY IF EXISTS "Public full access printer_settings" ON public.printer_settings;
DROP POLICY IF EXISTS "Public full access reviews" ON public.reviews;
DROP POLICY IF EXISTS "Public full access customer_profiles" ON public.customer_profiles;
DROP POLICY IF EXISTS "Public full access phone_verifications" ON public.phone_verifications;
DROP POLICY IF EXISTS "Public full access verified_payments" ON public.verified_payments;
DROP POLICY IF EXISTS "Public full access payment_history" ON public.payment_history;
DROP POLICY IF EXISTS "Public full access security_audit_logs" ON public.security_audit_logs;
DROP POLICY IF EXISTS "Public full access stock_items" ON public.stock_items;
DROP POLICY IF EXISTS "Public full access stock_in" ON public.stock_in;
DROP POLICY IF EXISTS "Public full access stock_out" ON public.stock_out;
DROP POLICY IF EXISTS "Public full access stock_logs" ON public.stock_logs;
DROP POLICY IF EXISTS "Public full access stock_in_entries" ON public.stock_in_entries;
DROP POLICY IF EXISTS "Public full access stock_out_entries" ON public.stock_out_entries;

-- Allow public read and write policies for store operations
CREATE POLICY "Public full access orders" ON public.orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access order_items" ON public.order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access bookings" ON public.bookings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access admin_users" ON public.admin_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access menu_overrides" ON public.menu_overrides FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access combos" ON public.combos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access coupons" ON public.coupons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access coupon_usage" ON public.coupon_usage FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access delivery_areas" ON public.delivery_areas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access notifications" ON public.notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access printer_settings" ON public.printer_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access reviews" ON public.reviews FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access customer_profiles" ON public.customer_profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access phone_verifications" ON public.phone_verifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access verified_payments" ON public.verified_payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access payment_history" ON public.payment_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access security_audit_logs" ON public.security_audit_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access stock_items" ON public.stock_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access stock_in" ON public.stock_in FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access stock_out" ON public.stock_out FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access stock_logs" ON public.stock_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access stock_in_entries" ON public.stock_in_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access stock_out_entries" ON public.stock_out_entries FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SUPABASE REALTIME REPLICATION SETUP
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_items;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.combos;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coupons;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_overrides;
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. INITIAL DEFAULT RECORDS
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.printer_settings (
  id, printer_model, active_printer_name, kot_paper_width, bill_paper_width,
  restaurant_name, restaurant_address, restaurant_phone
)
VALUES (
  'default', 'TVS RP3200 Plus', 'Thermal Printer', 80, 80,
  'LIMRA RESTAURANT', 'Main Road, Near Bus Stand', '+91 98765 43210'
)
ON CONFLICT (id) DO NOTHING;

-- Complete setup message
SELECT '✅ LIMRA Supabase schema and RPC suite successfully installed!' AS result;
