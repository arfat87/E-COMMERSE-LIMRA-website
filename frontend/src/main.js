import './style.css';
import { insforge, saveOrder, saveBooking, getCustomerBookings, getCustomerOrders, getMenuOverrides, getCoupons, getCombos, getCustomDishes } from './lib/insforge.js';
import { menuItems, categoryImages, categoryLabels, categoryEmojis, categoryTabOrder } from './data/menu.js';
import { sendEmailNotification, generateOrderPlacedHtml } from './lib/email-service.js';
import { NotificationService } from './lib/notifications.js';
import { initLanguageSystem, applyTranslations, t, getLanguage, setLanguage } from './lib/i18n.js';

let activeCombos = [];
let activeCustomDishes = [];

export function getAllCombinedMenuItems() {
  const formattedCombos = (activeCombos || []).filter(c => c.available !== false).map(c => ({
    id: `combo-${c.id}`,
    name: c.name,
    price: parseFloat(c.price || 0),
    mrp: parseFloat(c.mrp || 0),
    category: 'combo',
    emoji: '🍱',
    image: c.image_url || c.image || '/images/food_biryani.png',
    description: c.description || (Array.isArray(c.items) ? `Includes: ${c.items.map(i => `${i.qty || 1}x ${i.name}`).join(' + ')}` : 'Special Combo Deal'),
    featured: true,
    isCombo: true,
    is_combo: true,
    combo_id: c.id,
    items: c.items || []
  }));
  return [...formattedCombos, ...menuItems, ...(activeCustomDishes || [])];
}

// ═══════════════════════════════════════
// ANTIGRAVITY REACTIVE STORE SYSTEM
// ═══════════════════════════════════════
class AntigravityStore {
  constructor(initialState = {}, storageKey = null) {
    this._state = initialState;
    this._listeners = [];
    this._storageKey = storageKey;

    if (this._storageKey) {
      try {
        const persisted = localStorage.getItem(this._storageKey);
        if (persisted) {
          const parsed = JSON.parse(persisted);
          this._state = { ...this._state, ...parsed };
        }
      } catch (err) {
        console.warn('[Antigravity] Hydration failed:', err);
      }
    }
  }

  get state() {
    return this._state;
  }

  set state(newState) {
    this._state = newState;
    if (this._storageKey) {
      try {
        localStorage.setItem(this._storageKey, JSON.stringify(this._state));
      } catch (err) {
        console.warn('[Antigravity] LocalStorage mirror failed:', err);
      }
    }
    this._listeners.forEach(listener => listener(this._state));
  }

  subscribe(listener) {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  }
}

// ═══════════════════════════════════════
// CART STATE & ANTIGRAVITY STORE SYNC
// ═══════════════════════════════════════
function loadCartFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem('limra-cart') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(item => ({
      id: typeof item.id === 'string' && item.id.startsWith('combo-') ? item.id : (isNaN(Number(item.id)) ? item.id : Number(item.id)),
      name: String(item.name || ''),
      price: Number(item.price) || 0,
      qty: Math.max(1, Number(item.qty) || 1),
    })).filter(item => item.id && item.name);
  } catch {
    return [];
  }
}

const antigravityCartStore = new AntigravityStore({
  items: loadCartFromStorage()
}, 'limra-cart-state');

let cart = antigravityCartStore.state.items;

antigravityCartStore.subscribe((state) => {
  cart = state.items;
  localStorage.setItem('limra-cart', JSON.stringify(cart));
});

let currentMenuCategory = 'all';

// Global Location Badge helper (defined at top level for scope availability)
function updateLocationBadge(verified) {
  const badge = document.getElementById('order-location-badge');
  if (!badge) return;
  if (verified) {
    badge.textContent = '🟢 Location Verified';
    badge.className = 'text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1';
  } else {
    badge.textContent = '🔴 Location Unverified';
    badge.className = 'text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full flex items-center gap-1';
  }
}

function isDeliveryAvailable() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeVal = hours * 60 + minutes;
  // Delivery open from 1:00 PM (13:00) to 10:30 PM (22:30)
  return timeVal >= (13 * 60) && timeVal <= (22 * 60 + 30);
}

// ═══════════════════════════════════════
// DELIVERY STATE
// ═══════════════════════════════════════
const DELIVERY_RATE = 10; // ₹ per km
let isDelivery = isDeliveryAvailable();    // true = delivery, false = self pickup
let deliveryKm = 0;       // km entered by customer
let deliveryMap = null;
let deliveryMarker = null;
let selectedDeliveryArea = ""; // selected place name
const AREA_DELIVERY_CHARGES = {
  'jerthan': 20,
  'kudi': 40,
  'egra': 100,
  'qiya': 20,
  'alangiri': 40,
  'dobandhi': 50,
  'mohanpur': 80,
  'kasba gola': 80,
  'rajnagar': 100,
  'atla': 150,
  'boita': 50
};
let streetLayer = null;
let satelliteLayer = null;
let currentMapLayer = 'street';
let mapSelectedLat = null;
let mapSelectedLng = null;
let mapSelectedAddress = '';

function getDeliveryCharge() {
  if (!isDelivery) return 0;
  if (selectedDeliveryArea && selectedDeliveryArea !== 'custom') {
    return AREA_DELIVERY_CHARGES[selectedDeliveryArea] || 0;
  }
  const km = Math.max(0, parseFloat(deliveryKm) || 0);
  return Math.round(km * DELIVERY_RATE);
}

let appliedCoupon = null; // holds { code, discount_pct, min_bill }

function getCouponDiscountAmount() {
  if (!appliedCoupon) return 0;
  const subtotal = getCartSubtotal();
  if (subtotal < appliedCoupon.min_bill) return 0;
  return Math.round(subtotal * (appliedCoupon.discount_pct / 100));
}

function getTaxesAmount() {
  const subtotal = getCartSubtotal();
  const discount = getCouponDiscountAmount();
  return Math.round(Math.max(0, subtotal - discount) * 0.05); // 5% GST on discounted subtotal
}

function saveCart() {
  localStorage.setItem('limra-cart', JSON.stringify(cart));
}

function getCartSubtotal() {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function getCartTotal() {
  const subtotal = getCartSubtotal();
  const discount = getCouponDiscountAmount();
  const delivery = getDeliveryCharge();
  const taxes = getTaxesAmount();
  return Math.max(0, subtotal - discount) + delivery + taxes;
}

// Micro-interactions & spring animations
function animateBadgePop() {
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  badge.classList.remove('animate-badge-pop');
  void badge.offsetWidth; // trigger reflow
  badge.classList.add('animate-badge-pop');
}

function getCartCount() {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

function addToCart(id) {
  const item = getAllCombinedMenuItems().find(m => String(m.id) === String(id));
  if (!item) return;
  
  const currentItems = [...antigravityCartStore.state.items];
  const existing = currentItems.find(c => String(c.id) === String(id));
  if (existing) {
    existing.qty += 1;
  } else {
    currentItems.push({ id: item.id, name: item.name, price: item.price, qty: 1 });
  }
  antigravityCartStore.state = { items: currentItems };
  updateCartUI();
  animateBadgePop();

  // Trigger targeted menu card and button spring bounce micro-interaction
  const btn = document.querySelector(`.add-btn[data-id="${id}"]`);
  if (btn) {
    btn.classList.remove('animate-btn-spring');
    void btn.offsetWidth; // trigger reflow
    btn.classList.add('animate-btn-spring');
    btn.addEventListener('animationend', () => {
      btn.classList.remove('animate-btn-spring');
    }, { once: true });

    const card = btn.closest('.menu-card');
    if (card) {
      card.classList.remove('animate-card-spring');
      void card.offsetWidth; // trigger reflow
      card.classList.add('animate-card-spring');
      card.addEventListener('animationend', () => {
        card.classList.remove('animate-card-spring');
      }, { once: true });
    }
  }
}

function removeFromCart(id) {
  const currentItems = antigravityCartStore.state.items.filter(c => String(c.id) !== String(id));
  antigravityCartStore.state = { items: currentItems };
  updateCartUI();
  animateBadgePop();
}

function updateQty(id, delta) {
  const currentItems = [...antigravityCartStore.state.items];
  const item = currentItems.find(c => String(c.id) === String(id));
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    removeFromCart(id);
    return;
  }
  antigravityCartStore.state = { items: currentItems };
  updateCartUI();
  animateBadgePop();
}

function clearCart() {
  appliedCoupon = null;
  const couponInput = document.getElementById('cart-coupon-input');
  if (couponInput) couponInput.value = '';
  const couponStatus = document.getElementById('cart-coupon-status');
  if (couponStatus) {
    couponStatus.textContent = '';
    couponStatus.classList.add('hidden');
  }
  antigravityCartStore.state = { items: [] };
  updateCartUI();
  animateBadgePop();
}

// ═══════════════════════════════════════
// TOAST NOTIFICATION SYSTEM
// ═══════════════════════════════════════
function showToast(message, type = 'info', duration = 3200) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  const remove = () => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  const timer = setTimeout(remove, duration);
  toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

function renderCardActionButton(container, itemId, qty, isAvailable = true) {
  if (!container) return;
  if (!isAvailable) {
    container.innerHTML = `<button class="add-btn" disabled style="background:#e2e8f0; color:#94a3b8; border:none; cursor:not-allowed">+ Sold Out</button>`;
    return;
  }
  if (qty > 0) {
    container.innerHTML = `
      <div class="card-stepper-btn" onclick="event.stopPropagation()">
        <button type="button" class="card-stepper-op" data-action="minus" data-id="${itemId}" aria-label="Decrease quantity">−</button>
        <span class="card-stepper-val">${qty}</span>
        <button type="button" class="card-stepper-op" data-action="plus" data-id="${itemId}" aria-label="Increase quantity">+</button>
      </div>
    `;
    const minusBtn = container.querySelector('[data-action="minus"]');
    const plusBtn = container.querySelector('[data-action="plus"]');
    if (minusBtn) minusBtn.onclick = (e) => { e.stopPropagation(); updateQty(itemId, -1); };
    if (plusBtn) plusBtn.onclick = (e) => { e.stopPropagation(); updateQty(itemId, 1); };
  } else {
    container.innerHTML = `<button type="button" class="add-btn tap-active" data-id="${itemId}">+ Add</button>`;
    const addBtn = container.querySelector('.add-btn');
    if (addBtn) addBtn.onclick = (e) => { e.stopPropagation(); addToCart(itemId); };
  }
}

function updateCartUI() {
  const count = getCartCount();
  const subtotal = getCartSubtotal();

  // Auto-remove coupon if subtotal drops below minimum order value
  if (appliedCoupon && subtotal < appliedCoupon.min_bill) {
    const oldCode = appliedCoupon.code;
    const oldMinBill = appliedCoupon.min_bill;
    appliedCoupon = null;
    const input = document.getElementById('cart-coupon-input');
    if (input) input.value = '';
    const status = document.getElementById('cart-coupon-status');
    if (status) {
      status.textContent = `Coupon ${oldCode} removed (min order ₹${oldMinBill} not met)`;
      status.className = 'text-[10px] font-bold text-red-500 block';
      status.classList.remove('hidden');
    }
  }

  const discount = getCouponDiscountAmount();
  const delivery = getDeliveryCharge();
  const taxes = getTaxesAmount();
  const total = getCartTotal();

  // Render Discount Row
  const discRow = document.getElementById('cart-discount-row-3');
  const discPctSpan = document.getElementById('cart-discount-pct-3');
  const discValSpan = document.getElementById('cart-discount-3');
  if (discRow) {
    if (discount > 0) {
      discRow.classList.remove('hidden');
      if (discPctSpan) discPctSpan.textContent = appliedCoupon.discount_pct;
      if (discValSpan) discValSpan.textContent = discount;
    } else {
      discRow.classList.add('hidden');
    }
  }

  // Header & Floating Badges
  const badge = document.getElementById('cart-badge');
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }
  const viewBadge = document.getElementById('view-cart-badge');
  if (viewBadge) viewBadge.textContent = count;

  const viewCartBtn = document.getElementById('view-cart-btn');
  if (viewCartBtn) {
    viewCartBtn.classList.toggle('hidden', count === 0);
  }

  // Sync Bottom Navigation Cart Badge
  const bottomBadge = document.getElementById('bottom-nav-cart-badge');
  if (bottomBadge) {
    bottomBadge.textContent = count;
    bottomBadge.classList.toggle('hidden', count === 0);
  }

  // Sync Floating App Quick Cart Pill
  const floatingBar = document.getElementById('floating-cart-bar');
  if (floatingBar) {
    if (count > 0) {
      floatingBar.classList.add('visible');
      const countEl = document.getElementById('floating-cart-count');
      const amtEl = document.getElementById('floating-cart-amount');
      if (countEl) countEl.textContent = `${count} ${count === 1 ? 'ITEM' : 'ITEMS'} IN CART`;
      if (amtEl) amtEl.textContent = `₹${total.toFixed(2)}`;
    } else {
      floatingBar.classList.remove('visible');
    }
  }

  // Toggle Checkout form visibility based on cart count
  const formFields = document.getElementById('checkout-form-fields');
  if (formFields) {
    formFields.classList.toggle('hidden', count === 0);
  }
  
  const cartEmpty = document.getElementById('cart-empty');
  if (cartEmpty) {
    cartEmpty.classList.toggle('hidden', count > 0);
  }

  // Step 3 Breakdown
  const sub3 = document.getElementById('cart-subtotal-3');
  if (sub3) sub3.textContent = subtotal;
  const del3 = document.getElementById('cart-delivery-charge-3');
  if (del3) del3.textContent = delivery;
  const tax3 = document.getElementById('cart-taxes-3');
  if (tax3) tax3.textContent = taxes;
  const tot3 = document.getElementById('cart-total-3');
  if (tot3) tot3.textContent = total;
  
  const delRow3 = document.getElementById('delivery-charge-row-3');
  if (delRow3) {
    delRow3.style.display = isDelivery ? '' : 'none';
  }

  // Step 5 Confirmation Breakdown
  const confSub = document.getElementById('confirm-subtotal');
  if (confSub) confSub.textContent = subtotal;
  const confDel = document.getElementById('confirm-delivery-charge');
  if (confDel) confDel.textContent = delivery;
  const confTax = document.getElementById('confirm-taxes');
  if (confTax) confTax.textContent = taxes;
  const confTot = document.getElementById('confirm-total');
  if (confTot) confTot.textContent = total;
  
  const confDelRow = document.getElementById('confirm-delivery-charge-row');
  if (confDelRow) {
    confDelRow.style.display = isDelivery ? '' : 'none';
  }

  // Items list
  renderCartItems();

  // Update all card buttons and in-card steppers across active menu grids
  document.querySelectorAll('.menu-card').forEach(card => {
    const actionWrap = card.querySelector('.menu-card-action-wrap');
    const itemId = card.dataset.id || card.querySelector('[data-id]')?.dataset?.id;
    if (!itemId) return;
    const cartItem = cart.find(c => String(c.id) === String(itemId));
    const qty = cartItem ? cartItem.qty : 0;
    if (actionWrap) {
      renderCardActionButton(actionWrap, itemId, qty, true);
    }
  });
}

function renderCartItems() {
  const container = document.getElementById('cart-items');
  // Clear existing item rows
  const existingRows = container.querySelectorAll('.cart-row');
  existingRows.forEach(r => r.remove());

  cart.forEach(item => {
    const el = document.createElement('div');
    el.className = 'cart-row flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50/80 border border-slate-100 shadow-sm';
    el.innerHTML = `
      <div class="flex items-center gap-2.5 flex-1 min-w-0">
        <span class="text-sm font-bold truncate text-slate-800">${item.name}</span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <div class="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-0.5 shadow-xs">
          <button class="qty-btn-minus w-6 h-6 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-slate-100 rounded" data-id="${item.id}">−</button>
          <span class="text-xs font-bold w-5 text-center text-slate-800">${item.qty}</span>
          <button class="qty-btn-plus w-6 h-6 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-slate-100 rounded" data-id="${item.id}">+</button>
        </div>
        <span class="text-xs font-bold text-slate-800 w-14 text-right">₹${item.price * item.qty}</span>
        <button class="cart-remove-btn text-slate-400 hover:text-red-500 p-1 transition-colors" data-id="${item.id}" aria-label="Remove item">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    `;

    el.querySelector('.qty-btn-minus').addEventListener('click', () => updateQty(item.id, -1));
    el.querySelector('.qty-btn-plus').addEventListener('click', () => updateQty(item.id, 1));
    el.querySelector('.cart-remove-btn').addEventListener('click', () => removeFromCart(item.id));

    container.appendChild(el);
  });
}

function animateBadge() {
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  badge.classList.remove('anim-pop');
  void badge.offsetWidth;
  badge.classList.add('anim-pop');
}

// Build WhatsApp order message
function buildOrderMessage() {
  const subtotal = getCartSubtotal();
  const delivery = getDeliveryCharge();
  const total = getCartTotal();

  let msg = '🛒 *NEW ORDER — LIMRA Restaurant*\n';
  msg += '═══════════════════════\n\n';

  cart.forEach(item => {
    msg += `• *${item.name}* x ${item.qty} = ₹${item.price * item.qty}\n`;
  });

  msg += '\n═══════════════════════\n';
  msg += `*Subtotal:* ₹${subtotal}\n`;

  if (appliedCoupon) {
    const discAmt = getCouponDiscountAmount();
    msg += `*Discount (${appliedCoupon.code} - ${appliedCoupon.discount_pct}%):* -₹${discAmt}\n`;
  }

  if (isDelivery) {
    msg += `*Delivery Fee:* ₹${delivery}\n`;
    msg += `*Grand Total: ₹${total}*\n`;
    const address = document.getElementById('order-address')?.value.trim();
    if (address) msg += `\n\n📍 *Deliver to:* ${address}`;
  } else {
    msg += `\n*Total: ₹${subtotal}* (Self Pickup — Free)`;
  }
  msg += '\n\nPlease confirm my order. Thank you! 🙏';
  return encodeURIComponent(msg);
}

// ═══════════════════════════════════════
// RENDER MENU CARDS (Premium Swiggy/Zomato Style)
// ═══════════════════════════════════════
function createMenuCard(item) {
  const imgSrc = item.image || categoryImages[item.category] || '/images/food_biryani.png';
  const card = document.createElement('article');
  card.className = 'menu-card';
  card.dataset.category = item.category;
  card.dataset.id = item.id;
  card.setAttribute('role', 'listitem');

  const isAvailable = item.available !== false;
  if (!isAvailable) {
    card.style.opacity = '0.65';
    card.style.filter = 'grayscale(20%)';
  }

  // Badges
  const isCombo = item.isCombo || item.category === 'combo' || (typeof item.id === 'string' && item.id.startsWith('combo-'));
  const discountBadge = item.discount
    ? `<span class="card-discount-badge">${item.discount}% OFF</span>`
    : '';
  const bestsellerRibbon = isCombo
    ? `<span class="bestseller-ribbon" style="background:linear-gradient(135deg, #f59e0b, #d97706); color:#0f172a; font-weight:800;">🍱 Combo Pack</span>`
    : (item.featured ? `<span class="bestseller-ribbon">⭐ Bestseller</span>` : '');

  // Veg/Non-veg indicator
  const isVeg = item.veg === true || item.type === 'veg';
  const vegDot = isCombo
    ? `<span class="text-sm mr-1 shrink-0">🍱</span>`
    : `<div class="food-type-icon ${isVeg ? '' : 'non-veg'}" title="${isVeg ? 'Veg' : 'Non-Veg'}" style="flex-shrink:0;margin-right:3px"></div>`;

  // Price display
  const mrpLine = item.mrp && parseFloat(item.mrp) > parseFloat(item.price)
    ? `<span class="menu-card-price-old">₹${item.mrp}</span>`
    : '';

  card.innerHTML = `
    <div class="menu-card-img-wrap">
      <div class="w-full bg-neutral-100 animate-pulse" style="aspect-ratio:4/3;border-radius:0">
        <img src="${imgSrc}" alt="${item.name} — LIMRA Restaurant" class="card-img" loading="lazy" width="400" height="300"
          onload="this.parentElement.classList.remove('animate-pulse','bg-neutral-100')" onerror="this.src='/images/food_biryani.png'; this.parentElement.classList.remove('animate-pulse','bg-neutral-100');" />
      </div>
      ${bestsellerRibbon}
      ${discountBadge}
    </div>
    <div class="menu-card-body">
      <div class="flex items-start gap-1">
        ${vegDot}
        <h3 class="menu-card-name flex-1">${item.name}</h3>
      </div>
      ${item.description ? `<p class="menu-card-desc">${item.description}</p>` : ''}
      <div class="menu-card-footer">
        <div class="flex items-baseline flex-wrap gap-1">
          <span class="menu-card-price">₹${item.price}</span>
          ${mrpLine}
        </div>
        <div class="menu-card-action-wrap"></div>
      </div>
    </div>
  `;

  const actionWrap = card.querySelector('.menu-card-action-wrap');
  const cartItem = cart.find(c => String(c.id) === String(item.id));
  const currentQty = cartItem ? cartItem.qty : 0;
  renderCardActionButton(actionWrap, item.id, currentQty, isAvailable);

  card.style.cursor = 'pointer';
  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-stepper-btn') || e.target.closest('.add-btn') || e.target.closest('.menu-card-action-wrap')) return;
    openProductDetailModal(item.id);
  });

  return card;
}

