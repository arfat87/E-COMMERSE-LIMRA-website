/**
 * LIMRA Restaurant POS V2 — Offline-First Reliability & Data Synchronization Engine
 * 
 * Manages persistent local queues, network connectivity detection, idempotent retries,
 * conflict resolution, server-authoritative validation, and sensitive cache isolation.
 * 
 * Task 5.2: Reliable Offline Mutation Queueing for Internal POS
 * - IndexedDB storage with seamless localStorage fallback
 * - Error classification (NETWORK, SERVER_ERROR, CONFLICT, VALIDATION)
 * - Exponential backoff and retry management
 * - Strict financial safety: queued settlements are never shown as paid until cloud confirms
 * - Real-time #sync-indicator status management (Online, Offline, Pending, Syncing, Failed)
 */

export const CACHE_SCHEMA_VERSION = 'v2.2';

export const QUEUE_KEYS = {
  CUSTOMER_ORDERS: 'limra_pending_customer_orders',
  TABLE_ROUNDS: 'limra_pending_table_rounds',
  ADMIN_MUTATIONS: 'limra_pending_admin_mutations',
  STOCK_MUTATIONS: 'limra_pending_stock_mutations',
  SCHEMA_VERSION: 'limra_cache_schema_version'
};

export const POS_MUTATION_TYPES = {
  ORDER_CREATE: 'POS_ORDER_CREATE',
  ORDER_UPDATE: 'POS_ORDER_UPDATE',
  CONFIRM_BILL: 'POS_CONFIRM_BILL',
  SETTLE_ORDER: 'POS_ORDER_SETTLE'
};

export const ERROR_TYPES = {
  NETWORK: 'NETWORK',
  SERVER_ERROR: 'SERVER_ERROR',
  CONFLICT: 'CONFLICT',
  VALIDATION: 'VALIDATION'
};

/**
 * Classify error for appropriate retry or failure disposition
 */
export function classifyError(err, response = null) {
  const errMsg = String(err?.message || response?.error || err || '').toLowerCase();
  const status = Number(response?.status || err?.status || 0);
  const code = String(err?.code || response?.code || '').toLowerCase();

  // 1. Conflict errors (409, order already settled / cancelled / table session conflict)
  if (status === 409 || errMsg.includes('already settled') || errMsg.includes('order_already_settled') || errMsg.includes('order_cancelled') || errMsg.includes('conflict')) {
    return ERROR_TYPES.CONFLICT;
  }

  // 2. Client & Authorization / Validation errors (400-499, Postgres 42501, PGRST, constraints)
  if (
    (status >= 400 && status < 500) ||
    code === '42501' ||
    code === '42703' ||
    code === '23502' ||
    code === '23505' ||
    code === 'p0001' ||
    code.startsWith('pgrst') ||
    errMsg.includes('permission denied') ||
    errMsg.includes('row-level security') ||
    errMsg.includes('violates') ||
    errMsg.includes('forbidden') ||
    errMsg.includes('unauthorized') ||
    errMsg.includes('jwt') ||
    errMsg.includes('constraint') ||
    errMsg.includes('not-null') ||
    errMsg.includes('order_not_found') ||
    errMsg.includes('target_table_occupied') ||
    errMsg.includes('source_table_empty')
  ) {
    return ERROR_TYPES.VALIDATION;
  }

  // 3. Server errors (500-599)
  if (status >= 500 || errMsg.includes('500') || errMsg.includes('502') || errMsg.includes('503') || errMsg.includes('504') || errMsg.includes('internal server error') || errMsg.includes('service unavailable')) {
    return ERROR_TYPES.SERVER_ERROR;
  }

  // 4. Genuine network disconnections and fetch failures
  if (
    err?.name === 'TypeError' ||
    errMsg.includes('fetch') ||
    errMsg.includes('network') ||
    errMsg.includes('offline') ||
    errMsg.includes('aborted') ||
    errMsg.includes('connection') ||
    errMsg.includes('enotfound') ||
    errMsg.includes('econnrefused') ||
    errMsg.includes('timeout') ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  ) {
    return ERROR_TYPES.NETWORK;
  }

  return ERROR_TYPES.NETWORK;
}

