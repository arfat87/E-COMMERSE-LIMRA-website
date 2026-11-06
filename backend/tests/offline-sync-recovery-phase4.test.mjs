/**
 * =============================================================================
 * LIMRA RESTAURANT POS — PHASE 4 VERIFICATION TEST SUITE:
 * OFFLINE SYNC FAILED QUEUE RECOVERY & IDEMPOTENT RECONCILIATION
 * =============================================================================
 * 
 * Verifies all 20 required scenarios:
 * 1.  Valid pending mutation successfully synchronizes.
 * 2.  Transient network failure triggers retry with backoff.
 * 3.  Permanent validation failure marks mutation failed without infinite retry.
 * 4.  Stale pending order creation reconciles with existing cloud order if already present.
 * 5.  Stale pending order creation inserts clean order if absent from cloud.
 * 6.  Stale pending order creation with duplicate cloud header only syncs missing items.
 * 7.  Missing cloud order items are inserted without duplicating existing items.
 * 8.  Fully synchronized cloud order items skip item insertion.
 * 9.  Failed order update recovers safely after cloud order confirmation.
 * 10. Failed Hold confirmation recovers cleanly without corrupting order state.
 * 11. Failed payment settlement verifies cloud payment state before re-attempting settlement.
 * 12. Inventory deduction retry remains idempotent.
 * 13. Offline cancellation/void cleans or reconciles related queued mutations.
 * 14. Application restart/refresh preserves pending queue state and indicators.
 * 15. Reconnection after prolonged outage synchronizes mutations in dependency order.
 * 16. Stale job cleanup requires explicit confirmation and archives rather than hard-deletes.
 * 17. Stale job cleanup never deletes unresolved payments, orders, or inventory without resolution.
 * 18. Server timeout with successful database write recovers idempotently.
 * 19. Sync indicator correctly transitions from Failed → Syncing → Synced after recovery.
 * 20. Sync indicator correctly remains Failed/Warning when an unresolvable failure genuinely exists.
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

if (!globalThis.window) {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

import {
  offlineSync,
  QUEUE_KEYS,
  POS_MUTATION_TYPES,
  ERROR_TYPES,
  MUTATION_CLASSIFICATIONS,
  classifyError,
  classifyJob,
  isCriticalMutation
} from '../../frontend/src/lib/offline-sync.js';

describe('PHASE 4: OFFLINE SYNC FAILED QUEUE RECOVERY & RECONCILIATION', () => {

  beforeEach(() => {
    mockStore.clear();
    mockOnline = true;
    offlineSync.isOnlineState = true;
    offlineSync.isSyncing = false;
    mockIndicatorEl.textContent = '';
    mockIndicatorEl.innerHTML = '';
    mockIndicatorEl.style = {};
    mockIndicatorEl._listeners = {};
    delete mockIndicatorEl._syncClickWired;
    delete globalThis.window.insforge;
    delete globalThis.window.supabase;
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 1: Valid pending mutation successfully synchronizes
  // ─────────────────────────────────────────────────────────────────
  it('1. Valid pending mutation successfully synchronizes', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: 'srv_ord_1', order_number: 'LIM-1001', status: 'confirmed' }
        })
      };
    };

    try {
      offlineSync.enqueuePosOrderCreate({
        orderData: { customer_name: 'Test Customer', total_amount: 250 },
        items: [{ dish_name: 'Chicken Biryani', price: 250, qty: 1 }],
        idempotencyKey: 'idemp-valid-1'
      });

      const res = await offlineSync.syncAdminMutations();
      assert.strictEqual(res.synced, 1);
      const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
      assert.strictEqual(queue[0].status, 'synced');
      assert.strictEqual(queue[0].result.id, 'srv_ord_1');
      assert.strictEqual(queue[0].error, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 2: Transient network failure triggers retry with backoff
  // ─────────────────────────────────────────────────────────────────
  it('2. Transient network failure triggers retry with backoff', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };

    try {
      offlineSync.enqueuePosOrderCreate({
        orderData: { customer_name: 'Net Drop User', total_amount: 150 },
        items: [],
        idempotencyKey: 'idemp-net-2'
      });

      await offlineSync.syncAdminMutations();
      const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
      assert.strictEqual(queue[0].status, 'pending');
      assert.strictEqual(queue[0].attempts, 1);
      assert.strictEqual(queue[0].errorType, ERROR_TYPES.NETWORK);
      assert.ok(queue[0].nextRetryAt > Date.now(), 'Backoff timestamp must be in future');
      assert.strictEqual(classifyJob(queue[0]), MUTATION_CLASSIFICATIONS.RETRYABLE);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 3: Permanent validation failure marks mutation failed without infinite retry
  // ─────────────────────────────────────────────────────────────────
  it('3. Permanent validation failure marks mutation failed without infinite retry', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: 'violates not-null constraint on total_amount'
        })
      };
    };

    try {
      offlineSync.enqueuePosOrderCreate({
        orderData: { customer_name: 'Malformed Order' },
        items: [],
        idempotencyKey: 'idemp-val-3'
      });

      await offlineSync.syncAdminMutations();
      const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
      assert.strictEqual(queue[0].status, 'failed', 'Must immediately mark validation error as failed');
      assert.strictEqual(queue[0].errorType, ERROR_TYPES.VALIDATION);
      assert.strictEqual(classifyJob(queue[0]), MUTATION_CLASSIFICATIONS.FAILED);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 4: Stale pending order creation reconciles with existing cloud order if already present
  // ─────────────────────────────────────────────────────────────────
  it('4. Stale pending order creation reconciles with existing cloud order if already present', async () => {
    const existingCloudOrder = {
      id: 'uuid-cloud-4',
      order_number: 'LIM-2004',
      idempotency_key: 'idemp-existing-4',
      total_amount: 320,
      status: 'confirmed'
    };

    const mockDb = {
      from: (tbl) => {
        if (tbl === 'orders') {
          return {
            select: () => ({
              eq: (field, val) => ({
                maybeSingle: async () => {
                  if (field === 'idempotency_key' && val === 'idemp-existing-4') {
                    return { data: existingCloudOrder, error: null };
                  }
                  return { data: null, error: null };
                }
              })
            }),
            insert: async () => {
              throw new Error('Should not attempt insert when already in cloud');
            }
          };
        }
        if (tbl === 'order_items') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [{ dish_name: 'Biryani', price: 320, quantity: 1 }], error: null })
            }),
            insert: async () => ({ data: [], error: null })
          };
        }
        return {};
      }
    };
    globalThis.window.insforge = { database: mockDb };

    offlineSync.enqueuePosOrderCreate({
      orderData: { customer_name: 'Existing User', total_amount: 320 },
      items: [{ dish_name: 'Biryani', price: 320, qty: 1 }],
      idempotencyKey: 'idemp-existing-4'
    });

    const res = await offlineSync.syncAdminMutations();
    assert.strictEqual(res.synced, 1);
    const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.strictEqual(queue[0].status, 'synced');
    assert.strictEqual(queue[0].result.id, 'uuid-cloud-4');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 5: Stale pending order creation inserts clean order if absent from cloud
  // ─────────────────────────────────────────────────────────────────
  it('5. Stale pending order creation inserts clean order if absent from cloud', async () => {
    let orderInserted = null;
    const mockDb = {
      from: (tbl) => {
        if (tbl === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null })
              })
            }),
            insert: (rows) => {
              orderInserted = rows[0];
              return {
                select: () => ({
                  single: async () => ({
                    data: { id: 'uuid-new-5', ...orderInserted },
                    error: null
                  })
                })
              };
            }
          };
        }
        if (tbl === 'order_items') {
          return {
            insert: async (items) => ({ data: items, error: null })
          };
        }
        return {};
      }
    };
    globalThis.window.insforge = { database: mockDb };

    offlineSync.enqueuePosOrderCreate({
      orderData: { customer_name: 'Clean Insert', total_amount: 180, id: 'offline-505' },
      items: [{ dish_name: 'Roll', price: 180, qty: 1 }],
      idempotencyKey: 'idemp-new-5'
    });

    const res = await offlineSync.syncAdminMutations();
    assert.strictEqual(res.synced, 1);
    assert.ok(orderInserted, 'Order must be inserted into DB');
    assert.strictEqual(orderInserted.customer_name, 'Clean Insert');
    assert.strictEqual(orderInserted.id, undefined, 'Temporary offline ID must be stripped prior to insert');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 6: Stale pending order creation with duplicate cloud header only syncs missing items
  // ─────────────────────────────────────────────────────────────────
  it('6. Stale pending order creation with duplicate cloud header only syncs missing items', async () => {
    const existingCloudOrder = {
      id: 'uuid-cloud-6',
      order_number: 'LIM-2006',
      idempotency_key: 'idemp-dup-6'
    };

    let insertedItemsList = [];
    const mockDb = {
      from: (tbl) => {
        if (tbl === 'orders') {
          return {
            select: () => ({
              eq: (field, val) => ({
                maybeSingle: async () => {
                  if (val === 'idemp-dup-6') return { data: existingCloudOrder, error: null };
                  return { data: null, error: null };
                }
              })
            })
          };
        }
        if (tbl === 'order_items') {
          return {
            select: () => ({
              eq: () => Promise.resolve({
                data: [{ dish_name: 'Biryani', price: 200, quantity: 1 }],
                error: null
              })
            }),
            insert: async (items) => {
              insertedItemsList = items;
              return { data: items, error: null };
            }
          };
        }
        return {};
      }
    };
    globalThis.window.insforge = { database: mockDb };

    offlineSync.enqueuePosOrderCreate({
      orderData: { customer_name: 'Partial Cloud Order', total_amount: 240 },
      items: [
        { dish_name: 'Biryani', price: 200, qty: 1 },
        { dish_name: 'Roti', price: 40, qty: 1 }
      ],
      idempotencyKey: 'idemp-dup-6'
    });

    const res = await offlineSync.syncAdminMutations();
    assert.strictEqual(res.synced, 1);
    assert.strictEqual(insertedItemsList.length, 1, 'Only missing item must be inserted');
    assert.strictEqual(insertedItemsList[0].dish_name, 'Roti');
    assert.strictEqual(insertedItemsList[0].order_id, 'uuid-cloud-6');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 7: Missing cloud order items are inserted without duplicating existing items
  // ─────────────────────────────────────────────────────────────────
  it('7. Missing cloud order items are inserted without duplicating existing items', async () => {
    const job = {
      id: 'op_recon_7',
      idempotencyKey: 'key_recon_7',
      payload: {
        order: { id: 'uuid-order-7', idempotency_key: 'key_recon_7' },
        items: [
          { dish_name: 'Existing Biryani', price: 200, qty: 1 },
          { dish_name: 'New Coke', price: 40, qty: 2 }
        ]
      }
    };

    let itemsInserted = [];
    const mockDb = {
      from: (tbl) => {
        if (tbl === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'uuid-order-7' }, error: null })
              })
            })
          };
        }
        if (tbl === 'order_items') {
          return {
            select: () => ({
              eq: () => Promise.resolve({
                data: [{ dish_name: 'Existing Biryani', price: 200, quantity: 1 }],
                error: null
              })
            }),
            insert: async (items) => {
              itemsInserted = items;
              return { data: items, error: null };
            }
          };
        }
        return {};
      }
    };

    const recon = await offlineSync.verifyAndReconcileCloudOrder(job, mockDb);
    assert.strictEqual(recon.exists, true);
    assert.strictEqual(recon.missingItems.length, 1);
    assert.strictEqual(recon.missingItems[0].dish_name, 'New Coke');
    assert.strictEqual(itemsInserted.length, 1);
    assert.strictEqual(itemsInserted[0].dish_name, 'New Coke');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 8: Fully synchronized cloud order items skip item insertion
  // ─────────────────────────────────────────────────────────────────
  it('8. Fully synchronized cloud order items skip item insertion', async () => {
    let insertCalled = false;
    const mockDb = {
      from: (tbl) => {
        if (tbl === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'uuid-order-8' }, error: null })
              })
            })
          };
        }
        if (tbl === 'order_items') {
          return {
            select: () => ({
              eq: () => Promise.resolve({
                data: [{ dish_name: 'Biryani', price: 200, quantity: 1 }],
                error: null
              })
            }),
            insert: async () => {
              insertCalled = true;
              return { data: [], error: null };
            }
          };
        }
        return {};
      }
    };

    const job = {
      id: 'op_synced_8',
      idempotencyKey: 'key_synced_8',
      payload: {
        order: { id: 'uuid-order-8' },
        items: [{ dish_name: 'Biryani', price: 200, qty: 1 }]
      }
    };

    const recon = await offlineSync.verifyAndReconcileCloudOrder(job, mockDb);
    assert.strictEqual(recon.exists, true);
    assert.strictEqual(recon.missingItems.length, 0);
    assert.strictEqual(recon.insertedItems.length, 0);
    assert.strictEqual(insertCalled, false, 'No item insertion should happen when all items exist');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 9: Failed order update recovers safely after cloud order confirmation
  // ─────────────────────────────────────────────────────────────────
  it('9. Failed order update recovers safely after cloud order confirmation', async () => {
    let updateTargetId = null;
    const mockDb = {
      from: (tbl) => {
        if (tbl === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'srv_uuid_9', status: 'pending' }, error: null })
              })
            }),
            update: (upd) => ({
              eq: (field, val) => {
                updateTargetId = val;
                return {
                  select: () => ({
                    single: async () => ({ data: { id: val, ...upd }, error: null })
                  })
                };
              }
            })
          };
        }
        return {};
      }
    };
    globalThis.window.insforge = { database: mockDb };

    // Initial queue has a synced create with local 'offline-999' -> 'srv_uuid_9'
    const queue = [
      {
        id: 'job_create_9',
        type: POS_MUTATION_TYPES.ORDER_CREATE,
        status: 'synced',
        payload: { order: { id: 'offline-999' } },
        result: { id: 'srv_uuid_9' },
        updatedAt: new Date().toISOString()
      },
      {
        id: 'job_update_9',
        type: POS_MUTATION_TYPES.ORDER_UPDATE,
        status: 'pending',
        payload: { orderId: 'offline-999', updateData: { status: 'confirmed' } },
        updatedAt: new Date().toISOString()
      }
    ];
    offlineSync.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, queue);

    await offlineSync.syncAdminMutations();
    const updatedQueue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    const updateJob = updatedQueue.find(j => j.id === 'job_update_9');
    assert.ok(updateJob, 'Update job must remain in queue until 60s prune');
    assert.strictEqual(updateJob.status, 'synced');
    assert.strictEqual(updateTargetId, 'srv_uuid_9', 'Order update must use resolved server UUID');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 10: Failed Hold confirmation recovers cleanly without corrupting order state
  // ─────────────────────────────────────────────────────────────────
  it('10. Failed Hold confirmation recovers cleanly without corrupting order state', async () => {
    const mockDb = {
      from: (tbl) => {
        if (tbl === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                // Order is already BILLED in cloud!
                maybeSingle: async () => ({ data: { id: 'srv_bill_10', ticket_status: 'BILLED' }, error: null })
              })
            })
          };
        }
        if (tbl === 'order_items') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [{ id: 'item_1' }], error: null })
            })
          };
        }
        return {};
      }
    };
    globalThis.window.insforge = { database: mockDb };

    offlineSync.enqueuePosConfirmBill({
      orderId: 'srv_bill_10',
      updatePayload: { ticket_status: 'BILLED', total_amount: 450 },
      items: [{ dish_name: 'Biryani', price: 450, qty: 1 }]
    });

    const res = await offlineSync.syncAdminMutations();
    assert.strictEqual(res.synced, 1);
    const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.strictEqual(queue[0].status, 'synced');
    assert.strictEqual(queue[0].result.ticket_status, 'BILLED');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 11: Failed payment settlement verifies cloud payment state before re-attempting settlement
  // ─────────────────────────────────────────────────────────────────
  it('11. Failed payment settlement verifies cloud payment state before re-attempting settlement', async () => {
    let rpcCalled = false;
    let listenerFired = false;

    offlineSync.subscribe((event) => {
      if (event.type === 'pos_settlement_confirmed' && event.orderId === 'srv_paid_11') {
        listenerFired = true;
      }
    });

    const mockDb = {
      from: (tbl) => {
        if (tbl === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'srv_paid_11', payment_status: 'paid', ticket_status: 'CLOSED' },
                  error: null
                })
              })
            })
          };
        }
        return {};
      },
      rpc: async () => {
        rpcCalled = true;
        return { data: { success: true }, error: null };
      }
    };
    globalThis.window.insforge = { database: mockDb };

    offlineSync.enqueuePosSettlement({
      orderId: 'srv_paid_11',
      paymentMethod: 'cash'
    });

    const res = await offlineSync.syncAdminMutations();
    assert.strictEqual(res.synced, 1);
    assert.strictEqual(rpcCalled, false, 'RPC should not be called if cloud already confirmed payment');
    assert.strictEqual(listenerFired, true, 'pos_settlement_confirmed event must be notified');
    const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.strictEqual(queue[0].status, 'synced');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 12: Inventory deduction retry remains idempotent
  // ─────────────────────────────────────────────────────────────────
  it('12. Inventory deduction retry remains idempotent', async () => {
    const mockDb = {
      rpc: async (name, params) => {
        return { error: { message: 'ALREADY_RECORDED: duplicate idempotency key' } };
      }
    };
    globalThis.window.insforge = { database: mockDb };

    offlineSync.enqueueStockMutation('STOCK_OUT', {
      raw_material_id: 'mat_12',
      quantity: 5,
      idempotencyKey: 'idemp-stk-12'
    });

    const res = await offlineSync.syncStockMutations();
    assert.strictEqual(res.synced, 1, 'Idempotent replay must acknowledge as synced');
    const queue = offlineSync.loadQueue(QUEUE_KEYS.STOCK_MUTATIONS);
    assert.strictEqual(queue[0].status, 'synced');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 13: Offline cancellation/void cleans or reconciles related queued mutations
  // ─────────────────────────────────────────────────────────────────
  it('13. Offline cancellation/void cleans or reconciles related queued mutations', () => {
    offlineSync.enqueuePosOrderCreate({
      orderData: { id: 'offline-cancel-13', customer_name: 'Cancel Me' },
      items: []
    });
    offlineSync.enqueuePosConfirmBill({
      orderId: 'offline-cancel-13',
      updatePayload: { ticket_status: 'BILLED' }
    });
    offlineSync.enqueuePosSettlement({
      orderId: 'offline-cancel-13',
      paymentMethod: 'cash'
    });

    assert.strictEqual(offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS).length, 3);

    // Order is cancelled/voided offline
    offlineSync.removeJobByOrderId('offline-cancel-13');

    const remaining = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.strictEqual(remaining.length, 0, 'All mutations for cancelled order must be cleaned');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 14: Application restart/refresh preserves pending queue state and indicators
  // ─────────────────────────────────────────────────────────────────
  it('14. Application restart/refresh preserves pending queue state and indicators', () => {
    offlineSync.initSyncIndicator('sync-indicator');

    offlineSync.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, [
      { id: 'job_a', status: 'pending' },
      { id: 'job_b', status: 'pending' }
    ]);
    offlineSync.saveQueue(QUEUE_KEYS.STOCK_MUTATIONS, [
      { id: 'job_c', status: 'pending' }
    ]);

    // Simulate page reload / re-instantiation
    const counts = offlineSync.getPendingCounts();
    assert.strictEqual(counts.adminMutations, 2);
    assert.strictEqual(counts.stockMutations, 1);

    offlineSync.updateSyncIndicator();
    assert.match(mockIndicatorEl.innerHTML, /⏳ Pending Sync \(3\)/);
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 15: Reconnection after prolonged outage synchronizes mutations in dependency order
  // ─────────────────────────────────────────────────────────────────
  it('15. Reconnection after prolonged outage synchronizes mutations in dependency order', async () => {
    const executedOrder = [];
    const mockDb = {
      from: (tbl) => {
        if (tbl === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null })
              })
            }),
            insert: (rows) => {
              executedOrder.push('CREATE');
              return {
                select: () => ({
                  single: async () => ({
                    data: { id: 'server_gen_uuid_15', ...rows[0] },
                    error: null
                  })
                })
              };
            },
            update: (upd) => ({
              eq: (field, val) => {
                executedOrder.push(`UPDATE_${val}`);
                return {
                  select: () => ({
                    single: async () => ({ data: { id: val, ...upd }, error: null })
                  })
                };
              }
            })
          };
        }
        if (tbl === 'order_items') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [], error: null })
            }),
            insert: async () => ({ data: [], error: null })
          };
        }
        return {};
      },
      rpc: async (name, params) => {
        executedOrder.push(`SETTLE_${params.p_order_id}`);
        return { data: { success: true }, error: null };
      }
    };
    globalThis.window.insforge = { database: mockDb };

    offlineSync.enqueuePosOrderCreate({
      orderData: { id: 'offline-dep-15', customer_name: 'Dep User', total_amount: 500 },
      items: []
    });
    offlineSync.enqueuePosConfirmBill({
      orderId: 'offline-dep-15',
      updatePayload: { ticket_status: 'BILLED' }
    });
    offlineSync.enqueuePosSettlement({
      orderId: 'offline-dep-15',
      paymentMethod: 'cash'
    });

    await offlineSync.syncAdminMutations();

    assert.deepStrictEqual(executedOrder, [
      'CREATE',
      'UPDATE_server_gen_uuid_15',
      'SETTLE_server_gen_uuid_15'
    ], 'Must execute in dependency order with server UUID propagated');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 16: Stale job cleanup requires explicit confirmation and archives rather than hard-deletes
  // ─────────────────────────────────────────────────────────────────
  it('16. Stale job cleanup requires explicit confirmation and archives rather than hard-deletes', () => {
    // Calling without confirmation must throw
    assert.throws(
      () => offlineSync.clearStaleQueue(),
      /Explicit confirmation required/i
    );

    // Enqueue an obsolete non-critical failed job (e.g. status ping)
    offlineSync.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, [
      { id: 'obsolete_ping_16', type: 'ORDER_STATUS', status: 'failed', attempts: 5 }
    ]);

    const result = offlineSync.clearStaleQueue({ confirmed: true, reason: 'Test archive' });
    assert.strictEqual(result.archivedCount, 1);

    // Verify queue is empty and quarantined key holds the archived job
    const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.strictEqual(queue.length, 0);

    const quarantined = offlineSync.loadQueue(QUEUE_KEYS.QUARANTINED_MUTATIONS);
    assert.strictEqual(quarantined.length, 1);
    assert.strictEqual(quarantined[0].id, 'obsolete_ping_16');
    assert.strictEqual(quarantined[0].quarantineReason, 'Test archive');
    assert.ok(quarantined[0].quarantinedAt, 'Must attach quarantine timestamp');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 17: Stale job cleanup never deletes unresolved payments, orders, or inventory without resolution
  // ─────────────────────────────────────────────────────────────────
  it('17. Stale job cleanup never deletes unresolved payments, orders, or inventory without resolution', () => {
    offlineSync.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, [
      { id: 'crit_order_17', type: POS_MUTATION_TYPES.ORDER_CREATE, status: 'failed', attempts: 5 },
      { id: 'crit_settle_17', type: POS_MUTATION_TYPES.SETTLE_ORDER, status: 'failed', attempts: 5 }
    ]);
    offlineSync.saveQueue(QUEUE_KEYS.STOCK_MUTATIONS, [
      { id: 'crit_stock_17', type: 'STOCK_OUT', status: 'failed', attempts: 5 }
    ]);

    const result = offlineSync.clearStaleQueue({ confirmed: true });
    assert.strictEqual(result.archivedCount, 0, 'Must not archive unresolved critical mutations');
    assert.strictEqual(result.remainingCriticalCount, 3);

    const adminQueue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    const stockQueue = offlineSync.loadQueue(QUEUE_KEYS.STOCK_MUTATIONS);
    assert.strictEqual(adminQueue.length, 2);
    assert.strictEqual(stockQueue.length, 1);
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 18: Server timeout with successful database write recovers idempotently
  // ─────────────────────────────────────────────────────────────────
  it('18. Server timeout with successful database write recovers idempotently', async () => {
    let callCount = 0;
    const mockDb = {
      from: (tbl) => {
        if (tbl === 'orders') {
          return {
            select: () => ({
              eq: (field, val) => ({
                maybeSingle: async () => {
                  if (callCount > 0) {
                    return { data: { id: 'srv_timeout_18', order_number: 'LIM-18' }, error: null };
                  }
                  return { data: null, error: null };
                }
              })
            }),
            insert: () => {
              callCount++;
              // Simulates 23505 duplicate key error when server previously wrote but client timed out
              return {
                select: () => ({
                  single: async () => ({
                    error: { code: '23505', message: 'duplicate key value violates unique constraint "orders_pkey"' }
                  })
                })
              };
            }
          };
        }
        if (tbl === 'order_items') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [], error: null })
            }),
            insert: async () => ({ data: [], error: null })
          };
        }
        return {};
      }
    };
    globalThis.window.insforge = { database: mockDb };

    offlineSync.enqueuePosOrderCreate({
      orderData: { customer_name: 'Timeout User', total_amount: 300 },
      items: [],
      idempotencyKey: 'idemp-timeout-18'
    });

    const res = await offlineSync.syncAdminMutations();
    assert.strictEqual(res.synced, 1, 'Duplicate key on retry must reconcile and sync');
    const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    assert.strictEqual(queue[0].status, 'synced');
    assert.strictEqual(queue[0].result.id, 'srv_timeout_18');
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 19: Sync indicator correctly transitions from Failed → Syncing → Synced after recovery
  // ─────────────────────────────────────────────────────────────────
  it('19. Sync indicator correctly transitions from Failed → Syncing → Synced after recovery', () => {
    offlineSync.initSyncIndicator('sync-indicator');

    // 1. Initial Failed state
    offlineSync.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, [
      { id: 'job_f_19', status: 'failed', attempts: 5 }
    ]);
    offlineSync.updateSyncIndicator();
    assert.match(mockIndicatorEl.innerHTML, /⚠️ Sync Failed \(1\)/);

    // 2. Click to retry -> resets and begins syncing
    let syncStarted = false;
    offlineSync.triggerSync = async () => {
      syncStarted = true;
      offlineSync.isSyncing = true;
      offlineSync.updateSyncIndicator();
      assert.match(mockIndicatorEl.textContent, /🔄 Syncing/);
    };

    mockIndicatorEl.click();
    assert.strictEqual(syncStarted, true);

    // 3. Sync completes successfully
    offlineSync.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, []);
    offlineSync.isSyncing = false;
    offlineSync.updateSyncIndicator();
    assert.match(mockIndicatorEl.textContent, /✅ Synced/);
  });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO 20: Sync indicator correctly remains Failed/Warning when an unresolvable failure genuinely exists
  // ─────────────────────────────────────────────────────────────────
  it('20. Sync indicator correctly remains Failed/Warning when an unresolvable failure genuinely exists', () => {
    offlineSync.initSyncIndicator('sync-indicator');

    offlineSync.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, [
      { id: 'unresolvable_20', type: POS_MUTATION_TYPES.ORDER_CREATE, status: 'failed', attempts: 5, error: 'Foreign key constraint violation' }
    ]);

    offlineSync.updateSyncIndicator();
    assert.match(mockIndicatorEl.innerHTML, /⚠️ Sync Failed \(1\)/);
    assert.strictEqual(mockIndicatorEl.style.color, '#dc2626');
    assert.strictEqual(offlineSync.getFailedCounts().total, 1);
  });

});
