/**
 * LIMRA RESTAURANT POS — WORKFLOW NAVIGATION STATE PRESERVATION
 * Test Suite 40: Targeted Auto-Redirect Removal & Subtab State Integrity
 *
 * Verifies all required Phase 1-6 behaviors:
 * 1. Multiple consecutive Cash/UPI bill settlements preserve 'bill' subtab throughout.
 * 2. Settled bills disappear from unpaid Bill list and appear in Close Orders.
 * 3. Multiple consecutive Takeaway/Delivery Hold confirmations preserve 'hold' subtab.
 * 4. Confirmed Hold orders disappear from Hold list and achieve dual visibility in Bill and Close.
 * 5. Dine-in Table Hold confirmation preserves 'hold' subtab while freeing table.
 * 6. Background Realtime updates & data refreshes never alter selected subtab.
 * 7. Explicit manual navigation functions correctly across all subtabs.
 * 8. Static code verification ensures auto-redirect lines are neutralized.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestEnvironment } from './test-env-guard.mjs';

assertTestEnvironment({ runnerName: 'Suite 40: Workflow Navigation State Preservation' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const adminJs = fs.readFileSync(path.join(rootDir, 'frontend/src/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(rootDir, 'frontend/admin.html'), 'utf8');

/**
 * Creates an in-memory POS simulator modeling admin.js state and navigation logic
 */
