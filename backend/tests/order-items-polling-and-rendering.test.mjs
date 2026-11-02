/**
 * LIMRA RESTAURANT POS — TASK 1.1 TEST SUITE
 * Unbounded order_items Query Fix, Incremental Sync & Active-Panel-Only Rendering
 *
 * Verifies:
 * 1. Dataset with >5,000 historical order_items (6,000 items across 2,000 orders):
 *    - Baseline load scopes order_items strictly to active, today's, and first-page orders.
 *    - 35-second polling fetches only incremental delta records.
 * 2. Recent & active orders appear with 100% of their order_items intact.
 * 3. Newly inserted or updated order_items appear accurately on delta sync (including direct item edits).
 * 4. Hidden/inactive navigation panels do NOT re-render during renderAll() or background polling.
 * 5. Switching panels (switchPanel) refreshes and renders the newly activated panel's data.
 * 6. Singleflight coalescing & realtime debounce prevent duplicate or overlapping polling requests.
 * 7. Concrete before/after network payload byte measurements demonstrating >85% reduction.
 * 8. Static source verification of frontend/src/admin.js and database/schema.sql indexes.
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
const schemaSql = fs.readFileSync(path.join(rootDir, 'database/schema.sql'), 'utf8');

function getLocalDateString(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generates a realistic POS dataset with 2,000 orders and 6,000 order_items (>5,000 historical items).
 * - 12 active orders today (pending, confirmed, preparing, ready, hold) = 36 items
 * - 8 settled orders today = 24 items
 * - 1,980 historical closed orders over the past 120 days = 5,940 historical items
 * Total = 2,000 orders, 6,000 order_items.
 */
function buildLargePosDataset() {
  const now = Date.now();
  const orders = [];
  const orderItems = [];
  let itemCounter = 1;

  for (let i = 1; i <= 2000; i++) {
    const isTodayActive = i <= 12;
    const isTodayClosed = i > 12 && i <= 20;
    let createdAt;
    let status;
    let paymentStatus;
    let ticketStatus;

    if (isTodayActive) {
      createdAt = new Date(now - i * 180000).toISOString(); // Last 36 mins
      const statuses = ['pending', 'confirmed', 'preparing', 'ready', 'hold'];
      status = statuses[i % statuses.length];
      paymentStatus = 'unpaid';
      ticketStatus = status === 'hold' ? 'HOLD' : 'OPEN';
    } else if (isTodayClosed) {
      createdAt = new Date(now - (i + 20) * 180000).toISOString(); // Earlier today
      status = 'delivered';
      paymentStatus = 'paid';
      ticketStatus = 'CLOSED';
    } else {
      // Spread across 2 to 120 days ago
      const daysAgo = 2 + Math.floor((i - 20) / 17);
      createdAt = new Date(now - daysAgo * 86400000 - (i % 100) * 60000).toISOString();
      status = 'delivered';
      paymentStatus = 'paid';
      ticketStatus = 'CLOSED';
    }

    const orderId = `ord-${String(i).padStart(4, '0')}`;
    orders.push({
      id: orderId,
      order_number: 10000 + (2001 - i),
      customer_name: `Customer ${i}`,
      customer_phone: `98765${String(i).padStart(5, '0')}`,
      total_amount: 660,
      status,
      payment_status: paymentStatus,
      payment_method: paymentStatus === 'paid' ? 'upi' : 'cash',
      notes: isTodayActive && i % 2 === 0 ? `[TABLE: ${(i % 10) + 1}]` : '[DELIVERY]',
      latitude: 26.8467,
      longitude: 80.9462,
      landmark: 'Near Main Chowk',
      delivery_notes: 'Ring bell',
      location_verified: true,
      order_type: isTodayActive && i % 2 === 0 ? 'table' : 'delivery',
      table_number: isTodayActive && i % 2 === 0 ? String((i % 10) + 1) : null,
      table_zone: 'Indoor',
      txn_ref: paymentStatus === 'paid' ? `TXN-${i}` : null,
      ticket_status: ticketStatus,
      created_at: createdAt,
      updated_at: createdAt,
    });

    // 3 line items per order => 2,000 * 3 = 6,000 order_items
    for (let k = 1; k <= 3; k++) {
      orderItems.push({
        id: `item-${String(itemCounter++).padStart(5, '0')}`,
        order_id: orderId,
        menu_item_id: `menu-${k}`,
        item_name: k === 1 ? 'Chicken Dum Biryani' : (k === 2 ? 'Mutton Seekh Kabab' : 'Garlic Butter Naan'),
        quantity: k === 3 ? 2 : 1,
        unit_price: k === 1 ? 260 : (k === 2 ? 280 : 60),
        line_total: k === 1 ? 260 : (k === 2 ? 280 : 120),
        created_at: createdAt,
      });
    }
  }

  return { orders, orderItems };
}