// Category aliases to support group categories, story bubbles, and legacy names
export const categoryAliases = {
  // Combos & Deals
  'combo': ['combo'],
  'combos': ['combo'],
  'deals': ['combo'],

  // Tandoor & Kabab
  'tandoori': ['tandoor-kabab'],
  'tandoor': ['tandoor-kabab'],
  'kababs': ['tandoor-kabab'],
  'kebab': ['tandoor-kabab'],
  'kebabs': ['tandoor-kabab'],
  'tandoor-kabab': ['tandoor-kabab'],
  
  // Chinese & Noodles
  'chinese': ['chinese-veg', 'chinese-nonveg', 'noodles'],
  'chinese-veg': ['chinese-veg'],
  'chinese-nonveg': ['chinese-nonveg'],
  'noodles': ['noodles'],
  'noodle': ['noodles'],
  
  // Fried Rice & Rice
  'rice': ['veg-rice', 'nonveg-rice'],
  'fried-rice': ['veg-rice', 'nonveg-rice'],
  'veg-rice': ['veg-rice'],
  'nonveg-rice': ['nonveg-rice'],
  
  // Curries / Gravies
  'curries': ['veg-curry', 'nonveg-curry'],
  'curry': ['veg-curry', 'nonveg-curry'],
  'gravy': ['veg-curry', 'nonveg-curry'],
  'gravies': ['veg-curry', 'nonveg-curry'],
  'veg-curry': ['veg-curry'],
  'nonveg-curry': ['nonveg-curry'],
  
  // Starters
  'starters': ['veg-starters', 'nonveg-starters'],
  'starter': ['veg-starters', 'nonveg-starters'],
  'veg-starters': ['veg-starters'],
  'nonveg-starters': ['nonveg-starters'],
  
  // Soups
  'soups': ['soup'],
  'soup': ['soup'],
  
  // Breads / Naan & Roti
  'breads': ['bread'],
  'bread': ['bread'],
  'naan': ['bread'],
  'roti': ['bread'],
  
  // Biryani
  'biryani': ['biryani'],
  
  // Thali
  'thali': ['thali'],
  
  // Desserts
  'dessert': ['desserts'],
  'desserts': ['desserts'],
  'sweets': ['desserts'],
  
  // Salads & Papad
  'salads': ['salads'],
  'salad': ['salads'],
  
  // Momos & Chaat
  'momos': ['momos-chaat'],
  'chaat': ['momos-chaat'],
  'momos-chaat': ['momos-chaat'],
  
  // Beverages & Drinks
  'drinks': ['juices', 'lassi', 'milkshakes', 'mocktails', 'beverages'],
  'beverages': ['beverages'],
  'juices': ['juices'],
  'lassi': ['lassi'],
  'milkshakes': ['milkshakes'],
  'mocktails': ['mocktails']
};

function renderMenuGrid(containerId, category = 'all', searchQuery = '') {
  const grid = document.getElementById(containerId);
  if (!grid) return;

  grid.innerHTML = '';
  grid.classList.add('visible');
  grid.setAttribute('aria-busy', 'true');

  const allItems = getAllCombinedMenuItems();
  let filtered = [];
  if (category === 'all') {
    filtered = allItems;
  } else if (category === 'featured') {
    filtered = allItems.filter(m => m.featured === true);
  } else if (category === 'combo') {
    filtered = allItems.filter(m => m.category === 'combo' || m.isCombo);
  } else {
    const matchCats = categoryAliases[category] || [category];
    filtered = allItems.filter(m => matchCats.includes(m.category));
  }

  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(item => 
      (item.name || '').toLowerCase().includes(q) || 
      (item.category || '').toLowerCase().includes(q) ||
      (item.description || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = '<p class="col-span-full text-center py-12 text-sm" style="color:var(--color-text-muted)">No dishes found in this category.</p>';
    grid.setAttribute('aria-busy', 'false');
    return;
  }

  filtered.forEach((item, index) => {
    const card = createMenuCard(item);
    card.classList.add('reveal');
    card.style.transitionDelay = `${Math.min(index * 35, 350)}ms`;
    grid.appendChild(card);
  });

  grid.setAttribute('aria-busy', 'false');
  observeRevealElements(grid);
  updateCartUI();
}

// ═══════════════════════════════════════
// MENU & ORDER FILTER TABS
// ═══════════════════════════════════════
function syncTabActiveState(activeCategory) {
  const matchCats = categoryAliases[activeCategory] || [activeCategory];
  let matched = false;

  document.querySelectorAll('.tab-btn').forEach(t => {
    const tabCat = t.dataset.category;
    let isActive = false;
    if (tabCat === activeCategory) {
      isActive = true;
    } else if (activeCategory === 'all' && tabCat === 'all') {
      isActive = true;
    } else if (activeCategory === 'featured' && tabCat === 'featured') {
      isActive = true;
    } else if (matchCats.includes(tabCat) && !matched) {
      isActive = true;
      matched = true;
    }
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  // Scroll active tab into view horizontally inside category scroll container
  const activeTab = document.querySelector('[data-tab-bar="order"] .tab-btn.active');
  if (activeTab) {
    activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function buildCategoryTabButtons() {
  const tabsHtml = [
    '<button type="button" class="tab-btn" data-category="featured">⭐ Specials</button>',
    '<button type="button" class="tab-btn active" data-category="all">All</button>',
    ...categoryTabOrder.map(cat => {
      const emoji = categoryEmojis[cat] || '';
      const label = categoryLabels[cat] || cat;
      return `<button type="button" class="tab-btn" data-category="${cat}">${emoji} ${label}</button>`;
    }),
  ].join('');

  document.querySelectorAll('[data-tab-bar]').forEach(bar => {
    bar.innerHTML = tabsHtml;
  });
}

function initMenuTabs() {
  buildCategoryTabButtons();
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.setAttribute('aria-pressed', tab.classList.contains('active') ? 'true' : 'false');
    tab.addEventListener('click', () => {
      const cat = tab.dataset.category;
      currentMenuCategory = cat;
      syncTabActiveState(cat);
      
      const foodSearchInput = document.getElementById('food-search-input');
      const query = foodSearchInput ? foodSearchInput.value : '';
      
      renderMenuGrid('menu-grid', cat, query);
      renderMenuGrid('order-grid', cat, query);
    });
  });

  // Story bubble category quick filters
  document.querySelectorAll('[data-story-cat]').forEach(bubble => {
    bubble.addEventListener('click', (e) => {
      const cat = bubble.dataset.storyCat;
      if (!cat) return;
      currentMenuCategory = cat;

      // Clear search so category dishes are fully shown
      const foodSearchInput = document.getElementById('food-search-input');
      if (foodSearchInput) foodSearchInput.value = '';
      const clearBtn = document.getElementById('btn-clear-food-search');
      if (clearBtn) clearBtn.style.display = 'none';
      const dropdown = document.getElementById('search-dropdown');
      if (dropdown) dropdown.classList.remove('visible');

      syncTabActiveState(cat);
      renderMenuGrid('menu-grid', cat);
      renderMenuGrid('order-grid', cat);

      const orderSection = document.getElementById('order');
      if (orderSection) {
        orderSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Promo slide category CTAs
  document.querySelectorAll('[data-promo-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.promoCat;
      if (!cat) return;
      currentMenuCategory = cat;

      const foodSearchInput = document.getElementById('food-search-input');
      if (foodSearchInput) foodSearchInput.value = '';
      const clearBtn = document.getElementById('btn-clear-food-search');
      if (clearBtn) clearBtn.style.display = 'none';

      syncTabActiveState(cat);
      renderMenuGrid('menu-grid', cat);
      renderMenuGrid('order-grid', cat);

      const orderSection = document.getElementById('order');
      if (orderSection) {
        orderSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}


// ═══════════════════════════════════════
// CART DRAWER
// ═══════════════════════════════════════
function openCart() {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-overlay');
  drawer.classList.remove('closed');
  drawer.classList.add('open');
  overlay.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('opacity-100'), 10);
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-overlay');
  drawer.classList.add('closed');
  drawer.classList.remove('open');
  overlay.classList.remove('opacity-100');
  setTimeout(() => overlay.classList.add('hidden'), 350);
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════
// BOOKING TABS
// ═══════════════════════════════════════
function initBookingTabs() {
  const tabs = document.querySelectorAll('.booking-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('active', 'bg-brand-gold', 'text-brand-dark');
        t.classList.add('text-brand-muted');
      });
      tab.classList.add('active', 'bg-brand-gold', 'text-brand-dark');
      tab.classList.remove('text-brand-muted');
      // Hide all panels
      document.querySelectorAll('.booking-panel').forEach(p => p.classList.add('hidden'));
      // Show selected
      document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
    });
  });
}

// ═══════════════════════════════════════
// BOOKING FORMS → DATABASE (admin dashboard)
// ═══════════════════════════════════════
const WA_NUMBER = '919739083418';

function submitToWhatsApp(message) {
  const url = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}

// ═══════════════════════════════════════
// SUCCESS CONFIRMATION MODAL LOGIC
// ═══════════════════════════════════════
function showSuccessModal({ title, message, emailUrl }) {
  const modal = document.getElementById('success-notification-modal');
  const content = document.getElementById('success-modal-content');
  const titleEl = document.getElementById('success-modal-title');
  const msgEl = document.getElementById('success-modal-msg');
  const emailBtn = document.getElementById('success-modal-email-btn');
  const closeBtn = document.getElementById('success-modal-close-btn');

  if (!modal || !content) return;

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;

  if (emailBtn) {
    const newEmailBtn = emailBtn.cloneNode(true);
    emailBtn.parentNode.replaceChild(newEmailBtn, emailBtn);
    newEmailBtn.addEventListener('click', () => {
      if (emailUrl) window.open(emailUrl, '_blank');
    });
  }

  if (closeBtn) {
    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    newCloseBtn.addEventListener('click', () => closeModal());
  }

  const closeModal = () => {
    modal.classList.add('opacity-0', 'pointer-events-none');
    content.classList.remove('scale-100');
    content.classList.add('scale-95');
  };

  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };

  // Show modal
  modal.classList.remove('opacity-0', 'pointer-events-none');
  content.classList.remove('scale-95');
  content.classList.add('scale-100');
}

function buildBookingPayload(type, data, extra = {}) {
  const email = data.email?.trim() || '';
  const emailNote = email ? `[EMAIL: ${email}]` : '';
  const bookingNotes = [data.notes || '', emailNote].filter(Boolean).join(' | ');
  
  return {
    type,
    customer_name: String(data.name || '').trim(),
    customer_phone: String(data.phone || '').trim(),
    booking_date: data.date || null,
    booking_time: data.time || null,
    guests: data.guests ? parseInt(data.guests, 10) : null,
    preference: data.preference || null,
    seat_label: extra.seat || null,
    event_type: data.event || null,
    budget: data.budget || null,
    catering: data.catering || null,
    venue: data.venue || null,
    message: data.message || null,
    notes: bookingNotes || null,
    status: 'pending',
  };
}

function setBookingStatus(form, message, isError = false) {
  const el = form.querySelector('.booking-status-msg');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  el.style.color = isError ? 'var(--color-red-badge)' : 'var(--color-accent)';
  el.style.background = isError ? '#fdecea' : 'var(--color-accent-bg)';
}

function clearBookingStatus(form) {
  const el = form.querySelector('.booking-status-msg');
  if (el) el.classList.add('hidden');
}

async function handleBookingSubmit(form, type, getExtra = () => ({})) {
  clearBookingStatus(form);

  const data = Object.fromEntries(new FormData(form));
  if (!data.name?.trim() || !data.phone?.trim()) {
    setBookingStatus(form, 'Please enter your name and phone number.', true);
    return;
  }
  
  const email = data.email?.trim() || '';
  if (email && !email.includes('@')) {
    setBookingStatus(form, 'Please enter a valid email address.', true);
    return;
  }

  const btn = form.querySelector('.booking-submit-btn') || form.querySelector('button[type="submit"]');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const result = await saveBooking(buildBookingPayload(type, data, getExtra()));
    const ref = result?.booking_number ? `Booking #${result.booking_number}` : 'Booking';
    setBookingStatus(form, `✓ ${ref} received! We will confirm by phone soon.`);

    const extra = getExtra();
    const guests = data.guests || '';
    const date = data.date || '';
    const time = data.time || '';

    // Email (mailto) Link
    const emailSubject = `Booking Confirmed successfully! - SK Arif (${ref})`;
    const emailBody = `Dear Restaurant Management,\n\nI have successfully submitted a booking enquiry on your website.\n\nBooking Details:\n---------------------------------------------\nReference: ${ref}\nName: ${data.name}\nPhone: ${data.phone}\nEmail: ${email}\nType: ${BOOKING_TYPE_LABELS[type] || type}\nDate: ${date || '—'}\nTime: ${time || '—'}\nGuests: ${guests || '—'}${extra.seat ? `\nSelected Table: ${extra.seat}` : ''}\n---------------------------------------------\n\nMy reservation is booked. Please contact me as soon as possible to confirm.\n\nBest regards,\n${data.name}`;
    const emailUrl = `mailto:limrarestaurant99@gmail.com?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

    // Show Success Modal
    showSuccessModal({
      title: `${ref} Booked Successfully!`,
      message: `Your booking has been successfully recorded in our system. We look forward to welcoming you to LIMRA Restaurant!`,
      emailUrl
    });

    form.reset();
    if (type === 'table') {
      document.getElementById('seat-selected-msg')?.classList.add('hidden');
      const label = document.getElementById('seat-selected-label');
      if (label) label.textContent = '';
    }

    setTimeout(() => clearBookingStatus(form), 8000);
  } catch (err) {
    console.error('Booking error:', err);
    const detail = err?.message || 'Please try again or call 097390 83418.';
    setBookingStatus(form, `Booking failed: ${detail}`, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

const BOOKING_TYPE_LABELS = {
  table: '🪑 Table',
  party: '🎉 Party',
  wedding: '💍 Wedding',
};

const BOOKING_STATUS_LABELS = {
  pending: 'Pending confirmation',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function initCustomerBookingLookup() {
  const form = document.getElementById('check-booking-form');
  const resultEl = document.getElementById('customer-bookings-result');
  if (!form || !resultEl) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = new FormData(form).get('phone')?.toString().trim();
    if (!phone) return;

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Searching...';
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = '<p class="text-sm" style="color:var(--color-text-muted)">Loading...</p>';

    try {
      const list = await getCustomerBookings(phone);
      if (!list.length) {
        resultEl.innerHTML = '<p class="text-sm p-3 rounded-xl" style="background:var(--color-surface); color:var(--color-text-muted)">No bookings found for this number. Submit a new booking above.</p>';
        return;
      }

      resultEl.innerHTML = list.map(b => `
        <div class="p-4 rounded-xl border" style="background:var(--color-white); border-color:var(--color-border)">
          <div class="flex flex-wrap justify-between gap-2 mb-2">
            <span class="font-semibold text-sm">Booking #${b.booking_number}</span>
            <span class="text-xs font-bold px-2 py-1 rounded-full" style="background:var(--color-accent-bg); color:var(--color-accent)">${BOOKING_STATUS_LABELS[b.status] || b.status}</span>
          </div>
          <p class="text-sm" style="color:var(--color-text-secondary)">${BOOKING_TYPE_LABELS[b.type] || b.type} · ${b.customer_name}</p>
          <p class="text-xs mt-1" style="color:var(--color-text-muted)">
            ${b.booking_date ? `Date: ${b.booking_date}` : ''}${b.booking_time ? ` · ${b.booking_time}` : ''}${b.guests ? ` · ${b.guests} guests` : ''}${b.seat_label ? ` · Seat ${b.seat_label}` : ''}
          </p>
        </div>
      `).join('');
    } catch (err) {
      console.error(err);
      resultEl.innerHTML = `<p class="text-sm" style="color:var(--color-red-badge)">${err.message || 'Could not load bookings.'}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Check bookings';
    }
  });
}

function initBookingForms() {
  const tableForm = document.getElementById('table-booking-form');
  tableForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const seat = document.getElementById('seat-selected-label')?.textContent || '';
    handleBookingSubmit(tableForm, 'table', () => ({
      seat: seat && seat !== 'Not selected' ? seat : null,
    }));
  });

  const partyForm = document.getElementById('party-booking-form');
  partyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleBookingSubmit(partyForm, 'party');
  });

  const weddingForm = document.getElementById('wedding-booking-form');
  weddingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleBookingSubmit(weddingForm, 'wedding');
  });
}

// ═══════════════════════════════════════
// TABLE SEAT SELECTION
// ═══════════════════════════════════════
function initSeatSelection() {
  const seats = document.querySelectorAll('.seat');
  let selectedSeat = null;

  seats.forEach(seat => {
    seat.addEventListener('click', () => {
      if (selectedSeat) {
        selectedSeat.classList.remove('ring-2', 'ring-brand-gold', 'scale-110', 'brightness-125');
      }
      if (selectedSeat === seat) {
        selectedSeat = null;
        document.getElementById('seat-selected-msg').classList.add('hidden');
        return;
      }
      selectedSeat = seat;
      seat.classList.add('ring-2', 'ring-brand-gold', 'scale-110');

      const label = seat.dataset.seat;
      const type = label.startsWith('O') ? 'Outdoor' : 'Indoor';
      document.getElementById('seat-selected-label').textContent = `Table ${label} (${type})`;
      document.getElementById('seat-selected-msg').classList.remove('hidden');

      // Update form preference
      const prefSelect = document.querySelector('#table-booking-form select[name="preference"]');
      if (prefSelect) {
        prefSelect.value = type === 'Outdoor' ? 'Outdoor' : 'Indoor';
      }
    });
  });
}

// ═══════════════════════════════════════
// GALLERY FILTER + LIGHTBOX
// ═══════════════════════════════════════
function initGallery() {
  const filters = document.querySelectorAll('.gal-filter');
  const items = document.querySelectorAll('.gallery-item');

  filters.forEach(filter => {
    filter.addEventListener('click', () => {
      filters.forEach(f => f.classList.remove('active'));
      filter.classList.add('active');

      const cat = filter.dataset.filter;
      items.forEach(item => {
        if (cat === 'all' || item.dataset.category === cat) {
          item.style.display = '';
          setTimeout(() => item.style.opacity = '1', 10);
        } else {
          item.style.opacity = '0';
          setTimeout(() => item.style.display = 'none', 300);
        }
      });
    });
  });

  // Lightbox
  const lightbox = document.getElementById('lightbox');
  const lbImg = document.getElementById('lb-img');
  const lbLabel = document.getElementById('lb-label');
  let galleryItems = Array.from(items);
  let currentIdx = 0;

  function openLightbox(idx) {
    currentIdx = idx;
    const item = galleryItems[idx];
    lbImg.src = item.dataset.src;
    lbLabel.textContent = item.dataset.label;
    lightbox.classList.remove('hidden');
    setTimeout(() => lightbox.classList.add('opacity-100'), 10);
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.classList.remove('opacity-100');
    setTimeout(() => lightbox.classList.add('hidden'), 300);
    document.body.style.overflow = '';
  }

  function showPrev() {
    const visibleItems = galleryItems.filter(i => i.style.display !== 'none');
    const visIdx = visibleItems.indexOf(galleryItems[currentIdx]);
    const prev = visibleItems[(visIdx - 1 + visibleItems.length) % visibleItems.length];
    currentIdx = galleryItems.indexOf(prev);
    lbImg.src = prev.dataset.src;
    lbLabel.textContent = prev.dataset.label;
  }

  function showNext() {
    const visibleItems = galleryItems.filter(i => i.style.display !== 'none');
    const visIdx = visibleItems.indexOf(galleryItems[currentIdx]);
    const next = visibleItems[(visIdx + 1) % visibleItems.length];
    currentIdx = galleryItems.indexOf(next);
    lbImg.src = next.dataset.src;
    lbLabel.textContent = next.dataset.label;
  }

  items.forEach((item, idx) => {
    item.addEventListener('click', () => openLightbox(idx));
  });

  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  document.getElementById('lb-prev').addEventListener('click', showPrev);
  document.getElementById('lb-next').addEventListener('click', showNext);
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });

  document.addEventListener('keydown', (e) => {
    if (lightbox.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') showPrev();
    if (e.key === 'ArrowRight') showNext();
  });
}

// ═══════════════════════════════════════
// SCROLL ANIMATIONS
// ═══════════════════════════════════════
let revealObserver = null;

function initScrollAnimations() {
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  observeRevealElements(document);
}

function observeRevealElements(root) {
  if (!revealObserver || !root) return;
  root.querySelectorAll('.reveal, .reveal-l, .reveal-r').forEach(el => {
    if (el.classList.contains('menu-product-grid')) return;
    if (el.dataset.revealObserved) return;
    el.dataset.revealObserved = '1';
    if (isElementInViewport(el)) {
      el.classList.add('visible');
      return;
    }
    revealObserver.observe(el);
  });
}

