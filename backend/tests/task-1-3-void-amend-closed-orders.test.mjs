/**
 * ============================================================================
 * TASK 1.3 VERIFICATION SUITE
 * Replace Closed Order Hard Delete with Auditable Void / Amendment
 * ============================================================================
 * Covers:
 *   1. Authorized void (manager / owner / admin with recorded reason)
 *   2. Unauthorized void (anonymous, customer, kitchen, cashier rejected)
 *   3. Missing reason (rejected with REASON_REQUIRED on void and amendment)
 *   4. Duplicate void request (idempotent replay with same key; rejected with
 *      ORDER_ALREADY_VOIDED on duplicate void with different/no key)
 *   5. Amendment of closed order (item add/remove/qty change + GST total
 *      recalculation via amend_closed_order_atomic without check_ticket_not_closed
 *      failure, while direct table mutations on CLOSED orders remain blocked)
 *   6. Original invoice remains auditable (orders row + order_items preserved +
 *      full pre-void/pre-amendment original_invoice snapshot in security_audit_logs)
 *   7. Payment history remains intact (original 'paid' entry preserved + new
 *      'refunded' or amendment entry appended; hard delete of payment_history blocked)
 *   8. Role restrictions verified across all roles (owner, manager, admin,
 *      cashier, kitchen, customer, anonymous)
 * ============================================================================
 */

import './test-env-guard.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dbHandler from '../api/db.js';
import ordersHandler from '../api/orders.js';
import { hasRequiredRole } from '../api/lib/auth-middleware.js';
import { calculateOrderBilling } from '../../frontend/src/lib/billing-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const adminJs = fs.readFileSync(path.join(ROOT_DIR, 'frontend/src/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT_DIR, 'frontend/admin.html'), 'utf8');
const schemaSql = fs.readFileSync(path.join(ROOT_DIR, 'database/schema.sql'), 'utf8');
const migrationSql = fs.readFileSync(
  path.join(ROOT_DIR, 'database/migrations/20261017040000_billing_gst_discounts_state_integrity.sql'),
  'utf8'
);
const dbApiJs = fs.readFileSync(path.join(ROOT_DIR, 'backend/api/db.js'), 'utf8');
const ordersApiJs = fs.readFileSync(path.join(ROOT_DIR, 'backend/api/orders.js'), 'utf8');

function extractFunctionBody(source, signaturePrefix) {
  const startIdx = source.indexOf(signaturePrefix);
  assert.notEqual(startIdx, -1, `Could not find ${signaturePrefix}`);
  let braceStart = source.indexOf('{', startIdx);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(startIdx, i + 1);
      }
    }
  }
  throw new Error(`Unbalanced braces for ${signaturePrefix}`);
}

function createMockReqRes({ method = 'POST', url = '/', headers = {}, body = {}, query = {} } = {}) {
  const req = {
    method,
    url,
    headers: { ...headers },
    body,
    query,
    socket: { remoteAddress: '127.0.0.1' }
  };

  const resData = {
    statusCode: 200,
    headers: {},
    body: null,
    isEnded: false
  };

  const res = {
    status(code) {
      resData.statusCode = code;
      return this;
    },
    setHeader(k, v) {
      resData.headers[k.toLowerCase()] = v;
      return this;
    },
    json(data) {
      resData.body = data;
      resData.isEnded = true;
      return this;
    },
    send(data) {
      resData.body = data;
      resData.isEnded = true;
      return this;
    },
    end(data) {
      if (data && !resData.body) resData.body = data;
      resData.isEnded = true;
      return this;
    }
  };

  return { req, res, resData };
}

/**
 * Stateful PostgreSQL + POS Transactional Simulator for Task 1.3:
 * Models:
 *   - public.orders (with trg_validate_order_state_transitions & trg_prevent_financial_order_delete)
 *   - public.order_items (with trg_check_ticket_not_closed BEFORE INSERT OR UPDATE OR DELETE)
 *   - public.payment_history (with trg_prevent_payment_history_delete BEFORE DELETE)
 *   - public.security_audit_logs (append-only financial & security audit log)
 *   - public.void_closed_order_atomic(p_order_id, p_reason, p_idempotency_key)
 *   - public.amend_closed_order_atomic(p_order_id, p_updated_items, p_updated_fields, p_reason, p_idempotency_key)
 *   - POS client voidClosedOrder / deleteUniversalOrder / saveClosedOrderCorrections
 */