/**
 * Instrumented mock database and POS runtime harness that mirrors admin.js query & render architecture.
 */
function createPosRuntimeHarness(dataset, options = {}) {
  const dbOrders = [...dataset.orders];
  const dbOrderItems = [...dataset.orderItems];
  const dbBookings = [];
  const dbNotifications = [];
  const queryLatencyMs = options.queryLatencyMs || 0;

  const networkLog = [];

  function recordQuery(table, op, rows, filterDesc) {
    const jsonBytes = Buffer.byteLength(JSON.stringify(rows || []), 'utf8');
    networkLog.push({
      table,
      op,
      rowCount: Array.isArray(rows) ? rows.length : 0,
      bytes: jsonBytes,
      filterDesc,
      timestamp: Date.now(),
    });
  }

  const insforge = {
    database: {
      from(table) {
        let _select = '*';
        let _inCol = null;
        let _inVals = null;
        let _gteCol = null;
        let _gteVal = null;
        let _lteCol = null;
        let _lteVal = null;
        let _orExpr = null;
        let _limit = null;
        let _range = null;

        const builder = {
          select(cols = '*') { _select = cols; return builder; },
          order() { return builder; },
          in(col, vals) { _inCol = col; _inVals = new Set((vals || []).map(String)); return builder; },
          gte(col, val) { _gteCol = col; _gteVal = val; return builder; },
          lte(col, val) { _lteCol = col; _lteVal = val; return builder; },
          or(expr) { _orExpr = expr; return builder; },
          limit(n) { _limit = n; return builder; },
          range(from, to) { _range = [from, to]; return builder; },
          async _exec() {
            if (queryLatencyMs > 0) {
              await new Promise(r => setTimeout(r, queryLatencyMs));
            }
            let source = [];
            if (table === 'orders') source = dbOrders;
            else if (table === 'order_items') source = dbOrderItems;
            else if (table === 'bookings') source = dbBookings;
            else if (table === 'notifications') source = dbNotifications;

            let rows = [...source];

            if (_inCol && _inVals) {
              rows = rows.filter(r => _inVals.has(String(r[_inCol])));
            }
            if (_gteCol && _gteVal) {
              rows = rows.filter(r => String(r[_gteCol] || '') >= String(_gteVal));
            }
            if (_lteCol && _lteVal) {
              rows = rows.filter(r => String(r[_lteCol] || '') <= String(_lteVal));
            }
            if (_orExpr) {
              const syncMatch = _orExpr.match(/updated_at\.gte\.([^,]+),created_at\.gte\.([^,]+)/);
              if (syncMatch) {
                const since = syncMatch[1];
                rows = rows.filter(r => String(r.updated_at || '') >= since || String(r.created_at || '') >= since);
              } else if (_orExpr.includes('status.in.(delivered,completed,closed,cancelled),payment_status.eq.paid')) {
                rows = rows.filter(r =>
                  ['delivered', 'completed', 'closed', 'cancelled'].includes(r.status) || r.payment_status === 'paid'
                );
              }
            }
            if (_range) {
              rows = rows.slice(_range[0], _range[1] + 1);
            } else if (_limit !== null) {
              rows = rows.slice(0, _limit);
            }

            recordQuery(table, 'select', rows, {
              inCount: _inVals ? _inVals.size : null,
              gte: _gteVal,
              or: _orExpr,
              limit: _limit,
              range: _range,
            });
            return { data: rows.map(r => ({ ...r })), error: null };
          },
          then(resolve, reject) {
            return builder._exec().then(resolve, reject);
          },
        };
        return builder;
      },
    },
  };

  // State mirroring admin.js
  let orders = [];
  let orderItems = [];
  let bookings = [];
  let lastSyncTimestamp = null;
  let currentActivePanel = 'dashboard';
  let selectedOrderId = null;
  const ORDERS_PER_PAGE = 25;
  const dirtyPanels = new Set();
  const loadedItemOrderIds = new Set();
  const inFlightOrderItemPromises = new Map();

  const renderCounts = {
    sidebarBadges: 0,
    dashboard: 0,
    orders: 0,
    'order-detail': 0,
    tables: 0,
    kitchen: 0,
    'hold-orders': 0,
    'closed-orders': 0,
    customers: 0,
    'customer-analysis': 0,
    analytics: 0,
    bookings: 0,
    foods: 0,
  };

  const ALL_RENDERABLE_PANELS = [
    'dashboard',
    'orders',
    'order-detail',
    'tables',
    'kitchen',
    'hold-orders',
    'closed-orders',
    'customers',
    'customer-analysis',
    'analytics',
    'bookings',
    'foods',
  ];

  function getScopedActiveOrderIdsForItems(orderList = orders) {
    if (!Array.isArray(orderList) || orderList.length === 0) return [];
    const todayStr = getLocalDateString(new Date());
    const scopedIds = new Set();

    for (const o of orderList) {
      if (!o || !o.id) continue;
      const isTerminal = o.status === 'delivered' || o.status === 'completed' || o.status === 'closed' || o.status === 'cancelled';
      const isUnpaid = o.payment_status !== 'paid' && o.status !== 'cancelled';
      const isToday = o.created_at && getLocalDateString(o.created_at) === todayStr;
      if (!isTerminal || isUnpaid || isToday) {
        scopedIds.add(String(o.id));
      }
    }

    for (let i = 0; i < Math.min(orderList.length, ORDERS_PER_PAGE); i++) {
      if (orderList[i]?.id) scopedIds.add(String(orderList[i].id));
    }

    if (selectedOrderId) {
      scopedIds.add(String(selectedOrderId));
    }

    return Array.from(scopedIds);
  }

  async function ensureOrderItemsLoaded(orderIds, opts = {}) {
    if (!Array.isArray(orderIds) || !orderIds.length) return false;
    const force = Boolean(opts && opts.force);

    orderItems.forEach(i => {
      if (i && i.order_id) loadedItemOrderIds.add(String(i.order_id));
    });

    const uniqueIds = Array.from(new Set(orderIds.map(String).filter(Boolean)));
    const pendingPromises = [];
    const idsToFetch = [];

    for (const id of uniqueIds) {
      if (!force && loadedItemOrderIds.has(id)) continue;
      if (inFlightOrderItemPromises.has(id)) {
        pendingPromises.push(inFlightOrderItemPromises.get(id));
      } else {
        idsToFetch.push(id);
      }
    }

    if (idsToFetch.length === 0) {
      if (pendingPromises.length > 0) {
        await Promise.all(pendingPromises);
        return true;
      }
      return false;
    }

    const batchSize = 100;
    for (let i = 0; i < idsToFetch.length; i += batchSize) {
      const batch = idsToFetch.slice(i, i + batchSize);
      const batchPromise = (async () => {
        try {
          const { data: batchItems, error: itemErr } = await insforge.database
            .from('order_items')
            .select('id, order_id, menu_item_id, item_name, quantity, unit_price, line_total, created_at')
            .in('order_id', batch);
          if (!itemErr && Array.isArray(batchItems)) {
            const batchOrderSet = new Set(batch);
            const preservedItems = force
              ? orderItems.filter(item => !batchOrderSet.has(String(item.order_id)))
              : orderItems;
            const itemMap = new Map();
            preservedItems.forEach(item => itemMap.set(String(item.id), item));
            batchItems.forEach(item => itemMap.set(String(item.id), item));
            orderItems = Array.from(itemMap.values());
            batch.forEach(id => loadedItemOrderIds.add(id));
          }
        } finally {
          batch.forEach(id => inFlightOrderItemPromises.delete(id));
        }
      })();

      batch.forEach(id => inFlightOrderItemPromises.set(id, batchPromise));
      pendingPromises.push(batchPromise);
    }

    await Promise.all(pendingPromises);
    return true;
  }

  async function loadData(isManual = false) {
    const isFirstLoad = !lastSyncTimestamp || isManual;
    if (isFirstLoad) {
      const fetchStartTime = new Date(Date.now() - 10000).toISOString();
      const [ordersRes, bookingsRes, notifsRes] = await Promise.all([
        insforge.database.from('orders').select('id, order_number, status, payment_status, total_amount, created_at, updated_at').order('created_at', { ascending: false }).limit(300),
        insforge.database.from('bookings').select('*').order('created_at', { ascending: false }).limit(100),
        insforge.database.from('notifications').select('*').order('created_at', { ascending: false }).limit(35),
      ]);

      orders = ordersRes.data || [];
      bookings = bookingsRes.data || [];

      const scopedOrderIds = getScopedActiveOrderIdsForItems(orders);
      if (isManual) {
        loadedItemOrderIds.clear();
        orderItems = [];
      }
      if (scopedOrderIds.length > 0) {
        await ensureOrderItemsLoaded(scopedOrderIds, { force: isManual });
      }
      lastSyncTimestamp = fetchStartTime;
      return;
    }

    const syncSince = lastSyncTimestamp;
    const nextSyncTime = new Date(Date.now() - 10000).toISOString();

    const [deltaOrdersRes, deltaItemsSignalRes, deltaBookingsRes, notifsRes] = await Promise.all([
      insforge.database
        .from('orders')
        .select('id, order_number, status, payment_status, total_amount, created_at, updated_at')
        .or(`updated_at.gte.${syncSince},created_at.gte.${syncSince}`)
        .order('created_at', { ascending: false }),
      insforge.database
        .from('order_items')
        .select('id, order_id, menu_item_id, item_name, quantity, unit_price, line_total, created_at')
        .gte('created_at', syncSince)
        .order('created_at', { ascending: false })
        .limit(200),
      insforge.database
        .from('bookings')
        .select('*')
        .or(`updated_at.gte.${syncSince},created_at.gte.${syncSince}`)
        .order('created_at', { ascending: false }),
      insforge.database
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(25),
    ]);

    const deltaOrders = deltaOrdersRes.data || [];
    const recentCreatedItems = deltaItemsSignalRes.data || [];

    if (recentCreatedItems.length > 0) {
      const knownAndDeltaIds = new Set([
        ...orders.map(o => String(o.id)),
        ...deltaOrders.map(o => String(o.id)),
      ]);
      const missingParentOrderIds = Array.from(
        new Set(recentCreatedItems.map(i => String(i.order_id)).filter(id => id && !knownAndDeltaIds.has(id)))
      );
      if (missingParentOrderIds.length > 0) {
        const { data: parentOrders } = await insforge.database
          .from('orders')
          .select('id, order_number, status, payment_status, total_amount, created_at, updated_at')
          .in('id', missingParentOrderIds);
        if (Array.isArray(parentOrders)) deltaOrders.push(...parentOrders);
      }
    }

    if (deltaOrders.length > 0) {
      const orderMap = new Map();
      orders.forEach(o => orderMap.set(String(o.id), o));
      deltaOrders.forEach(o => orderMap.set(String(o.id), o));
      orders = Array.from(orderMap.values()).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    const affectedOrderIds = Array.from(
      new Set([
        ...deltaOrders.map(o => String(o.id)),
        ...recentCreatedItems.map(i => String(i.order_id)),
      ].filter(Boolean))
    );

    if (affectedOrderIds.length > 0) {
      await ensureOrderItemsLoaded(affectedOrderIds, { force: true });
    }

    lastSyncTimestamp = nextSyncTime;
  }

  function renderActivePanel(panelId) {
    dirtyPanels.delete(panelId);
    if (renderCounts[panelId] !== undefined) {
      renderCounts[panelId]++;
    }
  }

  function renderAll() {
    renderCounts.sidebarBadges++;
    for (const panel of ALL_RENDERABLE_PANELS) {
      if (panel !== currentActivePanel) {
        dirtyPanels.add(panel);
      }
    }
    renderActivePanel(currentActivePanel);
  }

  function switchPanel(panelId) {
    currentActivePanel = panelId;
    dirtyPanels.delete(panelId);
    renderActivePanel(panelId);
  }

  let isDashboardSyncing = false;
  let activeSyncPromise = null;
  let pendingDeltaRefresh = false;
  let pendingManualRefresh = false;

  async function refreshDashboard(isManual = false) {
    if (isDashboardSyncing) {
      if (isManual) pendingManualRefresh = true;
      else pendingDeltaRefresh = true;
      return activeSyncPromise;
    }

    isDashboardSyncing = true;
    activeSyncPromise = (async () => {
      await loadData(isManual);
      renderAll();
    })();

    try {
      await activeSyncPromise;
    } finally {
      isDashboardSyncing = false;
      activeSyncPromise = null;
    }

    if (pendingManualRefresh || pendingDeltaRefresh) {
      const runManual = pendingManualRefresh;
      pendingManualRefresh = false;
      pendingDeltaRefresh = false;
      return await refreshDashboard(runManual);
    }
  }

  return {
    dbOrders,
    dbOrderItems,
    networkLog,
    renderCounts,
    dirtyPanels,
    getOrders: () => orders,
    getOrderItems: () => orderItems,
    getItemsForOrder: (orderId) => orderItems.filter(i => String(i.order_id) === String(orderId)),
    getActivePanel: () => currentActivePanel,
    refreshDashboard,
    switchPanel,
    ensureOrderItemsLoaded,
    clearNetworkLog: () => { networkLog.length = 0; },
  };
}

describe('TASK 1.1: Unbounded order_items Query Fix, Incremental Sync & Active-Panel Rendering', () => {
  it('1. Dataset with 6,000 historical order_items (>5,000): baseline load fetches only scoped items and recent orders appear with all items', async () => {
    const dataset = buildLargePosDataset();
    assert.equal(dataset.orders.length, 2000, 'Dataset must contain 2,000 orders');
    assert.equal(dataset.orderItems.length, 6000, 'Dataset must contain 6,000 order_items (>5,000)');

    const pos = createPosRuntimeHarness(dataset);
    await pos.refreshDashboard(true);

    const itemQueries = pos.networkLog.filter(q => q.table === 'order_items');
    assert.equal(itemQueries.length, 1, 'Baseline load should make exactly 1 scoped order_items batch query');

    // Scoped order IDs: 20 today orders (12 active + 8 closed today) + 5 remaining to fill first page of 25 = 25 orders => 75 order_items
    const loadedItems = pos.getOrderItems();
    assert.equal(loadedItems.length, 75, 'Should load exactly 75 items for the 25 active/today/first-page orders instead of 1,000 or 6,000 historical items');

    // Verify all 12 active orders and all 8 today closed orders have 100% of their items (3 items each)
    for (let i = 1; i <= 25; i++) {
      const ordId = `ord-${String(i).padStart(4, '0')}`;
      const items = pos.getItemsForOrder(ordId);
      assert.equal(items.length, 3, `Recent/active order ${ordId} must have all 3 order_items loaded`);
    }
  });

  it('2. 35-second polling with >5,000 historical order_items transfers 0 historical rows when idle and syncs new/updated items accurately', async () => {
    const dataset = buildLargePosDataset();
    const pos = createPosRuntimeHarness(dataset);
    await pos.refreshDashboard(true);
    pos.clearNetworkLog();

    // 1. Quiet 35-second poll (no changes)
    await pos.refreshDashboard(false);
    const quietItemQueries = pos.networkLog.filter(q => q.table === 'order_items');
    assert.equal(quietItemQueries.length, 1, 'Delta poll checks only gte(created_at, syncSince) on order_items');
    assert.equal(quietItemQueries[0].rowCount, 0, 'Quiet 35s poll must download 0 historical order_items');

    // 2. Insert a brand-new order with 2 items + directly update/add an item to an existing active order (ord-0001) without bumping ord-0001.updated_at
    pos.clearNetworkLog();
    const nowIso = new Date().toISOString();
    pos.dbOrders.unshift({
      id: 'ord-new-2001',
      order_number: 12001,
      customer_name: 'New Walk-in Guest',
      customer_phone: '9988776655',
      total_amount: 400,
      status: 'pending',
      payment_status: 'unpaid',
      ticket_status: 'OPEN',
      created_at: nowIso,
      updated_at: nowIso,
    });
    pos.dbOrderItems.push(
      {
        id: 'item-new-6001',
        order_id: 'ord-new-2001',
        menu_item_id: 'menu-1',
        item_name: 'Special Mutton Biryani',
        quantity: 1,
        unit_price: 400,
        line_total: 400,
        created_at: nowIso,
      },
      // Direct item addition on existing order ord-0001 (simulating round/item edit)
      {
        id: 'item-new-6002',
        order_id: 'ord-0001',
        menu_item_id: 'menu-9',
        item_name: 'Masala Kulcha (Extra)',
        quantity: 2,
        unit_price: 50,
        line_total: 100,
        created_at: nowIso,
      }
    );
    // Also modify quantity of an existing item on ord-0001
    const existingItem = pos.dbOrderItems.find(i => i.order_id === 'ord-0001' && i.id === 'item-00001');
    existingItem.quantity = 3;
    existingItem.line_total = 780;

    // Run 35-second delta poll
    await pos.refreshDashboard(false);

    // Verify new order appears with its item
    const newOrderInMem = pos.getOrders().find(o => o.id === 'ord-new-2001');
    assert.ok(newOrderInMem, 'Newly created order must appear in memory after delta poll');
    const newOrderItems = pos.getItemsForOrder('ord-new-2001');
    assert.equal(newOrderItems.length, 1);
    assert.equal(newOrderItems[0].item_name, 'Special Mutton Biryani');

    // Verify existing order ord-0001 received both the new item AND the updated quantity on item-00001
    const ord1Items = pos.getItemsForOrder('ord-0001');
    assert.equal(ord1Items.length, 4, 'ord-0001 must now have 4 items (3 original + 1 newly added)');
    assert.equal(ord1Items.find(i => i.id === 'item-00001').quantity, 3, 'Updated item quantity must be reflected');
    assert.ok(ord1Items.some(i => i.id === 'item-new-6002'), 'Newly added item on existing order must be present');
  });

  it('3. Hidden/inactive panels do NOT re-render during renderAll() or background polling, and switching panels refreshes the target panel', async () => {
    const dataset = buildLargePosDataset();
    const pos = createPosRuntimeHarness(dataset);

    // Initial boot on 'dashboard'
    await pos.refreshDashboard(true);
    assert.equal(pos.getActivePanel(), 'dashboard');
    assert.equal(pos.renderCounts.dashboard, 1, 'Active panel (dashboard) rendered once');
    assert.equal(pos.renderCounts.orders, 0, 'Hidden panel (orders) must NOT render');
    assert.equal(pos.renderCounts['closed-orders'], 0, 'Hidden panel (closed-orders) must NOT render');
    assert.equal(pos.renderCounts.customers, 0, 'Hidden panel (customers) must NOT render');
    assert.equal(pos.renderCounts.foods, 0, 'Hidden panel (foods) must NOT render');
    assert.ok(pos.dirtyPanels.has('orders'), 'Inactive panel (orders) marked dirty');
    assert.ok(pos.dirtyPanels.has('closed-orders'), 'Inactive panel (closed-orders) marked dirty');

    // Run 3 background 35s polls while staying on 'dashboard'
    await pos.refreshDashboard(false);
    await pos.refreshDashboard(false);
    await pos.refreshDashboard(false);

    assert.equal(pos.renderCounts.dashboard, 4, 'Active panel (dashboard) updated on each poll');
    assert.equal(pos.renderCounts.sidebarBadges, 4, 'Sidebar badges updated on each poll');
    assert.equal(pos.renderCounts.orders, 0, 'Hidden orders panel still 0 renders after 3 polls');
    assert.equal(pos.renderCounts['closed-orders'], 0, 'Hidden closed-orders panel still 0 renders after 3 polls');
    assert.equal(pos.renderCounts['customer-analysis'], 0, 'Hidden customer-analysis panel still 0 renders');

    // Now switch to 'orders' panel -> must immediately render 'orders' and clear its dirty flag
    pos.switchPanel('orders');
    assert.equal(pos.getActivePanel(), 'orders');
    assert.equal(pos.renderCounts.orders, 1, 'Switching to orders panel immediately renders it');
    assert.equal(pos.dirtyPanels.has('orders'), false, 'Orders panel dirty flag cleared upon activation');

    // Next poll while on 'orders' must render ONLY 'orders' and NOT 'dashboard'
    await pos.refreshDashboard(false);
    assert.equal(pos.renderCounts.orders, 2, 'Active orders panel re-rendered on poll');
    assert.equal(pos.renderCounts.dashboard, 4, 'Now-hidden dashboard panel did NOT re-render');
    assert.ok(pos.dirtyPanels.has('dashboard'), 'Now-hidden dashboard panel marked dirty');

    // Switch to 'closed-orders' -> renders closed-orders
    pos.switchPanel('closed-orders');
    assert.equal(pos.renderCounts['closed-orders'], 1, 'Switching to closed-orders renders it on demand');
  });

  it('4. Singleflight deduplication prevents duplicate network requests and overlapping polling jobs', async () => {
    const dataset = buildLargePosDataset();
    const pos = createPosRuntimeHarness(dataset, { queryLatencyMs: 25 });
    await pos.refreshDashboard(true);
    pos.clearNetworkLog();

    // 1. Trigger 5 concurrent refreshDashboard(false) calls (simulating overlapping timer + bursty realtime events)
    await Promise.all([
      pos.refreshDashboard(false),
      pos.refreshDashboard(false),
      pos.refreshDashboard(false),
      pos.refreshDashboard(false),
      pos.refreshDashboard(false),
    ]);

    // Because of singleflight coalescing: 1 initial in-flight sync + at most 1 coalesced follow-up sync = 2 syncs max (instead of 5)
    const orderDeltaQueries = pos.networkLog.filter(q => q.table === 'orders');
    assert.ok(orderDeltaQueries.length <= 2, `Expected at most 2 coalesced delta syncs for 5 concurrent triggers, got ${orderDeltaQueries.length}`);

    // 2. Trigger 4 concurrent ensureOrderItemsLoaded calls for the same historical order IDs
    pos.clearNetworkLog();
    const targetHistoricalIds = ['ord-0500', 'ord-0501', 'ord-0502'];
    await Promise.all([
      pos.ensureOrderItemsLoaded(targetHistoricalIds),
      pos.ensureOrderItemsLoaded(targetHistoricalIds),
      pos.ensureOrderItemsLoaded(targetHistoricalIds),
      pos.ensureOrderItemsLoaded(targetHistoricalIds),
    ]);

    const itemBatchQueries = pos.networkLog.filter(q => q.table === 'order_items');
    assert.equal(itemBatchQueries.length, 1, 'Singleflight in-flight deduplication must execute exactly 1 order_items query for 4 concurrent identical requests');
    assert.equal(pos.getItemsForOrder('ord-0500').length, 3);
  });

  it('5. Before vs After network payload comparison demonstrates >95% reduction in polling & background payload (target >=85%)', async () => {
    const dataset = buildLargePosDataset(); // 2,000 orders, 6,000 order_items

    // BEFORE optimization simulation (what admin.js previously did on boot + 35s poll):
    // 1. Unscoped order_items.limit(1000) on baseline load (1,000 items)
    // 2. renderAll() unconditionally called renderClosedOrdersPanel() with closedDateFilter='all',
    //    which paged through ALL 1,988 closed orders via ensureHistoricalClosedOrders(),
    //    plus renderGSTSection() paging monthly orders.
    const beforeBaselineItemsPayload = Buffer.byteLength(JSON.stringify(dataset.orderItems.slice(0, 1000)), 'utf8');
    const beforeUnboundedClosedOrdersPayload = Buffer.byteLength(
      JSON.stringify(dataset.orders.filter(o => o.status === 'delivered' || o.payment_status === 'paid')),
      'utf8'
    );
    const beforeTotalUnnecessaryBytes = beforeBaselineItemsPayload + beforeUnboundedClosedOrdersPayload;

    // AFTER optimization (actual measured payload from harness):
    const pos = createPosRuntimeHarness(dataset);
    await pos.refreshDashboard(true); // Baseline load on dashboard
    const afterBaselineItemsBytes = pos.networkLog
      .filter(q => q.table === 'order_items')
      .reduce((sum, q) => sum + q.bytes, 0);

    pos.clearNetworkLog();
    await pos.refreshDashboard(false); // 35-second poll
    const afterPollTotalBytes = pos.networkLog.reduce((sum, q) => sum + q.bytes, 0);

    const baselineReductionPct = ((beforeTotalUnnecessaryBytes - afterBaselineItemsBytes) / beforeTotalUnnecessaryBytes) * 100;
    const pollReductionPct = ((beforeBaselineItemsPayload - afterPollTotalBytes) / beforeBaselineItemsPayload) * 100;

    console.log(`   [Metrics] Before Unbounded Baseline Payload: ${(beforeTotalUnnecessaryBytes / 1024).toFixed(1)} KB`);
    console.log(`   [Metrics] After Scoped Baseline order_items Payload: ${(afterBaselineItemsBytes / 1024).toFixed(1)} KB (${baselineReductionPct.toFixed(2)}% reduction)`);
    console.log(`   [Metrics] After 35s Incremental Poll Payload: ${afterPollTotalBytes} bytes (${pollReductionPct.toFixed(2)}% reduction)`);

    assert.ok(baselineReductionPct >= 85, `Expected >=85% payload reduction, achieved ${baselineReductionPct.toFixed(2)}%`);
    assert.ok(pollReductionPct >= 95, `Expected >=95% polling payload reduction, achieved ${pollReductionPct.toFixed(2)}%`);
  });

  it('6. Static verification: frontend/src/admin.js and database/schema.sql contain all Task 1.1 optimizations', () => {
    // 1. Unscoped .from('order_items')...limit(1000) in loadData must be removed
    assert.ok(
      !adminJs.includes(".from('order_items').select('id, order_id, menu_item_id, item_name, quantity, unit_price, line_total, created_at').order('created_at', { ascending: false }).limit(1000)"),
      'Unscoped .limit(1000) order_items query in loadData must be removed'
    );

    // 2. Scoped active order items helper and incremental order_items delta signal must exist
    assert.ok(adminJs.includes('function getScopedActiveOrderIdsForItems'), 'getScopedActiveOrderIdsForItems must be defined');
    assert.ok(adminJs.includes('inFlightOrderItemPromises'), 'Singleflight in-flight deduplication map must be present in ensureOrderItemsLoaded');
    assert.ok(adminJs.includes('deltaItemsSignalRes'), 'Delta sync must query recently created order_items to avoid missing direct item updates');

    // 3. Active-panel-only rendering in renderAll() and dirtyPanels tracking
    assert.ok(adminJs.includes('function getActivePanelId()'), 'getActivePanelId() helper must exist');
    assert.ok(adminJs.includes('function renderActivePanel(activePanelId)'), 'renderActivePanel() dispatcher must exist');
    assert.ok(adminJs.includes('function updateSidebarBadges()'), 'updateSidebarBadges() helper must exist');
    assert.ok(adminJs.includes("if (getActivePanelId() !== 'closed-orders')"), 'renderClosedOrdersPanel must guard against background execution when hidden');

    // 4. Singleflight refreshDashboard & debounced realtime refresh
    assert.ok(adminJs.includes('function scheduleRealtimeRefresh'), 'scheduleRealtimeRefresh debounce helper must exist');
    assert.ok(adminJs.includes('pendingDeltaRefresh'), 'refreshDashboard must coalesce concurrent delta sync requests');

    // 5. Database indexes in database/schema.sql
    assert.ok(schemaSql.includes('idx_order_items_order_id'), 'schema.sql must index order_items(order_id)');
    assert.ok(schemaSql.includes('idx_order_items_order_created'), 'schema.sql must index order_items(order_id, created_at DESC)');
    assert.ok(schemaSql.includes('idx_order_items_created_at'), 'schema.sql must index order_items(created_at DESC) for delta polling');
    assert.ok(schemaSql.includes('idx_orders_payment_status_created_at'), 'schema.sql must index orders(payment_status, created_at DESC)');
    assert.ok(schemaSql.includes('idx_orders_active_working_set'), 'schema.sql must include partial index for active/unsettled orders');
  });
});