function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
}

// ═══════════════════════════════════════
// STICKY HEADER
// ═══════════════════════════════════════
function initHeader() {
  const header = document.getElementById('site-header');
  const navLinks = document.querySelectorAll('.nav-link');
  const sections = ['home', 'about', 'menu', 'order', 'booking', 'gallery', 'visit'];

  window.addEventListener('scroll', () => {
    // Scroll effect
    if (window.scrollY > 50) {
      header.classList.add('header-scrolled');
    } else {
      header.classList.remove('header-scrolled');
    }

    // Active nav
    let current = 'home';
    sections.forEach(id => {
      const section = document.getElementById(id);
      if (section && window.scrollY >= section.offsetTop - 120) {
        current = id;
      }
    });
    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.add('active');
      }
    });

    // Back to top
    const btt = document.getElementById('back-to-top');
    if (window.scrollY > 400) {
      btt.classList.remove('opacity-0', 'pointer-events-none');
      btt.classList.add('opacity-100');
    } else {
      btt.classList.add('opacity-0', 'pointer-events-none');
      btt.classList.remove('opacity-100');
    }
  });
}

// ═══════════════════════════════════════
// MOBILE NAV
// ═══════════════════════════════════════
function initMobileNav() {
  const btn = document.getElementById('hamburger-btn');
  const nav = document.getElementById('mobile-nav');
  let open = false;

  btn.addEventListener('click', () => {
    open = !open;
    nav.classList.toggle('hidden', !open);
    const b1 = document.getElementById('hb1');
    const b2 = document.getElementById('hb2');
    const b3 = document.getElementById('hb3');
    if (open) {
      b1.style.transform = 'rotate(45deg) translate(4px, 5px)';
      b2.style.opacity = '0';
      b3.style.transform = 'rotate(-45deg) translate(4px, -5px)';
    } else {
      b1.style.transform = ''; b2.style.opacity = '1'; b3.style.transform = '';
    }
  });

  document.querySelectorAll('.mobile-nav-link').forEach(link => {
    link.addEventListener('click', () => {
      open = false;
      nav.classList.add('hidden');
      const b1 = document.getElementById('hb1');
      const b2 = document.getElementById('hb2');
      const b3 = document.getElementById('hb3');
      b1.style.transform = ''; b2.style.opacity = '1'; b3.style.transform = '';
    });
  });
}

// ═══════════════════════════════════════
// SMOOTH SCROLL FOR ANCHOR LINKS
// ═══════════════════════════════════════
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (href === '#') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

// ═══════════════════════════════════════
// BACK TO TOP
// ═══════════════════════════════════════
function initBackToTop() {
  const btn = document.getElementById('back-to-top');
  if (btn) {
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

// ═══════════════════════════════════════
// NATIVE APP BOTTOM NAVIGATION DOCK & SYNC
// ═══════════════════════════════════════
function initBottomNav() {
  const navTabs = document.querySelectorAll('.bottom-nav-tab');
  const floatingCart = document.getElementById('floating-cart-bar');
  const bottomCartBtn = document.getElementById('bottom-nav-cart-btn');

  if (floatingCart) {
    floatingCart.addEventListener('click', () => openCart());
  }
  if (bottomCartBtn) {
    bottomCartBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openCart();
    });
  }

  // Active section tracking on scroll
  const sections = ['home', 'order', 'booking', 'social-hub', 'gallery', 'about', 'visit'];
  const sectionEls = sections.map(id => document.getElementById(id)).filter(Boolean);

  if ('IntersectionObserver' in window && sectionEls.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          const activeTarget = (id === 'menu') ? 'order' : id;
          
          // Update Bottom Nav Active State
          navTabs.forEach(tab => {
            if (tab.dataset.target) {
              tab.classList.toggle('active', tab.dataset.target === activeTarget);
            }
          });

          // Update Desktop Top Nav Active State
          document.querySelectorAll('#site-header nav a.nav-link').forEach(link => {
            const href = link.getAttribute('href')?.replace('#', '');
            link.classList.toggle('active', href === activeTarget || href === id);
          });
        }
      });
    }, { threshold: 0.2, rootMargin: '-10% 0px -40% 0px' });

    sectionEls.forEach(el => observer.observe(el));
  }
}

