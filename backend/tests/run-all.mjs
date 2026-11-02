/**
 * LIMRA RESTAURANT — MASTER TEST RUNNER
 * 
 * Runs the entire test suite across all subsystems:
 * 1. Stock FIFO Engine & Inventory Accounting
 * 2. API Security & RBAC Enforcement
 * 3. Payment Gateway HMAC Security & Signatures
 * 4. Transaction Integrity, Idempotency & Concurrency
 * 5. Table Sessions & Notification Deduplication
 * 6. Thermal Printing, KOT Sequencing & Printer Queue
 * 7. Offline-First IndexedDB Sync & Network Resiliency
 * 8. Billing, Item-Level GST & State Transitions
 * 9. Supabase Egress, Caching & Performance
 * 10. Deployment, Multi-Platform Builds & Operational Reliability
 * 11. Settings Interface & Hub Integrity
 * 12. Close Orders Historical Queries & Pagination
 * 13. Held Orders Cash/UPI Payment Selection & Settlement
 * 14. GST Date-Range Filtering & Report Compliance
 * 15. Table Management, Deferred Bill & Settle Workflow
 * 16. Unified Bill Management & Deferred Payment System
 * 17. Testing Security & Database Isolation
 * 18. Notification System Optimization & Strict Event Filtering
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTestEnvironment } from "./test-env-guard.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../");

// -----------------------------------------------------------------------------
// STEP 0: MANDATORY TESTING SECURITY & PRODUCTION ENVIRONMENT ASSERTION
// -----------------------------------------------------------------------------
assertTestEnvironment({ runnerName: "Master Test Runner (run-all.mjs)" });

console.log("\n========================================================");
console.log("   🍽️  LIMRA RESTAURANT — COMPREHENSIVE TEST SUITE");
console.log("========================================================\n");

const TEST_STEPS = [
  { name: "1. FIFO Inventory Accounting Engine", cmd: "node frontend/src/stock/stock-engine.test.mjs" },
  { name: "2. Security & RBAC Enforcement", cmd: "node backend/tests/security.test.mjs" },
  { name: "3. Razorpay Payment Security & Signatures", cmd: "node backend/tests/payment-security.test.mjs" },
  { name: "4. Transaction Integrity & Idempotency", cmd: "node backend/tests/transaction-integrity.test.mjs" },
  { name: "5. Table Session Lifecycle & Notifications", cmd: "node backend/tests/table-session.test.mjs" },
  { name: "6. Thermal Printing & KOT Sequencing", cmd: "node backend/tests/thermal-printing.test.mjs" },
  { name: "7. Offline-First Sync & IndexedDB Resilience", cmd: "node backend/tests/offline-sync.test.mjs" },
  { name: "8. Billing, GST Math & State Integrity", cmd: "node backend/tests/billing-and-state-integrity.test.mjs" },
  { name: "9. Egress Optimization & Cache Performance", cmd: "node backend/tests/egress-and-performance.test.mjs" },
  { name: "10. Deployment & Operational Reliability", cmd: "node backend/tests/deployment-and-reliability.test.mjs" },
  { name: "11. Settings Interface & Hub Integrity", cmd: "node backend/tests/settings-interface.test.mjs" },
  { name: "12. Close Orders Historical Queries & Pagination", cmd: "node backend/tests/close-orders-historical.test.mjs" },
  { name: "13. Held Orders Cash/UPI Payment Selection & Settlement", cmd: "node backend/tests/hold-orders-payment.test.mjs" },
  { name: "14. GST Date-Range Filtering & Report Compliance", cmd: "node backend/tests/gst-date-filtering.test.mjs" },
  { name: "15. Table Management, Deferred Bill & Settle Workflow", cmd: "node backend/tests/table-management-deferred-bill.test.mjs" },
  { name: "16. Unified Bill Management & Deferred Payment System", cmd: "node backend/tests/unified-bill-management.test.mjs" },
  { name: "17. Testing Security & Database Isolation", cmd: "node backend/tests/testing-security.test.mjs" },
  { name: "18. Notification System Optimization & Strict Event Filtering", cmd: "node backend/tests/notification-system.test.mjs" },
  { name: "19. Table, Bill, Close, Occupied & Status Lifecycle", cmd: "node backend/tests/table-bill-close-occupied.test.mjs" },
  { name: "20. Scoped order_items Polling & Active-Panel Rendering (Task 1.1)", cmd: "node backend/tests/order-items-polling-and-rendering.test.mjs" },
  { name: "21. Table Cancellation, Atomic Settlement & F1 Hotkey (Task 1.2)", cmd: "node backend/tests/task-1-2-cancel-settle-f1.test.mjs" },
  { name: "22. Auditable Closed-Order Void & Amendment (Task 1.3)", cmd: "node backend/tests/task-1-3-void-amend-closed-orders.test.mjs" },
  { name: "23. POS Cart Space, Popovers, Compact Tiles & Order Detail Drawer (Task 2.1)", cmd: "node backend/tests/task-2-1-pos-cart-and-drawer.test.mjs" },
  { name: "24. POS Combos, Promo Coupons & Customer Autocomplete (Task 2.2)", cmd: "node backend/tests/task-2-2-combos-coupons-customer-autocomplete.test.mjs" },
  { name: "25. Table Transfer, Table Swap & Three-State Floor Plan (Task 2.3)", cmd: "node backend/tests/task-2-3-table-transfer-swap-floor-plan.test.mjs" },
  { name: "26. Sidebar Navigation Redesign & Persistent Header (Task 3.1)", cmd: "node --test backend/tests/task-3-1-sidebar-navigation-header.test.mjs" },
  { name: "27. Unified Design System Tokens & Touch Ergonomics (Task 3.2)", cmd: "node --test backend/tests/task-3-2-design-system-tokens.test.mjs" },
  { name: "28. Kitchen Display System Upgrade & Batch Production Tally (Task 4.1)", cmd: "node --test backend/tests/task-4-1-kds-upgrade.test.mjs" },
  { name: "29. Database-Backed Staff RBAC & Permissions (Task 4.2)", cmd: "node --test backend/tests/task-4-2-staff-rbac.test.mjs" },
  { name: "30. Safe Removal of Legacy Stock Manager (Task 4.3)", cmd: "node --test backend/tests/task-4-3-stock-manager-purge.test.mjs" },
  { name: "31. Normalized Financial & Order Lifecycle Data (Task 5.1)", cmd: "node --test backend/tests/task-5-1-normalize-financial-orders.test.mjs" },
  { name: "32. Reliable Offline Mutation Queuing for POS (Task 5.2)", cmd: "node --test backend/tests/task-5-2-offline-mutation-queue.test.mjs" },
  { name: "33. Domain ES Modules Architecture for POS Frontend (Task 6.1)", cmd: "node --test backend/tests/task-6-1-modular-pos-architecture.test.mjs" },
  { name: "34. Complete Menu Management — Edit, Delete, Optimization & Immutability", cmd: "node --test test/menu-management.test.js" },
  { name: "35. Universal Direct Silent Thermal Printing (TVS 3200)", cmd: "node --test backend/tests/thermal-silent-printing.test.mjs" }
];

let allPassed = true;
const summary = [];

for (const step of TEST_STEPS) {
  console.log(`\n▶ Running ${step.name}...`);
  try {
    execSync(step.cmd, {
      cwd: ROOT_DIR,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test",
        LIMRA_TEST_ENV: "true"
      }
    });
    summary.push({ name: step.name, status: "PASSED" });
  } catch (err) {
    console.error(`❌ Suite Failed: ${step.name}`);
    summary.push({ name: step.name, status: "FAILED" });
    allPassed = false;
    break;
  }
}

console.log("\n========================================================");
console.log("           OVERALL TEST SUITE SUMMARY                   ");
console.log("========================================================");
for (const s of summary) {
  const icon = s.status === "PASSED" ? "✅" : "❌";
  console.log(`${icon} ${s.name}: ${s.status}`);
}
console.log("========================================================\n");

if (!allPassed) {
  process.exit(1);
} else {
  console.log("🎉 ALL LIMRA RESTAURANT TEST SUITES PASSED CLEANLY!\n");
}
