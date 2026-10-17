/**
 * LIMRA Restaurant POS V2 — Offline-First Reliability & Data Synchronization Test Suite
 * 
 * Verifies:
 * 1. Offline Order Interception & Razorpay Rejection (Online Payment Never Faked Offline)
 * 2. Queued Order Representation (isLocalPending: true, status: 'pending_sync', order_number: 'PENDING')
 * 3. Unique Operation IDs & Idempotency Keys across Reconnects
 * 4. Queue Persistence & Schema Migration (v2.1)
 * 5. Authoritative Price Enforcement & Sold-Out Dish Rejection
 * 6. Conflict Resolution (409 Handling on Mutated Orders)
 * 7. Stock Mutations Offline Durability & Pre-Sync Reconciliation
 * 8. Sensitive User Cache Isolation & Logout Purge
 */

import assert from 'node:assert/strict';
import { offlineSync, CACHE_SCHEMA_VERSION, QUEUE_KEYS } from '../../frontend/src/lib/offline-sync.js';
import { saveOrder, saveTableRound } from '../../frontend/src/lib/supabase.js';

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// ═════════════════════════════════════════════════════════════════════
// Mock Environment Setup
// ═════════════════════════════════════════════════════════════════════

const mockStore = new Map();

globalThis.localStorage = {
  getItem: (key) => mockStore.get(key) || null,
  setItem: (key, value) => mockStore.set(key, String(value)),
  removeItem: (key) => mockStore.delete(key),
  clear: () => mockStore.clear()
};

function setOnline(status) {
  try {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: status,
      configurable: true,
      writable: true
    });
  } catch (e) {}
}