// ═══════════════════════════════════════
// PROMO CAROUSEL
// ═══════════════════════════════════════
function initPromoCarousel() {
  const track = document.getElementById('promo-track');
  const dots = document.querySelectorAll('#promo-dots .promo-dot');
  const slides = document.querySelectorAll('#promo-track .promo-slide');
  const prevBtn = document.getElementById('promo-prev');
  const nextBtn = document.getElementById('promo-next');
  if (!track || slides.length === 0) return;

  let current = 0;
  let autoTimer = null;
  let touchStartX = 0;
  let isAnimating = false;

  const goTo = (idx) => {
    if (isAnimating) return;
    isAnimating = true;
    slides[current].classList.remove('active');
    current = (idx + slides.length) % slides.length;
    slides[current].classList.add('active');
    track.style.transform = `translateX(-${current * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === current));
    setTimeout(() => { isAnimating = false; }, 460);
  };

  const startAuto = () => {
    autoTimer = setInterval(() => goTo(current + 1), 4200);
  };
  const stopAuto = () => clearInterval(autoTimer);

  if (prevBtn) prevBtn.addEventListener('click', () => { stopAuto(); goTo(current - 1); startAuto(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { stopAuto(); goTo(current + 1); startAuto(); });

  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const idx = parseInt(dot.dataset.idx, 10);
      stopAuto(); goTo(idx); startAuto();
    });
  });

  // Touch/swipe support
  track.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; stopAuto(); }, { passive: true });
  track.addEventListener('touchend', (e) => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) goTo(diff > 0 ? current + 1 : current - 1);
    startAuto();
  });

  // Pause when off-screen
  if ('IntersectionObserver' in window) {
    const carousel = document.getElementById('promo-carousel');
    if (carousel) {
      const obs = new IntersectionObserver(([entry]) => {
        entry.isIntersecting ? startAuto() : stopAuto();
      }, { threshold: 0.3 });
      obs.observe(carousel);
    }
  } else {
    startAuto();
  }
}

// ═══════════════════════════════════════
// ZOMATO-STYLE LIVE SEARCH DROPDOWN
// ═══════════════════════════════════════
function initSearchDropdown() {
  const input = document.getElementById('food-search-input');
  const clearBtn = document.getElementById('btn-clear-food-search');
  const dropdown = document.getElementById('search-dropdown');
  if (!input || !dropdown) return;

  let debounceTimer = null;
  const { categoryLabels: catLabels } = { categoryLabels: window._catLabels || {} };

  const renderDropdown = (query) => {
    query = query.trim().toLowerCase();
    dropdown.innerHTML = '';
    if (!query || query.length < 2) {
      dropdown.classList.remove('visible');
      return;
    }
    const results = menuItems.filter(item =>
      item.available !== false &&
      (item.name.toLowerCase().includes(query) ||
       (item.description || '').toLowerCase().includes(query) ||
       (item.category || '').toLowerCase().includes(query))
    ).slice(0, 10);

    if (results.length === 0) {
      dropdown.innerHTML = `<div class="search-no-results">😔 No dishes found for "<strong>${query}</strong>"</div>`;
    } else {
      results.forEach(item => {
        const imgSrc = item.image || categoryImages[item.category] || '/images/food_biryani.png';
        const cartItem = cart.find(c => Number(c.id) === Number(item.id));
        const inCart = cartItem && cartItem.qty > 0;
        const row = document.createElement('div');
        row.className = 'search-result-row';
        row.setAttribute('role', 'option');
        row.innerHTML = `
          <img src="${imgSrc}" alt="${item.name}" class="search-result-img" loading="lazy" />
          <div class="search-result-info">
            <div class="search-result-name">${item.name}</div>
            <div class="search-result-cat">${item.category || ''}</div>
          </div>
          <span class="search-result-price">₹${item.price}</span>
          <button class="search-result-add" data-id="${item.id}">${inCart ? `In Cart (${cartItem.qty})` : '+ Add'}</button>
        `;
        const addBtn = row.querySelector('.search-result-add');
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          addToCart(Number(item.id));
          addBtn.textContent = `In Cart (${(cart.find(c => Number(c.id) === Number(item.id))?.qty || 0)})`;
          addBtn.style.background = 'var(--color-accent)';
          addBtn.style.color = '#fff';
        });
        row.addEventListener('click', () => {
          dropdown.classList.remove('visible');
          input.value = '';
          if (clearBtn) clearBtn.style.display = 'none';
          openProductDetailModal(item.id);
        });
        dropdown.appendChild(row);
      });
    }
    dropdown.classList.add('visible');
  };

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const val = input.value;
    if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
    // Also update the main menu grid filter
    renderMenuGrid('order-grid', currentMenuCategory, val);
    debounceTimer = setTimeout(() => renderDropdown(val), 180);
  });

  clearBtn && clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    dropdown.classList.remove('visible');
    renderMenuGrid('order-grid', currentMenuCategory, '');
    input.focus();
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.zomato-search-wrap')) {
      dropdown.classList.remove('visible');
    }
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) dropdown.classList.add('visible');
  });
}

// ═══════════════════════════════════════
// STICKY CATEGORY TAB BAR
// ═══════════════════════════════════════
function initStickyTabBar() {
  const bar = document.getElementById('sticky-cat-bar');
  if (!bar) return;
  const observer = new IntersectionObserver(
    ([entry]) => bar.classList.toggle('stuck', !entry.isIntersecting),
    { rootMargin: `-${56}px 0px 0px 0px`, threshold: 0 }
  );
  // Observe a sentinel above the bar (the order section heading)
  const orderSection = document.getElementById('order');
  if (orderSection) observer.observe(orderSection);
}

// ═══════════════════════════════════════
// PAYMENT TILE SELECTOR
// ═══════════════════════════════════════
function initPaymentTiles() {
  const codTile = document.getElementById('pay-tile-cod');
  const onlineTile = document.getElementById('pay-tile-online');
  if (!codTile || !onlineTile) return;

  const selectTile = (selectedTile, otherTile, radioVal) => {
    selectedTile.classList.add('selected');
    otherTile.classList.remove('selected');
    const radio = selectedTile.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
    const otherRadio = otherTile.querySelector('input[type="radio"]');
    if (otherRadio) otherRadio.checked = false;
  };

  codTile.addEventListener('click', () => selectTile(codTile, onlineTile, 'cod'));
  onlineTile.addEventListener('click', () => selectTile(onlineTile, codTile, 'online'));
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
function initSearchableDeliveryArea() {
  const select = document.getElementById('order-delivery-area');
  if (!select) return;

  // Hide the native select
  select.style.display = 'none';

  // Check if our custom dropdown wrapper already exists (to avoid duplicate insertion on hot reloads)
  let wrapper = document.getElementById('searchable-delivery-area-wrapper');
  if (wrapper) {
    wrapper.remove();
  }

  wrapper = document.createElement('div');
  wrapper.id = 'searchable-delivery-area-wrapper';
  wrapper.className = 'relative w-full';

  // Trigger button/bar
  const trigger = document.createElement('div');
  trigger.className = 'cart-input flex items-center justify-between cursor-pointer py-2.5 px-3 bg-white border border-slate-200 rounded-xl text-slate-800 text-xs font-semibold shadow-sm transition-all duration-200 hover:border-slate-300';
  trigger.innerHTML = `
    <span id="searchable-area-trigger-label" class="truncate">-- Select Area / Village --</span>
    <svg class="w-3.5 h-3.5 text-slate-400 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
  `;

  // Dropdown panel
  const dropdown = document.createElement('div');
  dropdown.className = 'absolute left-0 right-0 mt-1.5 p-2 bg-white border border-slate-100 rounded-2xl shadow-xl z-50 hidden transition-all duration-200 scale-95 opacity-0';
  dropdown.style.transformOrigin = 'top';

  // Search input
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = '🔍 Search place name...';
  searchInput.className = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-slate-300 mb-2';

  // Options list container
  const optionsList = document.createElement('div');
  optionsList.className = 'max-h-48 overflow-y-auto space-y-0.5';

  dropdown.appendChild(searchInput);
  dropdown.appendChild(optionsList);
  wrapper.appendChild(trigger);
  wrapper.appendChild(dropdown);

  // Insert wrapper right after the native select
  select.parentNode.insertBefore(wrapper, select.nextSibling);

  // Toggle dropdown state
  let isOpen = false;
  function openDropdown() {
    isOpen = true;
    dropdown.classList.remove('hidden');
    // Force reflow
    dropdown.offsetHeight;
    dropdown.classList.remove('scale-95', 'opacity-0');
    dropdown.classList.add('scale-100', 'opacity-100');
    const arrowSvg = trigger.querySelector('svg');
    if (arrowSvg) arrowSvg.style.transform = 'rotate(180deg)';
    searchInput.focus();
  }

  function closeDropdown() {
    isOpen = false;
    dropdown.classList.remove('scale-100', 'opacity-100');
    dropdown.classList.add('scale-95', 'opacity-0');
    const arrowSvg = trigger.querySelector('svg');
    if (arrowSvg) arrowSvg.style.transform = 'rotate(0deg)';
    setTimeout(() => {
      if (!isOpen) dropdown.classList.add('hidden');
    }, 200);
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen) closeDropdown();
    else openDropdown();
  });

  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      closeDropdown();
    }
  });

  // Re-populate options based on search query
  function populateOptions(filter = '') {
    const options = Array.from(select.options);
    optionsList.innerHTML = '';

    const matching = options.filter(opt => {
      if (!opt.value) return filter === ''; // Always show first option only when empty filter
      return opt.text.toLowerCase().includes(filter.toLowerCase());
    });

    if (matching.length === 0) {
      optionsList.innerHTML = `<div class="text-center py-3 text-[11px] text-slate-400 font-medium">No places match search</div>`;
      return;
    }

    matching.forEach(opt => {
      const optEl = document.createElement('div');
      optEl.className = 'px-3 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors duration-150 hover:bg-slate-50 text-slate-700';
      if (opt.value === select.value) {
        optEl.className += ' bg-emerald-50 text-emerald-600 hover:bg-emerald-50';
      }
      optEl.textContent = opt.text;
      optEl.addEventListener('click', () => {
        select.value = opt.value;
        const label = document.getElementById('searchable-area-trigger-label');
        if (label) label.textContent = opt.text;
        
        // Trigger select change event to fire native listener
        select.dispatchEvent(new Event('change'));
        closeDropdown();
      });
      optionsList.appendChild(optEl);
    });
  }

  searchInput.addEventListener('input', () => {
    populateOptions(searchInput.value);
  });

  // Observe select value changes from outside (e.g. prefill from address book)
  const observer = new MutationObserver(() => {
    const selectedOpt = select.options[select.selectedIndex];
    const label = document.getElementById('searchable-area-trigger-label');
    if (label && selectedOpt) {
      label.textContent = selectedOpt.text;
    }
  });
  observer.observe(select, { attributes: true, childList: true, characterData: true, subtree: true });
  
  // Also track value property programmatic writes
  const originalValueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  Object.defineProperty(select, 'value', {
    set: function(val) {
      originalValueSetter.call(this, val);
      const selectedOpt = this.options[this.selectedIndex];
      const label = document.getElementById('searchable-area-trigger-label');
      if (label && selectedOpt) {
        label.textContent = selectedOpt.text;
      }
    },
    get: function() {
      return Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').get.call(this);
    }
  });

  // Initial populate
  populateOptions();
}

let databaseDeliveryAreas = [];

async function loadDeliveryAreas() {
  try {
    const { data, error } = await insforge.database.from('delivery_areas').select('*').order('name', { ascending: true });
    if (!error && data && data.length > 0) {
      databaseDeliveryAreas = data;
      
      // Update AREA_DELIVERY_CHARGES dynamically
      data.forEach(item => {
        AREA_DELIVERY_CHARGES[item.name.toLowerCase()] = Number(item.charge);
      });
      
      // Update index.html dropdown options
      const select = document.getElementById('order-delivery-area');
      if (select) {
        select.innerHTML = '<option value="">-- Select Area / Village --</option>' + 
          data.map(item => `<option value="${item.name.toLowerCase()}">${item.name}</option>`).join('') +
          '<option value="custom">Other / Custom Location</option>';
        
        // Initialize custom searchable select wrapper
        initSearchableDeliveryArea();
      }
    }
  } catch (err) {
    console.warn('[Website] Failed to load delivery areas from database:', err);
  }
}

let activeMenuOverrides = [];

async function loadCombos() {
  try {
    const combos = await getCombos();
    activeCombos = combos || [];
  } catch (err) {
    console.warn('[Website] Failed to load combos from database:', err);
  }
}

async function loadCustomDishes() {
  try {
    const dishes = await getCustomDishes();
    activeCustomDishes = dishes || [];
  } catch (err) {
    console.warn('[Website] Failed to load custom dishes from database:', err);
  }
}

async function loadMenuOverridesAndApply() {
  try {
    activeMenuOverrides = await getMenuOverrides();
    // Apply overrides to static menuItems
    menuItems.forEach(item => {
      const override = activeMenuOverrides.find(o => o.id === item.id);
      if (override) {
        if (override.price !== null && override.price !== undefined) item.price = parseFloat(override.price);
        if (override.mrp !== null && override.mrp !== undefined) item.mrp = parseFloat(override.mrp);
        if (override.available !== undefined) item.available = override.available;
        if (override.featured !== undefined) item.featured = override.featured;
        if (override.description !== undefined) item.description = override.description;
      } else {
        item.available = true;
        item.featured = false;
        item.description = '';
      }
    });
  } catch (err) {
    console.error('Failed to load menu overrides:', err);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  initScrollAnimations();

  // Load database delivery areas, combos, custom dishes, and menu overrides before rendering grids
  await loadDeliveryAreas();
  await loadCombos();
  await loadCustomDishes();
  await loadMenuOverridesAndApply();

  renderMenuGrid('menu-grid', 'all');
  renderMenuGrid('order-grid', 'all');

  // Food Search
  const foodSearchInput = document.getElementById('food-search-input');
  const clearFoodSearchBtn = document.getElementById('btn-clear-food-search');
  if (foodSearchInput) {
    foodSearchInput.addEventListener('input', () => {
      const query = foodSearchInput.value;
      if (clearFoodSearchBtn) {
        if (query) clearFoodSearchBtn.classList.remove('hidden');
        else clearFoodSearchBtn.classList.add('hidden');
      }
      renderMenuGrid('menu-grid', currentMenuCategory, query);
      renderMenuGrid('order-grid', currentMenuCategory, query);
    });
  }
  if (clearFoodSearchBtn && foodSearchInput) {
    clearFoodSearchBtn.addEventListener('click', () => {
      foodSearchInput.value = '';
      clearFoodSearchBtn.classList.add('hidden');
      renderMenuGrid('menu-grid', currentMenuCategory, '');
      renderMenuGrid('order-grid', currentMenuCategory, '');
    });
  }

  updateCartUI();

  // Cart drawer
  document.getElementById('cart-toggle-btn').addEventListener('click', openCart);
  document.getElementById('cart-close-btn').addEventListener('click', closeCart);
  document.getElementById('cart-overlay').addEventListener('click', closeCart);
  document.getElementById('cart-clear-btn').addEventListener('click', clearCart);
  document.getElementById('view-cart-btn').addEventListener('click', openCart);
  document.getElementById('cart-browse-btn')?.addEventListener('click', closeCart);

  // ── Leaflet Delivery Map & Distance Logic (Modal-based) ────────────────
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const toRad = x => (x * Math.PI) / 180;
    const R = 6371; // km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function openMapModal() {
    const modal = document.getElementById('delivery-map-modal');
    const content = document.getElementById('delivery-map-modal-content');
    if (!modal || !content) return;
    modal.classList.remove('opacity-0', 'pointer-events-none');
    content.classList.remove('scale-95');
    content.classList.add('scale-100');
    initDeliveryMap();
  }

  function closeMapModal() {
    const modal = document.getElementById('delivery-map-modal');
    const content = document.getElementById('delivery-map-modal-content');
    if (!modal || !content) return;
    modal.classList.add('opacity-0', 'pointer-events-none');
    content.classList.remove('scale-100');
    content.classList.add('scale-95');
  }

  function initDeliveryMap() {
    if (!isDelivery) return;
    const mapContainer = document.getElementById('delivery-map');
    if (!mapContainer) return;

    if (typeof L === 'undefined') {
      setTimeout(initDeliveryMap, 300);
      return;
    }

    const limraCoords = [21.8603074, 87.4793798];

    if (!deliveryMap) {
      deliveryMap = L.map('delivery-map').setView(limraCoords, 14);
      
      streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
      }).addTo(deliveryMap);

      satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
      });

      const restaurantIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      });

      L.marker(limraCoords, { icon: restaurantIcon }).addTo(deliveryMap)
        .bindPopup('<b>LIMRA Restaurant</b><br>Egra, Purba Medinipur')
        .openPopup();

      deliveryMap.on('click', async (e) => {
        await updatePinnedLocation(e.latlng);
      });

      // UI Overlays - Layer Switcher
      const layerBtn = document.getElementById('map-layer-toggle-btn');
      if (layerBtn) {
        layerBtn.addEventListener('click', () => {
          if (currentMapLayer === 'street') {
            deliveryMap.removeLayer(streetLayer);
            satelliteLayer.addTo(deliveryMap);
            currentMapLayer = 'satellite';
            layerBtn.innerHTML = '🗺️';
          } else {
            deliveryMap.removeLayer(satelliteLayer);
            streetLayer.addTo(deliveryMap);
            currentMapLayer = 'street';
            layerBtn.innerHTML = '🛰️';
          }
        });
      }

      // UI Overlays - Locate Self
      const locateSelfBtn = document.getElementById('map-locate-self-btn');
      if (locateSelfBtn) {
        locateSelfBtn.addEventListener('click', () => {
          const statusEl = document.getElementById('distance-calc-status');
          if (statusEl) {
            statusEl.innerHTML = `⌛ Detecting your current GPS location...`;
            statusEl.style.color = '#e2b13c';
          }

          if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser.');
            if (statusEl) statusEl.innerHTML = `❌ Geolocation not supported`;
            return;
          }

          navigator.geolocation.getCurrentPosition(
            async (position) => {
              const latlng = { lat: position.coords.latitude, lng: position.coords.longitude };
              deliveryMap.setView(latlng, 16);
              await updatePinnedLocation(latlng);
            },
            (error) => {
              console.warn('GPS detection failed:', error);
              alert('Could not detect your current location. Please check your browser permissions or manually tap the map to pin.');
              if (statusEl) {
                statusEl.innerHTML = `❌ Detection failed`;
                statusEl.style.color = '#ef4444';
              }
            },
            { enableHighAccuracy: true, timeout: 8000 }
          );
        });
      }

      // Search Autocomplete
      const searchInput = document.getElementById('map-search-input');
      const suggestionsBox = document.getElementById('map-search-suggestions');
      const clearSearchBtn = document.getElementById('map-clear-search-btn');

      if (searchInput && suggestionsBox) {
        searchInput.addEventListener('input', () => {
          const val = searchInput.value.trim();
          if (clearSearchBtn) {
            if (val) clearSearchBtn.classList.remove('hidden');
            else clearSearchBtn.classList.add('hidden');
          }

          if (searchTimeout) clearTimeout(searchTimeout);
          if (!val) {
            suggestionsBox.innerHTML = '';
            suggestionsBox.classList.add('hidden');
            return;
          }

          searchTimeout = setTimeout(async () => {
            try {
              // Focus query around Egra area by adding context to search if local
              const query = val.toLowerCase().includes('egra') ? val : `${val}, Egra, Purba Medinipur`;
              const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`);
              const data = await res.json();
              
              if (data && data.length > 0) {
                suggestionsBox.innerHTML = data.map(item => `
                  <div class="px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0 suggestion-item" 
                       data-lat="${item.lat}" data-lng="${item.lon}" data-name="${escapeHtml(item.display_name)}">
                    📍 ${escapeHtml(item.display_name)}
                  </div>
                `).join('');
                
                suggestionsBox.classList.remove('hidden');

                // Attach click listeners
                suggestionsBox.querySelectorAll('.suggestion-item').forEach(el => {
                  el.addEventListener('click', async () => {
                    const lat = parseFloat(el.getAttribute('data-lat'));
                    const lng = parseFloat(el.getAttribute('data-lng'));
                    const name = el.getAttribute('data-name');
                    
                    searchInput.value = name;
                    suggestionsBox.classList.add('hidden');
                    
                    const latlng = { lat, lng };
                    deliveryMap.setView(latlng, 16);
                    await updatePinnedLocation(latlng);
                  });
                });
              } else {
                suggestionsBox.innerHTML = `<div class="px-3 py-2.5 text-xs text-slate-400 italic text-center">No locations found. Try manual pinning.</div>`;
                suggestionsBox.classList.remove('hidden');
              }
            } catch (err) {
              console.warn('Search geocode autocomplete failed:', err);
            }
          }, 300);
        });

        // Hide suggestions when clicking outside
        document.addEventListener('click', (e) => {
          if (!e.target.closest('#map-search-input') && !e.target.closest('#map-search-suggestions')) {
            suggestionsBox.classList.add('hidden');
          }
        });
      }

      if (clearSearchBtn && searchInput) {
        clearSearchBtn.addEventListener('click', () => {
          searchInput.value = '';
          clearSearchBtn.classList.add('hidden');
          suggestionsBox.innerHTML = '';
          suggestionsBox.classList.add('hidden');
        });
      }
    }

    // Prefill modal inputs if already confirmed
    const existingLat = parseFloat(document.getElementById('order-latitude')?.value);
    const existingLng = parseFloat(document.getElementById('order-longitude')?.value);
    const existingLandmark = document.getElementById('order-landmark')?.value;
    const existingNotes = document.getElementById('order-delivery-notes')?.value;

    if (existingLandmark) {
      document.getElementById('map-selected-landmark').value = existingLandmark;
    }
    if (existingNotes) {
      document.getElementById('map-selected-notes').value = existingNotes;
    }

    setTimeout(() => {
      if (deliveryMap) {
        deliveryMap.invalidateSize();
        if (existingLat && existingLng) {
          const latlng = { lat: existingLat, lng: existingLng };
          deliveryMap.setView(latlng, 16);
          updatePinnedLocation(latlng);
        } else {
          deliveryMap.setView(limraCoords, 14);
        }
      }
    }, 150);
  }

  async function updatePinnedLocation(latlng) {
    const limraCoords = [21.8603074, 87.4793798];
    const clientIcon = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });

    if (!deliveryMarker) {
      deliveryMarker = L.marker(latlng, { icon: clientIcon, draggable: true }).addTo(deliveryMap);
      deliveryMarker.on('dragend', async () => {
        await updatePinnedLocation(deliveryMarker.getLatLng());
      });
    } else {
      deliveryMarker.setLatLng(latlng);
    }

    // Save selected coords in temporary state
    mapSelectedLat = latlng.lat;
    mapSelectedLng = latlng.lng;

    document.getElementById('map-selected-lat').textContent = latlng.lat.toFixed(6);
    document.getElementById('map-selected-lng').textContent = latlng.lng.toFixed(6);

    const dist = haversineDistance(limraCoords[0], limraCoords[1], latlng.lat, latlng.lng);
    deliveryKm = Math.min(50, Math.max(0.1, dist));

    const distInput = document.getElementById('order-distance');
    if (distInput) {
      distInput.value = deliveryKm.toFixed(1);
    }

    const statusEl = document.getElementById('distance-calc-status');
    if (statusEl) {
      statusEl.innerHTML = `⌛ Reverse geocoding location details...`;
      statusEl.style.color = '#e2b13c';
    }

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}`);
      const data = await res.json();
      if (data && data.display_name) {
        mapSelectedAddress = data.display_name;
        document.getElementById('map-selected-address').textContent = data.display_name;

        // Parse address subcomponents
        const addr = data.address || {};
        const area = addr.suburb || addr.neighbourhood || addr.village || addr.road || '—';
        const city = addr.city || addr.town || addr.village || addr.county || '—';
        const state = addr.state || '—';
        const zip = addr.postcode || '—';

        document.getElementById('map-selected-area').textContent = area;
        document.getElementById('map-selected-city').textContent = city;
        document.getElementById('map-selected-state').textContent = state;
        document.getElementById('map-selected-zip').textContent = zip;

        if (statusEl) {
          statusEl.innerHTML = `🟢 Location pinned successfully (Distance: ${deliveryKm.toFixed(1)} km)`;
          statusEl.style.color = '#10b981';
        }
      }
    } catch (e) {
      console.warn('Reverse geocode failed:', e);
      if (statusEl) {
        statusEl.innerHTML = `⚠️ Geocoding failed, coordinates saved.`;
        statusEl.style.color = '#f59e0b';
      }
    }
  }

  async function locateAddress() {
    const addressVal = document.getElementById('order-address')?.value?.trim();
    openMapModal();
    if (!addressVal) return;

    // Prefill the search box inside the map and trigger search
    setTimeout(() => {
      const searchInput = document.getElementById('map-search-input');
      if (searchInput) {
        searchInput.value = addressVal;
        searchInput.dispatchEvent(new Event('input'));
      }
    }, 300);
  }

  function initCoupon() {
    const applyBtn = document.getElementById('cart-coupon-apply-btn');
    const couponInput = document.getElementById('cart-coupon-input');
    const couponStatus = document.getElementById('cart-coupon-status');

    function showCouponStatus(msg, type) {
      if (!couponStatus) return;
      couponStatus.textContent = msg;
      couponStatus.className = `text-[10px] font-bold mt-1 block ${type === 'success' ? 'text-emerald-600' : 'text-red-500'}`;
      couponStatus.classList.remove('hidden');
    }

    if (applyBtn && couponInput) {
      applyBtn.addEventListener('click', async () => {
        const code = couponInput.value.trim().toUpperCase();
        if (!code) {
          showCouponStatus('Please enter a coupon code.', 'error');
          return;
        }

        applyBtn.disabled = true;
        applyBtn.textContent = 'Applying...';

        try {
          const result = await insforge.database
            .from('coupons')
            .select('*')
            .eq('code', code)
            .single();

          if (result.error || !result.data) {
            showCouponStatus('Invalid coupon code.', 'error');
            appliedCoupon = null;
            updateCartUI();
            return;
          }

          const coupon = result.data;

          // Check if active
          if (!coupon.active) {
            showCouponStatus('This coupon is currently inactive.', 'error');
            appliedCoupon = null;
            updateCartUI();
            return;
          }

          // Validate expiry
          const expiryDate = new Date(coupon.expiry_date);
          const today = new Date();
          today.setHours(0,0,0,0);
          if (expiryDate < today) {
            showCouponStatus('This coupon has expired.', 'error');
            appliedCoupon = null;
            updateCartUI();
            return;
          }

          // Validate usage limit
          if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
            showCouponStatus('This coupon has reached its maximum usage limit.', 'error');
            appliedCoupon = null;
            updateCartUI();
            return;
          }

          // Validate minimum bill
          const subtotal = getCartSubtotal();
          if (subtotal < coupon.min_bill) {
            showCouponStatus(`Min order of ₹${coupon.min_bill} required for this coupon.`, 'error');
            appliedCoupon = null;
            updateCartUI();
            return;
          }

          // Apply coupon
          appliedCoupon = {
            code: coupon.code,
            discount_pct: parseFloat(coupon.discount_pct),
            min_bill: parseFloat(coupon.min_bill)
          };

          showCouponStatus(`Coupon Applied! Get ${coupon.discount_pct}% OFF`, 'success');
          updateCartUI();
        } catch (err) {
          showCouponStatus('Error validating coupon: ' + err.message, 'error');
          appliedCoupon = null;
          updateCartUI();
        } finally {
          applyBtn.disabled = false;
          applyBtn.textContent = 'Apply';
        }
      });
    }
  }

  // ── Delivery type toggle ────────────────
  function initDelivery() {
    const btnDeliver = document.getElementById('delivery-type-deliver');
    const btnPickup  = document.getElementById('delivery-type-pickup');
    const addrBlock  = document.getElementById('delivery-address-block');
    const openMapBtn = document.getElementById('open-map-btn');
    const closeMapBtn = document.getElementById('close-map-modal-btn');
    const confirmMapBtn = document.getElementById('confirm-map-location-btn');
    const mapModal = document.getElementById('delivery-map-modal');

    if (!btnDeliver || !btnPickup) return;

    // Sync initial UI state based on delivery availability
    const deliveryOpen = isDeliveryAvailable();
    setDeliveryMode(deliveryOpen);

    const hoursBadge = document.getElementById('delivery-hours-badge');
    if (hoursBadge) {
      if (deliveryOpen) {
        hoursBadge.textContent = 'Hours: 1:00 PM - 10:30 PM';
        hoursBadge.className = 'text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded';
        hoursBadge.style.border = '1px solid rgba(16,185,129,0.15)';
      } else {
        hoursBadge.textContent = 'Closed (Pickup Only)';
        hoursBadge.className = 'text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded';
        hoursBadge.style.border = '1px solid rgba(245,158,11,0.15)';
      }
    }

    btnDeliver.addEventListener('click', () => {
      if (!isDeliveryAvailable()) {
        alert('Sorry, delivery is only available between 1:00 PM and 10:30 PM. Please select Self Pickup.');
        return;
      }
      setDeliveryMode(true);
    });
    btnPickup.addEventListener('click',  () => setDeliveryMode(false));

    if (openMapBtn) openMapBtn.addEventListener('click', openMapModal);
    if (closeMapBtn) closeMapBtn.addEventListener('click', closeMapModal);
    
    if (confirmMapBtn) {
      confirmMapBtn.addEventListener('click', () => {
        if (!mapSelectedLat || !mapSelectedLng) {
          alert('Please pin a location on the map first.');
          return;
        }

        // Write values to checkout inputs
        const addressInput = document.getElementById('order-address');
        if (addressInput && mapSelectedAddress) {
          addressInput.value = mapSelectedAddress;
          geocodeResolvedAddress = mapSelectedAddress;
        }

        const latInput = document.getElementById('order-latitude');
        if (latInput) latInput.value = mapSelectedLat;

        const lngInput = document.getElementById('order-longitude');
        if (lngInput) lngInput.value = mapSelectedLng;

        const landmarkInput = document.getElementById('order-landmark');
        const modalLandmark = document.getElementById('map-selected-landmark');
        if (landmarkInput && modalLandmark) {
          landmarkInput.value = modalLandmark.value.trim();
        }

        const notesInput = document.getElementById('order-delivery-notes');
        const modalNotes = document.getElementById('map-selected-notes');
        if (notesInput && modalNotes) {
          notesInput.value = modalNotes.value.trim();
        }

        const verifiedInput = document.getElementById('order-location-verified');
        if (verifiedInput) {
          verifiedInput.value = 'true';
        }

        updateLocationBadge(true);
        updateCartUI();
        closeMapModal();
      });
    }

    if (mapModal) {
      mapModal.addEventListener('click', (e) => {
        if (e.target === mapModal) closeMapModal();
      });
    }

    const locateBtn = document.getElementById('locate-address-btn');
    if (locateBtn) {
      locateBtn.addEventListener('click', locateAddress);
    }

    const areaSelect = document.getElementById('order-delivery-area');
    if (areaSelect) {
      areaSelect.addEventListener('change', () => {
        selectedDeliveryArea = areaSelect.value;
        const addressInput = document.getElementById('order-address');
        
        if (selectedDeliveryArea && selectedDeliveryArea !== 'custom') {
          // If a specific area is chosen, auto-verify the location and prefill address
          updateLocationBadge(true);
          
          const areaLabel = areaSelect.options[areaSelect.selectedIndex].text.split(' (')[0];
          
          // Prefill or append the area to the address if not already mentioned
          if (addressInput) {
            const currentAddr = addressInput.value.trim();
            if (!currentAddr) {
              addressInput.value = areaLabel;
            } else if (!currentAddr.toLowerCase().includes(areaLabel.toLowerCase())) {
              addressInput.value = `${currentAddr}, ${areaLabel}`;
            }
          }
        } else {
          // If custom or empty is chosen
          updateLocationBadge(false);
        }
        updateCartUI();
      });
    }
  }

  function setDeliveryMode(delivery) {
    const btnDeliver = document.getElementById('delivery-type-deliver');
    const btnPickup  = document.getElementById('delivery-type-pickup');
    const addrBlock  = document.getElementById('delivery-address-block');
    
    isDelivery = delivery;
    if (delivery) {
      if (btnDeliver) btnDeliver.style.cssText = 'border-color:var(--color-accent); background:var(--color-accent); color:#fff';
      if (btnPickup) btnPickup.style.cssText  = 'border-color:var(--color-border); color:var(--color-text-muted); background:transparent';
      if (addrBlock) addrBlock.style.display  = '';
    } else {
      if (btnDeliver) {
        if (!isDeliveryAvailable()) {
          btnDeliver.style.cssText = 'border-color:var(--color-border); color:var(--color-text-muted); background:transparent; opacity:0.5; cursor:not-allowed';
        } else {
          btnDeliver.style.cssText = 'border-color:var(--color-border); color:var(--color-text-muted); background:transparent';
        }
      }
      if (btnPickup) btnPickup.style.cssText  = 'border-color:var(--color-accent); background:var(--color-accent); color:#fff';
      if (addrBlock) addrBlock.style.display  = 'none';
      deliveryKm = 0;
      const distInput = document.getElementById('order-distance');
      if (distInput) distInput.value = "0";
    }
    updateCartUI();
  }

  // ── Stepper Logic & Navigation ────────────────
  let currentStep = 1;
  let geocodeResolvedAddress = "";

  function showStep(stepNum) {
    // No-op: Removed wizard steps in favor of unified single-screen checkout
  }

  function validateStep2() {
    const name = document.getElementById('order-customer-name')?.value?.trim();
    const phone = document.getElementById('order-customer-phone')?.value?.trim();
    const email = document.getElementById('order-customer-email')?.value?.trim();
    const address = document.getElementById('order-address')?.value?.trim();

    if (!name) {
      alert('Please enter your name.');
      return false;
    }
    if (!phone || phone.length < 10) {
      alert('Please enter a valid 10-digit phone number.');
      return false;
    }
    if (email && !email.includes('@')) {
      alert('Please enter a valid email address.');
      return false;
    }
    if (isDelivery && !address) {
      alert('Please enter your delivery address.');
      return false;
    }
    return true;
  }

  async function triggerAddressGeocoding() {
    const loader = document.getElementById('delivery-calc-loading');
    const successBox = document.getElementById('delivery-calc-success');
    const failedBox = document.getElementById('delivery-calc-failed');
    const resolvedAddressLabel = document.getElementById('delivery-resolved-address');
    const resolvedKmLabel = document.getElementById('delivery-resolved-km');
    const distLabel = document.getElementById('delivery-dist-label');
    const kmUnit = document.getElementById('delivery-resolved-km-unit');

    if (!isDelivery) {
      if (loader) loader.classList.add('hidden');
      if (successBox) successBox.classList.remove('hidden');
      if (failedBox) failedBox.classList.add('hidden');
      if (resolvedAddressLabel) resolvedAddressLabel.textContent = "Self Pickup (Free)";
      if (resolvedKmLabel) resolvedKmLabel.textContent = "0.0";
      if (distLabel) distLabel.textContent = "Distance from Limra:";
      if (kmUnit) kmUnit.style.display = "";
      return;
    }

    if (selectedDeliveryArea && selectedDeliveryArea !== 'custom') {
      if (loader) loader.classList.add('hidden');
      if (successBox) successBox.classList.remove('hidden');
      if (failedBox) failedBox.classList.add('hidden');
      
      const areaSelect = document.getElementById('order-delivery-area');
      const areaLabel = areaSelect ? areaSelect.options[areaSelect.selectedIndex].text.split(' (')[0] : selectedDeliveryArea;
      
      const detailedAddress = document.getElementById('order-address')?.value?.trim() || "";
      if (resolvedAddressLabel) {
        resolvedAddressLabel.textContent = detailedAddress ? `${detailedAddress} (${areaLabel})` : areaLabel;
      }
      
      if (distLabel) distLabel.textContent = "Rate Type:";
      if (resolvedKmLabel) resolvedKmLabel.textContent = "Fixed Area Rate";
      if (kmUnit) kmUnit.style.display = "none";
      
      updateCartUI();
      return;
    }

    // Reset labels back to custom
    if (distLabel) distLabel.textContent = "Distance from Limra:";
    if (kmUnit) kmUnit.style.display = "";

    const addressVal = document.getElementById('order-address')?.value?.trim();
    if (!addressVal) {
      if (loader) loader.classList.add('hidden');
      if (successBox) successBox.classList.add('hidden');
      if (failedBox) failedBox.classList.remove('hidden');
      return;
    }

    // If already geocoded via map pin or previous manual entry
    if (deliveryKm > 0 && geocodeResolvedAddress === addressVal) {
      if (loader) loader.classList.add('hidden');
      if (successBox) successBox.classList.remove('hidden');
      if (failedBox) failedBox.classList.add('hidden');
      if (resolvedAddressLabel) resolvedAddressLabel.textContent = addressVal;
      if (resolvedKmLabel) resolvedKmLabel.textContent = deliveryKm.toFixed(1);
      return;
    }

    // Otherwise geocode manual text
    if (loader) loader.classList.remove('hidden');
    if (successBox) successBox.classList.add('hidden');
    if (failedBox) failedBox.classList.add('hidden');

    try {
      const query = `${addressVal}, Egra, Purba Medinipur, West Bengal, India`;
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
      const data = await res.json();

      let latlng = null;
      if (data && data.length > 0) {
        latlng = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      } else {
        const fallbackRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addressVal)}`);
        const fallbackData = await fallbackRes.json();
        if (fallbackData && fallbackData.length > 0) {
          latlng = { lat: parseFloat(fallbackData[0].lat), lng: parseFloat(fallbackData[0].lon) };
        }
      }

      if (latlng) {
        const limraCoords = [21.8603074, 87.4793798];
        const dist = haversineDistance(limraCoords[0], limraCoords[1], latlng.lat, latlng.lng);
        deliveryKm = Math.min(50, Math.max(0.1, dist));
        
        const distInput = document.getElementById('order-distance');
        if (distInput) distInput.value = deliveryKm.toFixed(1);
        geocodeResolvedAddress = addressVal;

        if (resolvedAddressLabel) resolvedAddressLabel.textContent = addressVal;
        if (resolvedKmLabel) resolvedKmLabel.textContent = deliveryKm.toFixed(1);
        if (loader) loader.classList.add('hidden');
        if (successBox) successBox.classList.remove('hidden');

        if (deliveryMap) {
          deliveryMap.setView([latlng.lat, latlng.lng], 15);
          if (!deliveryMarker) {
            const clientIcon = L.icon({
              iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
              shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
              iconSize: [25, 41],
              iconAnchor: [12, 41],
              popupAnchor: [1, -34],
              shadowSize: [41, 41]
            });
            deliveryMarker = L.marker(latlng, { icon: clientIcon, draggable: true }).addTo(deliveryMap);
            deliveryMarker.on('dragend', async () => {
              await updatePinnedLocation(deliveryMarker.getLatLng());
            });
          } else {
            deliveryMarker.setLatLng(latlng);
          }
        }
      } else {
        throw new Error("Nominatim returned empty results");
      }
    } catch (e) {
      console.warn("Manual address geocoding failed, using local fallback flat-fee:", e);
      deliveryKm = 3.0; // standard flat distance
      const distInput = document.getElementById('order-distance');
      if (distInput) distInput.value = "3.0";
      geocodeResolvedAddress = addressVal;

      if (resolvedAddressLabel) resolvedAddressLabel.textContent = addressVal + " (Manual)";
      if (resolvedKmLabel) resolvedKmLabel.textContent = "3.0 (Fallback)";
      if (loader) loader.classList.add('hidden');
      if (failedBox) failedBox.classList.remove('hidden');
    }
    
    updateCartUI();
  }

  function getSelectedPaymentMethod() {
    const radios = document.getElementsByName('payment_method');
    for (let r of radios) {
      if (r.checked) {
        if (r.value === 'cod') return 'Cash on Delivery (COD)';
        if (r.value === 'upi') return 'UPI / WhatsApp Pay';
        if (r.value === 'card') return 'Card on Delivery';
        if (r.value === 'online') return 'Online Payment (Razorpay)';
      }
    }
    return 'Cash on Delivery (COD)';
  }

  function updateConfirmStepDetails() {
    const name = document.getElementById('order-customer-name')?.value?.trim() || "";
    const phone = document.getElementById('order-customer-phone')?.value?.trim() || "";
    const email = document.getElementById('order-customer-email')?.value?.trim() || "";
    const address = document.getElementById('order-address')?.value?.trim() || "";
    const payment = getSelectedPaymentMethod();

    const confName = document.getElementById('confirm-name');
    if (confName) confName.textContent = name;
    
    const confPhone = document.getElementById('confirm-phone');
    if (confPhone) confPhone.textContent = phone;
    
    const confEmail = document.getElementById('confirm-email');
    if (confEmail) confEmail.textContent = email;
    
    const confAddress = document.getElementById('confirm-address');
    if (confAddress) {
      confAddress.textContent = isDelivery ? address : 'Self Pickup at Restaurant';
    }
    
    const confDelType = document.getElementById('confirm-delivery-type');
    if (confDelType) {
      confDelType.textContent = isDelivery ? '🛵 Delivery' : '🥡 Self Pickup';
    }
    
    const confPay = document.getElementById('confirm-payment-mode');
    if (confPay) confPay.textContent = payment;
  }

  function initStepperNavigation() {
    // Step 1 buttons
    document.getElementById('step-1-next')?.addEventListener('click', () => {
      if (cart.length === 0) {
        alert('Your cart is empty! Add some dishes first.');
        return;
      }
      showStep(2);
    });

    // Step 2 buttons
    document.getElementById('step-2-back')?.addEventListener('click', () => showStep(1));
    document.getElementById('step-2-next')?.addEventListener('click', () => {
      if (validateStep2()) {
        showStep(3);
      }
    });

    // Step 3 buttons
    document.getElementById('step-3-back')?.addEventListener('click', () => showStep(2));
    document.getElementById('step-3-next')?.addEventListener('click', () => showStep(4));

    // Step 4 buttons
    document.getElementById('step-4-back')?.addEventListener('click', () => showStep(3));
    document.getElementById('step-4-next')?.addEventListener('click', () => showStep(5));

    // Step 5 buttons
    document.getElementById('step-5-back')?.addEventListener('click', () => showStep(4));

    // Trigger geocoding when address focus is lost
    document.getElementById('order-address')?.addEventListener('focusout', () => {
      if (isDelivery) {
        triggerAddressGeocoding();
      }
    });
  }

  function initSavedAddressLoading() {
    const savedBtn = document.getElementById('load-saved-details-btn');
    if (!savedBtn) return;
    
    const raw = localStorage.getItem('limra-customer-details');
    if (raw) {
      savedBtn.classList.remove('hidden');
      savedBtn.addEventListener('click', () => {
        try {
          const details = JSON.parse(raw);
          if (details.name) document.getElementById('order-customer-name').value = details.name;
          if (details.phone) document.getElementById('order-customer-phone').value = details.phone;
          if (details.email) document.getElementById('order-customer-email').value = details.email;
          if (details.address) document.getElementById('order-address').value = details.address;
          if (details.isDelivery !== undefined) {
            setDeliveryMode(details.isDelivery);
          }
          if (details.selectedDeliveryArea !== undefined) {
            selectedDeliveryArea = details.selectedDeliveryArea;
            const areaSelect = document.getElementById('order-delivery-area');
            if (areaSelect) {
              areaSelect.value = selectedDeliveryArea;
            }
          }
          if (details.distance !== undefined) {
            deliveryKm = details.distance;
            const distInput = document.getElementById('order-distance');
            if (distInput) distInput.value = details.distance.toFixed(1);
          }
          updateCartUI();
          alert('Saved details loaded successfully!');
        } catch (e) {
          console.warn('Failed to load saved details:', e);
        }
      });
    }
  }

  initDelivery();
  initCoupon();
  initStepperNavigation();

  // ── Antigravity UPI Verification & Order Tracking Stores ──────────────────
  const upiVerificationStore = new AntigravityStore({
    isVerifying: false,
    status: 'idle', // 'idle' | 'verifying' | 'success' | 'pending' | 'failed'
    message: ''
  });

  const orderTrackingStore = new AntigravityStore({
    activeOrderId: null,
    orderNumber: '',
    status: 'pending',
    isTracking: false
  });

  let orderRealtimeChannel = null;
  let orderTrackingPollId = null;

  async function subscribeToOrderUpdates(orderId, orderNumber) {
    // Gracefully handle null or placeholder IDs to prevent websocket failures
    if (!orderId || orderId === '#N/A' || orderId === 'null' || orderId === 'undefined') {
      console.warn('[RealtimeTracking] Invalid tracking reference ID:', orderId);
      orderTrackingStore.state = {
        activeOrderId: null,
        orderNumber: orderNumber || 'N/A',
        isTracking: false,
        status: 'pending'
      };
      return;
    }

    if (orderRealtimeChannel) {
      try {
        await insforge.realtime.unsubscribe(`order-updates:${orderRealtimeChannel}`);
      } catch (e) {}
      orderRealtimeChannel = null;
    }

    orderRealtimeChannel = orderId;
    const channelName = `order-updates:${orderId}`;

    orderTrackingStore.state = {
      activeOrderId: orderId,
      orderNumber: orderNumber,
      isTracking: true,
      status: 'pending'
    };

    try {
      await insforge.realtime.connect();
      const subRes = await insforge.realtime.subscribe(channelName);
      if (!subRes.error) {
        console.log(`[RealtimeTracking] Subscribed to order updates: ${channelName}`);
        
        insforge.realtime.on('order_status_updated', (payload) => {
          if (payload.order_id === orderId) {
            console.log(`[RealtimeTracking] Status transition:`, payload.status);
            orderTrackingStore.state = {
              ...orderTrackingStore.state,
              status: payload.status
            };

            if (payload.status === 'delivered' || payload.status === 'cancelled') {
              setTimeout(() => {
                unsubscribeFromOrderUpdates();
              }, 45000);
            }
          }
        });
      } else {
        throw new Error(subRes.error.message || 'Subscription failed');
      }
    } catch (err) {
      console.warn('[RealtimeTracking] WebSocket updates unavailable. Falling back to active HTTP polling:', err);
      startOrderTrackingPolling(orderId);
    }
  }

  function startOrderTrackingPolling(orderId) {
    if (orderTrackingPollId) clearInterval(orderTrackingPollId);
    orderTrackingPollId = setInterval(async () => {
      try {
        const { data, error } = await insforge.database.from('orders').select('status').eq('id', orderId).maybeSingle();
        if (!error && data) {
          orderTrackingStore.state = {
            ...orderTrackingStore.state,
            status: data.status
          };
          if (data.status === 'delivered' || data.status === 'cancelled') {
            unsubscribeFromOrderUpdates();
          }
        }
      } catch (e) {
        console.warn('[RealtimeTracking] Poller error:', e);
      }
    }, 10000); // Poll every 10 seconds
  }

  function unsubscribeFromOrderUpdates() {
    if (orderRealtimeChannel) {
      const channelName = `order-updates:${orderRealtimeChannel}`;
      try {
        insforge.realtime.unsubscribe(channelName);
      } catch (e) {}
      console.log(`[RealtimeTracking] Cleaned up event stream: ${channelName}`);
      orderRealtimeChannel = null;
    }
    if (orderTrackingPollId) {
      clearInterval(orderTrackingPollId);
      orderTrackingPollId = null;
    }
    orderTrackingStore.state = {
      ...orderTrackingStore.state,
      isTracking: false
    };
  }

  window.subscribeToOrderUpdates = subscribeToOrderUpdates;

  // Subscribe reactive UIs
  upiVerificationStore.subscribe((state) => {
    const statusOverlay = document.getElementById('upi-status-overlay');
    const overlayLoader = document.getElementById('upi-overlay-loader');
    const overlaySuccess = document.getElementById('upi-overlay-success');
    const overlayPending = document.getElementById('upi-overlay-pending');
    const overlayFailed = document.getElementById('upi-overlay-failed');

    if (!statusOverlay) return;

    if (state.isVerifying) {
      statusOverlay.classList.remove('pointer-events-none', 'opacity-0');
    } else if (state.status === 'idle') {
      statusOverlay.classList.add('pointer-events-none', 'opacity-0');
    }

    if (overlayLoader) overlayLoader.classList.toggle('hidden', state.status !== 'verifying');
    if (overlaySuccess) overlaySuccess.classList.toggle('hidden', state.status !== 'success');
    if (overlayPending) overlayPending.classList.toggle('hidden', state.status !== 'pending');
    if (overlayFailed) overlayFailed.classList.toggle('hidden', state.status !== 'failed');

    if (state.status === 'failed') {
      const failedMsgEl = document.getElementById('upi-failed-message');
      if (failedMsgEl) failedMsgEl.textContent = state.message || 'Payment verification failed.';
    }
  });

  orderTrackingStore.subscribe((state) => {
    const modal = document.getElementById('order-tracking-modal');
    const numberEl = document.getElementById('track-order-number');
    const statusTextEl = document.getElementById('track-status-text');
    
    if (!modal) return;

    if (state.isTracking) {
      modal.classList.remove('pointer-events-none', 'opacity-0');
      modal.querySelector('#order-tracking-content').classList.remove('scale-95');
      modal.querySelector('#order-tracking-content').classList.add('scale-100');
    } else {
      modal.classList.add('pointer-events-none', 'opacity-0');
      modal.querySelector('#order-tracking-content').classList.add('scale-95');
      modal.querySelector('#order-tracking-content').classList.remove('scale-100');
      return;
    }

    if (numberEl) numberEl.textContent = `#${state.orderNumber}`;

    const statusHierarchy = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
    let currentStatus = (state.status || 'pending').toLowerCase().replace(/_/g, ' ').trim();
    if (currentStatus === 'placed' || currentStatus === 'pending') {
      currentStatus = 'pending';
    } else if (currentStatus === 'confirmed') {
      currentStatus = 'confirmed';
    } else if (currentStatus === 'preparing') {
      currentStatus = 'preparing';
    } else if (currentStatus === 'out for delivery' || currentStatus === 'out_for_delivery' || currentStatus === 'ready') {
      currentStatus = 'out_for_delivery';
    } else if (currentStatus === 'delivered') {
      currentStatus = 'delivered';
    } else if (currentStatus === 'cancelled' || currentStatus === 'rejected') {
      currentStatus = 'cancelled';
    }
    
    const currentIndex = statusHierarchy.indexOf(currentStatus);

    statusHierarchy.forEach((status, idx) => {
      const stepEl = document.getElementById(`track-step-${status}`);
      if (!stepEl) return;
      
      const circle = stepEl.querySelector('.step-circle');
      const title = stepEl.querySelector('.step-title');

      if (!circle || !title) return;

      if (currentStatus === 'cancelled') {
        circle.className = 'absolute -left-7 w-7 h-7 rounded-full flex items-center justify-center border-2 border-red-500 bg-red-50 text-red-600 text-xs font-bold step-circle transition-all duration-300';
        title.className = 'text-xs font-bold text-red-500 step-title transition-colors duration-300';
      } else if (idx < currentIndex) {
        circle.className = 'absolute -left-7 w-7 h-7 rounded-full flex items-center justify-center border-2 border-emerald-500 bg-emerald-500 text-white text-xs font-bold step-circle transition-all duration-300';
        title.className = 'text-xs font-bold text-emerald-600 step-title transition-colors duration-300';
      } else if (idx === currentIndex) {
        circle.className = 'absolute -left-7 w-7 h-7 rounded-full flex items-center justify-center border-2 border-emerald-500 bg-emerald-50 text-emerald-600 text-xs font-bold step-circle animate-pulse transition-all duration-300';
        title.className = 'text-xs font-bold text-emerald-600 step-title transition-colors duration-300';
      } else {
        circle.className = 'absolute -left-7 w-7 h-7 rounded-full flex items-center justify-center border-2 border-slate-200 bg-white text-slate-400 text-xs font-bold step-circle transition-all duration-300';
        title.className = 'text-xs font-bold text-slate-400 step-title transition-colors duration-300';
      }
    });

    const progressLine = document.getElementById('track-progress-line');
    if (progressLine) {
      if (currentStatus === 'cancelled') {
        progressLine.style.background = '#fecaca'; // light red
      } else {
        const percent = currentIndex >= 0 ? (currentIndex / 4) * 100 : 0;
        progressLine.style.background = `linear-gradient(to bottom, #10b981 ${percent}%, #e2e8f0 ${percent}%)`;
        progressLine.style.transition = 'background 0.5s ease';
      }
    }

    if (statusTextEl) {
      switch (currentStatus) {
        case 'pending':
          statusTextEl.textContent = 'Your order is placed. Waiting for confirmation...';
          break;
        case 'confirmed':
          statusTextEl.textContent = 'Order confirmed! We will start preparing it shortly.';
          break;
        case 'preparing':
          statusTextEl.textContent = 'Chefs are preparing your dishes in the kitchen.';
          break;
        case 'ready':
          statusTextEl.textContent = 'Order is ready and out for delivery! Please stand by.';
          break;
        case 'delivered':
          statusTextEl.textContent = 'Order delivered successfully! Bon appétit!';
          break;
        case 'cancelled':
          statusTextEl.textContent = 'Order cancelled or rejected by restaurant.';
          break;
        default:
          statusTextEl.textContent = `Current status: ${state.status}`;
      }
    }
  });

  // UTR Countdown timer & verification
  let countdownInterval = null;
  function startPendingCountdown(utr, grandTotal) {
    let count = 10;
    const countEl = document.getElementById('upi-pending-countdown');
    if (countEl) countEl.textContent = count;

    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(async () => {
      count--;
      if (countEl) countEl.textContent = count;

      if (count <= 0) {
        clearInterval(countdownInterval);
        await executeUpiVerification(utr, grandTotal);
      }
    }, 1000);
  }

  async function executeUpiVerification(utr, grandTotal) {
    upiVerificationStore.state = {
      isVerifying: true,
      status: 'verifying',
      message: ''
    };

    try {
      const res = await insforge.database.rpc('verify_upi_payment', {
        p_amount: grandTotal,
        p_payee: '7501299357@ybl',
        p_utr_or_txn: utr
      });

      if (res.error) throw new Error(res.error.message || 'Verification failed');

      const data = res.data;
      if (data.status === 'success') {
        upiVerificationStore.state = {
          isVerifying: true,
          status: 'success',
          message: ''
        };
        
        await new Promise(r => setTimeout(r, 1500));
        
        upiVerificationStore.state = {
          isVerifying: false,
          status: 'idle',
          message: ''
        };

        const modal = document.getElementById('upi-payment-modal');
        modal.classList.add('pointer-events-none', 'opacity-0');
        modal.querySelector('#upi-modal-content').classList.add('scale-95');

        await saveAndCompleteOrder(utr);
      } else if (data.status === 'pending') {
        upiVerificationStore.state = {
          isVerifying: true,
          status: 'pending',
          message: data.message
        };
        startPendingCountdown(utr, grandTotal);
      } else {
        upiVerificationStore.state = {
          isVerifying: true,
          status: 'failed',
          message: data.message || 'Payment verification failed.'
        };
      }
    } catch (err) {
      upiVerificationStore.state = {
        isVerifying: true,
        status: 'failed',
        message: err.message || 'Network error verifying payment.'
      };
    }
  }

  // Setup failed payment retry UI binding
  document.getElementById('upi-failed-retry-btn').addEventListener('click', () => {
    upiVerificationStore.state = { isVerifying: false, status: 'idle', message: '' };
  });

  // Setup close tracking modal binding
  document.getElementById('track-close-btn').addEventListener('click', () => {
    unsubscribeFromOrderUpdates();
  });

  // Backdrop click listener to close order tracking modal and clean up streams
  document.getElementById('order-tracking-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('order-tracking-modal')) {
      unsubscribeFromOrderUpdates();
    }
  });

  // Place order (saved to admin dashboard)
  document.getElementById('place-order-btn').addEventListener('click', async () => {
    if (cart.length === 0) { alert('Your cart is empty! Add some items first.'); return; }
    if (isDelivery && !isDeliveryAvailable()) {
      alert('Sorry, delivery is only available between 1:00 PM and 10:30 PM. Please select Self Pickup.');
      return;
    }
    const name    = document.getElementById('order-customer-name').value.trim();
    const phone   = document.getElementById('order-customer-phone').value.trim();
    const email   = document.getElementById('order-customer-email').value.trim();
    const address = document.getElementById('order-address')?.value?.trim() || '';
    const notes   = document.getElementById('order-notes').value.trim();
    const km      = parseFloat(document.getElementById('order-distance')?.value) || 0;
    const subtotal = getCartSubtotal();
    const charge  = getDeliveryCharge();
    const taxes   = getTaxesAmount();
    const payment = getSelectedPaymentMethod();

    const lat     = parseFloat(document.getElementById('order-latitude')?.value) || null;
    const lng     = parseFloat(document.getElementById('order-longitude')?.value) || null;
    const landmark = document.getElementById('order-landmark')?.value?.trim() || null;
    const deliveryNotes = document.getElementById('order-delivery-notes')?.value?.trim() || null;
    const locationVerified = document.getElementById('order-location-verified')?.value === 'true';

    if (!name) {
      alert('Please enter your full name.');
      return;
    }

    // Strict Phone Number validation (exactly 10-digit format, digits only, starting with 6-9)
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      alert('Please enter a valid 10-digit phone number (digits only, e.g. 9876543210).');
      return;
    }

    if (email && !email.includes('@')) {
      alert('Please enter a valid email address.');
      return;
    }
    
    // Bounds check and sanitize coordinates for delivery to prevent layout or map injection errors
    let validatedLat = null;
    let validatedLng = null;
    if (isDelivery) {
      if (!address) {
        alert('Please enter your delivery address.');
        return;
      }
      if (lat !== null && !isNaN(lat) && lng !== null && !isNaN(lng)) {
        if (lat < 21.0 || lat > 23.0 || lng < 86.5 || lng > 88.5) {
          alert('Invalid delivery coordinates. Pinned location must be within Egra region (Lat: 21.0 - 23.0, Lng: 86.5 - 88.5).');
          return;
        }
        validatedLat = parseFloat(lat.toFixed(6));
        validatedLng = parseFloat(lng.toFixed(6));
      }
    }

    const emailNote = email ? `[EMAIL: ${email}]` : '';
    const paymentNote = payment ? `[PAYMENT: ${payment}]` : '';
    const deliveryNote = isDelivery
      ? `[DELIVERY] Address: ${address} | Selected Area: ${selectedDeliveryArea ? (selectedDeliveryArea.charAt(0).toUpperCase() + selectedDeliveryArea.slice(1)) : 'Custom'} | Distance: ${km.toFixed(1)} km | Delivery charge: ₹${charge}`
      : '[SELF PICKUP]';
    const finalTaxes = getTaxesAmount();
    const finalCharge = isDelivery ? getDeliveryCharge(km) : 0;
    const finalDiscount = getCouponDiscountAmount();

    const taxNote = `[CGST: 2.5%] [SGST: 2.5%]`;
    const discountNote = finalDiscount > 0 ? `[DISCOUNT_PCT: ${appliedCoupon ? appliedCoupon.discount_pct : 0}%] [DISCOUNT_AMT: ${finalDiscount}]` : '';
    const feeNote = finalCharge > 0 ? `[DELIVERY_FEE: ${finalCharge}]` : '';
    const combinedNotes = [deliveryNote, emailNote, paymentNote, taxNote, discountNote, feeNote, notes].filter(Boolean).join(' | ');

    const btn = document.getElementById('place-order-btn');
    const statusEl = document.getElementById('order-status-msg');
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg> Placing order...
    `;

    const cartSnapshot = [...cart];

    // Strictly food items and their base prices (no tax/fee/discount pseudo line items)
    const foodItems = cart.map(c => {
      const isCombo = typeof c.id === 'string' && c.id.startsWith('combo-');
      return {
        id: c.id,
        name: isCombo ? `🍱 [COMBO] ${c.name}` : c.name,
        price: Number(c.price),
        qty: Number(c.qty)
      };
    });

    const saveAndCompleteOrder = async (utrVal = null) => {
      try {
        const order = await saveOrder({
          customerName: name,
          customerPhone: phone,
          items: foodItems,
          notes: combinedNotes,
          latitude: validatedLat,
          longitude: validatedLng,
          landmark: landmark,
          deliveryNotes: deliveryNotes,
          locationVerified: locationVerified,
          txnRef: utrVal
        });

        if (appliedCoupon && appliedCoupon.code) {
          try {
            const { data: current } = await insforge.database
              .from('coupons')
              .select('used_count')
              .eq('code', appliedCoupon.code);
            const newCount = (current && current[0] ? Number(current[0].used_count) || 0 : 0) + 1;
            await insforge.database
              .from('coupons')
              .update({ used_count: newCount })
              .eq('code', appliedCoupon.code);
          } catch (couponErr) {
            console.warn('[Checkout] Failed to increment coupon usage count:', couponErr);
          }
        }
        const orderLabel = order?.order_number ? `Order #${order.order_number}` : 'Your order';
        statusEl.textContent = `${orderLabel} placed! We will confirm soon.`;
        statusEl.style.color = 'var(--color-accent)';
        statusEl.classList.remove('hidden');

        // Save customer details to localStorage for future orders
        const savedDetails = {
          name,
          phone,
          email,
          address,
          isDelivery,
          distance: km,
          selectedDeliveryArea
        };
        localStorage.setItem('limra-customer-details', JSON.stringify(savedDetails));
        initSavedAddressLoading(); // Refresh loading state
        
        // Activate notifications listening immediately for checkout phone
        startNotificationListening();

        // Send Automatic HTML Email Receipt to Customer
        if (email) {
          try {
            const orderItemsMap = cartSnapshot.map(item => ({
              item_name: item.name,
              quantity: item.qty,
              unit_price: item.price,
              line_total: item.price * item.qty
            }));
            const emailHtml = generateOrderPlacedHtml(order, orderItemsMap);
            await sendEmailNotification(email, `🛒 Order #${order.order_number} Received - LIMRA Restaurant`, emailHtml);
          } catch (emailErr) {
            console.warn('[Checkout] Background automatic email notification failed:', emailErr);
          }
        }

        // WhatsApp Confirmation Link
        let waMsg = `Hello! My order is placed successfully at SK Arif (Limra Restaurant).\n\n*Order Details:*\n• Name: ${name}\n• Phone: ${phone}\n• Email: ${email || 'None'}\n`;
        let orderItemsText = '';
        cartSnapshot.forEach(item => {
          const totalVal = item.price * item.qty;
          const formattedPrice = totalVal < 0 ? `-₹${Math.abs(totalVal)}` : `₹${totalVal}`;
          orderItemsText += `• ${item.name} x${item.qty} = ${formattedPrice}\n`;
        });
        orderItemsText += `\n*Subtotal: ₹${subtotal}*`;
        if (isDelivery) {
          if (selectedDeliveryArea && selectedDeliveryArea !== 'custom') {
            const areaLabel = selectedDeliveryArea.charAt(0).toUpperCase() + selectedDeliveryArea.slice(1);
            orderItemsText += `\n🛵 *Delivery Charge: ₹${charge}* (Area: ${areaLabel})`;
          } else {
            orderItemsText += `\n*Delivery Charge: ₹${charge}*`;
          }
          orderItemsText += `\n*Taxes (5% GST Incl.): ₹${taxes}*`;
          orderItemsText += `\n*Grand Total: ₹${getCartTotal()}*`;
          if (address) orderItemsText += `\n📍 *Deliver to:* ${address}`;
        } else {
          orderItemsText += `\n*Taxes (5% GST Incl.): ₹${taxes}*`;
          orderItemsText += `\n*Total: ₹${getCartTotal()}* (Self Pickup — Free)`;
        }
        orderItemsText += `\n💳 *Payment Mode:* ${payment}`;
        waMsg += orderItemsText + `\n\nMy order is successfully booked. Please confirm my order and contact me as soon as possible! Thank you! 🙏`;
        const waUrl = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(waMsg)}`;

        // Email (mailto) Link
        const emailSubject = `Order Confirmed successfully! - SK Arif (${orderLabel})`;
        let emailBody = `Dear Restaurant Management,\n\nI have successfully placed an order on your website.\n\nOrder Details:\n---------------------------------------------\nReference: ${orderLabel}\nName: ${name}\nPhone: ${phone}\nEmail: ${email || 'None'}\n`;
        if (isDelivery) {
          emailBody += `Delivery Address: ${address}\n`;
          emailBody += `Delivery Charge: Rs ${charge}\n`;
        } else {
          emailBody += `Delivery Option: Self Pickup (Free)\n`;
        }
        emailBody += `Payment Mode: ${payment}\n`;
        emailBody += `\nOrder Summary:\n`;
        cartSnapshot.forEach(item => {
          const totalVal = item.price * item.qty;
          const formattedPrice = totalVal < 0 ? `-Rs ${Math.abs(totalVal)}` : `Rs ${totalVal}`;
          emailBody += `• ${item.name} x${item.qty} = ${formattedPrice}\n`;
        });
        emailBody += `\nSubtotal: Rs ${subtotal}\nTaxes (5% GST Incl.): Rs ${taxes}\nGrand Total: Rs ${getCartTotal()}\n---------------------------------------------\n\nMy order is successfully booked. Please contact me as soon as possible to confirm and deliver.\n\nBest regards,\n${name}`;
        const emailUrl = `mailto:limrarestaurant99@gmail.com?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

        // Show Success Modal
        showSuccessModal({
          title: `${orderLabel} Placed Successfully!`,
          message: `Your order has been successfully recorded in our system. You can get an email receipt or view your order status below.`,
          emailUrl
        });

        // Trigger active tracking view
        subscribeToOrderUpdates(order.id, order.order_number);

        clearCart();
        document.getElementById('order-customer-name').value = '';
        document.getElementById('order-customer-phone').value = '';
        document.getElementById('order-customer-email').value = '';
        if (document.getElementById('order-address')) document.getElementById('order-address').value = '';
        if (document.getElementById('order-distance')) document.getElementById('order-distance').value = '';
        const areaSelect = document.getElementById('order-delivery-area');
        if (areaSelect) areaSelect.value = '';
        selectedDeliveryArea = '';
        document.getElementById('order-notes').value = '';
        deliveryKm = 0;
        showStep(1); // Reset to step 1
        setTimeout(() => statusEl.classList.add('hidden'), 5000);
      } catch (err) {
        console.error('Order error:', err);
        const detail = err?.message || 'Please try again.';
        statusEl.textContent = `Order failed: ${detail}`;
        statusEl.style.color = 'var(--color-red-badge)';
        statusEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Place Order`;
      }
    };

    function ensureRazorpayLoaded() {
      return new Promise((resolve, reject) => {
        if (typeof window !== 'undefined' && window.Razorpay) {
          return resolve(window.Razorpay);
        }
        const existingScript = document.querySelector('script[src*="checkout.razorpay.com"]');
        if (existingScript) {
          existingScript.addEventListener('load', () => resolve(window.Razorpay));
          existingScript.addEventListener('error', () => reject(new Error('Razorpay SDK failed to load')));
          // If script tag already exists and loaded
          if (window.Razorpay) return resolve(window.Razorpay);
          return;
        }
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.onload = () => resolve(window.Razorpay);
        script.onerror = () => reject(new Error('Failed to load Razorpay payment SDK'));
        document.head.appendChild(script);
      });
    }

    if (payment === 'Online Payment (Razorpay)' || payment === 'online' || payment.toLowerCase().includes('razorpay') || payment.toLowerCase().includes('online')) {
      try {
        const grandTotal = getCartTotal();
        const amountInPaise = Math.round(grandTotal * 100);

        if (amountInPaise < 100) {
          showToast('Minimum transaction amount is ₹1.00', 'error');
          btn.disabled = false;
          btn.innerHTML = `<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Place Order`;
          return;
        }

        // 1. Create order on Razorpay backend
        const orderRes = await fetch('/api/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amountInPaise,
            currency: 'INR',
            receipt: 'rec_' + Date.now().toString().substring(5)
          })
        });

        if (!orderRes.ok) {
          const errData = await orderRes.json();
          throw new Error(errData.error || 'Failed to create Razorpay order');
        }

        const rzpOrder = await orderRes.json();
        const RazorpaySDK = await ensureRazorpayLoaded();

        // 2. Open Razorpay Checkout Modal
        const options = {
          key: rzpOrder.key_id || import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_TBmsInWXVkKowt',
          amount: rzpOrder.amount,
          currency: rzpOrder.currency,
          name: 'LIMRA Restaurant',
          description: 'Secure Food Order Checkout',
          order_id: rzpOrder.order_id,
          prefill: {
            name: name,
            contact: phone,
            email: email || ''
          },
          theme: {
            color: '#c8860a'
          },
          handler: async function (response) {
            try {
              btn.innerHTML = `
                <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg> Verifying payment...
              `;

              // 3. Verify Payment Signature on backend
              const verifyRes = await fetch('/api/verify-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature
                })
              });

              if (!verifyRes.ok) {
                const errData = await verifyRes.json();
                throw new Error(errData.error || 'Payment signature verification failed.');
              }

              const verifyData = await verifyRes.json();

              if (verifyData.success) {
                showToast('Payment verified! Placing your order...', 'success');
                // 4. Save and complete order in database
                await saveAndCompleteOrder(response.razorpay_payment_id);
              } else {
                showToast('Signature verification failed. Please contact support.', 'error');
                btn.disabled = false;
                btn.innerHTML = `<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Retry Order`;
              }
            } catch (err) {
              showToast('Payment verification failed: ' + err.message, 'error');
              btn.disabled = false;
              btn.innerHTML = `<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Retry Order`;
            }
          },
          modal: {
            ondismiss: function () {
              // Silent dismiss — no alert
              showToast('Payment cancelled. Your cart is saved.', 'info');
              btn.disabled = false;
              btn.innerHTML = `<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Place Order`;
            }
          }
        };

        const rzp = new RazorpaySDK(options);
        rzp.on('payment.failed', function (resp) {
          showToast('Payment failed: ' + resp.error.description, 'error');
          btn.disabled = false;
          btn.innerHTML = `<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Retry Order`;
        });

        rzp.open();
      } catch (err) {
        showToast('Could not initialize payment: ' + err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Place Order`;
      }
      return;
    }

    // Direct Cash/Card execution
    await saveAndCompleteOrder();
  });

  // Init all modules
  initLanguageSystem();
  initMenuTabs();
  initBookingTabs();
  initBookingForms();
  initCustomerBookingLookup();
  initSeatSelection();
  initGallery();
  initHeader();
  initMobileNav();
  initBottomNav();
  initPromoCarousel();
  initSearchDropdown();
  initStickyTabBar();
  initPaymentTiles();
  initSmoothScroll();
  initBackToTop();
  initSavedAddressLoading();
  initAuthPanel();
  initCustomerNotifications();

  // Sync Party Booking Budget Range Slider dynamically
  const slider = document.getElementById('party-budget-slider');
  const valSpan = document.getElementById('party-budget-val');
  const hiddenInput = document.getElementById('party-budget-hidden');
  if (slider && valSpan && hiddenInput) {
    const updateBudget = () => {
      const val = parseInt(slider.value);
      valSpan.textContent = val.toLocaleString('en-IN');
      hiddenInput.value = `₹${val.toLocaleString('en-IN')}`;
    };
    slider.addEventListener('input', updateBudget);
    updateBudget();
  }

  // Set min date for booking forms
  const today = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach(input => {
    input.min = today;
  });

  // Offline/Online network status listeners
  function initNetworkListener() {
    const statusDiv = document.createElement('div');
    statusDiv.id = 'network-status-toast';
    statusDiv.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: #1f2937;
      color: #f3f4f6;
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.1);
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 9999;
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), background 0.3s ease;
    `;
    document.body.appendChild(statusDiv);

    function updateNetworkStatus() {
      if (navigator.onLine) {
        statusDiv.style.background = '#10b981'; // Green
        statusDiv.innerHTML = '⚡ <span>Back online!</span>';
        setTimeout(() => {
          statusDiv.style.transform = 'translateX(-50%) translateY(100px)';
        }, 2000);
      } else {
        statusDiv.style.background = '#ef4444'; // Red
        statusDiv.innerHTML = '<span class="animate-spin mr-1">⏳</span> <span>Connection lost. Reconnecting...</span>';
        statusDiv.style.transform = 'translateX(-50%) translateY(0)';
      }
    }

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    if (!navigator.onLine) {
      updateNetworkStatus();
    }
  }
  initNetworkListener();
});
// ═══════════════════════════════════════
// MENU BOARD PHOTO LIGHTBOX
// ═══════════════════════════════════════
window.openMenuPhoto = function(src) {
  const lb = document.getElementById('menu-lightbox');
  const img = document.getElementById('menu-lightbox-img');
  if (!lb || !img) return;
  img.src = src;
  lb.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

window.closeMenuPhoto = function() {
  const lb = document.getElementById('menu-lightbox');
  if (!lb) return;
  lb.classList.add('hidden');
  document.body.style.overflow = '';
};

window.closeMenuLightbox = function(e) {
  if (e.target === document.getElementById('menu-lightbox')) window.closeMenuPhoto();
};

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') window.closeMenuPhoto();
});

// ═══════════════════════════════════════
// CUSTOMER AUTH & SAVED PROFILE MANAGEMENT
// ═══════════════════════════════════════
let currentUser = null;
let userProfile = null;

async function initAuthPanel() {
  const userBtn = document.getElementById('user-profile-btn');
  const mobileLink = document.getElementById('mobile-profile-link');
  const closeBtn = document.getElementById('auth-close-btn');
  const overlay = document.getElementById('auth-overlay');
  const drawer = document.getElementById('auth-drawer');

  if (!drawer) return;

  const openDrawer = () => {
    drawer.classList.remove('closed');
    drawer.classList.add('open');
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.remove('opacity-0'), 50);
  };

  const closeDrawer = () => {
    drawer.classList.remove('open');
    drawer.classList.add('closed');
    overlay.classList.add('opacity-0');
    setTimeout(() => overlay.classList.add('hidden'), 300);
  };

  userBtn?.addEventListener('click', openDrawer);
  mobileLink?.addEventListener('click', (e) => {
    e.preventDefault();
    openDrawer();
  });
  closeBtn?.addEventListener('click', closeDrawer);
  overlay?.addEventListener('click', closeDrawer);

  // Tab Switcher
  const tabSignin = document.getElementById('tab-signin-btn');
  const tabSignup = document.getElementById('tab-signup-btn');
  const formSignin = document.getElementById('form-signin');
  const formSignup = document.getElementById('form-signup');

  const signinIdentifierInput = document.getElementById('signin-identifier');
  const signinPasswordGroup = document.getElementById('signin-password-group');
  const signinPasswordInput = document.getElementById('signin-password');
  const btnGotoForgot = document.getElementById('btn-goto-forgot');

  const signupIdentifierInput = document.getElementById('signup-identifier');
  const signupPasswordGroup = document.getElementById('signup-password-group');
  const signupPasswordInput = document.getElementById('signup-password');

  function resetSignupFormStep() {
    if (formSignup) formSignup.reset();
    signupPasswordGroup?.classList.remove('hidden');
    signupPasswordInput?.setAttribute('required', '');
    signupIdentifierInput?.dispatchEvent(new Event('input'));
  }

  signinIdentifierInput?.addEventListener('input', () => {
    const val = signinIdentifierInput.value.trim();
    const detected = detectInputType(val);
    if (detected && detected.type === 'phone') {
      signinPasswordGroup?.classList.add('hidden');
      signinPasswordInput?.removeAttribute('required');
      btnGotoForgot?.classList.add('hidden');
    } else {
      signinPasswordGroup?.classList.remove('hidden');
      signinPasswordInput?.setAttribute('required', '');
      btnGotoForgot?.classList.remove('hidden');
    }
  });

  signupIdentifierInput?.addEventListener('input', () => {
    const val = signupIdentifierInput.value.trim();
    const detected = detectInputType(val);
    if (detected && detected.type === 'phone') {
      signupPasswordGroup?.classList.add('hidden');
      signupPasswordInput?.removeAttribute('required');
    } else {
      signupPasswordGroup?.classList.remove('hidden');
      signupPasswordInput?.setAttribute('required', '');
    }
  });

  tabSignin?.addEventListener('click', () => {
    tabSignin.className = 'flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-slate-800 bg-white shadow-sm';
    tabSignup.className = 'flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-slate-500';
    formSignin.classList.remove('hidden');
    formSignup.classList.add('hidden');
    resetSignupFormStep();
  });

  tabSignup?.addEventListener('click', () => {
    tabSignup.className = 'flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-slate-800 bg-white shadow-sm';
    tabSignin.className = 'flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-slate-500';
    formSignup.classList.remove('hidden');
    formSignin.classList.add('hidden');
    resetSignupFormStep();
  });

  // Signup method toggle (Email vs Phone)
  let signupIdentifier = '';
  let signupPassword = '';
  let signupMethod = ''; // 'email' or 'phone'
  let signupOtpCode = '';

  let forgotIdentifier = '';
  let forgotMethod = '';
  let forgotOtpCode = '';

  function showAuthView(viewName) {
    formSignin.classList.add('hidden');
    formSignup.classList.add('hidden');
    document.getElementById('auth-verification-view')?.classList.add('hidden');
    document.getElementById('auth-forgot-view')?.classList.add('hidden');
    document.getElementById('auth-error-msg')?.classList.add('hidden');

    if (viewName === 'signin') {
      formSignin.classList.remove('hidden');
      tabSignin.className = 'flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-slate-800 bg-white shadow-sm';
      tabSignup.className = 'flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-slate-500';
    } else if (viewName === 'signup') {
      formSignup.classList.remove('hidden');
      tabSignup.className = 'flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-slate-800 bg-white shadow-sm';
      tabSignin.className = 'flex-1 py-2 text-xs font-semibold rounded-lg transition-all text-slate-500';
    } else if (viewName === 'verification') {
      document.getElementById('auth-verification-view')?.classList.remove('hidden');
    } else if (viewName === 'forgot') {
      document.getElementById('auth-forgot-view')?.classList.remove('hidden');
    }
  }

  // Override top tabs click handlers
  tabSignin?.addEventListener('click', () => {
    showAuthView('signin');
  });

  tabSignup?.addEventListener('click', () => {
    showAuthView('signup');
  });

  // Password Show/Hide toggles
  const btnSigninTogglePassword = document.getElementById('btn-signin-toggle-password');
  btnSigninTogglePassword?.addEventListener('click', () => {
    const isPass = signinPasswordInput.type === 'password';
    signinPasswordInput.type = isPass ? 'text' : 'password';
    btnSigninTogglePassword.textContent = isPass ? 'Hide' : 'Show';
  });

  const btnSignupTogglePassword = document.getElementById('btn-signup-toggle-password');
  btnSignupTogglePassword?.addEventListener('click', () => {
    const isPass = signupPasswordInput.type === 'password';
    signupPasswordInput.type = isPass ? 'text' : 'password';
    btnSignupTogglePassword.textContent = isPass ? 'Hide' : 'Show';
  });

  const forgotNewPasswordInput = document.getElementById('forgot-new-password');
  const btnForgotTogglePassword = document.getElementById('btn-forgot-toggle-password');
  btnForgotTogglePassword?.addEventListener('click', () => {
    const isPass = forgotNewPasswordInput.type === 'password';
    forgotNewPasswordInput.type = isPass ? 'text' : 'password';
    btnForgotTogglePassword.textContent = isPass ? 'Hide' : 'Show';
  });

  // Navigation handlers between auth sub-views
  document.getElementById('btn-goto-forgot')?.addEventListener('click', () => {
    showAuthView('forgot');
    document.getElementById('form-forgot-step1').classList.remove('hidden');
    document.getElementById('form-forgot-step2').classList.add('hidden');
  });

  document.getElementById('btn-back-to-login')?.addEventListener('click', () => {
    showAuthView('signin');
  });

  document.getElementById('btn-back-to-signup')?.addEventListener('click', () => {
    showAuthView('signup');
  });

  // Input Type Detection helper
  function detectInputType(val) {
    const trimmed = val.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(trimmed)) {
      return { type: 'email', value: trimmed };
    }
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) {
      const cleanPhone = digits.slice(-10);
      return { type: 'phone', value: cleanPhone };
    }
    return null;
  }

  // Display Errors helper
  const errorMsg = document.getElementById('auth-error-msg');
  const displayError = (msg) => {
    if (errorMsg) {
      errorMsg.textContent = msg;
      errorMsg.classList.remove('hidden');
      setTimeout(() => errorMsg.classList.add('hidden'), 6000);
    } else {
      alert(msg);
    }
  };

  // 1. Sign Up Handler
  document.getElementById('form-signup')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawVal = document.getElementById('signup-identifier').value.trim();

    const detected = detectInputType(rawVal);
    if (!detected) {
      alert('Please enter a valid email address or 10-digit mobile number.');
      return;
    }

    signupMethod = detected.type;
    signupIdentifier = detected.value;

    if (signupMethod === 'phone') {
      signupPassword = signupIdentifier;
    } else {
      signupPassword = document.getElementById('signup-password').value;
      if (signupPassword.length < 8) {
        alert('Password must be at least 8 characters long.');
        return;
      }
    }

    const submitBtn = document.getElementById('btn-signup-action');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';

    if (signupMethod === 'email') {
      try {
        const { data, error } = await insforge.auth.signUp({
          email: signupIdentifier,
          password: signupPassword,
          name: 'Customer'
        });

        if (error) {
          if (error.message && error.message.toLowerCase().includes('already exists')) {
            throw new Error('An account with this email or phone number already exists.');
          }
          throw error;
        }

        document.getElementById('verification-msg').textContent = 'We have sent a verification code to your email address.';
        showAuthView('verification');
        document.getElementById('verification-otp').focus();
      } catch (err) {
        displayError(err.message || 'Signup failed.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Register Account ➔';
      }
    } else {
      try {
        const { data: code, error } = await insforge.database.rpc('send_phone_signup_code', {
          p_phone: signupIdentifier
        });

        if (error) {
          if (error.message && error.message.toLowerCase().includes('already exists')) {
            throw new Error('An account with this email or phone number already exists.');
          }
          throw error;
        }

        signupOtpCode = code;
        console.log(`[LIMRA-SMS-Mock] Verification code for ${signupIdentifier}: ${signupOtpCode}`);

        alert(`💬 SMS Message • +91 ${signupIdentifier}\n\n[LIMRA Restaurant] Your verification OTP code is ${signupOtpCode}. This code expires in 5 minutes.`);

        document.getElementById('verification-msg').textContent = 'We have sent a verification code to your mobile number.';
        showAuthView('verification');
        document.getElementById('verification-otp').focus();
      } catch (err) {
        displayError(err.message || 'Signup failed.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Register Account ➔';
      }
    }
  });

  // 2. OTP Verification Handler
  document.getElementById('form-verify')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const enteredOtp = document.getElementById('verification-otp').value.trim();
    if (enteredOtp.length !== 6) {
      alert('Please enter a 6-digit verification code.');
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying...';

    if (signupMethod === 'email') {
      try {
        const { data, error } = await insforge.auth.verifyEmail({
          email: signupIdentifier,
          otp: enteredOtp
        });

        if (error) {
          if (error.message && error.message.toLowerCase().includes('expired')) {
            throw new Error('Verification code expired. Please request a new code.');
          } else {
            throw new Error('Incorrect verification code.');
          }
        }

        const { data: existingProfile } = await insforge.database
          .from('customer_profiles')
          .select('id')
          .eq('id', data.user.id);

        if (!existingProfile || existingProfile.length === 0) {
          const profileData = {
            id: data.user.id,
            name: 'Customer',
            phone: '',
            email: signupIdentifier,
            email_verified: true,
            address: ''
          };
          await insforge.database.from('customer_profiles').insert([profileData]);
        }

        alert('Registration Successful\n\nYou are now registered and signed in.');
        await checkAuthStatus();
        closeDrawer();
      } catch (err) {
        alert(err.message || 'Verification failed.');
      } finally {
        submitBtn.disabled = false;
      }
    } else {
      if (enteredOtp !== signupOtpCode) {
        alert('Incorrect verification code.');
        submitBtn.disabled = false;
        return;
      }

      const mockEmail = `${signupIdentifier}@limraresturent.in`;
      const mockPassword = signupPassword;

      try {
        const regRes = await insforge.auth.signUp({
          email: mockEmail,
          password: mockPassword,
          name: 'Customer'
        });
        if (regRes.error) throw regRes.error;

        const loginRes = await insforge.auth.signInWithPassword({
          email: mockEmail,
          password: mockPassword
        });
        if (loginRes.error) throw loginRes.error;

        const { data: existingProfile } = await insforge.database
          .from('customer_profiles')
          .select('id')
          .eq('id', loginRes.data.user.id);

        if (!existingProfile || existingProfile.length === 0) {
          const profileData = {
            id: loginRes.data.user.id,
            name: 'Customer',
            phone: signupIdentifier,
            email: null,
            phone_verified: true,
            address: ''
          };
          await insforge.database.from('customer_profiles').insert([profileData]);
        }

        // Clean up temporary phone verification row
        try {
          await insforge.database.query("DELETE FROM public.phone_verifications WHERE phone = $1", [signupIdentifier]);
        } catch (e) {}

        alert('Registration Successful\n\nYou are now registered and signed in.');
        await checkAuthStatus();
        closeDrawer();
      } catch (err) {
        alert('Registration failed: ' + (err.message || err));
      } finally {
        submitBtn.disabled = false;
      }
    }
  });

  // 3. Resend OTP Handler
  document.getElementById('btn-resend-otp')?.addEventListener('click', async () => {
    const resendBtn = document.getElementById('btn-resend-otp');
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending...';

    if (signupMethod === 'email') {
      try {
        await insforge.auth.resendVerificationEmail({
          email: signupIdentifier,
          redirectTo: window.location.origin
        });
        alert('A new verification code has been sent to your email address.');
      } catch (err) {
        alert(err.message || 'Resend failed.');
      } finally {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend Code';
      }
    } else {
      try {
        const { data: code, error } = await insforge.database.rpc('send_phone_signup_code', {
          p_phone: signupIdentifier
        });
        if (error) throw error;

        signupOtpCode = code;
        alert(`💬 SMS Message • +91 ${signupIdentifier}\n\n[LIMRA Restaurant] Your verification OTP code is ${signupOtpCode}. This code expires in 5 minutes.`);
      } catch (err) {
        alert(err.message || 'Resend failed.');
      } finally {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend Code';
      }
    }
  });

  // 4. Forgot Password - Send Code Handler
  document.getElementById('form-forgot-step1')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawVal = document.getElementById('forgot-identifier').value.trim();

    const detected = detectInputType(rawVal);
    if (!detected) {
      alert('Please enter a valid email address or 10-digit mobile number.');
      return;
    }

    forgotMethod = detected.type;
    forgotIdentifier = detected.value;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    if (forgotMethod === 'email') {
      try {
        const { error } = await insforge.auth.sendResetPasswordEmail({
          email: forgotIdentifier,
          redirectTo: window.location.origin
        });
        if (error) throw error;

        document.getElementById('forgot-step2-msg').textContent = 'We have sent a verification code to your email address.';
        document.getElementById('form-forgot-step1').classList.add('hidden');
        document.getElementById('form-forgot-step2').classList.remove('hidden');
        document.getElementById('forgot-otp').focus();
      } catch (err) {
        alert(err.message || 'Failed to send reset code.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Reset Code';
      }
    } else {
      try {
        const { data: code, error } = await insforge.database.rpc('send_phone_reset_code', {
          p_phone: forgotIdentifier
        });
        if (error) {
          if (error.message && error.message.toLowerCase().includes('does not exist')) {
            throw new Error('Account with this phone number does not exist.');
          }
          throw error;
        }

        forgotOtpCode = code;
        alert(`💬 SMS Message • +91 ${forgotIdentifier}\n\n[LIMRA Restaurant] Your password reset verification OTP is ${forgotOtpCode}. Expires in 5 minutes.`);

        document.getElementById('forgot-step2-msg').textContent = 'We have sent a verification code to your mobile number.';
        document.getElementById('form-forgot-step1').classList.add('hidden');
        document.getElementById('form-forgot-step2').classList.remove('hidden');
        document.getElementById('forgot-otp').focus();
      } catch (err) {
        alert(err.message || 'Failed to send reset code.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Reset Code';
      }
    }
  });

  // 5. Forgot Password - Verify and Update Handler
  document.getElementById('form-forgot-step2')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const enteredOtp = document.getElementById('forgot-otp').value.trim();
    const newPassword = document.getElementById('forgot-new-password').value;

    if (enteredOtp.length !== 6) {
      alert('Please enter a 6-digit verification code.');
      return;
    }
    if (newPassword.length < 8) {
      alert('Password must be at least 8 characters long.');
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Resetting...';

    if (forgotMethod === 'email') {
      try {
        const exRes = await insforge.auth.exchangeResetPasswordToken({
          email: forgotIdentifier,
          code: enteredOtp
        });
        if (exRes.error) {
          if (exRes.error.message && exRes.error.message.toLowerCase().includes('expired')) {
            throw new Error('Verification code expired. Please request a new code.');
          } else {
            throw new Error('Incorrect verification code.');
          }
        }

        const token = exRes.data.token;

        const resetRes = await insforge.auth.resetPassword({
          newPassword: newPassword,
          otp: token
        });
        if (resetRes.error) throw resetRes.error;

        alert('Password updated successfully.');
        await checkAuthStatus();
        closeDrawer();
      } catch (err) {
        alert(err.message || 'Password reset failed.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reset Password & Sign In';
      }
    } else {
      try {
        const { data: success, error } = await insforge.database.rpc('verify_phone_reset_password', {
          p_phone: forgotIdentifier,
          p_code: enteredOtp,
          p_new_password: newPassword
        });

        if (error) {
          if (error.message && error.message.toLowerCase().includes('expired')) {
            throw new Error('Verification code expired. Please request a new code.');
          } else {
            throw new Error('Incorrect verification code.');
          }
        }

        alert('Password updated successfully.');

        const mockEmail = `${forgotIdentifier}@limraresturent.in`;
        await insforge.auth.signInWithPassword({
          email: mockEmail,
          password: newPassword
        });

        await checkAuthStatus();
        closeDrawer();
      } catch (err) {
        alert(err.message || 'Password reset failed.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reset Password & Sign In';
      }
    }
  });

  // 6. Sign In Handler
  document.getElementById('form-signin')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawVal = document.getElementById('signin-identifier').value.trim();

    const detected = detectInputType(rawVal);
    if (!detected) {
      alert('Please enter a valid email address or 10-digit mobile number.');
      return;
    }

    const password = detected.type === 'phone' ? detected.value : document.getElementById('signin-password').value;
    if (!password) {
      alert('Password is required.');
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    let email = detected.value;
    if (detected.type === 'phone') {
      email = `${detected.value}@limraresturent.in`;
    }

    try {
      const { data, error } = await insforge.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message && (error.message.toLowerCase().includes('invalid') || error.message.toLowerCase().includes('incorrect'))) {
          throw new Error('Incorrect password.');
        }
        throw error;
      }
      
      await checkAuthStatus();
      alert('Welcome to LIMRA Restaurant! You are now signed in.');
      closeDrawer();
    } catch (err) {
      displayError(err.message || 'Login failed. Please verify email/password.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In ➔';
    }
  });

  // 3. Google OAuth Handler
  document.getElementById('oauth-google-btn')?.addEventListener('click', async () => {
    try {
      await insforge.auth.signInWithOAuth({
        provider: 'google',
        redirectTo: window.location.origin
      });
    } catch (err) {
      displayError(err.message || 'Google Auth redirection failed.');
    }
  });

  // 4. Log Out Handler
  document.getElementById('auth-logout-btn')?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to sign out?')) return;
    await insforge.auth.signOut();
    currentUser = null;
    userProfile = null;
    
    // Clear notifications subscriptions and state
    if (realtimeSubscribedPhone) {
      try {
        insforge.realtime.unsubscribe(`customer-notifications:${realtimeSubscribedPhone}`);
      } catch (err) {}
      realtimeSubscribedPhone = null;
    }
    if (pollingIntervalId) {
      clearInterval(pollingIntervalId);
      pollingIntervalId = null;
    }
    // Reset notification header elements
    const badgeEl = document.getElementById('customer-notif-badge');
    const countEl = document.getElementById('customer-notif-count');
    const listEl = document.getElementById('customer-notif-items');
    if (badgeEl) badgeEl.classList.add('hidden');
    if (countEl) countEl.textContent = '';
    if (listEl) listEl.innerHTML = `<p class="p-6 text-center text-xs text-slate-400 italic">No notifications yet</p>`;
    
    renderAuthUI();
    
    // Clear checkout inputs
    document.getElementById('order-customer-name').value = '';
    document.getElementById('order-customer-phone').value = '';
    document.getElementById('order-customer-email').value = '';
    if (document.getElementById('order-address')) {
      document.getElementById('order-address').value = '';
    }
    updateCartUI();
    
    alert('Signed out successfully.');
    closeDrawer();
  });

  // 5. Save Profile details
  document.getElementById('form-profile-details')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const phone = document.getElementById('profile-phone').value.trim();
    const address = document.getElementById('profile-address').value.trim();

    if (!phone || !address) {
      alert('Please fill out both phone and address fields.');
      return;
    }

    const saveBtn = document.getElementById('profile-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving details...';

    try {
      const profileUpdate = {
        id: currentUser.id,
        name: currentUser.name || userProfile?.name || 'Guest Client',
        phone,
        address,
        email: (currentUser.email && currentUser.email.endsWith('@limraresturent.in')) ? null : (currentUser.email || null),
        latitude: mapSelectedLat || userProfile?.latitude || null,
        longitude: mapSelectedLng || userProfile?.longitude || null,
        landmark: document.getElementById('order-landmark')?.value || userProfile?.landmark || null,
        delivery_notes: document.getElementById('order-delivery-notes')?.value || userProfile?.delivery_notes || null,
        location_verified: (document.getElementById('order-location-verified')?.value === 'true') || userProfile?.location_verified || false
      };

      const { error } = await insforge.database
        .from('customer_profiles')
        .upsert([profileUpdate]);

      if (error) throw error;

      userProfile = profileUpdate;
      
      // Auto-prefill the Checkout details
      document.getElementById('order-customer-name').value = userProfile.name;
      document.getElementById('order-customer-phone').value = userProfile.phone;
      document.getElementById('order-customer-email').value = userProfile.email;
      if (document.getElementById('order-address')) {
        document.getElementById('order-address').value = userProfile.address;
      }
      updateCartUI();

      alert('Permanent contact details and address saved successfully!');
      await loadUserHistory();
    } catch (err) {
      alert('Failed to save profile: ' + (err.message || err));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Profile Details';
    }
  });

  // Initialize checks
  await checkAuthStatus();
}

async function checkAuthStatus() {
  try {
    const { data } = await insforge.auth.getCurrentUser();
    const user = data?.user || null;
    currentUser = user;
    
    if (user) {
      const { data: profiles, error } = await insforge.database
        .from('customer_profiles')
        .select('*')
        .eq('id', user.id);
        
      if (!error && profiles && profiles.length > 0) {
        userProfile = profiles[0];
        if (userProfile.email && userProfile.email.endsWith('@limraresturent.in')) {
          userProfile.email = null;
        }
      } else {
        const isMockEmail = user.email && user.email.endsWith('@limraresturent.in');
        userProfile = {
          id: user.id,
          name: user.name || 'Guest Client',
          phone: isMockEmail ? user.email.split('@')[0] : '',
          address: '',
          email: isMockEmail ? null : user.email
        };
      }
      
      // Auto-fill checkout fields immediately
      if (userProfile.name) document.getElementById('order-customer-name').value = userProfile.name;
      if (userProfile.phone) document.getElementById('order-customer-phone').value = userProfile.phone;
      if (userProfile.email) {
        document.getElementById('order-customer-email').value = userProfile.email;
      } else {
        document.getElementById('order-customer-email').value = '';
      }
      if (userProfile.address && document.getElementById('order-address')) {
        document.getElementById('order-address').value = userProfile.address;
      }
      if (userProfile.landmark && document.getElementById('order-landmark')) {
        document.getElementById('order-landmark').value = userProfile.landmark;
      }
      if (userProfile.delivery_notes && document.getElementById('order-delivery-notes')) {
        document.getElementById('order-delivery-notes').value = userProfile.delivery_notes;
      }
      if (userProfile.latitude && document.getElementById('order-latitude')) {
        document.getElementById('order-latitude').value = userProfile.latitude;
        mapSelectedLat = parseFloat(userProfile.latitude);
      }
      if (userProfile.longitude && document.getElementById('order-longitude')) {
        document.getElementById('order-longitude').value = userProfile.longitude;
        mapSelectedLng = parseFloat(userProfile.longitude);
      }
      if (userProfile.location_verified !== undefined && document.getElementById('order-location-verified')) {
        document.getElementById('order-location-verified').value = userProfile.location_verified ? 'true' : 'false';
        updateLocationBadge(userProfile.location_verified);
      }
      updateCartUI();

      // Load past orders
      await loadUserHistory();
    }
    
    renderAuthUI();
    // Start notifications listener for logged-in user or active guest
    startNotificationListening();
  } catch (err) {
    console.warn('Auth check failed:', err);
  }
}

function renderAuthUI() {
  const loggedOutView = document.getElementById('auth-logged-out-view');
  const loggedInView = document.getElementById('auth-logged-in-view');
  const loggedInDot = document.getElementById('user-logged-in-dot');

  if (currentUser) {
    loggedOutView?.classList.add('hidden');
    loggedInView?.classList.remove('hidden');
    loggedInDot?.classList.remove('hidden');

    const displayName = document.getElementById('profile-display-name');
    const displayEmail = document.getElementById('profile-display-email');
    const profilePhone = document.getElementById('profile-phone');
    const profileAddress = document.getElementById('profile-address');

    if (displayName) displayName.textContent = currentUser.name || userProfile?.name || 'Guest Client';
    if (displayEmail) {
      if (currentUser.email && currentUser.email.endsWith('@limraresturent.in')) {
        displayEmail.textContent = userProfile?.phone || currentUser.email.split('@')[0];
      } else {
        displayEmail.textContent = currentUser.email;
      }
    }
    if (profilePhone) profilePhone.value = userProfile?.phone || '';
    if (profileAddress) profileAddress.value = userProfile?.address || '';
  } else {
    loggedOutView?.classList.remove('hidden');
    loggedInView?.classList.add('hidden');
    loggedInDot?.classList.add('hidden');
  }
}

async function loadUserHistory() {
  const listEl = document.getElementById('profile-orders-list');
  if (!listEl) return;

  try {
    const phone = userProfile?.phone || '';
    if (!phone) {
      listEl.innerHTML = `<p class="text-xs text-slate-400 italic text-center">Save your phone number above to sync your order logs!</p>`;
      return;
    }

    const orders = await getCustomerOrders(phone);
    
    if (orders.length === 0) {
      listEl.innerHTML = `<p class="text-xs text-slate-400 italic text-center">No orders placed under this phone number yet.</p>`;
    } else {
      listEl.innerHTML = orders.slice(0, 5).map(o => {
        let badgeColor = 'bg-amber-50 text-amber-600 border-amber-200';
        if (o.status === 'delivered') badgeColor = 'bg-emerald-50 text-emerald-600 border-emerald-200';
        if (o.status === 'cancelled') badgeColor = 'bg-red-50 text-red-600 border-red-200';

        // Payment status badge
        const isPaid = (o.payment_status === 'paid');
        const payBadgeColor = isPaid 
          ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
          : 'bg-red-50 text-red-600 border-red-200';
        const payBadgeText = isPaid ? 'PAID' : 'UNPAID';

        let itemsSummary = o.items ? o.items.map(i => `${i.quantity}x ${i.item_name}`).join(', ') : '1x Dinner Special';

        return `
          <div class="order-log-card cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-all rounded-xl border p-3 text-[11px] space-y-1 bg-white" 
               data-order-id="${o.id}" 
               data-order-number="${o.order_number}" 
               style="border-color:var(--color-border)">
            <div class="flex justify-between items-center font-bold">
              <span class="text-slate-800 flex items-center gap-1">
                Order #${o.order_number}
                <span class="text-[9px] text-slate-400 font-normal hover:text-slate-600 flex items-center gap-0.5">
                  🔍 Track
                </span>
              </span>
              <div class="flex items-center gap-1.5">
                <span class="status-badge ${payBadgeColor} border px-2 py-0.5 rounded-full text-[9px]">${payBadgeText}</span>
                <span class="status-badge ${badgeColor} border px-2 py-0.5 rounded-full text-[9px]">${o.status}</span>
              </div>
            </div>
            <p class="text-slate-500 font-semibold truncate">${itemsSummary}</p>
            <div class="flex justify-between items-center text-slate-400 text-[10px] pt-1">
              <span>Total: ₹${Number(o.total_amount).toLocaleString('en-IN')}</span>
              <span>${new Date(o.created_at).toLocaleDateString('en-IN')}</span>
            </div>
          </div>
        `;
      }).join('');

      // Attach click listeners to cards
      const cards = listEl.querySelectorAll('.order-log-card');
      cards.forEach(card => {
        card.addEventListener('click', () => {
          const orderId = card.getAttribute('data-order-id');
          const orderNumber = card.getAttribute('data-order-number');
          if (orderId && orderNumber && typeof window.subscribeToOrderUpdates === 'function') {
            window.subscribeToOrderUpdates(orderId, orderNumber);
          } else {
            console.warn('subscribeToOrderUpdates is not available or missing attributes');
          }
        });
      });
    }
  } catch (err) {
    console.warn('Failed to load user history:', err);
    listEl.innerHTML = `<p class="text-xs text-slate-400 italic text-center">Could not load history details.</p>`;
  }
}

// ==========================================
// CUSTOMER NOTIFICATIONS SYSTEM
// ==========================================
let customerNotifAudioCtx = null;
let realtimeSubscribedPhone = null;
let pollingIntervalId = null;

function getCustomerAudioCtx() {
  if (!customerNotifAudioCtx) {
    customerNotifAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (customerNotifAudioCtx && customerNotifAudioCtx.state === 'suspended') {
    customerNotifAudioCtx.resume();
  }
  return customerNotifAudioCtx;
}

function playCustomerNotificationChime() {
  try {
    const ctx = getCustomerAudioCtx();
    if (!ctx) return;
    
    const playTone = (freq, startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    
    const now = ctx.currentTime;
    playTone(880, now, 0.25);         // A5
    playTone(1109.73, now + 0.08, 0.45); // C#6
  } catch (err) {
    console.warn('Audio chime playback failed:', err);
  }
}

// Show a floating premium screen toast for notifications
function showCustomerNotificationToast(title, message) {
  const container = document.getElementById('customer-toast-container') || initCustomerToastContainer();
  const toast = document.createElement('div');
  toast.className = 'flex items-start gap-3 p-4 rounded-2xl shadow-xl border translate-y-2 opacity-0 transition-all duration-300 pointer-events-auto max-w-sm w-full';
  toast.style.cssText = 'background: rgba(255,255,255,0.95); backdrop-filter: blur(10px); border-color: var(--color-border); box-shadow: 0 10px 30px rgba(0,0,0,0.08); margin-left: auto;';
  
  // Custom colors based on notification type/status
  const accentColor = 'var(--color-accent)';
  
  toast.innerHTML = `
    <div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm" style="background: rgba(0, 176, 116, 0.1); color: ${accentColor}">
      🔔
    </div>
    <div class="flex-1 space-y-0.5">
      <h4 class="text-xs font-bold text-slate-800">${title}</h4>
      <p class="text-[11px] text-slate-500 font-semibold leading-normal">${message}</p>
    </div>
    <button class="text-slate-400 hover:text-slate-600 transition-colors text-lg font-normal leading-none">&times;</button>
  `;
  
  toast.querySelector('button').addEventListener('click', () => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  });
  
  container.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => {
    toast.classList.remove('opacity-0', 'translate-y-2');
  }, 50);
  
  // Auto dismiss after 6 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }
  }, 6000);
}

function initCustomerToastContainer() {
  let container = document.getElementById('customer-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'customer-toast-container';
    container.className = 'fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none w-full max-w-sm px-4 md:px-0';
    document.body.appendChild(container);
  }
  return container;
}

// Render dynamic notifications dropdown list
let customerNotifications = [];

async function refreshCustomerNotifications(phone) {
  try {
    const listEl = document.getElementById('customer-notif-items');
    const badgeEl = document.getElementById('customer-notif-badge');
    const countEl = document.getElementById('customer-notif-count');
    if (!listEl) return;
    
    const notifs = await NotificationService.getUserNotifications(phone);
    customerNotifications = notifs;
    
    const unreadCount = notifs.filter(n => !n.is_read).length;
    
    // Update Badge
    if (badgeEl) {
      if (unreadCount > 0) {
        badgeEl.textContent = unreadCount;
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.classList.add('hidden');
      }
    }
    
    if (countEl) {
      countEl.textContent = unreadCount > 0 ? `(${unreadCount})` : '';
    }
    
    if (notifs.length === 0) {
      listEl.innerHTML = `<p class="p-6 text-center text-xs text-slate-400 italic">No notifications yet</p>`;
      return;
    }
    
    listEl.innerHTML = notifs.map(n => {
      const isUnread = !n.is_read;
      const bgStyle = isUnread ? 'background: #f8fafc;' : 'background: #ffffff;';
      const indicator = isUnread ? `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 absolute top-4 right-4"></span>` : '';
      
      let typeIcon = '🔔';
      let iconBg = 'rgba(100, 116, 139, 0.1)';
      let iconColor = '#64748b';
      
      switch (n.type) {
        case 'order_confirmed':
          typeIcon = '✅';
          iconBg = 'rgba(16, 185, 129, 0.1)';
          iconColor = '#10b981';
          break;
        case 'order_preparing':
          typeIcon = '🍳';
          iconBg = 'rgba(245, 158, 11, 0.1)';
          iconColor = '#f59e0b';
          break;
        case 'out_for_delivery':
          typeIcon = '🛵';
          iconBg = 'rgba(59, 130, 246, 0.1)';
          iconColor = '#3b82f6';
          break;
        case 'delivered':
          typeIcon = '🎁';
          iconBg = 'rgba(16, 185, 129, 0.1)';
          iconColor = '#10b981';
          break;
        case 'order_rejected':
          typeIcon = '❌';
          iconBg = 'rgba(239, 68, 68, 0.1)';
          iconColor = '#ef4444';
          break;
      }
      
      const timeStr = formatNotifTime(n.created_at);
      
      return `
        <div class="p-4 flex gap-3 relative cursor-pointer hover:bg-slate-50 transition-colors" data-notif-id="${n.id}" style="${bgStyle}">
          <div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm" style="background: ${iconBg}; color: ${iconColor};">
            ${typeIcon}
          </div>
          <div class="flex-1 pr-4 space-y-0.5">
            <h4 class="text-xs font-bold text-slate-800 leading-snug">${n.title}</h4>
            <p class="text-[11px] text-slate-500 font-semibold leading-normal">${n.message || n.description}</p>
            <span class="text-[9px] text-slate-400 block pt-1 font-semibold">${timeStr}</span>
          </div>
          ${indicator}
        </div>
      `;
    }).join('');
    
    // Bind click events on notification items
    listEl.querySelectorAll('[data-notif-id]').forEach(el => {
      el.addEventListener('click', async (e) => {
        const id = el.dataset.notifId;
        const match = customerNotifications.find(x => x.id === id);
        if (match && !match.is_read) {
          try {
            const phone = getActiveCustomerPhone();
            if (phone) {
              await NotificationService.markAsRead(id, phone);
              await refreshCustomerNotifications(phone);
            }
          } catch (err) {
            console.warn('Failed to mark read:', err);
          }
        }
      });
    });
    
  } catch (err) {
    console.warn('Failed to refresh customer notifications:', err);
  }
}