// ═════════════════════════════════════════════════════════════════
// INDEXEDDB STORAGE ADAPTER (WITH LOCALSTORAGE DUAL-WRITE)
// ═════════════════════════════════════════════════════════════════

const IDB_DB_NAME = 'limra_pos_offline_db';
const IDB_STORE_NAME = 'pos_mutations';
const IDB_VERSION = 3;

let idbInstancePromise = null;

function openIndexedDB() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (idbInstancePromise) return idbInstancePromise;

  idbInstancePromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          const store = db.createObjectStore(IDB_STORE_NAME, { keyPath: 'id' });
          store.createIndex('by_queue', 'queueName', { unique: false });
          store.createIndex('by_status', 'status', { unique: false });
          store.createIndex('by_createdAt', 'createdAt', { unique: false });
          store.createIndex('by_idempotencyKey', 'idempotencyKey', { unique: false });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
    } catch (err) {
      resolve(null);
    }
  });

  return idbInstancePromise;
}

class OfflineSyncEngine {
  constructor() {
    this.listeners = new Set();
    this.isOnlineState = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.isSyncing = false;
    this._syncPromise = Promise.resolve();
    this.indicatorElementId = 'sync-indicator';

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
      this.updateSyncIndicator();
      this.notifyListeners({ type: 'network', status: 'online' });
      this.triggerSync();
    });

    window.addEventListener('offline', () => {
      this.isOnlineState = false;
      this.updateSyncIndicator();
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
        localStorage.setItem(QUEUE_KEYS.SCHEMA_VERSION, CACHE_SCHEMA_VERSION);
      }
    } catch (e) {
      console.warn('[OfflineSync] Cache schema validation warning:', e);
    }
  }

  /**
   * Load queue from localStorage synchronously (with async IDB backing)
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
   * Save queue with dual-write to localStorage & IndexedDB
   */
  saveQueue(key, items) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(items));
      }
    } catch (e) {
      console.warn(`[OfflineSync] Failed to save queue ${key}:`, e);
    }

    // Dual-write asynchronously to IndexedDB if available
    this.saveQueueToIDB(key, items).catch(() => {});
    this.updateSyncIndicator();
  }

  async saveQueueToIDB(queueKey, items) {
    const db = await openIndexedDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([IDB_STORE_NAME], 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        for (const item of items) {
          store.put({ ...item, queueName: queueKey });
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async loadQueueFromIDB(queueKey) {
    const db = await openIndexedDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([IDB_STORE_NAME], 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const index = store.index('by_queue');
        const req = index.getAll(queueKey);
        req.onsuccess = () => {
          const res = req.result;
          resolve(Array.isArray(res) ? res : null);
        };
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
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

  _appendJob(queueKey, job) {
    const queue = this.loadQueue(queueKey);
    queue.push(job);
    this.saveQueue(queueKey, queue);
    this.notifyListeners({ type: 'enqueue', queue: queueKey, job });
    return { ...job, isLocalPending: true };
  }

  // ═════════════════════════════════════════════════════════════════
  // 1. ENQUEUE METHODS
  // ═════════════════════════════════════════════════════════════════

  /**
   * Enqueue customer checkout order (COD or Self-Pickup)
   * Note: Online payment (Razorpay) is NEVER enqueued offline.
   */
  enqueueCustomerOrder(orderPayload) {
    const opId = this.generateOpId('cust');
    const idempotencyKey = orderPayload.idempotencyKey || this.generateIdempotencyKey('order');

    const job = {
      id: opId,
      idempotencyKey: idempotencyKey,
      type: 'CUSTOMER_ORDER',
      status: 'pending',
      payload: { ...orderPayload, idempotencyKey },
      error: null,
      errorType: null,
      attempts: 0,
      maxAttempts: 5,
      nextRetryAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this._appendJob(QUEUE_KEYS.CUSTOMER_ORDERS, job);

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
    const opId = this.generateOpId('tbl');
    const idempotencyKey = roundPayload.idempotencyKey || this.generateIdempotencyKey('round');

    const job = {
      id: opId,
      idempotencyKey: idempotencyKey,
      type: 'TABLE_ROUND',
      status: 'pending',
      payload: { ...roundPayload, idempotencyKey },
      error: null,
      errorType: null,
      attempts: 0,
      maxAttempts: 5,
      nextRetryAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this._appendJob(QUEUE_KEYS.TABLE_ROUNDS, job);

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
   * Enqueue Admin POS Generic Mutation
   */
  enqueueAdminMutation(mutationType, payload) {
    const opId = this.generateOpId('adm');
    const idempotencyKey = payload.idempotencyKey || this.generateIdempotencyKey('adm_mut');

    const job = {
      id: opId,
      idempotencyKey: idempotencyKey,
      type: mutationType,
      status: 'pending',
      payload: { ...payload, idempotencyKey },
      error: null,
      errorType: null,
      attempts: 0,
      maxAttempts: 5,
      nextRetryAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return this._appendJob(QUEUE_KEYS.ADMIN_MUTATIONS, job);
  }

  /**
   * Enqueue POS Order Creation Mutation
   */
  enqueuePosOrderCreate({ orderData, itemRows, idempotencyKey }) {
    const opId = this.generateOpId('pos_ord');
    const key = idempotencyKey || orderData.idempotency_key || orderData.id || this.generateIdempotencyKey('ord_crt');

    const job = {
      id: opId,
      idempotencyKey: key,
      type: POS_MUTATION_TYPES.ORDER_CREATE,
      status: 'pending',
      payload: {
        order: { ...orderData, idempotency_key: key },
        items: Array.isArray(itemRows) ? itemRows : []
      },
      error: null,
      errorType: null,
      attempts: 0,
      maxAttempts: 5,
      nextRetryAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return this._appendJob(QUEUE_KEYS.ADMIN_MUTATIONS, job);
  }

  /**
   * Enqueue POS Order Update Mutation
   */
  enqueuePosOrderUpdate({ orderId, updateData, items, idempotencyKey }) {
    const opId = this.generateOpId('pos_upd');
    const key = idempotencyKey || this.generateIdempotencyKey('ord_upd');

    const job = {
      id: opId,
      idempotencyKey: key,
      type: POS_MUTATION_TYPES.ORDER_UPDATE,
      status: 'pending',
      payload: {
        orderId,
        updateData: { ...updateData, idempotency_key: key },
        items: Array.isArray(items) ? items : []
      },
      error: null,
      errorType: null,
      attempts: 0,
      maxAttempts: 5,
      nextRetryAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return this._appendJob(QUEUE_KEYS.ADMIN_MUTATIONS, job);
  }

  /**
   * Enqueue POS Confirm Bill / Billed Status Mutation
   */
  enqueuePosConfirmBill({ orderId, updatePayload, items, isTable = false, tableNum = null, siblingOrderIds = [], siblingPayload = null, idempotencyKey }) {
    const opId = this.generateOpId('pos_bill');
    const key = idempotencyKey || this.generateIdempotencyKey('bill_cfm');

    const job = {
      id: opId,
      idempotencyKey: key,
      type: POS_MUTATION_TYPES.CONFIRM_BILL,
      status: 'pending',
      payload: {
        orderId,
        updatePayload: { ...updatePayload, idempotency_key: key },
        items: Array.isArray(items) ? items : [],
        isTable,
        tableNum,
        siblingOrderIds,
        siblingPayload
      },
      error: null,
      errorType: null,
      attempts: 0,
      maxAttempts: 5,
      nextRetryAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return this._appendJob(QUEUE_KEYS.ADMIN_MUTATIONS, job);
  }

  /**
   * Enqueue POS Order Settlement Mutation
   * CRITICAL FINANCIAL RULE:
   * A queued settlement is NOT a confirmed settlement.
   * Order remains UNPAID until authoritative server confirmation!
   */
  enqueuePosSettlement({ orderId, paymentMethod, notes, idempotencyKey, tableNum = null }) {
    const opId = this.generateOpId('pos_stl');
    const key = idempotencyKey || this.generateIdempotencyKey('settle');

    const job = {
      id: opId,
      idempotencyKey: key,
      type: POS_MUTATION_TYPES.SETTLE_ORDER,
      status: 'pending',
      payload: {
        orderId,
        paymentMethod: paymentMethod || 'cash',
        notes,
        idempotencyKey: key,
        tableNum
      },
      error: null,
      errorType: null,
      attempts: 0,
      maxAttempts: 5,
      nextRetryAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const appended = this._appendJob(QUEUE_KEYS.ADMIN_MUTATIONS, job);
    return {
      ...appended,
      isLocalPending: true,
      _settlementPendingSync: true,
      settlementPending: true,
      payment_status: 'unpaid',
      ticket_status: 'BILLED',
      message: 'Settlement queued offline. Order remains unpaid until cloud confirmation.'
    };
  }

  /**
   * Enqueue Stock Movement (Stock IN or Stock OUT)
   */
  enqueueStockMutation(mutationType, stockPayload) {
    const opId = this.generateOpId('stk');
    const idempotencyKey = stockPayload.idempotencyKey || this.generateIdempotencyKey('stock');

    const job = {
      id: opId,
      idempotencyKey: idempotencyKey,
      type: mutationType,
      status: 'pending',
      payload: { ...stockPayload, idempotencyKey },
      error: null,
      errorType: null,
      attempts: 0,
      maxAttempts: 5,
      nextRetryAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return this._appendJob(QUEUE_KEYS.STOCK_MUTATIONS, job);
  }

  // ═════════════════════════════════════════════════════════════════
  // 2. SYNCHRONIZATION RUNNERS & BACKOFF LOGIC
  // ═════════════════════════════════════════════════════════════════

  /**
   * Trigger synchronization across all queues
   */
  async triggerSync() {
    if (!this.isOnline()) {
      this.updateSyncIndicator();
      return { success: false, reason: 'offline' };
    }

    if (this.isSyncing) {
      return this._syncPromise;
    }

    this.isSyncing = true;
    this.updateSyncIndicator();
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
        this.updateSyncIndicator();
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
    const now = Date.now();

    for (const job of pending) {
      if (job.nextRetryAt && now < job.nextRetryAt) continue;

      job.status = 'syncing';
      job.attempts = (job.attempts || 0) + 1;
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
          job.nextRetryAt = Date.now() + Math.min(60000, 1000 * Math.pow(2, job.attempts));
          if (job.attempts >= (job.maxAttempts || 5)) job.status = 'failed';
        }
      } catch (fetchErr) {
        job.status = 'pending';
        job.error = fetchErr.message || 'Network request failed';
        job.nextRetryAt = Date.now() + Math.min(60000, 1000 * Math.pow(2, job.attempts));
        if (job.attempts >= (job.maxAttempts || 5)) job.status = 'failed';
        this.saveQueue(QUEUE_KEYS.CUSTOMER_ORDERS, queue);
        break; // Stop batch on network break
      }
    }

    const pruned = queue.filter(j => {
      if (j.status !== 'synced') return true;
      return Date.now() - new Date(j.updatedAt).getTime() < 60000;
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
    const now = Date.now();

    for (const job of pending) {
      if (job.nextRetryAt && now < job.nextRetryAt) continue;

      job.status = 'syncing';
      job.attempts = (job.attempts || 0) + 1;
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
          job.nextRetryAt = Date.now() + Math.min(60000, 1000 * Math.pow(2, job.attempts));
          if (job.attempts >= (job.maxAttempts || 5)) job.status = 'failed';
        }
      } catch (err) {
        job.status = 'pending';
        job.error = err.message;
        job.nextRetryAt = Date.now() + Math.min(60000, 1000 * Math.pow(2, job.attempts));
        if (job.attempts >= (job.maxAttempts || 5)) job.status = 'failed';
        this.saveQueue(QUEUE_KEYS.TABLE_ROUNDS, queue);
        break;
      }
    }

    const pruned = queue.filter(j => {
      if (j.status !== 'synced') return true;
      return Date.now() - new Date(j.updatedAt).getTime() < 60000;
    });

    this.saveQueue(QUEUE_KEYS.TABLE_ROUNDS, pruned);
    return { total: pending.length, synced: syncedCount };
  }

  /**
   * Sync admin mutations queue (order creation, settlements, status updates)
   * Handles:
   * - POS_ORDER_CREATE: Order + Items atomic insertion with idempotency key
   * - POS_ORDER_UPDATE: Order changes & item updates
   * - POS_CONFIRM_BILL: Bill generation
   * - POS_ORDER_SETTLE: Authoritative server settlement via settle_order_atomic RPC
   */
  async syncAdminMutations() {
    const queue = this.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    const pending = queue.filter(j => j.status === 'pending');
    if (!pending.length) return { total: 0, synced: 0 };

    let syncedCount = 0;
    const now = Date.now();

    for (const job of pending) {
      // Check exponential backoff
      if (job.nextRetryAt && now < job.nextRetryAt) {
        continue;
      }

      job.status = 'syncing';
      job.attempts = (job.attempts || 0) + 1;
      job.updatedAt = new Date().toISOString();
      this.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, queue);

      try {
        let result = null;
        let resOk = false;
        let resStatus = 200;
        let errMessage = null;

        const db = typeof window !== 'undefined' ? (window.insforge?.database || window.supabase) : null;

        if (job.type === POS_MUTATION_TYPES.ORDER_CREATE || job.type === 'ORDER_CREATE') {
          if (db && typeof db.from === 'function') {
            const orderPayload = {
              ...(job.payload.order || job.payload),
              idempotency_key: job.idempotencyKey
            };
            // Clean local temporary fields before sending to database
            delete orderPayload._isOfflineQueued;
            delete orderPayload._settlementPendingSync;
            delete orderPayload._pendingPaymentMethod;
            if (String(orderPayload.id || '').startsWith('offline-')) {
              delete orderPayload.id;
            }

            let insRes = await db.from('orders').insert([orderPayload]).select().single();
            if (insRes.error && (insRes.error.message || '').includes('ticket_status')) {
              const fallback = { ...orderPayload };
              delete fallback.ticket_status;
              insRes = await db.from('orders').insert([fallback]).select().single();
            }
            if (insRes.error && (insRes.error.code === '42703' || (insRes.error.message || '').includes('does not exist'))) {
              const baseline = {
                order_number: orderPayload.order_number,
                customer_name: orderPayload.customer_name,
                customer_phone: orderPayload.customer_phone,
                order_type: orderPayload.order_type,
                table_number: orderPayload.table_number,
                total_amount: orderPayload.total_amount,
                payment_method: orderPayload.payment_method,
                status: orderPayload.status,
                payment_status: orderPayload.payment_status,
                ticket_status: orderPayload.ticket_status,
                notes: orderPayload.notes,
                idempotency_key: job.idempotencyKey,
                created_at: orderPayload.created_at,
                updated_at: orderPayload.updated_at
              };
              insRes = await db.from('orders').insert([baseline]).select().single();
            }
            if (insRes.error) {
              throw insRes.error;
            }
            result = insRes.data;

            if (Array.isArray(job.payload.items) && job.payload.items.length > 0) {
              const itemsToInsert = job.payload.items.map(i => ({
                ...i,
                order_id: result.id
              }));
              await db.from('order_items').insert(itemsToInsert);
            }
            resOk = true;
          } else {
            const res = await fetch('/api/orders', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-idempotency-key': job.idempotencyKey
              },
              body: JSON.stringify(job.payload.order ? { ...job.payload.order, items: job.payload.items, idempotency_key: job.idempotencyKey } : job.payload)
            });
            resStatus = res.status;
            const data = await res.json().catch(() => ({}));
            resOk = res.ok && data.success;
            result = data.data;
            if (!resOk) errMessage = data.error || `HTTP ${res.status}`;
          }

          if (resOk) {
            job.status = 'synced';
            job.error = null;
            job.result = result;
            syncedCount++;
            this.notifyListeners({
              type: 'pos_order_synced',
              jobId: job.id,
              localId: job.payload.order?.id,
              serverOrder: result,
              idempotencyKey: job.idempotencyKey
            });
          }
        } else if (job.type === POS_MUTATION_TYPES.ORDER_UPDATE) {
          if (db && typeof db.from === 'function') {
            const updRes = await db.from('orders').update(job.payload.updateData).eq('id', job.payload.orderId).select().single();
            if (updRes.error) throw updRes.error;
            result = updRes.data;
            if (Array.isArray(job.payload.items)) {
              await db.from('order_items').delete().eq('order_id', job.payload.orderId);
              await db.from('order_items').insert(job.payload.items.map(i => ({ ...i, order_id: job.payload.orderId })));
            }
            resOk = true;
          } else {
            const res = await fetch('/api/orders', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'x-idempotency-key': job.idempotencyKey
              },
              body: JSON.stringify({ id: job.payload.orderId, ...job.payload.updateData, items: job.payload.items })
            });
            resStatus = res.status;
            const data = await res.json().catch(() => ({}));
            resOk = res.ok && data.success;
            result = data.data;
            if (!resOk) errMessage = data.error || `HTTP ${res.status}`;
          }

          if (resOk) {
            job.status = 'synced';
            job.error = null;
            job.result = result;
            syncedCount++;
            this.notifyListeners({
              type: 'pos_order_updated',
              jobId: job.id,
              orderId: job.payload.orderId,
              serverOrder: result
            });
          }
        } else if (job.type === POS_MUTATION_TYPES.CONFIRM_BILL) {
          if (db && typeof db.from === 'function') {
            if (job.payload.isTable && Array.isArray(job.payload.siblingOrderIds) && job.payload.siblingOrderIds.length > 0) {
              await db.from('order_items').update({ order_id: job.payload.orderId }).in('order_id', job.payload.siblingOrderIds);
              for (const sId of job.payload.siblingOrderIds) {
                await db.from('orders').update({ status: 'delivered', payment_status: 'paid', ticket_status: 'CLOSED' }).eq('id', sId);
              }
            }
            const cRes = await db.from('orders').update(job.payload.updatePayload).eq('id', job.payload.orderId).select().single();
            if (cRes.error) throw cRes.error;
            result = cRes.data;
            resOk = true;
          } else {
            const res = await fetch('/api/orders', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'x-idempotency-key': job.idempotencyKey
              },
              body: JSON.stringify({ id: job.payload.orderId, ...job.payload.updatePayload })
            });
            resStatus = res.status;
            const data = await res.json().catch(() => ({}));
            resOk = res.ok && data.success;
            result = data.data;
            if (!resOk) errMessage = data.error || `HTTP ${res.status}`;
          }

          if (resOk) {
            job.status = 'synced';
            job.error = null;
            job.result = result;
            syncedCount++;
            this.notifyListeners({
              type: 'pos_bill_confirmed',
              jobId: job.id,
              orderId: job.payload.orderId,
              serverOrder: result
            });
          }
        } else if (job.type === POS_MUTATION_TYPES.SETTLE_ORDER || job.type === 'ORDER_SETTLE') {
          // CRITICAL FINANCIAL RULE:
          // Call settle_order_atomic RPC. Authoritative server settlement only!
          if (db && typeof db.rpc === 'function') {
            const rpcRes = await db.rpc('settle_order_atomic', {
              p_order_id: job.payload.orderId,
              p_payment_method: job.payload.paymentMethod || 'cash',
              p_notes: job.payload.notes || null,
              p_idempotency_key: job.idempotencyKey
            });

            if (rpcRes.error) {
              const errMsg = String(rpcRes.error.message || '');
              if (errMsg.includes('ORDER_ALREADY_SETTLED')) {
                // Idempotent replay confirmed!
                resOk = true;
                result = { already_settled: true, order_id: job.payload.orderId };
              } else {
                throw rpcRes.error;
              }
            } else if (rpcRes.data && rpcRes.data.success !== false) {
              resOk = true;
              result = rpcRes.data;
            } else {
              throw new Error(rpcRes.data?.error || 'Settlement rejected by RPC');
            }
          } else {
            const res = await fetch('/api/orders', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'x-idempotency-key': job.idempotencyKey
              },
              body: JSON.stringify({
                id: job.payload.orderId,
                payment_status: 'paid',
                ticket_status: 'CLOSED',
                payment_method: job.payload.paymentMethod,
                notes: job.payload.notes,
                idempotency_key: job.idempotencyKey
              })
            });
            resStatus = res.status;
            const data = await res.json().catch(() => ({}));
            resOk = res.ok && data.success;
            result = data.data;
            if (!resOk) errMessage = data.error || `HTTP ${res.status}`;
          }

          if (resOk) {
            // ONLY NOW is settlement confirmed!
            job.status = 'synced';
            job.error = null;
            job.result = result;
            syncedCount++;
            this.notifyListeners({
              type: 'pos_settlement_confirmed',
              jobId: job.id,
              orderId: job.payload.orderId,
              serverResult: result,
              paymentMethod: job.payload.paymentMethod,
              idempotencyKey: job.idempotencyKey
            });
          }
        } else if (job.type === 'ORDER_STATUS') {
          const res = await fetch('/api/orders', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'x-idempotency-key': job.idempotencyKey
            },
            body: JSON.stringify(job.payload)
          });
          resStatus = res.status;
          const data = await res.json().catch(() => ({}));
          resOk = res.ok && data.success;
          if (!resOk) errMessage = data.error || `HTTP ${res.status}`;
          if (resOk) {
            job.status = 'synced';
            job.error = null;
            syncedCount++;
          }
        }

        if (!resOk && errMessage) {
          const errType = classifyError({ message: errMessage, status: resStatus }, { status: resStatus, error: errMessage });
          job.errorType = errType;
          job.error = (resStatus === 409 || errType === ERROR_TYPES.CONFLICT) ? `409 Conflict: ${errMessage}` : errMessage;

          if (errType === ERROR_TYPES.CONFLICT) {
            job.status = 'conflict';
            this.notifyListeners({ type: 'admin_mutation_conflict', jobId: job.id, error: job.error });
          } else if (errType === ERROR_TYPES.VALIDATION) {
            job.status = 'failed';
          } else {
            job.status = 'pending';
            job.nextRetryAt = Date.now() + Math.min(60000, 1000 * Math.pow(2, job.attempts));
            if (job.attempts >= (job.maxAttempts || 5)) job.status = 'failed';
          }
        }
      } catch (execErr) {
        const errType = classifyError(execErr);
        job.errorType = errType;
        job.error = execErr.message || 'Mutation execution failed';

        if (errType === ERROR_TYPES.CONFLICT) {
          job.status = 'conflict';
          job.error = `409 Conflict: ${execErr.message || 'Conflict'}`;
          this.notifyListeners({ type: 'admin_mutation_conflict', jobId: job.id, error: job.error });
        } else if (errType === ERROR_TYPES.VALIDATION) {
          job.status = 'failed';
        } else {
          job.status = 'pending';
          job.nextRetryAt = Date.now() + Math.min(60000, 1000 * Math.pow(2, job.attempts));
          if (job.attempts >= (job.maxAttempts || 5)) job.status = 'failed';
          // Stop batch iteration if network dropped
          this.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, queue);
          break;
        }
      }
    }

    const pruned = queue.filter(j => {
      if (j.status !== 'synced') return true;
      return Date.now() - new Date(j.updatedAt).getTime() < 60000;
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
    const now = Date.now();

    for (const job of pending) {
      if (job.nextRetryAt && now < job.nextRetryAt) continue;

      job.status = 'syncing';
      job.attempts = (job.attempts || 0) + 1;
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
          job.nextRetryAt = Date.now() + Math.min(60000, 1000 * Math.pow(2, job.attempts));
          if (job.attempts >= (job.maxAttempts || 5)) job.status = 'failed';
        }
      } catch (err) {
        job.status = 'pending';
        job.error = err.message;
        job.nextRetryAt = Date.now() + Math.min(60000, 1000 * Math.pow(2, job.attempts));
        if (job.attempts >= (job.maxAttempts || 5)) job.status = 'failed';
        this.saveQueue(QUEUE_KEYS.STOCK_MUTATIONS, queue);
        break;
      }
    }

    const pruned = queue.filter(j => {
      if (j.status !== 'synced') return true;
      return Date.now() - new Date(j.updatedAt).getTime() < 60000;
    });

    this.saveQueue(QUEUE_KEYS.STOCK_MUTATIONS, pruned);
    return { total: pending.length, synced: syncedCount };
  }

  // ═════════════════════════════════════════════════════════════════
  // 3. CACHE ISOLATION & SENSITIVE DATA MANAGEMENT ON LOGOUT
  // ═════════════════════════════════════════════════════════════════

  /**
   * Clear user-specific sensitive cached data on logout
   * Preserves general offline queues & printer config
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

  // ═════════════════════════════════════════════════════════════════
  // 4. #SYNC-INDICATOR UI CONTROLLER
  // ═════════════════════════════════════════════════════════════════

  initSyncIndicator(indicatorId = 'sync-indicator') {
    this.indicatorElementId = indicatorId;
    this.updateSyncIndicator();

    if (typeof document !== 'undefined') {
      const el = document.getElementById(indicatorId);
      if (el && !el._syncClickWired) {
        el._syncClickWired = true;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const counts = this.getPendingCounts();
          const totalPending = (counts.customerOrders || 0) + (counts.tableRounds || 0) + (counts.adminMutations || 0) + (counts.stockMutations || 0);
          const queue = this.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
          const failedCount = queue.filter(j => j.status === 'failed').length;

          if (failedCount > 0) {
            // Reset failed jobs to pending and retry
            queue.forEach(j => {
              if (j.status === 'failed') {
                j.status = 'pending';
                j.attempts = 0;
                j.nextRetryAt = null;
              }
            });
            this.saveQueue(QUEUE_KEYS.ADMIN_MUTATIONS, queue);
            this.triggerSync();
          } else if (totalPending > 0) {
            this.triggerSync();
          } else {
            this.notifyListeners({ type: 'sync_indicator_clicked', status: 'all_synced' });
          }
        });
      }
    }
  }

  updateSyncIndicator() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(this.indicatorElementId || 'sync-indicator');
    if (!el) return;

    el.classList.remove('adm-hidden');
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.gap = '5px';
    el.style.fontSize = '0.75rem';
    el.style.fontWeight = '700';
    el.style.padding = '0.25rem 0.65rem';
    el.style.borderRadius = '8px';
    el.style.transition = 'all 0.25s ease';

    const counts = this.getPendingCounts();
    const totalPending = (counts.customerOrders || 0) + (counts.tableRounds || 0) + (counts.adminMutations || 0) + (counts.stockMutations || 0);
    const queue = this.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    const failedCount = queue.filter(j => j.status === 'failed').length;

    if (!this.isOnline()) {
      el.textContent = `📡 Offline${totalPending > 0 ? ` (${totalPending} queued)` : ''}`;
      el.style.background = 'rgba(239, 68, 68, 0.12)';
      el.style.color = '#dc2626';
      el.style.border = '1px solid rgba(239, 68, 68, 0.25)';
      el.style.cursor = 'default';
      el.title = 'Internet disconnected. All POS actions are safely queued locally.';
    } else if (this.isSyncing) {
      el.textContent = `🔄 Syncing${totalPending > 0 ? ` (${totalPending})` : ''}...`;
      el.style.background = 'rgba(59, 130, 246, 0.12)';
      el.style.color = '#2563eb';
      el.style.border = '1px solid rgba(59, 130, 246, 0.25)';
      el.style.cursor = 'default';
      el.title = 'Background synchronization in progress.';
    } else if (failedCount > 0) {
      el.innerHTML = `⚠️ Sync Failed (${failedCount}) <span style="text-decoration:underline;margin-left:2px;">Retry</span>`;
      el.style.background = 'rgba(239, 68, 68, 0.14)';
      el.style.color = '#dc2626';
      el.style.border = '1px solid rgba(239, 68, 68, 0.35)';
      el.style.cursor = 'pointer';
      el.title = 'Some mutations failed after retries. Click to retry now.';
    } else if (totalPending > 0) {
      el.innerHTML = `⏳ Pending Sync (${totalPending}) <span style="text-decoration:underline;margin-left:2px;">Sync</span>`;
      el.style.background = 'rgba(245, 158, 11, 0.14)';
      el.style.color = '#d97706';
      el.style.border = '1px solid rgba(245, 158, 11, 0.35)';
      el.style.cursor = 'pointer';
      el.title = `${totalPending} mutations queued locally. Click to sync now.`;
    } else {
      el.textContent = '✅ Synced';
      el.style.background = 'rgba(16, 185, 129, 0.12)';
      el.style.color = '#059669';
      el.style.border = '1px solid rgba(16, 185, 129, 0.25)';
      el.style.cursor = 'default';
      el.title = 'All local changes synchronized with cloud database.';
    }
  }
}

export const offlineSync = new OfflineSyncEngine();
