# 🍽️ LIMRA Restaurant — Enterprise Food Service & E-Commerce Platform

[![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen.svg)]()
[![Database](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E.svg)]()
[![Hardware](https://img.shields.io/badge/Hardware-ESC%2FPOS%20Thermal%20(80mm%2F58mm)-orange.svg)]()
[![Security](https://img.shields.io/badge/Security-Strict%20Auth%20%2B%20RLS%20(22%20Tables)-blue.svg)]()
[![Frontend](https://img.shields.io/badge/Frontend-Vite%208%20%2B%20Tailwind-646CFF.svg)]()

> **Owner / Operator:** SK Arif | LIMRA Restaurant, Egra, Purba Medinipur, West Bengal, India  
> **Backend BaaS:** Supabase PostgreSQL (`https://ynrtlcasbndkrqeotgzt.supabase.co`)  
> **Architecture:** Vite Multi-Page Architecture (MPA) + Node.js / Vercel Serverless API + Supabase Realtime & PostgREST

---

## 📖 Executive Summary

**LIMRA Restaurant** is a production-grade, full-stack digital operating system engineered specifically for high-volume modern restaurant environments. It unifies customer online food delivery, QR table-side dining, kitchen order ticketing (KOT), hardware-level thermal printing, inventory recipe deduction, and real-time administrative analytics into a resilient, high-speed monorepo.

---

## 🗺️ Portal Sitemap & Routes

| Portal | Source Path | Target URL | Primary Function |
| :--- | :--- | :--- | :--- |
| **Customer Storefront** | `frontend/index.html` | `/index.html` | Public ordering, 202-dish menu, coupon engine, dynamic delivery fees, and order tracking |
| **Dine-In Table Ordering** | `frontend/table/index.html` | `/table/index.html?t=1` | Contactless table-side QR ordering, round accumulation, item drawer, and cross-sell pairings |
| **Table QR Generator** | `frontend/table/qr-admin.html` | `/table/qr-admin.html` | Staff utility for batch-generating print-ready QR codes for Tables 1–19 |
| **Admin Operations & POS** | `frontend/admin.html` | `/admin.html` | Real-time kitchen display, POS billing, KOT management, thermal printing, and sales reports |
| **Admin Login Gate** | `frontend/admin-login.html` | `/admin-login.html` | Strict role-verified admin authentication (Email/Password & Google OAuth) |
| **Stock & Supply Chain** | `frontend/stock-manager/index.html` | `/stock-manager/index.html` | Raw material warehouse, stock in/out audits, monthly balance computation, and alerts |
| **Privacy Policy** | `frontend/privacy.html` | `/privacy.html` | Customer privacy rights, data retention policies, and restaurant compliance |

---

## ⚡ Key Architectural Capabilities

### 🛒 1. Customer Delivery & Takeaway Portal
- **202-Dish Multi-Category Menu:** Biryani, Tandoor & Kababs, Chinese (Veg & Non-Veg), Fried Rice, Gravies, Soups, Breads, Desserts, Mocktails, and Platter Combos.
- **Dynamic Places & Charges Engine:** Real-time distance and location-based delivery charge calculation with minimum order enforcement.
- **Smart Discount & Coupon System:** Supports percentage discounts, flat bill deductions, maximum discount caps, minimum order rules, and per-user redemption tracking (`coupons` and `coupon_usage` tables).
- **Flexible Checkout:** UPI QR Pay with UTR verification, Cash on Delivery (COD), Card on Delivery, and Razorpay payment gateway integration.
- **Real-Time Order Tracking:** WebSocket subscription to order state changes via Supabase Realtime with fallback 10-second polling.
- **Multilingual Support:** Instant switching between English, Bengali (বাংলা), and Hindi (हिंदी).

### 🍽️ 2. Dine-In Table QR Ordering System
- **Table Token Tracking:** Tables 1 through 19 identified via query parameter (e.g. `?t=5`).
- **Multi-Round Ticket Accumulation:** Customers can place supplementary rounds (`place_table_round` RPC); additional items append to the primary open table session without closing the bill.
- **Interactive Product Detail Drawer:** Modal drawer showing ingredient breakdowns, combo pack contents, high-resolution imagery, and dynamic cross-sell recommendations.
- **Custom Dish Support:** Dynamic resolution of kitchen daily specials (`activeCustomDishes`) directly in drawer views and cart management.
- **Google Review Prompt:** Satisfied diners are prompted with a direct review link upon final bill settlement.

### 🖨️ 3. Thermal Printing & KOT Studio
- **Dual ESC/POS Engine:** Native ESC/POS command generation in [`frontend/src/lib/escpos.js`](./frontend/src/lib/escpos.js) supporting both **80mm (48-column)** and **58mm (32-column)** paper rolls.
- **Hardware Integration:** Compatible with TVS RP3200 Plus, Epson, Posiflex, and standard USB/Network thermal printers via QZ Tray and silent browser printing.
- **PrintQueueManager:** Resilient client-side print queue ([`frontend/src/lib/print-queue.js`](./frontend/src/lib/print-queue.js)) with automatic retry, error logging, and offline persistence.
- **Customizable KOT & Bill Layouts:** Real-time preview studio in Admin with toggles for GSTIN, FSSAI number, UPI Payment QR codes, Google Review QR, and cash drawer kick signals.

### 🏢 4. Admin Control Center & Kitchen POS
- **Live Kitchen Order Stream:** Incoming orders categorized into `Pending`, `Confirmed`, `Preparing`, `Ready`, `Delivered`, `Hold`, and `Cancelled` with sound alerts.
- **Table Session Settlement:** Consolidate multiple KOT rounds into a single master tax invoice with CGST and SGST breakdowns.
- **POS Express Billing:** Manual counter ordering with item search, instant discount override, tax computation, and immediate receipt printing.
- **Automated Google Sheets Sync:** Auto-syncs closed/delivered orders to Google Sheets spreadsheets in the background.
- **Sales Analytics:** Chart.js revenue dashboards, hourly ordering heatmaps, top-selling dish reports, and export to CSV/Excel.

### 📦 5. Warehouse & Stock Management
- **7 Inventory Categories:** Spices & Bhusimal, Dairy Products, Soft Drinks & Beverages, Fresh Vegetables, Ice Cream, Packaging Materials, and Cleaning Supplies.
- **Idempotent Recipe Deduction:** Automated stock deduction on order fulfillment with deduplication checks against `stock_logs` to eliminate duplicate inventory deductions.
- **Dynamic Auditing & Summaries:** Real-time computation of opening balances, stock in, stock out, and current stock levels without hardcoded date constraints.
- **Text-Compatible Database RPCs:** Stored procedures (`record_stock_out`, `record_stock_in`, `get_stock_daily_summary`) supporting both alphanumeric SKU identifiers (`stk_61`) and UUIDs.

---

## 🛡️ Security & Reliability Architecture

1. **Strict Admin Authentication Gate:**
   - Universal removal of loose email checks (`.includes('admin')`). Staff access strictly requires verified equality against authorized administrator records or active `admin_users` table entries.
2. **Universal Empty Filter Guards:**
   - `/api/db.js` and `/backend/api/db.js` validate all `update` and `delete` requests; queries missing a filter return HTTP 400 to prevent accidental table wipes.
   - Fixed dispatcher routing to guarantee `action` property precedence over HTTP verbs.
3. **Self-Healing Schema Fallbacks:**
   - Backend order creation and admin billing automatically detect missing schema columns (`ticket_status`, printer flags) and retry gracefully without interrupting operations.
4. **Row-Level Security (RLS) on 22 Tables:**
   - Complete RLS enforcement with zero open `USING (true)` policies. Public clients have restricted read/insert rights; administrative actions require `is_admin()` authentication.
5. **Secure Stored Procedures:**
   - All `SECURITY DEFINER` functions run with immutable `SET search_path = ''` to prevent search path hijacking.

---

## 🗄️ Database Architecture (Supabase PostgreSQL)

```
                            ┌────────────────────────────────────────┐
                            │               admin_users              │
                            └───────────────────┬────────────────────┘
                                                │ authenticates
                                                ▼
┌──────────────────┐        ┌────────────────────────────────────────┐        ┌──────────────────┐
│  delivery_areas  │        │                 orders                 │        │   stock_items    │
├──────────────────┤        ├────────────────────────────────────────┤        ├──────────────────┤
│ - area_name      │        │ - id (uuid)                            │        │ - id (text)      │
│ - delivery_fee   │        │ - order_number (int)                   │        │ - name (text)    │
│ - min_order      │        │ - order_type (delivery/takeaway/table) │        │ - qty (numeric)  │
└──────────────────┘        │ - status & ticket_status               │        │ - min_qty        │
                            │ - total_amount                         │        └────────┬─────────┘
┌──────────────────┐        │ - table_number                         │                 │
│     coupons      │        └───────────────────┬────────────────────┘                 │ tracks
├──────────────────┤                            │                                      ▼
│ - code           │                            │ contains                    ┌──────────────────┐
│ - discount_pct   │                            ▼                             │ stock_in / out   │
│ - min_bill       │        ┌────────────────────────────────────────┐        │ stock_logs       │
└──────────────────┘        │              order_items               │        └──────────────────┘
                            ├────────────────────────────────────────┤
                            │ - item_name, quantity, unit_price      │
                            └────────────────────────────────────────┘
```

### Relational Tables Overview

| Domain | Table Name | Purpose | Access Control |
| :--- | :--- | :--- | :--- |
| **Sales** | `orders` | Central order transactions across all channels | Public Read (by token) / Admin Full |
| | `order_items` | Individual dish lines with prices and kitchen notes | Public Read / Admin Full |
| **Catalog** | `delivery_areas` | Delivery zones, fees, and minimum cart amounts | Public Read / Admin Manage |
| | `menu_overrides` | Custom dishes, live pricing overrides, and availability | Public Read / Admin Manage |
| | `combos` | Multi-item platter packages | Public Read / Admin Manage |
| | `coupons` | Promotional vouchers and discount logic | Public Read / Admin Manage |
| | `coupon_usage` | Per-customer coupon redemption logs | Public Insert / Admin Manage |
| | `reviews` | Customer ratings and feedback | Public Read & Insert / Admin Manage |
| **Reservations** | `bookings` | Table, party, and wedding catering reservations | User Read Own / Admin Manage |
| **Inventory** | `stock_items` | Raw ingredients and godown balances | Admin Only |
| | `stock_in` | Goods receipt notes (GRN) and vendor purchases | Admin Only |
| | `stock_in_entries` | Detailed restock item lines | Admin Only |
| | `stock_out` | Kitchen consumption and wastage records | Admin Only |
| | `stock_out_entries`| Detailed consumption item lines | Admin Only |
| | `stock_logs` | Audit trail of inventory updates | Admin Only |
| **Infrastructure**| `admin_users` | Authorized management personnel | Authenticated Admins Only |
| | `printer_settings` | Thermal printer layouts, review QR, and margins | Admin Only |
| | `phone_verifications`| OTP verification records with brute-force rate limits | System / Admin Only |
| | `security_audit_logs`| Authentication and sensitive event logs | Admin Only |
| | `verified_payments` | Validated UPI UTR transactions | Admin Only |
| | `payment_history` | State change log for payment receipts | User Read Own / Admin Manage |
| | `notifications` | Staff kitchen alerts and customer notices | User Read Own / Admin Manage |

---

## 📂 Monorepo Organization

```
E-COMMERSE LIMRA website/
├── api/                               # Vercel Serverless API Handlers
│   ├── lib/
│   │   └── supabase.js                # Supabase Server Client
│   ├── analytics.js                   # Sales metrics & business intelligence API
│   ├── create-order.js                # Payment gateway order initiation
│   ├── db-status.js                   # Database health check endpoint
│   ├── db.js                          # Universal CRUD & RPC dispatcher
│   ├── menu.js                        # Menu overrides API
│   ├── orders.js                      # Order state management & inventory deduction
│   └── verify-payment.js              # Payment signature verification
│
├── backend/                           # Local Express Node.js Server
│   ├── api/                           # Mirrored API routes (synchronized with /api)
│   ├── server.js                      # Local development server entrypoint
│   └── package.json                   # Backend package dependencies
│
├── frontend/                          # Vite 8 Multi-Page Frontend
│   ├── public/                        # Static assets, logos, and sounds
│   ├── src/
│   │   ├── data/
│   │   │   └── menu.js                # Master catalog of 202 dishes
│   │   ├── lib/
│   │   │   ├── admin-routes.js        # Protected route redirects
│   │   │   ├── email-service.js       # Customer confirmation emails
│   │   │   ├── escpos.js              # ESC/POS 80mm & 58mm raw thermal byte builder
│   │   │   ├── i18n.js                # Multi-language translation engine
│   │   │   ├── notifications.js       # In-app push notifications
│   │   │   ├── payments.js            # UPI QR and payment integrations
│   │   │   ├── print-queue.js         # Thermal print queue with offline retry
│   │   │   └── supabase.js            # Frontend Supabase client & RPC bindings
│   │   ├── stock-manager/             # Stock manager logic & CSS
│   │   ├── table/                     # Table QR ordering & cart logic
│   │   ├── admin-login.js             # Admin authentication logic
│   │   ├── admin.js                   # Kitchen POS and admin management
│   │   ├── main.js                    # Customer storefront application
│   │   └── style.css                  # Tailwind styles and custom design system
│   ├── admin-login.html               # Staff login interface
│   ├── admin.html                     # Admin & POS dashboard
│   ├── index.html                     # Customer storefront interface
│   ├── privacy.html                   # Privacy policy
│   ├── table/                         # Dine-in table portal & QR admin
│   └── vite.config.js                 # Multi-page build configuration
│
├── migrations/                        # Versioned PostgreSQL database migrations
│   ├── 20260529184324_create-orders-bookings.sql
│   ├── 20260618000000_harden_backend_security.sql
│   ├── 20260822000000_place_table_round_rpc.sql
│   ├── 20260912000000_phase1_security_linter_fixes.sql
│   ├── 20260912010000_phase2_admin_catalog_rls_hardening.sql
│   ├── 20260912020000_phase3_orders_bookings_rls_hardening.sql
│   ├── 20260916210000_add_ticket_status_lifecycle.sql
│   ├── 20260916220000_stock_rpcs_and_enforcement.sql
│   └── 20260917020000_printer_settings_review_qr_and_direct_print.sql
│
├── scripts/                           # Engineering & automation scripts
│   ├── generate-menu.mjs              # Menu code generation utility
│   ├── generate-table-qr.mjs          # Table QR image batch generation
│   ├── run-dev.mjs                    # Concurrent dev launcher
│   └── test-phase3-printing.mjs       # ESC/POS & print queue test suite
│
├── supabase_schema.sql                # Master PostgreSQL schema definition
├── package.json                       # Monorepo root scripts & dependencies
└── README.md                          # Platform documentation
```

---

## 🛠️ Quickstart & Development

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm**: v9.0.0 or higher
- A provisioned **Supabase** project

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/arfat87/E-COMMERSE-LIMRA-website.git
cd "E-COMMERSE LIMRA website"

# Install all monorepo dependencies
npm install
```

### 3. Environment Setup
Create a `.env` file in the project root:
```env
# Supabase Configuration
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

# Local Server
PORT=3000

# Payment Gateways (Optional)
VITE_RAZORPAY_KEY_ID=<your-razorpay-key-id>
RAZORPAY_KEY_SECRET=<your-razorpay-key-secret>
```

### 4. Running the Development Servers
```bash
# Start both Frontend (Vite) and Backend (Node.js) concurrently
npm run dev

# Or start frontend only (http://localhost:5173)
npm run dev:frontend

# Or start backend API server only (http://localhost:3000)
npm run dev:backend
```

### 5. Production Compilation
```bash
# Compiles frontend assets into dist/
npm run build
```

---

## ⚡ Supabase Setup & SQL Deployment

To apply the latest database schema and stored procedures, execute the following script in the **[Supabase SQL Editor](https://supabase.com/dashboard/project/ynrtlcasbndkrqeotgzt/sql)**:

```sql
-- 1. Orders table ticket_status lifecycle column
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS ticket_status text DEFAULT 'OPEN';

CREATE INDEX IF NOT EXISTS idx_orders_ticket_status 
ON public.orders (ticket_status);

-- 2. Printer Settings configuration extensions
ALTER TABLE public.printer_settings 
ADD COLUMN IF NOT EXISTS bill_show_review_qr boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS direct_print_enabled boolean DEFAULT false;

-- 3. Stock Out RPC with text item_id support
CREATE OR REPLACE FUNCTION public.record_stock_out(
  p_item_id text,
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
  v_out_id text := 'out_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 4);
  v_log_id text := 'log_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 4);
  v_is_override boolean := false;
  v_details text;
BEGIN
  IF p_item_id IS NULL THEN RAISE EXCEPTION 'Item ID is required'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Stock out quantity must be greater than 0'; END IF;

  SELECT * INTO v_item FROM public.stock_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock item not found'; END IF;

  IF (COALESCE(v_item.qty, 0) - p_qty) < 0 THEN
    IF NOT p_allow_negative THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: Available balance is % %, cannot deduct % % without override.',
        COALESCE(v_item.qty, 0), COALESCE(v_item.unit, 'pcs'), p_qty, COALESCE(v_item.unit, 'pcs');
    ELSE
      v_is_override := true;
    END IF;
  END IF;

  v_new_qty := COALESCE(v_item.qty, 0) - p_qty;

  UPDATE public.stock_items SET qty = v_new_qty, updated_at = now() WHERE id = p_item_id;

  INSERT INTO public.stock_out (id, item_id, item_sku, item_name, unit, qty, date, used_by, notes, created_at)
  VALUES (v_out_id, v_item.id, COALESCE(v_item.sku, ''), v_item.name, COALESCE(v_item.unit, 'pcs'), p_qty, to_char(now(), 'YYYY-MM-DD'), COALESCE(p_used_by, 'Kitchen Staff'), p_notes, now());

  v_details := 'Deducted ' || p_qty || ' ' || COALESCE(v_item.unit, 'pcs') || ' of ' || v_item.name || ' (Reason: ' || COALESCE(p_reason, 'Kitchen Prep') || ', Balance: ' || v_new_qty || ')';
  IF v_is_override THEN v_details := '[OVERRIDE: Negative Stock Allowed] ' || v_details; END IF;

  INSERT INTO public.stock_logs (id, action, details, created_at)
  VALUES (v_log_id, CASE WHEN v_is_override THEN 'STOCK_OUT_OVERRIDE' ELSE 'STOCK_OUT' END, v_details, now());

  RETURN jsonb_build_object('success', true, 'item_id', v_item.id, 'item_name', v_item.name, 'previous_qty', v_item.qty, 'deducted_qty', p_qty, 'new_qty', v_new_qty, 'unit', v_item.unit, 'is_override', v_is_override);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_stock_out(text, numeric, text, text, text, boolean) TO anon, authenticated;
```

---

## 🧪 Automated Verification Suite

Run our automated verification scripts to validate security, inventory, and hardware formatting:

```bash
# 1. Test Thermal ESC/POS formatting & print queue retry resilience
node scripts/test-phase3-printing.mjs

# 2. Compile frontend assets with Vite
npm run build
```

---

## 📞 Support & Contacts

| Contact Information | Details |
| :--- | :--- |
| **Establishment** | LIMRA Restaurant |
| **Proprietor** | SK Arif |
| **Location** | Main Road, Near Bus Stand, Egra, Purba Medinipur, West Bengal — 721429 |
| **Telephone** | +91 7501299357 |
| **Official Email** | arfatalis451@gmail.com |

---

## 📝 Proprietary License

This codebase and associated digital assets are **proprietary software** created for and owned by **SK Arif (LIMRA Restaurant)**.  
All rights reserved. Reproduction, reverse engineering, unauthorized deployment, or redistribution without express written consent is strictly prohibited.
