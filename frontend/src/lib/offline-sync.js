/**
 * LIMRA Restaurant POS V2 — Offline-First Reliability & Data Synchronization Engine
 * 
 * Manages persistent local queues, network connectivity detection, idempotent retries,
 * conflict resolution, server-authoritative validation, and sensitive cache isolation.
 */

export const CACHE_SCHEMA_VERSION = 'v2.1';

export const QUEUE_KEYS = {
  CUSTOMER_ORDERS: 'limra_pending_customer_orders',
  TABLE_ROUNDS: 'limra_pending_table_rounds',
  ADMIN_MUTATIONS: 'limra_pending_admin_mutations',
  STOCK_MUTATIONS: 'limra_pending_stock_mutations',
  SCHEMA_VERSION: 'limra_cache_schema_version'
};

class OfflineSyncEngine {
  constructor() {
    this.listeners = new Set();
    this.isOnlineState = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.isSyncing = false;
    this._syncPromise = Promise.resolve();

    if (typeof window !== 'undefined') {
      this.initNetworkListeners();
      this.validateCacheSchema();
    }
  }

  /**
   * Initialize online/offline event listeners
   */
  initNetworkListeners() {
    window.addEventListener('online', () => {
      this.isOnlineState = true;
      this.notifyListeners({ type: 'network', status: 'online' });
      this.triggerSync();
    });

    window.addEventListener('offline', () => {
      this.isOnlineState = false;
      this.notifyListeners({ type: 'network', status: 'offline' });
    });
  }

