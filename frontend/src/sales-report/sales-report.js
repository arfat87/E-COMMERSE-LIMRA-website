import { insforge } from '../lib/insforge.js';
import { menuItems, categoryLabels } from '../data/menu.js';

// ═══════════════════════════════════════════════════════════════════════════
// LIMRA RESTAURANT — HOME PAGE SALES & BILL REPORT HUB (DAILY / WEEKLY / MONTHLY)
// ═══════════════════════════════════════════════════════════════════════════

let reportState = {
  range: 'today', // 'today' | 'yesterday' | 'week' | 'month' | 'date' | 'custom'
  selectedDate: getISTDateString(), // YYYY-MM-DD
  startDate: getISTDateString(),
  endDate: getISTDateString(),
  channel: 'all', // 'all' | 'delivery' | 'pickup' | 'table'
  activeTab: 'items', // 'items' | 'orders' | 'bill'
  searchDish: '',
  sortOrder: 'qty_desc', // 'qty_desc' | 'revenue_desc' | 'name_asc'
  orders: [],
  items: [],
  dishSummary: [],
  metrics: {
    totalRevenue: 0,
    totalOrders: 0,
    avgOrderValue: 0,
    cashRevenue: 0,
    cashCount: 0,
    onlineRevenue: 0,
    onlineCount: 0,
    deliveryRevenue: 0,
    deliveryCount: 0,
    pickupRevenue: 0,
    pickupCount: 0,
    tableRevenue: 0,
    tableCount: 0,
    totalDishesQty: 0,
    distinctDishesCount: 0
  },
  loading: false,
  error: null
};

// ── IST Date Formatting Helper ──────────────────────────────────────────────
export function getISTDateString(d = new Date()) {
  const dateObj = typeof d === 'string' ? new Date(d) : d;
  // Convert UTC to IST (+5:30)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(dateObj.getTime() + istOffsetMs);
  return istDate.toISOString().slice(0, 10);
}

