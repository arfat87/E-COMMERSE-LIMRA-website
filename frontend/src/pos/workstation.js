/**
 * =============================================================================
 * LIMRA RESTAURANT POS — WORKSTATION & CART ENGINE (pos/workstation.js)
 * =============================================================================
 * 
 * Provides:
 * 1. POS workstation cart operations (add, remove, quantity update, clear).
 * 2. Real-time billing math (subtotal, GST, discounts, roundoff, delivery fees).
 * 3. Popover controls for discounts, delivery charge, coupons, and kitchen notes.
 * 4. Customer delivery place suggestions & chips.
 * 5. Order detail drawer & tile mode display ergonomics.
 */

import { posState, posEvents } from './state.js';
import { escapeHtml, formatDailyOrderNumber } from './pos-utils.js';
import { showAdminToast } from './audio-alerts.js';
import { calculateOrderBilling, formatBillAmount } from '../lib/billing-engine.js';
import { isComboActiveAndValid, validatePosCoupon } from './catalog-crm.js';

// ── Workstation Table & Type Badges ───────────────────────────────────

export function updatePosTableBadge() {
  if (typeof document === 'undefined') return;
  const badgeText = document.getElementById('pos-table-badge-text');
  const badgeIcon = document.getElementById('pos-table-badge-icon');
  const cartBadge = document.getElementById('pos-cart-type-badge');
  const badgeBtn = document.getElementById('pos-top-table-badge');
  const tblInp = document.getElementById('pos-table-number');
  const posOrderType = posState.getPosOrderType() || 'table';

  let label = 'Select Table';
  let icon = '🪑';
  let title = 'Click to change Table';

  if (posOrderType === 'delivery') {
    label = 'Delivery';
    icon = '🚗';
    title = 'Delivery Order';
  } else if (posOrderType === 'pickup') {
    label = 'Takeaway';
    icon = '🥡';
    title = 'Takeaway Order';
  } else {
    const rawVal = tblInp ? tblInp.value.trim() : '';
    if (rawVal) {
      label = rawVal.toLowerCase().startsWith('table') ? rawVal : `Table ${rawVal}`;
    } else {
      label = 'Select Table';
    }
    icon = '🪑';
    title = 'Click to change Table';
  }

  if (badgeText) badgeText.textContent = label;
  if (badgeIcon) badgeIcon.textContent = icon;
  if (cartBadge) cartBadge.textContent = label;
  if (badgeBtn) badgeBtn.title = title;

  const activeTblDigits = (tblInp && posOrderType === 'table') ? tblInp.value.replace(/\D/g, '') : '';
  document.querySelectorAll('.pos-quick-table-btn').forEach(btn => {
    if (activeTblDigits && btn.dataset.tbl === activeTblDigits) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

export function syncPosOrderTypeState(type) {
  posState.setPosOrderType(type);
  if (typeof document === 'undefined') return;

  document.querySelectorAll('.pos-type-btn').forEach(b => {
    const isSelected = b.dataset.type === type;
    b.className = 'pos-type-btn adm-btn ' + (isSelected ? 'adm-btn-primary' : 'adm-btn-outline');
  });

  const tblField = document.getElementById('pos-table-field');
  const delField = document.getElementById('pos-delivery-field');
  if (tblField) tblField.style.display = type === 'table' ? 'block' : 'none';
  if (delField) delField.style.display = type === 'delivery' ? 'block' : 'none';

  const holdKotGroup = document.getElementById('pos-hold-kot-group');
  if (holdKotGroup) {
    holdKotGroup.style.display = type === 'table' ? 'grid' : 'none';
  }

  const nameStar = document.getElementById('pos-name-req-star');
  const phoneStar = document.getElementById('pos-phone-req-star');
  const custBadge = document.getElementById('pos-cust-req-badge');
  const nameInp = document.getElementById('pos-customer-name');
  const phoneInp = document.getElementById('pos-customer-phone');
  const billBtnLabel = document.getElementById('pos-bill-btn-label');
  const billBtnIcon = document.getElementById('pos-bill-btn-icon');

  if (type === 'delivery') {
    if (nameStar) nameStar.style.display = 'inline';
    if (phoneStar) phoneStar.style.display = 'inline';
    if (custBadge) custBadge.innerHTML = '<span style="color:#ef4444;font-weight:700;">* Required for Delivery</span>';
    if (nameInp) nameInp.placeholder = 'Customer Name (Required for Delivery)';
    if (phoneInp) phoneInp.placeholder = '10-digit Mobile Number (Required)';
    if (billBtnLabel) billBtnLabel.textContent = 'Create Bill (Delivery)';
    if (billBtnIcon) billBtnIcon.textContent = '🚗';
  } else if (type === 'pickup') {
    if (nameStar) nameStar.style.display = 'none';
    if (phoneStar) phoneStar.style.display = 'none';
    if (custBadge) custBadge.innerHTML = '<span style="color:var(--adm-muted);">(Optional for Takeaway)</span>';
    if (nameInp) nameInp.placeholder = 'e.g. Salim Khan (Optional)';
    if (phoneInp) phoneInp.placeholder = 'e.g. 9876543210 (Optional)';
    if (billBtnLabel) billBtnLabel.textContent = 'Create Bill (Pickup)';
    if (billBtnIcon) billBtnIcon.textContent = '🗎';
    if (nameInp) nameInp.classList.remove('pos-input-invalid');
    if (phoneInp) phoneInp.classList.remove('pos-input-invalid');
  } else {
    if (nameStar) nameStar.style.display = 'none';
    if (phoneStar) phoneStar.style.display = 'none';
    if (custBadge) custBadge.innerHTML = '<span style="color:var(--adm-muted);">(Optional for Table)</span>';
    if (nameInp) nameInp.placeholder = 'e.g. Salim Khan (Optional)';
    if (phoneInp) phoneInp.placeholder = 'e.g. 9876543210 (Optional)';
    if (billBtnLabel) billBtnLabel.textContent = 'Create Bill';
    if (billBtnIcon) billBtnIcon.textContent = '🗎';
    if (nameInp) nameInp.classList.remove('pos-input-invalid');
    if (phoneInp) phoneInp.classList.remove('pos-input-invalid');
  }

  updatePosTableBadge();
}

// ── Place Chips & Quick Place Selection ───────────────────────────────

export function renderPosPlaceChips(places = null, selectedPlace = null) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('pos-quick-places-pills');
  if (!container) return;

  const adminPlaces = places || posState.getAdminPlaces() || [];
  const currentSelected = selectedPlace || posState.getPosSelectedPlace();

  if (!adminPlaces || adminPlaces.length === 0) {
    container.innerHTML = '<span style="font-size:0.75rem;color:var(--adm-muted);">No saved places found in database</span>';
    return;
  }

  container.innerHTML = adminPlaces.slice(0, 12).map(p => {
    const charge = parseFloat(p.charge || p.delivery_charge || p.delivery_fee || 0);
    const isSelected = currentSelected && currentSelected.name.toLowerCase() === p.name.toLowerCase();
    return `
      <button type="button" class="adm-btn adm-btn-outline adm-btn-sm pos-place-chip-btn ${isSelected ? 'active' : ''}" data-name="${escapeHtml(p.name)}" data-charge="${charge}" style="font-size:.75rem;padding:.2rem .5rem;border-radius:999px;cursor:pointer;${isSelected ? 'background:#e0e7ff;border-color:#6366f1;color:#4338ca;font-weight:700;' : ''}">
        📍 ${escapeHtml(p.name)} <span style="color:${isSelected ? '#4338ca' : '#059669'};font-weight:700;">(₹${charge})</span>
      </button>
    `;
  }).join('');
}

// ── Cart Operations & Calculation Engine ──────────────────────────────

export function computePosCartSummary(cartItems = null, options = {}) {
  const items = cartItems || posState.getPosCart() || [];
  const discountPct = Math.min(100, Math.max(0, parseFloat(options.discountPct || 0)));
  const deliveryFee = Math.max(0, parseFloat(options.deliveryFee || 0));
  const cgstRate = options.cgstRate ?? 2.5;
  const sgstRate = options.sgstRate ?? 2.5;
  const coupon = options.coupon || null;

  return calculateOrderBilling({
    items,
    deliveryFee,
    discountPct,
    coupon,
    cgstRate,
    sgstRate
  });
}

export function addToPosCart(food, customNote = '') {
  if (!food || typeof food !== 'object') return false;
  if (food.available === false) {
    showAdminToast(`"${food.name || 'Item'}" is currently unavailable.`, 'error');
    return false;
  }
  const isComboFlag = Boolean(food.isCombo || food.is_combo || food.category === 'combo' || String(food.id || '').startsWith('combo-'));
  if (isComboFlag && !isComboActiveAndValid(food)) {
    showAdminToast(`Combo "${food.name || 'Combo'}" is unavailable or expired.`, 'error');
    return false;
  }

  const note = (customNote || food.notes || '').trim();
  const addQty = Math.max(1, parseInt(food.qty, 10) || 1);
  const cart = posState.getPosCart();

  const existing = cart.find(i =>
    ((food.id && i.id === food.id) || i.name.toLowerCase() === food.name.toLowerCase()) &&
    (i.notes || '').trim() === note
  );

  if (existing) {
    existing.qty += addQty;
  } else {
    cart.push({
      id: food.id || null,
      name: food.name,
      price: Number(food.price || 0),
      mrp: Number(food.mrp || 0),
      qty: addQty,
      notes: note,
      isCombo: isComboFlag,
      combo_id: isComboFlag ? (food.combo_id || null) : null,
      comboItems: Array.isArray(food.comboItems) ? food.comboItems : [],
      comboItemsSummary: food.comboItemsSummary || '',
      gst_applicable: food.gst_applicable !== false
    });
  }

  posState.setPosCart(cart);
  return true;
}

export function updatePosCartQuantity(idx, delta) {
  const cart = posState.getPosCart();
  if (typeof idx !== 'number' || !cart[idx]) return;
  const newQty = Number(cart[idx].qty || 1) + Number(delta);
  if (newQty <= 0) {
    cart.splice(idx, 1);
  } else {
    cart[idx].qty = Math.max(1, Math.floor(newQty));
  }
  posState.setPosCart(cart);
}

export function removeFromPosCart(idx) {
  const cart = posState.getPosCart();
  if (typeof idx !== 'number' || !cart[idx]) return;
  cart.splice(idx, 1);
  posState.setPosCart(cart);
}

export function clearPosCart() {
  posState.clearPosCart();
}

// ── Popovers & UI Helpers ─────────────────────────────────────────────

export function closeAllPosExtraPopovers() {
  if (typeof document === 'undefined') return;
  ['discount', 'coupon', 'delivery', 'notes'].forEach(name => {
    const pop = document.getElementById(`pos-popover-${name}`);
    const btn = document.getElementById(`pos-extra-${name}-btn`);
    if (pop) {
      pop.classList.remove('open');
      pop.style.display = 'none';
    }
    if (btn) {
      btn.classList.remove('active');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

export function togglePosExtraPopover(name) {
  if (typeof document === 'undefined') return;
  const pop = document.getElementById(`pos-popover-${name}`);
  const btn = document.getElementById(`pos-extra-${name}-btn`);
  if (!pop) return;
  const isCurrentlyOpen = pop.classList.contains('open') || pop.style.display === 'flex';
  closeAllPosExtraPopovers();
  if (!isCurrentlyOpen) {
    pop.classList.add('open');
    pop.style.display = 'flex';
    if (btn) {
      btn.classList.add('active');
      btn.setAttribute('aria-expanded', 'true');
    }
  }
}

export function togglePosTileMode(mode = null) {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('pos-tile-mode-btn');
  const grid = document.getElementById('pos-food-grid');
  if (!btn || !grid) return;

  const currentMode = btn.dataset.tileMode || 'normal';
  const targetMode = mode || (currentMode === 'normal' ? 'compact' : 'normal');

  btn.dataset.tileMode = targetMode;
  if (targetMode === 'compact') {
    grid.classList.add('compact-tiles');
    btn.innerHTML = '<span>⊞</span> Compact';
    btn.classList.add('active');
  } else {
    grid.classList.remove('compact-tiles');
    btn.innerHTML = '<span>▦</span> Standard';
    btn.classList.remove('active');
  }

  try {
    localStorage.setItem('limra_pos_tile_mode', targetMode);
  } catch (e) {}
}

export function closeOrderDetailDrawer() {
  if (typeof document === 'undefined') return;
  const drawer = document.getElementById('billing-detail-view');
  const backdrop = document.getElementById('billing-detail-drawer-backdrop');
  if (drawer) {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
  }
  if (backdrop) {
    backdrop.classList.remove('open');
    backdrop.style.display = 'none';
  }
}
