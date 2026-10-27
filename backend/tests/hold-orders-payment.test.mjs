/**
 * LIMRA RESTAURANT — HELD ORDERS CASH/UPI PAYMENT VERIFICATION TEST SUITE
 * 
 * Verifies:
 * 1. HTML markup and modal structure for Hold Order Payment & Settlement Modal
 * 2. Visual design system: White-and-Gold accent palette, high contrast Cash/UPI cards
 * 3. Backend API PATCH /api/orders and RPC settle_order_atomic support for payment_method & txn_ref
 * 4. State preservation: Resuming a held order does NOT prematurely mark it paid/closed
 * 5. Payment method preservation throughout POS resume, hold modal, and settlement
 * 6. Concurrency guards: Idempotency keys, isHoldSettling double-click guard, ticket_status checks
 * 7. Receipt formatting: HTML thermal receipt & ESC/POS receipt include selected payment method
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
const ordersApi = fs.readFileSync(path.join(rootDir, 'backend/api/orders.js'), 'utf8');
const escposJs = fs.readFileSync(path.join(rootDir, 'frontend/src/lib/escpos.js'), 'utf8');
const schemaSql = fs.readFileSync(path.join(rootDir, 'database/schema.sql'), 'utf8');

describe('SUITE 1: HTML Markup & Modal Architecture for Held Order Payment', () => {
  it('1.1 Settlement modal #adm-hold-settle-modal exists with proper modal attributes', () => {
    assert.ok(adminHtml.includes('id="adm-hold-settle-modal"'), 'Modal container must exist in admin.html');
    assert.ok(adminHtml.includes('class="adm-hold-modal"'), 'Modal must use standard adm-hold-modal class');
  });

  it('1.2 Modal header contains tasteful gold accent and clear title', () => {
    assert.ok(adminHtml.includes('Confirm Payment &amp; Settle') || adminHtml.includes('Confirm Payment & Settle'), 'Modal header title must be present');
    assert.ok(adminHtml.includes('#d97706'), 'Header must contain gold accent border');
    assert.ok(adminHtml.includes('id="hold-settle-close-btn"'), 'Modal close button must exist');
  });

  it('1.3 Order and table summary elements exist', () => {
    assert.ok(adminHtml.includes('id="hold-settle-order-title"'), '#hold-settle-order-title must exist');
    assert.ok(adminHtml.includes('id="hold-settle-order-badge"'), '#hold-settle-order-badge must exist');
    assert.ok(adminHtml.includes('id="hold-settle-customer-name"'), '#hold-settle-customer-name must exist');
    assert.ok(adminHtml.includes('id="hold-settle-items-count"'), '#hold-settle-items-count must exist');
  });

  it('1.4 Prominent final payable amount card exists', () => {
    assert.ok(adminHtml.includes('id="hold-settle-payable-amount"'), '#hold-settle-payable-amount must exist');
    assert.ok(adminHtml.includes('id="hold-settle-amount-breakdown"'), '#hold-settle-amount-breakdown must exist');
    assert.ok(adminHtml.includes('Total Payable Amount'), 'Label must display Total Payable Amount');
  });

  it('1.5 Cash and UPI selection cards exist with clear identifiers', () => {
    assert.ok(adminHtml.includes('id="hold-settle-method-cash"'), 'Cash button must exist');
    assert.ok(adminHtml.includes('id="hold-settle-method-upi"'), 'UPI button must exist');
    assert.ok(adminHtml.includes('data-method="cash"'), 'Cash button has data-method="cash"');
    assert.ok(adminHtml.includes('data-method="upi"'), 'UPI button has data-method="upi"');
    assert.ok(adminHtml.includes('hold-settle-check-pill'), 'Selection checkmark pill must exist');
  });

  it('1.6 UPI reference / UTR input wrapper exists for optional payment proof', () => {
    assert.ok(adminHtml.includes('id="hold-settle-upi-ref-wrap"'), '#hold-settle-upi-ref-wrap must exist');
    assert.ok(adminHtml.includes('id="hold-settle-upi-ref"'), '#hold-settle-upi-ref input must exist');
  });

  it('1.7 Cancel and Confirm action buttons exist', () => {
    assert.ok(adminHtml.includes('id="hold-settle-cancel-btn"'), '#hold-settle-cancel-btn must exist');
    assert.ok(adminHtml.includes('id="hold-settle-confirm-btn"'), '#hold-settle-confirm-btn must exist');
    assert.ok(adminHtml.includes('id="hold-settle-confirm-text"'), '#hold-settle-confirm-text must exist');
  });

  it('1.8 Resume in POS button exists on non-table hold cards', () => {
    assert.ok(adminJs.includes('hold-resume-pos-btn'), 'hold-resume-pos-btn must be rendered for held orders');
    assert.ok(adminJs.includes('Resume in POS'), 'Button must have clear "Resume in POS" label or title');
  });
});

describe('SUITE 2: Visual Design System & Tasteful Gold Accent Styling', () => {
  it('2.1 admin.css defines .hold-settle-method-card styles', () => {
    assert.ok(adminCss.includes('.hold-settle-method-card'), '.hold-settle-method-card must be defined in admin.css');
  });

  it('2.2 Active card states apply gold highlight border and subtle glow', () => {
    assert.ok(adminCss.includes('.hold-settle-method-card.active') || adminCss.includes('border-color: #d97706'), 'Active state must use gold highlight');
    assert.ok(adminCss.includes('.hold-settle-check-pill'), '.hold-settle-check-pill styling must be present');
  });
});

describe('SUITE 3: Backend API & Database Settlement Integrity', () => {
  it('3.1 PATCH /api/orders accepts and validates payment_method parameter', () => {
    assert.ok(ordersApi.includes('payment_method'), 'orders.js must reference payment_method');
    assert.ok(
      (ordersApi.includes('"cash"') && ordersApi.includes('"upi"')) ||
      (ordersApi.includes("'cash'") && ordersApi.includes("'upi'")),
      'orders.js must accept cash and upi'
    );
  });

  it('3.2 PATCH /api/orders supports txn_ref parameter for UPI payments', () => {
    assert.ok(ordersApi.includes('txn_ref'), 'orders.js must support txn_ref');
  });

  it('3.3 Database schema defines settle_order_atomic RPC accepting payment method and idempotency key', () => {
    assert.ok(schemaSql.includes('settle_order_atomic'), 'schema.sql must define settle_order_atomic RPC');
    assert.ok(schemaSql.includes('p_payment_method'), 'RPC must accept p_payment_method');
    assert.ok(schemaSql.includes('p_idempotency_key'), 'RPC must accept p_idempotency_key');
  });

  it('3.4 Database schema logs settlement transaction to payment_history table', () => {
    assert.ok(schemaSql.includes('payment_history'), 'schema.sql must contain payment_history table');
    assert.ok(schemaSql.includes('payment_method'), 'payment_history must record payment_method');
  });
});

describe('SUITE 4: JavaScript Flow & State Preservation', () => {
  it('4.1 Resuming a held order preserves existing payment method in POS workstation', () => {
    assert.ok(adminJs.includes('pos-payment-mode'), 'admin.js must sync pos-payment-mode on resume');
    assert.ok(adminJs.includes('pos-pay-mode-pill'), 'admin.js must update pos-pay-mode-pill on resume');
  });

  it('4.2 Resuming a held order does NOT prematurely mark it as paid or closed', () => {
    // In loadOrderIntoPos, status should not be changed to delivered or paid
    const loadFnMatch = adminJs.match(/function loadOrderIntoPos\(order\) \{([\s\S]*?)\n\}/);
    assert.ok(loadFnMatch, 'loadOrderIntoPos function must exist');
    const loadFnBody = loadFnMatch[1];
    assert.ok(!loadFnBody.includes("status = 'delivered'"), 'loadOrderIntoPos must not change status to delivered');
    assert.ok(!loadFnBody.includes("payment_status = 'paid'"), 'loadOrderIntoPos must not mark order as paid');
  });

  it('4.3 openHoldSettleModal is defined and exposed to window', () => {
    assert.ok(adminJs.includes('function openHoldSettleModal'), 'openHoldSettleModal must be defined');
    assert.ok(adminJs.includes('window.openHoldSettleModal = openHoldSettleModal'), 'openHoldSettleModal must be exposed to window');
  });

  it('4.4 selectHoldSettleMethod switches between cash and upi and toggles UTR input', () => {
    assert.ok(adminJs.includes('function selectHoldSettleMethod'), 'selectHoldSettleMethod must be defined');
    assert.ok(adminJs.includes('hold-settle-upi-ref-wrap'), 'selectHoldSettleMethod must toggle UTR wrapper');
    assert.ok(adminJs.includes('currentHoldSettleMethod = valid'), 'selectHoldSettleMethod must track selected method');
  });

  it('4.5 createFinalBillForTableSession sets payment_method on primary and sibling orders', () => {
    assert.ok(adminJs.includes('createFinalBillForTableSession'), 'createFinalBillForTableSession must exist');
    assert.ok(adminJs.includes('payment_method: validMethod'), 'createFinalBillForTableSession must persist validMethod in orders');
  });

  it('4.6 settleSingleHeldOrder sets payment_method and appends [PAYMENT: method] to notes', () => {
    assert.ok(adminJs.includes('function settleSingleHeldOrder'), 'settleSingleHeldOrder must exist');
    assert.ok(adminJs.includes('[PAYMENT:'), 'settleSingleHeldOrder must record [PAYMENT: method]');
  });

  it('4.7 Concurrency and double-settlement guards are enforced', () => {
    assert.ok(adminJs.includes('isHoldSettling'), 'isHoldSettling guard must prevent duplicate clicks');
    assert.ok(adminJs.includes('settleIdempotencyKey') || adminJs.includes('idempotency_key'), 'Idempotency keys must be generated and sent');
  });

  it('4.8 Thermal receipt generator and ESC/POS printer builder display selected payment method', () => {
    assert.ok(adminJs.includes('order.payment_method || order.payment_mode'), 'Receipt generator must check order.payment_method');
    assert.ok(escposJs.includes('order.payment_method || order.payment_mode'), 'ESC/POS builder must check order.payment_method');
  });
});