function formatCurrency(val) {
  const num = Number(val) || 0;
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00+05:30');
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatDateTimeDisplay(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

// ── Compute Date Range Boundaries ──────────────────────────────────────────
function computeDateRange(range, singleDate, startD, endD) {
  const now = new Date();
  const todayStr = getISTDateString(now);

  let startIso = '';
  let endIso = '';
  let label = '';

  if (range === 'today') {
    startIso = `${todayStr}T00:00:00+05:30`;
    endIso = `${todayStr}T23:59:59.999+05:30`;
    label = `Today (${formatDateDisplay(todayStr)})`;
  } else if (range === 'yesterday') {
    const yestDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yestStr = getISTDateString(yestDate);
    startIso = `${yestStr}T00:00:00+05:30`;
    endIso = `${yestStr}T23:59:59.999+05:30`;
    label = `Yesterday (${formatDateDisplay(yestStr)})`;
  } else if (range === 'date') {
    const dStr = singleDate || todayStr;
    startIso = `${dStr}T00:00:00+05:30`;
    endIso = `${dStr}T23:59:59.999+05:30`;
    label = `Date: ${formatDateDisplay(dStr)}`;
  } else if (range === 'week') {
    const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    const weekStartStr = getISTDateString(weekAgo);
    startIso = `${weekStartStr}T00:00:00+05:30`;
    endIso = `${todayStr}T23:59:59.999+05:30`;
    label = `This Week (${formatDateDisplay(weekStartStr)} — ${formatDateDisplay(todayStr)})`;
  } else if (range === 'month') {
    const curYear = now.getFullYear();
    const curMonth = String(now.getMonth() + 1).padStart(2, '0');
    const monthStartStr = `${curYear}-${curMonth}-01`;
    startIso = `${monthStartStr}T00:00:00+05:30`;
    endIso = `${todayStr}T23:59:59.999+05:30`;
    const monthName = now.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    label = `This Month: ${monthName}`;
  } else if (range === 'custom') {
    const s = startD || todayStr;
    const e = endD || todayStr;
    startIso = `${s}T00:00:00+05:30`;
    endIso = `${e}T23:59:59.999+05:30`;
    label = `${formatDateDisplay(s)} — ${formatDateDisplay(e)}`;
  }

  return { startIso, endIso, label };
}

// ── Fetch & Aggregate Sales Data ───────────────────────────────────────────
export async function loadSalesReportData() {
  reportState.loading = true;
  reportState.error = null;
  renderLoadingState();

  try {
    const { startIso, endIso, label } = computeDateRange(
      reportState.range,
      reportState.selectedDate,
      reportState.startDate,
      reportState.endDate
    );
    reportState.periodLabel = label;

    // 1. Fetch Orders from Supabase
    let query = insforge.database
      .from('orders')
      .select('id, order_number, customer_name, customer_phone, total_amount, status, payment_method, payment_status, order_type, table_number, created_at, notes')
      .neq('status', 'cancelled')
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false });

    const { data: rawOrders, error: ordErr } = await query;
    if (ordErr) throw ordErr;

    let orders = (rawOrders || []).filter(o => o.status !== 'cancelled' && o.status !== 'hold');

    // Filter by channel if set
    if (reportState.channel !== 'all') {
      orders = orders.filter(o => {
        const type = (o.order_type || '').toLowerCase();
        const hasTable = Boolean(o.table_number) || (o.notes && o.notes.includes('[TABLE:'));
        if (reportState.channel === 'table') return type === 'table' || hasTable;
        if (reportState.channel === 'delivery') return type === 'delivery';
        if (reportState.channel === 'pickup') return type === 'pickup' || type === 'takeaway';
        return true;
      });
    }

    reportState.orders = orders;

    // 2. Fetch Order Items in chunks
    let allItems = [];
    if (orders.length > 0) {
      const orderIds = orders.map(o => o.id);
      const CHUNK_SIZE = 150;
      const chunks = [];
      for (let i = 0; i < orderIds.length; i += CHUNK_SIZE) {
        chunks.push(orderIds.slice(i, i + CHUNK_SIZE));
      }

      const itemResponses = await Promise.all(
        chunks.map(chunk =>
          insforge.database
            .from('order_items')
            .select('id, order_id, menu_item_id, item_name, quantity, unit_price, line_total, created_at')
            .in('order_id', chunk)
        )
      );

      itemResponses.forEach(res => {
        if (res.data && Array.isArray(res.data)) {
          allItems.push(...res.data);
        }
      });
    }
    reportState.items = allItems;

    // 3. Compute KPI Metrics
    let totalRevenue = 0;
    let cashRevenue = 0;
    let cashCount = 0;
    let onlineRevenue = 0;
    let onlineCount = 0;
    let deliveryRevenue = 0;
    let deliveryCount = 0;
    let pickupRevenue = 0;
    let pickupCount = 0;
    let tableRevenue = 0;
    let tableCount = 0;

    orders.forEach(o => {
      const amt = Number(o.total_amount) || 0;
      totalRevenue += amt;

      const pMethod = (o.payment_method || '').toLowerCase();
      const pStatus = (o.payment_status || '').toLowerCase();
      const isOnline = pMethod === 'online' || pMethod === 'upi' || pMethod === 'razorpay' || pStatus === 'paid_online';

      if (isOnline) {
        onlineRevenue += amt;
        onlineCount++;
      } else {
        cashRevenue += amt;
        cashCount++;
      }

      const oType = (o.order_type || '').toLowerCase();
      const isTable = oType === 'table' || Boolean(o.table_number) || (o.notes && o.notes.includes('[TABLE:'));
      if (isTable) {
        tableRevenue += amt;
        tableCount++;
      } else if (oType === 'pickup' || oType === 'takeaway') {
        pickupRevenue += amt;
        pickupCount++;
      } else {
        deliveryRevenue += amt;
        deliveryCount++;
      }
    });

    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // 4. Aggregate Dish Sales Breakdown
    const dishMap = new Map();

    allItems.forEach(it => {
      const rawName = String(it.item_name || '').trim();
      if (!rawName) return;
      if (/^gst\b|^tax\b|^cgst\b|^sgst\b|^delivery\s*charge|^delivery\s*fee|^promo\s*discount/i.test(rawName)) return;

      const cleanKey = rawName.toLowerCase();
      const qty = Math.max(1, Number(it.quantity || 1));
      const unitPrice = Number(it.unit_price || (it.line_total ? Number(it.line_total) / qty : 0));
      const lineTot = Number(it.line_total !== undefined && it.line_total !== null ? it.line_total : unitPrice * qty);

      if (!dishMap.has(cleanKey)) {
        // Detect category & veg status from menu catalog
        let category = 'Dishes';
        let isVeg = false;
        const matched = menuItems.find(m => m.name.toLowerCase() === cleanKey || cleanKey.includes(m.name.toLowerCase()));
        if (matched) {
          category = categoryLabels[matched.category] || matched.category;
          isVeg = matched.veg === true || matched.type === 'veg';
        } else if (/veg|paneer|dal|mushroom|chana|naan|roti|paratha/i.test(cleanKey) && !/chicken|mutton|egg|fish|prawn/i.test(cleanKey)) {
          isVeg = true;
        }

        dishMap.set(cleanKey, {
          name: rawName,
          category,
          isVeg,
          unitPrice,
          qtySold: 0,
          totalRevenue: 0,
          ordersCount: 0,
          orderIds: new Set()
        });
      }

      const entry = dishMap.get(cleanKey);
      entry.qtySold += qty;
      entry.totalRevenue += lineTot;
      if (it.order_id) entry.orderIds.add(it.order_id);
      entry.ordersCount = entry.orderIds.size;
      if (unitPrice > 0 && entry.unitPrice <= 0) entry.unitPrice = unitPrice;
    });

    let totalDishesQty = 0;
    const dishSummary = Array.from(dishMap.values()).map(d => {
      totalDishesQty += d.qtySold;
      return d;
    });

    // Add % share of revenue
    const totalFoodRev = dishSummary.reduce((s, d) => s + d.totalRevenue, 0);
    dishSummary.forEach(d => {
      d.sharePct = totalFoodRev > 0 ? (d.totalRevenue / totalFoodRev) * 100 : 0;
    });

    reportState.dishSummary = dishSummary;
    reportState.metrics = {
      totalRevenue,
      totalOrders,
      avgOrderValue,
      cashRevenue,
      cashCount,
      onlineRevenue,
      onlineCount,
      deliveryRevenue,
      deliveryCount,
      pickupRevenue,
      pickupCount,
      tableRevenue,
      tableCount,
      totalDishesQty,
      distinctDishesCount: dishSummary.length
    };
  } catch (err) {
    console.error('[SalesReport] Error loading sales data:', err);
    reportState.error = err.message || 'Failed to fetch sales data';
  } finally {
    reportState.loading = false;
    renderSalesReportUI();
  }
}