function formatNotifTime(timestamp) {
  try {
    const diffMs = new Date() - new Date(timestamp);
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return new Date(timestamp).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  } catch (e) {
    return 'Just now';
  }
}

async function initCustomerNotifications() {
  const bellBtn = document.getElementById('customer-notif-btn');
  const dropdown = document.getElementById('customer-notif-dropdown');
  const wrapper = document.getElementById('customer-notif-wrapper');
  const markAllBtn = document.getElementById('customer-notif-mark-all');
  const clearReadBtn = document.getElementById('customer-notif-view-history');
  
  if (!bellBtn || !dropdown) return;
  
  // Warm up audio on first click
  bellBtn.addEventListener('click', () => {
    getCustomerAudioCtx();
  });

  // Toggle dropdown
  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = dropdown.classList.contains('hidden');
    if (isHidden) {
      dropdown.classList.remove('hidden');
      setTimeout(() => {
        dropdown.classList.remove('opacity-0', 'scale-95');
      }, 10);
      
      // Fetch latest notifications when opening
      const phone = getActiveCustomerPhone();
      if (phone) refreshCustomerNotifications(phone);
    } else {
      dropdown.classList.add('opacity-0', 'scale-95');
      setTimeout(() => dropdown.classList.add('hidden'), 200);
    }
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (wrapper && !wrapper.contains(e.target)) {
      dropdown.classList.add('opacity-0', 'scale-95');
      setTimeout(() => dropdown.classList.add('hidden'), 200);
    }
  });

  // Mark all read action
  markAllBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const phone = getActiveCustomerPhone();
    if (!phone) return;
    try {
      await NotificationService.markAllAsRead(phone);
      await refreshCustomerNotifications(phone);
    } catch (err) {
      console.warn('Failed to mark all read:', err);
    }
  });

  // Clear read notifications action
  clearReadBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const phone = getActiveCustomerPhone();
    if (!phone) return;
    try {
      if (!confirm('Are you sure you want to dismiss all read notifications?')) return;
      await NotificationService.markAllAsRead(phone);
      await refreshCustomerNotifications(phone);
    } catch (err) {
       console.warn('Failed to dismiss read notifications:', err);
    }
  });
  
  // Start Listening based on resolved customer profile or details
  startNotificationListening();
}