function createVoidAmendSandbox() {
  const orders = new Map();
  const orderItems = [];
  const paymentHistory = [];
  const securityAuditLogs = [];
  const toasts = [];

  let authorizedAmendmentGuc = false; // Simulates current_setting('limra.authorized_amendment', true)

  function hasRole(actorRole, allowedRoles) {
    if (!actorRole) return false;
    const norm = String(actorRole).toLowerCase().trim();
    return allowedRoles.includes(norm);
  }

  function seedClosedOrder({
    id = 'ord-closed-1001',
    order_number = 1001,
    customer_name = 'Aamir Siddiqui',
    customer_phone = '9876543210',
    order_type = 'table',
    table_number = 4,
    status = 'delivered',
    payment_status = 'paid',
    payment_method = 'upi',
    ticket_status = 'CLOSED',
    total_amount = 525,
    notes = '[TABLE: 4] [ROUND: 1] [CGST: 2.5%] [SGST: 2.5%] [PAYMENT: UPI] [PAYMENT_STATUS: PAID]',
    items = [
      { id: 'item-1', menu_item_id: 101, item_name: 'Chicken Biryani Full', quantity: 2, unit_price: 200, line_total: 400 },
      { id: 'item-2', menu_item_id: 102, item_name: 'Butter Naan', quantity: 2, unit_price: 50, line_total: 100 }
    ]
  } = {}) {
    const createdAt = new Date().toISOString();
    const orderRow = {
      id,
      order_number,
      customer_name,
      customer_phone,
      order_type,
      table_number,
      status,
      payment_status,
      payment_method,
      ticket_status,
      total_amount,
      notes,
      created_at: createdAt,
      updated_at: createdAt
    };
    orders.set(id, { ...orderRow });

    for (const item of items) {
      orderItems.push({
        id: item.id || `oi-${orderItems.length + 1}`,
        order_id: id,
        menu_item_id: item.menu_item_id ?? null,
        item_name: item.item_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.line_total ?? item.quantity * item.unit_price,
        created_at: createdAt
      });
    }

    // Seed initial settlement payment_history row
    paymentHistory.push({
      id: `ph-${paymentHistory.length + 1}`,
      order_id: id,
      user_id: 'cashier-uuid-1',
      previous_status: 'unpaid',
      new_status: 'paid',
      changed_by: 'cashier@limra.pos',
      notes: `POS Final Bill Settlement (${payment_method.toUpperCase()})`,
      reason: `POS Final Bill Settlement (${payment_method.toUpperCase()})`,
      created_at: createdAt
    });

    return { ...orderRow };
  }

  // Simulates trg_check_ticket_not_closed on public.order_items (BEFORE INSERT OR UPDATE OR DELETE)
  function checkTicketNotClosedTrigger(op, orderId) {
    if (authorizedAmendmentGuc) return;
    const parent = orders.get(orderId);
    if (!parent) return;
    if (parent.ticket_status === 'CLOSED' || parent.ticket_status === 'CANCELLED') {
      if (op === 'INSERT') {
        throw new Error(`Cannot attach items to a ${parent.ticket_status} ticket (order_id: ${orderId})`);
      }
      if (op === 'UPDATE') {
        throw new Error(`Cannot directly modify items on a ${parent.ticket_status} ticket (order_id: ${orderId}). Use amend_closed_order_atomic.`);
      }
      if (op === 'DELETE') {
        throw new Error(`Cannot directly delete items from a ${parent.ticket_status} ticket (order_id: ${orderId}). Use amend_closed_order_atomic.`);
      }
    }
  }

  // Simulates direct table operations (to prove direct tampering is blocked)
  function directDeleteOrder(orderId) {
    const existing = orders.get(orderId);
    if (!existing) throw new Error('ORDER_NOT_FOUND');
    if (
      existing.ticket_status === 'CLOSED' ||
      existing.payment_status === 'paid' ||
      existing.payment_status === 'refunded' ||
      existing.status === 'delivered' ||
      String(existing.notes || '').includes('[VOIDED]')
    ) {
      throw new Error(
        `HARD_DELETE_FORBIDDEN: Closed or settled financial invoice #${existing.order_number} (id: ${existing.id}) cannot be permanently deleted. Use void_closed_order_atomic instead.`
      );
    }
    orders.delete(orderId);
  }

  function directDeletePaymentHistory(orderId) {
    throw new Error(
      `HARD_DELETE_FORBIDDEN: Financial payment_history records are immutable and cannot be deleted (order_id: ${orderId}).`
    );
  }

  function directInsertOrderItem(orderId, item) {
    checkTicketNotClosedTrigger('INSERT', orderId);
    orderItems.push({ ...item, order_id: orderId });
  }

  function directUpdateOrderItem(itemId, patch) {
    const idx = orderItems.findIndex(i => i.id === itemId);
    if (idx === -1) throw new Error('ITEM_NOT_FOUND');
    checkTicketNotClosedTrigger('UPDATE', orderItems[idx].order_id);
    Object.assign(orderItems[idx], patch);
  }

  function directDeleteOrderItem(itemId) {
    const idx = orderItems.findIndex(i => i.id === itemId);
    if (idx === -1) throw new Error('ITEM_NOT_FOUND');
    checkTicketNotClosedTrigger('DELETE', orderItems[idx].order_id);
    orderItems.splice(idx, 1);
  }

  function directUpdateOrderTotal(orderId, newTotal) {
    const existing = orders.get(orderId);
    if (!existing) throw new Error('ORDER_NOT_FOUND');
    if (existing.ticket_status === 'CLOSED' && newTotal !== existing.total_amount && !authorizedAmendmentGuc) {
      throw new Error('Invalid operation: Total amount of a closed ticket cannot be modified.');
    }
    existing.total_amount = newTotal;
  }

  // Simulates public.void_closed_order_atomic
  function rpcVoidClosedOrderAtomic(
    { p_order_id, p_reason, p_idempotency_key = null },
    actor = { user_id: 'mgr-uuid-1', email: 'manager@limra.pos', role: 'manager' }
  ) {
    if (!hasRole(actor?.role, ['owner', 'manager', 'admin'])) {
      securityAuditLogs.push({
        id: `audit-${securityAuditLogs.length + 1}`,
        user_id: actor?.user_id || null,
        action: 'ORDER_VOID_REJECTED',
        result: 'forbidden',
        details: {
          order_id: p_order_id,
          reason: p_reason,
          actor_role: actor?.role || 'anonymous',
          error: 'FORBIDDEN: Manager, Owner, or Admin role required to void a closed order'
        },
        created_at: new Date().toISOString()
      });
      return {
        data: null,
        error: {
          message: 'FORBIDDEN: Manager, Owner, or Admin authorization is required to void closed financial invoices'
        }
      };
    }

    if (!p_order_id) {
      return { data: null, error: { message: 'ORDER_ID_REQUIRED: Order ID is required' } };
    }

    const cleanReason = String(p_reason || '').trim();
    if (cleanReason.length < 3) {
      return {
        data: null,
        error: { message: 'REASON_REQUIRED: A valid reason (minimum 3 characters) is required to void an invoice' }
      };
    }

    const cleanKey = String(p_idempotency_key || '').trim() || null;
    const order = orders.get(p_order_id);
    if (!order) {
      return { data: null, error: { message: `ORDER_NOT_FOUND: Order ${p_order_id} does not exist` } };
    }

    // Idempotency & Duplicate Void Prevention
    if (order.payment_status === 'refunded' || String(order.notes || '').includes('[VOIDED]')) {
      if (
        cleanKey &&
        securityAuditLogs.some(
          l =>
            l.action === 'ORDER_VOID' &&
            String(l.details?.order_id) === String(order.id) &&
            l.details?.idempotency_key === cleanKey
        )
      ) {
        return {
          data: {
            success: true,
            idempotent_replay: true,
            order_id: order.id,
            order_number: order.order_number,
            status: order.status,
            payment_status: order.payment_status,
            ticket_status: order.ticket_status,
            total_amount: order.total_amount,
            voided: true,
            reason: cleanReason,
            message: 'Order already voided (idempotent replay)'
          },
          error: null
        };
      }
      return {
        data: null,
        error: { message: `ORDER_ALREADY_VOIDED: Order #${order.order_number} has already been voided` }
      };
    }

    const prevPayStatus = order.payment_status || 'paid';
    const currentItems = orderItems
      .filter(i => i.order_id === p_order_id)
      .map(i => ({ ...i }));

    const origSnapshot = {
      order_id: order.id,
      order_number: order.order_number,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      order_type: order.order_type,
      table_number: order.table_number,
      total_amount: order.total_amount,
      status: order.status,
      payment_status: order.payment_status,
      payment_method: order.payment_method,
      ticket_status: order.ticket_status,
      notes: order.notes,
      created_at: order.created_at,
      items: currentItems
    };

    const nowIso = new Date().toISOString();
    const voidTag = `[VOIDED] [VOID_REASON: ${cleanReason}] [VOIDED_BY: ${actor.email} (${actor.role})] [VOIDED_AT: ${nowIso}] [ORIG_TOTAL: ${order.total_amount}]`;
    order.payment_status = 'refunded';
    order.ticket_status = 'CLOSED';
    order.notes = `${order.notes || ''} ${voidTag}`.trim();
    order.updated_at = nowIso;

    paymentHistory.push({
      id: `ph-${paymentHistory.length + 1}`,
      order_id: p_order_id,
      user_id: actor.user_id,
      previous_status: prevPayStatus,
      new_status: 'refunded',
      changed_by: actor.user_id || actor.email,
      notes: `VOIDED INVOICE #${order.order_number}: ${cleanReason}`,
      reason: cleanReason,
      created_at: nowIso
    });

    const auditDetails = {
      order_id: order.id,
      order_number: order.order_number,
      original_order_reference: {
        order_id: order.id,
        order_number: order.order_number,
        created_at: order.created_at
      },
      actor: {
        user_id: actor.user_id,
        email: actor.email,
        role: actor.role
      },
      timestamp: nowIso,
      reason: cleanReason,
      idempotency_key: cleanKey,
      original_invoice: origSnapshot,
      adjustment_details: {
        action_type: 'VOID',
        previous_payment_status: prevPayStatus,
        new_payment_status: 'refunded',
        previous_total: order.total_amount,
        voided_amount: order.total_amount,
        net_effective_total: 0
      }
    };

    securityAuditLogs.push({
      id: `audit-${securityAuditLogs.length + 1}`,
      user_id: actor.user_id,
      action: 'ORDER_VOID',
      result: 'success',
      details: auditDetails,
      created_at: nowIso
    });

    return {
      data: {
        success: true,
        idempotent_replay: false,
        order_id: order.id,
        order_number: order.order_number,
        status: order.status,
        payment_status: order.payment_status,
        ticket_status: order.ticket_status,
        total_amount: order.total_amount,
        notes: order.notes,
        voided: true,
        reason: cleanReason,
        actor: { user_id: actor.user_id, email: actor.email, role: actor.role },
        audit_details: auditDetails,
        message: 'Invoice voided and recorded in financial audit log'
      },
      error: null
    };
  }

  // Simulates public.amend_closed_order_atomic
  function rpcAmendClosedOrderAtomic(
    { p_order_id, p_updated_items, p_updated_fields = {}, p_reason, p_idempotency_key = null },
    actor = { user_id: 'mgr-uuid-1', email: 'manager@limra.pos', role: 'manager' }
  ) {
    if (!hasRole(actor?.role, ['owner', 'manager', 'admin'])) {
      securityAuditLogs.push({
        id: `audit-${securityAuditLogs.length + 1}`,
        user_id: actor?.user_id || null,
        action: 'ORDER_AMENDMENT_REJECTED',
        result: 'forbidden',
        details: {
          order_id: p_order_id,
          reason: p_reason,
          actor_role: actor?.role || 'anonymous',
          error: 'FORBIDDEN: Manager, Owner, or Admin role required to amend a closed order'
        },
        created_at: new Date().toISOString()
      });
      return {
        data: null,
        error: {
          message: 'FORBIDDEN: Manager, Owner, or Admin authorization is required to amend closed financial invoices'
        }
      };
    }

    if (!p_order_id) {
      return { data: null, error: { message: 'ORDER_ID_REQUIRED: Order ID is required' } };
    }

    const cleanReason = String(p_reason || '').trim();
    if (cleanReason.length < 3) {
      return {
        data: null,
        error: { message: 'REASON_REQUIRED: A valid reason (minimum 3 characters) is required to amend a closed invoice' }
      };
    }

    if (!Array.isArray(p_updated_items) || p_updated_items.length === 0) {
      return {
        data: null,
        error: {
          message:
            'ITEMS_REQUIRED: An amended invoice must contain at least one item. To void the entire invoice, use void_closed_order_atomic.'
        }
      };
    }

    const cleanKey = String(p_idempotency_key || '').trim() || null;
    const order = orders.get(p_order_id);
    if (!order) {
      return { data: null, error: { message: `ORDER_NOT_FOUND: Order ${p_order_id} does not exist` } };
    }

    if (order.payment_status === 'refunded' || String(order.notes || '').includes('[VOIDED]')) {
      return {
        data: null,
        error: { message: `ORDER_ALREADY_VOIDED: Voided order #${order.order_number} cannot be amended` }
      };
    }

    if (
      cleanKey &&
      securityAuditLogs.some(
        l =>
          l.action === 'ORDER_AMENDMENT' &&
          String(l.details?.order_id) === String(order.id) &&
          l.details?.idempotency_key === cleanKey
      )
    ) {
      const existingItems = orderItems.filter(i => i.order_id === p_order_id).map(i => ({ ...i }));
      return {
        data: {
          success: true,
          idempotent_replay: true,
          order_id: order.id,
          order_number: order.order_number,
          total_amount: order.total_amount,
          payment_status: order.payment_status,
          ticket_status: order.ticket_status,
          items: existingItems,
          reason: cleanReason,
          message: 'Order amendment already applied (idempotent replay)'
        },
        error: null
      };
    }

    const prevTotal = Number(order.total_amount || 0);
    const origItems = orderItems.filter(i => i.order_id === p_order_id).map(i => ({ ...i }));
    const origSnapshot = {
      order_id: order.id,
      order_number: order.order_number,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      order_type: order.order_type,
      table_number: order.table_number,
      total_amount: order.total_amount,
      status: order.status,
      payment_status: order.payment_status,
      payment_method: order.payment_method,
      ticket_status: order.ticket_status,
      notes: order.notes,
      created_at: order.created_at,
      items: origItems
    };

    // Enable transaction-local GUC set_config('limra.authorized_amendment', 'true', true)
    authorizedAmendmentGuc = true;
    try {
      // Remove old items for this order
      for (let i = orderItems.length - 1; i >= 0; i--) {
        if (orderItems[i].order_id === p_order_id) {
          checkTicketNotClosedTrigger('DELETE', p_order_id);
          orderItems.splice(i, 1);
        }
      }

      let itemsSubtotal = 0;
      const nowIso = new Date().toISOString();
      for (const rawItem of p_updated_items) {
        checkTicketNotClosedTrigger('INSERT', p_order_id);
        const qty = Math.max(1, Number(rawItem.quantity ?? rawItem.qty ?? 1));
        const price = Math.max(0, Number(rawItem.unit_price ?? rawItem.price ?? 0));
        const lineTotal = Number((qty * price).toFixed(2));
        itemsSubtotal += lineTotal;
        orderItems.push({
          id: `oi-amend-${orderItems.length + 1}`,
          order_id: p_order_id,
          menu_item_id: rawItem.menu_item_id ?? null,
          item_name: rawItem.item_name || rawItem.name || 'Item',
          quantity: qty,
          unit_price: price,
          line_total: lineTotal,
          created_at: nowIso
        });
      }

      let newTotal = 0;
      if (p_updated_fields && p_updated_fields.total_amount !== undefined && p_updated_fields.total_amount !== null) {
        newTotal = Number(Number(p_updated_fields.total_amount).toFixed(2));
      } else {
        const billing = calculateOrderBilling({
          items: p_updated_items.map(it => ({
            name: it.item_name || it.name,
            price: Number(it.unit_price ?? it.price ?? 0),
            qty: Number(it.quantity ?? it.qty ?? 1)
          }))
        });
        newTotal = billing.grandTotal;
      }

      directUpdateOrderTotal(p_order_id, newTotal);

      const baseNotes = p_updated_fields?.notes || order.notes || '';
      const amendTag = `[AMENDED] [AMEND_REASON: ${cleanReason}] [AMENDED_BY: ${actor.email} (${actor.role})] [AMENDED_AT: ${nowIso}] [ORIG_TOTAL: ${prevTotal}]`;
      order.customer_name = p_updated_fields?.customer_name || order.customer_name;
      order.customer_phone = p_updated_fields?.customer_phone || order.customer_phone;
      order.order_type = p_updated_fields?.order_type || order.order_type;
      if ('table_number' in (p_updated_fields || {})) {
        order.table_number = p_updated_fields.table_number;
      }
      order.notes = `${baseNotes} ${amendTag}`.trim();
      order.updated_at = nowIso;

      const updatedItems = orderItems.filter(i => i.order_id === p_order_id).map(i => ({ ...i }));
      const amountDelta = Number((newTotal - prevTotal).toFixed(2));

      paymentHistory.push({
        id: `ph-${paymentHistory.length + 1}`,
        order_id: p_order_id,
        user_id: actor.user_id,
        previous_status: order.payment_status,
        new_status: order.payment_status,
        changed_by: actor.user_id || actor.email,
        notes: `AMENDED INVOICE #${order.order_number} (Total: ₹${prevTotal} -> ₹${newTotal}): ${cleanReason}`,
        reason: cleanReason,
        created_at: nowIso
      });

      const auditDetails = {
        order_id: order.id,
        order_number: order.order_number,
        original_order_reference: {
          order_id: order.id,
          order_number: order.order_number,
          created_at: order.created_at
        },
        actor: {
          user_id: actor.user_id,
          email: actor.email,
          role: actor.role
        },
        timestamp: nowIso,
        reason: cleanReason,
        idempotency_key: cleanKey,
        original_invoice: origSnapshot,
        adjustment_details: {
          action_type: 'AMENDMENT',
          previous_total: prevTotal,
          new_total: newTotal,
          amount_delta: amountDelta,
          previous_items: origItems,
          updated_items: updatedItems
        }
      };

      securityAuditLogs.push({
        id: `audit-${securityAuditLogs.length + 1}`,
        user_id: actor.user_id,
        action: 'ORDER_AMENDMENT',
        result: 'success',
        details: auditDetails,
        created_at: nowIso
      });

      return {
        data: {
          success: true,
          idempotent_replay: false,
          order_id: order.id,
          order_number: order.order_number,
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          order_type: order.order_type,
          table_number: order.table_number,
          total_amount: order.total_amount,
          previous_total: prevTotal,
          amount_delta: amountDelta,
          status: order.status,
          payment_status: order.payment_status,
          ticket_status: order.ticket_status,
          notes: order.notes,
          items: updatedItems,
          reason: cleanReason,
          actor: { user_id: actor.user_id, email: actor.email, role: actor.role },
          audit_details: auditDetails,
          message: 'Closed invoice amended and recorded in financial audit log'
        },
        error: null
      };
    } finally {
      authorizedAmendmentGuc = false;
    }
  }

  return {
    orders,
    orderItems,
    paymentHistory,
    securityAuditLogs,
    toasts,
    seedClosedOrder,
    directDeleteOrder,
    directDeletePaymentHistory,
    directInsertOrderItem,
    directUpdateOrderItem,
    directDeleteOrderItem,
    directUpdateOrderTotal,
    rpcVoidClosedOrderAtomic,
    rpcAmendClosedOrderAtomic
  };
}

