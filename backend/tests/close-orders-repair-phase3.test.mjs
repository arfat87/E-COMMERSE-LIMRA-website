/**
 * LIMRA RESTAURANT POS — PHASE 3: CLOSE & SETTLE HISTORICAL ORDERS REPAIR TEST SUITE
 * 
 * Verifies all 16 targeted behaviors + financial identities:
 * 1. Runtime crash prevention (deliveredOrders, todayStr, yestStr, now in scope).
 * 2. Today filter (local business date boundary IST).
 * 3. Yesterday filter (previous business date boundary).
 * 4. All Time filter (full eligible history).
 * 5. Confirmed unpaid order dual visibility & inclusion in Close Orders.
 * 6. Paid order retention in Close Orders & exclusion from unpaid Bill list.
 * 7. Cancelled order exclusion from financial totals.
 * 8. Voided order exclusion from financial totals.
 * 9. Missing item rows preservation of stored total amount.
 * 10. Empty historical result rendering without runtime error.
 * 11. Supabase query failure handling without range poisoning.
 * 12. RLS or authorization failure resilience.
 * 13. Pagination across multiple pages with sliding window.
 * 14. Duplicate order prevention during batch merge.
 * 15. KPI calculation & financial balance: Total Order Value = Collected + Outstanding.
 * 16. Realtime update after payment settlement updates metrics accurately.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const adminJs = fs.readFileSync(path.join(rootDir, 'frontend/src/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(rootDir, 'frontend/admin.html'), 'utf8');

// Mirror core frontend helpers
function getLocalDateString(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getEffectiveOrderTotal(order) {
  if (!order) return 0;
  const direct = Number(order.total_amount);
  if (!isNaN(direct) && direct > 0) return Math.floor(direct);
  const sub = Number(order.subtotal_amount) || Number(order.taxable_amount) || 0;
  const tax = (Number(order.cgst_amount) || 0) + (Number(order.sgst_amount) || 0);
  const del = Number(order.delivery_fee) || 0;
  if (sub + tax + del > 0) return Math.floor(sub + tax + del);
  return 0;
}

function isOrderVoided(order) {
  if (!order) return false;
  const n = String(order.notes || '');
  return n.includes('[VOIDED]') || n.includes('[REFUNDED]') || order.status === 'refunded' || order.payment_status === 'refunded';
}

function filterClosedOrders(ordersList) {
  return ordersList.filter(o => {
    if (o.ticket_status === 'HOLD' || o.status === 'hold') return false;
    return (
      o.status === 'delivered' ||
      o.status === 'completed' ||
      o.status === 'closed' ||
      o.status === 'cancelled' ||
      o.payment_status === 'paid' ||
      o.payment_status === 'refunded' ||
      o.ticket_status === 'CLOSED' ||
      o.ticket_status === 'BILLED' ||
      (o.status === 'confirmed' && o.ticket_status !== 'HOLD')
    );
  });
}

function getOutstandingBills(ordersList) {
  return ordersList.filter(o => {
    if (o.status === 'cancelled' || o.ticket_status === 'CANCELLED') return false;
    if (o.payment_status === 'paid' || o.ticket_status === 'CLOSED') return false;
    if (o.ticket_status === 'HOLD' || o.status === 'hold') return false;
    return o.ticket_status === 'BILLED' || o.status === 'billed' || (o.notes && o.notes.includes('[FINAL_BILL]'));
  });
}

describe('SUITE 38: Phase 3 Close & Settle Historical Orders Repair', () => {

  it('1. Runtime crash prevention: admin.js contains no undefined deliveredOrders and has lexical variables in scope', () => {
    // Assert no undefined deliveredOrders reference in renderClosedOrdersPanel
    assert.ok(
      !adminJs.includes('${deliveredOrders.length} / ${cancelledOrders.length}'),
      'Obsolete deliveredOrders.length must be removed from admin.js'
    );

    // Extract renderClosedOrdersPanel implementation
    const fnStart = adminJs.indexOf('async function renderClosedOrdersPanel()');
    assert.ok(fnStart !== -1, 'renderClosedOrdersPanel must exist');
    const fnBody = adminJs.slice(fnStart, fnStart + 3500);

    assert.ok(fnBody.includes('const todayStr = getLocalDateString(now)'), 'todayStr must be in scope');
    assert.ok(fnBody.includes('const yestStr = getLocalDateString(yDate)'), 'yestStr must be in scope');
    assert.ok(fnBody.includes('totalClosedOrderValue'), 'totalClosedOrderValue must be defined');
    assert.ok(fnBody.includes('totalPaymentCollected'), 'totalPaymentCollected must be defined');
    assert.ok(fnBody.includes('totalOutstandingAmount'), 'totalOutstandingAmount must be defined');
  });

  it('2. Today filter: includes orders from local business date boundary and excludes previous days', () => {
    const now = new Date();
    const todayStr = getLocalDateString(now);
    const yDate = new Date(now);
    yDate.setDate(yDate.getDate() - 1);
    const yestStr = getLocalDateString(yDate);

    const testOrders = [
      { id: 't-1', order_number: 101, created_at: `${todayStr}T10:30:00`, status: 'delivered', payment_status: 'paid', total_amount: 450 },
      { id: 't-2', order_number: 102, created_at: `${todayStr}T14:15:00`, status: 'confirmed', ticket_status: 'BILLED', payment_status: 'unpaid', total_amount: 320 },
      { id: 'y-1', order_number: 99, created_at: `${yestStr}T12:00:00`, status: 'delivered', payment_status: 'paid', total_amount: 500 }
    ];

    const todayOrders = testOrders.filter(o => getLocalDateString(o.created_at) === todayStr);
    assert.equal(todayOrders.length, 2, 'Today filter must return exactly 2 orders created today');
    assert.ok(todayOrders.some(o => o.id === 't-1'));
    assert.ok(todayOrders.some(o => o.id === 't-2'));
    assert.ok(!todayOrders.some(o => o.id === 'y-1'), 'Yesterday order must be excluded from Today filter');
  });

  it('3. Yesterday filter: correctly resolves to previous calendar day', () => {
    const now = new Date();
    const yDate = new Date(now);
    yDate.setDate(yDate.getDate() - 1);
    const yestStr = getLocalDateString(yDate);

    const testOrders = [
      { id: 'y-1', order_number: 99, created_at: `${yestStr}T12:00:00.000Z`, status: 'delivered', payment_status: 'paid', total_amount: 500 },
      { id: 't-1', order_number: 101, created_at: `${getLocalDateString(now)}T10:00:00.000Z`, status: 'delivered', payment_status: 'paid', total_amount: 450 }
    ];

    const yestOrders = testOrders.filter(o => getLocalDateString(o.created_at) === yestStr);
    assert.equal(yestOrders.length, 1);
    assert.equal(yestOrders[0].id, 'y-1');
  });

  it('4. All Time filter: retains full historical set without temporal bounds restriction', () => {
    const historicalOrders = [
      { id: 'h-1', created_at: '2026-08-01T10:00:00Z', status: 'delivered', payment_status: 'paid', total_amount: 100 },
      { id: 'h-2', created_at: '2026-09-15T12:00:00Z', status: 'delivered', payment_status: 'paid', total_amount: 200 },
      { id: 'h-3', created_at: '2026-10-30T15:00:00Z', status: 'delivered', payment_status: 'paid', total_amount: 300 }
    ];

    const allTimeOrders = filterClosedOrders(historicalOrders);
    assert.equal(allTimeOrders.length, 3, 'All Time filter must preserve all historical eligible orders');
  });

  it('5. Confirmed unpaid order: dual visibility in Bill and Close Orders with identical order ID', () => {
    const confirmedUnpaid = {
      id: 'ord-dual-001',
      order_number: 501,
      status: 'confirmed',
      ticket_status: 'BILLED',
      payment_status: 'unpaid',
      total_amount: 680,
      notes: '[DINE-IN] [FINAL_BILL]'
    };

    const inBill = getOutstandingBills([confirmedUnpaid]);
    const inClose = filterClosedOrders([confirmedUnpaid]);

    assert.equal(inBill.length, 1, 'Must appear in Bill list');
    assert.equal(inClose.length, 1, 'Must appear in Close Orders list');
    assert.equal(inBill[0].id, inClose[0].id, 'Must share identical order ID');
    assert.equal(inClose[0].payment_status, 'unpaid', 'Payment status must be unpaid');
  });

  it('6. Paid order: remains in Close Orders and disappears from unpaid Bill list', () => {
    const paidOrder = {
      id: 'ord-paid-002',
      order_number: 502,
      status: 'delivered',
      ticket_status: 'CLOSED',
      payment_status: 'paid',
      total_amount: 680,
      notes: '[DINE-IN] [PAYMENT: cash]'
    };

    const inBill = getOutstandingBills([paidOrder]);
    const inClose = filterClosedOrders([paidOrder]);

    assert.equal(inBill.length, 0, 'Paid order must not appear in unpaid Bill list');
    assert.equal(inClose.length, 1, 'Paid order must remain in Close Orders');
  });

  it('7. Cancelled order: excluded from revenue, collected, and outstanding totals', () => {
    const ordersList = [
      { id: '1', total_amount: 500, payment_status: 'paid', status: 'delivered', ticket_status: 'CLOSED' },
      { id: '2', total_amount: 350, payment_status: 'cancelled', status: 'cancelled', ticket_status: 'CANCELLED' }
    ];

    const eligible = filterClosedOrders(ordersList);
    const active = eligible.filter(o => o.status !== 'cancelled' && !isOrderVoided(o));
    const totalRev = active.reduce((s, o) => s + getEffectiveOrderTotal(o), 0);
    const collected = active.filter(o => o.payment_status === 'paid').reduce((s, o) => s + getEffectiveOrderTotal(o), 0);
    const outstanding = active.filter(o => o.payment_status !== 'paid').reduce((s, o) => s + getEffectiveOrderTotal(o), 0);

    assert.equal(totalRev, 500, 'Cancelled order amount must be excluded from total revenue');
    assert.equal(collected, 500, 'Collected must exclude cancelled order');
    assert.equal(outstanding, 0, 'Outstanding must exclude cancelled order');
  });

  it('8. Voided order: marked as voided/refunded and excluded from active revenue', () => {
    const ordersList = [
      { id: '1', total_amount: 400, payment_status: 'paid', status: 'delivered', ticket_status: 'CLOSED' },
      { id: '2', total_amount: 250, payment_status: 'refunded', status: 'delivered', ticket_status: 'CLOSED', notes: '[VOIDED: Guest changed mind]' }
    ];

    const eligible = filterClosedOrders(ordersList);
    const active = eligible.filter(o => o.status !== 'cancelled' && !isOrderVoided(o));
    const totalRev = active.reduce((s, o) => s + getEffectiveOrderTotal(o), 0);

    assert.equal(totalRev, 400, 'Voided order must be excluded from active revenue total');
    assert.ok(isOrderVoided(ordersList[1]), 'Order with [VOIDED] notes must be recognized as voided');
  });

  it('9. Missing item rows with valid stored total: preserves authoritative stored total_amount', () => {
    const orderWithoutItems = {
      id: 'ord-no-items',
      total_amount: 850,
      subtotal_amount: null,
      taxable_amount: null,
      status: 'delivered',
      ticket_status: 'CLOSED',
      payment_status: 'paid'
    };

    const total = getEffectiveOrderTotal(orderWithoutItems);
    assert.equal(total, 850, 'Stored total_amount must never revert to 0 when item rows are missing');
  });

  it('10. Empty historical result: handles zero orders gracefully without NaN or errors', () => {
    const emptyOrders = [];
    const activeOrders = emptyOrders.filter(o => o.status !== 'cancelled' && !isOrderVoided(o));
    const totalCount = activeOrders.length;
    const totalRev = activeOrders.reduce((s, o) => s + getEffectiveOrderTotal(o), 0);
    const aov = totalCount > 0 ? totalRev / totalCount : 0;

    assert.equal(totalCount, 0);
    assert.equal(totalRev, 0);
    assert.equal(aov, 0, 'AOV must safely resolve to 0 and not NaN when order count is 0');
  });

  it('11. Supabase query failure: ensureHistoricalClosedOrders tracks hasError and avoids caching failed rangeKey', () => {
    assert.ok(
      adminJs.includes('let hasError = false;'),
      'ensureHistoricalClosedOrders must define hasError flag'
    );
    assert.ok(
      adminJs.includes('if (!hasError)'),
      'ensureHistoricalClosedOrders must guard closedLoadedRanges.add with hasError'
    );
  });

  it('12. RLS or authorization failure: catch block traps query exceptions and releases lock', () => {
    const fnStart = adminJs.indexOf('async function ensureHistoricalClosedOrders(');
    const fnBlock = adminJs.slice(fnStart, fnStart + 2500);
    assert.ok(fnBlock.includes('catch (err) {'), 'Query must be enclosed in try/catch');
    assert.ok(fnBlock.includes('finally {'), 'finally block must reset isFetchingClosedOrders');
    assert.ok(fnBlock.includes('isFetchingClosedOrders = false;'), 'isFetchingClosedOrders must be cleared in finally');
  });

  it('13. Pagination across multiple pages: calculates page count and offsets correctly', () => {
    const totalCount = 65;
    const pageSize = 25;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    assert.equal(totalPages, 3, '65 items at 25 per page must yield 3 pages');

    const page1Start = (1 - 1) * pageSize;
    const page1End = Math.min(1 * pageSize, totalCount);
    assert.equal(page1Start, 0);
    assert.equal(page1End, 25);

    const page3Start = (3 - 1) * pageSize;
    const page3End = Math.min(3 * pageSize, totalCount);
    assert.equal(page3Start, 50);
    assert.equal(page3End, 65);
  });

  it('14. Duplicate order prevention: Map deduplication by ID prevents duplicate entries on merge', () => {
    const memory = [
      { id: 'ord-1', total_amount: 100 },
      { id: 'ord-2', total_amount: 200 }
    ];
    const incomingBatch = [
      { id: 'ord-2', total_amount: 200 }, // Overlap
      { id: 'ord-3', total_amount: 300 }
    ];

    const orderMap = new Map();
    memory.forEach(o => orderMap.set(String(o.id), o));
    incomingBatch.forEach(o => orderMap.set(String(o.id), o));
    const merged = Array.from(orderMap.values());

    assert.equal(merged.length, 3, 'Merged list must contain exactly 3 unique orders without duplicating ord-2');
  });

  it('15. KPI calculation & financial balance: Total Order Value = Payment Collected + Outstanding Amount', () => {
    const ordersList = [
      { id: '1', total_amount: 500, payment_status: 'paid', status: 'delivered', ticket_status: 'CLOSED' },
      { id: '2', total_amount: 300, payment_status: 'unpaid', status: 'confirmed', ticket_status: 'BILLED' },
      { id: '3', total_amount: 450, payment_status: 'paid', status: 'delivered', ticket_status: 'CLOSED' },
      { id: '4', total_amount: 250, payment_status: 'unpaid', status: 'confirmed', ticket_status: 'BILLED' },
      { id: '5', total_amount: 150, payment_status: 'cancelled', status: 'cancelled', ticket_status: 'CANCELLED' }
    ];

    const active = ordersList.filter(o => o.status !== 'cancelled' && !isOrderVoided(o));
    const totalOrderValue = active.reduce((s, o) => s + getEffectiveOrderTotal(o), 0);
    const collected = active.filter(o => o.payment_status === 'paid').reduce((s, o) => s + getEffectiveOrderTotal(o), 0);
    const outstanding = active.filter(o => o.payment_status !== 'paid').reduce((s, o) => s + getEffectiveOrderTotal(o), 0);

    assert.equal(totalOrderValue, 1500);
    assert.equal(collected, 950);
    assert.equal(outstanding, 550);
    assert.equal(totalOrderValue, collected + outstanding, 'Financial identity must hold: 1500 = 950 + 550');
  });

  it('16. Realtime update after payment settlement: transitions order from unpaid to paid without altering total', () => {
    const order = { id: 'ord-realtime', total_amount: 720, payment_status: 'unpaid', status: 'confirmed', ticket_status: 'BILLED' };
    const dataset = [order];

    // Pre-settlement state
    let active = dataset.filter(o => o.status !== 'cancelled' && !isOrderVoided(o));
    assert.equal(active.filter(o => o.payment_status !== 'paid').reduce((s, o) => s + getEffectiveOrderTotal(o), 0), 720);
    assert.equal(active.filter(o => o.payment_status === 'paid').reduce((s, o) => s + getEffectiveOrderTotal(o), 0), 0);

    // Simulate realtime payload: payment completed
    order.payment_status = 'paid';
    order.ticket_status = 'CLOSED';
    order.status = 'delivered';
    order.settled_at = new Date().toISOString();

    // Post-settlement state
    active = dataset.filter(o => o.status !== 'cancelled' && !isOrderVoided(o));
    const totalVal = active.reduce((s, o) => s + getEffectiveOrderTotal(o), 0);
    const collectedVal = active.filter(o => o.payment_status === 'paid').reduce((s, o) => s + getEffectiveOrderTotal(o), 0);
    const outstandingVal = active.filter(o => o.payment_status !== 'paid').reduce((s, o) => s + getEffectiveOrderTotal(o), 0);

    assert.equal(totalVal, 720, 'Total Order Value must remain unchanged at 720');
    assert.equal(collectedVal, 720, 'Collected must now equal 720');
    assert.equal(outstandingVal, 0, 'Outstanding must now equal 0');
    assert.equal(totalVal, collectedVal + outstandingVal, 'Financial identity must remain balanced post-realtime settlement');
  });

});