function getActiveCustomerPhone() {
  // 1. Check logged in profile
  if (userProfile && userProfile.phone) {
    return userProfile.phone.trim();
  }
  // 2. Check guest local storage details
  try {
    const raw = localStorage.getItem('limra-customer-details');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.phone) return parsed.phone.trim();
    }
  } catch (e) {}
  
  return null;
}

async function startNotificationListening() {
  const phone = getActiveCustomerPhone();
  if (!phone) {
    console.log('[NotificationCenter] No phone number identified. Waiting for checkout or login...');
    return;
  }
  
  const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
  if (cleanPhone.length < 10) return;
  
  // Avoid duplicate sockets for same phone
  if (realtimeSubscribedPhone === cleanPhone) return;
  
  // Unsubscribe old if different
  if (realtimeSubscribedPhone) {
    try {
      insforge.realtime.unsubscribe(`customer-notifications:${realtimeSubscribedPhone}`);
    } catch (err) {}
  }
  
  realtimeSubscribedPhone = cleanPhone;
  console.log(`[NotificationCenter] Initializing listeners for clean phone number: +91 ${cleanPhone}`);
  
  // Fetch initial notifications
  await refreshCustomerNotifications(phone);
  
  // Subscribe to Realtime Pub/Sub channel
  try {
    const channelName = `customer-notifications:${cleanPhone}`;
    insforge.realtime.on('connect', () => {
      console.log(`[NotificationCenter] Realtime WebSocket connected!`);
    });
    
    insforge.realtime.on('connect_error', (err) => {
      console.warn(`[NotificationCenter] Realtime connection error:`, err);
      startPollingFallback(phone);
    });

    insforge.realtime.on('disconnect', () => {
      console.log(`[NotificationCenter] Realtime disconnected.`);
      startPollingFallback(phone);
    });

    await insforge.realtime.connect();
    const subRes = await insforge.realtime.subscribe(channelName);
    
    if (subRes.error) {
      console.warn(`[NotificationCenter] Subscription failed:`, subRes.error);
      startPollingFallback(phone);
    } else {
      console.log(`[NotificationCenter] Subscribed successfully to channel: ${channelName}`);
      
      // Stop polling fallback if socket is active
      if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
      }
      
      // Listen to notification_created event
      insforge.realtime.on('notification_created', (payload) => {
        console.log(`[NotificationCenter] Received realtime notification:`, payload);
        playCustomerNotificationChime();
        showCustomerNotificationToast(payload.title, payload.message);
        refreshCustomerNotifications(phone);
        loadUserHistory();
      });
    }
  } catch (err) {
    console.warn(`[NotificationCenter] Realtime initialization failed:`, err);
    startPollingFallback(phone);
  }
}

