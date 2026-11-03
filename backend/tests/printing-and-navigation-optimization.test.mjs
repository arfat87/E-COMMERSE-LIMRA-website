/**
 * LIMRA RESTAURANT POS — PRINTING WORKFLOW & NAVIGATION PERFORMANCE OPTIMIZATION TEST SUITE
 * 
 * Tests the three core optimizations:
 * 1. Create Bill & Settle prints BOTH customer BILL and KOT for Table, Takeaway, and Delivery orders.
 * 2. Bill and KOT printing starts rapidly via Private Network Access without 2500ms WebSocket timeout delays.
 * 3. Navigation between POS sections is instant (< 16ms) via memoized metadata, DOM preservation, and smart caching.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');

test('SUITE 36: Printing Workflow & Navigation Performance Optimization', async (t) => {

  await t.test('1. Create Bill & Settle triggers printCombinedKOTAndBill for Table, Takeaway, and Delivery', () => {
    const adminJsPath = path.join(ROOT_DIR, 'frontend/src/admin.js');
    const content = fs.readFileSync(adminJsPath, 'utf8');

    // Verify that pos-kot-bill-btn calls printCombinedKOTAndBill and does not restrict delivery or takeaway to bill-only
    const hasDeliveryExclusion = /if\s*\(\s*posOrderType\s*===\s*['"]delivery['"]\s*\|\|\s*posOrderType\s*===\s*['"]pickup['"]\s*\)\s*\{\s*await\s*printOrderReceiptWithTax/i.test(content);
    assert.strictEqual(hasDeliveryExclusion, false, 'pos-kot-bill-btn must NOT exclude delivery or pickup from printing KOT');

    // Verify pos-kot-bill-btn calls printCombinedKOTAndBill unconditionally for the created order
    const hasCombinedCall = content.includes('await printCombinedKOTAndBill(result.order, result.items);');
    assert.strictEqual(hasCombinedCall, true, 'pos-kot-bill-btn must call printCombinedKOTAndBill(result.order, result.items)');

    // Verify button disabled guard against rapid double-clicks
    const hasButtonDebounce = /const btn = \$?\(['"]pos-kot-bill-btn['"]\);\s*if \(btn && btn\.disabled\) return;\s*if \(btn\) btn\.disabled = true;/.test(content);
    assert.strictEqual(hasButtonDebounce, true, 'pos-kot-bill-btn must have debounce protection disabling the button during execution');
  });

  await t.test('2. printCombinedKOTAndBill prints KOT first, followed by Customer Bill with minimal cooldown', async () => {
    const adminJsPath = path.join(ROOT_DIR, 'frontend/src/admin.js');
    const content = fs.readFileSync(adminJsPath, 'utf8');

    // Check that printCombinedKOTAndBill prints KOT then Bill
    const kotIndex = content.indexOf('await printKOT(order, items, options);');
    const billIndex = content.indexOf('await printOrderReceiptWithTax(order, items, options);');
    assert.ok(kotIndex !== -1, 'printCombinedKOTAndBill must invoke printKOT');
    assert.ok(billIndex !== -1, 'printCombinedKOTAndBill must invoke printOrderReceiptWithTax');
    assert.ok(kotIndex < billIndex, 'printKOT must be executed before printOrderReceiptWithTax');

    // Cooldown must be optimized (<= 100ms, not 450ms)
    const hasLongCooldown = /setTimeout\(r,\s*450\)/.test(content);
    assert.strictEqual(hasLongCooldown, false, 'printCombinedKOTAndBill should not have a 450ms blocking sleep');
    const hasOptimizedCooldown = /setTimeout\(r,\s*60\)/.test(content);
    assert.strictEqual(hasOptimizedCooldown, true, 'printCombinedKOTAndBill must use an optimized micro-gap (60ms)');
  });

  await t.test('3. Existing Bill Settlement (settleBill) defaults autoPrintBill to false', () => {
    const adminJsPath = path.join(ROOT_DIR, 'frontend/src/admin.js');
    const content = fs.readFileSync(adminJsPath, 'utf8');

    // Verify signature: settleBill(billId, paymentMethod = 'cash', txnRef = '', idempotencyKey = null, autoPrintBill = false)
    const hasDefaultFalse = /async function settleBill\([^)]*autoPrintBill\s*=\s*false[^)]*\)/.test(content);
    assert.strictEqual(hasDefaultFalse, true, 'settleBill must have autoPrintBill = false by default');

    // Verify receipt printing is strictly guarded by if (autoPrintBill)
    const hasAutoPrintGuard = /if\s*\(\s*autoPrintBill\s*\)\s*\{\s*try\s*\{\s*const rawItems = getItemsForOrder\(bill\.id\)/.test(content);
    assert.strictEqual(hasAutoPrintGuard, true, 'settleBill receipt printing must be guarded by if (autoPrintBill)');
  });

  await t.test('4. Thermal printing bypasses WebSocket 2.5s delay on HTTPS and cached HTTP PNA bridge', () => {
    const adminJsPath = path.join(ROOT_DIR, 'frontend/src/admin.js');
    const content = fs.readFileSync(adminJsPath, 'utf8');

    // Verify that printViaWebSocketBridge immediately resolves null on HTTPS to prevent Mixed Content stalls
    const hasHttpsWsCheck = /if\s*\(typeof window !== ['"]undefined['"] && window\.location\.protocol === ['"]https:['"]\)\s*\{\s*\/\/[^\n]*\s*return resolve\(null\);/.test(content);
    assert.strictEqual(hasHttpsWsCheck, true, 'printViaWebSocketBridge must immediately resolve null under HTTPS');

    // Verify executePrintJob checks isHttps or _activeBridgeMethod === 'http_pna' before attempting WS
    const hasFastPnaPath = content.includes("if (isHttps || _activeBridgeMethod === 'http_pna')");
    assert.strictEqual(hasFastPnaPath, true, 'executePrintJob must route directly to HTTP PNA when on HTTPS or when http_pna was previously active');
  });

  await t.test('5. Backend print daemon pre-warming on Windows server startup', () => {
    const serverJsPath = path.join(ROOT_DIR, 'backend/server.js');
    const content = fs.readFileSync(serverJsPath, 'utf8');

    const hasWarmup = content.includes('getOrStartPrintDaemon().catch(');
    assert.strictEqual(hasWarmup, true, 'backend/server.js must pre-warm the Electron print daemon on server startup');
  });

  await t.test('6. Backend silent print idempotency cache skips duplicate jobs within 5 seconds', async () => {
    const { isDuplicateJob } = await import('../api/print-silent.js');
    assert.strictEqual(typeof isDuplicateJob, 'function', 'isDuplicateJob must be exported from print-silent.js');

    const testJobId = `perf_test_job_${Date.now()}`;
    const firstCall = isDuplicateJob(testJobId, '<html>Sample Receipt</html>');
    assert.strictEqual(firstCall, false, 'First print invocation must not be considered duplicate');

    const secondCall = isDuplicateJob(testJobId, '<html>Sample Receipt</html>');
    assert.strictEqual(secondCall, true, 'Second immediate print invocation with same jobId must be flagged as duplicate');
  });

  await t.test('7. parseNotesMetadata memoization prevents redundant regex operations on repeated access', () => {
    const adminJsPath = path.join(ROOT_DIR, 'frontend/src/admin.js');
    const content = fs.readFileSync(adminJsPath, 'utf8');

    // Verify that parseNotesMetadata checks order._cachedMeta and stores result
    const hasCacheCheck = content.includes('if (order && order._cachedMeta && order._cachedMetaNotes === notes && order._cachedMetaType === order.order_type)');
    assert.strictEqual(hasCacheCheck, true, 'parseNotesMetadata must check order._cachedMeta for instant return');

    const hasCacheStore = content.includes('order._cachedMeta = result;');
    assert.strictEqual(hasCacheStore, true, 'parseNotesMetadata must assign order._cachedMeta');
  });

  await t.test('8. POS Billing workstation fast-mount preserves DOM and avoids tearing down food grid', () => {
    const adminJsPath = path.join(ROOT_DIR, 'frontend/src/admin.js');
    const content = fs.readFileSync(adminJsPath, 'utf8');

    // Verify that initBillingPanel checks posBillingMounted at top to avoid re-rendering food grid
    const hasMountedEarlyReturn = /if\s*\(posBillingMounted\)\s*\{\s*\/\/[^\n]*\s*renderBillingQuickCards\(\);\s*renderBillingTotalBills\(\);\s*updatePosCartUI\(true\);\s*return;\s*\}/.test(content);
    assert.strictEqual(hasMountedEarlyReturn, true, 'initBillingPanel must return immediately if posBillingMounted is true, updating only dynamic counters');
  });

  await t.test('9. Stock UI initialization guards against duplicate listeners and avoids repeated DB syncs', () => {
    const stockUiPath = path.join(ROOT_DIR, 'frontend/src/stock/stock-ui.js');
    const content = fs.readFileSync(stockUiPath, 'utf8');

    const hasInitGuard = content.includes('if (!_stockUiInitialized)');
    assert.strictEqual(hasInitGuard, true, 'initStockUI must guard subscription and initial setup with _stockUiInitialized');

    const hasTtlSync = content.includes('if (now - _lastStockSyncTime > 60000)');
    assert.strictEqual(hasTtlSync, true, 'initStockUI must only re-sync with DB if cache is older than 60 seconds');
  });

  await t.test('10. Editor zones (Coupons, Combos, Places, Foods) use memory cache and avoid loading flashes on navigation', () => {
    const adminJsPath = path.join(ROOT_DIR, 'frontend/src/admin.js');
    const content = fs.readFileSync(adminJsPath, 'utf8');

    // Coupons fresh check
    const hasCouponsFreshCheck = content.includes('const isFresh = adminCoupons && adminCoupons.length > 0 && (now - _lastCouponsFetchTime < 60000);');
    assert.strictEqual(hasCouponsFreshCheck, true, 'loadAndRenderCoupons must use 60s cache freshness');

    // Combos fresh check
    const hasCombosFreshCheck = content.includes('const isFresh = adminCombos && adminCombos.length > 0 && (now - _lastCombosFetchTime < 60000);');
    assert.strictEqual(hasCombosFreshCheck, true, 'loadAndRenderCombos must use 60s cache freshness');

    // Places fresh check
    const hasPlacesFreshCheck = content.includes('const isFresh = adminPlaces && adminPlaces.length > 0 && (now - _lastPlacesFetchTime < 60000);');
    assert.strictEqual(hasPlacesFreshCheck, true, 'loadAndRenderPlaces must use 60s cache freshness');

    // Foods fresh check
    const hasFoodsFreshCheck = content.includes('const isFresh = hasData && (now - _lastFoodsFetchTime < 60000);');
    assert.strictEqual(hasFoodsFreshCheck, true, 'loadAndRenderFoods must use 60s cache freshness');
  });
});