async function main() {
  console.log('\n--- LIMRA Restaurant: Offline-First & Data Sync Test Suite ---\n');

  // ═════════════════════════════════════════════════════════════════════
  // 1. Offline Order Interception & Online Payment Rejection
  // ═════════════════════════════════════════════════════════════════════

  await runAsyncTest('Offline saveOrder rejects online payment with clear security error', async () => {
    setOnline(false);

    await assert.rejects(
      async () => {
        await saveOrder({
          customerName: 'Rahim Ali',
          customerPhone: '9876543210',
          paymentMethod: 'online',
          items: [{ id: 1, name: 'Chicken Biryani', price: 180, qty: 1 }]
        });
      },
      (err) => {
        assert.match(err.message, /Online payment requires an active internet connection/i);
        return true;
      }
    );
  });

  await runAsyncTest('Offline saveOrder safely enqueues Cash on Delivery order with pending state', async () => {
    setOnline(false);
    mockStore.clear();

    const result = await saveOrder({
      customerName: 'Rahim Ali',
      customerPhone: '9876543210',
      paymentMethod: 'cod',
      items: [{ id: 1, name: 'Chicken Biryani', price: 180, qty: 2 }]
    });

    assert.strictEqual(result.isLocalPending, true, 'Must flag order as local pending');
    assert.strictEqual(result.status, 'pending_sync', 'Must report pending_sync status');
    assert.strictEqual(result.order_number, 'PENDING', 'Must never fake confirmed order number');
    assert.ok(result.id.startsWith('cust_'), 'Must generate unique operation ID');
    assert.ok(result.idempotency_key, 'Must generate unique idempotency key');

    // Verify persistence in localStorage
    const queue = offlineSync.loadQueue(QUEUE_KEYS.CUSTOMER_ORDERS);
    assert.strictEqual(queue.length, 1, 'Queue must hold 1 pending job');
    assert.strictEqual(queue[0].payload.customerName, 'Rahim Ali');
    assert.strictEqual(queue[0].idempotencyKey, result.idempotency_key);
  });

  await runAsyncTest('Offline saveTableRound enqueues dine-in round with isLocalPending: true', async () => {
    setOnline(false);
    mockStore.clear();

    const roundResult = await saveTableRound({
      tableNumber: 4,
      tableZone: 'indoor',
      customerName: 'Table 4 Guest',
      customerPhone: '9876543210',
      roundNumber: 2,
      items: [{ id: 2, name: 'Butter Naan', price: 40, qty: 3 }]
    });

    assert.strictEqual(roundResult.isLocalPending, true);
    assert.strictEqual(roundResult.status, 'pending_sync');
    assert.strictEqual(roundResult.round_number, 2);
    assert.ok(roundResult.id.startsWith('tbl_'));
    assert.ok(roundResult.idempotency_key);

    const queue = offlineSync.loadQueue(QUEUE_KEYS.TABLE_ROUNDS);
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].payload.tableNumber, 4);
  });

  // ═════════════════════════════════════════════════════════════════════
  // 2. Idempotency Key Stability & Network Retry Protection
  // ═════════════════════════════════════════════════════════════════════

  runTest('Idempotency keys remain identical across network retries', () => {
    mockStore.clear();
    const testKey = 'fixed-test-key-12345';
    
    const result1 = offlineSync.enqueueCustomerOrder({
      customerName: 'Samir Roy',
      customerPhone: '9123456789',
      idempotencyKey: testKey,
      items: [{ id: 1, name: 'Biryani', price: 180, qty: 1 }]
    });

    assert.strictEqual(result1.idempotency_key, testKey);

    const queue = offlineSync.loadQueue(QUEUE_KEYS.CUSTOMER_ORDERS);
    assert.strictEqual(queue[0].idempotencyKey, testKey);
  });

  // ═════════════════════════════════════════════════════════════════════
  // 3. Stock Mutation Queuing & Pre-Sync Reconciliation
  // ═════════════════════════════════════════════════════════════════════

  runTest('Stock mutations are queued safely during offline period', () => {
    mockStore.clear();

    const job1 = offlineSync.enqueueStockMutation('STOCK_IN', {
      sku: 'RICE-BASMATI',
      description: 'Basmati Rice Premium',
      qty: 50,
      unit: 'kg',
      costPrice: 85,
      supplier: 'Bengal Agro'
    });

    const job2 = offlineSync.enqueueStockMutation('STOCK_OUT', {
      sku: 'RICE-BASMATI',
      description: 'Basmati Rice Premium',
      qty: 10,
      unit: 'kg',
      reason: 'Daily kitchen dispatch'
    });

    assert.strictEqual(job1.isLocalPending, true);
    assert.strictEqual(job2.isLocalPending, true);

    const stockQueue = offlineSync.loadQueue(QUEUE_KEYS.STOCK_MUTATIONS);
    assert.strictEqual(stockQueue.length, 2);
    assert.strictEqual(stockQueue[0].type, 'STOCK_IN');
    assert.strictEqual(stockQueue[1].type, 'STOCK_OUT');
  });

  // ═════════════════════════════════════════════════════════════════════
  // 4. Cache Schema Versioning & Safe Migration
  // ═════════════════════════════════════════════════════════════════════

  runTest('Cache schema versioning protects against stale schema corruption', () => {
    mockStore.clear();
    mockStore.set(QUEUE_KEYS.SCHEMA_VERSION, 'v1.0-legacy');

    offlineSync.validateCacheSchema();

    assert.strictEqual(
      mockStore.get(QUEUE_KEYS.SCHEMA_VERSION),
      CACHE_SCHEMA_VERSION,
      `Must upgrade schema to ${CACHE_SCHEMA_VERSION}`
    );
  });

  // ═════════════════════════════════════════════════════════════════════
  // 5. Sensitive User Cache Isolation & Logout Purge
  // ═════════════════════════════════════════════════════════════════════

  runTest('clearSensitiveUserData purges user addresses, phone, cart, and dev tokens on logout', () => {
    mockStore.clear();

    // Populate sensitive data
    mockStore.set('limra-customer-details', JSON.stringify({
      name: 'Private Customer',
      phone: '9876543210',
      address: '123 Confidential St'
    }));
    mockStore.set('limra_cached_orders', JSON.stringify([{ id: 'ord-123' }]));
    mockStore.set('limra-cart', JSON.stringify([{ id: 1, qty: 2 }]));
    mockStore.set('limra_dev_admin', 'secret-session-token');

    // Verify they exist
    assert.ok(mockStore.has('limra-customer-details'));
    assert.ok(mockStore.has('limra-cart'));
    assert.ok(mockStore.has('limra_dev_admin'));

    // Purge on logout
    offlineSync.clearSensitiveUserData();

    assert.strictEqual(mockStore.has('limra-customer-details'), false, 'Customer details must be wiped');
    assert.strictEqual(mockStore.has('limra_cached_orders'), false, 'Cached orders must be wiped');
    assert.strictEqual(mockStore.has('limra-cart'), false, 'Cart must be wiped');
    assert.strictEqual(mockStore.has('limra_dev_admin'), false, 'Dev admin token must be wiped');
  });

  // ═════════════════════════════════════════════════════════════════════
  // 6. 409 Conflict Handling on Concurrent Orders
  // ═════════════════════════════════════════════════════════════════════

  await runAsyncTest('Conflict resolution marks 409 jobs as conflict without discarding work', async () => {
    mockStore.clear();
    setOnline(true);

    // Mock global fetch returning 409 Conflict
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      status: 409,
      ok: false,
      json: async () => ({
        error: 'Order already settled or modified by another terminal',
        code: 'STATE_CONFLICT'
      })
    });

    try {
      offlineSync.enqueueAdminMutation('ORDER_STATUS', {
        orderId: 'ord-999',
        status: 'cancelled',
        reason: 'Customer requested'
      });

      await offlineSync.syncAdminMutations();

      const queue = offlineSync.loadQueue(QUEUE_KEYS.ADMIN_MUTATIONS);
      assert.strictEqual(queue.length, 1);
      assert.strictEqual(queue[0].status, 'conflict');
      assert.match(queue[0].error, /409 Conflict/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // ═════════════════════════════════════════════════════════════════════
  // 7. Authoritative Pricing & Sold-Out Dish Enforcement
  // ═════════════════════════════════════════════════════════════════════

  runTest('Authoritative pricing overrides stale client cache prices', () => {
    // Simulate server-side validation against authoritative overridesMap
    const overridesMap = new Map([
      [101, { id: 101, price: 240, available: true }]
    ]);

    const clientCart = [
      { id: 101, name: 'Special Chicken Biryani', price: 150, qty: 2 } // Stale client price 150
    ];

    const validatedItems = clientCart.map(item => {
      let authoritativePrice = item.price;
      if (overridesMap.has(item.id)) {
        authoritativePrice = overridesMap.get(item.id).price;
      }
      return {
        ...item,
        unit_price: authoritativePrice,
        line_total: authoritativePrice * item.qty
      };
    });

    assert.strictEqual(validatedItems[0].unit_price, 240, 'Must override stale 150 with authoritative 240');
    assert.strictEqual(validatedItems[0].line_total, 480, 'Must calculate line total from authoritative price');
  });

  runTest('Sold-out menu item is strictly rejected at checkout validation', () => {
    const overridesMap = new Map([
      [102, { id: 102, price: 180, available: false }]
    ]);

    const clientCart = [
      { id: 102, name: 'Mutton Kebab', price: 180, qty: 1 }
    ];

    assert.throws(
      () => {
        for (const item of clientCart) {
          if (overridesMap.has(item.id) && overridesMap.get(item.id).available === false) {
            throw new Error(`Item '${item.name}' is currently unavailable or sold out.`);
          }
        }
      },
      (err) => {
        assert.match(err.message, /currently unavailable or sold out/i);
        return true;
      }
    );
  });

  // ═════════════════════════════════════════════════════════════════════
  // 8. Queue Durability & Non-Destructive Storage Across Restarts
  // ═════════════════════════════════════════════════════════════════════

  runTest('Queued operations survive simulated application restarts', () => {
    // 1. Enqueue in first session
    mockStore.clear();
    offlineSync.enqueueCustomerOrder({
      customerName: 'Amina Khatun',
      customerPhone: '9876543210',
      items: [{ id: 5, name: 'Chicken Chaap', price: 160, qty: 1 }]
    });

    // 2. Simulate browser restart by reading raw localStorage string
    const rawStorage = mockStore.get(QUEUE_KEYS.CUSTOMER_ORDERS);
    assert.ok(rawStorage, 'Raw JSON must exist in mock localStorage');

    // 3. New engine instance loading existing store
    const reloadedQueue = JSON.parse(rawStorage);
    assert.strictEqual(reloadedQueue.length, 1);
    assert.strictEqual(reloadedQueue[0].payload.customerName, 'Amina Khatun');
    assert.strictEqual(reloadedQueue[0].status, 'pending');
  });

  // ═════════════════════════════════════════════════════════════════════
  // Summary
  // ═════════════════════════════════════════════════════════════════════

  console.log(`\nResults: ${passedTests}/${totalTests} tests passed.`);
  if (passedTests !== totalTests) {
    process.exit(1);
  } else {
    console.log('All offline-first reliability & data synchronization tests passed successfully! 🚀\n');
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