describe('TASK 1.3 — Static Architecture & Database Trigger / RPC Contract Verification', () => {
  it('1. deleteUniversalOrder / deleteClosedOrder and saveClosedOrderCorrections no longer perform hard deletes on orders or order_items', () => {
    const voidFnBody = extractFunctionBody(adminJs, 'async function voidClosedOrder(');
    const deleteUniversalBody = extractFunctionBody(adminJs, 'async function deleteUniversalOrder(');
    const saveCorrectionsBody = extractFunctionBody(adminJs, 'async function saveClosedOrderCorrections(');

    // voidClosedOrder must call void_closed_order_atomic and never delete from orders or order_items
    assert.ok(
      voidFnBody.includes("insforge.database.rpc('void_closed_order_atomic'"),
      'voidClosedOrder must route through insforge.database.rpc(void_closed_order_atomic)'
    );
    assert.ok(
      !voidFnBody.includes(".from('orders').delete()"),
      'voidClosedOrder must not execute .from(orders).delete()'
    );
    assert.ok(
      !voidFnBody.includes(".from('order_items').delete()"),
      'voidClosedOrder must not execute .from(order_items).delete()'
    );

    // deleteUniversalOrder must delegate to voidClosedOrder
    assert.ok(
      deleteUniversalBody.includes('voidClosedOrder('),
      'deleteUniversalOrder must delegate to voidClosedOrder'
    );

    // saveClosedOrderCorrections must route through amend_closed_order_atomic and never directly mutate order_items or orders
    assert.ok(
      saveCorrectionsBody.includes("insforge.database.rpc('amend_closed_order_atomic'"),
      'saveClosedOrderCorrections must route through insforge.database.rpc(amend_closed_order_atomic)'
    );
    assert.ok(
      !saveCorrectionsBody.includes(".from('order_items').delete()"),
      'saveClosedOrderCorrections must not directly delete from order_items'
    );
    assert.ok(
      !saveCorrectionsBody.includes(".from('order_items').insert("),
      'saveClosedOrderCorrections must not directly insert into order_items'
    );
    assert.ok(
      !saveCorrectionsBody.includes(".from('orders').update("),
      'saveClosedOrderCorrections must not directly update closed orders outside amend_closed_order_atomic'
    );
  });

  it('2. database/schema.sql defines void_closed_order_atomic, amend_closed_order_atomic, check_ticket_not_closed, and hard-delete prevention triggers', () => {
    assert.ok(
      schemaSql.includes('CREATE OR REPLACE FUNCTION public.void_closed_order_atomic('),
      'schema.sql must define public.void_closed_order_atomic'
    );
    assert.ok(
      schemaSql.includes('CREATE OR REPLACE FUNCTION public.amend_closed_order_atomic('),
      'schema.sql must define public.amend_closed_order_atomic'
    );
    assert.ok(
      schemaSql.includes('BEFORE INSERT OR UPDATE OR DELETE ON public.order_items'),
      'trg_check_ticket_not_closed must protect BEFORE INSERT OR UPDATE OR DELETE on public.order_items'
    );
    assert.ok(
      schemaSql.includes("current_setting('limra.authorized_amendment', true)"),
      'check_ticket_not_closed and validate_order_state_transitions must check transaction-local limra.authorized_amendment GUC'
    );
    assert.ok(
      migrationSql.includes("current_setting('limra.authorized_amendment', true)"),
      'migration SQL must also check transaction-local limra.authorized_amendment GUC'
    );
    assert.ok(
      schemaSql.includes('CREATE OR REPLACE FUNCTION public.prevent_financial_order_delete()'),
      'schema.sql must define prevent_financial_order_delete trigger function'
    );
    assert.ok(
      schemaSql.includes('CREATE OR REPLACE FUNCTION public.prevent_payment_history_delete()'),
      'schema.sql must define prevent_payment_history_delete trigger function'
    );
    assert.ok(
      adminHtml.includes('id="closed-edit-reason-input"'),
      'admin.html must include #closed-edit-reason-input for mandatory void/amendment audit reason'
    );
  });
});

