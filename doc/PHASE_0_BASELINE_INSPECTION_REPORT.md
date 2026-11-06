# LIMRA POS — PHASE 0: ENGINEERING INSPECTION AND BASELINE AUDIT REPORT

**Date:** November 6, 2026  
**Auditor:** Senior Full-Stack Engineer  
**Status:** Baseline Completed  

---

## 1. Baseline Objective

Investigate and audit the four core operational issues reported in the LIMRA Restaurant POS monorepo:
1. POS Billing cart contains unnecessary quick-payment buttons (Cash, UPI, Card).
2. Customer thermal bills print excessive blank paper feed on TVS RP 3200 Plus.
3. Order Hub > Close & Settle history is blank for Today, Yesterday, and All Time (`deliveredOrders is not defined` crash).
4. Persistent `⚠️ Sync Failed / Retry` warning in the manager header (`#sync-indicator`).

---

## 2. Working Tree Baseline

- **Branch:** `main`
- **Monorepo Architecture:** Vite 8 MPA + Electron 44 + Capacitor Android + Node.js / Vercel Serverless + Supabase PostgreSQL.
- **Verification Rule:** Strict read-only inspection. No user changes stashed or reverted.

---

## 3. Findings per Issue

### Issue 1: POS Cart Payment Buttons
- `#pos-payment-mode` select was bound to quick-payment mode buttons (`.pos-pay-mode-pill`) in `frontend/admin.html`.
- Removing the buttons required keeping `#pos-payment-mode` in the DOM as a hidden element with default value `'cash'` so cart creation and settlement calculations remained backward compatible.

### Issue 2: Customer Thermal Receipt Paper Over-Feed
- Target Hardware: TVS Electronics RP 3200 Plus (80mm thermal roll, ~71.95mm printable width, 203.2 DPI).
- `generateBillWithTaxHtml()` and `printReceiptViaBrowserIframe()` did not enforce strict dynamic page-height styles (`@page { size: 80mm auto; margin: 0; }`).
- Browsers defaulted to standard A4 sheet heights (297mm), causing ~200mm of unnecessary blank roll feeding after every bill.

### Issue 3: Close & Settle Historical Orders Crash
- `renderClosedOrdersPanel()` referenced undeclared `deliveredOrders` and out-of-scope date strings `todayStr` and `yestStr`.
- This caused an `Uncaught ReferenceError`, aborting table rendering and leaving the history view blank across Today, Yesterday, and All Time filters.

### Issue 4: Persistent Offline Sync Failed Badge
- When orders were submitted during high latency, order headers were created in Supabase but item network streams dropped.
- Subsequent retries caused PostgreSQL error `23505 (duplicate key violations)`, classified as a permanent `VALIDATION` failure, trapping jobs in `status: 'failed'`.
- Subsequent mutations referenced local `offline-xxx` IDs rather than server-assigned UUIDs, throwing `22P02`.
- `updateSyncIndicator()` only monitored `ADMIN_MUTATIONS` and lacked multi-queue aggregation.

---

## 4. Phase 0 Conclusion
The root causes across all four defects were verified against the live source code and mapped into concrete implementation plans.