// ── Render Full Sales Report UI ────────────────────────────────────────────
function renderSalesReportUI() {
  const container = document.getElementById('sales-report-content-body');
  if (!container) return;

  if (reportState.error) {
    container.innerHTML = `
      <div class="p-8 text-center space-y-3">
        <p class="text-3xl text-red-500">⚠️</p>
        <h4 class="text-sm font-bold text-slate-800">Error Loading Sales Report</h4>
        <p class="text-xs text-slate-500 max-w-sm mx-auto">${reportState.error}</p>
        <button id="btn-retry-sales-report" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs">
          🔄 Retry
        </button>
      </div>
    `;
    document.getElementById('btn-retry-sales-report')?.addEventListener('click', loadSalesReportData);
    return;
  }

  // Update Period Label
  const labelEl = document.getElementById('sales-report-period-display');
  if (labelEl) labelEl.textContent = reportState.periodLabel || 'Today';

  // Update KPI Metrics Cards
  const {
    totalRevenue,
    totalOrders,
    avgOrderValue,
    cashRevenue,
    cashCount,
    onlineRevenue,
    onlineCount,
    deliveryRevenue,
    deliveryCount,
    pickupRevenue,
    pickupCount,
    tableRevenue,
    tableCount,
    totalDishesQty,
    distinctDishesCount
  } = reportState.metrics;

  const setEl = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  setEl('kpi-sales-revenue', formatCurrency(totalRevenue));
  setEl('kpi-sales-orders', `${totalOrders} Orders`);
  setEl('kpi-sales-avg', `Avg: ${formatCurrency(avgOrderValue)}`);
  setEl('kpi-sales-cash', `${formatCurrency(cashRevenue)} (${cashCount})`);
  setEl('kpi-sales-online', `${formatCurrency(onlineRevenue)} (${onlineCount})`);
  setEl('kpi-sales-dishes-qty', `${totalDishesQty} Plates / Pcs`);
  setEl('kpi-sales-dishes-types', `${distinctDishesCount} Dish Varieties`);
  setEl('kpi-sales-channels', `🛵 Del: ${deliveryCount} · 🛍️ Pick: ${pickupCount} · 🍽️ Tbl: ${tableCount}`);

  // Render Active Tab Content
  if (reportState.activeTab === 'items') {
    renderItemsTable();
  } else if (reportState.activeTab === 'orders') {
    renderOrdersList();
  } else if (reportState.activeTab === 'bill') {
    renderBillSlipPreview();
  }
}

function renderLoadingState() {
  const container = document.getElementById('sales-report-content-body');
  if (!container) return;
  container.innerHTML = `
    <div class="py-16 text-center space-y-3">
      <div class="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
      <p class="text-xs font-bold text-slate-700">Loading Sales & Bill Data from Database...</p>
      <p class="text-[11px] text-slate-400">Aggregating orders, revenue and items sold...</p>
    </div>
  `;
}

