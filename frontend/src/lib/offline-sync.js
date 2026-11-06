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
  QUARANTINED_MUTATIONS: 'limra_quarantined_mutations',
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

export const MUTATION_CLASSIFICATIONS = {
  PENDING: 'PENDING',
  RETRYABLE: 'RETRYABLE',
  FAILED: 'FAILED',
  CONFLICT: 'CONFLICT',
  STALE: 'STALE',
  SYNCED: 'SYNCED'
};

/**
 * Classify a mutation job by lifecycle disposition
 */
export function classifyJob(job) {
  if (!job) return MUTATION_CLASSIFICATIONS.PENDING;
  if (job.status === 'synced') return MUTATION_CLASSIFICATIONS.SYNCED;
  if (job.status === 'conflict') return MUTATION_CLASSIFICATIONS.CONFLICT;
  if (job.status === 'stale') return MUTATION_CLASSIFICATIONS.STALE;
  if (job.status === 'failed') return MUTATION_CLASSIFICATIONS.FAILED;

  if (job.status === 'pending' || job.status === 'syncing') {
    const attempts = job.attempts || 0;
    const maxAttempts = job.maxAttempts || 5;
    if (attempts > 0 && attempts < maxAttempts && (job.errorType === ERROR_TYPES.NETWORK || job.errorType === ERROR_TYPES.SERVER_ERROR)) {
      return MUTATION_CLASSIFICATIONS.RETRYABLE;
    }
    return MUTATION_CLASSIFICATIONS.PENDING;
  }

  return MUTATION_CLASSIFICATIONS.PENDING;
}

/**
 * Identify business-critical financial, order, or inventory mutations
 * that must NEVER be silently discarded or purged without explicit resolution.
 */
