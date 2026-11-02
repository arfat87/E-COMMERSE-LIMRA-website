/**
 * =============================================================================
 * LIMRA RESTAURANT POS — KITCHEN DISPLAY SYSTEM (pos/kds.js)
 * =============================================================================
 * 
 * Provides:
 * 1. Single Source of Truth KDS ticket grid and card renderer.
 * 2. Tap-to-strike per-item checkoff with persistent storage.
 * 3. All-day batch production summary rail and dish search.
 * 4. 1-click bump bar actions with historical undo / recall stack.
 * 5. Fullscreen and Dark KDS mode controllers.
 */

import { posState, posEvents } from './state.js';
import { showAdminToast } from './audio-alerts.js';
import { escapeHtml, consolidateOrderItems, formatDailyOrderNumber, parseNotesMetadata } from './pos-utils.js';
import { insforge } from '../lib/insforge.js';

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

export let kitchenFilter = 'all';
export let kdsBumpHistory = [];
export let kdsTallySearchTerm = '';

// External callbacks wired from admin facade
let _printKOTCallback = null;
let _refreshRelatedPanelsCallback = null;

export function setKitchenExternalCallbacks({ printKOT, refreshRelatedPanels }) {
  if (printKOT) _printKOTCallback = printKOT;
  if (refreshRelatedPanels) _refreshRelatedPanelsCallback = refreshRelatedPanels;
}

// Load bump history from sessionStorage
if (typeof sessionStorage !== 'undefined') {
  try {
    const savedBump = sessionStorage.getItem('limra_kds_bump_history');
    if (savedBump) kdsBumpHistory = JSON.parse(savedBump) || [];
  } catch (e) {
    kdsBumpHistory = [];
  }
}

// ── Checkoff Persistence ──────────────────────────────────────────────
export function getKitchenCheckedItems() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem('limra_kds_checked_items');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export function saveKitchenCheckedItems(data) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem('limra_kds_checked_items', JSON.stringify(data));
  } catch (e) {
    console.warn('[KDS Storage Warn]:', e);
  }
}

export function isKitchenItemChecked(orderId, itemIdx) {
  const store = getKitchenCheckedItems();
  return Boolean(store[orderId] && store[orderId][itemIdx]);
}

export function toggleKitchenItemCheckoff(orderId, itemIdx, forceState) {
  const store = getKitchenCheckedItems();
  if (!store[orderId]) store[orderId] = {};
  if (typeof forceState === 'boolean') {
    store[orderId][itemIdx] = forceState;
  } else {
    store[orderId][itemIdx] = !store[orderId][itemIdx];
  }
  saveKitchenCheckedItems(store);
  renderKitchenProductionTally();
  posEvents.emit('kds:item_toggled', { orderId, itemIdx, isChecked: store[orderId][itemIdx] });
  return store[orderId][itemIdx];
}

export function toggleAllKitchenItems(orderId, shouldCheck) {
  const orders = posState.getOrders();
  const order = orders.find(o => String(o.id) === String(orderId));
  if (!order) return;
  const rawItems = posState.getOrderItemsByOrderId(order.id);
  const items = consolidateOrderItems(rawItems);
  const store = getKitchenCheckedItems();
  if (!store[orderId]) store[orderId] = {};
  items.forEach((_, idx) => {
    store[orderId][idx] = shouldCheck;
  });
  saveKitchenCheckedItems(store);
  renderKitchenPanel();
  posEvents.emit('kds:all_items_toggled', { orderId, shouldCheck });
}

export function cleanKitchenCheckedItemsForClosedOrders() {
  const store = getKitchenCheckedItems();
  let modified = false;
  const orders = posState.getOrders();
  const activeIds = new Set(
    orders
      .filter(o => o.ticket_status !== 'CLOSED' && o.ticket_status !== 'CANCELLED' && o.status !== 'delivered' && o.status !== 'cancelled')
      .map(o => String(o.id))
  );
  Object.keys(store).forEach(id => {
    if (!activeIds.has(String(id))) {
      delete store[id];
      modified = true;
    }
  });
  if (modified) saveKitchenCheckedItems(store);
}

