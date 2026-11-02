/**
 * =============================================================================
 * TASK 6.1 AUTOMATED VERIFICATION SUITE
 * Test Suite 33: Domain ES Modules Architecture for POS Frontend
 * =============================================================================
 * 
 * Verifies:
 * 1. Directory and file structure of all 10 domain modules under frontend/src/pos/
 * 2. Central PosStateStore & O(1) normalized orders/items index
 * 3. Type-safe PosEventBus pub/sub decoupled messaging
 * 4. Audio alerts, chime synthesis, and toast deduplication
 * 5. KDS ticket rendering, production tally, and bump bar recall
 * 6. Thermal printer settings and ESC/POS / visual receipt templates
 * 7. GST reporting, date presets, and SAC 996331 compliant CSV export
 * 8. Catalog CRM, combo deals, coupons validation, and customer autocomplete
 * 9. Settings staff RBAC permissions hierarchy and duty status toggling
 * 10. Workstation cart operations, line item totals, and popovers
 * 11. Tables floor plan, transfer/swap notes audit tags, and bill categorization
 * 12. Admin.js facade and window.posDomain exposure
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const POS_DIR = path.join(ROOT_DIR, 'frontend/src/pos');
const ADMIN_JS_PATH = path.join(ROOT_DIR, 'frontend/src/admin.js');

describe('TASK 6.1: MODULARIZE FRONTEND/SRC/ADMIN.JS INTO DOMAIN ES MODULES', () => {

  // Mock DOM / Storage for browser-environment modules
  const originalLocalStorage = globalThis.localStorage;
  const mockStorage = new Map();

  before(() => {
    globalThis.localStorage = {
      getItem: (k) => mockStorage.get(k) ?? null,
      setItem: (k, v) => mockStorage.set(k, String(v)),
      removeItem: (k) => mockStorage.delete(k),
      clear: () => mockStorage.clear()
    };
  });

  after(() => {
    globalThis.localStorage = originalLocalStorage;
  });

  test('1. Structure: All 10 domain modules exist in frontend/src/pos/ with valid ES module syntax', () => {
    const requiredModules = [
      'state.js',
      'pos-utils.js',
      'audio-alerts.js',
      'kds.js',
      'thermal-printer.js',
      'reports-gst.js',
      'catalog-crm.js',
      'settings-staff.js',
      'workstation.js',
      'tables-billing.js'
    ];

    for (const mod of requiredModules) {
      const fullPath = path.join(POS_DIR, mod);
      assert.ok(fs.existsSync(fullPath), `Module missing: frontend/src/pos/${mod}`);
      const content = fs.readFileSync(fullPath, 'utf8');
      assert.ok(content.includes('export '), `Module frontend/src/pos/${mod} must contain ES module exports`);
    }
  });

  test('2. State: PosStateStore provides O(1) indexed lookups and PosEventBus triggers listeners', async () => {
    const { posState, posEvents } = await import('../../frontend/src/pos/state.js');

    const sampleOrders = [
      { id: 'ord-101', total_amount: 550, status: 'confirmed' },
      { id: 'ord-102', total_amount: 320, status: 'pending' }
    ];

    const sampleItems = [
      { id: 'item-1', order_id: 'ord-101', item_name: 'Chicken Biryani', quantity: 2, unit_price: 200 },
      { id: 'item-2', order_id: 'ord-101', item_name: 'Butter Naan', quantity: 3, unit_price: 50 },
      { id: 'item-3', order_id: 'ord-102', item_name: 'Paneer Butter Masala', quantity: 1, unit_price: 320 }
    ];

    posState.setOrders(sampleOrders);
    posState.setOrderItems(sampleItems);

    // O(1) Map Lookups
    const o1 = posState.getOrderById('ord-101');
    assert.strictEqual(o1?.total_amount, 550);
    assert.strictEqual(posState.getOrderById('non-existent'), null);

    const items101 = posState.getOrderItemsByOrderId('ord-101');
    assert.strictEqual(items101.length, 2);
    assert.strictEqual(items101[0].item_name, 'Chicken Biryani');

    // Event Bus Pub/Sub
    let eventReceived = null;
    const unsub = posEvents.on('test:event', (data) => {
      eventReceived = data;
    });

    posEvents.emit('test:event', { foo: 'bar' });
    assert.deepStrictEqual(eventReceived, { foo: 'bar' });

    // Clean unregister
    unsub();
    posEvents.emit('test:event', { foo: 'baz' });
    assert.deepStrictEqual(eventReceived, { foo: 'bar' }); // did not update
  });

  test('3. Audio Alerts: Synthesizes acoustic chimes and enforces deduplication', async () => {
    const {
      generateTableRoundChimeWavUri,
      notifiedBusinessOrderIds,
      cashierCreatedOrderIds,
      isVoiceAnnouncementEnabled,
      setVoiceAnnouncementEnabled
    } = await import('../../frontend/src/pos/audio-alerts.js');

    // WAV URI generator produces valid data URI
    const wavUri = generateTableRoundChimeWavUri();
    assert.ok(wavUri.startsWith('data:audio/wav;base64,'), 'Table round chime must be a valid base64 audio URI');

    // Voice announcement state toggle
    setVoiceAnnouncementEnabled(false);
    assert.strictEqual(isVoiceAnnouncementEnabled(), false);
    setVoiceAnnouncementEnabled(true);
    assert.strictEqual(isVoiceAnnouncementEnabled(), true);

    // Order deduplication sets
    notifiedBusinessOrderIds.add('ord-dedup-1');
    cashierCreatedOrderIds.add('ord-dedup-2');
    assert.ok(notifiedBusinessOrderIds.has('ord-dedup-1'));
    assert.ok(cashierCreatedOrderIds.has('ord-dedup-2'));
  });

  test('4. Pos Utils: Pure functions consolidate items and parse metadata', async () => {
    const {
      escapeHtml,
      consolidateOrderItems,
      formatDailyOrderNumber,
      parseNotesMetadata
    } = await import('../../frontend/src/pos/pos-utils.js');

    // String escape
    assert.strictEqual(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');

    // Consolidate identical items
    const rawItems = [
      { item_name: 'Biryani', unit_price: 200, quantity: 2, line_total: 400 },
      { item_name: 'Biryani', unit_price: 200, quantity: 1, line_total: 200 },
      { item_name: 'Naan', unit_price: 40, quantity: 2, line_total: 80 }
    ];
    const consolidated = consolidateOrderItems(rawItems);
    assert.strictEqual(consolidated.length, 2);
    const biryani = consolidated.find(i => i.item_name === 'Biryani');
    assert.strictEqual(biryani.quantity, 3);
    assert.strictEqual(biryani.line_total, 600);

    // Format daily order number
    assert.strictEqual(formatDailyOrderNumber({ order_number: 7 }), '0007');
    assert.strictEqual(formatDailyOrderNumber({ id: 'uuid-12345' }), '2345');

    // Notes metadata extraction
    const notes = '[TABLE: Table 5] [DELIVERY_FEE: 40] [DISCOUNT_PCT: 10%] Special packaging';
    const meta = parseNotesMetadata(notes);
    assert.ok(meta.tableNumber.includes('5'));
    assert.strictEqual(meta.deliveryFee, 40);
    assert.strictEqual(meta.discountPct, 10);
  });

  test('5. KDS: Manages item checkoff state and production tally metrics', async () => {
    const {
      getKitchenCheckedItems,
      saveKitchenCheckedItems,
      isKitchenItemChecked,
      toggleKitchenItemCheckoff,
      kdsBumpHistory
    } = await import('../../frontend/src/pos/kds.js');

    mockStorage.clear();
    assert.deepStrictEqual(getKitchenCheckedItems(), {});

    saveKitchenCheckedItems({ 'ord-1': { 0: true } });
    assert.strictEqual(isKitchenItemChecked('ord-1', 0), true);
    assert.strictEqual(isKitchenItemChecked('ord-1', 1), false);

    // Toggle checkoff
    const newState = toggleKitchenItemCheckoff('ord-1', 1);
    assert.strictEqual(newState, true);
    assert.strictEqual(isKitchenItemChecked('ord-1', 1), true);

    // Bump history stack
    kdsBumpHistory.length = 0;
    kdsBumpHistory.push({ orderId: 'ord-kds-1', previousStatus: 'preparing' });
    assert.strictEqual(kdsBumpHistory.length, 1);
    const lastBump = kdsBumpHistory.pop();
    assert.strictEqual(lastBump.orderId, 'ord-kds-1');
  });

  test('6. Thermal Printer: Loads settings and generates valid receipt/KOT HTML', async () => {
    const {
      getPrinterSettings,
      generateReceiptHtml,
      generateKOTHtml
    } = await import('../../frontend/src/pos/thermal-printer.js');

    const s = getPrinterSettings();
    assert.ok(typeof s.bill_paper_width === 'number' || typeof s.bill_paper_width === 'string');
    assert.strictEqual(s.auto_cut_bill, true);

    const sampleOrder = {
      id: 'ord-prn-1',
      order_number: 42,
      created_at: new Date('2026-10-31T18:00:00Z').toISOString(),
      order_type: 'table',
      table_number: 4,
      total_amount: 525,
      taxable_amount: 500,
      cgst_amount: 12.5,
      sgst_amount: 12.5,
      payment_method: 'cash',
      payment_status: 'paid'
    };

    const sampleItems = [
      { item_name: 'Mutton Kebab', quantity: 2, unit_price: 250, line_total: 500 }
    ];

    const receiptHtml = generateReceiptHtml(sampleOrder, sampleItems, s);
    assert.ok(receiptHtml.includes('LIMRA RESTAURANT'), 'Receipt must contain restaurant name');
    assert.ok(receiptHtml.includes('Mutton Kebab'), 'Receipt must contain dish name');
    assert.ok(receiptHtml.includes('525.00'), 'Receipt must contain grand total');

    const kotHtml = await generateKOTHtml(sampleOrder, sampleItems, s, { isAddon: false, roundIndex: 1 });
    assert.ok(kotHtml.includes('KITCHEN ORDER TICKET (KOT)'), 'KOT must have header');
    assert.ok(kotHtml.includes('Table 4'), 'KOT must display table number');
  });

  test('7. Reports & GST: Computes date bounds, filters orders, and formats CSV', async () => {
    const {
      getGstDateRangeBounds,
      formatGstDateLabel,
      exportMonthlyGSTFilingCSV
    } = await import('../../frontend/src/pos/reports-gst.js');

    // Preset date bounds
    const boundsToday = getGstDateRangeBounds('today');
    assert.ok(boundsToday.startDate instanceof Date);
    assert.ok(boundsToday.endDate instanceof Date);
    assert.ok(boundsToday.label.includes('Today'));

    const boundsMonth = getGstDateRangeBounds('this_month');
    assert.ok(boundsMonth.startDate instanceof Date);
    assert.strictEqual(boundsMonth.startDate.getDate(), 1);

    // Label format
    const label = formatGstDateLabel(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-31T23:59:59Z'));
    assert.ok(label.includes('2026'), 'Label must format range year');

    // CSV generator
    const sampleOrders = [
      {
        id: 'ord-gst-1',
        created_at: '2026-10-15T12:00:00Z',
        order_number: 101,
        total_amount: 210,
        taxable_amount: 200,
        cgst_amount: 5,
        sgst_amount: 5,
        order_type: 'table',
        table_number: 2,
        payment_method: 'cash',
        payment_status: 'paid'
      }
    ];

    const csv = await exportMonthlyGSTFilingCSV({ orders: sampleOrders });
    assert.ok(csv.includes('SAC Code'), 'CSV must contain SAC Code header');
    assert.ok(csv.includes('996331'), 'CSV must contain restaurant SAC code 996331');
    assert.ok(csv.includes('TOTALS'), 'CSV must contain totals summary row');
  });

  test('8. Catalog CRM: Validates combos, coupons, and debounced customer autocomplete', async () => {
    const {
      isComboActiveAndValid,
      validatePosCoupon,
      lookupPosCustomers,
      exportCustomersCSV
    } = await import('../../frontend/src/pos/catalog-crm.js');

    // Combo validity
    const validCombo = { id: 1, name: 'Biryani Deal', price: 299, available: true, active: true };
    assert.strictEqual(isComboActiveAndValid(validCombo), true);

    const expiredCombo = { id: 2, name: 'Past Deal', price: 199, available: true, active: true, expiry_date: '2020-01-01' };
    assert.strictEqual(isComboActiveAndValid(expiredCombo), false);

    // Coupon validation
    const coupons = [
      { code: 'DISC10', active: true, discount_pct: 10, min_bill: 200, expiry_date: '2030-12-31' },
      { code: 'EXP50', active: true, discount_pct: 50, min_bill: 100, expiry_date: '2020-01-01' }
    ];

    const validCheck = validatePosCoupon('DISC10', 300, '9876543210', { coupons });
    assert.strictEqual(validCheck.valid, true);
    assert.strictEqual(validCheck.discountPct, 10);
    assert.strictEqual(validCheck.discountAmount, 30);

    const expiredCheck = validatePosCoupon('EXP50', 300, '9876543210', { coupons });
    assert.strictEqual(expiredCheck.valid, false);
    assert.strictEqual(expiredCheck.reason, 'EXPIRED');

    const minBillCheck = validatePosCoupon('DISC10', 100, '9876543210', { coupons });
    assert.strictEqual(minBillCheck.valid, false);
    assert.strictEqual(minBillCheck.reason, 'MIN_BILL_NOT_MET');

    // Customer Autocomplete with Data Minimization
    const mockCustomers = [
      { phone: '9876543210', name: 'Salim Khan', orderCount: 5, totalSpent: 3000, lastAddress: 'Main St', lastPlace: 'Egra', tier: 'silver' },
      { phone: '9123456789', name: 'Rahul Sharma', orderCount: 1, totalSpent: 200, lastAddress: '', lastPlace: '', tier: 'new' }
    ];

    const results = lookupPosCustomers('9876', { customersList: mockCustomers });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'Salim Khan');
    assert.strictEqual(results[0].phone, '9876543210');
    assert.strictEqual(results[0].totalSpent, undefined, 'Must minimize data: totalSpent excluded from POS autocomplete');

    // CSV export
    const csv = exportCustomersCSV(mockCustomers);
    assert.ok(csv.includes('Salim Khan'));
    assert.ok(csv.includes('9876543210'));
  });

  test('9. Settings Staff RBAC: Normalizes roles and enforces workspace permissions matrix', async () => {
    const {
      ROLE_WORKSPACE_PERMISSIONS,
      normalizeStaffRole,
      hasStaffPermission,
      DEFAULT_STAFF_MEMBERS
    } = await import('../../frontend/src/pos/settings-staff.js');

    // Canonical role normalization
    assert.strictEqual(normalizeStaffRole('Store Manager'), 'manager');
    assert.strictEqual(normalizeStaffRole('Head Chef / Cook'), 'kitchen');
    assert.strictEqual(normalizeStaffRole('Service Waiter'), 'waiter');
    assert.strictEqual(normalizeStaffRole('POS Cashier'), 'cashier');
    assert.strictEqual(normalizeStaffRole('Super Owner'), 'owner');
    assert.strictEqual(normalizeStaffRole(null), 'cashier');

    // RBAC Hierarchy & Permissions
    assert.strictEqual(hasStaffPermission('settings', 'owner'), true);
    assert.strictEqual(hasStaffPermission('settings', 'manager'), true);
    assert.strictEqual(hasStaffPermission('settings', 'cashier'), false);
    assert.strictEqual(hasStaffPermission('orders', 'cashier'), true);
    assert.strictEqual(hasStaffPermission('kitchen', 'kitchen'), true);
    assert.strictEqual(hasStaffPermission('tables', 'kitchen'), false);

    assert.ok(Array.isArray(DEFAULT_STAFF_MEMBERS));
    assert.strictEqual(DEFAULT_STAFF_MEMBERS.length, 5);
  });

  test('10. Workstation: Manages cart line items and computes exact billing summary', async () => {
    const {
      computePosCartSummary,
      addToPosCart,
      updatePosCartQuantity,
      removeFromPosCart,
      clearPosCart
    } = await import('../../frontend/src/pos/workstation.js');
    const { posState } = await import('../../frontend/src/pos/state.js');

    posState.clearPosCart();
    addToPosCart({ id: 10, name: 'Butter Chicken', price: 300, qty: 1 });
    addToPosCart({ id: 11, name: 'Garlic Naan', price: 50, qty: 2 });

    const cart = posState.getPosCart();
    assert.strictEqual(cart.length, 2);
    assert.strictEqual(cart[0].name, 'Butter Chicken');
    assert.strictEqual(cart[1].qty, 2);

    // Update quantity
    updatePosCartQuantity(1, 1); // Naan: 2 + 1 = 3
    assert.strictEqual(posState.getPosCart()[1].qty, 3);

    // Billing summary calculation
    const summary = computePosCartSummary(posState.getPosCart(), {
      discountPct: 10,
      deliveryFee: 40,
      cgstRate: 2.5,
      sgstRate: 2.5
    });

    // Subtotal: 300 + (50 * 3) = 450
    // Discount 10%: 45 -> Taxable: 405
    // CGST 2.5%: 10.13, SGST 2.5%: 10.13 -> Tax: 20.26
    // Delivery: 40 -> Total before round: 405 + 20.26 + 40 = 465.26 -> Round to 465
    assert.strictEqual(summary.subtotal, 450);
    assert.strictEqual(summary.discountAmt, 45);
    assert.strictEqual(summary.taxableValue, 405);
    assert.strictEqual(summary.deliveryFee, 40);
    assert.strictEqual(summary.grandTotal, 465);

    // Remove & clear
    removeFromPosCart(0);
    assert.strictEqual(posState.getPosCart().length, 1);
    clearPosCart();
    assert.strictEqual(posState.getPosCart().length, 0);
  });

  test('11. Tables Billing: Appends transfer/swap audit tags and filters outstanding/closed bills', async () => {
    const {
      getTotalTablesCount,
      updateNotesTableNumber,
      getOutstandingBills,
      getClosedBills
    } = await import('../../frontend/src/pos/tables-billing.js');

    // Total tables default
    assert.strictEqual(getTotalTablesCount(), 19);

    // Transfer and swap audit notes
    const transferNote = updateNotesTableNumber('[TABLE: Table 2] Extra spicy', 5, 2, 'Cashier Aman', false);
    assert.ok(transferNote.includes('[TABLE: Table 5]'));
    assert.ok(!transferNote.includes('[TABLE: Table 2]'));
    assert.ok(transferNote.includes('[TRANSFERRED_FROM_TABLE_2_BY_Cashier Aman]'));

    const swapNote = updateNotesTableNumber('[TABLE: Table 3] Less oil', 8, 3, 'Rohit', true);
    assert.ok(swapNote.includes('[TABLE: Table 8]'));
    assert.ok(swapNote.includes('[SWAPPED_FROM_TABLE_3_BY_Rohit]'));

    // Outstanding vs Closed bills filtering
    const orders = [
      { id: 'b-1', order_type: 'table', ticket_status: 'BILLED', payment_status: 'unpaid' },
      { id: 'b-2', order_type: 'table', ticket_status: 'CLOSED', payment_status: 'paid' },
      { id: 'b-3', order_type: 'table', status: 'cancelled', ticket_status: 'CANCELLED' }
    ];

    const outstanding = getOutstandingBills('table', orders);
    assert.strictEqual(outstanding.length, 1);
    assert.strictEqual(outstanding[0].id, 'b-1');

    const closed = getClosedBills('table', orders);
    assert.strictEqual(closed.length, 1);
    assert.strictEqual(closed[0].id, 'b-2');
  });

  test('12. Facade Integration: admin.js re-exports domain modules and registers window.posDomain', () => {
    const adminJs = fs.readFileSync(ADMIN_JS_PATH, 'utf8');

    // Re-exports check
    assert.ok(adminJs.includes('posState,'), 'admin.js must re-export posState');
    assert.ok(adminJs.includes('posEvents,'), 'admin.js must re-export posEvents');
    assert.ok(adminJs.includes('posDomainKds,'), 'admin.js must re-export posDomainKds');
    assert.ok(adminJs.includes('posDomainReportsGst,'), 'admin.js must re-export posDomainReportsGst');
    assert.ok(adminJs.includes('posDomainPrinter,'), 'admin.js must re-export posDomainPrinter');
    assert.ok(adminJs.includes('posDomainCatalogCrm,'), 'admin.js must re-export posDomainCatalogCrm');
    assert.ok(adminJs.includes('posDomainSettingsStaff,'), 'admin.js must re-export posDomainSettingsStaff');
    assert.ok(adminJs.includes('posDomainWorkstation,'), 'admin.js must re-export posDomainWorkstation');
    assert.ok(adminJs.includes('posDomainTablesBilling,'), 'admin.js must re-export posDomainTablesBilling');

    // Global window exposure for debugging & backwards compatibility
    assert.ok(adminJs.includes('window.posDomain = {'), 'admin.js must expose window.posDomain');
    assert.ok(adminJs.includes('window.posState = posState;'), 'admin.js must expose window.posState');
    assert.ok(adminJs.includes('window.posEvents = posEvents;'), 'admin.js must expose window.posEvents');
  });

});