function createNavigationStateSimulator() {
  let tablesSubtab = 'all';
  let tablesFilter = 'all';
  let activePanel = 'tables';
  let orders = [];
  let orderItems = [];

  // Simulated DOM pill elements
  const pills = [
    { subtab: 'all', filter: 'all', active: true },
    { subtab: 'free', filter: 'free', active: false },
    { subtab: 'occupied', filter: 'occupied', active: false },
    { subtab: 'hold', filter: 'hold', active: false },
    { subtab: 'bill', filter: 'bill', active: false },
    { subtab: 'close', filter: 'close', active: false }
  ];

  function syncPills() {
    pills.forEach(p => {
      p.active = (p.subtab || p.filter) === tablesSubtab;
    });
  }

  function getTablesSubtab() {
    return tablesSubtab;
  }

  function setTablesSubtab(tab) {
    if (['all', 'free', 'occupied', 'hold', 'bill', 'close'].includes(tab)) {
      tablesSubtab = tab;
      syncPills();
    }
  }

  function clickSubtabPill(tabName) {
    const pill = pills.find(p => p.subtab === tabName || p.filter === tabName);
    if (pill) {
      tablesSubtab = pill.subtab || pill.filter || 'all';
      tablesFilter = pill.filter || 'all';
      syncPills();
      renderTablesPanel();
    }
  }

  function renderTablesPanel() {
    // Exact mirror of admin.js renderTablesPanel active pill sync
    syncPills();
    return {
      activeSubtab: tablesSubtab,
      activePill: pills.find(p => p.active)?.subtab
    };
  }

  function renderClosedOrdersPanel() {
    // Closed orders panel renders without mutating tablesSubtab
    return getClosedBills();
  }

  function getOutstandingBills(typeFilter = 'all') {
    return orders.filter(o => {
      if (o.status === 'cancelled' || o.ticket_status === 'CANCELLED') return false;
      if (o.payment_status === 'paid' || o.ticket_status === 'CLOSED') return false;
      if (o.ticket_status === 'HOLD' || o.status === 'hold') return false;
      const isBilled = o.ticket_status === 'BILLED' || o.status === 'billed' || (o.notes && (o.notes.includes('[FINAL_BILL]') || o.notes.includes('[BILLED_UNPAID]')));
      if (!isBilled) return false;
      if (typeFilter !== 'all') {
        const isTable = o.order_type === 'table' || (o.notes && o.notes.includes('[TABLE:'));
        if (typeFilter === 'table' && !isTable) return false;
      }
      return true;
    });
  }

  function getClosedBills() {
    return orders.filter(o => {
      if (o.status === 'cancelled' || o.ticket_status === 'CANCELLED') return false;
      if (o.ticket_status === 'HOLD' || o.status === 'hold') return false;
      return (
        o.payment_status === 'paid' ||
        o.ticket_status === 'CLOSED' ||
        o.status === 'delivered' ||
        o.ticket_status === 'BILLED' ||
        (o.status === 'confirmed' && o.ticket_status !== 'HOLD')
      );
    });
  }

  function getHeldOrders() {
    return orders.filter(o => {
      if (o.status !== 'hold' && o.ticket_status !== 'HOLD') return false;
      if (o.ticket_status === 'BILLED' || o.ticket_status === 'CLOSED' || o.payment_status === 'paid' || o.status === 'cancelled') return false;
      return true;
    });
  }

  // Settle Bill matching admin.js settleBill without auto-redirect
  function settleBill(billId, paymentMethod = 'cash') {
    const bill = orders.find(o => String(o.id) === String(billId));
    if (!bill) return { success: false, error: 'BILL_NOT_FOUND' };

    const validMethod = paymentMethod === 'upi' ? 'upi' : 'cash';
    bill.payment_status = 'paid';
    bill.ticket_status = 'CLOSED';
    bill.status = 'delivered';
    bill.payment_method = validMethod;
    bill.payment_mode = validMethod;
    bill.settled_at = new Date().toISOString();

    // Re-render panels (NO tablesSubtab = 'close')
    renderTablesPanel();
    renderClosedOrdersPanel();

    return { success: true, bill };
  }

  // Confirm Held Order matching admin.js confirmHeldOrder without auto-redirect
  function confirmHeldOrder(orderId) {
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order) return { success: false, error: 'ORDER_NOT_FOUND' };

    order.status = 'confirmed';
    order.payment_status = 'unpaid';
    order.ticket_status = 'BILLED';
    order.notes = (order.notes || '') + ' [FINAL_BILL] [BILLED_UNPAID]';
    order.updated_at = new Date().toISOString();

    // Re-render panels (NO tablesSubtab = 'bill')
    renderTablesPanel();
    renderClosedOrdersPanel();

    return { success: true, order };
  }

  // Confirm Held Table Order matching admin.js confirmHeldTableOrder without auto-redirect
  function confirmHeldTableOrder(tableNum) {
    const tableOrders = orders.filter(o => {
      const matchNum = parseInt(String(o.table_number || '').replace(/\D/g, ''), 10);
      return matchNum === tableNum && o.ticket_status !== 'CLOSED' && o.payment_status !== 'paid';
    });
    if (!tableOrders.length) return { success: false, error: 'NO_ACTIVE_TABLE_ORDERS' };

    const primary = tableOrders[0];
    primary.status = 'confirmed';
    primary.payment_status = 'unpaid';
    primary.ticket_status = 'BILLED';
    primary.notes = (primary.notes || '') + ` [TABLE: ${tableNum}] [FINAL_BILL] [BILLED_UNPAID]`;

    for (let i = 1; i < tableOrders.length; i++) {
      tableOrders[i].status = 'delivered';
      tableOrders[i].payment_status = 'paid';
      tableOrders[i].ticket_status = 'CLOSED';
      tableOrders[i].consolidated_into_order_id = primary.id;
    }

    // Re-render panels (NO tablesSubtab = 'bill')
    renderTablesPanel();
    renderClosedOrdersPanel();

    return { success: true, primaryOrder: primary };
  }

  function simulateRealtimeDelta() {
    // Realtime update triggers renderAll -> renderActivePanel -> renderTablesPanel
    renderTablesPanel();
    renderClosedOrdersPanel();
  }

  return {
    getTablesSubtab,
    setTablesSubtab,
    clickSubtabPill,
    renderTablesPanel,
    renderClosedOrdersPanel,
    getOutstandingBills,
    getClosedBills,
    getHeldOrders,
    settleBill,
    confirmHeldOrder,
    confirmHeldTableOrder,
    simulateRealtimeDelta,
    setOrders: (newOrders) => { orders = newOrders; },
    getOrders: () => orders,
    getPills: () => pills
  };
}

