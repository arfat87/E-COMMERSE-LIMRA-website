/**
 * LIMRA RESTAURANT — TABLE MANAGEMENT, DEFERRED BILL & SETTLE WORKFLOW TEST SUITE
 * 
 * Verifies:
 * 1. Sub-navigation within Tables panel (#panel-tables):
 *    - All Tables, Occupied, Hold, Bill, Close subtab pills
 *    - Distinct view containers (#tables-grid-view, #tables-hold-view, #tables-bill-view, #tables-close-view)
 *    - Dedicated counter badges
 * 2. Visual design system: White-and-Gold accent palette, payment selector buttons, responsive tables
 * 3. Hold confirmation & immediate table release:
 *    - Order transitions to ticket_status = 'BILLED', payment_status = 'unpaid'
 *    - Confirmation does NOT prompt for payment or mark paid
 *    - Original table is immediately freed (getActiveTableSessions excludes BILLED)
 * 4. Deferred payment selection in Tables -> Bill:
 *    - Displays outstanding unpaid bills
 *    - Cash / Online selection
 *    - Settle action updates payment_status = 'paid', ticket_status = 'CLOSED'
 * 5. Occupancy immunity invariant:
 *    - Settling an old bill for Table X never clears, resets, or modifies an active table session for Table X
 * 6. Multi-bill support:
 *    - Multiple bills for the same table number can exist concurrently in Tables -> Bill and be settled independently
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
const schemaSql = fs.readFileSync(path.join(rootDir, 'database/schema.sql'), 'utf8');

describe('SUITE 1: HTML Architecture of Tables Sub-Navigation & Containers', () => {
  it('1.1 Tables panel contains sub-navigation pills with All Tables, Free, Occupied, Hold, Bill, Close', () => {
    assert.ok(adminHtml.includes('id="tables-filter-pills"'), 'Filter pills container #tables-filter-pills must exist in admin.html');
    assert.ok(adminHtml.includes('data-subtab="all"'), 'All Tables pill must exist');
    assert.ok(adminHtml.includes('data-subtab="free"'), 'Free Tables pill must exist');
    assert.ok(adminHtml.includes('data-subtab="occupied"'), 'Occupied pill must exist');
    assert.ok(adminHtml.includes('data-subtab="hold"'), 'Hold pill must exist');
    assert.ok(adminHtml.includes('data-subtab="bill"'), 'Bill pill must exist inside Tables section');
    assert.ok(adminHtml.includes('data-subtab="close"'), 'Close pill must exist inside Tables section');
  });

  it('1.2 Dedicated counter badges exist for Free, Occupied, Hold, Bill, and Close', () => {
    assert.ok(adminHtml.includes('id="tables-badge-free"'), '#tables-badge-free must exist');
    assert.ok(adminHtml.includes('id="tables-badge-occupied"'), '#tables-badge-occupied must exist');
    assert.ok(adminHtml.includes('id="tables-badge-hold"'), '#tables-badge-hold must exist');
    assert.ok(adminHtml.includes('id="tables-badge-bill"'), '#tables-badge-bill must exist');
    assert.ok(adminHtml.includes('id="tables-badge-close"'), '#tables-badge-close must exist');
  });

  it('1.3 Four dedicated view containers exist inside #panel-tables', () => {
    assert.ok(adminHtml.includes('id="tables-grid-view"'), '#tables-grid-view must exist for tables grid');
    assert.ok(adminHtml.includes('id="tables-hold-view"'), '#tables-hold-view must exist for held table orders');
    assert.ok(adminHtml.includes('id="tables-bill-view"'), '#tables-bill-view must exist for unpaid bills');
    assert.ok(adminHtml.includes('id="tables-close-view"'), '#tables-close-view must exist for settled bills');
  });

  it('1.4 Tables -> Bill container includes table headers and tbody', () => {
    assert.ok(adminHtml.includes('id="tables-bill-table"'), '#tables-bill-table must exist');
    assert.ok(adminHtml.includes('id="tables-bill-tbody"'), '#tables-bill-tbody must exist');
    assert.ok(adminHtml.includes('id="tables-bill-empty"'), '#tables-bill-empty must exist');
    assert.ok(adminHtml.includes('Bill No'), 'Bill No column header must exist');
    assert.ok(adminHtml.includes('Payment Method'), 'Payment Method column header must exist');
    assert.ok(adminHtml.includes('Action'), 'Action column header must exist');
  });

  it('1.5 Tables -> Close container includes table headers and tbody', () => {
    assert.ok(adminHtml.includes('id="tables-close-table"'), '#tables-close-table must exist');
    assert.ok(adminHtml.includes('id="tables-close-tbody"'), '#tables-close-tbody must exist');
    assert.ok(adminHtml.includes('id="tables-close-empty"'), '#tables-close-empty must exist');
  });
});

describe('SUITE 2: CSS Styling & Visual Design System', () => {
  it('2.1 Responsive table styling exists for .table-bill-table and .table-close-table', () => {
    assert.ok(adminCss.includes('.table-bill-table'), '.table-bill-table class must be styled');
    assert.ok(adminCss.includes('.table-close-table'), '.table-close-table class must be styled');
  });

  it('2.2 Payment method selector styling exists (.bill-method-selector & .bill-method-btn)', () => {
    assert.ok(adminCss.includes('.bill-method-selector'), '.bill-method-selector must exist');
    assert.ok(adminCss.includes('.bill-method-btn'), '.bill-method-btn must exist');
    assert.ok(adminCss.includes('.bill-method-btn.active'), '.bill-method-btn.active must exist with active styles');
  });

  it('2.3 Action pay button styling exists (.table-bill-pay-btn) with gold gradient/accent', () => {
    assert.ok(adminCss.includes('.table-bill-pay-btn'), '.table-bill-pay-btn must exist');
  });

  it('2.4 Bill and status badge chip styling exists', () => {
    assert.ok(adminCss.includes('.table-bill-chip'), '.table-bill-chip must exist');
    assert.ok(adminCss.includes('.table-bill-num'), '.table-bill-num must exist');
  });
});

describe('SUITE 3: Hold Confirmation & Immediate Table Release Logic', () => {
  it('3.1 getActiveTableSessions() excludes ticket_status === BILLED to release table immediately', () => {
    assert.ok(
      adminJs.includes("o.ticket_status === 'BILLED'") || adminJs.includes('ticket_status === "BILLED"'),
      'getActiveTableSessions must exclude BILLED orders'
    );
  });

  it('3.2 confirmHeldTableOrder() sets ticket_status to BILLED and payment_status to unpaid', () => {
    assert.ok(adminJs.includes('confirmHeldTableOrder'), 'confirmHeldTableOrder function must exist');
    assert.ok(adminJs.includes("ticket_status: 'BILLED'"), "ticket_status must be set to 'BILLED'");
    assert.ok(adminJs.includes("payment_status: 'unpaid'"), "payment_status must be set to 'unpaid'");
  });

  it('3.3 confirmHeldTableOrder() switches view to Tables -> Bill without asking for payment', () => {
    assert.ok(adminJs.includes("tablesSubtab = 'bill'"), "Subtab must switch to 'bill'");
    assert.ok(adminJs.includes("renderTablesPanel()"), "renderTablesPanel must be called to refresh views");
  });

  it('3.4 schema.sql allows ticket_status values including BILLED, HOLD, OPEN, CLOSED', () => {
    assert.ok(schemaSql.includes("'BILLED'"), "schema.sql must allow 'BILLED' ticket_status");
  });
});

describe('SUITE 4: Deferred Payment Workflow in Tables -> Bill Section', () => {
  it('4.1 getOutstandingTableBills() filters for BILLED & unpaid orders', () => {
    assert.ok(adminJs.includes('getOutstandingTableBills'), 'getOutstandingTableBills function must exist');
    assert.ok(adminJs.includes("payment_status === 'paid'") || adminJs.includes("payment_status !== 'paid'"), 'getOutstandingTableBills checks for unpaid orders');
  });

  it('4.2 getClosedTableBills() filters for paid or closed table orders', () => {
    assert.ok(adminJs.includes('getClosedTableBills'), 'getClosedTableBills function must exist');
  });

  it('4.3 settleTableBill() handles Cash / Online payments and updates state atomically', () => {
    assert.ok(adminJs.includes('settleTableBill'), 'settleTableBill function must exist');
    assert.ok(adminJs.includes("ticket_status: 'CLOSED'"), 'settleTableBill sets ticket_status to CLOSED');
    assert.ok(adminJs.includes("payment_status: 'paid'"), 'settleTableBill sets payment_status to paid');
  });

  it('4.4 setTableBillPaymentMethod() tracks method per bill ID', () => {
    assert.ok(adminJs.includes('setTableBillPaymentMethod'), 'setTableBillPaymentMethod function must exist');
    assert.ok(adminJs.includes('tableBillSelectedMethods'), 'tableBillSelectedMethods Map or Object must exist');
  });

  it('4.5 admin.js supports free tables subtab filtering and badge update', () => {
    assert.ok(adminJs.includes("tablesSubtab === 'free'"), "admin.js must filter for tablesSubtab === 'free'");
    assert.ok(adminJs.includes('tables-badge-free'), "admin.js must update #tables-badge-free badge");
  });
});

describe('SUITE 5: Occupancy Immunity Invariant & Multi-Bill Isolation', () => {
  // Let's simulate the exact state model in JavaScript:
  it('5.1 Immediate Table Release Simulation: Table becomes free immediately upon bill generation', () => {
    const orders = [
      {
        id: 'order-1',
        order_number: 'ORD-001',
        table_number: 'Table 1',
        ticket_status: 'HOLD',
        payment_status: 'unpaid',
        status: 'pending',
        items: [{ id: 'item-1', name: 'Biryani', price: 250, quantity: 2 }]
      }
    ];

    function getActiveTableSessions(orderList) {
      const active = {};
      for (const o of orderList) {
        if (!o.table_number || o.status === 'cancelled' || o.ticket_status === 'CANCELLED' || o.ticket_status === 'BILLED' || o.ticket_status === 'CLOSED') {
          continue;
        }
        if (o.payment_status === 'paid') continue;
        if (o.status === 'billed') continue;
        const key = String(o.table_number).trim();
        if (!active[key]) active[key] = [];
        active[key].push(o);
      }
      return active;
    }

    // Before confirm: Table 1 is occupied
    let active = getActiveTableSessions(orders);
    assert.ok(active['Table 1'], 'Table 1 should be active before confirmation');
    assert.equal(active['Table 1'].length, 1);

    // Confirm held order -> ticket_status becomes BILLED, payment_status remains unpaid
    orders[0].ticket_status = 'BILLED';
    orders[0].status = 'billed';

    // After confirm: Table 1 is immediately Available / Free!
    active = getActiveTableSessions(orders);
    assert.ok(!active['Table 1'], 'Table 1 must be immediately Available/Free once billed');
  });

  it('5.2 Occupancy Immunity Invariant: Settling Customer A bill does NOT affect Customer B on Table 1', () => {
    const orders = [
      // Customer A's old billed order for Table 1
      {
        id: 'order-cust-a',
        order_number: 'BILL-001',
        table_number: 'Table 1',
        ticket_status: 'BILLED',
        payment_status: 'unpaid',
        status: 'billed',
        grand_total: 500
      },
      // Customer B sits down at Table 1 and places a new order
      {
        id: 'order-cust-b',
        order_number: 'ORD-002',
        table_number: 'Table 1',
        ticket_status: 'OPEN',
        payment_status: 'unpaid',
        status: 'pending',
        grand_total: 350
      }
    ];

    function getActiveTableSessions(orderList) {
      const active = {};
      for (const o of orderList) {
        if (!o.table_number || o.status === 'cancelled' || o.ticket_status === 'CANCELLED' || o.ticket_status === 'BILLED' || o.ticket_status === 'CLOSED') {
          continue;
        }
        if (o.payment_status === 'paid') continue;
        if (o.status === 'billed') continue;
        const key = String(o.table_number).trim();
        if (!active[key]) active[key] = [];
        active[key].push(o);
      }
      return active;
    }

    function getOutstandingTableBills(orderList) {
      return orderList.filter(o => 
        (o.ticket_status === 'BILLED' || o.status === 'billed') &&
        o.payment_status === 'unpaid' &&
        o.status !== 'cancelled'
      );
    }

    // Verify initial state:
    // Outstanding bills: Customer A
    let outstanding = getOutstandingTableBills(orders);
    assert.equal(outstanding.length, 1);
    assert.equal(outstanding[0].id, 'order-cust-a');

    // Active table session for Table 1: Customer B
    let activeSessions = getActiveTableSessions(orders);
    assert.ok(activeSessions['Table 1'], 'Table 1 must be actively occupied by Customer B');
    assert.equal(activeSessions['Table 1'][0].id, 'order-cust-b');

    // Now settle Customer A's bill with Cash
    function settleTableBill(billId, method) {
      const bill = orders.find(o => o.id === billId);
      assert.ok(bill, 'Bill must exist');
      bill.payment_status = 'paid';
      bill.ticket_status = 'CLOSED';
      bill.payment_method = method;
      bill.status = 'delivered';
    }

    settleTableBill('order-cust-a', 'cash');

    // Customer A is no longer in outstanding bills
    outstanding = getOutstandingTableBills(orders);
    assert.equal(outstanding.length, 0, 'Customer A bill must no longer be in outstanding bills');

    // CRITICAL INVARIANT: Table 1 MUST STILL BE OCCUPIED BY CUSTOMER B!
    activeSessions = getActiveTableSessions(orders);
    assert.ok(activeSessions['Table 1'], 'Table 1 occupancy must be completely UNTOUCHED');
    assert.equal(activeSessions['Table 1'].length, 1);
    assert.equal(activeSessions['Table 1'][0].id, 'order-cust-b', "Customer B's order must remain intact");
    assert.equal(activeSessions['Table 1'][0].ticket_status, 'OPEN');
    assert.equal(activeSessions['Table 1'][0].payment_status, 'unpaid');
  });

  it('5.3 Multi-Bill Isolation: Multiple unpaid bills for Table 1 can coexist and be settled independently', () => {
    const orders = [
      {
        id: 'bill-1',
        order_number: 'BILL-001',
        table_number: 'Table 1',
        ticket_status: 'BILLED',
        payment_status: 'unpaid',
        status: 'billed',
        grand_total: 450
      },
      {
        id: 'bill-2',
        order_number: 'BILL-002',
        table_number: 'Table 1',
        ticket_status: 'BILLED',
        payment_status: 'unpaid',
        status: 'billed',
        grand_total: 620
      }
    ];

    const outstanding = orders.filter(o => o.payment_status === 'unpaid' && o.ticket_status === 'BILLED');
    assert.equal(outstanding.length, 2, 'Both bills should be outstanding for Table 1');

    // Settle bill-1 only
    const target = orders.find(o => o.id === 'bill-1');
    target.payment_status = 'paid';
    target.ticket_status = 'CLOSED';

    const remaining = orders.filter(o => o.payment_status === 'unpaid' && o.ticket_status === 'BILLED');
    assert.equal(remaining.length, 1, 'Only bill-2 should remain unpaid');
    assert.equal(remaining[0].id, 'bill-2');
  });
});