// ── Tab 1: Render Dishes & Items Breakdown Table ───────────────────────────
function renderItemsTable() {
  const container = document.getElementById('sales-report-content-body');
  if (!container) return;

  let dishes = [...reportState.dishSummary];

  // Search filter
  if (reportState.searchDish) {
    const q = reportState.searchDish.toLowerCase().trim();
    dishes = dishes.filter(d => d.name.toLowerCase().includes(q) || d.category.toLowerCase().includes(q));
  }

  // Sorting
  if (reportState.sortOrder === 'qty_desc') {
    dishes.sort((a, b) => b.qtySold - a.qtySold);
  } else if (reportState.sortOrder === 'revenue_desc') {
    dishes.sort((a, b) => b.totalRevenue - a.totalRevenue);
  } else if (reportState.sortOrder === 'name_asc') {
    dishes.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (dishes.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-400 space-y-2">
        <p class="text-3xl">🍲</p>
        <p class="text-sm font-bold text-slate-600">No dishes sold during this period</p>
        <p class="text-xs text-slate-400">Try changing the date filter above to view earlier sales.</p>
      </div>
    `;
    return;
  }

  const rowsHtml = dishes.map((d, index) => {
    const vegDot = `<div class="food-type-icon ${d.isVeg ? '' : 'non-veg'}" title="${d.isVeg ? 'Veg' : 'Non-Veg'}" style="flex-shrink:0;"></div>`;
    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
        <td class="py-2.5 px-3 text-slate-400 font-bold text-xs text-center">${index + 1}</td>
        <td class="py-2.5 px-3">
          <div class="flex items-center gap-2">
            ${vegDot}
            <span class="font-bold text-xs text-slate-900 leading-tight">${d.name}</span>
          </div>
        </td>
        <td class="py-2.5 px-3 text-slate-500 font-medium text-xs hidden sm:table-cell">${d.category}</td>
        <td class="py-2.5 px-3 text-slate-600 font-semibold text-xs text-right">₹${d.unitPrice.toFixed(0)}</td>
        <td class="py-2.5 px-3 text-slate-900 font-extrabold text-xs text-right">
          <span class="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">${d.qtySold}</span>
        </td>
        <td class="py-2.5 px-3 text-[#0c831f] font-black text-xs text-right">${formatCurrency(d.totalRevenue)}</td>
        <td class="py-2.5 px-3 text-slate-400 font-bold text-[11px] text-right hidden md:table-cell">${d.sharePct.toFixed(1)}%</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="space-y-3">
      <!-- Search and Sort Toolbar -->
      <div class="flex flex-col sm:flex-row items-center justify-between gap-2.5 pb-2 border-b border-slate-100">
        <div class="relative w-full sm:w-64">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
          <input type="text" id="report-dish-search-input" value="${reportState.searchDish}" placeholder="Search dish name..." class="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:border-emerald-500" />
        </div>
        <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
          <span class="text-xs font-bold text-slate-500">Sort by:</span>
          <select id="report-dish-sort-select" class="px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold bg-white text-slate-800 focus:outline-none focus:border-emerald-500 cursor-pointer">
            <option value="qty_desc" ${reportState.sortOrder === 'qty_desc' ? 'selected' : ''}>Most Sold (Quantity)</option>
            <option value="revenue_desc" ${reportState.sortOrder === 'revenue_desc' ? 'selected' : ''}>Highest Revenue (₹)</option>
            <option value="name_asc" ${reportState.sortOrder === 'name_asc' ? 'selected' : ''}>Dish Name (A-Z)</option>
          </select>
        </div>
      </div>

      <!-- Responsive Items Table -->
      <div class="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider">
              <th class="py-2.5 px-3 text-center w-10">#</th>
              <th class="py-2.5 px-3">Dish / Item Name</th>
              <th class="py-2.5 px-3 hidden sm:table-cell">Category</th>
              <th class="py-2.5 px-3 text-right">Rate</th>
              <th class="py-2.5 px-3 text-right">Qty Sold</th>
              <th class="py-2.5 px-3 text-right">Total (₹)</th>
              <th class="py-2.5 px-3 text-right hidden md:table-cell">Share</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr class="bg-emerald-50/70 border-t-2 border-emerald-300 font-extrabold text-xs text-slate-900">
              <td colspan="4" class="py-3 px-4 text-left font-black">
                Total (${dishes.length} Dishes Shown)
              </td>
              <td class="py-3 px-3 text-right font-black text-emerald-900">
                ${dishes.reduce((s, d) => s + d.qtySold, 0)} Units
              </td>
              <td class="py-3 px-3 text-right font-black text-[#0c831f]">
                ${formatCurrency(dishes.reduce((s, d) => s + d.totalRevenue, 0))}
              </td>
              <td class="hidden md:table-cell"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;

  // Attach event listeners for search and sort
  document.getElementById('report-dish-search-input')?.addEventListener('input', e => {
    reportState.searchDish = e.target.value;
    renderItemsTable();
  });

  document.getElementById('report-dish-sort-select')?.addEventListener('change', e => {
    reportState.sortOrder = e.target.value;
    renderItemsTable();
  });
}

// ── Tab 2: Render Orders Invoices List ──────────────────────────────────────
function renderOrdersList() {
  const container = document.getElementById('sales-report-content-body');
  if (!container) return;

  const orders = reportState.orders;

  if (orders.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-400 space-y-2">
        <p class="text-3xl">🧾</p>
        <p class="text-sm font-bold text-slate-600">No orders recorded for this period</p>
      </div>
    `;
    return;
  }

  const ordersHtml = orders.map(o => {
    const isTable = o.order_type === 'table' || Boolean(o.table_number) || (o.notes && o.notes.includes('[TABLE:'));
    const isPickup = o.order_type === 'pickup' || o.order_type === 'takeaway';
    const typeBadge = isTable
      ? `<span class="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold text-[10px]">🍽️ Table ${o.table_number || ''}</span>`
      : isPickup
      ? `<span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-bold text-[10px]">🛍️ Pickup</span>`
      : `<span class="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 font-bold text-[10px]">🛵 Delivery</span>`;

    const pMethod = (o.payment_method || '').toLowerCase();
    const pStatus = (o.payment_status || '').toLowerCase();
    const isPaid = pStatus === 'paid' || pStatus === 'paid_online';
    const payBadge = isPaid
      ? `<span class="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px]">✓ Paid (${pMethod || 'Cash'})</span>`
      : `<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold text-[10px]">⏳ ${pMethod || 'Cash'} (Unpaid)</span>`;

    return `
      <div class="p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-emerald-400 transition-all shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div class="space-y-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-extrabold text-xs text-slate-900">#${o.order_number || o.id.slice(0, 6)}</span>
            ${typeBadge}
            ${payBadge}
            <span class="text-[11px] text-slate-400">${formatDateTimeDisplay(o.created_at)}</span>
          </div>
          <p class="text-xs font-semibold text-slate-700 truncate">
            Customer: <span class="text-slate-900 font-bold">${o.customer_name || 'Walk-in Guest'}</span> 
            ${o.customer_phone ? `<span class="text-slate-400">(${o.customer_phone})</span>` : ''}
          </p>
        </div>
        <div class="text-right shrink-0">
          <span class="font-black text-sm text-[#0c831f] block">${formatCurrency(o.total_amount)}</span>
          <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">${o.status}</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="space-y-2.5">
      <div class="flex justify-between items-center px-1 text-xs text-slate-500 font-bold pb-1">
        <span>Showing ${orders.length} Invoices</span>
        <span class="text-emerald-700 font-black">Total: ${formatCurrency(reportState.metrics.totalRevenue)}</span>
      </div>
      <div class="space-y-2 max-h-[480px] overflow-y-auto pr-1">
        ${ordersHtml}
      </div>
    </div>
  `;
}

// ── Tab 3: Render Printable POS Bill Slip Preview ──────────────────────────
function renderBillSlipPreview() {
  const container = document.getElementById('sales-report-content-body');
  if (!container) return;

  const billHtml = generateBillSlipHTML();

  container.innerHTML = `
    <div class="flex flex-col items-center py-2 space-y-4">
      <div class="text-center space-y-1">
        <p class="text-xs font-bold text-slate-600">POS Day-Close & Daily Settlement Bill Preview</p>
        <p class="text-[11px] text-slate-400">This slip is formatted for 80mm/58mm thermal POS printers and regular printers.</p>
      </div>
      
      <!-- Thermal Bill Slip Paper Container -->
      <div class="w-full max-w-sm bg-white p-5 rounded-2xl border-2 border-dashed border-slate-300 shadow-lg text-slate-900 font-mono text-xs overflow-hidden">
        ${billHtml}
      </div>

      <div class="flex gap-3">
        <button id="btn-inner-print-bill" class="px-5 py-2.5 rounded-xl bg-[#0c831f] hover:bg-[#096a18] text-white font-extrabold text-xs shadow-md transition-all flex items-center gap-2">
          <span>🖨️</span><span>Print This Bill Slip</span>
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-inner-print-bill')?.addEventListener('click', printSalesBillSlip);
}

// ── Generate POS Thermal Bill HTML ─────────────────────────────────────────
function generateBillSlipHTML() {
  const { periodLabel, dishSummary, metrics } = reportState;
  const printTime = new Date().toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  const dishesList = [...dishSummary].sort((a, b) => b.qtySold - a.qtySold);

  const itemsRows = dishesList.map(d => {
    const qtyStr = `${d.qtySold}x`.padEnd(5, ' ');
    const nameStr = d.name.length > 18 ? d.name.slice(0, 16) + '..' : d.name.padEnd(18, ' ');
    const priceStr = `₹${d.totalRevenue.toFixed(0)}`.padStart(8, ' ');
    return `<div style="display:flex; justify-content:space-between; margin:2px 0;">
      <span>${qtyStr} ${nameStr}</span>
      <span style="font-weight:bold;">${priceStr}</span>
    </div>`;
  }).join('');

  return `
    <div style="font-family: 'Courier New', Courier, monospace; color:#000; text-align:center; line-height:1.35; font-size:12px;">
      <h2 style="font-size:16px; font-weight:900; margin:0 0 2px 0;">LIMRA RESTAURANT</h2>
      <p style="font-size:11px; margin:0;">Nimtala, Alangiri Road, Egra</p>
      <p style="font-size:11px; margin:0 0 6px 0;">Phone: 9732551469 / 7001476906</p>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <p style="font-weight:900; font-size:13px; margin:2px 0;">DAILY SALES & ITEM REPORT</p>
      <p style="font-size:11px; margin:0;">Period: <strong>${periodLabel}</strong></p>
      <p style="font-size:10px; color:#555; margin:0 0 6px 0;">Printed: ${printTime}</p>
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>

      <!-- Financial Summary -->
      <div style="text-align:left; font-size:12px; margin:6px 0;">
        <div style="display:flex; justify-content:space-between; font-weight:bold;">
          <span>TOTAL ORDERS:</span>
          <span>${metrics.totalOrders} Invoices</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-weight:bold;">
          <span>CASH SALES:</span>
          <span>${formatCurrency(metrics.cashRevenue)} (${metrics.cashCount})</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-weight:bold;">
          <span>ONLINE / UPI:</span>
          <span>${formatCurrency(metrics.onlineRevenue)} (${metrics.onlineCount})</span>
        </div>
        <div style="border-top:1px dotted #888; margin:4px 0;"></div>
        <div style="display:flex; justify-content:space-between; font-size:14px; font-weight:900;">
          <span>GROSS REVENUE:</span>
          <span>${formatCurrency(metrics.totalRevenue)}</span>
        </div>
      </div>

      <!-- Channel Summary -->
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="text-align:left; font-size:11px; margin:4px 0;">
        <div style="display:flex; justify-content:space-between;">
          <span>• Dine-in Table:</span>
          <span>${metrics.tableCount} orders (${formatCurrency(metrics.tableRevenue)})</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>• Home Delivery:</span>
          <span>${metrics.deliveryCount} orders (${formatCurrency(metrics.deliveryRevenue)})</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>• Takeaway Pickup:</span>
          <span>${metrics.pickupCount} orders (${formatCurrency(metrics.pickupRevenue)})</span>
        </div>
      </div>

      <!-- Itemized Dish Sales -->
      <div style="border-top:1px dashed #000; margin:6px 0;"></div>
      <div style="text-align:left; font-weight:bold; font-size:11px; margin-bottom:4px;">
        <span>DISHES SOLD (${metrics.totalDishesQty} Units · ${metrics.distinctDishesCount} Varieties)</span>
      </div>
      <div style="text-align:left; font-size:11px;">
        ${itemsRows}
      </div>

      <div style="border-top:1px dashed #000; margin:8px 0;"></div>
      <p style="font-size:10px; margin:2px 0;">Day Settlement Verified by: _________________</p>
      <p style="font-weight:bold; font-size:11px; margin:4px 0 0 0;">*** END OF REPORT ***</p>
    </div>
  `;
}

// ── Print Bill Slip Function ───────────────────────────────────────────────
export function printSalesBillSlip() {
  const billHtml = generateBillSlipHTML();

  const printWindow = window.open('', '_blank', 'width=380,height=600');
  if (!printWindow) {
    alert('Please allow popups to print the sales bill receipt.');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>LIMRA Sales Bill Receipt — ${reportState.periodLabel}</title>
        <meta charset="utf-8" />
        <style>
          @page {
            margin: 0;
            size: auto;
          }
          body {
            margin: 0;
            padding: 12px;
            background: #fff;
            color: #000;
            display: flex;
            justify-content: center;
          }
          .bill-wrap {
            width: 100%;
            max-width: 320px;
          }
          @media print {
            body { padding: 0; }
            .no-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        <div class="bill-wrap">
          ${billHtml}
          <div class="no-print" style="margin-top:20px; text-align:center;">
            <button onclick="window.print();" style="padding:8px 16px; font-weight:bold; background:#0c831f; color:#fff; border:none; border-radius:8px; cursor:pointer;">Print Now</button>
            <button onclick="window.close();" style="padding:8px 16px; margin-left:8px; background:#e2e8f0; border:none; border-radius:8px; cursor:pointer;">Close</button>
          </div>
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// ── Download PDF Function via jsPDF + autoTable ────────────────────────────
export async function downloadSalesReportPDF() {
  // Ensure jsPDF is loaded
  if (!window.jspdf || !window.jspdf.jsPDF) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
  }

  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('PDF library could not be loaded. Please check your internet connection and try again.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');

  const { periodLabel, dishSummary, metrics } = reportState;
  const printTime = new Date().toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  // Top Green Banner
  doc.setFillColor(12, 131, 31); // #0c831f Emerald Green
  doc.rect(0, 0, 210, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('LIMRA RESTAURANT — EGRA', 14, 11);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('SALES, ORDERS & DISHES SOLD BUSINESS REPORT', 14, 18);
  doc.text(`Generated: ${printTime}`, 196, 18, { align: 'right' });

  // Period Subheader
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`Reporting Period: ${periodLabel}`, 14, 32);

  // 4 KPI Summary Boxes
  const kpiY = 36;
  const kpiH = 18;
  const kpiW = 43.5;

  // Box 1: Revenue
  doc.setFillColor(240, 253, 244);
  doc.setDrawColor(187, 247, 208);
  doc.roundedRect(14, kpiY, kpiW, kpiH, 2, 2, 'FD');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('TOTAL REVENUE', 18, kpiY + 6);
  doc.setFontSize(12);
  doc.setTextColor(12, 131, 31);
  doc.setFont('helvetica', 'bold');
  doc.text(formatCurrency(metrics.totalRevenue), 18, kpiY + 13);

  // Box 2: Total Orders
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(61.5, kpiY, kpiW, kpiH, 2, 2, 'FD');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('TOTAL ORDERS', 65.5, kpiY + 6);
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(`${metrics.totalOrders}`, 65.5, kpiY + 13);

  // Box 3: Cash Sales
  doc.roundedRect(109, kpiY, kpiW, kpiH, 2, 2, 'FD');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('CASH REVENUE', 113, kpiY + 6);
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`${formatCurrency(metrics.cashRevenue)}`, 113, kpiY + 13);

  // Box 4: Online / UPI
  doc.roundedRect(156.5, kpiY, kpiW, kpiH, 2, 2, 'FD');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('ONLINE / UPI', 160.5, kpiY + 6);
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`${formatCurrency(metrics.onlineRevenue)}`, 160.5, kpiY + 13);

  // Channel breakdown line
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Order Channels: Table Dine-In (${metrics.tableCount} orders · ${formatCurrency(metrics.tableRevenue)})  |  Delivery (${metrics.deliveryCount} orders · ${formatCurrency(metrics.deliveryRevenue)})  |  Pickup (${metrics.pickupCount} orders · ${formatCurrency(metrics.pickupRevenue)})`,
    14,
    59
  );

  // Table of Dishes Sold
  const sortedDishes = [...dishSummary].sort((a, b) => b.qtySold - a.qtySold);
  const tableData = sortedDishes.map((d, idx) => [
    idx + 1,
    d.name,
    d.category,
    `₹${d.unitPrice.toFixed(0)}`,
    d.qtySold,
    `₹${d.totalRevenue.toFixed(2)}`,
    `${d.sharePct.toFixed(1)}%`
  ]);

  doc.autoTable({
    startY: 63,
    head: [['#', 'Dish / Item Name', 'Category', 'Rate', 'Units Sold', 'Total Revenue', 'Share %']],
    body: tableData,
    foot: [
      [
        '',
        `Total (${sortedDishes.length} Varieties)`,
        '',
        '',
        metrics.totalDishesQty,
        formatCurrency(metrics.totalRevenue),
        '100%'
      ]
    ],
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.2,
      font: 'helvetica'
    },
    headStyles: {
      fillColor: [12, 131, 31],
      textColor: [255, 255, 255],
      fontStyle: 'bold'
    },
    footStyles: {
      fillColor: [240, 253, 244],
      textColor: [12, 131, 31],
      fontStyle: 'bold'
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250]
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 65 },
      2: { cellWidth: 30 },
      3: { cellWidth: 20, halign: 'right' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 28, halign: 'right' },
      6: { cellWidth: 15, halign: 'right' }
    },
    margin: { left: 14, right: 14 }
  });

  // Footer on all pages
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      'LIMRA Restaurant, Nimtala, Alangiri Road, Egra — Contact: 9732551469 / 7001476906 — Official Store Sales Settlement',
      14,
      290
    );
    doc.text(`Page ${i} of ${pageCount}`, 196, 290, { align: 'right' });
  }

  const cleanFileLabel = (reportState.range + '_' + (reportState.selectedDate || 'report')).replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`LIMRA_Sales_Report_${cleanFileLabel}.pdf`);
}