// ── Batch Production Summary Rail ─────────────────────────────────────
export function renderKitchenProductionTally() {
  const listEl = $('kitchen-tally-list');
  const totalBadgeEl = $('kitchen-tally-total-qty');
  if (!listEl) return;

  const orders = posState.getOrders();
  const activeOrders = orders.filter(o => {
    if (o.ticket_status === 'CLOSED' || o.ticket_status === 'CANCELLED') return false;
    if (o.status === 'delivered' || o.status === 'cancelled') return false;
    return ['pending', 'confirmed', 'preparing'].includes(o.status);
  });

  const dishTally = {};
  let grandTotalQty = 0;
  let grandRemainingQty = 0;

  activeOrders.forEach(order => {
    const rawItems = posState.getOrderItemsByOrderId(order.id);
    const items = consolidateOrderItems(rawItems);
    items.forEach((item, idx) => {
      const name = item.item_name || 'Unnamed Dish';
      const qty = Number(item.quantity) || 1;
      const isChecked = isKitchenItemChecked(order.id, idx);
      if (!dishTally[name]) {
        dishTally[name] = { totalQty: 0, remainingQty: 0 };
      }
      dishTally[name].totalQty += qty;
      grandTotalQty += qty;
      if (!isChecked) {
        dishTally[name].remainingQty += qty;
        grandRemainingQty += qty;
      }
    });
  });

  if (totalBadgeEl) {
    totalBadgeEl.textContent = `${grandRemainingQty} left / ${grandTotalQty} total`;
    totalBadgeEl.style.background = grandRemainingQty > 15 ? '#fee2e2' : '#dbeafe';
    totalBadgeEl.style.color = grandRemainingQty > 15 ? '#b91c1c' : '#1e40af';
  }

  const entries = Object.entries(dishTally).sort((a, b) => b[1].remainingQty - a[1].remainingQty || b[1].totalQty - a[1].totalQty);
  const search = (kdsTallySearchTerm || '').trim().toLowerCase();
  const filtered = entries.filter(([name]) => !search || name.toLowerCase().includes(search));

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center;padding:1.5rem 0.5rem;color:var(--pos-text-muted,#64748b);font-size:0.8rem;">
        ${search ? 'No matching dishes' : 'No active items to cook'}
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(([name, data]) => {
    const isHighVolume = data.remainingQty >= 5;
    const isDone = data.remainingQty === 0;
    return `
      <div class="kitchen-tally-row ${isDone ? 'done' : ''}" style="${isDone ? 'opacity:0.45;' : ''}">
        <div class="kitchen-tally-row-left" style="display:flex;align-items:center;gap:0.4rem;min-width:0;">
          <span style="font-size:0.9rem;">${isDone ? '✅' : '🍲'}</span>
          <span class="kitchen-tally-dish-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:0.35rem;">
          ${data.totalQty !== data.remainingQty ? `<span style="font-size:0.75rem;color:var(--pos-text-muted,#64748b);font-weight:700;">${data.totalQty - data.remainingQty} done</span>` : ''}
          <span class="kitchen-tally-qty-badge ${isHighVolume ? 'high-volume' : ''}">
            ${data.remainingQty}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

// ── Recall Last Bumped Ticket ─────────────────────────────────────────
export async function recallLastBumpedKitchenOrder() {
  if (!Array.isArray(kdsBumpHistory) || kdsBumpHistory.length === 0) {
    showAdminToast('No recently bumped tickets to recall.', 'info');
    return;
  }

  const lastBump = kdsBumpHistory.pop();
  try {
    sessionStorage.setItem('limra_kds_bump_history', JSON.stringify(kdsBumpHistory));
  } catch (e) {}

  const orders = posState.getOrders();
  const order = orders.find(o => String(o.id) === String(lastBump.orderId));
  const targetStatus = lastBump.previousStatus || 'preparing';

  try {
    const { error } = await insforge.database
      .from('orders')
      .update({ status: targetStatus, updated_at: new Date().toISOString() })
      .eq('id', lastBump.orderId);
    if (error) throw error;

    if (order) {
      order.status = targetStatus;
    }

    const orderNum = order ? formatDailyOrderNumber(order) : lastBump.orderId;
    showAdminToast(`Order #${orderNum} recalled back to ${targetStatus.toUpperCase()}! ↩`, 'success');

    renderKitchenPanel();
    updateKitchenBadges();
    if (typeof _refreshRelatedPanelsCallback === 'function') {
      _refreshRelatedPanelsCallback();
    }
  } catch (err) {
    showAdminToast('Failed to recall ticket: ' + err.message, 'error');
  }
}

// ── Dark Mode & Fullscreen Controls ───────────────────────────────────
export function toggleKitchenDarkMode(force) {
  const panel = $('panel-kitchen');
  if (!panel) return;
  const isDark = typeof force === 'boolean' ? force : !panel.classList.contains('dark-kds');
  panel.classList.toggle('dark-kds', isDark);

  const icon = $('kitchen-dark-icon');
  const label = $('kitchen-dark-label');
  if (icon) icon.textContent = isDark ? '☀️' : '🌙';
  if (label) label.textContent = isDark ? 'Light KDS' : 'Dark KDS';

  try {
    localStorage.setItem('limra_kds_dark_mode', isDark ? 'true' : 'false');
  } catch (e) {}
}

export function toggleKitchenFullscreen() {
  const panel = $('panel-kitchen');
  if (!panel || typeof document === 'undefined') return;
  if (!document.fullscreenElement) {
    if (panel.requestFullscreen) {
      panel.requestFullscreen().catch(err => {
        console.warn('Fullscreen failed:', err);
      });
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(err => {
        console.warn('Exit fullscreen failed:', err);
      });
    }
  }
}

export function toggleKitchenTallyRail() {
  const rail = $('kitchen-production-tally-rail');
  if (rail) {
    rail.classList.toggle('collapsed');
  }
}

// ── Main Kitchen Panel Renderer ───────────────────────────────────────
export function renderKitchenPanel() {
  const container = $('kitchen-kot-container');
  if (!container) return;

  const orders = posState.getOrders();
  const activeKitchenOrders = orders.filter(o => {
    if (o.ticket_status === 'CLOSED' || o.ticket_status === 'CANCELLED') return false;
    if (o.status === 'delivered' || o.status === 'cancelled') return false;
    return ['pending', 'confirmed', 'preparing', 'ready'].includes(o.status);
  });

  // Calculate Urgency Counts
  let urgentCount = 0;
  let warningCount = 0;
  let freshCount = 0;
  const now = Date.now();

  activeKitchenOrders.forEach(o => {
    const elapsed = Math.max(0, Math.floor((now - new Date(o.created_at).getTime()) / 60000));
    if (elapsed >= 20) urgentCount++;
    else if (elapsed >= 10) warningCount++;
    else freshCount++;
  });

  const urgentEl = $('kitchen-urgent-count');
  if (urgentEl) urgentEl.textContent = urgentCount;
  const warningEl = $('kitchen-warning-count');
  if (warningEl) warningEl.textContent = warningCount;
  const freshEl = $('kitchen-fresh-count');
  if (freshEl) freshEl.textContent = freshCount;

  // Update Recall button state
  const recallBtn = $('btn-kitchen-recall');
  if (recallBtn) {
    recallBtn.disabled = !Array.isArray(kdsBumpHistory) || kdsBumpHistory.length === 0;
    recallBtn.title = recallBtn.disabled ? 'No recently bumped tickets to recall' : `Recall last bumped ticket (${kdsBumpHistory.length} available)`;
  }

  // Update badge in kitchen header
  const badge = $('kitchen-active-badge');
  if (badge) {
    badge.textContent = `${activeKitchenOrders.length} Active KOT${activeKitchenOrders.length === 1 ? '' : 's'}`;
    badge.style.background = activeKitchenOrders.length > 0 ? '#fef3c7' : '#ecfdf5';
    badge.style.color = activeKitchenOrders.length > 0 ? '#b45309' : '#059669';
  }

  // Update sidebar badge
  updateKitchenBadges();

  // Filter orders
  const filtered = activeKitchenOrders.filter(o => {
    if (kitchenFilter === 'pending') return o.status === 'pending' || o.status === 'confirmed';
    if (kitchenFilter === 'preparing') return o.status === 'preparing';
    if (kitchenFilter === 'ready') return o.status === 'ready';
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="adm-card adm-empty kitchen-empty-state" style="grid-column:1/-1;padding:2.5rem 1rem;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:0.5rem;">👨‍🍳✨</div>
        <h3 style="font-size:1.1rem;font-weight:800;color:inherit;margin:0 0 .25rem 0;">Kitchen Queue is Clear!</h3>
        <p style="font-size:0.85rem;color:var(--pos-text-muted,#64748b);margin:0;">No active tickets waiting in kitchen. New orders will appear here automatically.</p>
      </div>
    `;
    renderKitchenProductionTally();
    return;
  }

  container.innerHTML = filtered.map(order => {
    const rawItems = posState.getOrderItemsByOrderId(order.id);
    const items = consolidateOrderItems(rawItems);
    const parsedMeta = parseNotesMetadata(order.notes, order);
    const orderNum = formatDailyOrderNumber(order);

    const elapsedMins = Math.max(0, Math.floor((now - new Date(order.created_at).getTime()) / 60000));
    let timerClass = 'green';
    let timerText = `⏱️ ${elapsedMins}m ago`;
    if (elapsedMins >= 20) {
      timerClass = 'red';
      timerText = `🚨 ${elapsedMins}m (Urgent!)`;
    } else if (elapsedMins >= 10) {
      timerClass = 'amber';
      timerText = `⏳ ${elapsedMins}m ago`;
    }

    let typeBadge = '';
    const isTable = parsedMeta.type === 'table' || order.order_type === 'table' || parsedMeta.tableNumber || order.table_number;
    if (isTable) {
      const tNum = parsedMeta.tableNumber || order.table_number || '';
      typeBadge = `<span style="background:#eef2ff;color:#4f46e5;font-size:.78rem;font-weight:900;padding:.2rem .55rem;border-radius:6px;">🪑 Table ${tNum}</span>`;
    } else if (order.order_type === 'delivery' || parsedMeta.type === 'delivery') {
      typeBadge = `<span style="background:#ecfeff;color:#0891b2;font-size:.78rem;font-weight:800;padding:.2rem .55rem;border-radius:6px;">🚗 Delivery</span>`;
    } else {
      typeBadge = `<span style="background:#fef3c7;color:#b45309;font-size:.78rem;font-weight:800;padding:.2rem .55rem;border-radius:6px;">🥡 Pickup</span>`;
    }

    let cardStatusClass = 'pending';
    if (order.status === 'preparing') cardStatusClass = 'preparing';
    else if (order.status === 'ready') cardStatusClass = 'ready';

    let statusLabel = '⏳ NEW TICKET';
    if (order.status === 'preparing') statusLabel = '🔥 COOKING';
    else if (order.status === 'ready') statusLabel = '🍽️ READY';

    let checkedCount = 0;
    const itemsHtml = items.map((i, idx) => {
      const isChecked = isKitchenItemChecked(order.id, idx);
      if (isChecked) checkedCount++;
      return `
        <div class="kot-item-row ${isChecked ? 'kot-item-struck' : ''}" data-order-id="${order.id}" data-item-idx="${idx}" title="Tap to check off cooked dish">
          <button type="button" class="kot-item-checkbox ${isChecked ? 'checked' : ''}" aria-label="Toggle dish preparation status">
            ${isChecked ? '✓' : ''}
          </button>
          <span class="kot-qty-pill">${i.quantity}×</span>
          <div style="flex:1;">
            <div class="kot-item-name">${escapeHtml(i.item_name)}</div>
            ${i.notes ? `<div class="kot-item-note">📝 ${escapeHtml(i.notes)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    const allChecked = items.length > 0 && checkedCount === items.length;

    const kitchenNoteHtml = parsedMeta.cleanNotes ? `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:0.4rem 0.6rem;font-size:0.8rem;color:#b45309;font-weight:700;">
        ⚠️ Note: ${escapeHtml(parsedMeta.cleanNotes)}
      </div>
    ` : '';

    let bumpBtnHtml = '';
    if (order.status === 'pending' || order.status === 'confirmed') {
      bumpBtnHtml = `
        <button type="button" class="kitchen-bump-btn kitchen-bump-prep-btn" data-id="${order.id}" style="background:#3b82f6;color:#fff;">
          👨‍🍳 Start Cooking
        </button>
      `;
    } else if (order.status === 'preparing') {
      bumpBtnHtml = `
        <button type="button" class="kitchen-bump-btn kitchen-bump-ready-btn" data-id="${order.id}" style="background:#10b981;color:#fff;">
          🍽️ Mark Ready
        </button>
      `;
    } else if (order.status === 'ready') {
      bumpBtnHtml = `
        <button type="button" class="kitchen-bump-btn kitchen-bump-served-btn" data-id="${order.id}" style="background:#059669;color:#fff;">
          ✓ Mark Served
        </button>
      `;
    }

    return `
      <div class="kitchen-kot-card ${cardStatusClass}" data-id="${order.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.35rem;">
          <div style="display:flex;align-items:center;gap:.4rem;">
            <span class="kot-card-title" style="font-size:1.05rem;font-weight:900;color:inherit;">KOT #${orderNum}</span>
            ${typeBadge}
          </div>
          <div style="display:flex;align-items:center;gap:0.35rem;">
            <span class="kot-timer-badge ${timerClass}">${timerText}</span>
            <button type="button" class="adm-btn adm-btn-outline kitchen-toggle-all-items-btn" data-id="${order.id}" data-all-checked="${allChecked ? 'true' : 'false'}" style="min-height:30px;min-width:30px;padding:0.15rem 0.45rem;font-size:0.75rem;" title="${allChecked ? 'Unmark all items' : 'Mark all items complete'}">
              ${allChecked ? '✕ Clear' : '✓ All'}
            </button>
            <button type="button" class="adm-btn adm-btn-outline kitchen-reprint-kot-btn" data-id="${order.id}" style="min-height:30px;min-width:30px;padding:0.15rem 0.45rem;font-size:0.8rem;" title="Reprint thermal KOT ticket">
              🖨️
            </button>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.8rem;color:var(--pos-text-muted,#64748b);">
          <span>Guest: <strong style="color:inherit;">${escapeHtml(order.customer_name || 'Dine-in')}</strong></span>
          <span style="font-weight:800;color:${cardStatusClass === 'ready' ? '#10b981' : (cardStatusClass === 'preparing' ? '#3b82f6' : '#d97706')}">${statusLabel}</span>
        </div>

        ${kitchenNoteHtml}

        <div style="flex:1;min-height:80px;max-height:220px;overflow-y:auto;padding-right:2px;">
          ${itemsHtml}
        </div>

        <div style="margin-top:0.25rem;">
          ${bumpBtnHtml}
        </div>
      </div>
    `;
  }).join('');

  // Wire item row click listeners
  container.querySelectorAll('.kot-item-row').forEach(row => {
    row.addEventListener('click', () => {
      const orderId = row.dataset.orderId;
      const itemIdx = Number(row.dataset.itemIdx);
      const isStruck = toggleKitchenItemCheckoff(orderId, itemIdx);
      
      row.classList.toggle('kot-item-struck', isStruck);
      const checkbox = row.querySelector('.kot-item-checkbox');
      if (checkbox) {
        checkbox.classList.toggle('checked', isStruck);
        checkbox.textContent = isStruck ? '✓' : '';
      }

      const card = row.closest('.kitchen-kot-card');
      if (card) {
        const rows = Array.from(card.querySelectorAll('.kot-item-row'));
        const allChecked = rows.every(r => r.classList.contains('kot-item-struck'));
        const toggleAllBtn = card.querySelector('.kitchen-toggle-all-items-btn');
        if (toggleAllBtn) {
          toggleAllBtn.dataset.allChecked = allChecked ? 'true' : 'false';
          toggleAllBtn.textContent = allChecked ? '✕ Clear' : '✓ All';
        }
      }
    });
  });

  // Wire toggle-all button listeners
  container.querySelectorAll('.kitchen-toggle-all-items-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const orderId = btn.dataset.id;
      const allChecked = btn.dataset.allChecked === 'true';
      toggleAllKitchenItems(orderId, !allChecked);
    });
  });

  // Wire bump bar listeners
  container.querySelectorAll('.kitchen-bump-prep-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.id;
      await updateKitchenOrderStatus(orderId, 'preparing', '👨‍🍳 KOT is now Cooking!');
    });
  });

  container.querySelectorAll('.kitchen-bump-ready-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.id;
      await updateKitchenOrderStatus(orderId, 'ready', '🍽️ Food Ready to Serve!');
    });
  });

  container.querySelectorAll('.kitchen-bump-served-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.id;
      await updateKitchenOrderStatus(orderId, 'delivered', '✓ Order marked Served!');
    });
  });

  container.querySelectorAll('.kitchen-reprint-kot-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (typeof _printKOTCallback === 'function') {
        const order = posState.getOrderById(btn.dataset.id);
        if (order) {
          const items = posState.getOrderItemsByOrderId(order.id);
          await _printKOTCallback(order, items, { isReprint: true });
        }
      }
    });
  });

  cleanKitchenCheckedItemsForClosedOrders();
  renderKitchenProductionTally();
}

export async function updateKitchenOrderStatus(orderId, newStatus, toastMsg) {
  try {
    const orders = posState.getOrders();
    const o = orders.find(x => String(x.id) === String(orderId));
    const prevStatus = o ? o.status : 'pending';

    const { error } = await insforge.database
      .from('orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) throw error;

    if (o) o.status = newStatus;

    kdsBumpHistory.push({
      orderId,
      previousStatus: prevStatus,
      bumpedStatus: newStatus,
      timestamp: Date.now()
    });
    if (kdsBumpHistory.length > 10) kdsBumpHistory.shift();
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem('limra_kds_bump_history', JSON.stringify(kdsBumpHistory));
      } catch (e) {}
    }

    showAdminToast(toastMsg, 'success');
    renderKitchenPanel();
    updateKitchenBadges();
    if (typeof _refreshRelatedPanelsCallback === 'function') {
      _refreshRelatedPanelsCallback();
    }
  } catch (err) {
    showAdminToast('Failed to update kitchen status: ' + err.message, 'error');
  }
}

export function updateKitchenBadges() {
  const orders = posState.getOrders();
  const activeKitchen = orders.filter(o => {
    if (o.ticket_status === 'CLOSED' || o.ticket_status === 'CANCELLED') return false;
    if (o.status === 'delivered' || o.status === 'cancelled') return false;
    return ['pending', 'confirmed', 'preparing', 'ready'].includes(o.status);
  });
  const badge = $('pending-kitchen-badge');
  if (badge) {
    if (activeKitchen.length > 0) {
      badge.textContent = activeKitchen.length;
      badge.classList.remove('adm-hidden', 'hidden');
    } else {
      badge.classList.add('adm-hidden');
    }
  }
}

export function setKitchenFilter(filter) {
  kitchenFilter = filter;
  renderKitchenPanel();
}

export function setKdsTallySearchTerm(term) {
  kdsTallySearchTerm = term;
  renderKitchenProductionTally();
}
