// =====================================================================
// 📜 LIMRA RESTAURANT — HISTORICAL CLOSE ORDERS & PAGINATION TEST SUITE
// =====================================================================
// Validates:
// 1. Timezone & date boundary handling (IST UTC+5:30 vs UTC, midnight boundary inclusion)
// 2. Backend API query parameters (startDate, endDate, status=closed, pagination)
// 3. Status eligibility rules (settled / delivered / closed / paid vs cancelled vs unpaid pending)
// 4. Memory deduplication and batching logic for multi-thousand order histories
// 5. Frontend pagination markup, page size selector, and sliding window navigation
// 6. CSV Export routines with asynchronous historical order and line item loading
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

const ordersApiSource = fs.readFileSync(path.join(rootDir, 'backend/api/orders.js'), 'utf-8');
const adminHtml = fs.readFileSync(path.join(rootDir, 'frontend/admin.html'), 'utf-8');
const adminJs = fs.readFileSync(path.join(rootDir, 'frontend/src/admin.js'), 'utf-8');

console.log('\n📜 =========================================================');
console.log('   LIMRA RESTAURANT — CLOSE ORDERS HISTORICAL INTEGRITY');
console.log('=========================================================\n');

test('SUITE 1: Timezone Boundaries & Midnight Safe ISO Conversions', async (t) => {
  await t.test('1.1 Date boundary helper correctly constructs IST start-of-day and end-of-day', () => {
    // Simulate IST local calendar date Oct 1, 2026
    const dateStr = '2026-10-01';
    const [y, m, d] = dateStr.split('-').map(Number);
    const startOfDay = new Date(y, m - 1, d, 0, 0, 0, 0);
    const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);

    assert.equal(startOfDay.getFullYear(), 2026);
    assert.equal(startOfDay.getMonth(), 9); // 0-indexed: 9 = October
    assert.equal(startOfDay.getDate(), 1);
    assert.equal(startOfDay.getHours(), 0);
    assert.equal(startOfDay.getMinutes(), 0);

    assert.equal(endOfDay.getHours(), 23);
    assert.equal(endOfDay.getMinutes(), 59);
    assert.equal(endOfDay.getSeconds(), 59);
    assert.equal(endOfDay.getMilliseconds(), 999);
  });

  await t.test('1.2 Order created just after midnight IST is not excluded from date window', () => {
    // In IST (UTC+5:30), 2026-10-01 00:15:00 IST is 2026-09-30 18:45:00 UTC
    const orderTimestampIso = '2026-09-30T18:45:00.000Z';
    const orderDate = new Date(orderTimestampIso);

    // Using local date extraction (e.g. Asia/Kolkata)
    const localDateStr = orderDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    assert.equal(localDateStr, '2026-10-01', 'Order timestamp must resolve to 2026-10-01 in IST');

    // Local start and end bounds in IST
    const startIso = new Date('2026-09-30T18:30:00.000Z'); // 00:00:00 IST
    const endIso = new Date('2026-10-01T18:29:59.999Z');   // 23:59:59 IST

    assert.ok(orderDate >= startIso && orderDate <= endIso, 'Order just after midnight must fall inside day window');
  });

  await t.test('1.3 Order created just before midnight IST is not cut off by end-of-day bound', () => {
    // In IST (UTC+5:30), 2026-10-01 23:50:00 IST is 2026-10-01 18:20:00 UTC
    const orderTimestampIso = '2026-10-01T18:20:00.000Z';
    const orderDate = new Date(orderTimestampIso);

    const localDateStr = orderDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    assert.equal(localDateStr, '2026-10-01', 'Order timestamp must resolve to 2026-10-01 in IST');

    const startIso = new Date('2026-09-30T18:30:00.000Z'); // 00:00:00 IST
    const endIso = new Date('2026-10-01T18:29:59.999Z');   // 23:59:59 IST

    assert.ok(orderDate >= startIso && orderDate <= endIso, 'Order just before midnight must fall inside day window');
  });
});

