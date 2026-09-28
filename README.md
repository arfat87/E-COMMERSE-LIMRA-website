# 🍽️ LIMRA Restaurant — Enterprise Food Service, POS & E-Commerce Platform

[![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/Platforms-Web%20%7C%20Electron%20Desktop%20%7C%20Android%20APK-indigo.svg)]()
[![Database](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E.svg)]()
[![Hardware](https://img.shields.io/badge/Hardware-ESC%2FPOS%20Thermal%20(80mm%2F58mm)-orange.svg)]()
[![Security](https://img.shields.io/badge/Security-Strict%20Auth%20%2B%20RLS%20(22%20Tables)-blue.svg)]()
[![Frontend](https://img.shields.io/badge/Frontend-Vite%208%20%2B%20Tailwind-646CFF.svg)]()

> **Owner / Operator:** SK Arif | LIMRA Restaurant, Egra, Purba Medinipur, West Bengal, India  
> **Backend BaaS:** Supabase PostgreSQL (`https://ynrtlcasbndkrqeotgzt.supabase.co`)  
> **Architecture:** Multi-Platform Monorepo (Vite 8 MPA + Electron 44 Desktop + Capacitor Android + Node.js / Vercel Serverless API)

---

## 📖 Executive Summary

**LIMRA Restaurant** is a production-grade, enterprise digital operating ecosystem engineered specifically for high-volume modern food service operations. It unifies:
1. **Customer Online Storefront:** 202-dish categorized menu, dynamic Leaflet delivery zones, coupon discount engine, live status tracking, and multi-language support (EN, BN, HI, OD).
2. **Dine-In Table QR Ordering:** Table-side QR tokens (Tables 1–19), multi-round KOT accumulation, dynamic cross-selling recommendations, and custom dish resolution.
3. **Admin Kitchen Operations & POS:** Real-time incoming order stream with audio alerts, in-page POS billing, KOT & receipt management, order holding/settlement, and automated Google Sheets sync.
4. **Embedded Warehouse & Stock Accounting:** Godown management across 7 material categories, purchase rate variance tracking, 1-click stock in/out, and financial statements.
5. **Hardware Thermal Printing Engine:** Dual ESC/POS 80mm & 58mm byte-level formatters, TVS RP3200 Plus / QZ Tray silent printing, and an offline-resilient print queue.
6. **Hardened Security & Logging:** Strict administrator verification, universal empty filter guards, 22-table Row-Level Security (RLS), and comprehensive multi-tier log ingestion.

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

## 🏗️ System Architecture

```
                                 ┌───────────────────────────────────┐
                                 │       Vercel / Cloud Gateway      │
                                 │        (HTTPS & CDN Edge)         │
                                 └─────────────────┬─────────────────┘
                                                   │
                         ┌─────────────────────────┴─────────────────────────┐
                         ▼                                                   ▼
       ┌───────────────────────────────────┐               ┌───────────────────────────────────┐
       │         Customer Clients          │               │        Admin & Staff POS          │
       │  • Online Delivery Storefront     │               │  • Admin Dashboard & KOT Monitor  │
       │  • Contactless Table QR Ordering  │               │  • Thermal Bill & KOT Printing    │
       │  • Multi-language Engine (i18n)   │               │  • In-Page Stock & Accounting     │
       └─────────────────┬─────────────────┘               └─────────────────┬─────────────────┘
                         │                                                   │
                         │                   API REST Calls                  │
                         └─────────────────────────┬─────────────────────────┘
                                                   ▼
                                 ┌───────────────────────────────────┐
                                 │     Backend API Layer (Node.js)   │
                                 │   • Local Dev Server (server.js)  │
                                 │   • Vercel Edge Serverless (/api) │
                                 │   • Orders, Analytics, Payments   │
                                 └─────────────────┬─────────────────┘
                                                   │
                         ┌─────────────────────────┴─────────────────────────┐
                         ▼                                                   ▼
       ┌───────────────────────────────────┐               ┌───────────────────────────────────┐
       │     Supabase PostgreSQL Cloud     │               │     Google Apps Script Web App    │
       │   • Orders, Items & Bookings      │               │   • google-apps-script/Code.gs    │
       │   • Stock Items, In/Out & Logs    │               │   • Live Spreadsheet Bookkeeping  │
       │   • Row-Level Security (RLS)      │               │   • Deduplicated Auditing         │
       └───────────────────────────────────┘               └───────────────────────────────────┘
```

---

## ⚡ Core Functional Modules

### 1. 🛒 Customer Delivery & Takeaway Portal
- **202-Dish Multi-Category Menu:** Biryani, Tandoor & Kababs, Chinese (Veg & Non-Veg), Fried Rice, Gravies, Soups, Breads, Desserts, Mocktails, and Platter Combos.
- **Dynamic Places & Charges Engine:** Real-time distance and location-based delivery charge calculation with minimum order enforcement.
- **Smart Discount & Coupon System:** Supports percentage discounts, flat bill deductions, maximum discount caps, minimum order rules, and per-user redemption tracking (`coupons` and `coupon_usage` tables).
- **Flexible Checkout:** UPI QR Pay with UTR verification, Cash on Delivery (COD), Card on Delivery, and Razorpay payment gateway integration.
- **Real-Time Order Tracking:** WebSocket subscription to order state changes via Supabase Realtime with fallback 10-second polling.
- **Multilingual Support:** Instant switching between English, Bengali (বাংলা), Hindi (हिंदी), and Odia (ଓଡ଼ିଆ).

### 2. 🍽️ Dine-In Table QR Ordering System
- **Table Token Tracking:** Tables 1 through 19 identified via query parameter (e.g. `?t=5`).
- **Multi-Round Ticket Accumulation:** Customers can place supplementary rounds (`place_table_round` RPC); additional items append to the primary open table session without closing the bill.
- **Interactive Product Detail Drawer:** Modal drawer showing ingredient breakdowns, combo pack contents, high-resolution imagery, and dynamic cross-sell recommendations.
- **Custom Dish Support:** Dynamic resolution of kitchen daily specials (`activeCustomDishes`) directly in drawer views and cart management.
- **Google Review Prompt:** Satisfied diners are prompted with a direct review link upon final bill settlement.

### 3. 🖨️ Thermal Printing & KOT Studio
- **Dual ESC/POS Engine:** Native ESC/POS command generation in [`frontend/src/lib/escpos.js`](./frontend/src/lib/escpos.js) supporting both **80mm (48-column)** and **58mm (32-column)** paper rolls.
- **Hardware Integration:** Compatible with TVS RP3200 Plus, Epson, Posiflex, and standard USB/Network thermal printers via QZ Tray and silent browser printing.
- **PrintQueueManager:** Resilient client-side print queue ([`frontend/src/lib/print-queue.js`](./frontend/src/lib/print-queue.js)) with automatic retry, error logging, and offline persistence.
- **Customizable KOT & Bill Layouts:** Real-time preview studio in Admin with toggles for GSTIN, FSSAI number, UPI Payment QR codes, Google Review QR, and cash drawer kick signals.

### 4. 🏢 Admin Control Center & Kitchen POS
- **Live Kitchen Order Stream:** Incoming orders categorized into `Pending`, `Confirmed`, `Preparing`, `Ready`, `Delivered`, `Hold`, and `Cancelled` with sound alerts.
- **Table Session Settlement:** Consolidate multiple KOT rounds into a single master tax invoice with CGST and SGST breakdowns.
- **POS Express Billing:** Manual counter ordering with item search, instant discount override, tax computation, and immediate receipt printing.
- **Automated Google Sheets Sync:** Auto-syncs closed/delivered orders to Google Sheets spreadsheets in the background.
- **Sales Analytics:** Chart.js revenue dashboards, hourly ordering heatmaps, top-selling dish reports, and export to CSV/Excel.

### 5. 📦 Embedded Warehouse & Stock Management
- **7 Inventory Categories:** Spices & Bhusimal, Dairy Products, Soft Drinks & Beverages, Fresh Vegetables, Ice Cream, Packaging Materials, and Cleaning Supplies.
- **In-Page Seamless Navigation:** Integrated directly into `admin.html` under a clean Warm Parchment & Contemporary Indigo theme with zero redirects.
- **Purchase Rate Variance Engine:** Automatically compares incoming supplier invoice rates against master rates, showing instant variance badges and financial impact.
- **Idempotent Recipe Deduction:** Automated stock deduction on order fulfillment with deduplication checks against `stock_logs` to eliminate duplicate inventory deductions.
- **Dynamic Auditing & Summaries:** Real-time computation of opening balances, stock in, stock out, and current stock levels without hardcoded date constraints.
- **Text-Compatible Database RPCs:** Stored procedures (`record_stock_out`, `record_stock_in`, `get_stock_daily_summary`) supporting both alphanumeric SKU identifiers (`stk_61`) and UUIDs.

---

## 📊 Logging & Ingestion Architecture

Log ingestion in the LIMRA ecosystem is divided into specialized, decoupled channels to ensure performance, compliance, and auditing:

| Ingestion Channel | Target Destination | Purpose & Trigger |
| :--- | :--- | :--- |
| **Inventory Audit Logs** | PostgreSQL `stock_logs` table | Ingests recipe deductions (`ORDER_DEDUCT`), restocks (`STOCK_IN`), and kitchen usage (`STOCK_OUT`) with timestamps and quantity balances. Ensures idempotency against duplicate order deductions. |
| **Security & Auth Audit Logs** | PostgreSQL `security_audit_logs` table | Ingests admin login attempts, credential verifications, OTP rate-limit events, and sensitive operations via `public.log_security_event()`. |
| **Payment History Logs** | PostgreSQL `payment_history` & `verified_payments` | Ingests UPI UTR validation records, payment gateway status transitions, IP addresses, and failure diagnostic metadata. |
| **External Accounting Log Stream** | Google Apps Script $\rightarrow$ Google Sheets | Asynchronously streams delivered/billed orders as append-only spreadsheet rows for external bookkeeping and reconciliation. |
| **Hardware & Print Queue Telemetry** | LocalStorage (`print-queue-history`) & Console | Captures thermal printer timeouts, paper-out errors, port disconnections, and retry metrics for hardware diagnosis. |
| **Supabase & Vercel Log Ingestion** | Supabase PostgREST & Vercel Runtime Logs | Serverless execution traces and database query metrics. Realtime listeners and adaptive polling cut redundant polling egress by >80%. |

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

## 🗄️ Relational Database Schema (Supabase PostgreSQL)

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
├── api/                               # Vercel Serverless Function Endpoints
│   ├── lib/                           # Database & Auth helpers (Supabase, InsForge)
│   ├── analytics.js                   # Sales reports and metrics API
│   ├── create-order.js                # Secure order intake endpoint
│   ├── db-status.js                   # Connectivity health-check
│   ├── db.js                          # Unified database CRUD gateway
│   ├── menu.js                        # Live catalog API
│   ├── orders.js                      # Order state transition handler
│   └── verify-payment.js              # Payment signature verification
│
├── backend/                           # Node.js Express / HTTP Local API Server
│   ├── api/                           # Mirror API controllers for local runtime
│   ├── .env                           # Backend environment variables
│   ├── package.json                   # Backend server dependencies
│   └── server.js                      # Local development proxy & API runner (:3000)
│
├── frontend/                          # Vite 8 Multi-Page Application
│   ├── public/                        # Static public assets (images, audio, icons)
│   ├── src/                           # Frontend application source
│   │   ├── data/menu.js               # Master catalog of 202 restaurant dishes
│   │   ├── lib/                       # Core utilities and hardware drivers
│   │   │   ├── admin-routes.js        # Internal route guard
│   │   │   ├── email-service.js       # Customer notification dispatcher
│   │   │   ├── escpos.js              # ESC/POS binary thermal print engine
│   │   │   ├── i18n.js                # Multilingual translation dictionary
│   │   │   ├── notifications.js       # Audio & visual alert manager
│   │   │   ├── payments.js            # UPI QR & payment integrations
│   │   │   ├── print-queue.js         # Thermal printer background spooler
│   │   │   └── supabase.js            # Supabase PostgreSQL client bindings
│   │   ├── stock-manager/             # Embedded & standalone inventory engine
│   │   ├── table/table.js             # Dine-In table QR ordering logic
│   │   ├── admin-login.js             # Staff authentication script
│   │   ├── admin-stock.js             # In-page admin stock mounting bridge
│   │   ├── admin.css                  # Admin dashboard stylesheet
│   │   ├── admin.js                   # Admin & POS terminal controller
│   │   ├── main.js                    # Storefront controller
│   │   └── style.css                  # Storefront stylesheet
│   ├── admin.html                     # Admin Panel, POS & Stock Management
│   ├── admin-login.html               # Staff login gate
│   ├── index.html                     # Customer online ordering storefront
│   ├── privacy.html                   # Privacy policy page
│   ├── package.json                   # Frontend build dependencies
│   ├── vite.config.js                 # Multi-page Vite configuration
│   ├── stock-manager/index.html       # Standalone warehouse audit view
│   └── table/                         # Dine-in table ordering portal
│       ├── index.html                 # Customer table ordering UI
│       └── qr-admin.html              # Printable Table QR generator
│
├── electron/                          # Desktop Application Process (Electron 44)
│   ├── main.cjs                       # Main process + loopback HTTP server
│   ├── preload.cjs                    # Desktop secure hardware bridge
│   ├── icon.ico                       # Windows multi-resolution icon
│   └── icon.png                       # High-res desktop app icon
│
├── android/                           # Native Capacitor Android Project
│   └── app/src/main/AndroidManifest.xml # Permissions (Bluetooth, USB, Cleartext)
│
├── google-apps-script/                # Google Sheets Synchronization Backend
│   └── Code.gs                        # Google Apps Script Web App receiver
│
├── migrations/                        # Chronological PostgreSQL Migrations History
│   ├── 20260529184324_create-orders-bookings.sql
│   ├── 20260612000000_add_table_orders.sql
│   ├── 20260618000000_harden_backend_security.sql
│   ├── 20260822000000_place_table_round_rpc.sql
│   ├── 20260912000000_phase1_security_linter_fixes.sql
│   ├── 20260912010000_phase2_admin_catalog_rls_hardening.sql
│   ├── 20260912020000_phase3_orders_bookings_rls_hardening.sql
│   ├── 20260916210000_add_ticket_status_lifecycle.sql
│   ├── 20260916220000_stock_rpcs_and_enforcement.sql
│   └── 20260917020000_printer_settings_review_qr_and_direct_print.sql
│
├── scripts/                           # Engineering & Automation Scripts
│   ├── generate-app-icons.py          # App icon generator
│   ├── generate-menu.mjs              # Menu seeder
│   ├── generate-table-qr.mjs          # Table QR generator utility
│   ├── migrate-to-supabase.mjs        # Database migrator
│   ├── run-dev.mjs                    # Concurrent dev runner (Frontend + Backend)
│   └── test-phase3-printing.mjs       # ESC/POS printer unit test
│
├── build/                             # Desktop packaging assets (icon.ico, icon.png)
├── capacitor.config.json              # Capacitor Android app settings
├── package.json                       # Monorepo root scripts & workspace configuration
├── supabase_schema.sql                # Complete master PostgreSQL schema
├── vercel.json                        # Vercel deployment routes and rewrites
└── README.md                          # Master documentation
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.x or v20.x recommended
- **npm**: v9.x or v10.x
- A provisioned **Supabase** project
- **Python 3** (Optional, only for generating new app icons)

### Installation
Clone the repository and install all workspace dependencies:
```bash
# Clone repository
git clone https://github.com/arfat87/E-COMMERSE-LIMRA-website.git
cd "E-COMMERSE LIMRA website"

# Install all monorepo dependencies (root, frontend, and backend)
npm install
```

### Environment Configuration
Ensure `.env` exists in the project root:
```env
# Supabase Database & Auth
VITE_SUPABASE_URL=https://ynrtlcasbndkrqeotgzt.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_URL=https://ynrtlcasbndkrqeotgzt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Payment Gateway (Optional)
VITE_RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

# Server Ports
PORT=3000
```

---

## 🛠️ Developer Commands

| Task | Command | Description |
| :--- | :--- | :--- |
| **Start Full Development Stack** | `npm run dev` | Runs both Frontend (`:5173`) and Backend (`:3000`) concurrently via `run-dev.mjs`. |
| **Frontend Dev Only** | `npm run dev:frontend` | Starts Vite dev server directly on `http://localhost:5173`. |
| **Backend Dev Only** | `npm run dev:backend` | Starts Node.js backend server directly on `http://localhost:3000`. |
| **Build Web Application** | `npm run build` | Builds optimized frontend bundles with Vite and synchronizes them to `dist/`. |
| **Run Desktop App (Electron)** | `npm run desktop:dev` | Compiles web assets and opens the native Electron desktop window. |
| **Package Desktop App (.exe)** | `npm run desktop:dist` | Packages Windows NSIS installer and portable `.exe` using `electron-builder`. |
| **Sync Android Project** | `npm run cap:sync` | Builds web assets and syncs changes into the `android/` Capacitor project. |
| **Open Android Studio** | `npm run cap:open` | Opens the native Android project in Android Studio. |
| **Run Android App** | `npm run cap:run` | Deploys and launches the app directly on an attached Android device or emulator. |
| **Test ESC/POS Printing** | `node scripts/test-phase3-printing.mjs` | Runs automated tests for 80mm/58mm formatters and print queue retry logic. |
| **Generate App Icons** | `python scripts/generate-app-icons.py` | Automatically regenerates `.ico`, `.png`, and Android mipmap launcher icons. |

---

## 🖨️ Hardware & Thermal Printer Setup

1. **Direct USB / Network Printer**:
   - Connect printer via USB or assign a static IP on the local Wi-Fi router.
   - Set paper width in Admin Settings (`80mm` or `58mm`).
   - Browser print dialog or raw ESC/POS commands will format receipts with restaurant branding, itemized order lines, taxes, and dynamic UPI QR codes.
2. **QZ Tray Integration**:
   - Install [QZ Tray](https://qz.io/download/) on the billing PC.
   - Enables background, 0-click silent printing to designated kitchen (KOT) and billing printers without displaying the browser print dialog.

---

## 📞 Support & Business Inquiries

| Property | Information |
| :--- | :--- |
| **Restaurant Name** | LIMRA Restaurant |
| **Proprietor** | SK Arif |
| **Address** | Main Road, Near Bus Stand, Egra, Purba Medinipur, West Bengal — 721429 |
| **Phone** | +91 7501299357 |
| **Email** | `arfatalis451@gmail.com` |

---

## 📜 License

This software, digital assets, database structures, and designs are **proprietary software** created for and owned exclusively by **SK Arif (LIMRA Restaurant)**.  
Unauthorized copying, modification, distribution, or commercial deployment without prior written permission is strictly prohibited.  
Copyright © 2026 LIMRA Restaurant. All rights reserved.
