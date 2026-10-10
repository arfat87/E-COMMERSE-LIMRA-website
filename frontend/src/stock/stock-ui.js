// ═════════════════════════════════════════════════════════════════════
// STOCK UI CONTROLLER — Streamlined, English-first, High Readability
// ═════════════════════════════════════════════════════════════════════

import { stockStore } from './stock-data.js';
import {
  CATEGORIES,
  CATEGORY_ICONS,
  getWeekInfo,
  shiftWeek,
  computePeriod,
  computeNow,
  previewOut,
  getItemLots,
  inr,
  fmtQty,
  dayKey,
  todayKey,
  dayName,
  shortDate,
  safeNum
} from './stock-engine.js';

let currentWeek = getWeekInfo(new Date());
let activeTab = 'weekly'; // 'weekly' | 'daily' | 'items' | 'reports'
let selectedDailyDate = todayKey();
let itemSearchQuery = '';
let categoryFilter = 'all';
let movementOnlyFilter = false;
let weeklyMovementFilter = 'all'; // 'all' | 'in' | 'out'
let moreMenuOpen = false;

function formatMovementDateTime(dateVal, createdVal) {
  if (!dateVal && !createdVal) return '—';
  const d = dateVal ? new Date(dateVal) : new Date(createdVal);
  const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  if (createdVal) {
    const timeStr = new Date(createdVal).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} <span style="font-size:0.75rem;color:#64748b;display:block;">${timeStr}</span>`;
  }
  return dateStr;
}

// ───────────── Mount / Initialization ─────────────
export function initStockUI() {
  const panel = document.getElementById('panel-stock');
  if (!panel) return;

  // Initial load from cache
  stockStore.loadCache();

  // Render initial frame
  render();

  // Subscribe to data updates
  stockStore.subscribe(() => {
    render();
  });

  // Background fetch from database
  stockStore.syncDB();
}

// ───────────── Main Render ─────────────
function render() {
  const panel = document.getElementById('panel-stock');
  if (!panel) return;

  const data = stockStore.getData();
  const period = computePeriod(data, currentWeek.start, currentWeek.end);
  const nowData = computeNow(data);
  const liveValuation = nowData.totals.closeValue;

  panel.innerHTML = `
    <div class="stk-wrap">
      <!-- 1. Top Header -->
      <div class="stk-header">
        <div class="stk-title-group">
          <h1 class="stk-title">Stock</h1>
          <span class="stk-badge ${data.dbStatus}">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;"></span>
            ${data.dbStatus === 'connected' ? 'Connected' : data.dbStatus === 'syncing' ? 'Syncing...' : 'Cached'}
          </span>
        </div>

        <!-- Week Navigator -->
        <div class="stk-week-nav">
          <button type="button" class="stk-btn-icon" id="stk-prev-week" title="Previous Week">◀</button>
          <span class="stk-week-label">
            ${currentWeek.title} (${currentWeek.rangeLabel})
          </span>
          <button type="button" class="stk-btn-icon" id="stk-next-week" title="Next Week">▶</button>
          <button type="button" class="stk-btn-icon" id="stk-current-week" style="margin-left:0.25rem;">This Week</button>
        </div>

        <!-- Action Buttons -->
        <div class="stk-actions">
          <button type="button" class="stk-btn-in" id="stk-btn-open-in">
            <span>+</span> Stock IN
          </button>
          <button type="button" class="stk-btn-out" id="stk-btn-open-out">
            <span>−</span> Stock OUT
          </button>

          <!-- More Options Dropdown -->
          <div class="stk-dropdown">
            <button type="button" class="stk-btn-subtle" id="stk-btn-more">
              <span>More ▾</span>
            </button>
            <div class="stk-dropdown-menu" id="stk-more-menu" style="display:${moreMenuOpen ? 'flex' : 'none'};">
              <button type="button" class="stk-dropdown-item" id="stk-act-add-item">
                <span>➕</span> Add New Item
              </button>
              <button type="button" class="stk-dropdown-item" id="stk-act-export-excel">
                <span>📊</span> Export Excel (.xlsx)
              </button>
              <button type="button" class="stk-dropdown-item" id="stk-act-export-pdf">
                <span>📄</span> Export PDF
              </button>
              <button type="button" class="stk-dropdown-item" id="stk-act-resync">
                <span>🔄</span> Re-Sync Database
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Equation Cards Strip (Opening + Purchases − Usage = Closing) -->
      <div class="stk-eq-strip">
        <!-- Card 1: Opening -->
        <div class="stk-card-kpi open">
          <div class="stk-kpi-sub">
            <span class="stk-kpi-badge open">📦 Starting Stock</span>
            <span>Week Start</span>
          </div>
          <div class="stk-kpi-val">${inr(period.totals.openValue)}</div>
          <div class="stk-kpi-foot"><strong>${period.totals.openItems}</strong> items on hand</div>
        </div>

        <!-- Card 2: Inward Purchases -->
        <div class="stk-card-kpi in">
          <div class="stk-kpi-sub">
            <span class="stk-kpi-badge in">➕ Purchases (+ IN)</span>
            <span>+ ${period.totals.inCount} bills</span>
          </div>
          <div class="stk-kpi-val in">+ ${inr(period.totals.inValue)}</div>
          <div class="stk-kpi-foot">Added to inventory this week</div>
        </div>

        <!-- Card 3: Outward Usage -->
        <div class="stk-card-kpi out">
          <div class="stk-kpi-sub">
            <span class="stk-kpi-badge out">➖ Kitchen Usage (− OUT)</span>
            <span>− ${period.totals.outCount} issues</span>
          </div>
          <div class="stk-kpi-val out">− ${inr(period.totals.outValue)}</div>
          <div class="stk-kpi-foot">Consumed (FIFO food costing)</div>
        </div>

        <!-- Card 4: Closing Balance -->
        <div class="stk-card-kpi close">
          <div class="stk-kpi-sub">
            <span class="stk-kpi-badge close">🏁 Closing Balance (=)</span>
            <span>Week End</span>
          </div>
          <div class="stk-kpi-val close">${inr(period.totals.closeValue)}</div>
          <div class="stk-kpi-foot"><strong>${period.totals.closeItems}</strong> items remaining</div>
        </div>

        <!-- Card 5: Current Live Stock -->
        <div class="stk-card-kpi current">
          <div class="stk-kpi-sub">
            <span class="stk-kpi-badge current">⚡ Live Stock Today</span>
            <span>Real-time</span>
          </div>
          <div class="stk-kpi-val current">${inr(liveValuation)}</div>
          <div class="stk-kpi-foot">Physical on-shelf valuation</div>
        </div>
      </div>

      <!-- 3. Balance Check Verification Bar -->
      <div class="stk-status-banner ${period.balanced ? 'balanced' : 'discrepancy'}">
        <div class="stk-formula-wrap">
          <span class="stk-formula-tag ${period.balanced ? 'ok' : 'warn'}">
            ${period.balanced ? '✅ Hisab Balanced' : '⚠️ Variance Detected'}
          </span>
          <div class="stk-formula-chips">
            <span class="stk-eq-chip open">Opening ${inr(period.totals.openValue)}</span>
            <span class="stk-eq-math-sign">+</span>
            <span class="stk-eq-chip in">Purchases +${inr(period.totals.inValue)}</span>
            <span class="stk-eq-math-sign">−</span>
            <span class="stk-eq-chip out">Usage −${inr(period.totals.outValue)}</span>
            <span class="stk-eq-math-sign">=</span>
            <span class="stk-eq-chip close">Closing ${inr(period.totals.closeValue)}</span>
          </div>
        </div>
        <div class="stk-formula-date-tag">
          🗓️ ${currentWeek.title} (${currentWeek.rangeLabel})
        </div>
      </div>

      <!-- 4. 7-Day Movement Strip (with explicit IN / OUT / CLOSE labels) -->
      <div class="stk-days-strip">
        ${period.days.map(d => {
          const isToday = d.key === todayKey();
          return `
            <div class="stk-day-card ${isToday ? 'today' : ''}" data-day="${d.key}">
              <div class="stk-day-head">
                <div class="stk-day-head-left">
                  <span class="stk-day-name">${dayName(d.date)}</span>
                  <span class="stk-day-date">${shortDate(d.date)}</span>
                </div>
                ${isToday ? '<span class="stk-day-today-pill">TODAY</span>' : ''}
              </div>
              <div class="stk-day-body">
                <div class="stk-day-row in">
                  <span class="stk-day-lbl in">IN</span>
                  <span class="stk-day-val in">${d.inValue > 0 ? '+ ' + inr(d.inValue) : '—'}</span>
                </div>
                <div class="stk-day-row out">
                  <span class="stk-day-lbl out">OUT</span>
                  <span class="stk-day-val out">${d.outValue > 0 ? '− ' + inr(d.outValue) : '—'}</span>
                </div>
                <div class="stk-day-row close">
                  <span class="stk-day-lbl close">CLOSE</span>
                  <span class="stk-day-val close">${inr(d.closeValue)}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- 5. Tabs Navigation Bar -->
      <div class="stk-tabs-bar">
        <div class="stk-tab-group">
          <button type="button" class="stk-tab-btn ${activeTab === 'weekly' ? 'active' : ''}" data-tab="weekly">
            🗓️ Weekly Summary
          </button>
          <button type="button" class="stk-tab-btn ${activeTab === 'daily' ? 'active' : ''}" data-tab="daily">
            📅 Daily Log
          </button>
          <button type="button" class="stk-tab-btn ${activeTab === 'items' ? 'active' : ''}" data-tab="items">
            📦 All Items (${data.items.length})
          </button>
          <button type="button" class="stk-tab-btn ${activeTab === 'reports' ? 'active' : ''}" data-tab="reports">
            📊 Reports &amp; Alerts
          </button>
        </div>

        <!-- Search Bar -->
        <div class="stk-search-wrap">
          <span>🔍</span>
          <input type="text" id="stk-search-input" class="stk-search-input" placeholder="Search item or SKU..." value="${itemSearchQuery}" />
        </div>
      </div>

      <!-- 6. Tab Content -->
      <div id="stk-tab-container">
        ${renderTabContent(period, data)}
      </div>
    </div>

    <!-- Modals Container -->
    <div id="stk-modal-root"></div>
  `;

  bindEvents();
}

// ───────────── Tab Content Renderers ─────────────
function renderTabContent(period, data) {
  if (activeTab === 'weekly') return renderWeeklyTab(period);
  if (activeTab === 'daily') return renderDailyTab(period, data);
  if (activeTab === 'items') return renderItemsTab(data);
  if (activeTab === 'reports') return renderReportsTab(period, data);
  return '';
}

function renderWeeklyTab(period) {
  const q = itemSearchQuery.toLowerCase().trim();
  const filtered = period.rows.filter(r => {
    if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
    if (movementOnlyFilter && !r.hasMovement) return false;
    if (q) {
      const match = r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // Collect all movements in this week chronologically
  const allWeeklyMovements = [
    ...period.ins.map(e => ({
      id: e.id,
      type: 'IN',
      displayType: '📥 Stock IN',
      date: e.entryDate || e.date,
      createdAt: e.createdAt,
      sku: e.sku,
      name: e.name || e.description,
      unit: e.unit || 'pcs',
      qty: e.qty,
      rate: e.rate || e.costPrice,
      amount: e.amount,
      party: e.supplier || 'Vendor Purchase',
      notes: e.notes || ''
    })),
    ...period.outs.map(e => ({
      id: e.id,
      type: 'OUT',
      displayType: '📤 Stock OUT',
      date: e.entryDate || e.date,
      createdAt: e.createdAt,
      sku: e.sku,
      name: e.name || e.description,
      unit: e.unit || 'pcs',
      qty: e.qty,
      rate: e.rate,
      amount: e.amount,
      party: e.usedBy || 'Kitchen Prep',
      notes: e.notes || ''
    }))
  ].sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));

  const filteredMovements = allWeeklyMovements.filter(m => {
    if (weeklyMovementFilter === 'in' && m.type !== 'IN') return false;
    if (weeklyMovementFilter === 'out' && m.type !== 'OUT') return false;
    if (q) {
      const match = m.name.toLowerCase().includes(q) || m.sku.toLowerCase().includes(q) || m.party.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  return `
    <!-- Category Filter Chips -->
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.6rem;margin-bottom:0.85rem;">
      <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
        <button type="button" class="stk-cat-pill ${categoryFilter === 'all' ? 'active' : ''}" data-cat="all">All Categories</button>
        ${CATEGORIES.map(c => `
          <button type="button" class="stk-cat-pill ${categoryFilter === c ? 'active' : ''}" data-cat="${c}">
            <span>${CATEGORY_ICONS[c] || '📦'}</span> <span>${c}</span>
          </button>
        `).join('')}
      </div>

      <label style="font-size:0.8rem;font-weight:700;color:#334155;display:flex;align-items:center;gap:0.4rem;cursor:pointer;">
        <input type="checkbox" id="stk-chk-movement" ${movementOnlyFilter ? 'checked' : ''} style="cursor:pointer;" />
        Show only items with activity
      </label>
    </div>

    <!-- Grouped Two-Tier Weekly Matrix Table -->
    <div class="stk-table-card">
      <div class="stk-table-scroll">
        <table class="stk-table">
          <thead>
            <!-- Tier 1: High-Contrast Functional Group Headers -->
            <tr class="stk-th-tier1">
              <th colspan="4" class="stk-th-grp item">📦 Item Details</th>
              <th colspan="2" class="stk-th-grp open">Starting Stock</th>
              <th colspan="2" class="stk-th-grp in">📥 Purchases (+ IN)</th>
              <th colspan="2" class="stk-th-grp out">📤 Kitchen Usage (− OUT)</th>
              <th colspan="2" class="stk-th-grp close">🏁 Closing Balance (=)</th>
              <th colspan="2" class="stk-th-grp action">Status &amp; Action</th>
            </tr>
            <!-- Tier 2: Column Sub-Headers -->
            <tr class="stk-th-tier2">
              <th style="min-width:180px;">Item &amp; SKU</th>
              <th>Category</th>
              <th>Unit</th>
              <th class="num">Rate (₹)</th>
              
              <!-- Opening -->
              <th class="num stk-subth-open">Qty</th>
              <th class="num stk-subth-open">Value (₹)</th>
              
              <!-- IN -->
              <th class="num stk-subth-in">+ Qty</th>
              <th class="num stk-subth-in">+ Value (₹)</th>
              
              <!-- OUT -->
              <th class="num stk-subth-out">− Qty</th>
              <th class="num stk-subth-out">− Value (₹)</th>
              
              <!-- Closing -->
              <th class="num stk-subth-close">Net Qty</th>
              <th class="num stk-subth-close">Net Value (₹)</th>
              
              <!-- Status & Actions -->
              <th style="text-align:center;">Status</th>
              <th style="text-align:center;min-width:110px;">Quick Action</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0
              ? `<tr><td colspan="14" style="text-align:center;padding:2.8rem;color:#94a3b8;font-weight:700;">No items found matching the selected filters.</td></tr>`
              : filtered.map(r => `
                <tr class="stk-row">
                  <!-- Item Details -->
                  <td>
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem;">
                      <div>
                        <div class="stk-item-name">${r.name}</div>
                        <div class="stk-item-sku">${r.sku}</div>
                      </div>
                      <button type="button" class="stk-btn-view-batch" data-view-batch="${r.sku}" title="View FIFO Batches &amp; History">📦 Batches</button>
                    </div>
                  </td>
                  <td><span class="stk-pill-cat">${r.category}</span></td>
                  <td class="stk-cell-unit">${r.unit}</td>
                  <td class="num stk-cell-rate">₹ ${r.rate.toFixed(2)}</td>

                  <!-- Opening Stock -->
                  <td class="num font-mono stk-cell-open-qty">${fmtQty(r.openQty)}</td>
                  <td class="num font-mono stk-cell-open-val">${inr(r.openValue)}</td>

                  <!-- Inward Purchases (IN) -->
                  <td class="num font-mono stk-cell-in-qty">${r.inQty > 0 ? '+' + fmtQty(r.inQty) : '—'}</td>
                  <td class="num font-mono stk-cell-in-val">${r.inValue > 0 ? inr(r.inValue) : '—'}</td>

                  <!-- Kitchen Usage (OUT) -->
                  <td class="num font-mono stk-cell-out-qty">${r.outQty > 0 ? '−' + fmtQty(r.outQty) : '—'}</td>
                  <td class="num font-mono stk-cell-out-val">${r.outValue > 0 ? inr(r.outValue) : '—'}</td>

                  <!-- Closing Balance -->
                  <td class="num font-mono stk-cell-close-qty">${fmtQty(r.closeQty)}</td>
                  <td class="num font-mono stk-cell-close-val">${inr(r.closeValue)}</td>

                  <!-- Status -->
                  <td style="text-align:center;">
                    <span class="stk-pill ${r.status.toLowerCase()}">${r.status}</span>
                  </td>

                  <!-- Quick Actions -->
                  <td style="text-align:center;white-space:nowrap;">
                    <button type="button" class="stk-btn-quick-in" data-quick-in="${r.sku}" title="Quick Stock IN">+IN</button>
                    <button type="button" class="stk-btn-quick-out" data-quick-out="${r.sku}" title="Quick Stock OUT">−OUT</button>
                  </td>
                </tr>
              `).join('')
            }
          </tbody>
          <tfoot>
            <tr class="stk-tfoot-row">
              <td colspan="4" class="stk-tfoot-label">
                <span>WEEKLY TOTALS (${filtered.length} ITEMS)</span>
              </td>
              <td class="num"></td>
              <td class="num font-mono stk-tfoot-open">${inr(filtered.reduce((s, r) => s + r.openValue, 0))}</td>
              <td class="num"></td>
              <td class="num font-mono stk-tfoot-in">+ ${inr(filtered.reduce((s, r) => s + r.inValue, 0))}</td>
              <td class="num"></td>
              <td class="num font-mono stk-tfoot-out">− ${inr(filtered.reduce((s, r) => s + r.outValue, 0))}</td>
              <td class="num"></td>
              <td class="num font-mono stk-tfoot-close">${inr(filtered.reduce((s, r) => s + r.closeValue, 0))}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- 7. Weekly Movement Ledger ("Kab Kitna IN / OUT Hua") -->
    <div class="stk-movement-section">
      <div class="stk-movement-card">
        <div class="stk-movement-head">
          <div class="stk-movement-title">
            <span>📜</span>
            <span>This Week's Movement Log — Kab Kitna IN / OUT Hua (${allWeeklyMovements.length})</span>
          </div>
          <div class="stk-movement-pills">
            <button type="button" class="stk-mv-filter-btn ${weeklyMovementFilter === 'all' ? 'active' : ''}" data-mv-filter="all">
              All Movements (${allWeeklyMovements.length})
            </button>
            <button type="button" class="stk-mv-filter-btn in ${weeklyMovementFilter === 'in' ? 'active' : ''}" data-mv-filter="in">
              📥 Purchases (+IN: ${period.ins.length}) · + ${inr(period.totals.inValue)}
            </button>
            <button type="button" class="stk-mv-filter-btn out ${weeklyMovementFilter === 'out' ? 'active' : ''}" data-mv-filter="out">
              📤 Kitchen Usage (−OUT: ${period.outs.length}) · − ${inr(period.totals.outValue)}
            </button>
          </div>
        </div>

        <div class="stk-table-scroll" style="max-height:480px;">
          <table class="stk-table">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="min-width:120px;">Date &amp; Time</th>
                <th style="min-width:110px;text-align:center;">Type</th>
                <th style="min-width:160px;">Item &amp; SKU</th>
                <th class="num" style="min-width:90px;">Quantity</th>
                <th class="num" style="min-width:110px;">Unit Rate (₹)</th>
                <th class="num" style="min-width:110px;">Total Amount (₹)</th>
                <th style="min-width:130px;">Party / Purpose</th>
                <th style="min-width:130px;">Notes</th>
                <th style="text-align:center;min-width:95px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filteredMovements.length === 0
                ? `<tr><td colspan="9" style="text-align:center;padding:2.5rem;color:#94a3b8;font-weight:700;">No movements recorded for ${currentWeek.rangeLabel}. Click "+ Stock IN" or "− Stock OUT" above to add.</td></tr>`
                : filteredMovements.map(m => `
                  <tr>
                    <td>${formatMovementDateTime(m.date, m.createdAt)}</td>
                    <td style="text-align:center;">
                      <span class="stk-pill ${m.type === 'IN' ? 'ok' : 'low'}" style="font-size:0.72rem;padding:0.2rem 0.55rem;">
                        ${m.displayType}
                      </span>
                    </td>
                    <td>
                      <div style="font-weight:800;color:#0f172a;">${m.name}</div>
                      <div style="font-size:0.72rem;font-family:monospace;color:#4f46e5;">${m.sku}</div>
                    </td>
                    <td class="num font-mono" style="font-weight:800;color:${m.type === 'IN' ? '#047857' : '#d97706'};">
                      ${m.type === 'IN' ? '+' : '−'} ${fmtQty(m.qty)} ${m.unit}
                    </td>
                    <td class="num font-mono">
                      <div>₹ ${safeNum(m.rate).toFixed(2)}</div>
                      <div style="font-size:0.7rem;color:#64748b;">${m.type === 'IN' ? 'Purchase Rate' : 'FIFO Consumed'}</div>
                    </td>
                    <td class="num font-mono" style="font-weight:900;color:${m.type === 'IN' ? '#047857' : '#d97706'};">
                      ${m.type === 'IN' ? '+' : '−'} ${inr(m.amount)}
                    </td>
                    <td style="font-size:0.82rem;font-weight:600;color:#334155;">${m.party || '—'}</td>
                    <td style="font-size:0.78rem;color:#64748b;">${m.notes || '—'}</td>
                    <td style="text-align:center;white-space:nowrap;">
                      <button type="button" class="stk-btn-view-batch" data-view-batch="${m.sku}" title="Inspect FIFO Batches">📦 Batches</button>
                      <button type="button" class="stk-btn-icon" data-del-${m.type.toLowerCase()}="${m.id}" title="Delete entry" style="color:#e11d48;margin-left:0.25rem;">🗑️</button>
                    </td>
                  </tr>
                `).join('')
              }
            </tbody>
            <tfoot>
              <tr class="stk-tfoot-row">
                <td colspan="3" class="stk-tfoot-label">
                  <span>NET MOVEMENT IN CURRENT VIEW (${filteredMovements.length} TRANSACTIONS)</span>
                </td>
                <td class="num"></td>
                <td class="num"></td>
                <td class="num font-mono" style="font-weight:900;">
                  ${inr(filteredMovements.reduce((sum, m) => sum + (m.type === 'IN' ? m.amount : -m.amount), 0))}
                </td>
                <td colspan="3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderDailyTab(period, data) {
  const dayIns = period.ins.filter(e => dayKey(e.entryDate) === selectedDailyDate);
  const dayOuts = period.outs.filter(e => dayKey(e.entryDate) === selectedDailyDate);
  const totalIn = dayIns.reduce((s, e) => s + e.amount, 0);
  const totalOut = dayOuts.reduce((s, e) => s + e.amount, 0);

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <label for="stk-daily-date-picker" style="font-size:0.85rem;font-weight:700;color:#334155;">Select Date:</label>
        <input type="date" id="stk-daily-date-picker" value="${selectedDailyDate}" class="stk-input" style="width:160px;font-family:monospace;" />
        <button type="button" class="stk-btn-subtle" id="stk-btn-daily-today">Today</button>
      </div>

      <div style="display:flex;gap:0.65rem;">
        <span class="stk-pill ok" style="font-size:0.84rem;padding:0.35rem 0.75rem;">Total IN: + ${inr(totalIn)}</span>
        <span class="stk-pill low" style="font-size:0.84rem;padding:0.35rem 0.75rem;">Total OUT: − ${inr(totalOut)}</span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(420px, 1fr));gap:1rem;">
      <!-- Day IN Entries -->
      <div class="stk-table-card">
        <div style="padding:0.85rem 1.1rem;background:#ecfdf5;border-bottom:2px solid #a7f3d0;display:flex;align-items:center;justify-content:space-between;">
          <strong style="color:#065f46;font-size:0.92rem;">📥 Stock IN Entries (${dayIns.length})</strong>
          <span style="font-weight:900;font-family:ui-monospace,monospace;color:#047857;font-size:1.05rem;">+ ${inr(totalIn)}</span>
        </div>
        <div class="stk-table-scroll" style="max-height:400px;">
          <table class="stk-table">
            <thead>
              <tr style="background:#f0fdf4;">
                <th style="background:#f0fdf4;color:#065f46;">Item &amp; SKU</th>
                <th class="num" style="background:#f0fdf4;color:#065f46;">Qty</th>
                <th class="num" style="background:#f0fdf4;color:#065f46;">Rate</th>
                <th class="num" style="background:#f0fdf4;color:#065f46;">Total (₹)</th>
                <th style="text-align:center;background:#f0fdf4;color:#065f46;">Del</th>
              </tr>
            </thead>
            <tbody>
              ${dayIns.length === 0
                ? `<tr><td colspan="5" style="text-align:center;padding:2.5rem;color:#94a3b8;font-weight:600;">No purchase entries on this day.</td></tr>`
                : dayIns.map(e => `
                  <tr>
                    <td>
                      <div style="font-weight:800;color:#0f172a;">${e.name || e.description}</div>
                      <div style="font-size:0.72rem;font-family:monospace;color:#4f46e5;">${e.sku} ${e.supplier ? '· ' + e.supplier : ''}</div>
                    </td>
                    <td class="num font-mono font-bold" style="color:#047857;">+${fmtQty(e.qty)} ${e.unit || ''}</td>
                    <td class="num font-mono" style="color:#475569;">₹ ${safeNum(e.rate, 0).toFixed(2)}</td>
                    <td class="num font-mono font-bold" style="color:#047857;">${inr(e.amount)}</td>
                    <td style="text-align:center;">
                      <button type="button" class="stk-btn-icon" data-del-in="${e.id}" style="color:#be123c;" title="Delete">✕</button>
                    </td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- Day OUT Entries -->
      <div class="stk-table-card">
        <div style="padding:0.85rem 1.1rem;background:#fffbeb;border-bottom:2px solid #fde68a;display:flex;align-items:center;justify-content:space-between;">
          <strong style="color:#92400e;font-size:0.92rem;">📤 Stock OUT Entries (${dayOuts.length})</strong>
          <span style="font-weight:900;font-family:ui-monospace,monospace;color:#b45309;font-size:1.05rem;">− ${inr(totalOut)}</span>
        </div>
        <div class="stk-table-scroll" style="max-height:400px;">
          <table class="stk-table">
            <thead>
              <tr style="background:#fffbeb;">
                <th style="background:#fffbeb;color:#92400e;">Item &amp; SKU</th>
                <th style="background:#fffbeb;color:#92400e;">Reason</th>
                <th class="num" style="background:#fffbeb;color:#92400e;">Qty</th>
                <th class="num" style="background:#fffbeb;color:#92400e;">FIFO Cost (₹)</th>
                <th style="text-align:center;background:#fffbeb;color:#92400e;">Del</th>
              </tr>
            </thead>
            <tbody>
              ${dayOuts.length === 0
                ? `<tr><td colspan="5" style="text-align:center;padding:2.5rem;color:#94a3b8;font-weight:600;">No usage entries on this day.</td></tr>`
                : dayOuts.map(e => `
                  <tr>
                    <td>
                      <div style="font-weight:800;color:#0f172a;">${e.name || e.description}</div>
                      <div style="font-size:0.72rem;font-family:monospace;color:#4f46e5;">${e.sku}</div>
                    </td>
                    <td style="font-size:0.78rem;font-weight:600;color:#64748b;">${e.usedBy || 'Kitchen Prep'}</td>
                    <td class="num font-mono font-bold" style="color:#b45309;">−${fmtQty(e.qty)} ${e.unit || ''}</td>
                    <td class="num font-mono font-bold" style="color:#b45309;">${inr(e.amount)}</td>
                    <td style="text-align:center;">
                      <button type="button" class="stk-btn-icon" data-del-out="${e.id}" style="color:#be123c;" title="Delete">✕</button>
                    </td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderItemsTab(data) {
  const q = itemSearchQuery.toLowerCase().trim();
  const items = data.items.filter(i => {
    if (q) {
      return i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || i.category.toLowerCase().includes(q);
    }
    return true;
  });

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
      <span style="font-size:0.85rem;font-weight:700;color:#64748b;">Total ${items.length} Registered Catalog Items</span>
      <button type="button" class="stk-btn-in" id="stk-btn-add-item-tab" style="padding:0.45rem 0.95rem;font-size:0.82rem;">+ Add New Item</button>
    </div>

    <div class="stk-table-card">
      <div class="stk-table-scroll">
        <table class="stk-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item Name</th>
              <th>Category</th>
              <th>Unit</th>
              <th class="num">Current Balance</th>
              <th class="num">Rate (₹)</th>
              <th class="num">Stock Value (₹)</th>
              <th class="num">Min Alert</th>
              <th style="text-align:center;">Status</th>
              <th style="text-align:center;">Edit</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(i => {
              const val = i.storedQty * i.cost;
              const isLow = i.min > 0 && i.storedQty <= i.min;
              const isOut = i.storedQty <= 0;
              return `
                <tr>
                  <td class="font-mono font-bold" style="color:#6366f1;">${i.sku}</td>
                  <td style="font-weight:700;">${i.name}</td>
                  <td><span class="stk-pill" style="background:#f1f5f9;color:#334155;">${i.category}</span></td>
                  <td style="font-family:monospace;font-size:0.75rem;color:#64748b;">${i.unit}</td>
                  <td class="num font-mono font-bold" style="color:${isOut ? '#be123c' : isLow ? '#b45309' : '#0f172a'};">${fmtQty(i.storedQty)}</td>
                  <td class="num font-mono">₹ ${i.cost.toFixed(2)}</td>
                  <td class="num font-mono font-bold">${inr(val)}</td>
                  <td class="num font-mono" style="color:#64748b;">${fmtQty(i.min)}</td>
                  <td style="text-align:center;">
                    <span class="stk-pill ${isOut ? 'out' : isLow ? 'low' : 'ok'}">${isOut ? 'Out of Stock' : isLow ? 'Low Stock' : 'Good'}</span>
                  </td>
                  <td style="text-align:center;">
                    <button type="button" class="stk-btn-icon" data-edit-item="${i.id}">✏️ Edit</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderReportsTab(period, data) {
  const lowItems = period.rows.filter(r => r.min > 0 && r.closeQty <= r.min);
  const agingItems = period.rows.filter(r => r.closeQty > 0 && r.oldestLot);

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(360px, 1fr));gap:1rem;">
      <!-- Low Stock Reorder Alerts -->
      <div class="stk-table-card" style="padding:1rem;">
        <h3 style="margin:0 0 0.5rem;font-size:0.95rem;color:#b45309;display:flex;align-items:center;gap:0.4rem;">
          <span>🚨</span> Reorder Alerts (${lowItems.length})
        </h3>
        <p style="font-size:0.75rem;color:#64748b;margin:0 0 0.85rem;">Items that have reached or fallen below minimum stock thresholds.</p>
        <div style="display:flex;flex-direction:column;gap:0.4rem;max-height:300px;overflow-y:auto;">
          ${lowItems.length === 0
            ? `<div style="color:#047857;font-size:0.8rem;padding:1rem;text-align:center;background:#ecfdf5;border-radius:10px;">✅ All items are currently above minimum threshold!</div>`
            : lowItems.map(r => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.75rem;background:#fffbeb;border-radius:8px;font-size:0.82rem;">
                <span style="font-weight:700;">${r.name}</span>
                <span style="font-family:monospace;font-weight:800;color:#b45309;">${fmtQty(r.closeQty)} ${r.unit} (Min: ${r.min})</span>
              </div>
            `).join('')
          }
        </div>
      </div>

      <!-- Category Expense Breakdown -->
      <div class="stk-table-card" style="padding:1rem;">
        <h3 style="margin:0 0 0.5rem;font-size:0.95rem;color:#4338ca;display:flex;align-items:center;gap:0.4rem;">
          <span>🏷️</span> Category-Wise Spend &amp; Usage
        </h3>
        <p style="font-size:0.75rem;color:#64748b;margin:0 0 0.85rem;">Purchases (IN) and consumption (OUT) across stock groups for ${currentWeek.rangeLabel}.</p>
        <div style="display:flex;flex-direction:column;gap:0.5rem;">
          ${CATEGORIES.map(cat => {
            const c = period.byCategory[cat] || { inValue: 0, outValue: 0, closeValue: 0 };
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.75rem;border-bottom:1px solid #f1f5f9;font-size:0.82rem;">
                <span style="font-weight:700;color:#0f172a;">${CATEGORY_ICONS[cat] || ''} ${cat}</span>
                <div style="display:flex;gap:0.5rem;font-family:ui-monospace,monospace;align-items:center;">
                  <span class="stk-pill ok" style="font-size:0.72rem;padding:0.18rem 0.5rem;">IN: + ${inr(c.inValue)}</span>
                  <span class="stk-pill low" style="font-size:0.72rem;padding:0.18rem 0.5rem;">OUT: − ${inr(c.outValue)}</span>
                  <span class="stk-pill" style="background:#e0e7ff;color:#3730a3;font-size:0.72rem;padding:0.18rem 0.5rem;border:1px solid #c7d2fe;">Close: ${inr(c.closeValue)}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

// ───────────── Event Handlers ─────────────
function bindEvents() {
  const panel = document.getElementById('panel-stock');
  if (!panel) return;

  // Week navigation
  panel.querySelector('#stk-prev-week')?.addEventListener('click', () => {
    currentWeek = shiftWeek(currentWeek, -1);
    render();
  });
  panel.querySelector('#stk-next-week')?.addEventListener('click', () => {
    currentWeek = shiftWeek(currentWeek, +1);
    render();
  });
  panel.querySelector('#stk-current-week')?.addEventListener('click', () => {
    currentWeek = getWeekInfo(new Date());
    render();
  });

  // Action buttons
  panel.querySelector('#stk-btn-open-in')?.addEventListener('click', () => openEntryModal('IN'));
  panel.querySelector('#stk-btn-open-out')?.addEventListener('click', () => openEntryModal('OUT'));

  // More dropdown toggle
  const moreBtn = panel.querySelector('#stk-btn-more');
  moreBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    moreMenuOpen = !moreMenuOpen;
    const menu = panel.querySelector('#stk-more-menu');
    if (menu) menu.style.display = moreMenuOpen ? 'flex' : 'none';
  });

  document.addEventListener('click', () => {
    if (moreMenuOpen) {
      moreMenuOpen = false;
      const menu = document.getElementById('stk-more-menu');
      if (menu) menu.style.display = 'none';
    }
  }, { once: true });

  // Dropdown items
  panel.querySelector('#stk-act-add-item')?.addEventListener('click', () => openItemModal());
  panel.querySelector('#stk-btn-add-item-tab')?.addEventListener('click', () => openItemModal());
  panel.querySelector('#stk-act-resync')?.addEventListener('click', () => stockStore.syncDB());
  panel.querySelector('#stk-act-export-excel')?.addEventListener('click', () => exportExcel());
  panel.querySelector('#stk-act-export-pdf')?.addEventListener('click', () => window.print());

  // Tabs
  panel.querySelectorAll('.stk-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      render();
    });
  });

  // Day cards click
  panel.querySelectorAll('.stk-day-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedDailyDate = card.dataset.day;
      activeTab = 'daily';
      render();
    });
  });

  // Daily date picker
  const dp = panel.querySelector('#stk-daily-date-picker');
  dp?.addEventListener('change', (e) => {
    selectedDailyDate = e.target.value;
    render();
  });
  panel.querySelector('#stk-btn-daily-today')?.addEventListener('click', () => {
    selectedDailyDate = todayKey();
    render();
  });

  // Search input
  const searchInput = panel.querySelector('#stk-search-input');
  searchInput?.addEventListener('input', (e) => {
    itemSearchQuery = e.target.value;
    render();
    // Re-focus search input
    document.getElementById('stk-search-input')?.focus();
  });

  // Category filter pills
  panel.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      categoryFilter = btn.dataset.cat;
      render();
    });
  });

  // Movement filter checkbox
  panel.querySelector('#stk-chk-movement')?.addEventListener('change', (e) => {
    movementOnlyFilter = e.target.checked;
    render();
  });

  // Quick IN / OUT buttons on table rows
  panel.querySelectorAll('[data-quick-in]').forEach(b => {
    b.addEventListener('click', () => openEntryModal('IN', b.dataset.quickIn));
  });
  panel.querySelectorAll('[data-quick-out]').forEach(b => {
    b.addEventListener('click', () => openEntryModal('OUT', b.dataset.quickOut));
  });

  // Edit item
  panel.querySelectorAll('[data-edit-item]').forEach(b => {
    b.addEventListener('click', () => openItemModal(b.dataset.editItem));
  });

  // Delete entries (daily & weekly)
  panel.querySelectorAll('[data-del-in]').forEach(b => {
    b.addEventListener('click', async () => {
      if (confirm('Delete this Stock IN entry?')) {
        await stockStore.deleteEntry('IN', b.dataset.delIn);
      }
    });
  });
  panel.querySelectorAll('[data-del-out]').forEach(b => {
    b.addEventListener('click', async () => {
      if (confirm('Delete this Stock OUT entry?')) {
        await stockStore.deleteEntry('OUT', b.dataset.delOut);
      }
    });
  });

  // Inspect active FIFO batches
  panel.querySelectorAll('[data-view-batch]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openItemBatchModal(b.dataset.viewBatch);
    });
  });

  // Weekly movement filter pills
  panel.querySelectorAll('[data-mv-filter]').forEach(b => {
    b.addEventListener('click', () => {
      weeklyMovementFilter = b.dataset.mvFilter;
      render();
    });
  });
}

// ───────────── Entry Modal (IN / OUT) ─────────────
function openEntryModal(mode = 'IN', presetSku = null) {
  const root = document.getElementById('stk-modal-root');
  if (!root) return;

  const data = stockStore.getData();
  const sortedItems = [...data.items].sort((a, b) => a.name.localeCompare(b.name));
  const defaultSku = presetSku || (sortedItems[0] ? sortedItems[0].sku : '');
  const selectedItem = sortedItems.find(i => i.sku === defaultSku) || sortedItems[0];

  root.innerHTML = `
    <div class="stk-modal-backdrop" id="stk-entry-modal">
      <div class="stk-modal-card">
        <div class="stk-modal-head ${mode.toLowerCase()}">
          <h3 class="stk-modal-title">
            ${mode === 'IN' ? '📥 Record Stock IN (Purchase)' : '📤 Record Stock OUT (Kitchen Usage)'}
          </h3>
          <button type="button" class="stk-modal-close" id="stk-modal-close-btn">&times;</button>
        </div>

        <form id="stk-entry-form">
          <div class="stk-modal-body">
            <!-- Mode switch -->
            <div style="display:flex;background:#f1f5f9;padding:0.25rem;border-radius:10px;gap:0.25rem;">
              <button type="button" id="stk-switch-in" style="flex:1;padding:0.4rem;border:none;border-radius:8px;font-weight:800;font-size:0.8rem;cursor:pointer;background:${mode === 'IN' ? '#059669' : 'transparent'};color:${mode === 'IN' ? '#fff' : '#475569'};">
                + Stock IN
              </button>
              <button type="button" id="stk-switch-out" style="flex:1;padding:0.4rem;border:none;border-radius:8px;font-weight:800;font-size:0.8rem;cursor:pointer;background:${mode === 'OUT' ? '#d97706' : 'transparent'};color:${mode === 'OUT' ? '#fff' : '#475569'};">
                − Stock OUT
              </button>
            </div>

            <!-- Item Selector -->
            <div>
              <label class="stk-label">Select Item *</label>
              <select id="stk-form-item" class="stk-select" required>
                ${sortedItems.map(i => `
                  <option value="${i.sku}" ${i.sku === defaultSku ? 'selected' : ''}>
                    ${i.name} (${i.sku}) · Bal: ${fmtQty(i.storedQty)} ${i.unit}
                  </option>
                `).join('')}
              </select>
            </div>

            <!-- Date & Quantity -->
            <div class="stk-form-row">
              <div>
                <label class="stk-label">Date *</label>
                <input type="date" id="stk-form-date" class="stk-input" value="${todayKey()}" required />
              </div>
              <div>
                <label class="stk-label">Quantity (<span id="stk-form-unit">${selectedItem?.unit || 'pcs'}</span>) *</label>
                <input type="number" step="any" min="0.001" id="stk-form-qty" class="stk-input" placeholder="e.g. 10" required />
              </div>
            </div>

            <!-- IN specific: Rate & Total -->
            <div id="stk-in-fields" style="display:${mode === 'IN' ? 'flex' : 'none'};flex-direction:column;gap:0.75rem;">
              <div class="stk-form-row">
                <div>
                  <label class="stk-label">Purchase Rate (₹ / unit) *</label>
                  <input type="number" step="any" min="0.01" id="stk-form-cost" class="stk-input" value="${selectedItem?.cost || ''}" placeholder="0.00 (Required)" required />
                  <span style="font-size:0.72rem;color:#059669;display:block;margin-top:2px;">💡 Required: FIFO uses this price to value inventory &amp; usage</span>
                </div>
                <div>
                  <label class="stk-label">Total Cost (₹)</label>
                  <input type="number" step="any" min="0.01" id="stk-form-total" class="stk-input" placeholder="0.00" />
                  <span style="font-size:0.72rem;color:#64748b;display:block;margin-top:2px;">Rate × Qty (Auto-calculated)</span>
                </div>
              </div>

              <div>
                <label class="stk-label">Supplier / Vendor</label>
                <input type="text" id="stk-form-supplier" class="stk-input" placeholder="e.g. Royal Traders" value="${selectedItem?.supplier || ''}" />
              </div>

              <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.78rem;font-weight:600;color:#334155;cursor:pointer;">
                <input type="checkbox" id="stk-form-update-master" checked />
                Update default item purchase rate
              </label>
            </div>

            <!-- OUT specific: Reason & FIFO Impact Preview -->
            <div id="stk-out-fields" style="display:${mode === 'OUT' ? 'flex' : 'none'};flex-direction:column;gap:0.75rem;">
              <div>
                <label class="stk-label">Reason *</label>
                <select id="stk-form-reason" class="stk-select">
                  <option value="Kitchen Prep">👨‍🍳 Kitchen Prep (Daily Cooking)</option>
                  <option value="Waste / Spoilage">🗑️ Waste / Spoilage</option>
                  <option value="Staff Meal">🍲 Staff Meal</option>
                  <option value="Damaged / Expired">⚠️ Damaged / Expired</option>
                  <option value="Other">📝 Other</option>
                </select>
              </div>

              <div class="stk-preview-box" id="stk-out-preview-box">
                <span style="font-weight:700;">Live FIFO Impact:</span>
                <span id="stk-out-preview-text">Enter quantity to calculate FIFO valuation...</span>
              </div>
            </div>

            <!-- Notes -->
            <div>
              <label class="stk-label">Notes (Optional)</label>
              <input type="text" id="stk-form-notes" class="stk-input" placeholder="e.g. Morning delivery, invoice #124" />
            </div>
          </div>

          <div class="stk-modal-foot">
            <button type="button" class="stk-btn-subtle" id="stk-modal-cancel">Cancel</button>
            <button type="submit" class="stk-btn-in" id="stk-modal-submit" style="background:${mode === 'IN' ? '#059669' : '#d97706'};">
              Save Entry
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Bind modal interactive events
  let curMode = mode;
  const modal = document.getElementById('stk-entry-modal');
  const itemSelect = document.getElementById('stk-form-item');
  const qtyInput = document.getElementById('stk-form-qty');
  const costInput = document.getElementById('stk-form-cost');
  const totalInput = document.getElementById('stk-form-total');
  const unitSpan = document.getElementById('stk-form-unit');
  const inFields = document.getElementById('stk-in-fields');
  const outFields = document.getElementById('stk-out-fields');
  const submitBtn = document.getElementById('stk-modal-submit');
  const previewText = document.getElementById('stk-out-preview-text');

  const updateModalState = (newMode) => {
    curMode = newMode;
    inFields.style.display = curMode === 'IN' ? 'flex' : 'none';
    outFields.style.display = curMode === 'OUT' ? 'flex' : 'none';
    submitBtn.style.background = curMode === 'IN' ? '#059669' : '#d97706';
    updatePreview();
  };

  const updatePreview = () => {
    const sku = itemSelect.value;
    const itm = data.items.find(i => i.sku === sku);
    if (!itm) return;
    unitSpan.textContent = itm.unit;

    if (curMode === 'IN') {
      const q = safeNum(qtyInput.value, 0);
      const c = safeNum(costInput.value, 0);
      if (q > 0 && c > 0) totalInput.value = (q * c).toFixed(2);
    } else {
      const q = safeNum(qtyInput.value, 0);
      if (q > 0) {
        const pv = previewOut(data, sku, q);
        const rem = pv.available - q;
        const lotsHtml = pv.lotsUsed && pv.lotsUsed.length > 0
          ? `<div style="margin-top:6px;padding:6px 10px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;font-size:0.76rem;color:#92400e;">
               <strong style="display:block;margin-bottom:3px;">📦 FIFO Batches Consumed (Oldest First):</strong>
               ${pv.lotsUsed.map((l, i) => `• Batch #${i + 1} (${l.dateStr}): <strong>${fmtQty(l.qty)} ${itm.unit}</strong> @ ₹${l.cost.toFixed(2)} = ₹${l.amount.toFixed(2)}`).join('<br/>')}
             </div>`
          : '';
        previewText.innerHTML = `
          Deducting <strong>${fmtQty(q)} ${itm.unit}</strong>: Total FIFO cost will be <strong>${inr(pv.cost)}</strong> (Avg ₹${pv.effectiveRate.toFixed(2)}/${itm.unit}).<br/>
          New Stock Balance will be <strong style="color:${rem < 0 ? '#be123c' : '#047857'};">${fmtQty(rem)} ${itm.unit}</strong>.
          ${lotsHtml}
          ${rem < 0 ? '<span style="color:#be123c;display:block;margin-top:3px;font-weight:700;">⚠️ Insufficient balance! Negative stock will be logged.</span>' : ''}
        `;
      } else {
        previewText.textContent = `Available Balance: ${fmtQty(itm.storedQty)} ${itm.unit}. (Cost is auto-calculated using FIFO)`;
      }
    }
  };

  itemSelect.addEventListener('change', () => {
    const itm = data.items.find(i => i.sku === itemSelect.value);
    if (itm && costInput) costInput.value = itm.cost || '';
    updatePreview();
  });
  qtyInput.addEventListener('input', updatePreview);
  costInput?.addEventListener('input', () => {
    const q = safeNum(qtyInput.value, 0);
    const c = safeNum(costInput.value, 0);
    if (q > 0) totalInput.value = (q * c).toFixed(2);
  });
  totalInput?.addEventListener('input', () => {
    const q = safeNum(qtyInput.value, 0);
    const tot = safeNum(totalInput.value, 0);
    if (q > 0) costInput.value = (tot / q).toFixed(2);
  });

  document.getElementById('stk-switch-in')?.addEventListener('click', () => updateModalState('IN'));
  document.getElementById('stk-switch-out')?.addEventListener('click', () => updateModalState('OUT'));

  const closeModal = () => { root.innerHTML = ''; };
  document.getElementById('stk-modal-close-btn')?.addEventListener('click', closeModal);
  document.getElementById('stk-modal-cancel')?.addEventListener('click', closeModal);

  // Form submit
  document.getElementById('stk-entry-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sku = itemSelect.value;
    const date = document.getElementById('stk-form-date').value;
    const qty = safeNum(qtyInput.value);
    const notes = document.getElementById('stk-form-notes')?.value;

    if (qty <= 0) return alert('Please enter a valid quantity.');

    if (curMode === 'IN') {
      const costPrice = safeNum(costInput.value);
      if (costPrice <= 0) return alert('Purchase Rate / Price (₹) per unit is required for Stock IN.');
      const supplier = document.getElementById('stk-form-supplier')?.value;
      const updateMasterCost = document.getElementById('stk-form-update-master')?.checked;
      await stockStore.recordIn({ sku, date, qty, costPrice, supplier, notes, updateMasterCost });
    } else {
      const reason = document.getElementById('stk-form-reason')?.value;
      await stockStore.recordOut({ sku, date, qty, reason, notes, allowNegative: true });
    }

    closeModal();
  });
}

// ───────────── FIFO Batch Inspector & Item History Modal ─────────────
function openItemBatchModal(sku) {
  const root = document.getElementById('stk-modal-root');
  if (!root) return;

  const data = stockStore.getData();
  const info = getItemLots(data, sku);
  const itm = data.items.find(i => i.sku === sku);

  root.innerHTML = `
    <div class="stk-modal-backdrop" id="stk-batch-modal">
      <div class="stk-modal-card" style="max-width:780px;width:95%;">
        <div class="stk-modal-head" style="background:#0f172a;color:#fff;">
          <div>
            <h3 class="stk-modal-title" style="color:#fff;">📦 FIFO Inventory Batches &amp; Movement Log</h3>
            <div style="font-size:0.8rem;color:#94a3b8;margin-top:2px;">
              ${info.name} (${info.sku}) · Category: ${itm?.category || 'General'}
            </div>
          </div>
          <button type="button" class="stk-modal-close" id="stk-batch-modal-close" style="color:#fff;">&times;</button>
        </div>

        <div class="stk-modal-body" style="display:flex;flex-direction:column;gap:1.25rem;max-height:75vh;overflow-y:auto;">
          <!-- Summary Strip -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:0.75rem;">
            <div style="background:#f8fafc;padding:0.75rem;border-radius:12px;border:1px solid #e2e8f0;">
              <div style="font-size:0.72rem;color:#64748b;font-weight:700;text-transform:uppercase;">Current Stock</div>
              <div style="font-size:1.2rem;font-weight:900;color:#0f172a;font-family:monospace;">${fmtQty(info.totalQty)} ${info.unit}</div>
            </div>
            <div style="background:#f8fafc;padding:0.75rem;border-radius:12px;border:1px solid #e2e8f0;">
              <div style="font-size:0.72rem;color:#64748b;font-weight:700;text-transform:uppercase;">Total Inventory Value</div>
              <div style="font-size:1.2rem;font-weight:900;color:#047857;font-family:monospace;">${inr(info.totalValue)}</div>
            </div>
            <div style="background:#f8fafc;padding:0.75rem;border-radius:12px;border:1px solid #e2e8f0;">
              <div style="font-size:0.72rem;color:#64748b;font-weight:700;text-transform:uppercase;">FIFO Avg Valuation</div>
              <div style="font-size:1.2rem;font-weight:900;color:#3b82f6;font-family:monospace;">₹ ${info.avgRate.toFixed(2)} / ${info.unit}</div>
            </div>
            <div style="background:#f8fafc;padding:0.75rem;border-radius:12px;border:1px solid #e2e8f0;">
              <div style="font-size:0.72rem;color:#64748b;font-weight:700;text-transform:uppercase;">Active Batches</div>
              <div style="font-size:1.2rem;font-weight:900;color:#7c3aed;font-family:monospace;">${info.activeLots.length} lot(s)</div>
            </div>
          </div>

          <!-- FIFO Explanation Banner -->
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:0.75rem 1rem;font-size:0.82rem;color:#166534;display:flex;align-items:flex-start;gap:0.6rem;">
            <span style="font-size:1.2rem;line-height:1;">ℹ️</span>
            <div>
              <strong>FIFO (First In, First Out) Rule:</strong>
              Jo batch pehle khareeda gaya tha (oldest purchase), kitchen use (OUT) ke waqt sabse pehle wahi batch consume hoga uske purchase rate par. Naya batch purane batch ke khatam hone ke baad consume hota hai.
            </div>
          </div>

          <!-- Section 1: Active Batches Remaining On Hand -->
          <div>
            <h4 style="margin:0 0 0.5rem;font-size:0.95rem;font-weight:800;color:#0f172a;display:flex;align-items:center;gap:0.4rem;">
              <span>📦</span> Active FIFO Batches on Shelf (${info.activeLots.length})
            </h4>
            ${info.activeLots.length === 0
              ? `<div style="padding:1.5rem;text-align:center;background:#f8fafc;border-radius:10px;color:#94a3b8;font-weight:600;">No active stock batches in hand. Stock is 0 or negative.</div>`
              : `
                <div class="stk-table-scroll" style="border:1px solid #e2e8f0;border-radius:10px;">
                  <table class="stk-table">
                    <thead>
                      <tr style="background:#f8fafc;">
                        <th style="font-size:0.75rem;">Batch Queue</th>
                        <th style="font-size:0.75rem;">Received Date</th>
                        <th class="num" style="font-size:0.75rem;">Remaining Qty</th>
                        <th class="num" style="font-size:0.75rem;">Purchase Rate (₹)</th>
                        <th class="num" style="font-size:0.75rem;">Batch Value (₹)</th>
                        <th style="font-size:0.75rem;">Supplier / Source</th>
                        <th style="font-size:0.75rem;text-align:center;">Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${info.activeLots.map((lot, idx) => `
                        <tr style="${idx === 0 ? 'background:#ecfdf5;' : ''}">
                          <td><strong>Batch #${idx + 1}</strong></td>
                          <td style="font-family:monospace;font-size:0.8rem;">${lot.dateStr}</td>
                          <td class="num font-mono" style="font-weight:800;">${fmtQty(lot.qty)} ${info.unit}</td>
                          <td class="num font-mono" style="font-weight:800;color:#047857;">₹ ${lot.cost.toFixed(2)}</td>
                          <td class="num font-mono" style="font-weight:800;">${inr(lot.total)}</td>
                          <td style="font-size:0.8rem;color:#475569;">${lot.supplier || '—'}</td>
                          <td style="text-align:center;">
                            ${idx === 0
                              ? `<span class="stk-pill ok" style="font-size:0.7rem;padding:0.2rem 0.5rem;">⚡ 1st In Line (Next OUT)</span>`
                              : `<span class="stk-pill" style="font-size:0.7rem;padding:0.2rem 0.5rem;background:#e0e7ff;color:#4338ca;">Queue #${idx + 1}</span>`
                            }
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `
            }
          </div>

          <!-- Section 2: Complete Movement Activity Timeline -->
          <div>
            <h4 style="margin:0 0 0.5rem;font-size:0.95rem;font-weight:800;color:#0f172a;display:flex;align-items:center;gap:0.4rem;">
              <span>📜</span> Complete Activity History (IN &amp; OUT Timeline)
            </h4>
            ${info.timeline.length === 0
              ? `<div style="padding:1.5rem;text-align:center;background:#f8fafc;border-radius:10px;color:#94a3b8;font-weight:600;">No movement history recorded yet.</div>`
              : `
                <div class="stk-table-scroll" style="border:1px solid #e2e8f0;border-radius:10px;max-height:280px;">
                  <table class="stk-table">
                    <thead>
                      <tr style="background:#f8fafc;">
                        <th style="font-size:0.75rem;">Date</th>
                        <th style="font-size:0.75rem;">Type</th>
                        <th class="num" style="font-size:0.75rem;">Qty</th>
                        <th class="num" style="font-size:0.75rem;">Rate (₹)</th>
                        <th class="num" style="font-size:0.75rem;">Total (₹)</th>
                        <th style="font-size:0.75rem;">Party / Purpose</th>
                        <th style="font-size:0.75rem;">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${info.timeline.map(m => `
                        <tr>
                          <td style="font-family:monospace;font-size:0.8rem;">${m.date instanceof Date ? m.date.toLocaleDateString('en-GB') : m.date}</td>
                          <td>
                            <span class="stk-pill ${m.type === 'IN' ? 'ok' : 'low'}" style="font-size:0.7rem;padding:0.2rem 0.45rem;">
                              ${m.type === 'IN' ? '📥 IN (Purchase)' : '📤 OUT (Usage)'}
                            </span>
                          </td>
                          <td class="num font-mono" style="font-weight:800;color:${m.type === 'IN' ? '#047857' : '#d97706'};">
                            ${m.type === 'IN' ? '+' : '−'} ${fmtQty(m.qty)} ${info.unit}
                          </td>
                          <td class="num font-mono">₹ ${safeNum(m.rate).toFixed(2)}</td>
                          <td class="num font-mono" style="font-weight:800;color:${m.type === 'IN' ? '#047857' : '#d97706'};">
                            ${m.type === 'IN' ? '+' : '−'} ${inr(m.amount)}
                          </td>
                          <td style="font-size:0.8rem;color:#334155;">${m.party || '—'}</td>
                          <td style="font-size:0.75rem;color:#64748b;">${m.notes || '—'}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `
            }
          </div>
        </div>

        <div class="stk-modal-foot">
          <button type="button" class="stk-btn-subtle" id="stk-batch-modal-ok">Close</button>
        </div>
      </div>
    </div>
  `;

  const close = () => { root.innerHTML = ''; };
  document.getElementById('stk-batch-modal-close')?.addEventListener('click', close);
  document.getElementById('stk-batch-modal-ok')?.addEventListener('click', close);
}

// ───────────── Add / Edit Item Modal ─────────────
function openItemModal(itemId = null) {
  const root = document.getElementById('stk-modal-root');
  if (!root) return;

  const data = stockStore.getData();
  const item = itemId ? data.items.find(i => i.id === itemId) : null;

  root.innerHTML = `
    <div class="stk-modal-backdrop" id="stk-item-modal">
      <div class="stk-modal-card">
        <div class="stk-modal-head" style="background:#4f46e5;color:#fff;">
          <h3 class="stk-modal-title">${item ? '✏️ Edit Catalog Item' : '📦 Add New Item'}</h3>
          <button type="button" class="stk-modal-close" id="stk-item-modal-close">&times;</button>
        </div>

        <form id="stk-item-form">
          <div class="stk-modal-body">
            <div class="stk-form-row">
              <div>
                <label class="stk-label">SKU *</label>
                <input type="text" id="stk-item-sku" class="stk-input" value="${item ? item.sku : `J${String(data.items.length + 1).padStart(3, '0')}`}" required />
              </div>
              <div>
                <label class="stk-label">Category *</label>
                <select id="stk-item-cat" class="stk-select">
                  ${CATEGORIES.map(c => `
                    <option value="${c}" ${item && item.category === c ? 'selected' : ''}>${c}</option>
                  `).join('')}
                </select>
              </div>
            </div>

            <div>
              <label class="stk-label">Item Name *</label>
              <input type="text" id="stk-item-name" class="stk-input" value="${item ? item.name : ''}" required placeholder="e.g. Basmati Rice" />
            </div>

            <div class="stk-form-row">
              <div>
                <label class="stk-label">Unit of Measure *</label>
                <select id="stk-item-unit" class="stk-select">
                  ${['kg', 'g', 'L', 'ml', 'pcs', 'packet', 'box'].map(u => `
                    <option value="${u}" ${item && item.unit === u ? 'selected' : ''}>${u}</option>
                  `).join('')}
                </select>
              </div>
              <div>
                <label class="stk-label">Default Purchase Rate (₹) *</label>
                <input type="number" step="any" min="0.01" id="stk-item-cost" class="stk-input" value="${item ? item.cost : ''}" required placeholder="0.00 (Required)" />
                <span style="font-size:0.72rem;color:#059669;display:block;margin-top:2px;">💡 Required for FIFO valuation &amp; food costing</span>
              </div>
            </div>

            <div class="stk-form-row">
              <div>
                <label class="stk-label">Min Stock Alert Level</label>
                <input type="number" step="any" min="0" id="stk-item-min" class="stk-input" value="${item ? item.min : 5}" />
              </div>
              <div>
                <label class="stk-label">${item ? 'Current Stock Qty' : 'Initial Stock Qty'}</label>
                <input type="number" step="any" id="stk-item-qty" class="stk-input" value="${item ? item.storedQty : 0}" />
              </div>
            </div>

            <div>
              <label class="stk-label">Preferred Supplier</label>
              <input type="text" id="stk-item-supplier" class="stk-input" value="${item ? item.supplier : ''}" placeholder="e.g. Royal Traders" />
            </div>
          </div>

          <div class="stk-modal-foot">
            <button type="button" class="stk-btn-subtle" id="stk-item-cancel">Cancel</button>
            <button type="submit" class="stk-btn-in">Save Item</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const closeModal = () => { root.innerHTML = ''; };
  document.getElementById('stk-item-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('stk-item-cancel')?.addEventListener('click', closeModal);

  document.getElementById('stk-item-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cost = safeNum(document.getElementById('stk-item-cost').value);
    const storedQty = safeNum(document.getElementById('stk-item-qty').value);
    if (cost <= 0) {
      return alert('Default Purchase Rate (₹) is required and must be greater than 0.');
    }
    if (!item && storedQty > 0 && cost <= 0) {
      return alert('Please enter purchase rate (price) for initial stock.');
    }
    await stockStore.saveItem({
      id: item?.id,
      sku: document.getElementById('stk-item-sku').value,
      name: document.getElementById('stk-item-name').value,
      category: document.getElementById('stk-item-cat').value,
      unit: document.getElementById('stk-item-unit').value,
      cost,
      min: safeNum(document.getElementById('stk-item-min').value),
      storedQty,
      supplier: document.getElementById('stk-item-supplier').value
    });
    closeModal();
  });
}

// ───────────── Export Engine ─────────────
function exportExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Excel engine (SheetJS) is loading. Please try again in a moment.');
    return;
  }

  const data = stockStore.getData();
  const period = computePeriod(data, currentWeek.start, currentWeek.end);

  const rows = period.rows.map(r => ({
    'SKU': r.sku,
    'Item Name': r.name,
    'Category': r.category,
    'Unit': r.unit,
    'Rate (INR)': r.rate,
    'Opening Qty': r.openQty,
    'Opening (INR)': r.openValue,
    'Inward Qty (+)': r.inQty,
    'Inward (INR)': r.inValue,
    'Usage Qty (-)': r.outQty,
    'Usage (INR)': r.outValue,
    'Closing Qty': r.closeQty,
    'Closing (INR)': r.closeValue,
    'Status': r.status
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Week_${currentWeek.index}`);
  XLSX.writeFile(wb, `LIMRA_Stock_${currentWeek.key}.xlsx`);
}
