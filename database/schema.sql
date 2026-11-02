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
  subtotal_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (subtotal_amount >= 0),
  discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
  taxable_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (taxable_amount >= 0),
  cgst_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (cgst_amount >= 0),
  sgst_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (sgst_amount >= 0),
  delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (delivery_fee >= 0),
  packaging_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (packaging_fee >= 0),
  round_off_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
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
  ticket_status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (ticket_status IN ('OPEN', 'HOLD', 'BILLED', 'PAID', 'CLOSED', 'CANCELLED')),
  idempotency_key TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  settled_at TIMESTAMPTZ,
  consolidated_into_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key 
  ON public.orders(idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_settled_at 
  ON public.orders(settled_at DESC) 
  WHERE settled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_consolidated_into 
  ON public.orders(consolidated_into_order_id) 
  WHERE consolidated_into_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_taxable_amount 
  ON public.orders(taxable_amount) 
  WHERE taxable_amount > 0;
  ON public.orders(idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

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

-- Trigger: Prevent attaching, modifying, or deleting order items on a CLOSED or CANCELLED ticket
-- unless inside an authorized server-side atomic amendment transaction (limra.authorized_amendment = 'true').
CREATE OR REPLACE FUNCTION public.check_ticket_not_closed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ticket_status text;
  v_order_id uuid;
BEGIN
  IF COALESCE(current_setting('limra.authorized_amendment', true), '') = 'true' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;

  SELECT ticket_status INTO v_ticket_status
  FROM public.orders
  WHERE id = v_order_id;

  IF v_ticket_status IN ('CLOSED', 'CANCELLED') THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Cannot attach items to a % ticket (order_id: %)', v_ticket_status, v_order_id;
    ELSIF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'Cannot directly modify items on a % ticket (order_id: %). Use amend_closed_order_atomic.', v_ticket_status, v_order_id;
    ELSIF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Cannot directly delete items from a % ticket (order_id: %). Use amend_closed_order_atomic.', v_ticket_status, v_order_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_ticket_not_closed ON public.order_items;
CREATE TRIGGER trg_check_ticket_not_closed
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.check_ticket_not_closed();

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
  name TEXT NOT NULL DEFAULT 'Staff Member',
  phone TEXT DEFAULT '',
  shift TEXT DEFAULT '10:00 AM - 08:00 PM',
  status TEXT NOT NULL DEFAULT 'on_duty',
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT DEFAULT '',
  pin_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  total_tables INTEGER DEFAULT 19,
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
  bill_qr_size TEXT DEFAULT 'medium',
  bill_show_review_qr BOOLEAN DEFAULT true,
  bill_review_url TEXT DEFAULT 'https://g.page/r/CcrqEfWap5zfEBE/review',
  bill_review_heading TEXT DEFAULT 'LOVE YOUR EXPERIENCE?',
  bill_review_subtext TEXT DEFAULT 'Scan to leave us a Google Review',
  direct_print_enabled BOOLEAN DEFAULT true,
  auto_print_on_settle BOOLEAN DEFAULT true,
  print_queue_retry_limit INTEGER DEFAULT 3,
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

-- 1.17 TRANSACTIONAL SYNC QUEUE (OUTBOX PATTERN FOR SIDE EFFECTS)
CREATE TABLE IF NOT EXISTS public.sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('order_print', 'google_sheet', 'webhook_outbound', 'stock_sync')),
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_pending 
  ON public.sync_queue(status, created_at) 
  WHERE status = 'pending';

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

-- 2.5 STOCK IN ENTRIES (ARCHIVAL / BATCH COMPATIBILITY)
-- NOTE: Primary active stock intake uses public.stock_in and RPC public.record_stock_in.
-- This table is retained for historical archival compatibility and must not be dropped without a verified migration.
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

-- 2.6 STOCK OUT ENTRIES (ARCHIVAL / BATCH COMPATIBILITY)
-- NOTE: Primary active stock consumption uses public.stock_out and RPC public.record_stock_out.
-- This table is retained for historical archival compatibility and must not be dropped without a verified migration.
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
CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON public.orders(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON public.orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_type_created_at ON public.orders(order_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_table_active ON public.orders(table_number, ticket_status) WHERE table_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_order_created ON public.order_items(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_created_at ON public.order_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status_created_at ON public.orders(payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_active_working_set ON public.orders(created_at DESC) WHERE status NOT IN ('delivered', 'cancelled') OR payment_status = 'unpaid';
CREATE INDEX IF NOT EXISTS idx_bookings_updated_at ON public.bookings(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_in_created_at ON public.stock_in(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_in_sku ON public.stock_in(item_sku);
CREATE INDEX IF NOT EXISTS idx_stock_out_created_at ON public.stock_out(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_out_sku ON public.stock_out(item_sku);
CREATE INDEX IF NOT EXISTS idx_stock_items_sku ON public.stock_items(sku);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON public.coupons(active, is_auto_send);
CREATE INDEX IF NOT EXISTS idx_delivery_areas_name ON public.delivery_areas(name);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. TRIGGERS & UTILITY FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_updated_at ON public.orders;
CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS bookings_updated_at ON public.bookings;
CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Check if current authenticated user is an authorized staff/admin
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
    SELECT 1 FROM public.admin_users
    WHERE (user_id = v_uid OR lower(email) = lower(v_email))
      AND lower(COALESCE(role, 'admin')) IN ('owner', 'manager', 'cashier', 'kitchen', 'admin')
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Role checking helper for granular operations
CREATE OR REPLACE FUNCTION public.has_role(required_roles text[])
RETURNS BOOLEAN AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := auth.jwt()->>'email';
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;
  SELECT lower(role) INTO v_role
  FROM public.admin_users
  WHERE user_id = v_uid OR lower(email) = lower(v_email)
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_role = 'owner' THEN
    RETURN TRUE;
  END IF;

  RETURN v_role = ANY(required_roles);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.has_role(text[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(text[]) TO authenticated;

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

REVOKE ALL ON FUNCTION public.log_security_event(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

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

REVOKE ALL ON FUNCTION public.tr_on_profile_upsert_or_verify() FROM PUBLIC, anon, authenticated;

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
  p_txn_ref text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
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
  v_initial_pay_status text := 'unpaid';
  v_initial_pay_method text := 'cash';
  v_clean_key text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  -- Idempotency check: Return existing order if identical idempotency_key is replayed
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

  -- Verify payment if reference is supplied (strict validation against verified_payments)
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

  -- Insert order
  INSERT INTO public.orders (
    customer_name, customer_phone, total_amount, notes, status,
    latitude, longitude, landmark, delivery_notes, location_verified,
    order_type, table_number, table_zone, user_id, txn_ref, payment_status, payment_method,
    ticket_status, idempotency_key
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
    CASE WHEN v_initial_pay_status = 'paid' THEN trim(p_txn_ref) ELSE NULL END,
    v_initial_pay_status,
    v_initial_pay_method,
    'OPEN',
    v_clean_key
  )
  RETURNING * INTO v_order;

  -- Atomically claim payment
  IF v_initial_pay_status = 'paid' AND p_txn_ref IS NOT NULL THEN
    UPDATE public.verified_payments SET order_id = v_order.id WHERE utr = trim(p_txn_ref);
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
-- Upgraded with advisory transaction locking, idempotency replay, and strict session isolation.
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
BEGIN
  -- 1. Input Validation
  IF p_table_number IS NULL OR p_table_number < 1 OR p_table_number > 19 THEN
    RAISE EXCEPTION 'Invalid table number: %. Must be between 1 and 19', p_table_number;
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  -- 2. Idempotency Replay Protection: Check if this specific round was already submitted
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

  -- 3. Advisory Transaction Lock: Serializes concurrent round submissions for the SAME table
  -- Guarantees that two concurrent checkouts at the same table do not create split sessions
  PERFORM pg_advisory_xact_lock(hashtext('limra_table_session_' || p_table_number::text));

  -- 4. Compute round total amount
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_round_total := v_round_total + COALESCE((v_item->>'line_total')::numeric, 0);
  END LOOP;

  -- 5. Determine Table Zone (1-9 = indoor, 10-19 = outdoor)
  v_zone := COALESCE(NULLIF(trim(p_table_zone), ''), CASE WHEN p_table_number <= 9 THEN 'indoor' ELSE 'outdoor' END);

  -- 6. Query for existing ACTIVE ticket at this table
  -- STRICT RULE: Closed, Billed, Paid, or Cancelled tickets are NEVER matched or reopened!
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

  -- 7. Session Decision Logic
  IF FOUND AND v_active_ticket.id IS NOT NULL THEN
    -- Active session exists: attach as next sequential round
    v_is_subsequent := true;
    v_parent_id     := v_active_ticket.id;
    v_order_num     := v_active_ticket.order_number;
    v_zone          := COALESCE(v_active_ticket.table_zone, v_zone);

    -- Calculate round number based on existing non-cancelled orders in this session
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
      AND (o.id = v_active_ticket.id OR o.notes LIKE '%[PARENT_ORDER_ID: ' || v_active_ticket.id || '%')
      AND o.ticket_status IN ('OPEN', 'HOLD')
      AND o.status != 'cancelled';

    v_round_notes := '[ROUND: ' || v_round_num
                  || '] [PARENT_ORDER_ID: ' || v_active_ticket.id
                  || '] [TABLE: ' || p_table_number || ']';
    IF p_notes IS NOT NULL AND trim(p_notes) <> '' THEN
      v_round_notes := v_round_notes || ' ' || trim(p_notes);
    END IF;

    v_dish_count  := jsonb_array_length(p_items);
    v_notif_title := '🍽️ Table ' || p_table_number || ' - Round ' || v_round_num;
    v_notif_msg   := 'Table ' || p_table_number || ' (' || UPPER(v_zone) || ') placed Round ' || v_round_num
                  || ' (' || v_dish_count || ' item' || CASE WHEN v_dish_count > 1 THEN 's' ELSE '' END || ' · ₹' || v_round_total || ')';

  ELSE
    -- No active ticket exists (or previous session was closed/cancelled) -> Brand new session!
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
                  || ' at Table ' || p_table_number || ' (' || UPPER(v_zone) || ')';
  END IF;

  -- 8. Insert Order Header Record
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
    notes,
    idempotency_key
  )
  VALUES (
    v_order_num,
    COALESCE(NULLIF(trim(p_customer_name), ''), CASE WHEN v_active_ticket.customer_name IS NOT NULL THEN v_active_ticket.customer_name ELSE 'Dine-in Guest' END),
    COALESCE(NULLIF(trim(p_customer_phone), ''), CASE WHEN v_active_ticket.customer_phone IS NOT NULL THEN v_active_ticket.customer_phone ELSE '0000000000' END),
    'table',
    p_table_number,
    v_zone,
    v_round_total,
    'pending',
    'unpaid',
    'OPEN',
    v_round_notes,
    v_clean_key
  )
  RETURNING * INTO v_new_order;

  -- 9. Insert Order Items
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

  -- 10. Insert Staff Notification (Reflects committed state)
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
    'order-' || v_new_order.id::text,
    v_new_order.customer_phone,
    false
  );

  -- 11. Return Structured Session Lifecycle Response
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
    'table_number',        p_table_number,
    'table_zone',          v_zone
  );
END;
$$;

-- Overload for backward compatibility with 7 arguments
CREATE OR REPLACE FUNCTION public.place_table_round(
  p_table_number   integer,
  p_table_zone     text,
  p_customer_name  text,
  p_customer_phone text,
  p_items          jsonb,
  p_notes          text,
  p_round_number   integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.place_table_round(
    p_table_number, p_table_zone, p_customer_name, p_customer_phone, p_items, p_notes, p_round_number, NULL
  );
END;
$$;

-- Overload for backward compatibility with 6 arguments
CREATE OR REPLACE FUNCTION public.place_table_round(
  p_table_number   integer,
  p_table_zone     text,
  p_customer_name  text,
  p_customer_phone text,
  p_items          jsonb,
  p_notes          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.place_table_round(
    p_table_number, p_table_zone, p_customer_name, p_customer_phone, p_items, p_notes, 1, NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_table_round(integer, text, text, text, jsonb, text, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_table_round(integer, text, text, text, jsonb, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_table_round(integer, text, text, text, jsonb, text) TO anon, authenticated;

-- 5.2.1 REQUEST TABLE SERVICE RPC (CALL WAITER & REQUEST BILL)
CREATE OR REPLACE FUNCTION public.request_table_service(
  p_table_number  integer,
  p_service_type  text,
  p_customer_name text DEFAULT NULL,
  p_notes         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_active_ticket  public.orders%ROWTYPE;
  v_title          text;
  v_msg            text;
  v_recent_exists  boolean := false;
  v_notif          public.notifications%ROWTYPE;
  v_zone           text;
BEGIN
  -- Input Validation
  IF p_table_number IS NULL OR p_table_number < 1 OR p_table_number > 19 THEN
    RAISE EXCEPTION 'Invalid table number: %. Must be between 1 and 19', p_table_number;
  END IF;

  IF p_service_type NOT IN ('call_waiter', 'request_bill') THEN
    RAISE EXCEPTION 'Invalid service type: %. Must be call_waiter or request_bill', p_service_type;
  END IF;

  v_zone := CASE WHEN p_table_number <= 9 THEN 'Indoor' ELSE 'Outdoor' END;

  -- Rate-limiting: prevent flooding notifications within 60 seconds
  SELECT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE item_id = 'table-' || p_table_number
      AND type = p_service_type
      AND is_read = false
      AND created_at >= (now() - interval '60 seconds')
  ) INTO v_recent_exists;

  IF v_recent_exists THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_notified', true,
      'message', CASE 
        WHEN p_service_type = 'call_waiter' 
          THEN 'Staff has already been notified for Table ' || p_table_number || '. A waiter is on the way!'
        ELSE 'Bill request already received for Table ' || p_table_number || '. Cashier is preparing your bill!'
      END,
      'table_number', p_table_number,
      'service_type', p_service_type
    );
  END IF;

  -- Query for active table session
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
   LIMIT 1;

  -- Construct Notification
  IF v_active_ticket.id IS NOT NULL THEN
    IF p_service_type = 'call_waiter' THEN
      v_title := '🔔 Table ' || p_table_number || ' - Waiter Called';
      v_msg   := 'Table ' || p_table_number || ' (' || v_zone || ' · Order #' || v_active_ticket.order_number || ') is calling for a waiter.';
    ELSE
      v_title := '🧾 Table ' || p_table_number || ' - Bill Requested';
      v_msg   := 'Table ' || p_table_number || ' (' || v_zone || ' · Order #' || v_active_ticket.order_number || ') has requested the bill (₹' || v_active_ticket.total_amount || ').';
    END IF;
  ELSE
    IF p_service_type = 'call_waiter' THEN
      v_title := '🔔 Table ' || p_table_number || ' - Waiter Called';
      v_msg   := 'Guest at Table ' || p_table_number || ' (' || v_zone || ') is requesting a waiter (no active food order).';
    ELSE
      v_title := '🧾 Table ' || p_table_number || ' - Bill Requested';
      v_msg   := 'Guest at Table ' || p_table_number || ' (' || v_zone || ') requested bill, but no active order is open.';
    END IF;
  END IF;

  IF p_notes IS NOT NULL AND trim(p_notes) <> '' THEN
    v_msg := v_msg || ' Note: ' || trim(p_notes);
  END IF;

  -- Insert Notification into Database
  INSERT INTO public.notifications (
    type,
    title,
    message,
    description,
    order_id,
    item_id,
    customer_phone,
    is_read,
    created_at
  )
  VALUES (
    p_service_type,
    v_title,
    v_msg,
    v_msg,
    v_active_ticket.id,
    'table-' || p_table_number,
    COALESCE(v_active_ticket.customer_phone, '0000000000'),
    false,
    now()
  )
  RETURNING * INTO v_notif;

  RETURN jsonb_build_object(
    'success',            true,
    'already_notified',   false,
    'notification_id',    v_notif.id,
    'table_number',       p_table_number,
    'table_zone',         v_zone,
    'service_type',       p_service_type,
    'has_active_session', (v_active_ticket.id IS NOT NULL),
    'order_id',           v_active_ticket.id,
    'order_number',       v_active_ticket.order_number,
    'session_id',         v_active_ticket.id,
    'message',            CASE
      WHEN p_service_type = 'call_waiter'
        THEN 'Waiter has been called to Table ' || p_table_number || '! 🔔 Staff will assist you shortly.'
      ELSE 'Bill requested for Table ' || p_table_number || '! 🧾 Cashier will bring your bill.'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_table_service(integer, text, text, text) TO anon, authenticated;

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

-- 5.6.1 UPDATE ORDER PAYMENT STATUS (ADMIN ONLY)
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
  v_clean_status text := lower(trim(p_payment_status));
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only administrative staff can update payment status';
  END IF;

  IF v_clean_status NOT IN ('unpaid', 'paid', 'refunded', 'failed') THEN
    RAISE EXCEPTION 'Invalid payment status: %. Allowed values: unpaid, paid, refunded, failed', p_payment_status;
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_prev_status := v_order.payment_status;

  IF v_prev_status = v_clean_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Payment status is already ' || v_clean_status,
      'order_id', p_order_id,
      'payment_status', v_clean_status,
      'idempotent', true
    );
  END IF;

  -- State Transition Enforcement
  IF v_prev_status = 'paid' AND v_clean_status = 'unpaid' THEN
    RAISE EXCEPTION 'Invalid transition: Settled paid orders cannot be reverted to unpaid. Use refund workflow instead.';
  END IF;

  IF v_prev_status = 'refunded' AND v_clean_status != 'refunded' THEN
    RAISE EXCEPTION 'Invalid transition: Refunded orders cannot be modified or re-opened.';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_changed_by FROM public.admin_users WHERE user_id = v_user_id LIMIT 1;
    IF v_changed_by IS NULL THEN
      v_changed_by := 'Admin (' || v_user_id::text || ')';
    END IF;
  ELSE
    v_changed_by := 'system/payment-service';
  END IF;

  UPDATE public.orders
  SET payment_status = v_clean_status,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.payment_history (
    order_id, user_id, previous_status, new_status, changed_by, notes, created_at, updated_at
  )
  VALUES (
    p_order_id, v_user_id, v_prev_status, v_clean_status, v_changed_by,
    COALESCE(p_notes, 'Payment status updated from ' || v_prev_status || ' to ' || v_clean_status),
    now(), now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'payment_status', v_clean_status,
    'previous_status', v_prev_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_order_payment_status(uuid, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_order_payment_status(uuid, text, text) TO authenticated;

-- 5.7 STOCK MANAGEMENT RPCs
CREATE OR REPLACE FUNCTION public.record_stock_out(
  p_item_id uuid,
  p_qty numeric,
  p_reason text DEFAULT 'Kitchen Prep',
  p_used_by text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_allow_negative boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.stock_items%ROWTYPE;
  v_new_qty numeric;
  v_out_id uuid := gen_random_uuid();
  v_log_id uuid := gen_random_uuid();
  v_is_override boolean := false;
  v_details text;
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'Item ID is required';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Stock out quantity must be greater than 0';
  END IF;

  -- Lock item row for update to prevent concurrent race conditions
  SELECT * INTO v_item
  FROM public.stock_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock item not found';
  END IF;

  -- Hard balance validation
  IF (COALESCE(v_item.qty, 0) - p_qty) < 0 THEN
    IF NOT p_allow_negative THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: Available balance is % %, cannot deduct % % without authorized override.',
        COALESCE(v_item.qty, 0), COALESCE(v_item.unit, 'pcs'), p_qty, COALESCE(v_item.unit, 'pcs');
    ELSE
      v_is_override := true;
    END IF;
  END IF;

  v_new_qty := COALESCE(v_item.qty, 0) - p_qty;

  -- Update item quantity
  UPDATE public.stock_items
  SET qty = v_new_qty,
      updated_at = now()
  WHERE id = p_item_id;

  -- Insert stock_out entry
  INSERT INTO public.stock_out (
    id, item_sku, item_name, unit, qty, date, used_by, notes, created_at
  )
  VALUES (
    v_out_id,
    COALESCE(v_item.sku, ''),
    v_item.name,
    COALESCE(v_item.unit, 'pcs'),
    p_qty,
    to_char(now(), 'DD-MM-YYYY'),
    COALESCE(p_used_by, 'Kitchen Staff'),
    p_notes,
    now()
  );

  -- Log action
  v_details := 'Deducted ' || p_qty || ' ' || COALESCE(v_item.unit, 'pcs') || ' of ' || v_item.name
            || ' (Reason: ' || COALESCE(p_reason, 'Kitchen Prep') || ', Balance: ' || v_new_qty || ')';
  IF v_is_override THEN
    v_details := '[OVERRIDE: Negative Stock Allowed] ' || v_details;
  END IF;

  INSERT INTO public.stock_logs (
    id, action, details, created_at
  )
  VALUES (
    v_log_id,
    CASE WHEN v_is_override THEN 'STOCK_OUT_OVERRIDE' ELSE 'STOCK_OUT' END,
    v_details,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'item_id', v_item.id,
    'item_name', v_item.name,
    'previous_qty', v_item.qty,
    'deducted_qty', p_qty,
    'new_qty', v_new_qty,
    'unit', v_item.unit,
    'is_override', v_is_override
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_stock_out(uuid, numeric, text, text, text, boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_stock_out(uuid, numeric, text, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_stock_in(
  p_item_id uuid,
  p_qty numeric,
  p_cost_price numeric DEFAULT NULL,
  p_supplier text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.stock_items%ROWTYPE;
  v_new_qty numeric;
  v_in_id uuid := gen_random_uuid();
  v_log_id uuid := gen_random_uuid();
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'Item ID is required';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Stock in quantity must be greater than 0';
  END IF;

  SELECT * INTO v_item
  FROM public.stock_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock item not found';
  END IF;

  v_new_qty := COALESCE(v_item.qty, 0) + p_qty;

  -- Update item quantity & optionally cost price
  UPDATE public.stock_items
  SET qty = v_new_qty,
      cost_price = COALESCE(p_cost_price, v_item.cost_price),
      supplier = COALESCE(NULLIF(trim(p_supplier), ''), v_item.supplier),
      updated_at = now()
  WHERE id = p_item_id;

  -- Insert stock_in entry
  INSERT INTO public.stock_in (
    id, item_sku, item_name, unit, qty, cost_price, supplier, date, notes, created_at
  )
  VALUES (
    v_in_id,
    COALESCE(v_item.sku, ''),
    v_item.name,
    COALESCE(v_item.unit, 'pcs'),
    p_qty,
    COALESCE(p_cost_price, v_item.cost_price, 0),
    COALESCE(p_supplier, v_item.supplier, ''),
    to_char(now(), 'DD-MM-YYYY'),
    p_notes,
    now()
  );

  -- Log action
  INSERT INTO public.stock_logs (
    id, action, details, created_at
  )
  VALUES (
    v_log_id,
    'STOCK_IN',
    'Added ' || p_qty || ' ' || COALESCE(v_item.unit, 'pcs') || ' of ' || v_item.name
    || ' (New Balance: ' || v_new_qty || ')',
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'item_id', v_item.id,
    'item_name', v_item.name,
    'previous_qty', v_item.qty,
    'added_qty', p_qty,
    'new_qty', v_new_qty,
    'unit', v_item.unit
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_stock_in(uuid, numeric, numeric, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_stock_in(uuid, numeric, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_stock_daily_summary(
  p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_start_of_day timestamptz := p_date::timestamptz;
  v_end_of_day   timestamptz := (p_date + interval '1 day')::timestamptz;
  v_total_items  integer := 0;
  v_low_stock    integer := 0;
  v_in_today     numeric := 0;
  v_out_today    numeric := 0;
  v_current_total numeric := 0;
  v_opening_total numeric := 0;
BEGIN
  -- Total items and current balance sum
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE COALESCE(qty, 0) <= COALESCE(min_qty, 5)),
         COALESCE(SUM(COALESCE(qty, 0)), 0)
    INTO v_total_items, v_low_stock, v_current_total
    FROM public.stock_items;

  -- Stock in today
  SELECT COALESCE(SUM(COALESCE(qty, 0)), 0)
    INTO v_in_today
    FROM public.stock_in
   WHERE created_at >= v_start_of_day AND created_at < v_end_of_day;

  -- Stock out today
  SELECT COALESCE(SUM(COALESCE(qty, 0)), 0)
    INTO v_out_today
    FROM public.stock_out
   WHERE created_at >= v_start_of_day AND created_at < v_end_of_day;

  -- Calculated opening balance = current - in_today + out_today
  v_opening_total := v_current_total - v_in_today + v_out_today;

  RETURN jsonb_build_object(
    'date',             p_date,
    'total_items',      v_total_items,
    'low_stock_count',  v_low_stock,
    'opening_balance',  v_opening_total,
    'stock_in_today',   v_in_today,
    'stock_out_today',  v_out_today,
    'adjustments',      0,
    'current_balance',  v_current_total
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_stock_daily_summary(date) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_stock_daily_summary(date) TO authenticated;

-- 5.75 ORDER STATE TRANSITION INTEGRITY TRIGGER
CREATE OR REPLACE FUNCTION public.validate_order_state_transitions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 1. Payment Status Transition Invariants
  IF OLD.payment_status = 'paid' AND NEW.payment_status = 'unpaid' THEN
    RAISE EXCEPTION 'Invalid payment transition: Settled paid orders cannot be reverted to unpaid. Use refund workflow instead.';
  END IF;

  IF OLD.payment_status = 'refunded' AND NEW.payment_status <> 'refunded' THEN
    RAISE EXCEPTION 'Invalid payment transition: Refunded orders cannot be altered back to paid or unpaid.';
  END IF;

  -- 2. Prevent cancelling paid or closed orders
  IF (OLD.ticket_status = 'CLOSED' OR OLD.payment_status = 'paid' OR OLD.status = 'delivered')
     AND (NEW.status = 'cancelled' OR NEW.ticket_status = 'CANCELLED') THEN
    RAISE EXCEPTION 'Invalid transition: Paid or closed orders cannot be cancelled.';
  END IF;

  -- 3. Ticket Lifecycle Transition Invariants
  IF OLD.ticket_status = 'CLOSED' AND NEW.ticket_status <> 'CLOSED' THEN
    RAISE EXCEPTION 'Invalid ticket transition: Closed tickets cannot be reopened.';
  END IF;

  IF OLD.ticket_status = 'CANCELLED' AND NEW.ticket_status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'Invalid ticket transition: Cancelled tickets cannot be reopened.';
  END IF;

  IF OLD.ticket_status = 'CLOSED' AND NEW.total_amount <> OLD.total_amount
     AND COALESCE(current_setting('limra.authorized_amendment', true), '') <> 'true' THEN
    RAISE EXCEPTION 'Invalid operation: Total amount of a closed ticket cannot be modified.';
  END IF;

  -- Voided / refunded invoices are permanently locked against total modification
  IF (OLD.payment_status = 'refunded' OR COALESCE(OLD.notes, '') LIKE '%[VOIDED]%')
     AND NEW.total_amount <> OLD.total_amount THEN
    RAISE EXCEPTION 'Invalid operation: Voided invoice total cannot be modified.';
  END IF;

  -- 4. Fulfillment Status Transition Invariants
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Invalid fulfillment transition: Cancelled orders cannot be reactivated.';
  END IF;

  -- 5. Keep status = 'cancelled' and ticket_status = 'CANCELLED' synchronized
  IF NEW.status = 'cancelled' AND NEW.ticket_status <> 'CANCELLED' THEN
    NEW.ticket_status := 'CANCELLED';
  ELSIF NEW.ticket_status = 'CANCELLED' AND NEW.status <> 'cancelled' THEN
    NEW.status := 'cancelled';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_order_state_transitions ON public.orders;
CREATE TRIGGER trg_validate_order_state_transitions
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_order_state_transitions();

-- 5.7B PREVENT HARD DELETION OF CLOSED/PAID FINANCIAL INVOICES & PAYMENT HISTORY
CREATE OR REPLACE FUNCTION public.prevent_financial_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.ticket_status = 'CLOSED'
     OR OLD.payment_status IN ('paid', 'refunded')
     OR OLD.status = 'delivered'
     OR COALESCE(OLD.notes, '') LIKE '%[VOIDED]%' THEN
    RAISE EXCEPTION 'HARD_DELETE_FORBIDDEN: Closed or settled financial invoice #% (id: %) cannot be permanently deleted. Use void_closed_order_atomic instead.', OLD.order_number, OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_financial_order_delete ON public.orders;
CREATE TRIGGER trg_prevent_financial_order_delete
  BEFORE DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_financial_order_delete();

CREATE OR REPLACE FUNCTION public.prevent_payment_history_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'HARD_DELETE_FORBIDDEN: Financial payment_history records are immutable and cannot be deleted (order_id: %).', OLD.order_id;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_payment_history_delete ON public.payment_history;
CREATE TRIGGER trg_prevent_payment_history_delete
  BEFORE DELETE ON public.payment_history
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_payment_history_delete();

-- 5.8 ATOMIC ORDER INVENTORY DEDUCTION RPC
CREATE OR REPLACE FUNCTION public.deduct_order_inventory_atomic(
  p_order_id uuid,
  p_order_number integer,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_qty numeric;
  v_name text;
  v_stk public.stock_items%ROWTYPE;
  v_deducted_count integer := 0;
  v_already_logged boolean := false;
  v_order_tag text := 'Order #' || COALESCE(p_order_number, 0) ||
    CASE WHEN p_order_id IS NOT NULL THEN ' [OrderID:' || p_order_id::text || ']' ELSE '' END;
BEGIN
  -- Idempotency Check: Prevent duplicate deductions for the same order (by order_id or order_number)
  SELECT EXISTS (
    SELECT 1 FROM public.stock_logs
    WHERE action = 'ORDER_DEDUCT'
      AND (
        (p_order_number IS NOT NULL AND p_order_number > 0 AND details ILIKE '%Order #' || p_order_number || '%')
        OR (p_order_id IS NOT NULL AND details ILIKE '%[OrderID:' || p_order_id::text || ']%')
      )
  ) INTO v_already_logged;

  IF v_already_logged THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_deducted', true,
      'deducted_count', 0,
      'message', 'Inventory was already deducted for Order #' || COALESCE(p_order_number, 0)
    );
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', true, 'already_deducted', false, 'deducted_count', 0);
  END IF;

  -- Deduct each consolidated item atomically with row-level locking
  FOR v_item IN
    SELECT jsonb_build_object(
      'name', clean_name,
      'quantity', SUM(item_qty)
    )
    FROM (
      SELECT trim(regexp_replace(COALESCE(val->>'name', val->>'item_name', ''), '\s*\[Note:.*\]$', '', 'i')) AS clean_name,
             GREATEST(1, COALESCE((val->>'quantity')::numeric, (val->>'qty')::numeric, 1)) AS item_qty
      FROM jsonb_array_elements(p_items) AS val
    ) raw_items
    WHERE clean_name <> ''
    GROUP BY clean_name
  LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::numeric, 1));
    v_name := trim(COALESCE(v_item->>'name', ''));

    IF v_name <> '' THEN
      SELECT * INTO v_stk
      FROM public.stock_items
      WHERE lower(trim(name)) = lower(v_name)
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.stock_items
        SET qty = GREATEST(0, (COALESCE(qty, 0) - v_qty)),
            updated_at = now()
        WHERE id = v_stk.id;

        INSERT INTO public.stock_logs (
          id, action, details, created_at
        )
        VALUES (
          gen_random_uuid(),
          'ORDER_DEDUCT',
          v_stk.name || ' deducted ' || v_qty || ' ' || COALESCE(v_stk.unit, 'pcs') || ' for ' || v_order_tag,
          now()
        );

        INSERT INTO public.stock_out (
          id, item_sku, item_name, unit, qty, date, used_by, notes, created_at
        )
        VALUES (
          gen_random_uuid()::text,
          v_stk.sku,
          v_stk.name,
          COALESCE(v_stk.unit, 'pcs'),
          v_qty,
          to_char(now(), 'DD-MM-YYYY'),
          'System Order Settlement',
          'Auto deduction for ' || v_order_tag,
          now()
        );

        v_deducted_count := v_deducted_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'already_deducted', false,
    'deducted_count', v_deducted_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deduct_order_inventory_atomic(uuid, integer, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.deduct_order_inventory_atomic(uuid, integer, jsonb) TO authenticated;

-- 5.9 ATOMIC POS BILL SETTLEMENT RPC
CREATE OR REPLACE FUNCTION public.settle_order_atomic(
  p_order_id uuid,
  p_payment_method text DEFAULT 'cash',
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_prev_pay_status text;
  v_items jsonb;
  v_inv_result jsonb := jsonb_build_object('success', true, 'already_deducted', false, 'deducted_count', 0);
  v_cashier_id uuid := auth.uid();
  v_clean_key text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_clean_method text := lower(trim(COALESCE(NULLIF(trim(COALESCE(p_payment_method, '')), ''), 'cash')));
  v_history_inserted boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff credentials required to settle orders';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % does not exist', p_order_id;
  END IF;

  IF v_order.status = 'cancelled' OR v_order.ticket_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'ORDER_CANCELLED: Order #% is cancelled and cannot be settled.', v_order.order_number;
  END IF;

  IF v_order.ticket_status = 'CLOSED' AND v_order.payment_status = 'paid' THEN
    IF v_clean_key IS NOT NULL AND v_order.idempotency_key = v_clean_key THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'ticket_status', v_order.ticket_status,
        'payment_method', v_order.payment_method,
        'total_amount', v_order.total_amount,
        'idempotent_replay', true,
        'message', 'Order already settled'
      );
    ELSE
      RAISE EXCEPTION 'ORDER_ALREADY_SETTLED: Order #% has already been settled and closed by another cashier.', v_order.order_number;
    END IF;
  END IF;

  v_prev_pay_status := COALESCE(v_order.payment_status, 'unpaid');
  IF v_clean_method = 'online' THEN
    v_clean_method := 'upi';
  END IF;

  -- 1. Update Order Settlement & Payment Status Atomically
  UPDATE public.orders
  SET status = 'delivered',
      payment_status = 'paid',
      ticket_status = 'CLOSED',
      payment_method = COALESCE(v_clean_method, v_order.payment_method, 'cash'),
      notes = COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), v_order.notes),
      idempotency_key = COALESCE(v_clean_key, v_order.idempotency_key),
      settled_at = COALESCE(v_order.settled_at, now()),
      updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- 2. Insert Payment History (Idempotent: Prevent duplicate paid history records for the same order)
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_history
    WHERE order_id = p_order_id
      AND new_status = 'paid'
  ) THEN
    INSERT INTO public.payment_history (
      order_id, user_id, previous_status, new_status, changed_by, notes, reason, created_at
    )
    VALUES (
      p_order_id,
      v_cashier_id,
      v_prev_pay_status,
      'paid',
      COALESCE(v_cashier_id::text, 'pos_cashier'),
      COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), 'POS Final Bill Settlement (' || UPPER(v_order.payment_method) || ')'),
      'POS Final Bill Settlement (' || UPPER(v_order.payment_method) || ')',
      now()
    );
    v_history_inserted := true;
  END IF;

  -- 3. Deduct Required Inventory Atomically (Idempotent per order)
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', item_name,
      'quantity', quantity
    )
  ) INTO v_items
  FROM public.order_items
  WHERE order_id = p_order_id;

  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    v_inv_result := public.deduct_order_inventory_atomic(p_order_id, v_order.order_number, v_items);
  END IF;

  -- 4. Enqueue Outbox Sync (Idempotent per order settlement)
  IF NOT EXISTS (
    SELECT 1 FROM public.sync_queue
    WHERE entity_type = 'google_sheet'
      AND entity_id = v_order.id::text
  ) THEN
    INSERT INTO public.sync_queue (
      entity_type, entity_id, payload, status, created_at, updated_at
    )
    VALUES (
      'google_sheet',
      v_order.id::text,
      jsonb_build_object(
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'total_amount', v_order.total_amount,
        'order_type', v_order.order_type,
        'payment_method', v_order.payment_method,
        'table_number', v_order.table_number,
        'customer_name', v_order.customer_name,
        'customer_phone', v_order.customer_phone,
        'settled_at', now()
      ),
      'pending',
      now(),
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'ticket_status', v_order.ticket_status,
    'payment_method', v_order.payment_method,
    'total_amount', v_order.total_amount,
    'payment_history_inserted', v_history_inserted,
    'inventory', v_inv_result,
    'idempotent_replay', false,
    'message', 'Order settled and closed successfully'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_order_atomic(uuid, text, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_order_atomic(uuid, text, text, text) TO authenticated;

-- 5.10 AUDITABLE VOID OF CLOSED FINANCIAL INVOICES RPC (MANAGER/OWNER/ADMIN ONLY)
CREATE OR REPLACE FUNCTION public.void_closed_order_atomic(
  p_order_id uuid,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_actor_email text := COALESCE(auth.jwt()->>'email', 'manager@limra.pos');
  v_actor_role text := 'manager';
  v_clean_reason text := trim(COALESCE(p_reason, ''));
  v_clean_key text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_prev_pay_status text;
  v_orig_items jsonb := '[]'::jsonb;
  v_orig_snapshot jsonb;
  v_void_tag text;
  v_updated_notes text;
  v_audit_details jsonb;
BEGIN
  -- 1. Server-Side Manager / Owner / Admin Authorization Check
  IF NOT public.has_role(ARRAY['owner', 'manager', 'admin']) THEN
    INSERT INTO public.security_audit_logs (user_id, action, result, details, created_at)
    VALUES (
      v_actor_id,
      'ORDER_VOID_REJECTED',
      'forbidden',
      jsonb_build_object(
        'order_id', p_order_id,
        'reason', v_clean_reason,
        'error', 'FORBIDDEN: Manager, Owner, or Admin role required to void a closed order'
      ),
      now()
    );
    RAISE EXCEPTION 'FORBIDDEN: Manager, Owner, or Admin authorization is required to void closed financial invoices';
  END IF;

  -- 2. Mandatory Input & Reason Validation
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_ID_REQUIRED: Order ID is required';
  END IF;

  IF length(v_clean_reason) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: A valid reason (minimum 3 characters) is required to void an invoice';
  END IF;

  -- 3. Resolve Actor Identity from admin_users
  SELECT role, email INTO v_actor_role, v_actor_email
  FROM public.admin_users
  WHERE is_active = true
    AND (user_id = v_actor_id OR lower(email) = lower(v_actor_email))
  LIMIT 1;
  v_actor_role := COALESCE(v_actor_role, 'manager');
  v_actor_email := COALESCE(v_actor_email, 'manager@limra.pos');

  -- 4. Lock Order Row Exclusively
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % does not exist', p_order_id;
  END IF;

  -- 5. Idempotency & Duplicate Void Prevention
  IF v_order.payment_status = 'refunded' OR COALESCE(v_order.notes, '') LIKE '%[VOIDED]%' THEN
    IF v_clean_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.security_audit_logs
      WHERE action = 'ORDER_VOID'
        AND details->>'order_id' = v_order.id::text
        AND details->>'idempotency_key' = v_clean_key
    ) THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent_replay', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'ticket_status', v_order.ticket_status,
        'total_amount', v_order.total_amount,
        'voided', true,
        'reason', v_clean_reason,
        'message', 'Order already voided (idempotent replay)'
      );
    END IF;
    RAISE EXCEPTION 'ORDER_ALREADY_VOIDED: Order #% has already been voided', v_order.order_number;
  END IF;

  v_prev_pay_status := COALESCE(v_order.payment_status, 'paid');

  -- 6. Capture Complete Original Invoice Snapshot (Order Header + Order Items)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'menu_item_id', oi.menu_item_id,
        'item_name', oi.item_name,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'line_total', oi.line_total
      ) ORDER BY oi.created_at ASC, oi.id ASC
    ),
    '[]'::jsonb
  ) INTO v_orig_items
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  v_orig_snapshot := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'customer_name', v_order.customer_name,
    'customer_phone', v_order.customer_phone,
    'order_type', v_order.order_type,
    'table_number', v_order.table_number,
    'total_amount', v_order.total_amount,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'payment_method', v_order.payment_method,
    'ticket_status', v_order.ticket_status,
    'notes', v_order.notes,
    'created_at', v_order.created_at,
    'items', v_orig_items
  );

  -- 7. Transition Order to Voided/Refunded while Preserving Original Invoice & Order Items
  v_void_tag := format(
    '[VOIDED] [VOID_REASON: %s] [VOIDED_BY: %s (%s)] [VOIDED_AT: %s] [ORIG_TOTAL: %s]',
    replace(replace(v_clean_reason, '[', '('), ']', ')'),
    v_actor_email,
    v_actor_role,
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    v_order.total_amount
  );
  v_updated_notes := trim(COALESCE(v_order.notes, '') || ' ' || v_void_tag);

  UPDATE public.orders
  SET
    payment_status = 'refunded',
    ticket_status  = 'CLOSED',
    notes          = v_updated_notes,
    updated_at     = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- 8. Append Immutable Payment History Entry (Preserving Prior Settlement Entries)
  INSERT INTO public.payment_history (
    order_id, user_id, previous_status, new_status, changed_by, notes, reason, created_at
  )
  VALUES (
    p_order_id,
    v_actor_id,
    v_prev_pay_status,
    'refunded',
    COALESCE(v_actor_id::text, v_actor_email),
    'VOIDED INVOICE #' || v_order.order_number || ': ' || v_clean_reason,
    v_clean_reason,
    now()
  );

  -- 9. Record Comprehensive Financial Audit Log Entry
  v_audit_details := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'original_order_reference', jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'created_at', v_order.created_at
    ),
    'actor', jsonb_build_object(
      'user_id', v_actor_id,
      'email', v_actor_email,
      'role', v_actor_role
    ),
    'timestamp', now(),
    'reason', v_clean_reason,
    'idempotency_key', v_clean_key,
    'original_invoice', v_orig_snapshot,
    'adjustment_details', jsonb_build_object(
      'action_type', 'VOID',
      'previous_payment_status', v_prev_pay_status,
      'new_payment_status', 'refunded',
      'previous_total', v_order.total_amount,
      'voided_amount', v_order.total_amount,
      'net_effective_total', 0
    )
  );

  INSERT INTO public.security_audit_logs (
    user_id, action, result, details, created_at
  )
  VALUES (
    v_actor_id,
    'ORDER_VOID',
    'success',
    v_audit_details,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'ticket_status', v_order.ticket_status,
    'total_amount', v_order.total_amount,
    'notes', v_order.notes,
    'voided', true,
    'reason', v_clean_reason,
    'actor', jsonb_build_object('user_id', v_actor_id, 'email', v_actor_email, 'role', v_actor_role),
    'audit_details', v_audit_details,
    'message', 'Invoice voided and recorded in financial audit log'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.void_closed_order_atomic(uuid, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_closed_order_atomic(uuid, text, text) TO authenticated;

-- 5.11 AUDITABLE AMENDMENT OF CLOSED FINANCIAL INVOICES RPC (MANAGER/OWNER/ADMIN ONLY)
CREATE OR REPLACE FUNCTION public.amend_closed_order_atomic(
  p_order_id uuid,
  p_updated_items jsonb DEFAULT '[]'::jsonb,
  p_updated_fields jsonb DEFAULT '{}'::jsonb,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_actor_email text := COALESCE(auth.jwt()->>'email', 'manager@limra.pos');
  v_actor_role text := 'manager';
  v_clean_reason text := trim(COALESCE(p_reason, ''));
  v_clean_key text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_orig_items jsonb := '[]'::jsonb;
  v_new_items jsonb := '[]'::jsonb;
  v_orig_snapshot jsonb;
  v_prev_total numeric;
  v_new_total numeric := 0;
  v_items_subtotal numeric := 0;
  v_item jsonb;
  v_item_name text;
  v_item_qty integer;
  v_item_price numeric;
  v_item_line_total numeric;
  v_menu_item_id integer;
  v_amend_tag text;
  v_base_notes text;
  v_updated_notes text;
  v_audit_details jsonb;
BEGIN
  -- 1. Server-Side Manager / Owner / Admin Authorization Check
  IF NOT public.has_role(ARRAY['owner', 'manager', 'admin']) THEN
    INSERT INTO public.security_audit_logs (user_id, action, result, details, created_at)
    VALUES (
      v_actor_id,
      'ORDER_AMENDMENT_REJECTED',
      'forbidden',
      jsonb_build_object(
        'order_id', p_order_id,
        'reason', v_clean_reason,
        'error', 'FORBIDDEN: Manager, Owner, or Admin role required to amend a closed order'
      ),
      now()
    );
    RAISE EXCEPTION 'FORBIDDEN: Manager, Owner, or Admin authorization is required to amend closed financial invoices';
  END IF;

  -- 2. Mandatory Input, Reason & Items Validation
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_ID_REQUIRED: Order ID is required';
  END IF;

  IF length(v_clean_reason) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: A valid reason (minimum 3 characters) is required to amend a closed invoice';
  END IF;

  IF p_updated_items IS NULL OR jsonb_typeof(p_updated_items) <> 'array' OR jsonb_array_length(p_updated_items) = 0 THEN
    RAISE EXCEPTION 'ITEMS_REQUIRED: An amended invoice must contain at least one item. To void the entire invoice, use void_closed_order_atomic.';
  END IF;

  -- 3. Resolve Actor Identity from admin_users
  SELECT role, email INTO v_actor_role, v_actor_email
  FROM public.admin_users
  WHERE is_active = true
    AND (user_id = v_actor_id OR lower(email) = lower(v_actor_email))
  LIMIT 1;
  v_actor_role := COALESCE(v_actor_role, 'manager');
  v_actor_email := COALESCE(v_actor_email, 'manager@limra.pos');

  -- 4. Lock Order Row Exclusively
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % does not exist', p_order_id;
  END IF;

  IF v_order.payment_status = 'refunded' OR COALESCE(v_order.notes, '') LIKE '%[VOIDED]%' THEN
    RAISE EXCEPTION 'ORDER_ALREADY_VOIDED: Voided order #% cannot be amended', v_order.order_number;
  END IF;

  -- 5. Idempotency Replay Protection
  IF v_clean_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.security_audit_logs
    WHERE action = 'ORDER_AMENDMENT'
      AND details->>'order_id' = v_order.id::text
      AND details->>'idempotency_key' = v_clean_key
  ) THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', oi.id,
          'menu_item_id', oi.menu_item_id,
          'item_name', oi.item_name,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'line_total', oi.line_total
        ) ORDER BY oi.created_at ASC, oi.id ASC
      ),
      '[]'::jsonb
    ) INTO v_new_items
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id;

    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'total_amount', v_order.total_amount,
      'payment_status', v_order.payment_status,
      'ticket_status', v_order.ticket_status,
      'items', v_new_items,
      'reason', v_clean_reason,
      'message', 'Order amendment already applied (idempotent replay)'
    );
  END IF;

  v_prev_total := COALESCE(v_order.total_amount, 0);

  -- 6. Capture Pre-Amendment Original Invoice Snapshot
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'menu_item_id', oi.menu_item_id,
        'item_name', oi.item_name,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'line_total', oi.line_total
      ) ORDER BY oi.created_at ASC, oi.id ASC
    ),
    '[]'::jsonb
  ) INTO v_orig_items
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  v_orig_snapshot := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'customer_name', v_order.customer_name,
    'customer_phone', v_order.customer_phone,
    'order_type', v_order.order_type,
    'table_number', v_order.table_number,
    'total_amount', v_order.total_amount,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'payment_method', v_order.payment_method,
    'ticket_status', v_order.ticket_status,
    'notes', v_order.notes,
    'created_at', v_order.created_at,
    'items', v_orig_items
  );

  -- 7. Enable Transaction-Local Authorized Amendment Flag for Trigger Bypass
  PERFORM set_config('limra.authorized_amendment', 'true', true);

  -- 8. Atomically Replace Order Items for the Closed Invoice
  DELETE FROM public.order_items
  WHERE order_id = p_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_updated_items)
  LOOP
    v_menu_item_id := NULLIF(trim(COALESCE(v_item->>'menu_item_id', '')), '')::integer;
    v_item_name := trim(COALESCE(v_item->>'item_name', v_item->>'name', 'Item'));
    v_item_qty := GREATEST(1, COALESCE((v_item->>'quantity')::integer, (v_item->>'qty')::integer, 1));
    v_item_price := GREATEST(0, COALESCE((v_item->>'unit_price')::numeric, (v_item->>'price')::numeric, 0));
    v_item_line_total := round(v_item_qty * v_item_price, 2);
    v_items_subtotal := v_items_subtotal + v_item_line_total;

    INSERT INTO public.order_items (
      order_id, menu_item_id, item_name, quantity, unit_price, line_total
    )
    VALUES (
      p_order_id, v_menu_item_id, v_item_name, v_item_qty, v_item_price, v_item_line_total
    );
  END LOOP;

  -- 9. Compute Authoritative Amended Total & Metadata
  IF p_updated_fields IS NOT NULL AND (p_updated_fields ? 'total_amount') AND (p_updated_fields->>'total_amount') IS NOT NULL THEN
    v_new_total := GREATEST(0, round((p_updated_fields->>'total_amount')::numeric, 2));
  ELSE
    -- Default 5% GST (2.5% CGST + 2.5% SGST) floored to whole rupee if total_amount not supplied
    v_new_total := floor(v_items_subtotal + round(v_items_subtotal * 0.025, 2) + round(v_items_subtotal * 0.025, 2));
  END IF;

  v_base_notes := COALESCE(NULLIF(trim(COALESCE(p_updated_fields->>'notes', '')), ''), COALESCE(v_order.notes, ''));
  v_amend_tag := format(
    '[AMENDED] [AMEND_REASON: %s] [AMENDED_BY: %s (%s)] [AMENDED_AT: %s] [ORIG_TOTAL: %s]',
    replace(replace(v_clean_reason, '[', '('), ']', ')'),
    v_actor_email,
    v_actor_role,
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    v_prev_total
  );
  v_updated_notes := trim(v_base_notes || ' ' || v_amend_tag);

  UPDATE public.orders
  SET
    customer_name  = COALESCE(NULLIF(trim(COALESCE(p_updated_fields->>'customer_name', '')), ''), v_order.customer_name),
    customer_phone = COALESCE(NULLIF(trim(COALESCE(p_updated_fields->>'customer_phone', '')), ''), v_order.customer_phone),
    order_type     = COALESCE(NULLIF(trim(COALESCE(p_updated_fields->>'order_type', '')), ''), v_order.order_type),
    table_number   = CASE
                       WHEN p_updated_fields ? 'table_number' THEN NULLIF(trim(COALESCE(p_updated_fields->>'table_number', '')), '')::integer
                       ELSE v_order.table_number
                     END,
    total_amount   = v_new_total,
    notes          = v_updated_notes,
    updated_at     = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Reset GUC flag immediately after controlled mutation
  PERFORM set_config('limra.authorized_amendment', 'false', true);

  -- Fetch newly persisted items
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'menu_item_id', oi.menu_item_id,
        'item_name', oi.item_name,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'line_total', oi.line_total
      ) ORDER BY oi.created_at ASC, oi.id ASC
    ),
    '[]'::jsonb
  ) INTO v_new_items
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  -- 10. Append Immutable Payment History Audit Row
  INSERT INTO public.payment_history (
    order_id, user_id, previous_status, new_status, changed_by, notes, reason, created_at
  )
  VALUES (
    p_order_id,
    v_actor_id,
    COALESCE(v_order.payment_status, 'paid'),
    COALESCE(v_order.payment_status, 'paid'),
    COALESCE(v_actor_id::text, v_actor_email),
    format('AMENDED INVOICE #%s (Total: ₹%s -> ₹%s): %s', v_order.order_number, v_prev_total, v_new_total, v_clean_reason),
    v_clean_reason,
    now()
  );

  -- 11. Record Comprehensive Financial Audit Log Entry
  v_audit_details := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'original_order_reference', jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'created_at', v_order.created_at
    ),
    'actor', jsonb_build_object(
      'user_id', v_actor_id,
      'email', v_actor_email,
      'role', v_actor_role
    ),
    'timestamp', now(),
    'reason', v_clean_reason,
    'idempotency_key', v_clean_key,
    'original_invoice', v_orig_snapshot,
    'adjustment_details', jsonb_build_object(
      'action_type', 'AMENDMENT',
      'previous_total', v_prev_total,
      'new_total', v_new_total,
      'amount_delta', round(v_new_total - v_prev_total, 2),
      'previous_items', v_orig_items,
      'updated_items', v_new_items
    )
  );

  INSERT INTO public.security_audit_logs (
    user_id, action, result, details, created_at
  )
  VALUES (
    v_actor_id,
    'ORDER_AMENDMENT',
    'success',
    v_audit_details,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'customer_name', v_order.customer_name,
    'customer_phone', v_order.customer_phone,
    'order_type', v_order.order_type,
    'table_number', v_order.table_number,
    'total_amount', v_order.total_amount,
    'previous_total', v_prev_total,
    'amount_delta', round(v_new_total - v_prev_total, 2),
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'ticket_status', v_order.ticket_status,
    'notes', v_order.notes,
    'items', v_new_items,
    'reason', v_clean_reason,
    'actor', jsonb_build_object('user_id', v_actor_id, 'email', v_actor_email, 'role', v_actor_role),
    'audit_details', v_audit_details,
    'message', 'Closed invoice amended and recorded in financial audit log'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.amend_closed_order_atomic(uuid, jsonb, jsonb, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.amend_closed_order_atomic(uuid, jsonb, jsonb, text, text) TO authenticated;

-- 5.12 ATOMIC TABLE SESSION TRANSFER RPC
CREATE OR REPLACE FUNCTION public.transfer_table_session_atomic(
  p_source_table integer,
  p_target_table integer,
  p_staff_name text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_email text := '';
  v_actor_role text := 'staff';
  v_source_order_ids uuid[];
  v_target_order_ids uuid[];
  v_source_count integer;
  v_audit_details jsonb;
  v_clean_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_clean_staff text := NULLIF(trim(COALESCE(p_staff_name, '')), '');
BEGIN
  -- 1. Authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff credentials required to transfer table sessions';
  END IF;

  SELECT email, role INTO v_actor_email, v_actor_role
  FROM public.admin_users
  WHERE id = v_actor_id;

  IF v_clean_staff IS NULL THEN
    v_clean_staff := COALESCE(v_actor_email, 'Staff');
  END IF;

  -- 2. Validate table numbers
  IF p_source_table IS NULL OR p_source_table <= 0 THEN
    RAISE EXCEPTION 'INVALID_SOURCE_TABLE: Source table must be a positive integer.';
  END IF;

  IF p_target_table IS NULL OR p_target_table <= 0 THEN
    RAISE EXCEPTION 'INVALID_TARGET_TABLE: Target table must be a positive integer.';
  END IF;

  IF p_source_table = p_target_table THEN
    RAISE EXCEPTION 'SAME_TABLE: Source and target table cannot be the same (Table %).', p_source_table;
  END IF;

  -- 3. Deadlock prevention: Lock advisory keys in sorted order
  PERFORM pg_advisory_xact_lock(hashtext('table_lock_' || LEAST(p_source_table, p_target_table)::text));
  PERFORM pg_advisory_xact_lock(hashtext('table_lock_' || GREATEST(p_source_table, p_target_table)::text));

  -- 4. Find and lock active source orders
  SELECT array_agg(id) INTO v_source_order_ids
  FROM public.orders
  WHERE (table_number = p_source_table OR notes ~* ('\[TABLE:\s*' || p_source_table || '\]'))
    AND status NOT IN ('delivered', 'cancelled', 'billed')
    AND ticket_status NOT IN ('CLOSED', 'CANCELLED', 'BILLED')
  FOR UPDATE;

  v_source_count := COALESCE(array_length(v_source_order_ids, 1), 0);
  IF v_source_count = 0 THEN
    RAISE EXCEPTION 'SOURCE_TABLE_EMPTY: Table % has no active running sessions to transfer.', p_source_table;
  END IF;

  -- 5. Verify target table is free (not occupied or pending unpaid bill)
  SELECT array_agg(id) INTO v_target_order_ids
  FROM public.orders
  WHERE (table_number = p_target_table OR notes ~* ('\[TABLE:\s*' || p_target_table || '\]'))
    AND status NOT IN ('delivered', 'cancelled')
    AND ticket_status NOT IN ('CLOSED', 'CANCELLED')
  FOR UPDATE;

  IF v_target_order_ids IS NOT NULL AND array_length(v_target_order_ids, 1) > 0 THEN
    RAISE EXCEPTION 'TARGET_TABLE_OCCUPIED: Table % is currently occupied or has an active/billed session. Use Table Swap if both tables have active guests.', p_target_table;
  END IF;

  -- 6. Atomically update orders to target table
  UPDATE public.orders
  SET table_number = p_target_table,
      notes = regexp_replace(
        regexp_replace(COALESCE(notes, ''), '\[TABLE:\s*' || p_source_table || '\]', '[TABLE: ' || p_target_table || ']', 'gi'),
        '\[TABLE:\s*Table\s*' || p_source_table || '\]',
        '[TABLE: Table ' || p_target_table || ']',
        'gi'
      ) || ' [TRANSFERRED_FROM_TABLE_' || p_source_table || '_BY_' || v_clean_staff || ']',
      updated_at = now()
  WHERE id = ANY(v_source_order_ids);

  -- 7. Audit log insertion
  v_audit_details := jsonb_build_object(
    'operation', 'TABLE_TRANSFER',
    'source_table', p_source_table,
    'target_table', p_target_table,
    'orders_count', v_source_count,
    'order_ids', v_source_order_ids,
    'reason', v_clean_reason,
    'staff_name', v_clean_staff,
    'actor', jsonb_build_object(
      'id', v_actor_id,
      'email', v_actor_email,
      'role', v_actor_role
    ),
    'timestamp', now()
  );

  INSERT INTO public.security_audit_logs (
    user_id, action, result, details, created_at
  )
  VALUES (
    v_actor_id,
    'TABLE_TRANSFER',
    'success',
    v_audit_details,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'source_table', p_source_table,
    'target_table', p_target_table,
    'transferred_orders_count', v_source_count,
    'order_ids', v_source_order_ids,
    'staff_name', v_clean_staff,
    'message', format('Table %s successfully transferred to Table %s (%s active tickets moved)', p_source_table, p_target_table, v_source_count)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transfer_table_session_atomic(integer, integer, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_table_session_atomic(integer, integer, text, text) TO authenticated;

-- 5.13 ATOMIC TABLE SESSION SWAP RPC
CREATE OR REPLACE FUNCTION public.swap_table_sessions_atomic(
  p_table_a integer,
  p_table_b integer,
  p_staff_name text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_email text := '';
  v_actor_role text := 'staff';
  v_orders_a uuid[];
  v_orders_b uuid[];
  v_count_a integer;
  v_count_b integer;
  v_audit_details jsonb;
  v_clean_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_clean_staff text := NULLIF(trim(COALESCE(p_staff_name, '')), '');
BEGIN
  -- 1. Authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff credentials required to swap table sessions';
  END IF;

  SELECT email, role INTO v_actor_email, v_actor_role
  FROM public.admin_users
  WHERE id = v_actor_id;

  IF v_clean_staff IS NULL THEN
    v_clean_staff := COALESCE(v_actor_email, 'Staff');
  END IF;

  -- 2. Validate table numbers
  IF p_table_a IS NULL OR p_table_a <= 0 THEN
    RAISE EXCEPTION 'INVALID_TABLE_A: Table A must be a positive integer.';
  END IF;

  IF p_table_b IS NULL OR p_table_b <= 0 THEN
    RAISE EXCEPTION 'INVALID_TABLE_B: Table B must be a positive integer.';
  END IF;

  IF p_table_a = p_table_b THEN
    RAISE EXCEPTION 'SAME_TABLE: Cannot swap a table with itself (Table %).', p_table_a;
  END IF;

  -- 3. Deadlock prevention: Lock advisory keys in sorted order
  PERFORM pg_advisory_xact_lock(hashtext('table_lock_' || LEAST(p_table_a, p_table_b)::text));
  PERFORM pg_advisory_xact_lock(hashtext('table_lock_' || GREATEST(p_table_a, p_table_b)::text));

  -- 4. Find and lock active orders for Table A and Table B
  SELECT array_agg(id) INTO v_orders_a
  FROM public.orders
  WHERE (table_number = p_table_a OR notes ~* ('\[TABLE:\s*' || p_table_a || '\]'))
    AND status NOT IN ('delivered', 'cancelled', 'billed')
    AND ticket_status NOT IN ('CLOSED', 'CANCELLED', 'BILLED')
  FOR UPDATE;

  SELECT array_agg(id) INTO v_orders_b
  FROM public.orders
  WHERE (table_number = p_table_b OR notes ~* ('\[TABLE:\s*' || p_table_b || '\]'))
    AND status NOT IN ('delivered', 'cancelled', 'billed')
    AND ticket_status NOT IN ('CLOSED', 'CANCELLED', 'BILLED')
  FOR UPDATE;

  v_count_a := COALESCE(array_length(v_orders_a, 1), 0);
  v_count_b := COALESCE(array_length(v_orders_b, 1), 0);

  IF v_count_a = 0 THEN
    RAISE EXCEPTION 'TABLE_A_EMPTY: Table % has no active session to swap.', p_table_a;
  END IF;

  IF v_count_b = 0 THEN
    RAISE EXCEPTION 'TABLE_B_EMPTY: Table % has no active session to swap.', p_table_b;
  END IF;

  -- 5. Safe atomic swap using temporary sentinel -999 for Table A
  -- Step 5a: Move Table A to -999
  UPDATE public.orders
  SET table_number = -999,
      updated_at = now()
  WHERE id = ANY(v_orders_a);

  -- Step 5b: Move Table B to Table A
  UPDATE public.orders
  SET table_number = p_table_a,
      notes = regexp_replace(
        regexp_replace(COALESCE(notes, ''), '\[TABLE:\s*' || p_table_b || '\]', '[TABLE: ' || p_table_a || ']', 'gi'),
        '\[TABLE:\s*Table\s*' || p_table_b || '\]',
        '[TABLE: Table ' || p_table_a || ']',
        'gi'
      ) || ' [SWAPPED_FROM_TABLE_' || p_table_b || '_BY_' || v_clean_staff || ']',
      updated_at = now()
  WHERE id = ANY(v_orders_b);

  -- Step 5c: Move sentinel (-999) Table A to Table B
  UPDATE public.orders
  SET table_number = p_table_b,
      notes = regexp_replace(
        regexp_replace(COALESCE(notes, ''), '\[TABLE:\s*' || p_table_a || '\]', '[TABLE: ' || p_table_b || ']', 'gi'),
        '\[TABLE:\s*Table\s*' || p_table_a || '\]',
        '[TABLE: Table ' || p_table_b || ']',
        'gi'
      ) || ' [SWAPPED_FROM_TABLE_' || p_table_a || '_BY_' || v_clean_staff || ']',
      updated_at = now()
  WHERE id = ANY(v_orders_a);

  -- 6. Audit Logging
  v_audit_details := jsonb_build_object(
    'operation', 'TABLE_SWAP',
    'table_a', p_table_a,
    'table_b', p_table_b,
    'table_a_orders_count', v_count_a,
    'table_b_orders_count', v_count_b,
    'table_a_order_ids', v_orders_a,
    'table_b_order_ids', v_orders_b,
    'reason', v_clean_reason,
    'staff_name', v_clean_staff,
    'actor', jsonb_build_object(
      'id', v_actor_id,
      'email', v_actor_email,
      'role', v_actor_role
    ),
    'timestamp', now()
  );

  INSERT INTO public.security_audit_logs (
    user_id, action, result, details, created_at
  )
  VALUES (
    v_actor_id,
    'TABLE_SWAP',
    'success',
    v_audit_details,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'table_a', p_table_a,
    'table_b', p_table_b,
    'table_a_orders_count', v_count_a,
    'table_b_orders_count', v_count_b,
    'staff_name', v_clean_staff,
    'message', format('Table %s and Table %s successfully swapped (%s and %s tickets interchanged)', p_table_a, p_table_b, v_count_a, v_count_b)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.swap_table_sessions_atomic(integer, integer, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.swap_table_sessions_atomic(integer, integer, text, text) TO authenticated;

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

-- Store catalog public read & admin manage policies
DROP POLICY IF EXISTS "Public full access delivery_areas" ON public.delivery_areas;
CREATE POLICY "Public can view delivery areas" ON public.delivery_areas FOR SELECT USING (true);
CREATE POLICY "Admins can manage delivery areas" ON public.delivery_areas FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Public full access combos" ON public.combos;
CREATE POLICY "Public can view combos" ON public.combos FOR SELECT USING (true);
CREATE POLICY "Admins can manage combos" ON public.combos FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Public full access menu_overrides" ON public.menu_overrides;
CREATE POLICY "Public can view menu overrides" ON public.menu_overrides FOR SELECT USING (true);
CREATE POLICY "Admins can manage menu overrides" ON public.menu_overrides FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Public full access coupons" ON public.coupons;
CREATE POLICY "Public can view coupons" ON public.coupons FOR SELECT USING (true);
CREATE POLICY "Public can increment coupon usage" ON public.coupons FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admins can manage coupons" ON public.coupons FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Public full access coupon_usage" ON public.coupon_usage;
CREATE POLICY "Public can check coupon usage" ON public.coupon_usage FOR SELECT USING (true);
CREATE POLICY "Public can insert coupon usage" ON public.coupon_usage FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can manage coupon usage" ON public.coupon_usage FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Public full access reviews" ON public.reviews;
CREATE POLICY "Public can view reviews" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "Public can insert reviews" ON public.reviews FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can manage reviews" ON public.reviews FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Admin & Internal security policies
DROP POLICY IF EXISTS "Public full access admin_users" ON public.admin_users;
CREATE POLICY "Admins can read admin_users" ON public.admin_users FOR SELECT TO authenticated USING (user_id = auth.uid() OR lower(email) = lower(auth.jwt()->>'email') OR public.is_admin());
CREATE POLICY "Admins can manage admin_users" ON public.admin_users FOR ALL TO authenticated USING (public.has_role(ARRAY['owner', 'manager', 'admin'])) WITH CHECK (public.has_role(ARRAY['owner', 'manager', 'admin']));

DROP POLICY IF EXISTS "Public full access printer_settings" ON public.printer_settings;
CREATE POLICY "Admins can manage printer settings" ON public.printer_settings FOR ALL TO authenticated USING (public.has_role(ARRAY['owner', 'manager', 'admin'])) WITH CHECK (public.has_role(ARRAY['owner', 'manager', 'admin']));

DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;
CREATE POLICY "Admins can manage coupons" ON public.coupons FOR ALL TO authenticated USING (public.has_role(ARRAY['owner', 'manager', 'admin'])) WITH CHECK (public.has_role(ARRAY['owner', 'manager', 'admin']));

DROP POLICY IF EXISTS "Admins can manage combos" ON public.combos;
CREATE POLICY "Admins can manage combos" ON public.combos FOR ALL TO authenticated USING (public.has_role(ARRAY['owner', 'manager', 'admin'])) WITH CHECK (public.has_role(ARRAY['owner', 'manager', 'admin']));

DROP POLICY IF EXISTS "Admins can manage delivery areas" ON public.delivery_areas;
CREATE POLICY "Admins can manage delivery areas" ON public.delivery_areas FOR ALL TO authenticated USING (public.has_role(ARRAY['owner', 'manager', 'admin'])) WITH CHECK (public.has_role(ARRAY['owner', 'manager', 'admin']));

DROP POLICY IF EXISTS "Public full access phone_verifications" ON public.phone_verifications;
CREATE POLICY "Admins can view phone verifications" ON public.phone_verifications FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Public full access security_audit_logs" ON public.security_audit_logs;
CREATE POLICY "Admins can view security logs" ON public.security_audit_logs FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Public full access verified_payments" ON public.verified_payments;
CREATE POLICY "Admins can view verified payments" ON public.verified_payments FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Public full access payment_history" ON public.payment_history;
CREATE POLICY "Admins can manage payment history" ON public.payment_history FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Users can read own payment history" ON public.payment_history FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.orders o
  WHERE o.id = payment_history.order_id
    AND (o.user_id = auth.uid() OR regexp_replace(o.customer_phone, '\D', '', 'g') = (SELECT regexp_replace(phone, '\D', '', 'g') FROM public.customer_profiles WHERE id = auth.uid()))
));

-- Inventory & Stock management policies
DROP POLICY IF EXISTS "Public full access stock_items" ON public.stock_items;
CREATE POLICY "Admins can manage stock items" ON public.stock_items FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Public full access stock_in" ON public.stock_in;
DROP POLICY IF EXISTS "Public full access stock_in_entries" ON public.stock_in_entries;
CREATE POLICY "Admins can manage stock in" ON public.stock_in FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins can manage stock in entries" ON public.stock_in_entries FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Public full access stock_out" ON public.stock_out;
DROP POLICY IF EXISTS "Public full access stock_out_entries" ON public.stock_out_entries;
CREATE POLICY "Admins can manage stock out" ON public.stock_out FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins can manage stock out entries" ON public.stock_out_entries FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Public full access stock_logs" ON public.stock_logs;
CREATE POLICY "Admins can manage stock logs" ON public.stock_logs FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Customer active orders & bookings access
DROP POLICY IF EXISTS "Public full access orders" ON public.orders;
DROP POLICY IF EXISTS "Public can view orders" ON public.orders;
DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
CREATE POLICY "Users can view own orders" ON public.orders FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins can manage orders" ON public.orders;
CREATE POLICY "Admins can manage orders" ON public.orders FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Public full access order_items" ON public.order_items;
DROP POLICY IF EXISTS "Public can view order items" ON public.order_items;
DROP POLICY IF EXISTS "Users can view own order items" ON public.order_items;
CREATE POLICY "Users can view own order items" ON public.order_items FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.user_id = auth.uid()
));
DROP POLICY IF EXISTS "Admins can manage order items" ON public.order_items;
CREATE POLICY "Admins can manage order items" ON public.order_items FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Public full access bookings" ON public.bookings;
CREATE POLICY "Admins can manage bookings" ON public.bookings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Users can read own bookings" ON public.bookings FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Public full access notifications" ON public.notifications;
CREATE POLICY "Admins can manage notifications" ON public.notifications FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Users can read own notifications" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Public full access customer_profiles" ON public.customer_profiles;
CREATE POLICY "Admins can manage customer profiles" ON public.customer_profiles FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Users can view own profile" ON public.customer_profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Users can insert own profile" ON public.customer_profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.customer_profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

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
