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
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../");

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
  { name: "10. Deployment & Operational Reliability", cmd: "node backend/tests/deployment-and-reliability.test.mjs" }
];

let allPassed = true;
const summary = [];

for (const step of TEST_STEPS) {
  console.log(`\n▶ Running ${step.name}...`);
  try {
    execSync(step.cmd, { cwd: ROOT_DIR, stdio: "inherit" });
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