function startPollingFallback(phone) {
  if (pollingIntervalId) return; // Already polling
  
  console.log(`[NotificationCenter] Falling back to polling interval (20 seconds)...`);
  pollingIntervalId = setInterval(async () => {
    const activePhone = getActiveCustomerPhone();
    if (!activePhone) {
      clearInterval(pollingIntervalId);
      pollingIntervalId = null;
      return;
    }
    
    try {
      const count = await NotificationService.getUnreadCount(activePhone);
      const currentUnread = customerNotifications.filter(n => !n.is_read).length;
      
      // If server unread count differs from local, refresh list and alert
      if (count !== currentUnread) {
        console.log(`[NotificationCenter] Poller detected count mismatch (${count} vs ${currentUnread}). Refreshing...`);
        const oldNotifs = [...customerNotifications];
        await refreshCustomerNotifications(activePhone);
        
        // Find newly added unread notification
        const newNotifs = customerNotifications.filter(n => !n.is_read && !oldNotifs.some(o => o.id === n.id));
        if (newNotifs.length > 0) {
          playCustomerNotificationChime();
          newNotifs.forEach(n => {
            showCustomerNotificationToast(n.title, n.message || n.description);
          });
        }
      }
    } catch (e) {
      console.warn('[NotificationCenter] Polling error:', e);
    }
  }, 20000);
}