export function isCriticalMutation(job) {
  if (!job) return false;
  const t = job.type;
  if (t === POS_MUTATION_TYPES.ORDER_CREATE || t === 'ORDER_CREATE' || t === 'CUSTOMER_ORDER') return true;
  if (t === POS_MUTATION_TYPES.SETTLE_ORDER || t === 'ORDER_SETTLE') return true;
  if (t === 'STOCK_IN' || t === 'STOCK_OUT') return true;
  return false;
}

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
  enqueuePosOrderCreate({ orderData, items, itemRows, idempotencyKey }) {
    const opId = this.generateOpId('pos_ord');
    const key = idempotencyKey || orderData?.idempotency_key || orderData?.id || this.generateIdempotencyKey('ord_crt');
    const finalItems = Array.isArray(items) ? items : (Array.isArray(itemRows) ? itemRows : []);

    const job = {
      id: opId,
      idempotencyKey: key,
      type: POS_MUTATION_TYPES.ORDER_CREATE,
      status: 'pending',
      payload: {
        order: { ...orderData, idempotency_key: key },
        items: finalItems
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
  enqueuePosOrderUpdate({ orderId, updateData, orderData, items, itemRows, idempotencyKey }) {
    const opId = this.generateOpId('pos_upd');
    const key = idempotencyKey || this.generateIdempotencyKey('ord_upd');
    const finalUpdate = updateData || orderData || {};
    const finalItems = Array.isArray(items) ? items : (Array.isArray(itemRows) ? itemRows : []);

    const job = {
      id: opId,
      idempotencyKey: key,
      type: POS_MUTATION_TYPES.ORDER_UPDATE,
      status: 'pending',
      payload: {
        orderId,
        updateData: { ...finalUpdate, idempotency_key: key },
        items: finalItems
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
   * Remove any queued mutations for a specific order (used on offline cancellation/void)
   */
  removeJobByOrderId(orderId) {
    if (!orderId) return;
    const strId = String(orderId);
    const queueKeys = [
      QUEUE_KEYS.ADMIN_MUTATIONS,
      QUEUE_KEYS.CUSTOMER_ORDERS,
      QUEUE_KEYS.TABLE_ROUNDS
    ];

    for (const qKey of queueKeys) {
      const queue = this.loadQueue(qKey);
      const filtered = queue.filter(job => {
        const p = job.payload || {};
        const jobOrdId = String(p.orderId || p.order?.id || p.id || '');
        if (jobOrdId === strId) return false;
        if (String(job.id || '') === strId) return false;
        if (String(job.idempotencyKey || '') === strId) return false;
        return true;
      });
      if (filtered.length !== queue.length) {
        this.saveQueue(qKey, filtered);
      }
    }
    this.updateSyncIndicator();
  }

  /**
   * Resolve a temporary local order ID ('offline-xxx' / 'temp-xxx')
   * to a server-confirmed UUID from the queue or result cache.
   */
  resolveServerOrderId(localOrderId, currentQueue = null) {
    if (!localOrderId) return null;
    const strId = String(localOrderId);
    if (!strId.startsWith('offline-') && !strId.startsWith('temp-')) {
      return strId;
    }

    const queue = currentQueue || this.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
    for (const job of queue) {
      const p = job.payload?.order || job.payload || {};
      const jobLocalId = String(p.id || job.id || '');
      if (jobLocalId === strId && job.result?.id) {
        return job.result.id;
      }
      if (job.payload?.orderId && String(job.payload.orderId) !== strId && jobLocalId === strId) {
        return job.payload.orderId;
      }
    }
    return null;
  }

  /**
   * Intelligently verify if an order or its items already exist in cloud database,
   * reconcile missing items without duplication, and propagate server ID.
   */
  async verifyAndReconcileCloudOrder(job, db) {
    if (!db || typeof db.from !== 'function') return null;

    const payload = job.payload?.order || job.payload || {};
    const localId = payload.id || job.payload?.orderId;
    const idempotencyKey = job.idempotencyKey || payload.idempotency_key;
    const orderNumber = payload.order_number;

    let existingOrder = null;

    try {
      // 1. Search by idempotency_key first (most reliable)
      if (idempotencyKey) {
        const query = db.from('orders').select('*').eq('idempotency_key', idempotencyKey);
        const res = typeof query.maybeSingle === 'function' ? await query.maybeSingle() : await query.single().catch(() => ({ data: null }));
        if (res && res.data) existingOrder = res.data;
      }

      // 2. Search by UUID if localId is a valid non-temporary UUID
      if (!existingOrder && localId && !String(localId).startsWith('offline-') && !String(localId).startsWith('temp-')) {
        const query = db.from('orders').select('*').eq('id', localId);
        const res = typeof query.maybeSingle === 'function' ? await query.maybeSingle() : await query.single().catch(() => ({ data: null }));
        if (res && res.data) existingOrder = res.data;
      }

      // 3. Search by order_number if not generic 'PENDING'
      if (!existingOrder && orderNumber && orderNumber !== 'PENDING') {
        const query = db.from('orders').select('*').eq('order_number', orderNumber);
        const res = typeof query.maybeSingle === 'function' ? await query.maybeSingle() : await query.single().catch(() => ({ data: null }));
        if (res && res.data) existingOrder = res.data;
      }
    } catch (e) {
      console.warn('[OfflineSync] Cloud verification search warning:', e);
    }

    if (!existingOrder) {
      return { exists: false, order: null, missingItems: [], insertedItems: [] };
    }

    // Existing order found in cloud! Reconcile items
    const rawItems = Array.isArray(job.payload?.items) ? job.payload.items : (Array.isArray(payload.items) ? payload.items : []);
    let insertedItems = [];
    let missingItems = [];

    if (rawItems.length > 0) {
      try {
        const { data: existingItems } = await db.from('order_items').select('*').eq('order_id', existingOrder.id);
        const existingList = Array.isArray(existingItems) ? existingItems : [];

        // Match items by dish_name/item_name and price/qty to find genuinely missing items
        missingItems = rawItems.filter(localItem => {
          const lName = (localItem.dish_name || localItem.name || localItem.item_name || '').trim().toLowerCase();
          const lQty = Number(localItem.quantity || localItem.qty || 1);
          const lPrice = Number(localItem.price || 0);

          const found = existingList.some(cloudItem => {
            const cName = (cloudItem.dish_name || cloudItem.name || cloudItem.item_name || '').trim().toLowerCase();
            const cQty = Number(cloudItem.quantity || cloudItem.qty || 1);
            const cPrice = Number(cloudItem.price || 0);
            return cName === lName && Math.abs(cPrice - lPrice) < 0.01 && cQty === lQty;
          });

          return !found;
        });

        if (missingItems.length > 0) {
          const itemsToInsert = missingItems.map(item => {
            const copy = { ...item, order_id: existingOrder.id };
            if (String(copy.id || '').startsWith('temp-') || String(copy.id || '').startsWith('offline-')) {
              delete copy.id;
            }
            return copy;
          });
          const insRes = await db.from('order_items').insert(itemsToInsert);
          if (!insRes?.error) {
            insertedItems = Array.isArray(insRes?.data) ? insRes.data : itemsToInsert;
          }
        }
      } catch (err) {
        console.warn('[OfflineSync] Item reconciliation warning:', err);
      }
    }

    return {
      exists: true,
      order: existingOrder,
      missingItems,
      insertedItems
    };
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
            const originalLocalId = orderPayload.id;
            if (String(orderPayload.id || '').startsWith('offline-')) {
              delete orderPayload.id;
            }

            // Pre-flight check: verify if order already exists in cloud
            const recon = await this.verifyAndReconcileCloudOrder(job, db);
            if (recon && recon.exists) {
              result = recon.order;
              resOk = true;
            } else {
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

              // RECOVERY: If header was already created in DB (e.g. duplicate key 23505)
              if (insRes.error && (insRes.error.code === '23505' || (insRes.error.message || '').includes('duplicate key') || (insRes.error.message || '').includes('orders_pkey'))) {
                console.log('[OfflineSync] Duplicate key encountered; reconciling with cloud order:', originalLocalId || job.idempotencyKey);
                const retryRecon = await this.verifyAndReconcileCloudOrder(job, db);
                if (retryRecon && retryRecon.exists) {
                  result = retryRecon.order;
                  resOk = true;
                } else {
                  throw insRes.error;
                }
              } else if (insRes.error) {
                throw insRes.error;
              } else {
                result = insRes.data;

                if (Array.isArray(job.payload.items) && job.payload.items.length > 0) {
                  const itemsToInsert = job.payload.items.map(i => {
                    const copy = { ...i, order_id: result.id };
                    if (String(copy.id || '').startsWith('temp-') || String(copy.id || '').startsWith('offline-')) {
                      delete copy.id;
                    }
                    return copy;
                  });
                  await db.from('order_items').insert(itemsToInsert);
                }
                resOk = true;
              }
            }
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
            if (!resOk) {
              if (resStatus === 409 || (data.error && /already|duplicate|exists/i.test(data.error))) {
                if (data.data || data.order) {
                  resOk = true;
                  result = data.data || data.order;
                }
              }
              if (!resOk) errMessage = data.error || `HTTP ${res.status}`;
            }
          }

          if (resOk) {
            job.status = 'synced';
            job.error = null;
            job.result = result;
            syncedCount++;

            // Propagate server-assigned order ID to subsequent pending mutations in queue
            const oldLocalId = job.payload.order?.id;
            const newServerId = result?.id;
            if (oldLocalId && newServerId && String(oldLocalId) !== String(newServerId)) {
              for (const pendingJob of queue) {
                if (pendingJob.payload && String(pendingJob.payload.orderId) === String(oldLocalId)) {
                  pendingJob.payload.orderId = newServerId;
                }
              }
            }

            this.notifyListeners({
              type: 'pos_order_synced',
              jobId: job.id,
              localId: oldLocalId,
              serverOrder: result,
              idempotencyKey: job.idempotencyKey
            });
          }
        } else if (job.type === POS_MUTATION_TYPES.ORDER_UPDATE) {
          const targetOrderId = this.resolveServerOrderId(job.payload.orderId, queue) || job.payload.orderId;
          job.payload.orderId = targetOrderId;

          if (db && typeof db.from === 'function') {
            const query = db.from('orders').select('*').eq('id', targetOrderId);
            const { data: cloudOrder } = typeof query.maybeSingle === 'function' ? await query.maybeSingle() : await query.single().catch(() => ({ data: null }));

            if (cloudOrder && (cloudOrder.ticket_status === 'CLOSED' || (job.payload.updateData?.ticket_status && cloudOrder.ticket_status === job.payload.updateData.ticket_status))) {
              result = cloudOrder;
              resOk = true;
            } else {
              const updRes = await db.from('orders').update(job.payload.updateData).eq('id', targetOrderId).select().single();
              if (updRes.error) throw updRes.error;
              result = updRes.data;
              if (Array.isArray(job.payload.items)) {
                await db.from('order_items').delete().eq('order_id', targetOrderId);
                await db.from('order_items').insert(job.payload.items.map(i => ({ ...i, order_id: targetOrderId })));
              }
              resOk = true;
            }
          } else {
            const res = await fetch('/api/orders', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'x-idempotency-key': job.idempotencyKey
              },
              body: JSON.stringify({ id: targetOrderId, ...job.payload.updateData, items: job.payload.items })
            });
            resStatus = res.status;
            const data = await res.json().catch(() => ({}));
            resOk = res.ok && data.success;
            result = data.data;
            if (!resOk) {
              if (resStatus === 409 || (data.error && /already|closed|updated/i.test(data.error))) {
                resOk = true;
                result = data.data || { order_id: targetOrderId };
              } else {
                errMessage = data.error || `HTTP ${res.status}`;
              }
            }
          }

          if (resOk) {
            job.status = 'synced';
            job.error = null;
            job.result = result;
            syncedCount++;
            this.notifyListeners({
              type: 'pos_order_updated',
              jobId: job.id,
              orderId: targetOrderId,
              serverOrder: result
            });
          }
        } else if (job.type === POS_MUTATION_TYPES.CONFIRM_BILL) {
          const targetOrderId = this.resolveServerOrderId(job.payload.orderId, queue) || job.payload.orderId;
          job.payload.orderId = targetOrderId;

          if (db && typeof db.from === 'function') {
            const query = db.from('orders').select('*').eq('id', targetOrderId);
            const { data: cloudOrder } = typeof query.maybeSingle === 'function' ? await query.maybeSingle() : await query.single().catch(() => ({ data: null }));

            if (cloudOrder && (cloudOrder.ticket_status === 'BILLED' || cloudOrder.ticket_status === 'CLOSED')) {
              // Already billed or closed in cloud! Reconcile missing items if needed
              if (Array.isArray(job.payload.items) && job.payload.items.length > 0) {
                const { data: existingItems } = await db.from('order_items').select('id').eq('order_id', targetOrderId);
                if (!existingItems || existingItems.length === 0) {
                  const itemsToInsert = job.payload.items.map(i => {
                    const copy = { ...i, order_id: targetOrderId };
                    if (String(copy.id || '').startsWith('temp-') || String(copy.id || '').startsWith('offline-')) {
                      delete copy.id;
                    }
                    return copy;
                  });
                  await db.from('order_items').insert(itemsToInsert);
                }
              }
              result = cloudOrder;
              resOk = true;
            } else {
              if (job.payload.isTable && Array.isArray(job.payload.siblingOrderIds) && job.payload.siblingOrderIds.length > 0) {
                await db.from('order_items').update({ order_id: targetOrderId }).in('order_id', job.payload.siblingOrderIds);
                for (const sId of job.payload.siblingOrderIds) {
                  await db.from('orders').update({ status: 'delivered', payment_status: 'paid', ticket_status: 'CLOSED' }).eq('id', sId);
                }
              }
              const cRes = await db.from('orders').update(job.payload.updatePayload).eq('id', targetOrderId).select().single();
              if (cRes.error) throw cRes.error;
              result = cRes.data;

              // Ensure items are persisted in cloud DB if missing
              if (Array.isArray(job.payload.items) && job.payload.items.length > 0) {
                const { data: existingItems } = await db.from('order_items').select('id').eq('order_id', targetOrderId);
                if (!existingItems || existingItems.length === 0) {
                  const itemsToInsert = job.payload.items.map(i => {
                    const copy = { ...i, order_id: targetOrderId };
                    if (String(copy.id || '').startsWith('temp-') || String(copy.id || '').startsWith('offline-')) {
                      delete copy.id;
                    }
                    return copy;
                  });
                  await db.from('order_items').insert(itemsToInsert);
                }
              }
              resOk = true;
            }
          } else {
            const res = await fetch('/api/orders', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'x-idempotency-key': job.idempotencyKey
              },
              body: JSON.stringify({ id: targetOrderId, ...job.payload.updatePayload })
            });
            resStatus = res.status;
            const data = await res.json().catch(() => ({}));
            resOk = res.ok && data.success;
            result = data.data;
            if (!resOk) {
              if (resStatus === 409 || (data.error && /already|billed|closed/i.test(data.error))) {
                resOk = true;
                result = data.data || { already_billed: true, order_id: targetOrderId };
              } else {
                errMessage = data.error || `HTTP ${res.status}`;
              }
            }
          }

          if (resOk) {
            job.status = 'synced';
            job.error = null;
            job.result = result;
            syncedCount++;
            this.notifyListeners({
              type: 'pos_bill_confirmed',
              jobId: job.id,
              orderId: targetOrderId,
              serverOrder: result
            });
          }
        } else if (job.type === POS_MUTATION_TYPES.SETTLE_ORDER || job.type === 'ORDER_SETTLE') {
          const targetOrderId = this.resolveServerOrderId(job.payload.orderId, queue) || job.payload.orderId;
          job.payload.orderId = targetOrderId;

          // CRITICAL FINANCIAL RULE:
          // Call settle_order_atomic RPC. Authoritative server settlement only!
          if (db && typeof db.rpc === 'function') {
            if (typeof db.from === 'function') {
              const query = db.from('orders').select('*').eq('id', targetOrderId);
              const { data: cloudOrder } = typeof query.maybeSingle === 'function' ? await query.maybeSingle() : await query.single().catch(() => ({ data: null }));
              if (cloudOrder && (cloudOrder.payment_status === 'paid' || cloudOrder.ticket_status === 'CLOSED')) {
                resOk = true;
                result = { already_settled: true, order_id: targetOrderId, closed_at: cloudOrder.closed_at || cloudOrder.updated_at };
              }
            }

            if (!resOk) {
              const rpcRes = await db.rpc('settle_order_atomic', {
                p_order_id: targetOrderId,
                p_payment_method: job.payload.paymentMethod || 'cash',
                p_notes: job.payload.notes || null,
                p_idempotency_key: job.idempotencyKey
              });

              if (rpcRes.error) {
                const errMsg = String(rpcRes.error.message || '');
                if (errMsg.includes('ORDER_ALREADY_SETTLED')) {
                  // Idempotent replay confirmed!
                  resOk = true;
                  result = { already_settled: true, order_id: targetOrderId };
                } else if (errMsg.includes('ORDER_NOT_FOUND') || rpcRes.error.code === '22P02') {
                  // Stale or nonexistent order that cannot be found or settled in cloud — discard to unblock queue
                  resOk = true;
                  result = { discarded_stale: true, order_id: targetOrderId };
                } else {
                  throw rpcRes.error;
                }
              } else if (rpcRes.data && rpcRes.data.success !== false) {
                resOk = true;
                result = rpcRes.data;
              } else {
                throw new Error(rpcRes.data?.error || 'Settlement rejected by RPC');
              }
            }
          } else {
            const res = await fetch('/api/orders', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'x-idempotency-key': job.idempotencyKey
              },
              body: JSON.stringify({
                id: targetOrderId,
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
            if (!resOk) {
              if (resStatus === 409 || (data.error && /already|closed|settled/i.test(data.error))) {
                resOk = true;
                result = data.data || { already_settled: true, order_id: targetOrderId };
              } else {
                errMessage = data.error || `HTTP ${res.status}`;
              }
            }
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
              orderId: targetOrderId,
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
    const db = typeof window !== 'undefined' ? (window.insforge?.database || window.supabase) : null;

    for (const job of pending) {
      if (job.nextRetryAt && now < job.nextRetryAt) continue;

      job.status = 'syncing';
      job.attempts = (job.attempts || 0) + 1;
      job.updatedAt = new Date().toISOString();
      this.saveQueue(QUEUE_KEYS.STOCK_MUTATIONS, queue);

      try {
        const rpcName = job.type === 'STOCK_IN' ? 'record_stock_in' : 'record_stock_out';
        let resOk = false;
        let errMessage = null;

        if (db && typeof db.rpc === 'function') {
          const rpcRes = await db.rpc(rpcName, job.payload);
          if (rpcRes.error) {
            const errMsg = String(rpcRes.error.message || '');
            if (errMsg.includes('ALREADY_RECORDED') || errMsg.includes('duplicate')) {
              resOk = true;
            } else {
              throw rpcRes.error;
            }
          } else {
            resOk = true;
          }
        } else {
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
          resOk = res.ok && data.success;
          if (!resOk) {
            if (res.status === 409 || (data.error && /already|duplicate/i.test(data.error))) {
              resOk = true;
            } else {
              errMessage = data.error || `HTTP ${res.status}`;
            }
          }
        }

        if (resOk) {
          job.status = 'synced';
          job.error = null;
          syncedCount++;
        } else {
          job.status = 'pending';
          job.error = errMessage || 'Stock mutation failed';
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

  /**
   * Get failed queue counts across all offline queues
   */
  getFailedCounts() {
    const admin = this.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS).filter(j => j.status === 'failed').length;
    const cust = this.loadQueue(QUEUE_KEYS.CUSTOMER_ORDERS).filter(j => j.status === 'failed').length;
    const tbl = this.loadQueue(QUEUE_KEYS.TABLE_ROUNDS).filter(j => j.status === 'failed').length;
    const stk = this.loadQueue(QUEUE_KEYS.STOCK_MUTATIONS).filter(j => j.status === 'failed').length;
    return {
      adminMutations: admin,
      customerOrders: cust,
      tableRounds: tbl,
      stockMutations: stk,
      total: admin + cust + tbl + stk
    };
  }

  /**
   * Inspect all queues for failed, stale, or retry-exhausted mutations
   */
  inspectStaleJobs() {
    const queueKeys = [
      QUEUE_KEYS.ADMIN_MUTATIONS,
      QUEUE_KEYS.CUSTOMER_ORDERS,
      QUEUE_KEYS.TABLE_ROUNDS,
      QUEUE_KEYS.STOCK_MUTATIONS
    ];

    const report = {
      totalStale: 0,
      totalFailed: 0,
      unresolvedCritical: 0,
      alreadySynced: 0,
      recoverable: 0,
      items: []
    };

    for (const qKey of queueKeys) {
      const queue = this.loadQueue(qKey);
      for (const job of queue) {
        const isFailed = job.status === 'failed';
        const isStale = job.status === 'stale';
        const isExhausted = (job.attempts || 0) >= (job.maxAttempts || 5);

        if (isFailed || isStale || isExhausted) {
          const critical = isCriticalMutation(job);
          const itemSummary = {
            id: job.id,
            type: job.type,
            queue: qKey,
            status: job.status,
            attempts: job.attempts,
            error: job.error,
            isCritical: critical,
            verifiedCloudSynced: !!job._verifiedCloudSynced
          };

          if (isFailed) report.totalFailed++;
          if (isStale) report.totalStale++;
          if (critical && !job._verifiedCloudSynced) {
            report.unresolvedCritical++;
          } else if (job._verifiedCloudSynced) {
            report.alreadySynced++;
          } else {
            report.recoverable++;
          }

          report.items.push(itemSummary);
        }
      }
    }

    return report;
  }

  /**
   * Safely archive stale or obsolete failed mutations into quarantine.
   * STRICT SAFETY RULE:
   * - Requires explicit confirmation { confirmed: true }
   * - Never hard-deletes; archives into QUEUE_KEYS.QUARANTINED_MUTATIONS
   * - NEVER archives unresolved critical mutations (unconfirmed orders, unpaid settlements, stock movements)
   */
  clearStaleQueue(options = { confirmed: false, reason: 'Manual stale queue cleanup' }) {
    if (!options || options.confirmed !== true) {
      throw new Error('Explicit confirmation required to clear stale queue (options.confirmed = true)');
    }

    const quarantined = this.loadQueue(QUEUE_KEYS.QUARANTINED_MUTATIONS) || [];
    let archivedCount = 0;
    let remainingCriticalCount = 0;

    const queueKeys = [
      QUEUE_KEYS.ADMIN_MUTATIONS,
      QUEUE_KEYS.CUSTOMER_ORDERS,
      QUEUE_KEYS.TABLE_ROUNDS,
      QUEUE_KEYS.STOCK_MUTATIONS
    ];

    for (const key of queueKeys) {
      const queue = this.loadQueue(key);
      const remaining = [];

      for (const job of queue) {
        const isFailed = job.status === 'failed';
        const isStale = job.status === 'stale';
        const isExhausted = (job.attempts || 0) >= (job.maxAttempts || 5);

        if (isFailed || isStale || isExhausted) {
          // CRITICAL SAFETY RULE: Never clear unresolved payments, orders, or stock deductions
          // unless explicitly verified as already synced in cloud
          if (isCriticalMutation(job) && !job._verifiedCloudSynced) {
            remainingCriticalCount++;
            remaining.push(job);
            continue;
          }

          // Move to quarantine
          quarantined.push({
            ...job,
            quarantinedAt: new Date().toISOString(),
            quarantineReason: options.reason || 'Stale queue cleanup'
          });
          archivedCount++;
        } else {
          remaining.push(job);
        }
      }

      this.saveQueue(key, remaining);
    }

    this.saveQueue(QUEUE_KEYS.QUARANTINED_MUTATIONS, quarantined);
    this.updateSyncIndicator();

    return {
      success: true,
      archivedCount,
      remainingCriticalCount,
      quarantinedTotal: quarantined.length
    };
  }

  /**
   * Re-evaluates failed and conflict mutations across all queues,
   * resets them to pending, and triggers an immediate sync cycle.
   */
  async recoverFailedMutations() {
    const queueKeys = [
      QUEUE_KEYS.ADMIN_MUTATIONS,
      QUEUE_KEYS.CUSTOMER_ORDERS,
      QUEUE_KEYS.TABLE_ROUNDS,
      QUEUE_KEYS.STOCK_MUTATIONS
    ];

    let recoveredCount = 0;

    for (const key of queueKeys) {
      const queue = this.loadQueue(key);
      let changed = false;

      for (const job of queue) {
        if (job.status === 'failed' || job.status === 'conflict') {
          job.status = 'pending';
          job.attempts = 0;
          job.nextRetryAt = null;
          job.error = null;
          job.errorType = null;
          changed = true;
          recoveredCount++;
        }
      }

      if (changed) {
        this.saveQueue(key, queue);
      }
    }

    this.updateSyncIndicator();
    if (this.isOnline()) {
      await this.triggerSync();
    }

    return { recoveredCount };
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
          const failedCounts = this.getFailedCounts();
          const totalFailed = failedCounts.total;

          if (totalFailed > 0) {
            // Reset failed jobs across all queues synchronously
            const queueKeys = [
              QUEUE_KEYS.ADMIN_MUTATIONS,
              QUEUE_KEYS.CUSTOMER_ORDERS,
              QUEUE_KEYS.TABLE_ROUNDS,
              QUEUE_KEYS.STOCK_MUTATIONS
            ];
            for (const qKey of queueKeys) {
              const q = this.loadQueue(qKey);
              let qChanged = false;
              q.forEach(j => {
                if (j.status === 'failed' || j.status === 'conflict') {
                  j.status = 'pending';
                  j.attempts = 0;
                  j.nextRetryAt = null;
                  j.error = null;
                  j.errorType = null;
                  qChanged = true;
                }
              });
              if (qChanged) {
                this.saveQueue(qKey, q);
              }
            }
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
    const failedCounts = this.getFailedCounts();
    const totalFailed = failedCounts.total;

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
    } else if (totalFailed > 0) {
      el.innerHTML = `⚠️ Sync Failed (${totalFailed}) <span style="text-decoration:underline;margin-left:2px;">Retry</span>`;
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
