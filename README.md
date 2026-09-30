# 🍽️ LIMRA Restaurant — Enterprise Food Service, POS & E-Commerce Platform

[![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/Platforms-Web%20%7C%20Electron%20Desktop-indigo.svg)]()
[![Database](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E.svg)]()
[![Backend](https://img.shields.io/badge/Backend-Node.js%20%2F%20Vercel-000000.svg)]()
[![Frontend](https://img.shields.io/badge/Frontend-Vite%206%20%2B%20Tailwind%20CSS-646CFF.svg)]()
[![Payments](https://img.shields.io/badge/Payments-Razorpay%20Integrated-0B61A4.svg)]()

> **Owner / Operator:** SK Arif | LIMRA Restaurant, Egra, Purba Medinipur, West Bengal, India
> **Backend BaaS:** Supabase PostgreSQL (`https://ynrtlcasbndkrqeotgzt.supabase.co`)

---

## 📖 Executive Summary

**LIMRA Restaurant** is a production-grade enterprise digital operating ecosystem for high-volume modern food service. It unifies:

1. **Customer Online Storefront** — 202-dish menu, Leaflet delivery zones, coupon engine, live order tracking, multi-language (EN, BN, HI, OD)
2. **Dine-In Table QR Ordering** — Table-side QR tokens (Tables 1-19), multi-round KOT accumulation, cross-selling
3. **Admin Kitchen Operations & POS** — Real-time order stream with audio alerts, POS billing, KOT & receipt management
4. **Stock & Inventory Management** — Real-time stock deduction, low-stock alerts, stock-in/out tracking
5. **Electron Desktop POS** — Windows .exe with ESC/POS thermal printer support (80mm/58mm)
6. **Analytics Dashboard** — Revenue analytics, order type breakdown, hourly heatmaps, top dishes

---

## 🗂️ Project Structure

```
LIMRA-Restaurant/
│
├── 📁 backend/                      # Node.js API Server
│   ├── api/                         # API Route Handlers
│   │   ├── lib/
│   │   │   └── supabase.js          # Supabase client + DB utilities
│   │   ├── analytics.js             # GET  /api/analytics
│   │   ├── create-order.js          # POST /api/create-order (Razorpay)
│   │   ├── db-status.js             # GET  /api/db-status
│   │   ├── db.js                    # ALL  /api/db (CRUD dispatcher)
│   │   ├── menu.js                  # GET/POST/PATCH /api/menu
│   │   ├── orders.js                # GET/POST/PATCH/DELETE /api/orders
│   │   └── verify-payment.js        # POST /api/verify-payment
│   ├── .env                         # Backend environment variables
│   ├── package.json
│   └── server.js                    # HTTP server + global CORS + static serving
│
├── 📁 frontend/                     # Vite 6 Multi-Page Application
│   ├── public/                      # Static assets (served as-is)
│   │   ├── images/
│   │   │   └── qr/                  # Pre-generated QR codes (table-1 to table-19)
│   │   ├── media/
│   │   │   ├── items/               # Menu item photos (1.jpg - 202.jpg)
│   │   │   └── menu/                # Physical menu card photos
│   │   ├── vendor/                  # Vendored JS libs (Leaflet, Lucide)
│   │   ├── favicon.ico
│   │   ├── robots.txt
│   │   └── sitemap.xml
│   ├── src/                         # Source JavaScript modules
│   │   ├── data/
│   │   │   └── menu.js              # Full 202-item menu data
│   │   ├── lib/
│   │   │   ├── supabase.js          # Frontend Supabase client + helpers
│   │   │   ├── admin-routes.js      # Admin route guards
│   │   │   ├── email-service.js     # Email notifications
│   │   │   ├── escpos.js            # ESC/POS thermal printer driver
│   │   │   ├── i18n.js              # Multi-language (EN/BN/HI/OD)
│   │   │   ├── notifications.js     # Push notification helpers
│   │   │   ├── payments.js          # Razorpay frontend helpers
│   │   │   └── print-queue.js       # Print job queue manager
│   │   ├── stock-manager/           # Stock management JS + CSS modules
│   │   └── table/
│   │       └── table.js             # Dine-in table ordering logic
│   ├── stock-manager/
│   │   └── index.html               # Stock Manager page
│   ├── table/
│   │   ├── index.html               # Customer table ordering UI
│   │   └── qr-admin.html            # Admin QR code generator
│   ├── admin-login.html             # Admin login page
│   ├── admin.html                   # Admin dashboard (POS + Analytics)
│   ├── index.html                   # Customer storefront
│   ├── privacy.html                 # Privacy policy page
│   ├── vite.config.js               # Vite build config (MPA)
│   └── package.json
│
├── 📁 electron/                     # Electron Desktop App (Windows .exe)
│   ├── main.cjs                     # Electron main process
│   ├── preload.cjs                  # Electron preload script
│   ├── icon.ico                     # Windows app icon
│   └── icon.png                     # macOS app icon
│
├── 📁 database/                     # All database files (organized)
│   ├── schema.sql                   # Complete Supabase schema (22 tables)
│   └── migrations/                  # Chronological migration history (24 files)
│
├── 📁 tools/                        # Developer utilities & integrations
│   └── google-apps-script/
│       └── Code.gs                  # Google Sheets order sync script
│
├── 📁 scripts/                      # Build & dev helper scripts
│   ├── run-dev.mjs                  # Starts frontend + backend together
│   ├── generate-menu.mjs            # Menu data generator
│   └── generate-table-qr.mjs       # QR code generator for tables
│
├── .env                             # Root environment variables
├── .env.example                     # Environment variable template
├── .gitignore
├── capacitor.config.json            # Capacitor (Android) config
├── package.json                     # Root monorepo (npm workspaces)
└── vercel.json                      # Vercel deployment config
```

---

## ⚡ Quick Start

### Prerequisites
- Node.js 20+
- npm 10+

### 1. Clone & Install

```bash
git clone <repo-url>
cd LIMRA-Restaurant
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your-secret-key
PORT=3000
```

Also fill `frontend/.env`:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
VITE_RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxx
```

### 3. Run Development Server

```bash
npm run dev
```

| URL | Page |
|-----|------|
| `http://localhost:5173` | Customer Storefront |
| `http://localhost:5173/admin-login.html` | Admin Login |
| `http://localhost:5173/admin.html` | Admin Dashboard & POS |
| `http://localhost:5173/table/index.html` | Table QR Order |
| `http://localhost:5173/stock-manager/index.html` | Stock Manager |

---

## 🧰 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite 6 (Multi-Page Application) |
| Styling | Tailwind CSS v4 |
| Database | Supabase PostgreSQL (22 tables, full RLS) |
| Backend | Node.js HTTP server + Vercel Serverless |
| Payments | Razorpay (UPI, Card, NetBanking) |
| Maps | Leaflet.js (delivery zone mapping) |
| Printing | ESC/POS (80mm / 58mm thermal printers) |
| Desktop | Electron 44 (Windows .exe) |
| Charts | Chart.js |
| QR Codes | `qrcode` npm package |
| Multi-language | Custom i18n (EN, BN, HI, OD) |

---

## 🔌 API Reference

> CORS is handled **centrally in `server.js`** — individual handlers are clean.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET/POST/PATCH/DELETE` | `/api/orders` | Order CRUD + multi-round table logic |
| `POST` | `/api/create-order` | Create Razorpay payment order |
| `POST` | `/api/verify-payment` | Verify Razorpay HMAC signature |
| `GET/POST/PATCH` | `/api/menu` | Menu price/availability overrides |
| `GET/POST/PUT/PATCH/DELETE` | `/api/db` | Generic Supabase CRUD dispatcher |
| `GET` | `/api/db-status` | Database health + table row counts |
| `GET` | `/api/analytics` | Revenue analytics + inventory alerts |

---

## 🗄️ Database Schema (22 Tables)

Full schema: [`database/schema.sql`](database/schema.sql) | Migrations: [`database/migrations/`](database/migrations/)

| Table | Purpose |
|-------|---------|
| `orders` | All customer orders (delivery + dine-in) |
| `order_items` | Line items per order |
| `menu_overrides` | Admin price/availability overrides |
| `notifications` | Staff order alert notifications |
| `admin_users` | Admin authentication records |
| `bookings` | Table/event reservations |
| `stock_items` | Inventory items with quantities |
| `stock_logs` | Inventory deduction history |
| `stock_in` / `stock_in_entries` | Stock restocking records |
| `stock_out` / `stock_out_entries` | Manual stock out records |
| `verified_payments` | Razorpay verified payment UTRs |
| `payment_history` | Full payment transaction log |
| `customer_profiles` | Registered customer data |
| `coupons` / `coupon_usage` | Discount coupon engine |
| `delivery_areas` | Leaflet delivery zone polygons |
| `reviews` | Customer review data |
| `printer_settings` | Thermal printer configuration |
| `phone_verifications` | OTP verification records |
| `security_audit_logs` | Security event audit trail |

---

## 🏗️ Build & Deploy

```bash
# Production build
npm run build

# Deploy to Vercel
npm run deploy:insforge

# Electron Windows .exe
npm run desktop:dist
```

---

## 🛡️ Security Notes

- **RLS** enabled on all 22 Supabase tables
- Backend uses `SUPABASE_SERVICE_ROLE_KEY` — **never expose this in frontend**
- Razorpay signature verification is **server-side only** (HMAC-SHA256)
- `RAZORPAY_KEY_SECRET` must **never be hardcoded** or committed to Git

---

## 📄 License

Private & Proprietary — © 2025-2026 SK Arif / LIMRA Restaurant. All rights reserved.