  isOnline() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.isOnlineState = false;
      return false;
    }
    return this.isOnlineState;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[OfflineSync] Listener error:', e);
      }
    }
  }

  /**
   * Validate and migrate cache schema version
   */
  validateCacheSchema() {
    try {
      if (typeof localStorage === 'undefined') return;
      const currentVersion = localStorage.getItem(QUEUE_KEYS.SCHEMA_VERSION);
      if (currentVersion !== CACHE_SCHEMA_VERSION) {
        console.log(`[OfflineSync] Upgrading cache schema from ${currentVersion || 'legacy'} to ${CACHE_SCHEMA_VERSION}`);
        // Keep pending mutations intact, but refresh legacy cache tags
        localStorage.setItem(QUEUE_KEYS.SCHEMA_VERSION, CACHE_SCHEMA_VERSION);
      }
    } catch (e) {
      console.warn('[OfflineSync] Cache schema validation warning:', e);
    }
  }

  /**
   * Load queue from localStorage
   */
  loadQueue(key) {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn(`[OfflineSync] Failed to read queue ${key}:`, e);
      return [];
    }
  }

  /**
   * Save queue to localStorage
   */
  saveQueue(key, items) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(key, JSON.stringify(items));
    } catch (e) {
      console.warn(`[OfflineSync] Failed to save queue ${key}:`, e);
    }
  }

  generateOpId(prefix = 'op') {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 9);
    return `${prefix}_${ts}_${rand}`;
  }

  generateIdempotencyKey(prefix = 'idemp') {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${ts}_${rand}`;
  }

  // ═════════════════════════════════════════════════════════════════
  // 1. ENQUEUE METHODS
  // ═════════════════════════════════════════════════════════════════

  /**
   * Enqueue customer checkout order (COD or Self-Pickup)
   * Note: Online payment (Razorpay) is NEVER enqueued offline.
   */
  enqueueCustomerOrder(orderPayload) {
    const queue = this.loadQueue(QUEUE_KEYS.CUSTOMER_ORDERS);
    const opId = this.generateOpId('cust');
    const idempotencyKey = orderPayload.idempotencyKey || this.generateIdempotencyKey('order');

    const job = {
      id: opId,
      idempotencyKey: idempotencyKey,
      type: 'CUSTOMER_ORDER',
      status: 'pending', // 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict'
      payload: { ...orderPayload, idempotencyKey },
      error: null,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    queue.push(job);
    this.saveQueue(QUEUE_KEYS.CUSTOMER_ORDERS, queue);
    this.notifyListeners({ type: 'enqueue', queue: QUEUE_KEYS.CUSTOMER_ORDERS, job });

    return {
      id: opId,
      order_number: 'PENDING',
      isLocalPending: true,
      status: 'pending_sync',
      idempotency_key: idempotencyKey,
      displayStatus: 'Pending Sync (Offline)',
      message: 'Order saved locally. Will be confirmed when connection returns.'
    };
  }

  /**
   * Enqueue Dine-In Table Round
   */
  enqueueTableRound(roundPayload) {
    const queue = this.loadQueue(QUEUE_KEYS.TABLE_ROUNDS);
    const opId = this.generateOpId('tbl');
    const idempotencyKey = roundPayload.idempotencyKey || this.generateIdempotencyKey('round');

    const job = {
      id: opId,
      idempotencyKey: idempotencyKey,
      type: 'TABLE_ROUND',
      status: 'pending',
      payload: { ...roundPayload, idempotencyKey },
      error: null,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    queue.push(job);
    this.saveQueue(QUEUE_KEYS.TABLE_ROUNDS, queue);
    this.notifyListeners({ type: 'enqueue', queue: QUEUE_KEYS.TABLE_ROUNDS, job });

    return {
      id: opId,
      order_number: 'PENDING',
      isLocalPending: true,
      status: 'pending_sync',
      idempotency_key: idempotencyKey,
      round_number: roundPayload.roundNumber || 1,
      displayStatus: 'Round Queued (Offline)',
      message: 'Round saved locally. Will be sent to kitchen when back online.'
    };
  }

  /**
   * Enqueue Admin POS Counter Order or Status Update / Settle
   */
  enqueueAdminMutation(mutationType, payload) {
    const queue = this.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    const opId = this.generateOpId('adm');
    const idempotencyKey = payload.idempotencyKey || this.generateIdempotencyKey('adm_mut');

    const job = {
      id: opId,
      idempotencyKey: idempotencyKey,
      type: mutationType, // 'ORDER_CREATE' | 'ORDER_STATUS' | 'ORDER_SETTLE' | 'HOLD_UPDATE'
      status: 'pending',
      payload: { ...payload, idempotencyKey },
      error: null,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    queue.push(job);
    this.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, queue);
    this.notifyListeners({ type: 'enqueue', queue: QUEUE_KEYS.ADMIN_MUTATIONS, job });

    return { ...job, isLocalPending: true };
  }

  /**
   * Enqueue Stock Movement (Stock IN or Stock OUT)
   */
  enqueueStockMutation(mutationType, stockPayload) {
    const queue = this.loadQueue(QUEUE_KEYS.STOCK_MUTATIONS);
    const opId = this.generateOpId('stk');
    const idempotencyKey = stockPayload.idempotencyKey || this.generateIdempotencyKey('stock');

    const job = {
      id: opId,
      idempotencyKey: idempotencyKey,
      type: mutationType, // 'STOCK_IN' | 'STOCK_OUT'
      status: 'pending',
      payload: { ...stockPayload, idempotencyKey },
      error: null,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    queue.push(job);
    this.saveQueue(QUEUE_KEYS.STOCK_MUTATIONS, queue);
    this.notifyListeners({ type: 'enqueue', queue: QUEUE_KEYS.STOCK_MUTATIONS, job });

    return { ...job, isLocalPending: true };
  }

  // ═════════════════════════════════════════════════════════════════
  // 2. SYNCHRONIZATION RUNNERS
  // ═════════════════════════════════════════════════════════════════

  /**
   * Trigger synchronization across all queues
   */
  async triggerSync() {
    if (!this.isOnline()) {
      return { success: false, reason: 'offline' };
    }

    if (this.isSyncing) {
      return this._syncPromise;
    }

    this.isSyncing = true;
    this.notifyListeners({ type: 'sync_start' });

    this._syncPromise = (async () => {
      try {
        const results = {
          customerOrders: await this.syncCustomerOrders(),
          tableRounds: await this.syncTableRounds(),
          adminMutations: await this.syncAdminMutations(),
          stockMutations: await this.syncStockMutations()
        };

        this.notifyListeners({ type: 'sync_complete', results });
        return { success: true, results };
      } catch (err) {
        console.error('[OfflineSync] Synchronization cycle error:', err);
        this.notifyListeners({ type: 'sync_error', error: err.message });
        return { success: false, error: err.message };
      } finally {
        this.isSyncing = false;
      }
    })();

    return this._syncPromise;
  }

  /**
   * Sync customer orders queue
   */
  async syncCustomerOrders() {
    const queue = this.loadQueue(QUEUE_KEYS.CUSTOMER_ORDERS);
    const pending = queue.filter(j => j.status === 'pending');
    if (!pending.length) return { total: 0, synced: 0 };

    let syncedCount = 0;
    for (const job of pending) {
      job.status = 'syncing';
      job.attempts += 1;
      job.updatedAt = new Date().toISOString();
      this.saveQueue(QUEUE_KEYS.CUSTOMER_ORDERS, queue);

      try {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-idempotency-key': job.idempotencyKey
          },
          body: JSON.stringify(job.payload)
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success) {
          job.status = 'synced';
          job.error = null;
          job.result = data.data;
          syncedCount++;
          this.notifyListeners({
            type: 'customer_order_synced',
            jobId: job.id,
            serverOrderNumber: data.data?.order_number
          });
        } else if (res.status === 400 || res.status === 409) {
          // Validation or availability conflict (e.g. sold out)
          job.status = 'conflict';
          job.error = data.error || 'Server validation conflict';
          this.notifyListeners({
            type: 'customer_order_conflict',
            jobId: job.id,
            error: job.error
          });
        } else {
          job.status = 'pending';
          job.error = data.error || `HTTP ${res.status}`;
        }
      } catch (fetchErr) {
        job.status = 'pending';
        job.error = fetchErr.message || 'Network request failed';
        break; // Stop iteration if network is dropped
      }
    }

    // Keep synced jobs for a short time for UI confirmation, then prune
    const pruned = queue.filter(j => {
      if (j.status !== 'synced') return true;
      return Date.now() - new Date(j.updatedAt).getTime() < 30000;
    });

    this.saveQueue(QUEUE_KEYS.CUSTOMER_ORDERS, pruned);
    return { total: pending.length, synced: syncedCount };
  }

  /**
   * Sync table rounds queue
   */
  async syncTableRounds() {
    const queue = this.loadQueue(QUEUE_KEYS.TABLE_ROUNDS);
    const pending = queue.filter(j => j.status === 'pending');
    if (!pending.length) return { total: 0, synced: 0 };

    let syncedCount = 0;
    for (const job of pending) {
      job.status = 'syncing';
      job.attempts += 1;
      job.updatedAt = new Date().toISOString();
      this.saveQueue(QUEUE_KEYS.TABLE_ROUNDS, queue);

      try {
        const res = await fetch('/api/db', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-idempotency-key': job.idempotencyKey
          },
          body: JSON.stringify({
            action: 'rpc',
            rpc: 'place_table_round',
            params: {
              p_table_number: job.payload.tableNumber,
              p_table_zone: job.payload.tableZone,
              p_customer_name: job.payload.customerName,
              p_customer_phone: job.payload.customerPhone,
              p_items: job.payload.items,
              p_notes: job.payload.notes,
              p_round_number: job.payload.roundNumber || 1,
              p_idempotency_key: job.idempotencyKey
            }
          })
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success) {
          job.status = 'synced';
          job.error = null;
          job.result = data.data;
          syncedCount++;
          this.notifyListeners({
            type: 'table_round_synced',
            jobId: job.id,
            tableNumber: job.payload.tableNumber
          });
        } else if (res.status === 400 || res.status === 409) {
          job.status = 'conflict';
          job.error = data.error || 'Table round conflict';
        } else {
          job.status = 'pending';
          job.error = data.error || `HTTP ${res.status}`;
        }
      } catch (err) {
        job.status = 'pending';
        job.error = err.message;
        break;
      }
    }

    const pruned = queue.filter(j => {
      if (j.status !== 'synced') return true;
      return Date.now() - new Date(j.updatedAt).getTime() < 30000;
    });

    this.saveQueue(QUEUE_KEYS.TABLE_ROUNDS, pruned);
    return { total: pending.length, synced: syncedCount };
  }

  /**
   * Sync admin mutations queue (order creation, settlements, status updates)
   */
  async syncAdminMutations() {
    const queue = this.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    const pending = queue.filter(j => j.status === 'pending');
    if (!pending.length) return { total: 0, synced: 0 };

    let syncedCount = 0;
    for (const job of pending) {
      job.status = 'syncing';
      job.attempts += 1;
      job.updatedAt = new Date().toISOString();
      this.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, queue);

      try {
        let res;
        if (job.type === 'ORDER_CREATE') {
          res = await fetch('/api/orders', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-idempotency-key': job.idempotencyKey
            },
            body: JSON.stringify(job.payload)
          });
        } else if (job.type === 'ORDER_SETTLE' || job.type === 'ORDER_STATUS') {
          res = await fetch('/api/orders', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'x-idempotency-key': job.idempotencyKey
            },
            body: JSON.stringify(job.payload)
          });
        }

        const data = await res?.json().catch(() => ({}));

        if (res?.ok && data?.success) {
          job.status = 'synced';
          job.error = null;
          syncedCount++;
        } else if (res?.status === 409) {
          // Confirmed conflict: e.g. already settled by another device
          job.status = 'conflict';
          job.error = `409 Conflict: ${data?.error || 'Order was already modified/settled by another cashier.'}`;
          this.notifyListeners({
            type: 'admin_mutation_conflict',
            jobId: job.id,
            error: job.error
          });
        } else {
          job.status = 'pending';
          job.error = data?.error || `HTTP ${res?.status}`;
        }
      } catch (err) {
        job.status = 'pending';
        job.error = err.message;
        break;
      }
    }

    const pruned = queue.filter(j => {
      if (j.status !== 'synced') return true;
      return Date.now() - new Date(j.updatedAt).getTime() < 30000;
    });

    this.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, pruned);
    return { total: pending.length, synced: syncedCount };
  }

  /**
   * Sync stock mutations queue
   */
  async syncStockMutations() {
    const queue = this.loadQueue(QUEUE_KEYS.STOCK_MUTATIONS);
    const pending = queue.filter(j => j.status === 'pending');
    if (!pending.length) return { total: 0, synced: 0 };

    let syncedCount = 0;
    for (const job of pending) {
      job.status = 'syncing';
      job.attempts += 1;
      job.updatedAt = new Date().toISOString();
      this.saveQueue(QUEUE_KEYS.STOCK_MUTATIONS, queue);

      try {
        const rpcName = job.type === 'STOCK_IN' ? 'record_stock_in' : 'record_stock_out';
        const res = await fetch('/api/db', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-idempotency-key': job.idempotencyKey
          },
          body: JSON.stringify({
            action: 'rpc',
            rpc: rpcName,
            params: job.payload
          })
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success) {
          job.status = 'synced';
          job.error = null;
          syncedCount++;
        } else {
          job.status = 'pending';
          job.error = data.error || `HTTP ${res.status}`;
        }
      } catch (err) {
        job.status = 'pending';
        job.error = err.message;
        break;
      }
    }

    const pruned = queue.filter(j => {
      if (j.status !== 'synced') return true;
      return Date.now() - new Date(j.updatedAt).getTime() < 30000;
    });

    this.saveQueue(QUEUE_KEYS.STOCK_MUTATIONS, pruned);
    return { total: pending.length, synced: syncedCount };
  }

  // ═════════════════════════════════════════════════════════════════
  // 3. CACHE ISOLATION & SENSITIVE DATA MANAGEMENT ON LOGOUT
  // ═════════════════════════════════════════════════════════════════

  /**
   * Clear user-specific sensitive cached data on logout
   * Preserves general offline caches (e.g. printer config, menu catalog)
   */
  clearSensitiveUserData() {
    try {
      if (typeof localStorage === 'undefined') return;

      const sensitiveKeys = [
        'limra-customer-details',
        'limra_cached_orders',
        'limra_cached_order_items',
        'limra-cart',
        'limra_user_profile',
        'limra_dev_admin'
      ];

      sensitiveKeys.forEach(k => {
        try { localStorage.removeItem(k); } catch (e) {}
      });

      console.log('[OfflineSync] Sensitive user caches purged on logout.');
    } catch (err) {
      console.warn('[OfflineSync] Error clearing sensitive cache:', err);
    }
  }

  /**
   * Get queue counts for UI display
   */
  getPendingCounts() {
    return {
      customerOrders: this.loadQueue(QUEUE_KEYS.CUSTOMER_ORDERS).filter(j => j.status === 'pending').length,
      tableRounds: this.loadQueue(QUEUE_KEYS.TABLE_ROUNDS).filter(j => j.status === 'pending').length,
      adminMutations: this.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS).filter(j => j.status === 'pending').length,
      stockMutations: this.loadQueue(QUEUE_KEYS.STOCK_MUTATIONS).filter(j => j.status === 'pending').length
    };
  }
}

export const offlineSync = new OfflineSyncEngine();