describe('TASK 1.3 — Required Behavioral & Security Test Cases (1–8)', () => {
  it('Test 1: Authorized void by manager/owner/admin succeeds, records actor/timestamp/reason/original_invoice, and marks order refunded', () => {
    const sandbox = createVoidAmendSandbox();
    sandbox.seedClosedOrder({
      id: 'ord-void-auth-1',
      order_number: 501,
      total_amount: 525
    });

    const res = sandbox.rpcVoidClosedOrderAtomic(
      {
        p_order_id: 'ord-void-auth-1',
        p_reason: 'Customer double-charged by mistake on terminal',
        p_idempotency_key: 'void-key-501'
      },
      { user_id: 'mgr-101', email: 'manager@limra.pos', role: 'manager' }
    );

    assert.equal(res.error, null);
    assert.equal(res.data.success, true);
    assert.equal(res.data.idempotent_replay, false);
    assert.equal(res.data.payment_status, 'refunded');
    assert.equal(res.data.ticket_status, 'CLOSED');
    assert.equal(res.data.voided, true);

    const updatedOrder = sandbox.orders.get('ord-void-auth-1');
    assert.ok(updatedOrder, 'Order row must still exist in orders table (never hard-deleted)');
    assert.equal(updatedOrder.payment_status, 'refunded');
    assert.ok(updatedOrder.notes.includes('[VOIDED]'));
    assert.ok(updatedOrder.notes.includes('[VOID_REASON: Customer double-charged by mistake on terminal]'));
  });

  it('Test 2: Unauthorized void attempts (anonymous, customer, kitchen, cashier) are rejected and logged', async () => {
    const sandbox = createVoidAmendSandbox();
    sandbox.seedClosedOrder({ id: 'ord-unauth-502', order_number: 502, total_amount: 640 });

    for (const unauthorizedRole of [null, 'anonymous', 'customer', 'kitchen', 'cashier']) {
      const res = sandbox.rpcVoidClosedOrderAtomic(
        {
          p_order_id: 'ord-unauth-502',
          p_reason: 'Attempting unauthorized void',
          p_idempotency_key: `unauth-${unauthorizedRole}`
        },
        { user_id: `user-${unauthorizedRole}`, email: `${unauthorizedRole}@limra.pos`, role: unauthorizedRole }
      );

      assert.ok(res.error, `Role '${unauthorizedRole}' must be rejected when attempting to void a closed order`);
      assert.match(res.error.message, /FORBIDDEN/i);
    }

    // Order must remain untouched and paid
    const order = sandbox.orders.get('ord-unauth-502');
    assert.equal(order.payment_status, 'paid');
    assert.ok(!order.notes.includes('[VOIDED]'));

    // Every rejected attempt must be logged in security_audit_logs
    const rejectedLogs = sandbox.securityAuditLogs.filter(l => l.action === 'ORDER_VOID_REJECTED');
    assert.equal(rejectedLogs.length, 5);

    // Also verify HTTP API /api/db and /api/orders reject unauthenticated calls to void_closed_order_atomic
    const { req: dbReq, res: dbRes, resData: dbResData } = createMockReqRes({
      method: 'POST',
      body: {
        action: 'rpc',
        rpc: 'void_closed_order_atomic',
        params: { p_order_id: 'ord-unauth-502', p_reason: 'Bypass attempt' }
      }
    });
    await dbHandler(dbReq, dbRes);
    assert.equal(dbResData.statusCode, 401, '/api/db must reject unauthenticated void_closed_order_atomic call with 401');

    const { req: ordReq, res: ordRes, resData: ordResData } = createMockReqRes({
      method: 'PATCH',
      body: {
        id: 'ord-unauth-502',
        action: 'void',
        reason: 'Bypass attempt'
      }
    });
    await ordersHandler(ordReq, ordRes);
    assert.equal(ordResData.statusCode, 401, 'PATCH /api/orders must reject unauthenticated void with 401');
  });

  it('Test 3: Missing or too-short reason is rejected with REASON_REQUIRED on both void and amendment', () => {
    const sandbox = createVoidAmendSandbox();
    sandbox.seedClosedOrder({ id: 'ord-noreason-503', order_number: 503, total_amount: 525 });

    const managerActor = { user_id: 'mgr-1', email: 'manager@limra.pos', role: 'manager' };

    // Void with empty/null/short reason
    for (const invalidReason of [null, '', '   ', 'ab']) {
      const voidRes = sandbox.rpcVoidClosedOrderAtomic(
        { p_order_id: 'ord-noreason-503', p_reason: invalidReason },
        managerActor
      );
      assert.ok(voidRes.error, `Void with invalid reason "${invalidReason}" must fail`);
      assert.match(voidRes.error.message, /REASON_REQUIRED/);
    }

    // Amendment with empty/null/short reason
    for (const invalidReason of [null, '', '   ', 'ok']) {
      const amendRes = sandbox.rpcAmendClosedOrderAtomic(
        {
          p_order_id: 'ord-noreason-503',
          p_updated_items: [{ item_name: 'Chicken Biryani Full', quantity: 1, unit_price: 200 }],
          p_reason: invalidReason
        },
        managerActor
      );
      assert.ok(amendRes.error, `Amendment with invalid reason "${invalidReason}" must fail`);
      assert.match(amendRes.error.message, /REASON_REQUIRED/);
    }

    // Verify order was not altered
    const order = sandbox.orders.get('ord-noreason-503');
    assert.equal(order.payment_status, 'paid');
    assert.equal(order.total_amount, 525);
  });

  it('Test 4: Duplicate void request is idempotent with matching key and rejected with ORDER_ALREADY_VOIDED otherwise', () => {
    const sandbox = createVoidAmendSandbox();
    sandbox.seedClosedOrder({ id: 'ord-dup-void-504', order_number: 504, total_amount: 525 });
    const managerActor = { user_id: 'mgr-1', email: 'manager@limra.pos', role: 'manager' };

    // First void succeeds
    const first = sandbox.rpcVoidClosedOrderAtomic(
      {
        p_order_id: 'ord-dup-void-504',
        p_reason: 'Guest cancelled after wrong dish served',
        p_idempotency_key: 'idem-void-504-a'
      },
      managerActor
    );
    assert.equal(first.error, null);
    assert.equal(first.data.idempotent_replay, false);

    // Network retry with same idempotency key returns idempotent_replay: true without duplicate records
    const replay = sandbox.rpcVoidClosedOrderAtomic(
      {
        p_order_id: 'ord-dup-void-504',
        p_reason: 'Guest cancelled after wrong dish served',
        p_idempotency_key: 'idem-void-504-a'
      },
      managerActor
    );
    assert.equal(replay.error, null);
    assert.equal(replay.data.idempotent_replay, true);

    // Second distinct void request (different key or no key) is rejected with ORDER_ALREADY_VOIDED
    const duplicate = sandbox.rpcVoidClosedOrderAtomic(
      {
        p_order_id: 'ord-dup-void-504',
        p_reason: 'Second manager trying to void again',
        p_idempotency_key: 'idem-void-504-b'
      },
      managerActor
    );
    assert.ok(duplicate.error);
    assert.match(duplicate.error.message, /ORDER_ALREADY_VOIDED/);

    // Verify only ONE 'refunded' payment_history row and ONE 'ORDER_VOID' audit log were created
    const refundHistory = sandbox.paymentHistory.filter(
      ph => ph.order_id === 'ord-dup-void-504' && ph.new_status === 'refunded'
    );
    assert.equal(refundHistory.length, 1, 'Must insert exactly 1 refunded row in payment_history');

    const voidLogs = sandbox.securityAuditLogs.filter(
      l => l.action === 'ORDER_VOID' && l.details?.order_id === 'ord-dup-void-504'
    );
    assert.equal(voidLogs.length, 1, 'Must insert exactly 1 ORDER_VOID row in security_audit_logs');
  });

  it('Test 5: Amendment of closed order atomically updates items and recalculates total without check_ticket_not_closed failure, while blocking direct table edits', () => {
    const sandbox = createVoidAmendSandbox();
    sandbox.seedClosedOrder({
      id: 'ord-amend-505',
      order_number: 505,
      total_amount: 525
    });

    // 5A. Direct INSERT / UPDATE / DELETE on order_items of a CLOSED order must be blocked by check_ticket_not_closed
    assert.throws(
      () => sandbox.directInsertOrderItem('ord-amend-505', { item_name: 'Extra Raita', quantity: 1, unit_price: 40 }),
      /Cannot attach items to a CLOSED ticket/,
      'Direct INSERT on order_items of a CLOSED order must be blocked by check_ticket_not_closed'
    );
    assert.throws(
      () => sandbox.directUpdateOrderItem('item-1', { quantity: 5 }),
      /Cannot directly modify items on a CLOSED ticket/,
      'Direct UPDATE on order_items of a CLOSED order must be blocked'
    );
    assert.throws(
      () => sandbox.directDeleteOrderItem('item-2'),
      /Cannot directly delete items from a CLOSED ticket/,
      'Direct DELETE on order_items of a CLOSED order must be blocked'
    );
    assert.throws(
      () => sandbox.directUpdateOrderTotal('ord-amend-505', 100),
      /Total amount of a closed ticket cannot be modified/,
      'Direct total_amount modification on a CLOSED order must be blocked'
    );

    // 5B. Authorized atomic amendment via amend_closed_order_atomic succeeds cleanly
    const updatedCart = [
      { menu_item_id: 101, item_name: 'Chicken Biryani Full', quantity: 3, unit_price: 200 }, // 600
      { menu_item_id: 105, item_name: 'Phirni Dessert', quantity: 2, unit_price: 60 }         // 120 -> subtotal 720, 5% GST = 36 -> 756
    ];
    const billing = calculateOrderBilling({
      items: updatedCart.map(i => ({ name: i.item_name, price: i.unit_price, qty: i.quantity }))
    });
    assert.equal(billing.grandTotal, 756);

    const amendRes = sandbox.rpcAmendClosedOrderAtomic(
      {
        p_order_id: 'ord-amend-505',
        p_updated_items: updatedCart,
        p_updated_fields: {
          customer_name: 'Aamir Siddiqui',
          total_amount: billing.grandTotal
        },
        p_reason: 'Added 1 Chicken Biryani and 2 Phirni per table bill correction',
        p_idempotency_key: 'amend-505-1'
      },
      { user_id: 'owner-1', email: 'owner@limra.pos', role: 'owner' }
    );

    assert.equal(amendRes.error, null);
    assert.equal(amendRes.data.success, true);
    assert.equal(amendRes.data.previous_total, 525);
    assert.equal(amendRes.data.total_amount, 756);
    assert.equal(amendRes.data.amount_delta, 231);
    assert.equal(amendRes.data.items.length, 2);

    const updatedOrder = sandbox.orders.get('ord-amend-505');
    assert.equal(updatedOrder.total_amount, 756);
    assert.equal(updatedOrder.ticket_status, 'CLOSED');
    assert.ok(updatedOrder.notes.includes('[AMENDED]'));
    assert.ok(updatedOrder.notes.includes('[ORIG_TOTAL: 525]'));
  });

  it('Test 6: Original invoice remains auditable after void or amendment (preserved in orders/order_items and security_audit_logs)', () => {
    const sandbox = createVoidAmendSandbox();
    sandbox.seedClosedOrder({
      id: 'ord-audit-506',
      order_number: 506,
      total_amount: 525
    });

    // Hard deletion of a closed financial invoice is unconditionally forbidden
    assert.throws(
      () => sandbox.directDeleteOrder('ord-audit-506'),
      /HARD_DELETE_FORBIDDEN/,
      'Hard DELETE on a closed financial order must be blocked by trg_prevent_financial_order_delete'
    );

    // First amend the order, then verify original_invoice snapshot in security_audit_logs
    sandbox.rpcAmendClosedOrderAtomic(
      {
        p_order_id: 'ord-audit-506',
        p_updated_items: [{ menu_item_id: 101, item_name: 'Chicken Biryani Full', quantity: 1, unit_price: 200 }],
        p_updated_fields: { total_amount: 210 },
        p_reason: 'Reduced Biryani quantity from 2 to 1 and removed Naan',
        p_idempotency_key: 'amend-506-key'
      },
      { user_id: 'mgr-2', email: 'manager2@limra.pos', role: 'manager' }
    );

    const amendLog = sandbox.securityAuditLogs.find(
      l => l.action === 'ORDER_AMENDMENT' && l.details?.order_id === 'ord-audit-506'
    );
    assert.ok(amendLog, 'Amendment audit log must be recorded');
    assert.equal(amendLog.details.actor.email, 'manager2@limra.pos');
    assert.equal(amendLog.details.actor.role, 'manager');
    assert.ok(amendLog.details.timestamp, 'Timestamp must be stored');
    assert.equal(amendLog.details.original_order_reference.order_number, 506);
    assert.equal(amendLog.details.reason, 'Reduced Biryani quantity from 2 to 1 and removed Naan');
    assert.equal(amendLog.details.original_invoice.total_amount, 525, 'Original pre-amendment total must be preserved');
    assert.equal(amendLog.details.original_invoice.items.length, 2, 'Original pre-amendment items must be preserved');
    assert.equal(amendLog.details.adjustment_details.previous_total, 525);
    assert.equal(amendLog.details.adjustment_details.new_total, 210);
    assert.equal(amendLog.details.adjustment_details.amount_delta, -315);

    // Now void the order and verify both the order row, order_items, and void snapshot remain intact
    sandbox.rpcVoidClosedOrderAtomic(
      {
        p_order_id: 'ord-audit-506',
        p_reason: 'Order fully refunded after manager review',
        p_idempotency_key: 'void-506-key'
      },
      { user_id: 'mgr-2', email: 'manager2@limra.pos', role: 'manager' }
    );

    assert.ok(sandbox.orders.has('ord-audit-506'), 'Order record must remain in orders table after void');
    const remainingItems = sandbox.orderItems.filter(i => i.order_id === 'ord-audit-506');
    assert.equal(remainingItems.length, 1, 'Order items must remain attached to voided order for auditability');

    const voidLog = sandbox.securityAuditLogs.find(
      l => l.action === 'ORDER_VOID' && l.details?.order_id === 'ord-audit-506'
    );
    assert.ok(voidLog, 'Void audit log must be recorded');
    assert.equal(voidLog.details.original_invoice.total_amount, 210);
    assert.equal(voidLog.details.adjustment_details.voided_amount, 210);
    assert.equal(voidLog.details.adjustment_details.net_effective_total, 0);
  });

  it('Test 7: Payment history remains intact across settlement, amendment, and void, and cannot be deleted', () => {
    const sandbox = createVoidAmendSandbox();
    sandbox.seedClosedOrder({
      id: 'ord-ph-507',
      order_number: 507,
      total_amount: 525
    });

    // Initial state has 1 'paid' entry from settlement
    const initialHistory = sandbox.paymentHistory.filter(ph => ph.order_id === 'ord-ph-507');
    assert.equal(initialHistory.length, 1);
    assert.equal(initialHistory[0].new_status, 'paid');

    // Amend order -> appends 1 amendment audit entry to payment_history
    sandbox.rpcAmendClosedOrderAtomic(
      {
        p_order_id: 'ord-ph-507',
        p_updated_items: [{ menu_item_id: 101, item_name: 'Chicken Biryani Full', quantity: 2, unit_price: 200 }],
        p_updated_fields: { total_amount: 420 },
        p_reason: 'Removed Butter Naan from invoice'
      },
      { user_id: 'mgr-1', email: 'manager@limra.pos', role: 'manager' }
    );

    // Void order -> appends 1 'refunded' entry to payment_history
    sandbox.rpcVoidClosedOrderAtomic(
      {
        p_order_id: 'ord-ph-507',
        p_reason: 'Voided invoice on customer complaint'
      },
      { user_id: 'mgr-1', email: 'manager@limra.pos', role: 'manager' }
    );

    const finalHistory = sandbox.paymentHistory.filter(ph => ph.order_id === 'ord-ph-507');
    assert.equal(finalHistory.length, 3, 'All historical payment_history entries must be preserved in sequence');
    assert.equal(finalHistory[0].new_status, 'paid', 'Original settlement payment_history entry must remain intact');
    assert.match(finalHistory[1].notes, /AMENDED INVOICE #507/);
    assert.equal(finalHistory[2].previous_status, 'paid');
    assert.equal(finalHistory[2].new_status, 'refunded');
    assert.equal(finalHistory[2].reason, 'Voided invoice on customer complaint');

    // Attempting to delete payment_history is blocked by trg_prevent_payment_history_delete
    assert.throws(
      () => sandbox.directDeletePaymentHistory('ord-ph-507'),
      /HARD_DELETE_FORBIDDEN/,
      'Deleting from payment_history must be unconditionally forbidden'
    );
  });

  it('Test 8: Role restrictions are enforced across all roles (owner, manager, admin, cashier, kitchen, customer, anonymous)', () => {
    const allowedRoles = ['owner', 'manager', 'admin'];
    const restrictedRoles = ['cashier', 'kitchen', 'customer', 'anonymous', null];

    // Verify auth-middleware hasRequiredRole
    for (const role of allowedRoles) {
      assert.equal(
        hasRequiredRole(role, ['owner', 'manager', 'admin']),
        true,
        `Role '${role}' must be authorized for manager-level financial void/amendment`
      );
    }
    for (const role of restrictedRoles) {
      assert.equal(
        hasRequiredRole(role, ['owner', 'manager', 'admin']),
        false,
        `Role '${role}' must NOT be authorized for manager-level financial void/amendment`
      );
    }

    // Verify backend/api/db.js STAFF_RESTRICTED_RPCS registers void_closed_order_atomic and amend_closed_order_atomic for owner/manager/admin only
    assert.match(
      dbApiJs,
      /void_closed_order_atomic:\s*\["owner",\s*"manager",\s*"admin"\]/,
      'db.js must restrict void_closed_order_atomic to owner, manager, admin'
    );
    assert.match(
      dbApiJs,
      /amend_closed_order_atomic:\s*\["owner",\s*"manager",\s*"admin"\]/,
      'db.js must restrict amend_closed_order_atomic to owner, manager, admin'
    );
    assert.ok(
      ordersApiJs.includes('void_closed_order_atomic') && ordersApiJs.includes('amend_closed_order_atomic'),
      'orders.js must route closed-order void and amendment through atomic RPCs'
    );
  });
});