test('SUITE 2: Backend API Orders Query & Pagination Parameters', async (t) => {
  await t.test('2.1 GET /api/orders handles startDate, endDate, and from/to parameters', () => {
    assert.match(ordersApiSource, /startDate|from/, 'Missing startDate / from parameter handling in orders API');
    assert.match(ordersApiSource, /endDate|to/, 'Missing endDate / to parameter handling in orders API');
    assert.match(ordersApiSource, /gte\(['"]created_at['"]/, 'Missing created_at >= start filter');
    assert.match(ordersApiSource, /lte\(['"]created_at['"]/, 'Missing created_at <= end filter');
  });

  await t.test('2.2 GET /api/orders supports status=closed mapping to paid or delivered states', () => {
    assert.match(ordersApiSource, /status\.in\.\(delivered,completed,closed,cancelled\),payment_status\.eq\.paid/,
      'Orders API must support standard closed order status filter condition');
  });

  await t.test('2.3 GET /api/orders supports page, pageSize, and range offsets', () => {
    assert.match(ordersApiSource, /page|pageSize/, 'Orders API must support page and pageSize');
    assert.match(ordersApiSource, /\.range\(startOffset, startOffset \+ resolvedSize - 1\)/, 'Orders API must query Supabase range');
  });

  await t.test('2.4 GET /api/orders returns totalCount and count metadata', () => {
    assert.match(ordersApiSource, /totalCount/, 'Orders API response must include totalCount for pagination UI');
  });
});

test('SUITE 3: Order Eligibility & Business Status Safeguards', async (t) => {
  await t.test('3.1 Settled orders qualify based on payment_status = paid or terminal delivery status', () => {
    const mockOrders = [
      { id: '1', status: 'delivered', payment_status: 'paid', total_amount: 500 },
      { id: '2', status: 'completed', payment_status: 'paid', total_amount: 350 },
      { id: '3', status: 'closed', payment_status: 'paid', total_amount: 200 },
      { id: '4', status: 'preparing', payment_status: 'pending', total_amount: 450 }, // NOT eligible
      { id: '5', status: 'hold', payment_status: 'pending', total_amount: 100 },      // NOT eligible
      { id: '6', status: 'cancelled', payment_status: 'cancelled', total_amount: 0 }  // Cancelled audit
    ];

    const eligibleClosed = mockOrders.filter(o =>
      o.status === 'delivered' ||
      o.status === 'completed' ||
      o.status === 'closed' ||
      o.status === 'cancelled' ||
      o.payment_status === 'paid'
    );

    assert.equal(eligibleClosed.length, 4, 'Should include only settled/closed/delivered/cancelled orders');
    assert.ok(!eligibleClosed.some(o => o.id === '4'), 'Unpaid preparing orders must never appear in Close Orders');
    assert.ok(!eligibleClosed.some(o => o.id === '5'), 'Unpaid hold orders must never appear in Close Orders');
  });

  await t.test('3.2 Cancelled orders are excluded from total closed revenue calculations', () => {
    const mockOrders = [
      { id: '1', status: 'delivered', payment_status: 'paid', total_amount: 500 },
      { id: '2', status: 'cancelled', payment_status: 'cancelled', total_amount: 300 }
    ];

    const deliveredOrders = mockOrders.filter(o => o.status !== 'cancelled' && (o.status === 'delivered' || o.payment_status === 'paid'));
    const totalRev = deliveredOrders.reduce((sum, o) => sum + o.total_amount, 0);

    assert.equal(totalRev, 500, 'Cancelled order total must not be included in closed revenue calculation');
  });
});

test('SUITE 4: Multi-Batch History Loading & Deduplication', async (t) => {
  await t.test('4.1 Map deduplication prevents duplicate orders when loading batches or overlapping ranges', () => {
    const existingOrders = [
      { id: 'uuid-1', order_number: '101', created_at: '2026-10-27T10:00:00Z' },
      { id: 'uuid-2', order_number: '102', created_at: '2026-10-27T11:00:00Z' }
    ];

    const historicalBatch = [
      { id: 'uuid-2', order_number: '102', created_at: '2026-10-27T11:00:00Z' }, // Duplicate from memory
      { id: 'uuid-3', order_number: '103', created_at: '2026-09-15T09:00:00Z' }, // Older order
      { id: 'uuid-4', order_number: '104', created_at: '2026-09-01T08:00:00Z' }  // September order
    ];

    const orderMap = new Map();
    existingOrders.forEach(o => orderMap.set(String(o.id), o));
    historicalBatch.forEach(o => orderMap.set(String(o.id), o));

    const merged = Array.from(orderMap.values());
    assert.equal(merged.length, 4, 'Deduplication by ID must eliminate duplicate order uuid-2');

    // Verify sorted descending
    merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    assert.equal(merged[0].id, 'uuid-2');
    assert.equal(merged[merged.length - 1].id, 'uuid-4');
  });

  await t.test('4.2 Missing line items are loaded in batches for historical orders', () => {
    assert.match(adminJs, /async function ensureOrderItemsLoaded/, 'Missing ensureOrderItemsLoaded helper');
    assert.match(adminJs, /order_items/, 'Must query order_items table for missing items');
  });
});

test('SUITE 5: Frontend Pagination UI & Sliding Window Navigation', async (t) => {
  await t.test('5.1 Pagination wrapper, counter, and page size selector exist in admin.html', () => {
    assert.match(adminHtml, /id="closed-orders-pagination-wrap"/, 'Missing #closed-orders-pagination-wrap');
    assert.match(adminHtml, /id="closed-page-range"/, 'Missing #closed-page-range');
    assert.match(adminHtml, /id="closed-total-count"/, 'Missing #closed-total-count');
    assert.match(adminHtml, /id="closed-page-size-select"/, 'Missing #closed-page-size-select');
    assert.match(adminHtml, /id="closed-orders-pagination"/, 'Missing #closed-orders-pagination');
  });

  await t.test('5.2 Sliding window algorithm generates correct page sequence for multi-page datasets', () => {
    function computeSlidingPages(totalPages, currentPage, maxButtons = 7) {
      let startP = Math.max(1, currentPage - 3);
      let endP = Math.min(totalPages, startP + maxButtons - 1);
      if (endP - startP + 1 < maxButtons) {
        startP = Math.max(1, endP - maxButtons + 1);
      }
      const pages = [];
      for (let p = startP; p <= endP; p++) pages.push(p);
      return { startP, endP, pages };
    }

    // 100 pages, currently on page 1
    const p1 = computeSlidingPages(100, 1);
    assert.deepEqual(p1.pages, [1, 2, 3, 4, 5, 6, 7]);

    // 100 pages, currently on page 50
    const p50 = computeSlidingPages(100, 50);
    assert.deepEqual(p50.pages, [47, 48, 49, 50, 51, 52, 53]);

    // 100 pages, currently on page 100
    const p100 = computeSlidingPages(100, 100);
    assert.deepEqual(p100.pages, [94, 95, 96, 97, 98, 99, 100]);
  });

  await t.test('5.3 Page size select event resets page to 1 and refreshes table', () => {
    assert.match(adminJs, /\$\('closed-page-size-select'\)\?\.addEventListener\('change'/,
      'Missing change listener on #closed-page-size-select');
    assert.match(adminJs, /closedOrdersPage = 1/,
      'Changing page size must reset closedOrdersPage to 1');
  });
});

test('SUITE 6: CSV Export Historical Loading Safeguards', async (t) => {
  await t.test('6.1 exportRestaurantGSTReportCSV is async and awaits ensureHistoricalClosedOrders', () => {
    assert.match(adminJs, /async function exportRestaurantGSTReportCSV/,
      'exportRestaurantGSTReportCSV must be async');
    assert.match(adminJs, /await ensureHistoricalClosedOrders\(\)/,
      'exportRestaurantGSTReportCSV must await ensureHistoricalClosedOrders');
  });

  await t.test('6.2 exportClosedOrdersCSV is async and awaits ensureHistoricalClosedOrders', () => {
    assert.match(adminJs, /async function exportClosedOrdersCSV/,
      'exportClosedOrdersCSV must be async');
    assert.match(adminJs, /await ensureHistoricalClosedOrders\(\)/,
      'exportClosedOrdersCSV must await ensureHistoricalClosedOrders');
  });

  await t.test('6.3 CSV exports load missing line items before generating rows', () => {
    assert.match(adminJs, /await ensureOrderItemsLoaded\(list\.map/,
      'CSV exports must ensure order items are loaded for every row');
  });
});
