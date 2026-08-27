# 🍽️ LIMRA Restaurant — Full-Stack Restaurant E-Commerce & Management Platform

> **Live Production Website:** [https://vb9ucr22.insforge.site](https://vb9ucr22.insforge.site)  
> **Backend BaaS:** [https://vb9ucr22.us-east.insforge.app](https://vb9ucr22.us-east.insforge.app)  
> **Owner:** SK Arif | LIMRA Restaurant, Egra, Purba Medinipur, West Bengal

---

## 📖 Project Overview

LIMRA Restaurant is a **production-grade, multi-page restaurant e-commerce and POS ecosystem**. It covers the complete customer-to-kitchen lifecycle:
- **Online Ordering & Delivery:** 202-item categorized menu, interactive delivery map with GPS geocoding, coupon discounts, and live tracking.
- **QR Dine-In Ordering:** Table-side mobile ordering (Tables 1–19), multi-round KOT merging, and real-time review prompts.
- **Admin Control Center:** Live order processing, KOT bill printing, booking management, menu price overrides, combo builder, and real-time WebSocket notifications.
- **Raw Material & Stock Manager:** Automated inventory deduction, low-stock alerts, 7 material categories, and stock audit logs.
- **Backend Architecture:** Powered by **InsForge PostgreSQL BaaS** (`@insforge/sdk`) and a dedicated Node.js API server (`backend/server.js`).

---

## 🗺️ Live Portals & Entry Points

| Portal | File / Route | Purpose | Live Link |
| :--- | :--- | :--- | :--- |
| **Customer Website** | `frontend/index.html` | Public ordering, menu, delivery map, bookings | [Open](https://vb9ucr22.insforge.site) |
| **Admin Dashboard** | `frontend/admin.html` | Kitchen order tickets, billing, menu & coupon manager | [Open](https://vb9ucr22.insforge.site/admin.html) |
| **Admin Login** | `frontend/admin-login.html` | Role-based authentication | [Open](https://vb9ucr22.insforge.site/admin-login.html) |
| **Dine-In Table Ordering** | `frontend/table/index.html` | QR-based dine-in ordering (e.g. `?t=1`) | [Open](https://vb9ucr22.insforge.site/table/index.html?t=1) |
| **Table QR Generator** | `frontend/table/qr-admin.html` | Generate & print high-res QR codes per table | [Open](https://vb9ucr22.insforge.site/table/qr-admin.html) |
| **Stock & Inventory Manager** | `frontend/stock-manager/index.html` | Raw material tracking & consumption logs | [Open](https://vb9ucr22.insforge.site/stock-manager/index.html) |
| **Privacy Policy** | `frontend/privacy.html` | Legal and data compliance | [Open](https://vb9ucr22.insforge.site/privacy.html) |

---

## 🧩 Core Application Features

### 🛒 1. Customer Ordering Experience (`frontend/index.html`)
- **202-Item Categorized Menu:** Biryani, Tandoor & Kababs, Chinese, Mughlai, Desserts, Mocktails, and Combos.
- **Interactive Delivery Radius Map:** Leaflet.js + OpenStreetMap with GPS location detection and area-based delivery charges.
- **Cart & Discount Engine:** Antigravity reactive store, instant cart calculations, coupon validation, and auto-applied discounts.
- **Payment Options:** Razorpay Gateway, UPI / WhatsApp Pay with UTR verification, Cash on Delivery (COD), and Card on Delivery.
- **Real-Time Order Tracking:** WebSocket pub/sub live updates via InsForge Realtime with 10s polling fallback.
- **Table, Party & Wedding Bookings:** Visual seating preferences, event calendar, and phone number reservation lookup.

### 🏢 2. Admin Operations & Kitchen POS (`frontend/admin.html`)
- **Live Order Stream:** Real-time incoming order sound chimes, multi-status progression (`Pending` → `Preparing` → `Ready` → `Delivered` / `Cancelled`).
- **KOT & Thermal Bill Printing:** ESC/POS 58mm/80mm receipt generation with GSTIN, FSSAI, CGST, and SGST breakdowns.
- **Live Menu & Price Overrides:** Instant price adjustments, MRP discounts, availability toggling, and featured item highlights.
- **Coupons & Combos Engine:** Create, edit, and expire discount codes and bundle deals with minimum cart constraints.
- **Sales Analytics:** Real-time revenue charts (Chart.js), hourly heatmaps, order type distribution, and top-selling dishes.

### 🍽️ 3. Dine-In Table Ordering (`frontend/table/index.html`)
- QR scanned per table (`?t=1` to `?t=19`).
- Mobile-optimized interface with food search and round tracking.
- Multi-round ordering with kitchen order ticket accumulation.
- Seamless feedback integration via Google Review prompts.

### 📦 4. Raw Material & Stock Manager (`frontend/stock-manager/index.html`)
- **7 Inventory Categories:** Bhusimal & Spices, Dairy Items, Cold Drinks, Fresh Vegetables, Ice Cream, Packaging & Bags, Cleaning Supplies.
- **Automatic Consumption:** Stock deducted atomically on order completion.
- **Audit Trails:** Detailed `stock_in`, `stock_out`, and `stock_logs` transaction records.
- **Low-Stock Alerts:** Color-coded minimum threshold warnings.

---

## 🗄️ Database Architecture (InsForge PostgreSQL)

The database runs on **InsForge BaaS (PostgreSQL)** with 23 synchronized operational and security tables (3,081 records):

| Table Name | Records | Purpose |
| :--- | :--- | :--- |
| `orders` | **11** | Customer orders (delivery, takeaway, dine-in) |
| `order_items` | **21** | Relational items linked to orders |
| `stock_items` | **138** | Tracked inventory and raw materials |
| `stock_in` / `stock_in_entries` | **226** | Inventory receipt transactions |
| `stock_out` / `stock_out_entries` | **544** | Inventory consumption records |
| `stock_logs` | **883** | Full stock audit trail and balance changes |
| `notifications` | **161** | In-app alerts for kitchen, admin, and customers |
| `menu_overrides` | **83** | Dynamic pricing and stock availability |
| `delivery_areas` | **21** | Delivery zone charges and radius boundaries |
| `coupons` / `coupon_usage` | **3** | Active coupon codes and redemption history |
| `combos` | **1** | Food combo bundle configurations |
| `bookings` | **1** | Table, party, and wedding reservations |
| `printer_settings` | **1** | Thermal printer configurations and GSTIN data |
| `customer_profiles` | **5** | Customer address and profile metadata |
| `admin_users` | **3** | Authenticated admin user accounts |
| `security_audit_logs` | **208** | Security authentication and access logs |
| `verified_payments` | **0** | Verified Razorpay transactions |
| `payment_history` | **0** | Payment status change audit records |
| `reviews` | **1** | Customer ratings and feedback |

---

## 🔌 Backend Server & API Endpoints

The backend server is powered by `backend/server.js` listening on port `3000`:

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/api/db-status` | `GET` | Live InsForge connectivity, latency, and row count metrics |
| `/api/orders` | `GET`, `POST`, `PATCH` | Order creation, listing, status updates & atomic stock deduction |
| `/api/menu` | `GET`, `POST`, `PATCH` | Menu catalog & dynamic `menu_overrides` management |
| `/api/analytics` | `GET` | Revenue metrics, hourly heatmaps, top dishes, and low-stock alerts |
| `/api/db` | `POST` | Universal RPC dispatcher (`place_order`, `place_table_round`, `place_booking`, `get_customer_orders`, auth) |
| `/api/create-order` | `POST` | Razorpay order generation |
| `/api/verify-payment` | `POST` | Razorpay HMAC signature verification and logging to `verified_payments` |

---

## 🛠️ Tech Stack

- **Frontend:** Vanilla HTML5, Modern ES Modules, Tailwind CSS, Leaflet.js, Chart.js, QRCode.js.
- **Build Tool:** Vite 8.
- **Backend Server:** Node.js HTTP API Server (`backend/server.js`).
- **Database & BaaS:** InsForge PostgreSQL, Auth, Realtime WebSockets, Storage (`@insforge/sdk`).
- **Payment Gateway:** Razorpay.
- **Hosting:** InsForge Hosting (`https://vb9ucr22.insforge.site`).

---

## 📂 Monorepo Structure

```
E-COMMERSE LIMRA website/
├── backend/
│   ├── api/
│   │   ├── lib/
│   │   │   └── insforge.js       # InsForge SDK Client & SQL Service
│   │   ├── analytics.js          # Sales & inventory analytics
│   │   ├── create-order.js       # Razorpay order creator
│   │   ├── db-status.js          # Health check & table metrics
│   │   ├── db.js                 # Universal CRUD & RPC dispatcher
│   │   ├── menu.js               # Menu overrides API
│   │   ├── orders.js             # Order lifecycle & stock deduction
│   │   └── verify-payment.js     # Payment signature verification
│   ├── package.json              # Backend dependencies
│   ├── server.js                 # Unified API dispatcher & static server
│   └── .env                      # Backend environment config
│
├── frontend/
│   ├── public/                   # Static assets, logos, icons, QR codes
│   ├── src/
│   │   ├── data/
│   │   │   └── menu.js           # 202-dish menu catalog & category metadata
│   │   ├── lib/
│   │   │   ├── admin-routes.js   # Route authorization helpers
│   │   │   ├── email-service.js  # Order confirmation emails
│   │   │   ├── insforge.js       # Frontend InsForge SDK client & queries
│   │   │   ├── notifications.js  # In-app & external notifications
│   │   │   └── payments.js       # Payment service interface
│   │   ├── stock-manager/        # Stock manager logic & initial CSV seeds
│   │   ├── table/                # Table ordering logic & QR generator
│   │   ├── admin-login.js        # Admin authentication flow
│   │   ├── admin.js              # Admin dashboard controller (~11k lines)
│   │   ├── main.js               # Main customer website controller (~5k lines)
│   │   └── style.css             # Design system
│   ├── admin-login.html          # Admin login page
│   ├── admin.html                # Admin dashboard page
│   ├── index.html                # Customer website page
│   ├── package.json              # Frontend dependencies
│   └── vite.config.js            # Multi-page build configuration
│
├── scripts/
│   ├── audit_insforge_tables.mjs # Database row count auditor
│   ├── deploy.mjs                # InsForge hosting deployment pipeline
│   ├── export_mongo_data.mjs     # Complete database exporter (JSON/CSV)
│   ├── migrate_mongo_to_insforge.mjs # InsForge database migration script
│   ├── run-dev.mjs               # Concurrent dev server launcher
│   └── test_insforge_endpoints.mjs   # Automated API test suite
│
├── data/
│   └── migration_exports/        # Exported JSON and CSV database backups
│
├── package.json                  # Monorepo workspaces & root scripts
├── .env                          # Root environment config
└── README.md                     # Project documentation
```

---

## ⚙️ Local Setup & Development

### 1. Prerequisites
- **Node.js 18+** installed
- **npm** package manager

### 2. Installation
Clone the repository and install all dependencies:
```bash
git clone <repository-url>
cd "E-COMMERSE LIMRA website"
npm install
```

### 3. Environment Configuration
Create `.env` in the root directory (and in `frontend/` and `backend/`):
```env
# InsForge PostgreSQL BaaS
VITE_INSFORGE_URL=https://vb9ucr22.us-east.insforge.app
VITE_INSFORGE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
INSFORGE_ADMIN_KEY=ik_799af068e8f4fb05944d04497229fe7d
API_BASE_URL=https://vb9ucr22.us-east.insforge.app

# Server Configuration
PORT=3000

# Razorpay Payments
RAZORPAY_KEY_ID=rzp_test_TBmsInWXVkKowt
RAZORPAY_KEY_SECRET=DL98BCefLpezCsb3bdj5f2MW
VITE_RAZORPAY_KEY_ID=rzp_test_TBmsInWXVkKowt
```

### 4. Running Development Servers
Start both the frontend Vite dev server and the backend API server concurrently:
```bash
npm run dev
```

Or run them individually:
```bash
# Frontend only (http://localhost:5173)
npm run dev:frontend

# Backend API server only (http://localhost:3000)
npm run dev:backend
```

---

## 🧪 Testing & Verification

Run the automated backend test suite:
```bash
node scripts/test_insforge_endpoints.mjs
```

Run the live database audit report:
```bash
node scripts/audit_insforge_tables.mjs
```

Build the frontend production bundle:
```bash
npm run build
```

---

## 🚀 Deployment

Deploy the frontend application directly to InsForge Hosting:
```bash
npm run deploy:insforge
```

---

## 📞 Support & Contacts

| Detail | Information |
| :--- | :--- |
| **Restaurant Name** | LIMRA Restaurant |
| **Owner** | SK Arif |
| **Location** | Egra, Purba Medinipur, West Bengal, India |
| **Phone** | +91 7501299357 |
| **Email** | arfatalis451@gmail.com |

---

## 📝 License

This project is **proprietary** and owned by **SK Arif (LIMRA Restaurant)**. All rights reserved.