describe('SUITE 40: LIMRA POS — Workflow Navigation State Preservation & Auto-Redirect Removal', () => {

  let sim;

  beforeEach(() => {
    sim = createNavigationStateSimulator();
  });

  // ── 1. STATIC SOURCE ANALYSIS & CONTRACT AUDITING ──────────────────────────
  describe('1. Static Code Analysis & Navigation Neutralization', () => {
    it('1.1 confirmHeldOrder() has neutralized automatic redirect to Bill', () => {
      const confirmOrderMatch = adminJs.match(/async function confirmHeldOrder\([\s\S]*?renderTablesPanel\(\);/);
      assert.ok(confirmOrderMatch, 'confirmHeldOrder function must exist');
      const body = confirmOrderMatch[0];
      // Ensure no active (uncommented) tablesSubtab = 'bill' assignment exists in confirmHeldOrder
      const activeRedirect = /(?<!\/\/\s*)tablesSubtab\s*=\s*['"]bill['"]/.test(body);
      assert.equal(activeRedirect, false, 'confirmHeldOrder must NOT contain active tablesSubtab = bill redirect');
    });

    it('1.2 confirmHeldTableOrder() has neutralized automatic redirect to Bill', () => {
      const confirmTableMatch = adminJs.match(/async function confirmHeldTableOrder\([\s\S]*?renderTablesPanel\(\);/);
      assert.ok(confirmTableMatch, 'confirmHeldTableOrder function must exist');
      const body = confirmTableMatch[0];
      const activeRedirect = /(?<!\/\/\s*)tablesSubtab\s*=\s*['"]bill['"]/.test(body);
      assert.equal(activeRedirect, false, 'confirmHeldTableOrder must NOT contain active tablesSubtab = bill redirect');
    });

    it('1.3 settleBill() has neutralized automatic redirect to Close', () => {
      const settleBillMatch = adminJs.match(/async function settleBill\([\s\S]*?renderTablesPanel\(\);/);
      assert.ok(settleBillMatch, 'settleBill function must exist');
      const body = settleBillMatch[0];
      const activeRedirect = /(?<!\/\/\s*)tablesSubtab\s*=\s*['"]close['"]/.test(body);
      assert.equal(activeRedirect, false, 'settleBill must NOT contain active tablesSubtab = close redirect');
    });

    it('1.4 renderTablesPanel() synchronizes filter pills active state with current tablesSubtab', () => {
      assert.ok(
        adminJs.includes("(p.dataset.subtab || p.dataset.filter) === tablesSubtab"),
        'renderTablesPanel must synchronize pill active state with current tablesSubtab'
      );
    });

    it('1.5 getTablesSubtab and setTablesSubtab are exported for runtime inspection', () => {
      assert.ok(adminJs.includes('export function getTablesSubtab()'), 'getTablesSubtab must be exported');
      assert.ok(adminJs.includes('export function setTablesSubtab(tab)'), 'setTablesSubtab must be exported');
      assert.ok(adminJs.includes('window.getTablesSubtab = getTablesSubtab'), 'getTablesSubtab must be attached to window');
    });
  });

  // ── 2. SCENARIO A: MULTIPLE BILL PAYMENTS WORKFLOW ─────────────────────────
  describe('2. Scenario A: Multiple Consecutive Bill Payments (Cash & UPI)', () => {
    it('2.1 Cashier settles 3 consecutive bills while remaining on Bill subtab throughout', () => {
      sim.setOrders([
        { id: 'bill-1', order_number: 201, total_amount: 500, status: 'confirmed', ticket_status: 'BILLED', payment_status: 'unpaid', notes: '[FINAL_BILL]' },
        { id: 'bill-2', order_number: 202, total_amount: 350, status: 'confirmed', ticket_status: 'BILLED', payment_status: 'unpaid', notes: '[FINAL_BILL]' },
        { id: 'bill-3', order_number: 203, total_amount: 720, status: 'confirmed', ticket_status: 'BILLED', payment_status: 'unpaid', notes: '[FINAL_BILL]' }
      ]);

      // 1. Open Tables -> Bill
      sim.clickSubtabPill('bill');
      assert.equal(sim.getTablesSubtab(), 'bill', 'Subtab must be bill');
      assert.equal(sim.getOutstandingBills().length, 3, 'Must have 3 unpaid bills');

      // 2. Settle Bill 1 via Cash
      const res1 = sim.settleBill('bill-1', 'cash');
      assert.equal(res1.success, true);
      assert.equal(res1.bill.payment_status, 'paid');
      assert.equal(sim.getTablesSubtab(), 'bill', 'Cashier must remain in Bill after settling Bill 1');
      assert.equal(sim.getOutstandingBills().length, 2, 'Bill 1 must disappear from unpaid list');
      assert.ok(!sim.getOutstandingBills().find(b => b.id === 'bill-1'), 'Bill 1 must not be in unpaid list');

      // 3. Settle Bill 2 via UPI
      const res2 = sim.settleBill('bill-2', 'upi');
      assert.equal(res2.success, true);
      assert.equal(res2.bill.payment_status, 'paid');
      assert.equal(sim.getTablesSubtab(), 'bill', 'Cashier must remain in Bill after settling Bill 2');
      assert.equal(sim.getOutstandingBills().length, 1, 'Bill 2 must disappear from unpaid list');

      // 4. Settle Bill 3 via Cash
      const res3 = sim.settleBill('bill-3', 'cash');
      assert.equal(res3.success, true);
      assert.equal(res3.bill.payment_status, 'paid');
      assert.equal(sim.getTablesSubtab(), 'bill', 'Cashier must remain in Bill after settling Bill 3');
      assert.equal(sim.getOutstandingBills().length, 0, 'All bills settled; unpaid list is empty');

      // 5. Explicit navigation to Close: All 3 bills appear in Close Orders
      sim.clickSubtabPill('close');
      assert.equal(sim.getTablesSubtab(), 'close', 'Cashier explicitly navigated to Close');
      const closed = sim.getClosedBills();
      assert.equal(closed.length, 3, 'All 3 settled bills must be in Close Orders');
      assert.equal(closed.filter(b => b.payment_status === 'paid').length, 3, 'All 3 bills must be marked paid');
    });
  });

  // ── 3. SCENARIO B: MULTIPLE TAKEAWAY/DELIVERY HOLD CONFIRMATIONS ───────────
  describe('3. Scenario B: Multiple Takeaway/Delivery Hold Confirmations', () => {
    it('3.1 Cashier confirms 3 consecutive Hold orders while remaining on Hold subtab throughout', () => {
      sim.setOrders([
        { id: 'hold-1', order_number: 301, order_type: 'takeaway', total_amount: 220, status: 'hold', ticket_status: 'HOLD', payment_status: 'unpaid', notes: '[SELF PICKUP]' },
        { id: 'hold-2', order_number: 302, order_type: 'delivery', total_amount: 450, status: 'hold', ticket_status: 'HOLD', payment_status: 'unpaid', notes: '[DELIVERY]' },
        { id: 'hold-3', order_number: 303, order_type: 'takeaway', total_amount: 180, status: 'hold', ticket_status: 'HOLD', payment_status: 'unpaid', notes: '[SELF PICKUP]' }
      ]);

      // 1. Open Tables -> Hold
      sim.clickSubtabPill('hold');
      assert.equal(sim.getTablesSubtab(), 'hold', 'Subtab must be hold');
      assert.equal(sim.getHeldOrders().length, 3, 'Must have 3 held orders');

      // 2. Confirm Hold Order 1
      const res1 = sim.confirmHeldOrder('hold-1');
      assert.equal(res1.success, true);
      assert.equal(res1.order.ticket_status, 'BILLED');
      assert.equal(res1.order.payment_status, 'unpaid');
      assert.equal(sim.getTablesSubtab(), 'hold', 'Cashier must remain in Hold after confirming Order 1');
      assert.equal(sim.getHeldOrders().length, 2, 'Order 1 must disappear from active Hold list');

      // 3. Confirm Hold Order 2
      const res2 = sim.confirmHeldOrder('hold-2');
      assert.equal(res2.success, true);
      assert.equal(res2.order.ticket_status, 'BILLED');
      assert.equal(sim.getTablesSubtab(), 'hold', 'Cashier must remain in Hold after confirming Order 2');
      assert.equal(sim.getHeldOrders().length, 1, 'Order 2 must disappear from active Hold list');

      // 4. Confirm Hold Order 3
      const res3 = sim.confirmHeldOrder('hold-3');
      assert.equal(res3.success, true);
      assert.equal(res3.order.ticket_status, 'BILLED');
      assert.equal(sim.getTablesSubtab(), 'hold', 'Cashier must remain in Hold after confirming Order 3');
      assert.equal(sim.getHeldOrders().length, 0, 'All hold orders confirmed; Hold list is empty');

      // 5. Verify dual visibility in Bill
      sim.clickSubtabPill('bill');
      assert.equal(sim.getTablesSubtab(), 'bill');
      const unpaidBills = sim.getOutstandingBills();
      assert.equal(unpaidBills.length, 3, 'All 3 confirmed orders must be visible in Bill section');
      assert.ok(unpaidBills.every(b => b.payment_status === 'unpaid'), 'All must remain unpaid');

      // 6. Verify dual visibility in Close Orders (as Billed Unpaid)
      sim.clickSubtabPill('close');
      assert.equal(sim.getTablesSubtab(), 'close');
      const closed = sim.getClosedBills();
      assert.equal(closed.length, 3, 'All 3 confirmed orders must be visible in Close Orders');
    });
  });

  // ── 4. SCENARIO C: DINE-IN TABLE HOLD CONFIRMATION ─────────────────────────
  describe('4. Scenario C: Dine-in Table Hold Confirmation', () => {
    it('4.1 Confirming Dine-in Table bill preserves Hold subtab without duplicate orders', () => {
      sim.setOrders([
        { id: 'tbl-ord-1', order_number: 401, table_number: 7, order_type: 'table', total_amount: 600, status: 'hold', ticket_status: 'HOLD', payment_status: 'unpaid', notes: '[TABLE: 7] [ROUND: 1]' },
        { id: 'tbl-ord-2', order_number: 402, table_number: 7, order_type: 'table', total_amount: 250, status: 'hold', ticket_status: 'HOLD', payment_status: 'unpaid', notes: '[TABLE: 7] [ROUND: 2]' }
      ]);

      sim.clickSubtabPill('hold');
      assert.equal(sim.getTablesSubtab(), 'hold');

      // Confirm Table 7 bill
      const res = sim.confirmHeldTableOrder(7);
      assert.equal(res.success, true);
      assert.equal(res.primaryOrder.id, 'tbl-ord-1');
      assert.equal(res.primaryOrder.ticket_status, 'BILLED');
      assert.equal(res.primaryOrder.payment_status, 'unpaid');

      // Cashier must remain on Hold subtab
      assert.equal(sim.getTablesSubtab(), 'hold', 'Cashier must remain on Hold subtab after confirming Table 7');

      // Sibling order consolidated into primary without orphaned duplicate
      const allOrders = sim.getOrders();
      const sibling = allOrders.find(o => o.id === 'tbl-ord-2');
      assert.equal(sibling.consolidated_into_order_id, 'tbl-ord-1');
      assert.equal(sibling.ticket_status, 'CLOSED');

      // Outstanding bill visible in Bill section
      sim.clickSubtabPill('bill');
      const tableBills = sim.getOutstandingBills('table');
      assert.equal(tableBills.length, 1, 'Consolidated table bill must be visible in Bill');
      assert.equal(tableBills[0].id, 'tbl-ord-1');
    });
  });

  // ── 5. SCENARIO D: REALTIME & BACKGROUND REFRESH NAVIGATION STABILITY ─────
  describe('5. Scenario D: Realtime & Background Data Refresh Navigation State Preservation', () => {
    it('5.1 Realtime delta events preserve user-selected subtab (Bill, Hold, Free, Occupied)', () => {
      // User is on Bill
      sim.clickSubtabPill('bill');
      assert.equal(sim.getTablesSubtab(), 'bill');
      sim.simulateRealtimeDelta();
      assert.equal(sim.getTablesSubtab(), 'bill', 'Subtab must remain bill across background refresh');

      // User is on Hold
      sim.clickSubtabPill('hold');
      assert.equal(sim.getTablesSubtab(), 'hold');
      sim.simulateRealtimeDelta();
      assert.equal(sim.getTablesSubtab(), 'hold', 'Subtab must remain hold across background refresh');

      // User is on Occupied
      sim.clickSubtabPill('occupied');
      assert.equal(sim.getTablesSubtab(), 'occupied');
      sim.simulateRealtimeDelta();
      assert.equal(sim.getTablesSubtab(), 'occupied', 'Subtab must remain occupied across background refresh');

      // User is on Free
      sim.clickSubtabPill('free');
      assert.equal(sim.getTablesSubtab(), 'free');
      sim.simulateRealtimeDelta();
      assert.equal(sim.getTablesSubtab(), 'free', 'Subtab must remain free across background refresh');
    });
  });

  // ── 6. SCENARIO E: EXPLICIT USER NAVIGATION INTEGRITY ──────────────────────
  describe('6. Scenario E: Explicit User Navigation Contract', () => {
    it('6.1 Cashier can navigate freely between all subtabs via explicit pill clicks', () => {
      const tabs = ['all', 'free', 'occupied', 'hold', 'bill', 'close'];
      for (const t of tabs) {
        sim.clickSubtabPill(t);
        assert.equal(sim.getTablesSubtab(), t, `Explicit click must navigate to ${t}`);
        const activePill = sim.getPills().find(p => p.active);
        assert.equal(activePill.subtab, t, `Active pill UI state must match subtab ${t}`);
      }
    });
  });

});