// ═══════════════════════════════════════
// PRODUCT DETAILS & RECOMMENDATIONS ENGINE
// ═══════════════════════════════════════

// Fetch dynamic recommendations for a menu item
function getRecommendations(item) {
  if (!item) return [];

  const nameLower = (item.name || '').toLowerCase();
  const category = item.category || '';

  let recommendedCategories = [];
  
  // Rule 1: If they select Naan or Breads -> recommend Gravies/Curries
  if (category === 'bread' || nameLower.includes('naan') || nameLower.includes('roti') || nameLower.includes('kulcha')) {
    recommendedCategories = ['veg-curry', 'nonveg-curry'];
  }
  // Rule 2: If they select Biryani -> suggest Cold Drinks/Beverages
  else if (category === 'biryani' || nameLower.includes('biryani') || nameLower.includes('khuska')) {
    recommendedCategories = ['beverages', 'lassi', 'milkshakes', 'mocktails'];
  }
  // Rule 3: If they select Chicken/Mutton dishes -> suggest Roti or Rice
  else if (
    category === 'nonveg-curry' || 
    category === 'nonveg-starters' || 
    category === 'tandoor-kabab' || 
    category === 'chinese-nonveg' ||
    nameLower.includes('chicken') || 
    nameLower.includes('mutton') || 
    nameLower.includes('fish') || 
    nameLower.includes('prawns') || 
    nameLower.includes('tikka') || 
    nameLower.includes('kabab')
  ) {
    recommendedCategories = ['bread', 'veg-rice', 'nonveg-rice'];
  }
  // Fallback: suggest popular Desserts, Momos/Chaat or Mocktails
  else {
    recommendedCategories = ['desserts', 'momos-chaat', 'mocktails'];
  }

  // Filter recommendations matching the target categories (excluding the current item itself)
  let list = menuItems.filter(m => m.id !== item.id && recommendedCategories.includes(m.category) && m.available !== false);

  // Shuffle list and return up to 2 items for display
  return list.sort(() => 0.5 - Math.random()).slice(0, 2);
}

// Open product detail modal
window.openProductDetailModal = function(itemId) {
  const item = getAllCombinedMenuItems().find(m => String(m.id) === String(itemId));
  if (!item) return;

  const modal = document.getElementById('product-detail-modal');
  const innerCard = modal?.querySelector('.relative.w-full.max-w-lg');
  if (!modal || !innerCard) return;

  // Set standard info
  const nameEl = document.getElementById('product-modal-name');
  const emojiEl = document.getElementById('product-modal-emoji');
  const priceEl = document.getElementById('product-modal-price');
  const mrpEl = document.getElementById('product-modal-mrp');
  const descEl = document.getElementById('product-modal-desc');
  const imgEl = document.getElementById('product-modal-image');
  const discountEl = document.getElementById('product-modal-discount');

  if (nameEl) nameEl.textContent = item.name;
  if (emojiEl) emojiEl.textContent = item.emoji || '🍽️';
  if (priceEl) priceEl.textContent = `₹${item.price}`;
  if (descEl) descEl.textContent = item.description || `Fresh and authentic ${item.name} prepared with traditional methods at LIMRA Restaurant Egra.`;
  
  if (imgEl) imgEl.src = item.image || categoryImages[item.category] || '/images/food_biryani.png';
  
  if (mrpEl) {
    if (item.mrp) {
      mrpEl.textContent = `₹${item.mrp}`;
      mrpEl.classList.remove('hidden');
    } else {
      mrpEl.classList.add('hidden');
    }
  }

  if (discountEl) {
    if (item.discount) {
      discountEl.textContent = `${item.discount}% OFF`;
      discountEl.classList.remove('hidden');
    } else {
      discountEl.classList.add('hidden');
    }
  }

  // Bind Add to Order button
  const addBtn = document.getElementById('product-modal-add-btn');
  if (addBtn) {
    // Recreate button to strip previous event listeners
    const newAddBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newAddBtn, addBtn);
    
    newAddBtn.addEventListener('click', () => {
      addToCart(item.id);
      closeProductDetailModal();
    });
  }

  // Render cross-selling pairings
  const recGrid = document.getElementById('product-modal-recommendations-grid');
  const recSection = document.getElementById('product-modal-recommendations-section');
  const recommendations = getRecommendations(item);

  if (recGrid && recSection) {
    if (recommendations.length > 0) {
      recGrid.innerHTML = '';
      recommendations.forEach(rec => {
        const recCard = document.createElement('div');
        recCard.className = 'flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 border dark:border-slate-800 rounded-2xl hover:border-emerald-500 transition-colors cursor-pointer';
        
        const recImg = rec.image || categoryImages[rec.category] || '/images/food_biryani.png';
        
        recCard.innerHTML = `
          <img src="${recImg}" alt="${rec.name}" class="w-12 h-12 rounded-xl object-cover shrink-0">
          <div class="flex-1 min-h-0 text-left">
            <h5 class="text-xs font-bold text-slate-800 dark:text-white truncate">${rec.emoji || ''} ${rec.name}</h5>
            <span class="text-[10px] font-black text-emerald-600 dark:text-emerald-400">₹${rec.price}</span>
          </div>
          <button class="rec-add-btn shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-emerald-500 hover:bg-emerald-600 active:scale-90 text-white font-bold text-sm shadow-md shadow-emerald-500/10 transition-all">
            +
          </button>
        `;

        // Allow opening the recommendation item detail if the card is clicked (excluding '+' button click)
        recCard.addEventListener('click', (e) => {
          if (!e.target.closest('.rec-add-btn')) {
            openProductDetailModal(rec.id);
          }
        });

        // Bind '+' button inside recommendation card
        recCard.querySelector('.rec-add-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          addToCart(rec.id);
          
          // Show subtle micro-interaction check on the button
          const btn = e.currentTarget;
          btn.textContent = '✓';
          btn.classList.replace('bg-emerald-500', 'bg-slate-400');
          setTimeout(() => {
            btn.textContent = '+';
            btn.classList.replace('bg-slate-400', 'bg-emerald-500');
          }, 1200);
        });

        recGrid.appendChild(recCard);
      });
      recSection.classList.remove('hidden');
    } else {
      recSection.classList.add('hidden');
    }
  }

  // Show Modal
  modal.classList.remove('hidden');
  void modal.offsetWidth; // trigger reflow
  modal.classList.remove('opacity-0');
  innerCard.classList.remove('scale-95');
  innerCard.classList.add('scale-100');
};

// Close product detail modal
window.closeProductDetailModal = function() {
  const modal = document.getElementById('product-detail-modal');
  const innerCard = modal?.querySelector('.relative.w-full.max-w-lg');
  if (!modal) return;

  modal.classList.add('opacity-0');
  if (innerCard) {
    innerCard.classList.remove('scale-100');
    innerCard.classList.add('scale-95');
  }
  
  setTimeout(() => {
    modal.classList.add('hidden');
  }, 300);
};

// Setup close listeners for the modal on load
function setupProductDetailModalListeners() {
  const modal = document.getElementById('product-detail-modal');
  const closeBtn = document.getElementById('product-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeProductDetailModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeProductDetailModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (modal && !modal.classList.contains('hidden') && e.key === 'Escape') {
      closeProductDetailModal();
    }
  });
}

// Execute setup
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupProductDetailModalListeners);
} else {
  setupProductDetailModalListeners();
}