// ── Export CSV Function ────────────────────────────────────────────────────
export function exportSalesReportCSV() {
  const { periodLabel, dishSummary, metrics } = reportState;
  const sortedDishes = [...dishSummary].sort((a, b) => b.qtySold - a.qtySold);

  let csv = '\uFEFF'; // UTF-8 BOM
  csv += `LIMRA RESTAURANT — SALES & BILL REPORT\n`;
  csv += `Period:,"${periodLabel}"\n`;
  csv += `Generated:,"${new Date().toLocaleString('en-IN')}"\n\n`;

  csv += `FINANCIAL METRICS\n`;
  csv += `Gross Revenue,${metrics.totalRevenue}\n`;
  csv += `Total Orders,${metrics.totalOrders}\n`;
  csv += `Cash Revenue,${metrics.cashRevenue}\n`;
  csv += `Online / UPI Revenue,${metrics.onlineRevenue}\n`;
  csv += `Delivery Orders,${metrics.deliveryCount}\n`;
  csv += `Pickup Orders,${metrics.pickupCount}\n`;
  csv += `Table Dine-in Orders,${metrics.tableCount}\n\n`;

  csv += `DISHES SOLD BREAKDOWN\n`;
  csv += `#,Dish Name,Category,Unit Rate (INR),Qty Sold,Total Revenue (INR),Share %\n`;

  sortedDishes.forEach((d, i) => {
    csv += `${i + 1},"${d.name}","${d.category}",${d.unitPrice},${d.qtySold},${d.totalRevenue},${d.sharePct.toFixed(2)}%\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `LIMRA_Sales_Report_${reportState.range}_${reportState.selectedDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ── Initialize Event Listeners for Sales Report Hub ────────────────────────
export function initSalesReportHub() {
  const modal = document.getElementById('sales-bill-report-modal');
  const section = document.getElementById('panel-daily-sales-report');
  if (!modal && !section) return;

  const openModal = () => {
    if (modal) {
      modal.classList.remove('hidden', 'adm-hidden');
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
    loadSalesReportData();
  };

  const closeModal = () => {
    if (modal) {
      modal.classList.add('hidden', 'adm-hidden');
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  };

  // Expose globally so any button or code can open it directly
  window.openSalesReportModal = openModal;

  // Open triggers (Customer Website)
  document.getElementById('btn-header-sales-report')?.addEventListener('click', openModal);
  document.getElementById('mobile-sales-report-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  });
  document.getElementById('btn-drawer-sales-report')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal();
    openModal();
  });

  // Close triggers (Customer Website Modal)
  document.getElementById('sales-report-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-sales-report-footer')?.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden') && modal.style.display !== 'none') closeModal();
    });
  }

  // Date Preset Buttons (Works for both Modal and Embedded Admin Section)
  const presetButtons = document.querySelectorAll('.report-range-preset-btn');
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      presetButtons.forEach(b => {
        b.classList.remove('active', 'bg-emerald-600', 'text-white');
        b.classList.add('bg-slate-100', 'text-slate-700');
        b.style.background = '#f1f5f9';
        b.style.color = '#334155';
      });
      btn.classList.add('active', 'bg-emerald-600', 'text-white');
      btn.classList.remove('bg-slate-100', 'text-slate-700');
      btn.style.background = '#059669';
      btn.style.color = '#fff';

      reportState.range = btn.dataset.range;

      const singleDateWrap = document.getElementById('report-single-date-wrap');
      const customDateWrap = document.getElementById('report-custom-date-wrap');

      if (reportState.range === 'date') {
        if (singleDateWrap) {
          singleDateWrap.classList.remove('hidden', 'adm-hidden');
          singleDateWrap.style.display = 'flex';
        }
        if (customDateWrap) {
          customDateWrap.classList.add('hidden', 'adm-hidden');
          customDateWrap.style.display = 'none';
        }
      } else if (reportState.range === 'custom') {
        if (singleDateWrap) {
          singleDateWrap.classList.add('hidden', 'adm-hidden');
          singleDateWrap.style.display = 'none';
        }
        if (customDateWrap) {
          customDateWrap.classList.remove('hidden', 'adm-hidden');
          customDateWrap.style.display = 'flex';
        }
      } else {
        if (singleDateWrap) {
          singleDateWrap.classList.add('hidden', 'adm-hidden');
          singleDateWrap.style.display = 'none';
        }
        if (customDateWrap) {
          customDateWrap.classList.add('hidden', 'adm-hidden');
          customDateWrap.style.display = 'none';
        }
        loadSalesReportData();
      }
    });
  });

  // Single Date Picker input
  const singleDateInp = document.getElementById('report-single-date-input');
  if (singleDateInp) {
    singleDateInp.value = reportState.selectedDate;
    singleDateInp.addEventListener('change', e => {
      reportState.selectedDate = e.target.value;
      loadSalesReportData();
    });
  }

  // Custom Date range apply
  document.getElementById('btn-apply-custom-date')?.addEventListener('click', () => {
    const s = document.getElementById('report-custom-start-input')?.value;
    const e = document.getElementById('report-custom-end-input')?.value;
    if (s) reportState.startDate = s;
    if (e) reportState.endDate = e;
    loadSalesReportData();
  });

  // Channel filter
  document.getElementById('report-channel-filter')?.addEventListener('change', e => {
    reportState.channel = e.target.value;
    loadSalesReportData();
  });

  // Tabs (Works for both Modal and Embedded Admin Section)
  const tabButtons = document.querySelectorAll('.report-tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => {
        b.classList.remove('active', 'border-emerald-600', 'text-emerald-700', 'font-black');
        b.classList.add('border-transparent', 'text-slate-500');
        b.style.borderBottomColor = 'transparent';
        b.style.color = 'var(--adm-muted, #64748b)';
        b.style.fontWeight = '600';
      });
      btn.classList.add('active', 'border-emerald-600', 'text-emerald-700', 'font-black');
      btn.classList.remove('border-transparent', 'text-slate-500');
      btn.style.borderBottomColor = '#059669';
      btn.style.color = '#059669';
      btn.style.fontWeight = '800';

      reportState.activeTab = btn.dataset.tab;
      renderSalesReportUI();
    });
  });

  // Refresh Button
  document.getElementById('btn-refresh-sales-report')?.addEventListener('click', loadSalesReportData);

  // Print Bill Button
  document.getElementById('btn-print-sales-bill')?.addEventListener('click', printSalesBillSlip);

  // Download PDF Button
  document.getElementById('btn-download-sales-pdf')?.addEventListener('click', downloadSalesReportPDF);

  // Export CSV Button
  document.getElementById('btn-export-sales-csv')?.addEventListener('click', exportSalesReportCSV);
}
