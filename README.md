# 🍽️ LIMRA Restaurant — Enterprise Food Service, Dine-In & Multi-Platform POS Platform

[![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen.svg)]()
[![Frontend](https://img.shields.io/badge/Frontend-Vite%208%20%2B%20Tailwind%20CSS-646CFF.svg)]()
[![Backend](https://img.shields.io/badge/Backend-Node.js%20%2B%20Vercel%20Serverless-000000.svg)]()
[![Database](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E.svg)]()
[![Desktop](https://img.shields.io/badge/Desktop-Electron%20Windows%20%26%20macOS-0078D7.svg)]()
[![Mobile](https://img.shields.io/badge/Mobile-Capacitor%208%20Android%20POS-3DDC84.svg)]()
[![Hardware](https://img.shields.io/badge/Hardware-ESC%2FPOS%20Thermal%20(80mm%2F58mm)-orange.svg)]()

> **Proprietor & Operator:** SK Arif | LIMRA Restaurant, Egra, Purba Medinipur, West Bengal, India  
> **Location:** Main Road, Near Bus Stand, Egra, Purba Medinipur, West Bengal — 721429  
> **Contact:** +91 7501299357 | `arfatalis451@gmail.com`  
> **Database:** Supabase PostgreSQL (`https://ynrtlcasbndkrqeotgzt.supabase.co`) with Row-Level Security (RLS)  
> **Monorepo:** `frontend` (Vite 8 SPA/MPA) + `backend` (Node.js API & Server) + `electron` (Desktop) + `android` (Capacitor)  

---

## 📖 Executive Summary

**LIMRA Restaurant Platform** is an enterprise-grade, omnichannel food service operating system custom-engineered for high-volume dining, kitchen automation, contactless table orders, inventory financials, and online food delivery.

Designed with a high-performance, modular architecture:
- **Zero-Latency Customer Storefront**: Multilingual digital storefront with a 202-dish catalog, real-time search, interactive Leaflet delivery map with dynamic distance fee calculations, and instant Razorpay UPI checkout.
- **Contactless Dine-In Table Ordering**: Table-side QR code ordering system with order round accumulation, customer item drawer, and intelligent dynamic cross-selling pairings.
- **All-in-One Admin & Kitchen POS**: Dual-mode kitchen display (KOT), real-time order lifecycle manager, POS billing terminal, live analytics charts, and delivery dispatch.
- **Integrated Stock Summary & Financials**: Embedded, tabbed warehouse management with 1-click Quick Stock IN/OUT, automated purchase rate variance tracking (`Higher`, `Lower`, `Same Rate`), batch cost impact calculation, and daily/weekly/monthly valuation statements.
- **Hardware Integration**: Byte-level ESC/POS thermal printing engine supporting 80mm and 58mm paper rolls, cash drawer kick pulses, and dynamic UPI QR generation.
- **Cross-Platform Deployments**: Single codebase natively deployable to Web (Vercel), Windows/macOS Desktop (`.exe` via Electron), and Android Tablets (`.apk` via Capacitor).

---

## 🗺️ Application Sitemap & Routes

| Module | Source File | Web Route | Key Features & Responsibilities |
| :--- | :--- | :--- | :--- |
| **Customer Storefront** | `frontend/index.html` | `/index.html` | 202-dish menu, category filters, cart, coupons, Leaflet delivery radius calculator, order tracking, and English/Bengali/Hindi/Odia translation. |
| **Dine-In Table Ordering** | `frontend/table/index.html` | `/table/index.html?t=1` | Contactless QR ordering for Tables 1–19, round aggregation, item drawer, active orders view, and dynamic cross-sell recommendations. |
| **Table QR Generator** | `frontend/table/qr-admin.html` | `/table/qr-admin.html` | Staff utility for batch-generating and printing branded QR codes with embedded table parameters. |
| **Admin Panel & POS** | `frontend/admin.html` | `/admin.html` | Live KOT kitchen monitor, POS billing, orders history, sales analytics (Chart.js), delivery tracking, settings, and embedded Stock Manager. |
| **Stock Management** | `frontend/admin.html#panel-stock` | `/admin.html` (In-Page) | Live operations, 1-click IN/OUT hero bar, weekly/monthly valuation statements, purchase rate variance analysis, and PostgreSQL sync. |
| **Standalone Stock Portal** | `frontend/stock-manager/index.html` | `/stock-manager/index.html` | Dedicated fullscreen warehouse audit view with Excel and PDF export capabilities. |
| **Admin Authentication** | `frontend/admin-login.html` | `/admin-login.html` | Secure role-based staff authentication gate supporting credentials and Google OAuth. |
| **Customer Privacy Policy**| `frontend/privacy.html` | `/privacy.html` | Data protection notice, customer account rights, payment security terms, and compliance disclosures. |

---

## 🏗️ System Architecture & Data Flow

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

## 📦 Key Functional Modules

### 1. ⚡ Embedded Stock Summary & Warehouse Accounting
- **In-Page Seamless Navigation**: Accessible directly inside `admin.html` under the **Warm Parchment & Contemporary Indigo** theme with zero browser redirects.
- **Top Quick-Action Hero Bar**:
  - `[➕ Quick Stock IN (Purchases & Cost)]` — Record incoming supplies with instant cost calculations.
  - `[➖ Quick Stock OUT (Kitchen Usage)]` — Log kitchen preparation and wastage in real time.
  - `[📦 + Add New Item]` — Create new master ingredients with initial stock and unit valuation.
- **Row-Level 1-Click Operations**: Table 3 (Real-Time Stock Balance) and the Inventory Directory feature direct inline `[+ IN]` and `[- OUT]` buttons for instant logging without searching dropdowns.
- **Intelligent Purchase Rate Variance**:
  - Auto-compares incoming rate against the master item purchase cost.
  - Displays instant badges: `🔺 +₹ X Higher (+Y%)`, `🔻 -₹ X Lower (-Y%)`, or `✅ Same Rate`.
  - Computes exact batch financial impact (e.g. *⚠️ Higher by ₹5.00/kg! Additional batch cost: ₹100.00*).
  - Optional checkbox to update master rate in PostgreSQL database (`stock_items.cost_price`).
- **Comprehensive Statements**:
  - **Live Stock**: Real-time balances, low-stock warnings, and today's movements.
  - **Weekly Financial Statement**: Weekly opening valuation, purchases (+), kitchen usage (-), net variance, and closing valuation.
  - **Monthly Financial Statement**: Complete calendar month-to-date statements with Excel (`.xlsx`) and PDF exports.

### 2. 📱 Contactless Dine-In Table Ordering (`/table/`)
- **Table-Side QR Integration**: Customers scan table-specific QR codes (`/table/index.html?t=04`) to access live menu ordering without downloading apps.
- **Dynamic Cross-Selling Engine**: Automatically recommends matching pairings based on cart contents (e.g., suggesting *Butter Naan* or *Cold Drinks* with *Chicken Biryani*).
- **Rounds Accumulation**: Customers can place multiple order rounds throughout their meal; kitchen KOTs receive newly added items while preserving previous rounds under the active table session.

### 3. 🖨️ Thermal ESC/POS Printing Engine
- **Byte-Level Formatter (`escpos.js`)**: Generates raw binary ESC/POS escape sequences for **80mm (48-column)** and **58mm (32-column)** paper rolls.
- **KOT & Customer Bill Printing**: Produces kitchen order tickets, tax invoices with GSTIN/FSSAI headers, dynamic UPI QR codes, review QR links, and cash drawer kick signals.
- **Multi-Driver Support**: Compatible with direct USB, Bluetooth, network LAN thermal printers, and QZ Tray desktop print spoolers.
- **Resilient Print Queue (`print-queue.js`)**: Handles print retries, status checks, and offline queuing.

### 4. 🌐 Multilingual Customer Storefront
- **Language Switcher (`i18n.js`)**: Dynamic localized translation supporting English, Bengali (বাংলা), Hindi (हिन्दी), and Odia (ଓଡ଼ିଆ).
- **Interactive Delivery Radius Engine**: Integrates Leaflet maps to calculate user distance from LIMRA restaurant and auto-compute tiered delivery fees.
- **Secure Payments**: Razorpay UPI and card payments integrated alongside traditional Cash on Delivery (COD).

---

## 📂 Repository Structure

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
│   └── verify-payment.js              # Razorpay cryptographic signature verification
│
├── backend/                           # Node.js Express / HTTP Local API Server
│   ├── api/                           # Mirror API controllers for local runtime
│   ├── .env                           # Backend environment variables
│   ├── package.json                   # Backend server dependencies
│   └── server.js                      # Local development proxy & API runner (:3000)
│
├── frontend/                          # Vite 8 Multi-Page Application
│   ├── public/                        # Static public assets
│   │   ├── images/                    # Food menu images, banners, and logos
│   │   ├── media/                     # Food category cards and photos
│   │   ├── vendor/                    # Local Leaflet map & Lucide icon libraries
│   │   └── favicon.ico                # Multi-resolution branding icons
│   ├── src/                           # Frontend application source
│   │   ├── data/menu.js               # Master catalog of 202 restaurant dishes
│   │   ├── lib/                       # Utilities and integrations
│   │   │   ├── admin-routes.js        # Internal route guard
│   │   │   ├── email-service.js       # Customer notification dispatcher
│   │   │   ├── escpos.js              # ESC/POS binary thermal print engine
│   │   │   ├── i18n.js                # Multilingual translation dictionary
│   │   │   ├── insforge.js            # InsForge SDK compatibility layer
│   │   │   ├── notifications.js       # Audio & visual alert manager
│   │   │   ├── payments.js            # Razorpay checkout script loader
│   │   │   ├── print-queue.js         # Thermal printer background spooler
│   │   │   └── supabase.js            # Supabase PostgreSQL client bindings
│   │   ├── stock-manager/             # Stock summary & inventory engine
│   │   │   ├── data/initialStockData.js # Baseline inventory fallback dataset
│   │   │   ├── stock-inpage.css       # Warm Parchment & Indigo theme styles
│   │   │   ├── stock-manager.css      # Standalone warehouse styling
│   │   │   └── stock-manager.js       # In-page + standalone inventory controller
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
├── migrations/                        # Supabase SQL Migrations History
│   ├── 20260529184324_create-orders-bookings.sql
│   ├── 20260612000000_add_table_orders.sql
│   ├── 20260618000000_harden_backend_security.sql
│   ├── 20260916210000_add_ticket_status_lifecycle.sql
│   └── 20260916220000_stock_rpcs_and_enforcement.sql
│
├── scripts/                           # Maintenance & Tooling Scripts
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
- **Node.js** (v18.x or v20.x recommended)
- **npm** (v9.x or v10.x)
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
Ensure `.env` exists in the project root (and in `backend/` and `frontend/`):
```env
# Supabase Database & Auth
VITE_SUPABASE_URL=https://ynrtlcasbndkrqeotgzt.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Payment Gateway (Razorpay)
RAZORPAY_KEY_ID=your_razorpay_key_id
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
| **Generate App Icons** | `python scripts/generate-app-icons.py` | Automatically regenerates `.ico`, `.png`, and Android mipmap launcher icons from master logo. |

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
