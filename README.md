# 🍽️ LIMRA Restaurant — Enterprise Food Service, POS & E-Commerce Platform

[![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/Platforms-Web%20%7C%20Electron%20Desktop%20%7C%20Android%20APK-indigo.svg)]()
[![Tests](https://img.shields.io/badge/Tests-39%20Suites%20Passing-success.svg)]()
[![Database](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E.svg)]()
[![Hardware](<https://img.shields.io/badge/Hardware-TVS%20RP%203200%20Plus%20(80mm%2F58mm)-orange.svg>)]()
[![Security](<https://img.shields.io/badge/Security-Strict%20Auth%20%2B%20RLS%20(22%20Tables)-blue.svg>)]()
[![Frontend](https://img.shields.io/badge/Frontend-Vite%208%20%2B%20Tailwind-646CFF.svg)]()

> **Proprietor / Operator:** SK Arfat Ali | LIMRA Restaurant, Main Road, Near Bus Stand, Egra, Purba Medinipur, West Bengal — 721429  
> **Production Domain:** `https://www.limraresturent.in`  
> **Backend BaaS:** Supabase PostgreSQL (`https://ynrtlcasbndkrqeotgzt.supabase.co`)  
> **Architecture:** Multi-Platform Monorepo (Vite 8 Multi-Page App + Electron 44 Desktop + Capacitor Android + Node.js / Vercel Serverless API)

---

## 📖 Executive Summary

**LIMRA Restaurant** is a production-grade, enterprise digital operating ecosystem engineered specifically for high-volume modern food service operations. It unifies online customer delivery, contactless dine-in table ordering, express counter POS billing, KOT management, thermal printing, godown inventory accounting, and multi-platform distribution into a unified, offline-resilient architecture.

### Key Capabilities:
1. **Customer Online Storefront:** 202-dish categorized menu, dynamic Leaflet delivery zones, coupon discount engine, live status tracking, and multi-language support (EN, BN, HI, OD).
2. **Dine-In Table QR Ordering:** Table-side QR tokens (Tables 1–19), multi-round KOT accumulation (`place_table_round` RPC), dynamic cross-selling recommendations, and custom dish resolution.
3. **Admin Kitchen Operations & POS:** Real-time incoming order stream with audio alerts, in-page POS billing workstation, KOT & receipt management, order holding/settlement, and automated Google Sheets sync.
4. **Hardware Thermal Printing Engine:** Calibrated TVS RP 3200 Plus 80mm & 58mm driver integration, dynamic auto-height `@page` styling, zero-dialog silent printing, and dual ESC/POS binary formatters.
5. **Offline-First Synchronization Engine:** IndexedDB + localStorage mutation queue with pre-flight cloud-state verification, server UUID resolution, automatic duplicate key (`23505`) reconciliation, and zero data-loss quarantine protection.
6. **Embedded Warehouse & Stock Accounting:** Godown management across 7 material categories, purchase rate variance tracking, FIFO consumption ledger, and financial statements.
7. **Hardened Security & Integrity:** Strict administrator verification, universal empty filter guards, 22-table Row-Level Security (RLS), and comprehensive multi-tier audit logging.
8. **39 Automated Test Suites:** Comprehensive unit, behavioral, and regression test suite covering all business logic, financial math, printing, and data synchronization.

---

## 🗺️ Portal Sitemap & Routes

| Portal | Source Path | Target URL | Primary Function |
| :--- | :--- | :--- | :--- |
| **Customer Storefront** | `frontend/index.html` | `/index.html` | Public ordering, 202-dish menu, coupon engine, dynamic delivery fees, and order tracking |
| **Dine-In Table Ordering** | `frontend/table/index.html` | `/table/index.html?t=1` | Contactless table-side QR ordering, round accumulation, item drawer, and cross-sell pairings |
| **Table QR Generator** | `frontend/table/qr-admin.html` | `/table/qr-admin.html` | Staff utility for batch-generating print-ready QR codes for Tables 1–19 |
| **Admin Operations & POS** | `frontend/admin.html` | `/admin.html` | Real-time kitchen display, POS billing, KOT management, thermal printing, and sales reports |
| **Admin Login Gate** | `frontend/admin-login.html` | `/admin-login.html` | Strict role-verified admin authentication (Email/Password & Google OAuth) |
| **Stock & Supply Chain** | `frontend/admin.html#stock` | `/admin.html` (In-page) | Raw material warehouse, stock in/out audits, monthly balance computation, and alerts |
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
- **Real-Time Order Tracking:** WebSocket subscription to order state changes via Supabase Realtime with fallback polling.
- **Multilingual Support:** Instant switching between English, Bengali (বাংলা), Hindi (हिंदी), and Odia (ଓଡ଼ିଆ).

### 2. 🍽️ Dine-In Table QR Ordering System
- **Table Token Tracking:** Tables 1 through 19 identified via query parameter (e.g. `?t=5`).
- **Multi-Round Ticket Accumulation:** Customers place supplementary rounds via `place_table_round` RPC; additional items append to the primary open table session without closing the bill.
- **Interactive Product Detail Drawer:** Modal drawer showing ingredient breakdowns, combo pack contents, high-resolution imagery, and dynamic cross-sell recommendations.
- **Custom Dish Support:** Dynamic resolution of kitchen daily specials (`activeCustomDishes`) directly in drawer views and cart management.

### 3. 🏢 POS Billing Workstation & Order Lifecycle
- **Ergonomic Action Bar:** Clean cart footer with `(F1) Hold`, `KOT`, and `(F2) Create Bill & Settle` action buttons.
- **Dual Visibility Invariant:** Confirmed unpaid bills appear simultaneously in the **Bill** management section (for payment collection) and in **Close Orders** (for operational tracking).
- **Hold Settle Modal:** Centralized collection for Cash, UPI, and Card with authoritative atomic execution via `settle_order_atomic`.
- **Financial Balance:** Guarantees $\text{Total Order Value} = \text{Payment Collected} + \text{Outstanding Amount}$, strictly excluding voided/cancelled tickets.

### 4. 🖨️ Thermal Printing & KOT Studio
- **Hardware Integration:** Calibrated for **TVS Electronics RP 3200 Plus** (80mm roll, 203.2 DPI, 576 dots / ~71.95mm printable width).
- **Dynamic Height & Zero Over-Feed:** Custom `@page { size: 80mm auto; margin: 0; }` and `height: auto !important` styles prevent trailing white paper overrun.
- **Dual ESC/POS Engine:** Native byte-level ESC/POS generator in [`frontend/src/lib/escpos.js`](./frontend/src/lib/escpos.js) supporting 80mm (48-column) and 58mm (32-column) paper rolls.
- **Silent Printing Bridge:** Zero-dialog background printing via local Windows print bridge and offscreen iframe fallback.

### 5. 🔄 Offline-First Synchronization & Recovery Engine
- **Persistent Queues:** Dual-write storage (IndexedDB + localStorage) across `ADMIN_MUTATIONS`, `CUSTOMER_ORDERS`, `TABLE_ROUNDS`, and `STOCK_MUTATIONS`.
- **Pre-Flight Cloud Verification:** Checks cloud state before retrying order inserts; automatically reconciles missing items without duplicating existing items or crashing on PostgreSQL `23505`.
- **Server UUID Resolution:** Automatically replaces temporary client IDs (`offline-xxx`) with server-assigned UUIDs across dependent mutations.
- **Safe Stale Queue Cleanup:** `clearStaleQueue({ confirmed: true })` archives obsolete non-critical jobs to `QUARANTINED_MUTATIONS`, while **unresolved critical mutations (orders, settlements, stock) are strictly preserved**.
- **Header Health State Machine:** Real-time `#sync-indicator` accurately transitions between `Synced`, `Pending`, `Syncing`, `Offline`, and `Failed`.

### 6. 📦 Warehouse & FIFO Inventory Accounting
- **7 Inventory Categories:** Spices & Bhusimal, Dairy Products, Soft Drinks & Beverages, Fresh Vegetables, Ice Cream, Packaging Materials, and Cleaning Supplies.
- **FIFO Lot Consumption Engine:** Automatically deducts ingredient batches in strict First-In-First-Out order, preserving historical purchase valuations.
- **Purchase Rate Variance:** Automatically flags supplier invoice rate discrepancies against master rates.

---

## 📊 Logging & Ingestion Architecture

| Ingestion Channel | Target Destination | Purpose & Trigger |
| :--- | :--- | :--- |
| **Inventory Audit Logs** | PostgreSQL `stock_logs` table | Ingests recipe deductions (`ORDER_DEDUCT`), restocks (`STOCK_IN`), and kitchen usage (`STOCK_OUT`) with timestamps and quantity balances. Ensures idempotency against duplicate order deductions. |
| **Security & Auth Audit Logs** | PostgreSQL `security_audit_logs` table | Ingests admin login attempts, credential verifications, OTP rate-limit events, and sensitive operations via `public.log_security_event()`. |
| **Payment History Logs** | PostgreSQL `payment_history` & `verified_payments` | Ingests UPI UTR validation records, payment gateway status transitions, IP addresses, and failure diagnostic metadata. |
| **External Accounting Stream** | Google Apps Script $\rightarrow$ Google Sheets | Asynchronously streams delivered/billed orders as append-only spreadsheet rows for external bookkeeping and reconciliation. |
| **Hardware & Print Telemetry** | LocalStorage (`print-queue-history`) & Console | Captures thermal printer timeouts, paper-out errors, port disconnections, and retry metrics for hardware diagnosis. |
| **Offline Mutation Quarantine** | LocalStorage (`limra_quarantined_mutations`) | Preserves archived failed/stale mutations with audit timestamps and quarantine reasons. |

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
│   ├── tests/                         # Master automated test suite (39 suites)
│   │   ├── run-all.mjs                # Master test runner orchestrator
│   │   ├── close-orders-repair-phase3.test.mjs    # Phase 3 Close Orders suite
│   │   ├── offline-sync-recovery-phase4.test.mjs  # Phase 4 Offline Sync suite
│   │   ├── hold-bill-close-lifecycle.test.mjs     # Phase 0/1 Lifecycle suite
│   │   └── ...                        # Additional 35 domain-specific suites
│   ├── .env                           # Backend environment variables
│   ├── package.json                   # Backend server dependencies
│   └── server.js                      # Local development proxy & API runner (:3000)
│
├── doc/                               # Engineering Reports & Operational Documentation
│   ├── PHASE_0_BASELINE_INSPECTION_REPORT.md
│   ├── PHASE_1_POS_CART_PAYMENT_REMOVAL.md
│   ├── PHASE_2_CUSTOMER_THERMAL_RECEIPT_REPAIR.md
│   ├── PHASE_3_CLOSE_ORDERS_HISTORICAL_REPAIR.md
│   ├── PHASE_4_OFFLINE_SYNC_FAILED_QUEUE_RECOVERY.md
│   ├── PHASE_5_INTEGRATION_AND_RELEASE_READINESS.md
│   ├── LIMRA_HOLD_BILL_CLOSE_LIFECYCLE_REPAIR_REPORT.md
│   └── ...                            # Full historical architectural reports
│
├── frontend/                          # Vite 8 Multi-Page Application
│   ├── public/                        # Static public assets (images, audio, icons)
│   ├── src/                           # Frontend application source
│   │   ├── data/menu.js               # Master catalog of 202 restaurant dishes
│   │   ├── lib/                       # Core utilities and hardware drivers
│   │   │   ├── escpos.js              # ESC/POS binary thermal print engine
│   │   │   ├── offline-sync.js        # Offline mutation queue & reconciliation
│   │   │   ├── print-queue.js         # Thermal printer background spooler
│   │   │   ├── billing-engine.js      # Canonical GST & billing calculations
│   │   │   └── supabase.js            # Supabase PostgreSQL client bindings
│   │   ├── table/table.js             # Dine-In table QR ordering logic
│   │   ├── admin.js                   # Admin & POS terminal controller
│   │   ├── admin.css                  # Admin dashboard stylesheet
│   │   └── main.js                    # Storefront controller
│   ├── admin.html                     # Admin Panel, POS & Stock Management
│   ├── admin-login.html               # Staff login gate
│   ├── index.html                     # Customer online ordering storefront
│   ├── privacy.html                   # Privacy policy page
│   └── vite.config.js                 # Multi-page Vite configuration
│
├── electron/                          # Desktop Application Process (Electron 44)
│   ├── main.cjs                       # Main process + loopback HTTP server
│   └── preload.cjs                    # Desktop secure hardware bridge
│
├── android/                           # Native Capacitor Android Project
│   └── app/src/main/AndroidManifest.xml
│
├── capacitor.config.json              # Capacitor Android configuration
├── package.json                       # Monorepo root scripts & workspace configuration
└── README.md                          # Master documentation (this file)
```

---

## 🛠️ Developer Commands

| Task | Command | Description |
| :--- | :--- | :--- |
| **Run All 39 Test Suites** | `npm test` | Executes all 39 test suites covering FIFO, RBAC, payments, billing, printing, and sync. |
| **Build Production App** | `npm run build` | Compiles frontend bundles with Vite and syncs assets into root `dist/`. |
| **Start Full Dev Stack** | `npm run dev` | Runs both Frontend (`:5173`) and Backend (`:3000`) concurrently. |
| **Frontend Only** | `npm run dev:frontend` | Starts Vite dev server directly on `http://localhost:5173`. |
| **Backend Only** | `npm run dev:backend` | Starts Node.js backend server directly on `http://localhost:3000`. |
| **Run Desktop App** | `npm run desktop:dev` | Compiles web assets and opens the native Electron desktop application. |
| **Package Desktop Installer** | `npm run desktop:dist` | Packages Windows NSIS installer and portable `.exe` using `electron-builder`. |
| **Sync Android Project** | `npm run cap:sync` | Builds web assets and synchronizes them into the Capacitor Android project. |
| **Open Android Studio** | `npm run cap:open` | Opens the native Android project in Android Studio. |

---

## 📚 Documentation Index (`doc/`)

All technical audits, repair reports, and pre-deployment checklists are preserved inside the [`doc/`](./doc/) directory:

| Document File | Purpose & Contents |
| :--- | :--- |
| [`doc/PHASE_0_BASELINE_INSPECTION_REPORT.md`](./doc/PHASE_0_BASELINE_INSPECTION_REPORT.md) | Baseline inspection across the 4 reported issues before implementation. |
| [`doc/PHASE_1_POS_CART_PAYMENT_REMOVAL.md`](./doc/PHASE_1_POS_CART_PAYMENT_REMOVAL.md) | Implementation details of POS cart payment controls removal and ergonomic action layout. |
| [`doc/PHASE_2_CUSTOMER_THERMAL_RECEIPT_REPAIR.md`](./doc/PHASE_2_CUSTOMER_THERMAL_RECEIPT_REPAIR.md) | Resolution of excessive blank paper feed on TVS RP 3200 Plus thermal printer. |
| [`doc/PHASE_3_CLOSE_ORDERS_HISTORICAL_REPAIR.md`](./doc/PHASE_3_CLOSE_ORDERS_HISTORICAL_REPAIR.md) | Fix for `deliveredOrders` ReferenceError and restoration of Close Orders history. |
| [`doc/PHASE_4_OFFLINE_SYNC_FAILED_QUEUE_RECOVERY.md`](./doc/PHASE_4_OFFLINE_SYNC_FAILED_QUEUE_RECOVERY.md) | Cloud-state verification, server UUID resolution, and safe quarantine recovery. |
| [`doc/PHASE_5_INTEGRATION_AND_RELEASE_READINESS.md`](./doc/PHASE_5_INTEGRATION_AND_RELEASE_READINESS.md) | Final integration matrix, regression tests, and release candidate sign-off. |
| [`doc/LIMRA_HOLD_BILL_CLOSE_LIFECYCLE_REPAIR_REPORT.md`](./doc/LIMRA_HOLD_BILL_CLOSE_LIFECYCLE_REPAIR_REPORT.md) | Dual visibility repair report for confirmed unpaid bills across sections. |
| [`doc/LIMRA_FINAL_PRE_DEPLOYMENT_CHECKLIST.md`](./doc/LIMRA_FINAL_PRE_DEPLOYMENT_CHECKLIST.md) | Pre-deployment verification checklist across infrastructure, auth, and database. |
| [`doc/LIMRA_PRINTING_AND_NAVIGATION_PERFORMANCE_REPORT.md`](./doc/LIMRA_PRINTING_AND_NAVIGATION_PERFORMANCE_REPORT.md) | Print latency reduction and fast in-page DOM navigation optimizations. |
| [`doc/LIMRA_PRODUCTION_42501_SETTLEMENT_REPAIR_REPORT.md`](./doc/LIMRA_PRODUCTION_42501_SETTLEMENT_REPAIR_REPORT.md) | Resolution of Supabase PostgreSQL RLS 42501 settlement authorization issues. |
| [`doc/LIMRA_PRODUCTION_CONNECTIVITY_SYNC_FORENSIC_AUDIT.md`](./doc/LIMRA_PRODUCTION_CONNECTIVITY_SYNC_FORENSIC_AUDIT.md) | Forensic audit of offline queues, network drops, and synchronization resilience. |
| [`doc/LIMRA_THERMAL_PRINTING_FINAL_REPAIR_REPORT.md`](./doc/LIMRA_THERMAL_PRINTING_FINAL_REPAIR_REPORT.md) | TVS RP 3200 Plus calibration, monospace alignment, and silent print bridge report. |

---

## 📞 Support & Business Inquiries

| Property | Information |
| :--- | :--- |
| **Restaurant Name** | LIMRA Restaurant |
| **Proprietor** | SK Arfat Ali |
| **Address** | Main Road, Near Bus Stand, Egra, Purba Medinipur, West Bengal — 721429 |
| **Phone** | +91 7501299357 |
| **Email** | `skarfat78690@gmail.com` |

---

## 📜 License

This software, digital assets, database structures, and designs are **proprietary software** created for and owned exclusively by **SK Arfat Ali (LIMRA Restaurant)**.  
Unauthorized copying, modification, distribution, or commercial deployment without prior written permission is strictly prohibited.  
Copyright © 2026 LIMRA Restaurant. All rights reserved.
