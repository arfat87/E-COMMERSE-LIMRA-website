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
let moreMenuOpen = false;

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
            <span>Opening Balance</span>
            <span>Week Start</span>
          </div>
          <div class="stk-kpi-val">${inr(period.totals.openValue)}</div>
          <div class="stk-kpi-foot">${period.totals.openItems} items in stock</div>
        </div>

        <!-- Card 2: Inward Purchases -->
        <div class="stk-card-kpi in">
          <div class="stk-kpi-sub">
            <span style="color:#047857;">+ Purchases (IN)</span>
            <span>+ ${period.totals.inCount} entries</span>
          </div>
          <div class="stk-kpi-val">+ ${inr(period.totals.inValue)}</div>
          <div class="stk-kpi-foot">Total added to inventory</div>
        </div>

        <!-- Card 3: Outward Usage -->
        <div class="stk-card-kpi out">
          <div class="stk-kpi-sub">
            <span style="color:#b45309;">− Kitchen Usage (OUT)</span>
            <span>− ${period.totals.outCount} entries</span>
          </div>
          <div class="stk-kpi-val">− ${inr(period.totals.outValue)}</div>
          <div class="stk-kpi-foot">Consumed (FIFO cost)</div>
        </div>

        <!-- Card 4: Closing Balance -->
        <div class="stk-card-kpi close">
          <div class="stk-kpi-sub">
            <span style="color:#4338ca;">= Closing Balance</span>
            <span>Week End</span>
          </div>
          <div class="stk-kpi-val">${inr(period.totals.closeValue)}</div>
          <div class="stk-kpi-foot">${period.totals.closeItems} items in stock</div>
        </div>

        <!-- Card 5: Current Live Stock -->
        <div class="stk-card-kpi current">
          <div class="stk-kpi-sub">
            <span style="color:#0284c7;">Current Valuation</span>
            <span>Live Today</span>
          </div>
          <div class="stk-kpi-val">${inr(liveValuation)}</div>
          <div class="stk-kpi-foot">Total stock on hand right now</div>
        </div>
      </div>

      <!-- 3. Balance Check Banner -->
      <div class="stk-status-banner ${period.balanced ? 'balanced' : 'discrepancy'}">
        <div>
          ${period.balanced
            ? `<span>✅ <strong>Hisab Balanced:</strong> Opening (${inr(period.totals.openValue)}) + Purchases (${inr(period.totals.inValue)}) − Usage (${inr(period.totals.outValue)}) = Closing (${inr(period.totals.closeValue)})</span>`
            : `<span>⚠️ <strong>Variance Detected:</strong> ₹ ${Math.abs(period.totals.adjustment).toFixed(2)} adjustment difference.</span>`
          }
        </div>
        <div style="font-size:0.75rem;opacity:0.85;">
          ${currentWeek.rangeLabel}
        </div>
      </div>

      <!-- 4. 7-Day Movement Strip -->
      <div class="stk-days-strip">
        ${period.days.map(d => {
          const isToday = d.key === todayKey();
          return `
            <div class="stk-day-card ${isToday ? 'today' : ''}" data-day="${d.key}">
              <div class="stk-day-head">
                <span>${shortDate(d.date)}</span>
                <span style="color:#64748b;">${dayName(d.date)}</span>
              </div>
              <div class="stk-day-in">${d.inValue > 0 ? '+ ' + inr(d.inValue) : '—'}</div>
              <div class="stk-day-out">${d.outValue > 0 ? '− ' + inr(d.outValue) : '—'}</div>
              <div class="stk-day-close">${inr(d.closeValue)}</div>
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

  return `
    <!-- Category Filter Chips -->
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem;">
      <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
        <button type="button" class="stk-pill ${categoryFilter === 'all' ? 'ok' : ''}" data-cat="all" style="cursor:pointer;background:${categoryFilter === 'all' ? '#4f46e5' : '#f1f5f9'};color:${categoryFilter === 'all' ? '#fff' : '#475569'};">All Categories</button>
        ${CATEGORIES.map(c => `
          <button type="button" class="stk-pill" data-cat="${c}" style="cursor:pointer;background:${categoryFilter === c ? '#4f46e5' : '#f1f5f9'};color:${categoryFilter === c ? '#fff' : '#475569'};">
            ${CATEGORY_ICONS[c] || ''} ${c}
          </button>
        `).join('')}
      </div>

      <label style="font-size:0.78rem;font-weight:700;color:#475569;display:flex;align-items:center;gap:0.35rem;cursor:pointer;">
        <input type="checkbox" id="stk-chk-movement" ${movementOnlyFilter ? 'checked' : ''} style="cursor:pointer;" />
        Show only items with activity
      </label>
    </div>

    <!-- Weekly Matrix Table -->
    <div class="stk-table-card">
      <div class="stk-table-scroll">
        <table class="stk-table">
          <thead>
            <tr>
              <th>Item &amp; SKU</th>
              <th>Category</th>
              <th>Unit</th>
              <th class="num">Rate (₹)</th>
              <th class="num">Opening Qty</th>
              <th class="num">Opening (₹)</th>
              <th class="num" style="color:#047857;">+ IN Qty</th>
              <th class="num" style="color:#047857;">+ IN (₹)</th>
              <th class="num" style="color:#b45309;">− OUT Qty</th>
              <th class="num" style="color:#b45309;">− OUT (₹)</th>
              <th class="num" style="color:#4338ca;">Closing Qty</th>
              <th class="num" style="color:#4338ca;">Closing (₹)</th>
              <th style="text-align:center;">Status</th>
              <th style="text-align:center;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0
              ? `<tr><td colspan="14" style="text-align:center;padding:2.5rem;color:#94a3b8;font-weight:600;">No items found matching the selected filters.</td></tr>`
              : filtered.map(r => `
                <tr>
                  <td>
                    <div style="font-weight:800;color:#0f172a;">${r.name}</div>
                    <div style="font-size:0.72rem;font-family:monospace;color:#6366f1;">${r.sku}</div>
                  </td>
                  <td><span class="stk-pill" style="background:#f1f5f9;color:#334155;">${r.category}</span></td>
                  <td style="font-family:monospace;font-size:0.75rem;color:#64748b;">${r.unit}</td>
                  <td class="num font-mono" style="color:#475569;">₹ ${r.rate.toFixed(2)}</td>

                  <!-- Opening -->
                  <td class="num font-mono font-bold">${fmtQty(r.openQty)}</td>
                  <td class="num font-mono" style="color:#64748b;">${inr(r.openValue)}</td>

                  <!-- IN -->
                  <td class="num font-mono font-bold" style="color:#047857;">${r.inQty > 0 ? '+' + fmtQty(r.inQty) : '—'}</td>
                  <td class="num font-mono font-bold" style="color:#047857;">${r.inValue > 0 ? inr(r.inValue) : '—'}</td>

                  <!-- OUT -->
                  <td class="num font-mono font-bold" style="color:#b45309;">${r.outQty > 0 ? '−' + fmtQty(r.outQty) : '—'}</td>
                  <td class="num font-mono font-bold" style="color:#b45309;">${r.outValue > 0 ? inr(r.outValue) : '—'}</td>

                  <!-- Closing -->
                  <td class="num font-mono font-bold" style="color:#4338ca;">${fmtQty(r.closeQty)}</td>
                  <td class="num font-mono font-bold" style="color:#4338ca;">${inr(r.closeValue)}</td>

                  <!-- Status -->
                  <td style="text-align:center;">
                    <span class="stk-pill ${r.status.toLowerCase()}">${r.status}</span>
                  </td>

                  <!-- Actions -->
                  <td style="text-align:center;white-space:nowrap;">
                    <button type="button" class="stk-btn-icon" data-quick-in="${r.sku}" title="Quick IN" style="color:#047857;">+IN</button>
                    <button type="button" class="stk-btn-icon" data-quick-out="${r.sku}" title="Quick OUT" style="color:#b45309;">−OUT</button>
                  </td>
                </tr>
              `).join('')
            }
          </tbody>
          <tfoot>
            <tr>
              <td colspan="5" style="text-transform:uppercase;">Weekly Totals (${filtered.length} Items)</td>
              <td class="num font-mono font-bold">${inr(filtered.reduce((s, r) => s + r.openValue, 0))}</td>
              <td></td>
              <td class="num font-mono font-bold" style="color:#047857;">+ ${inr(filtered.reduce((s, r) => s + r.inValue, 0))}</td>
              <td></td>
              <td class="num font-mono font-bold" style="color:#b45309;">− ${inr(filtered.reduce((s, r) => s + r.outValue, 0))}</td>
              <td></td>
              <td class="num font-mono font-bold" style="color:#4338ca;">${inr(filtered.reduce((s, r) => s + r.closeValue, 0))}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
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

      <div style="display:flex;gap:1rem;font-size:0.85rem;font-weight:700;">
        <span style="color:#047857;">Total IN: + ${inr(totalIn)}</span>
        <span style="color:#b45309;">Total OUT: − ${inr(totalOut)}</span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(420px, 1fr));gap:1rem;">
      <!-- Day IN Entries -->
      <div class="stk-table-card">
        <div style="padding:0.85rem 1.1rem;background:#f0fdf4;border-bottom:1px solid #bbf7d0;display:flex;align-items:center;justify-content:space-between;">
          <strong style="color:#047857;">📥 Stock IN Entries (${dayIns.length})</strong>
          <span style="font-weight:800;font-family:monospace;color:#047857;">+ ${inr(totalIn)}</span>
        </div>
        <div class="stk-table-scroll" style="max-height:400px;">
          <table class="stk-table">
            <thead>
              <tr>
                <th>Item &amp; SKU</th>
                <th class="num">Qty</th>
                <th class="num">Rate</th>
                <th class="num">Total (₹)</th>
                <th style="text-align:center;">Del</th>
              </tr>
            </thead>
            <tbody>
              ${dayIns.length === 0
                ? `<tr><td colspan="5" style="text-align:center;padding:2rem;color:#94a3b8;">No purchase entries on this day.</td></tr>`
                : dayIns.map(e => `
                  <tr>
                    <td>
                      <div style="font-weight:700;">${e.name || e.description}</div>
                      <div style="font-size:0.7rem;font-family:monospace;color:#64748b;">${e.sku} ${e.supplier ? '· ' + e.supplier : ''}</div>
                    </td>
                    <td class="num font-mono font-bold" style="color:#047857;">+${fmtQty(e.qty)} ${e.unit || ''}</td>
                    <td class="num font-mono">₹ ${safeNum(e.rate, 0).toFixed(2)}</td>
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
        <div style="padding:0.85rem 1.1rem;background:#fffbeb;border-bottom:1px solid #fde68a;display:flex;align-items:center;justify-content:space-between;">
          <strong style="color:#b45309;">📤 Stock OUT Entries (${dayOuts.length})</strong>
          <span style="font-weight:800;font-family:monospace;color:#b45309;">− ${inr(totalOut)}</span>
        </div>
        <div class="stk-table-scroll" style="max-height:400px;">
          <table class="stk-table">
            <thead>
              <tr>
                <th>Item &amp; SKU</th>
                <th>Reason</th>
                <th class="num">Qty</th>
                <th class="num">FIFO Value (₹)</th>
                <th style="text-align:center;">Del</th>
              </tr>
            </thead>
            <tbody>
              ${dayOuts.length === 0
                ? `<tr><td colspan="5" style="text-align:center;padding:2rem;color:#94a3b8;">No usage entries on this day.</td></tr>`
                : dayOuts.map(e => `
                  <tr>
                    <td>
                      <div style="font-weight:700;">${e.name || e.description}</div>
                      <div style="font-size:0.7rem;font-family:monospace;color:#64748b;">${e.sku}</div>
                    </td>
                    <td style="font-size:0.75rem;color:#64748b;">${e.usedBy || 'Kitchen Prep'}</td>
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
              <div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0.65rem;border-bottom:1px solid #f1f5f9;font-size:0.8rem;">
                <span style="font-weight:700;">${CATEGORY_ICONS[cat] || ''} ${cat}</span>
                <div style="display:flex;gap:0.75rem;font-family:monospace;">
                  <span style="color:#047857;">+ ${inr(c.inValue)}</span>
                  <span style="color:#b45309;">− ${inr(c.outValue)}</span>
                  <span style="color:#4338ca;font-weight:800;">${inr(c.closeValue)}</span>
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

  // Delete daily entries
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
                  <input type="number" step="any" min="0" id="stk-form-cost" class="stk-input" value="${selectedItem?.cost || ''}" placeholder="0.00" />
                </div>
                <div>
                  <label class="stk-label">Total Cost (₹)</label>
                  <input type="number" step="any" min="0" id="stk-form-total" class="stk-input" placeholder="0.00" />
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
        previewText.innerHTML = `
          Deducting <strong>${fmtQty(q)} ${itm.unit}</strong>: Total FIFO cost will be <strong>${inr(pv.cost)}</strong>.<br/>
          New Balance will be <strong style="color:${rem < 0 ? '#be123c' : '#047857'};">${fmtQty(rem)} ${itm.unit}</strong>.
          ${rem < 0 ? '<span style="color:#be123c;display:block;margin-top:2px;">⚠️ Insufficient balance! Negative stock will be logged.</span>' : ''}
        `;
      } else {
        previewText.textContent = `Available Balance: ${fmtQty(itm.storedQty)} ${itm.unit}.`;
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
                <input type="number" step="any" min="0" id="stk-item-cost" class="stk-input" value="${item ? item.cost : ''}" required placeholder="0.00" />
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
    await stockStore.saveItem({
      id: item?.id,
      sku: document.getElementById('stk-item-sku').value,
      name: document.getElementById('stk-item-name').value,
      category: document.getElementById('stk-item-cat').value,
      unit: document.getElementById('stk-item-unit').value,
      cost: safeNum(document.getElementById('stk-item-cost').value),
      min: safeNum(document.getElementById('stk-item-min').value),
      storedQty: safeNum(document.getElementById('stk-item-qty').value),
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
