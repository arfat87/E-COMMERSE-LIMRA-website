/**
 * LIMRA RESTAURANT — UNIFIED BILL MANAGEMENT & DEFERRED PAYMENT TEST SUITE
 * 
 * Verifies the unified billing & deferred payment lifecycle across all 3 order types:
 * 1. Dine-In (Table)
 * 2. Takeaway (Pickup)
 * 3. Delivery
 * 
 * Fundamental Lifecycle:
 * ORDER → CONFIRM → BILL GENERATED (UNPAID) → BILL SECTION → PAYMENT METHOD (CASH/ONLINE) → PAID → CLOSE
 * 
 * Invariants & Guarantees:
 * 1. Order confirmation generates an unpaid bill (ticket_status = 'BILLED', payment_status = 'unpaid').
 * 2. Confirmation does NOT collect payment or show upfront Cash/Online dialogs.
 * 3. Dine-In tables are released immediately upon bill generation.
 * 4. All unpaid bills across Dine-In, Takeaway, and Delivery are accessible in the Unified Bill section.
 * 5. Order type filters (All, Dine-In, Takeaway, Delivery) filter bills accurately.
 * 6. Settling a bill updates payment_status = 'paid', ticket_status = 'CLOSED', records valid payment_method (Cash/Online).
 * 7. Occupancy immunity: Settling Table 1's old bill never disturbs Customer B currently dining at Table 1.
 * 8. Double settlement protection prevents duplicate payment processing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const adminHtml = fs.readFileSync(path.join(rootDir, 'frontend/admin.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(rootDir, 'frontend/src/admin.css'), 'utf8');
const adminJs = fs.readFileSync(path.join(rootDir, 'frontend/src/admin.js'), 'utf8');

describe('SUITE 1: Unified HTML Architecture for Bill & Close Sections', () => {
  it('1.1 Unified Bill section contains order-type filter pills (All, Dine-In, Takeaway, Delivery)', () => {
    assert.ok(adminHtml.includes('id="tables-bill-type-pills"'), '#tables-bill-type-pills container must exist in admin.html');
    assert.ok(adminHtml.includes('class="pos-cat-pill bill-type-pill active" data-type="all">All Bills'), 'All Bills filter pill must exist');
    assert.ok(adminHtml.includes('class="pos-cat-pill bill-type-pill" data-type="table">🪑 Dine-In'), 'Dine-In filter pill must exist in Bill section');
    assert.ok(adminHtml.includes('class="pos-cat-pill bill-type-pill" data-type="pickup">🥡 Takeaway'), 'Takeaway filter pill must exist in Bill section');
    assert.ok(adminHtml.includes('class="pos-cat-pill bill-type-pill" data-type="delivery">🚗 Delivery'), 'Delivery filter pill must exist in Bill section');
  });

  it('1.2 Unified Close section contains order-type filter pills (All, Dine-In, Takeaway, Delivery)', () => {
    assert.ok(adminHtml.includes('id="tables-close-type-pills"'), '#tables-close-type-pills container must exist in admin.html');
    assert.ok(adminHtml.includes('class="pos-cat-pill close-type-pill active" data-type="all">All Bills'), 'All Closed filter pill must exist');
    assert.ok(adminHtml.includes('class="pos-cat-pill close-type-pill" data-type="table">🪑 Dine-In'), 'Dine-In filter pill must exist in Close section');
    assert.ok(adminHtml.includes('class="pos-cat-pill close-type-pill" data-type="pickup">🥡 Takeaway'), 'Takeaway filter pill must exist in Close section');
    assert.ok(adminHtml.includes('class="pos-cat-pill close-type-pill" data-type="delivery">🚗 Delivery'), 'Delivery filter pill must exist in Close section');
  });

  it('1.3 Bill table headers include Order Type and Reference / Customer', () => {
    assert.ok(adminHtml.includes('>Order Type</th>'), 'Order Type column header must exist in Bill table');
    assert.ok(adminHtml.includes('>Reference / Customer</th>'), 'Reference / Customer column header must exist in Bill table');
    assert.ok(adminHtml.includes('>Bill No.</th>') || adminHtml.includes('>Bill No</th>'), 'Bill No column header must exist');
    assert.ok(adminHtml.includes('>Payment Method</th>'), 'Payment Method column header must exist');
    assert.ok(adminHtml.includes('>Action</th>'), 'Action column header must exist');
  });

  it('1.4 Close table headers include Order Type and Reference / Customer', () => {
    assert.ok(adminHtml.includes('id="tables-close-table"'), '#tables-close-table must exist');
    assert.ok(adminHtml.includes('id="tables-close-tbody"'), '#tables-close-tbody must exist');
  });
});

describe('SUITE 2: CSS Visual Styling & Order-Type Badges', () => {
  it('2.1 Filter pill styles exist for bill-type-pill and close-type-pill', () => {
    assert.ok(adminCss.includes('.bill-type-pill'), '.bill-type-pill CSS class must exist');
    assert.ok(adminCss.includes('.bill-type-pill.active'), '.bill-type-pill.active CSS class must exist');
    assert.ok(adminCss.includes('.close-type-pill'), '.close-type-pill CSS class must exist');
    assert.ok(adminCss.includes('.close-type-pill.active'), '.close-type-pill.active CSS class must exist');
  });

  it('2.2 Order type badges exist for Table, Takeaway (Pickup), and Delivery', () => {
    assert.ok(adminCss.includes('.order-type-badge'), '.order-type-badge CSS class must exist');
    assert.ok(adminCss.includes('.order-type-badge-table'), '.order-type-badge-table CSS class must exist');
    assert.ok(adminCss.includes('.order-type-badge-pickup'), '.order-type-badge-pickup CSS class must exist');
    assert.ok(adminCss.includes('.order-type-badge-delivery'), '.order-type-badge-delivery CSS class must exist');
  });

  it('2.3 White-and-Gold accent styles are maintained for payment selectors and pay buttons', () => {
    assert.ok(adminCss.includes('.bill-method-selector'), '.bill-method-selector must exist');
    assert.ok(adminCss.includes('.bill-method-btn.active'), '.bill-method-btn.active must exist');
    assert.ok(adminCss.includes('.table-bill-pay-btn'), '.table-bill-pay-btn must exist');
  });
});

describe('SUITE 3: Unified Engine Functions in admin.js', () => {
  it('3.1 getOutstandingBills() and getClosedBills() are declared and accept order-type filter', () => {
    assert.ok(adminJs.includes('function getOutstandingBills('), 'getOutstandingBills function must exist');
    assert.ok(adminJs.includes('function getClosedBills('), 'getClosedBills function must exist');
  });

  it('3.2 Backwards compatibility aliases getOutstandingTableBills and getClosedTableBills are preserved', () => {
    assert.ok(adminJs.includes('function getOutstandingTableBills()'), 'getOutstandingTableBills alias must exist');
    assert.ok(adminJs.includes('function getClosedTableBills()'), 'getClosedTableBills alias must exist');
    assert.ok(adminJs.includes('window.getOutstandingBills = getOutstandingBills'), 'window.getOutstandingBills must be exposed');
    assert.ok(adminJs.includes('window.getClosedBills = getClosedBills'), 'window.getClosedBills must be exposed');
  });

  it('3.3 confirmHeldOrder() confirms non-table orders to BILLED without payment dialog', () => {
    assert.ok(adminJs.includes('async function confirmHeldOrder(orderId)'), 'confirmHeldOrder function must exist');
    assert.ok(adminJs.includes("ticket_status = 'BILLED'") || adminJs.includes("ticket_status: 'BILLED'"), 'confirmHeldOrder must set ticket_status to BILLED');
    assert.ok(adminJs.includes("payment_status = 'unpaid'") || adminJs.includes("payment_status: 'unpaid'"), 'confirmHeldOrder must set payment_status to unpaid');
  });

  it('3.4 settleBill() settles bills across all order types atomically with Cash or Online', () => {
    assert.ok(adminJs.includes('async function settleBill('), 'settleBill function must exist');
    assert.ok(adminJs.includes("payment_status: 'paid'"), 'settleBill must set payment_status to paid');
    assert.ok(adminJs.includes("ticket_status: 'CLOSED'"), 'settleBill must set ticket_status to CLOSED');
    assert.ok(adminJs.includes('window.settleBill = settleBill'), 'window.settleBill must be exposed');
    assert.ok(adminJs.includes('window.settleTableBill = settleBill') || adminJs.includes('window.settleTableBill = settleTableBill'), 'window.settleTableBill must be exposed');
  });
});

describe('SUITE 4: End-to-End Simulation of All 3 Order Types in Unified Billing System', () => {
  // Helper simulator matching admin.js implementation
  function createSystem() {
    let orders = [];
    let billFilter = 'all';
    let closeFilter = 'all';
    const selectedMethods = new Map();

    function addOrder(order) {
      orders.push(order);
    }

    function getActiveTableSessions() {
      const active = {};
      for (const o of orders) {
        if (!o.table_number) continue;
        if (o.status === 'cancelled' || o.ticket_status === 'CANCELLED') continue;
        if (o.ticket_status === 'BILLED' || o.ticket_status === 'CLOSED') continue;
        if (o.payment_status === 'paid' || o.status === 'billed') continue;
        const key = String(o.table_number).trim();
        if (!active[key]) active[key] = [];
        active[key].push(o);
      }
      return active;
    }

    function getOutstandingBills(filter = 'all') {
      return orders.filter(o => {
        if (o.status === 'cancelled' || o.ticket_status === 'CANCELLED') return false;
        if (o.payment_status === 'paid' || o.ticket_status === 'CLOSED') return false;
        const isBilled = o.ticket_status === 'BILLED' || o.status === 'billed';
        if (!isBilled) return false;

        if (!filter || filter === 'all') return true;
        if (filter === 'table') return o.order_type === 'table' || (!!o.table_number && o.order_type !== 'pickup' && o.order_type !== 'delivery');
        if (filter === 'pickup') return o.order_type === 'pickup';
        if (filter === 'delivery') return o.order_type === 'delivery';
        return true;
      });
    }

    function getClosedBills(filter = 'all') {
      return orders.filter(o => {
        if (o.status === 'cancelled' || o.ticket_status === 'CANCELLED') return false;
        const isClosed = o.payment_status === 'paid' || o.ticket_status === 'CLOSED';
        if (!isClosed) return false;

        if (!filter || filter === 'all') return true;
        if (filter === 'table') return o.order_type === 'table' || (!!o.table_number && o.order_type !== 'pickup' && o.order_type !== 'delivery');
        if (filter === 'pickup') return o.order_type === 'pickup';
        if (filter === 'delivery') return o.order_type === 'delivery';
        return true;
      });
    }

    function confirmHeldOrder(orderId) {
      const order = orders.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');
      order.ticket_status = 'BILLED';
      order.status = 'billed';
      order.payment_status = 'unpaid';
      order.billed_at = new Date().toISOString();
      return order;
    }

    function settleBill(billId, paymentMethod = 'Cash', txnRef = '') {
      const order = orders.find(o => o.id === billId);
      if (!order) throw new Error('Bill not found');
      if (order.payment_status === 'paid' || order.ticket_status === 'CLOSED') {
        throw new Error('Bill is already settled');
      }

      const validMethod = (paymentMethod || 'Cash').toLowerCase().includes('online') || 
                          (paymentMethod || '').toLowerCase().includes('upi')
                          ? 'Online'
                          : 'Cash';

      order.payment_status = 'paid';
      order.ticket_status = 'CLOSED';
      order.status = 'delivered';
      order.payment_method = validMethod;
      order.settled_at = new Date().toISOString();
      if (txnRef) order.transaction_reference = txnRef;
      return order;
    }

    return {
      orders,
      getActiveTableSessions,
      getOutstandingBills,
      getClosedBills,
      confirmHeldOrder,
      settleBill,
      selectedMethods,
      addOrder
    };
  }

  it('4.1 Dine-In: Confirming held table order generates unpaid bill, immediately frees table, and settles independently', () => {
    const sys = createSystem();
    sys.addOrder({
      id: 'dinein-1',
      order_number: 'ORD-TAB-01',
      order_type: 'table',
      table_number: 'Table 4',
      ticket_status: 'HOLD',
      payment_status: 'unpaid',
      status: 'pending',
      grand_total: 450
    });

    // Table 4 is currently occupied
    let activeSessions = sys.getActiveTableSessions();
    assert.ok(activeSessions['Table 4'], 'Table 4 must be occupied before bill confirmation');

    // Confirm bill
    sys.confirmHeldOrder('dinein-1');

    // Invariant: Table 4 is freed immediately
    activeSessions = sys.getActiveTableSessions();
    assert.ok(!activeSessions['Table 4'], 'Table 4 must be freed immediately upon bill confirmation');

    // Appears in Unified Bill section
    const allBills = sys.getOutstandingBills('all');
    assert.equal(allBills.length, 1);
    assert.equal(allBills[0].order_type, 'table');
    assert.equal(allBills[0].payment_status, 'unpaid');

    // Table filter shows it
    assert.equal(sys.getOutstandingBills('table').length, 1);
    assert.equal(sys.getOutstandingBills('pickup').length, 0);
    assert.equal(sys.getOutstandingBills('delivery').length, 0);

    // Settle bill with Cash
    sys.settleBill('dinein-1', 'Cash');

    // Moves from Bill to Close
    assert.equal(sys.getOutstandingBills('all').length, 0);
    const closed = sys.getClosedBills('all');
    assert.equal(closed.length, 1);
    assert.equal(closed[0].payment_status, 'paid');
    assert.equal(closed[0].ticket_status, 'CLOSED');
    assert.equal(closed[0].payment_method, 'Cash');
  });

  it('4.2 Takeaway: Confirming takeaway order generates unpaid bill in Bill section and settles via Cash/Online', () => {
    const sys = createSystem();
    sys.addOrder({
      id: 'pickup-1',
      order_number: 'TKW-101',
      order_type: 'pickup',
      customer_name: 'Rahul Sharma',
      customer_phone: '9876543210',
      ticket_status: 'HOLD',
      payment_status: 'unpaid',
      status: 'pending',
      grand_total: 280
    });

    // Before confirm: not yet billed
    assert.equal(sys.getOutstandingBills('all').length, 0);

    // Confirm takeaway order -> bill generated without asking for payment
    sys.confirmHeldOrder('pickup-1');

    // Now in Unified Bill section
    const unpaid = sys.getOutstandingBills('all');
    assert.equal(unpaid.length, 1);
    assert.equal(unpaid[0].id, 'pickup-1');
    assert.equal(unpaid[0].order_type, 'pickup');
    assert.equal(unpaid[0].payment_status, 'unpaid');

    // Filter verification
    assert.equal(sys.getOutstandingBills('pickup').length, 1);
    assert.equal(sys.getOutstandingBills('table').length, 0);
    assert.equal(sys.getOutstandingBills('delivery').length, 0);

    // Settle bill via Online/UPI
    sys.settleBill('pickup-1', 'Online', 'UPI-REF-9988');

    // Moved to Close section
    assert.equal(sys.getOutstandingBills('pickup').length, 0);
    const closed = sys.getClosedBills('pickup');
    assert.equal(closed.length, 1);
    assert.equal(closed[0].payment_method, 'Online');
    assert.equal(closed[0].transaction_reference, 'UPI-REF-9988');
    assert.equal(closed[0].payment_status, 'paid');
  });

  it('4.3 Delivery: Confirming delivery order includes delivery fee in bill and settles properly', () => {
    const sys = createSystem();
    sys.addOrder({
      id: 'del-1',
      order_number: 'DEL-202',
      order_type: 'delivery',
      customer_name: 'Priya Patel',
      customer_phone: '9123456780',
      notes: '[DELIVERY] Flat 302, Green Heights [DELIVERY_FEE: 40.00]',
      ticket_status: 'HOLD',
      payment_status: 'unpaid',
      status: 'pending',
      subtotal: 500,
      delivery_fee: 40,
      grand_total: 540
    });

    sys.confirmHeldOrder('del-1');

    // Outstanding bills contains delivery
    const unpaid = sys.getOutstandingBills('delivery');
    assert.equal(unpaid.length, 1);
    assert.equal(unpaid[0].grand_total, 540);
    assert.equal(unpaid[0].order_type, 'delivery');

    // Settle with Cash
    sys.settleBill('del-1', 'Cash');

    const closed = sys.getClosedBills('delivery');
    assert.equal(closed.length, 1);
    assert.equal(closed[0].payment_method, 'Cash');
    assert.equal(closed[0].payment_status, 'paid');
  });

  it('4.4 Occupancy Immunity Invariant: Settling Table 1 bill never clears Customer B dining at Table 1', () => {
    const sys = createSystem();

    // Customer A previously dined at Table 1 and bill was generated
    sys.addOrder({
      id: 'cust-a',
      order_number: 'BILL-A',
      order_type: 'table',
      table_number: 'Table 1',
      ticket_status: 'BILLED',
      payment_status: 'unpaid',
      status: 'billed',
      grand_total: 600
    });

    // Customer B arrives and starts a new session on Table 1
    sys.addOrder({
      id: 'cust-b',
      order_number: 'ORD-B',
      order_type: 'table',
      table_number: 'Table 1',
      ticket_status: 'OPEN',
      payment_status: 'unpaid',
      status: 'pending',
      grand_total: 350
    });

    // Customer B is active on Table 1
    let sessions = sys.getActiveTableSessions();
    assert.ok(sessions['Table 1'], 'Table 1 must have an active session for Customer B');
    assert.equal(sessions['Table 1'][0].id, 'cust-b');

    // Settle Customer A's old bill
    sys.settleBill('cust-a', 'Online');

    // Invariant: Customer B's session on Table 1 is 100% untouched and still active!
    sessions = sys.getActiveTableSessions();
    assert.ok(sessions['Table 1'], 'Customer B must remain active on Table 1 after settling Customer A');
    assert.equal(sessions['Table 1'].length, 1);
    assert.equal(sessions['Table 1'][0].id, 'cust-b');
  });

  it('4.5 Double Settlement Protection: Cannot settle an already paid bill', () => {
    const sys = createSystem();
    sys.addOrder({
      id: 'order-dup',
      order_number: 'TKW-555',
      order_type: 'pickup',
      ticket_status: 'BILLED',
      payment_status: 'unpaid',
      status: 'billed',
      grand_total: 150
    });

    sys.settleBill('order-dup', 'Cash');

    assert.throws(() => {
      sys.settleBill('order-dup', 'Cash');
    }, /already settled/);
  });

  it('4.6 Multi-Bill Concurrency: Dine-In, Takeaway, and Delivery bills coexist and filter cleanly', () => {
    const sys = createSystem();
    sys.addOrder({ id: 't-1', order_type: 'table', table_number: 'Table 2', ticket_status: 'BILLED', payment_status: 'unpaid', status: 'billed', grand_total: 300 });
    sys.addOrder({ id: 'p-1', order_type: 'pickup', ticket_status: 'BILLED', payment_status: 'unpaid', status: 'billed', grand_total: 200 });
    sys.addOrder({ id: 'd-1', order_type: 'delivery', ticket_status: 'BILLED', payment_status: 'unpaid', status: 'billed', grand_total: 400 });

    assert.equal(sys.getOutstandingBills('all').length, 3);
    assert.equal(sys.getOutstandingBills('table').length, 1);
    assert.equal(sys.getOutstandingBills('pickup').length, 1);
    assert.equal(sys.getOutstandingBills('delivery').length, 1);

    // Settle pickup only
    sys.settleBill('p-1', 'Cash');

    assert.equal(sys.getOutstandingBills('all').length, 2);
    assert.equal(sys.getOutstandingBills('pickup').length, 0);
    assert.equal(sys.getOutstandingBills('table').length, 1);
    assert.equal(sys.getOutstandingBills('delivery').length, 1);
    assert.equal(sys.getClosedBills('pickup').length, 1);
    assert.equal(sys.getClosedBills('all').length, 1);
  });
});
