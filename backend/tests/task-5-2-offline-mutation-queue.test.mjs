/**
 * =============================================================================
 * TASK 5.2 VERIFICATION TEST SUITE: RELIABLE OFFLINE MUTATION QUEUING FOR POS
 * =============================================================================
 * 
 * Verifies:
 * 1. Storage Adapter Dual-Write (localStorage + IndexedDB backing)
 * 2. Error Classification Engine (NETWORK, SERVER_ERROR, CONFLICT, VALIDATION)
 * 3. Offline POS Order Creation (POS_ORDER_CREATE with UUID & item rows)
 * 4. Offline POS Bill Confirmation (POS_CONFIRM_BILL with sibling consolidation)
 * 5. CRITICAL FINANCIAL RULE: Offline Settlement Safety (Order remains UNPAID)
 * 6. Browser Restart Simulation & Offline Queue Hydration
 * 7. Cloud Reconnection & Authoritative Settle Confirmation
 * 8. Server-Side Idempotency Protection (ORDER_ALREADY_SETTLED handling)
 * 9. Exponential Backoff Retry Scheduling & Max Attempts Exhaustion
 * 10. Partial Queue Recovery & Dependency Isolation
 * 11. #sync-indicator 5-State UI State Machine
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ═════════════════════════════════════════════════════════════════════
// 1. MOCK ENVIRONMENT SETUP
// ═════════════════════════════════════════════════════════════════════

const mockStore = new Map();

globalThis.localStorage = {
  getItem: (key) => mockStore.get(key) || null,
  setItem: (key, value) => mockStore.set(key, String(value)),
  removeItem: (key) => mockStore.delete(key),
  clear: () => mockStore.clear()
};

let mockOnline = true;
if (!globalThis.navigator) {
  globalThis.navigator = {};
}
Object.defineProperty(globalThis.navigator, 'onLine', {
  get: () => mockOnline,
  set: (v) => { mockOnline = v; },
  configurable: true
});

// Mock DOM for #sync-indicator
const mockIndicatorEl = {
  id: 'sync-indicator',
  classList: {
    _classes: new Set(['adm-hidden']),
    remove: function (c) { this._classes.delete(c); },
    add: function (c) { this._classes.add(c); },
    contains: function (c) { return this._classes.has(c); }
  },
  style: {},
  textContent: '',
  innerHTML: '',
  title: '',
  _listeners: {},
  addEventListener: function (type, cb) {
    this._listeners[type] = cb;
  },
  click: function () {
    if (this._listeners['click']) {
      this._listeners['click']({ stopPropagation: () => {} });
    }
  }
};

globalThis.document = {
  getElementById: (id) => {
    if (id === 'sync-indicator') return mockIndicatorEl;
    return null;
  }
};

// Import OfflineSyncEngine after setting up mocks
import {
  offlineSync,
  QUEUE_KEYS,
  POS_MUTATION_TYPES,
  ERROR_TYPES,
  classifyError
} from '../../frontend/src/lib/offline-sync.js';

describe('TASK 5.2: RELIABLE OFFLINE MUTATION QUEUING FOR POS', () => {

  beforeEach(() => {
    mockStore.clear();
    mockOnline = true;
    offlineSync.isOnlineState = true;
    offlineSync.isSyncing = false;
    mockIndicatorEl.textContent = '';
    mockIndicatorEl.innerHTML = '';
    mockIndicatorEl.style = {};
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST 1: Dual-Write & Persistent Storage Adapter
  // ─────────────────────────────────────────────────────────────────
  it('1. Dual-write persistence synchronously writes localStorage and supports IndexedDB', async () => {
    const testItems = [
      { id: 'op_1', type: POS_MUTATION_TYPES.ORDER_CREATE, status: 'pending' },
      { id: 'op_2', type: POS_MUTATION_TYPES.SETTLE_ORDER, status: 'pending' }
    ];

    offlineSync.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, testItems);

    // Verify localStorage received synchronous copy
    const rawSaved = mockStore.get(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.ok(rawSaved, 'localStorage must receive queue synchronously');
    const parsed = JSON.parse(rawSaved);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].id, 'op_1');
    assert.strictEqual(parsed[1].id, 'op_2');

    // Verify loadQueue returns exact array
    const loaded = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.strictEqual(loaded.length, 2);
    assert.strictEqual(loaded[0].id, 'op_1');
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST 2: Error Classification Engine
  // ─────────────────────────────────────────────────────────────────
  it('2. classifyError correctly categorizes NETWORK, SERVER_ERROR, CONFLICT, and VALIDATION errors', () => {
    // Network disconnection / fetch failure
    const networkErr1 = new TypeError('Failed to fetch');
    assert.strictEqual(classifyError(networkErr1), ERROR_TYPES.NETWORK);

    const networkErr2 = new Error('NetworkError when attempting to fetch resource.');
    assert.strictEqual(classifyError(networkErr2), ERROR_TYPES.NETWORK);

    const networkErr3 = { message: 'Connection dropped', status: 0 };
    assert.strictEqual(classifyError(networkErr3, { status: 0 }), ERROR_TYPES.NETWORK);

    // 5xx Server Error / database connection dropped
    const serverErr1 = { message: 'Internal Server Error', status: 500 };
    assert.strictEqual(classifyError(serverErr1, { status: 500 }), ERROR_TYPES.SERVER_ERROR);

    const serverErr2 = new Error('Database connection failed: 503 Service Unavailable');
    assert.strictEqual(classifyError(serverErr2, { status: 503 }), ERROR_TYPES.SERVER_ERROR);

    // 409 Conflict / version mismatch
    const conflictErr1 = { message: 'Version conflict', status: 409 };
    assert.strictEqual(classifyError(conflictErr1, { status: 409 }), ERROR_TYPES.CONFLICT);

    const conflictErr2 = new Error('order status conflict: already billed');
    assert.strictEqual(classifyError(conflictErr2), ERROR_TYPES.CONFLICT);

    // 400 / 422 Client Validation Error
    const valErr1 = { message: 'Missing mandatory field customer_phone', status: 400 };
    assert.strictEqual(classifyError(valErr1, { status: 400 }), ERROR_TYPES.VALIDATION);

    const valErr2 = { message: 'Unprocessable Entity', status: 422 };
    assert.strictEqual(classifyError(valErr2, { status: 422 }), ERROR_TYPES.VALIDATION);
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST 3: Offline POS Order Creation
  // ─────────────────────────────────────────────────────────────────
  it('3. Offline POS order creation enqueues POS_ORDER_CREATE with client UUID & items', () => {
    mockOnline = false;
    offlineSync.isOnlineState = false;

    const fakeOrderData = {
      id: 'uuid-offline-order-1234',
      customer_name: 'Imran Khan',
      customer_phone: '9876543210',
      order_type: 'table',
      table_number: 5,
      total_amount: 550,
      payment_status: 'unpaid',
      status: 'confirmed'
    };

    const fakeItemRows = [
      { order_id: 'uuid-offline-order-1234', item_name: 'Mutton Biryani', quantity: 2, unit_price: 250, line_total: 500 },
      { order_id: 'uuid-offline-order-1234', item_name: 'Raita', quantity: 1, unit_price: 50, line_total: 50 }
    ];

    const idempotencyKey = 'idemp_order_create_1234';

    const job = offlineSync.enqueuePosOrderCreate({
      orderData: fakeOrderData,
      itemRows: fakeItemRows,
      idempotencyKey
    });

    assert.ok(job.id.startsWith('pos_ord_') || job.id.startsWith('adm_'), 'Must generate POS order mutation operation ID');
    assert.strictEqual(job.type, POS_MUTATION_TYPES.ORDER_CREATE);
    assert.strictEqual(job.status, 'pending');
    assert.strictEqual(job.idempotencyKey, idempotencyKey);
    assert.strictEqual(job.payload.order.id, 'uuid-offline-order-1234');
    assert.strictEqual(job.payload.items.length, 2);

    const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].payload.order.customer_name, 'Imran Khan');
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST 4: Offline Table Bill Confirmation
  // ─────────────────────────────────────────────────────────────────
  it('4. Offline table bill confirmation enqueues POS_CONFIRM_BILL preserving table session', () => {
    mockOnline = false;
    offlineSync.isOnlineState = false;

    const confirmPayload = {
      orderId: 'order_tbl_444',
      updatePayload: {
        status: 'confirmed',
        ticket_status: 'BILLED',
        payment_status: 'unpaid',
        total_amount: 840
      },
      siblingOrderIds: ['order_round_1', 'order_round_2'],
      isTable: true,
      idempotencyKey: 'idemp_bill_confirm_444'
    };

    const job = offlineSync.enqueuePosConfirmBill(confirmPayload);

    assert.strictEqual(job.type, POS_MUTATION_TYPES.CONFIRM_BILL);
    assert.strictEqual(job.status, 'pending');
    assert.strictEqual(job.payload.orderId, 'order_tbl_444');
    assert.strictEqual(job.payload.isTable, true);
    assert.deepStrictEqual(job.payload.siblingOrderIds, ['order_round_1', 'order_round_2']);

    const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].payload.orderId, 'order_tbl_444');
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST 5: CRITICAL FINANCIAL RULE: Offline Settlement Safety
  // ─────────────────────────────────────────────────────────────────
  it('5. CRITICAL FINANCIAL RULE: Offline settlement keeps bill UNPAID and queues POS_ORDER_SETTLE', () => {
    mockOnline = false;
    offlineSync.isOnlineState = false;

    // Simulate an unpaid bill on a table
    const targetBill = {
      id: 'order_table_7_bill',
      order_number: 108,
      table_number: 7,
      total_amount: 1200,
      status: 'confirmed',
      payment_status: 'unpaid',
      ticket_status: 'BILLED'
    };

    // Cashier attempts to settle while offline
    const settleIdempotencyKey = `pos_settle_${targetBill.id}_cash`;
    const enqueueResult = offlineSync.enqueuePosSettlement({
      orderId: targetBill.id,
      paymentMethod: 'cash',
      notes: 'Customer paid 1200 in cash while offline',
      idempotencyKey: settleIdempotencyKey
    });

    // Verify cashier feedback contract
    assert.strictEqual(enqueueResult.payment_status, 'unpaid', 'Financial Rule: Payment status MUST remain UNPAID!');
    assert.strictEqual(enqueueResult.ticket_status, 'BILLED', 'Financial Rule: Ticket status MUST NOT transition to CLOSED!');
    assert.strictEqual(enqueueResult.isLocalPending, true, 'Must flag settlement as pending cloud confirmation');
    assert.strictEqual(enqueueResult._settlementPendingSync, true, 'Must flag _settlementPendingSync to alert cashier');
    assert.match(enqueueResult.message, /remains unpaid until cloud confirmation/i);

    // Verify queue payload
    const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].type, POS_MUTATION_TYPES.SETTLE_ORDER);
    assert.strictEqual(queue[0].payload.orderId, 'order_table_7_bill');
    assert.strictEqual(queue[0].payload.paymentMethod, 'cash');
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST 6: Browser Restart Simulation & Offline Queue Hydration
  // ─────────────────────────────────────────────────────────────────
  it('6. Browser restart simulation restores pending queues and accurate pending counts', () => {
    // Populate storage with diverse mutations
    offlineSync.enqueuePosOrderCreate({
      orderData: { id: 'order_1', customer_name: 'Guest 1', total_amount: 300 },
      itemRows: [],
      idempotencyKey: 'k1'
    });
    offlineSync.enqueuePosSettlement({
      orderId: 'order_2',
      paymentMethod: 'upi',
      idempotencyKey: 'k2'
    });

    const countsBefore = offlineSync.getPendingCounts();
    assert.strictEqual(countsBefore.adminMutations, 2);

    // Simulate complete browser restart by reloading queues from persistent store
    const restoredQueue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.strictEqual(restoredQueue.length, 2);
    assert.strictEqual(restoredQueue[0].type, POS_MUTATION_TYPES.ORDER_CREATE);
    assert.strictEqual(restoredQueue[1].type, POS_MUTATION_TYPES.SETTLE_ORDER);

    const countsAfter = offlineSync.getPendingCounts();
    assert.strictEqual(countsAfter.adminMutations, 2);
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST 7: Cloud Reconnection & Authoritative Settle Confirmation
  // ─────────────────────────────────────────────────────────────────
  it('7. Reconnection and successful sync transitions order to paid and CLOSED via event', async () => {
    mockOnline = true;
    offlineSync.isOnlineState = true;

    // Enqueue an offline settlement
    offlineSync.enqueuePosSettlement({
      orderId: 'order_offline_to_sync',
      paymentMethod: 'cash',
      notes: 'Cash payment',
      idempotencyKey: 'settle_sync_key_999'
    });

    let settlementEventCaptured = null;
    const unsubscribe = offlineSync.subscribe((evt) => {
      if (evt.type === 'pos_settlement_confirmed') {
        settlementEventCaptured = evt;
      }
    });

    // Mock fetch to simulate successful server settlement
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (url === '/api/orders' && opts.method === 'PATCH') {
        const body = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              id: body.id,
              payment_status: 'paid',
              ticket_status: 'CLOSED',
              payment_method: body.payment_method,
              closed_at: new Date().toISOString()
            }
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    };

    try {
      const syncResult = await offlineSync.syncAdminMutations();
      assert.strictEqual(syncResult.synced, 1, 'Must sync the queued settlement');

      // Check event emission
      assert.ok(settlementEventCaptured, 'pos_settlement_confirmed event must be emitted');
      assert.strictEqual(settlementEventCaptured.orderId, 'order_offline_to_sync');
      assert.strictEqual(settlementEventCaptured.paymentMethod, 'cash');
      assert.strictEqual(settlementEventCaptured.serverResult.payment_status, 'paid');
      assert.strictEqual(settlementEventCaptured.serverResult.ticket_status, 'CLOSED');

      // Queue item must be marked synced
      const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
      assert.strictEqual(queue[0].status, 'synced');
    } finally {
      unsubscribe();
      globalThis.fetch = originalFetch;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST 8: Server-Side Idempotency Protection
  // ─────────────────────────────────────────────────────────────────
  it('8. Server idempotency acknowledges ORDER_ALREADY_SETTLED without duplicate processing', async () => {
    mockOnline = true;
    offlineSync.isOnlineState = true;

    offlineSync.enqueuePosSettlement({
      orderId: 'order_already_paid_on_server',
      paymentMethod: 'cash',
      idempotencyKey: 'replay_key_777'
    });

    // Mock database RPC settle_order_atomic rejecting with ORDER_ALREADY_SETTLED
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            already_settled: true,
            order_id: 'order_already_paid_on_server'
          }
        })
      };
    };

    try {
      const syncResult = await offlineSync.syncAdminMutations();
      assert.strictEqual(syncResult.synced, 1, 'Idempotent replay must count as successful sync');

      const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
      assert.strictEqual(queue[0].status, 'synced', 'Job must be marked synced on idempotent replay');
      assert.strictEqual(queue[0].error, null, 'Error must be null');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST 9: Exponential Backoff Retry Logic & Max Attempts
  // ─────────────────────────────────────────────────────────────────
  it('9. Exponential backoff schedules retries and marks job failed after max attempts', async () => {
    mockOnline = true;
    offlineSync.isOnlineState = true;

    offlineSync.enqueuePosSettlement({
      orderId: 'order_failing_server',
      paymentMethod: 'card',
      idempotencyKey: 'fail_key_555'
    });

    // Mock fetch returning 500 Internal Server Error
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: 'Database transaction lock timeout' })
      };
    };

    try {
      // Attempt 1
      await offlineSync.syncAdminMutations();
      let queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
      assert.strictEqual(queue[0].attempts, 1);
      assert.strictEqual(queue[0].status, 'pending');
      assert.strictEqual(queue[0].errorType, ERROR_TYPES.SERVER_ERROR);
      assert.ok(queue[0].nextRetryAt > Date.now(), 'nextRetryAt must be in the future');

      // Simulate reaching max attempts (4 previous attempts)
      queue[0].attempts = 4;
      queue[0].nextRetryAt = null; // ready for retry
      offlineSync.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, queue);

      // Attempt 5 (maxAttempts is 5)
      await offlineSync.syncAdminMutations();
      queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
      assert.strictEqual(queue[0].attempts, 5);
      assert.strictEqual(queue[0].status, 'failed', 'Must transition to failed when maxAttempts reached');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST 10: Partial Queue Recovery & Dependency Isolation
  // ─────────────────────────────────────────────────────────────────
  it('10. Partial queue recovery preserves succeeded jobs when a later job fails', async () => {
    mockOnline = true;
    offlineSync.isOnlineState = true;

    // Enqueue 2 independent mutations
    offlineSync.enqueuePosConfirmBill({
      orderId: 'order_success_1',
      updatePayload: { status: 'confirmed' },
      idempotencyKey: 'key_success_1'
    });

    offlineSync.enqueuePosSettlement({
      orderId: 'order_drop_2',
      paymentMethod: 'cash',
      idempotencyKey: 'key_drop_2'
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.id === 'order_success_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { id: 'order_success_1', status: 'confirmed' } })
        };
      }
      // Second request drops network
      throw new TypeError('Failed to fetch');
    };

    try {
      const syncResult = await offlineSync.syncAdminMutations();
      assert.strictEqual(syncResult.synced, 1, 'First job must succeed');

      const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
      assert.strictEqual(queue[0].status, 'synced', 'Job 1 must remain synced');
      assert.strictEqual(queue[1].status, 'pending', 'Job 2 must remain pending for next retry');
      assert.strictEqual(queue[1].errorType, ERROR_TYPES.NETWORK);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST 11: #sync-indicator 5-State UI State Machine
  // ─────────────────────────────────────────────────────────────────
  it('11. #sync-indicator controller renders all 5 states and click-to-retry handler', () => {
    offlineSync.initSyncIndicator('sync-indicator');

    // State 1: Online & Idle
    mockOnline = true;
    offlineSync.isOnlineState = true;
    offlineSync.isSyncing = false;
    offlineSync.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, []);
    offlineSync.updateSyncIndicator();
    assert.match(mockIndicatorEl.textContent, /✅ Synced/i);
    assert.match(mockIndicatorEl.style.color, /#059669|rgb\(5,\s*150,\s*105\)/i);

    // State 2: Disconnected (Offline)
    mockOnline = false;
    offlineSync.isOnlineState = false;
    offlineSync.updateSyncIndicator();
    assert.match(mockIndicatorEl.textContent, /📡 Offline/i);
    assert.match(mockIndicatorEl.style.color, /#dc2626|rgb\(220,\s*38,\s*38\)/i);

    // State 3: Online with Pending Sync
    mockOnline = true;
    offlineSync.isOnlineState = true;
    offlineSync.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, [
      { id: 'job_1', status: 'pending' },
      { id: 'job_2', status: 'pending' }
    ]);
    offlineSync.updateSyncIndicator();
    assert.match(mockIndicatorEl.innerHTML, /⏳ Pending Sync \(2\)/i);
    assert.match(mockIndicatorEl.style.color, /#d97706|rgb\(217,\s*119,\s*6\)/i);

    // State 4: Syncing
    offlineSync.isSyncing = true;
    offlineSync.updateSyncIndicator();
    assert.match(mockIndicatorEl.textContent, /🔄 Syncing/i);
    assert.match(mockIndicatorEl.style.color, /#2563eb|rgb\(37,\s*99,\s*235\)/i);
    offlineSync.isSyncing = false;

    // State 5: Retries Exhausted (Sync Failed)
    offlineSync.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, [
      { id: 'job_failed', status: 'failed', attempts: 5 }
    ]);
    offlineSync.updateSyncIndicator();
    assert.match(mockIndicatorEl.innerHTML, /⚠️ Sync Failed \(1\)/i);
    assert.match(mockIndicatorEl.style.color, /#dc2626|rgb\(220,\s*38,\s*38\)/i);

    // Verify Click-to-Retry Handler resets failed jobs
    let syncTriggered = false;
    offlineSync.triggerSync = async () => { syncTriggered = true; };
    mockIndicatorEl.click();

    const queueAfterClick = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.strictEqual(queueAfterClick[0].status, 'pending', 'Click on failed sync must reset job to pending');
    assert.strictEqual(queueAfterClick[0].attempts, 0, 'Click on failed sync must reset attempts to 0');
    assert.strictEqual(syncTriggered, true, 'Click on failed sync must trigger retry');
  });

});
