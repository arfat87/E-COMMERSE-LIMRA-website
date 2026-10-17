-- ═══════════════════════════════════════════════════════════════════════════════
-- LIMRA RESTAURANT — SUPABASE EGRESS & PERFORMANCE OPTIMIZATION
-- Migration: 20261017050000_egress_and_performance_optimization.sql
-- Description: Composite and covering indexes to eliminate sequential scans,
--              optimize delta sync polling, accelerate sales reporting,
--              and reduce query latency and database egress.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ORDERS TABLE OPTIMIZATIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1 Fast delta-sync index for polling (updated_at.gte, created_at.gte)
CREATE INDEX IF NOT EXISTS idx_orders_updated_at 
  ON public.orders (updated_at DESC);

-- 1.2 Composite index for sales reporting and active order filtering
-- Accelerates queries filtering out cancelled orders and sorting by date
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at 
  ON public.orders (status, created_at DESC);

-- 1.3 Composite index for channel/order_type queries (table, delivery, pickup)
CREATE INDEX IF NOT EXISTS idx_orders_type_created_at 
  ON public.orders (order_type, created_at DESC);

-- 1.4 Covering index for table session management (dine-in active tickets)
CREATE INDEX IF NOT EXISTS idx_orders_table_active 
  ON public.orders (table_number, ticket_status) 
  WHERE table_number IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ORDER ITEMS OPTIMIZATIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1 Fast order items batch retrieval by order_id with chronological ordering
CREATE INDEX IF NOT EXISTS idx_order_items_order_created 
  ON public.order_items (order_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BOOKINGS TABLE OPTIMIZATIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 Delta-sync index for incremental polling
CREATE INDEX IF NOT EXISTS idx_bookings_updated_at 
  ON public.bookings (updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. INVENTORY / STOCK TABLES OPTIMIZATIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- 4.1 stock_in indexes for chronological FIFO ledger queries and SKU lookups
CREATE INDEX IF NOT EXISTS idx_stock_in_created_at 
  ON public.stock_in (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_in_sku 
  ON public.stock_in (item_sku);

-- 4.2 stock_out indexes for chronological consumption ledger queries and SKU lookups
CREATE INDEX IF NOT EXISTS idx_stock_out_created_at 
  ON public.stock_out (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_out_sku 
  ON public.stock_out (item_sku);

-- 4.3 stock_items SKU lookup
CREATE INDEX IF NOT EXISTS idx_stock_items_sku 
  ON public.stock_items (sku);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. REFERENCE & CONFIGURATION TABLES OPTIMIZATIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- 5.1 Coupons code index for instant validation and active lookup
CREATE INDEX IF NOT EXISTS idx_coupons_code 
  ON public.coupons (code);

CREATE INDEX IF NOT EXISTS idx_coupons_active 
  ON public.coupons (active, is_auto_send);

-- 5.2 Delivery areas alphabetized index
CREATE INDEX IF NOT EXISTS idx_delivery_areas_name 
  ON public.delivery_areas (name);
