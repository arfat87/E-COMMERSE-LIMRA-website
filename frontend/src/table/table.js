import { insforge, saveOrder, saveTableRound, getMenuOverrides, validateCouponCode, redeemCoupon, getCombos, getCustomDishes } from '../lib/insforge.js';
import { menuItems, categoryTabOrder, categoryLabels, categoryEmojis } from '../data/menu.js';
import { initLanguageSystem, applyTranslations, t, getLanguage, setLanguage } from '../lib/i18n.js';

const GOOGLE_REVIEW_URL = 'https://g.page/r/CcrqEfWap5zfEBE/review';


const $ = selector => {
  if (typeof selector === 'string' && selector.startsWith('#')) {
    return document.getElementById(selector.slice(1));
  }
  return document.getElementById(selector);
};
const show = el => { if (el) el.classList.remove('hidden'); };
const hide = el => { if (el) el.classList.add('hidden'); };

function loadTableCart() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = localStorage.getItem('limra-table-cart');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(c => {
      if (!c || !c.item) return null;
      if (c.item.isCombo || (typeof c.item.id === 'string' && (c.item.id.startsWith('combo-') || c.item.id.startsWith('custom_')))) {
        return c;
      }
      const item = menuItems.find(i => i.id === c.item.id);
      return item ? { item, quantity: c.quantity } : c;
    }).filter(Boolean);
  } catch (e) {
    console.warn('[TableCart] Hydration failed:', e);
    return [];
  }
}

let cart = loadTableCart(); // Hydrate dine-in cart from localStorage
let currentTable = null;
let appliedCoupon = null;

// ====================================================
// INITIALIZATION
// ====================================================
async function init() {
  initLanguageSystem();
  window.addEventListener('limra_language_changed', () => {
    if (currentTable) {
      initCustomerView();
    } else {
      applyTranslations();
    }
  });

  const params = new URLSearchParams(window.location.search);
  const tParam = params.get('t') || params.get('table');

  if (tParam && /^\d+$/.test(tParam)) {
    const tableNum = parseInt(tParam, 10);
    if (tableNum >= 1 && tableNum <= 19) {
      currentTable = tableNum;
      show($('#customer-view'));
      hide($('#owner-view'));
      hide($('#error-view'));
      await initCustomerView();
      return;
    }
  }

  // If any query parameters were provided but we didn't validate above
  if (params.has('t') || params.has('table')) {
    hide($('#customer-view'));
    hide($('#owner-view'));
    show($('#error-view'));
  } else {
    show($('#owner-view'));
    hide($('#customer-view'));
    hide($('#error-view'));
    initOwnerView();
  }

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
}

// ====================================================
// CUSTOMER ORDERING VIEW LOGIC
// ====================================================
let selectedCategory = 'featured';
let activeCombos = [];
let activeCustomDishes = [];

function applyTableOverrides(overrides) {
  if (!overrides || !Array.isArray(overrides)) return;
  menuItems.forEach(item => {
    const override = overrides.find(o => o.id === item.id);
    if (override) {
      if (override.price !== null && override.price !== undefined) item.price = parseFloat(override.price);
      if (override.mrp !== null && override.mrp !== undefined) item.mrp = parseFloat(override.mrp);
      if (override.available !== undefined) item.available = override.available;
      if (override.featured !== undefined) item.featured = override.featured;
    }
  });
}

function getTableFastCache(key, ttlMs = 600000) {
  try {
    const raw = localStorage.getItem(`limra_tbl_${key}`) || sessionStorage.getItem(`limra_tbl_${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t < ttlMs) return parsed.d;
  } catch (e) {}
  return null;
}

function setTableFastCache(key, data) {
  try {
    const payload = JSON.stringify({ t: Date.now(), d: data });
    localStorage.setItem(`limra_tbl_${key}`, payload);
    sessionStorage.setItem(`limra_tbl_${key}`, payload);
  } catch (e) {}
}

async function loadMenuOverridesAndApply() {
  const cached = getTableFastCache('overrides');
  if (cached) applyTableOverrides(cached);
  try {
    const overrides = await getMenuOverrides();
    if (overrides && Array.isArray(overrides)) {
      setTableFastCache('overrides', overrides);
      applyTableOverrides(overrides);
    }
  } catch (err) {
    console.error('Failed to load menu overrides:', err);
  }
}

async function initCustomerView() {
  const isBn = getLanguage() === 'bn';
  const zone = currentTable <= 9 ? 'indoor' : 'outdoor';
  const zoneLabel = zone === 'indoor' ? (isBn ? '🪑 ইনডোর' : '🪑 Indoor') : (isBn ? '🌿 আউটডোর' : '🌿 Outdoor');
  const tableLabel = isBn ? `সার্ভিং টেবিল ${currentTable} (${zoneLabel})` : `Serving Table ${currentTable} (${zoneLabel})`;
  $('#customer-table-number-label').textContent = tableLabel;
  $('#checkout-table-display').textContent = currentTable;
  if ($('checkout-zone-display')) $('checkout-zone-display').textContent = zoneLabel;
  
  // 1. Instantly apply cached overrides and combos for 0ms initial render
  const cachedOverrides = getTableFastCache('overrides');
  if (cachedOverrides) applyTableOverrides(cachedOverrides);
  const cachedCombos = getTableFastCache('combos');
  if (cachedCombos) activeCombos = cachedCombos;
  const cachedDishes = getTableFastCache('custom_dishes');
  if (cachedDishes) activeCustomDishes = cachedDishes;

  // 2. Render Categories chips & Menu immediately without waiting on network
  renderCategoryChips();
  renderMenu();
  setupCartUI();

  // Setup Search once
  const searchInp = $('#food-search-input');
  if (searchInp && !searchInp._hasInit) {
    searchInp._hasInit = true;
    searchInp.addEventListener('input', () => {
      renderMenu();
    });
  }

  // 3. Hydrate live overrides, combos and custom dishes in background
  Promise.allSettled([
    loadMenuOverridesAndApply(),
    getCombos().then(combos => {
      if (combos && Array.isArray(combos)) {
        activeCombos = combos;
        setTableFastCache('combos', combos);
      }
    }),
    getCustomDishes().then(dishes => {
      if (dishes && Array.isArray(dishes)) {
        activeCustomDishes = dishes;
        setTableFastCache('custom_dishes', dishes);
      }
    })
  ]).then(() => {
    renderMenu();
  });
}

function renderCategoryChips() {
  const container = $('#categories-scroll-container');
  if (!container) return;

  const specialsLabel = t('tbl_specials');
  const allLabel = t('tbl_all');

  const specialsChipHtml = `
    <button class="category-chip ${selectedCategory === 'featured' ? 'active' : ''}" data-category="featured">
      ${specialsLabel}
    </button>
  `;

  const allChipHtml = `
    <button class="category-chip ${selectedCategory === 'all' ? 'active' : ''}" data-category="all">
      ${allLabel}
    </button>
  `;

  const chipsHtml = categoryTabOrder.map(cat => {
    const label = categoryLabels[cat] || cat;
    const emoji = categoryEmojis[cat] || '🍛';
    const isActive = selectedCategory === cat;
    return `
      <button class="category-chip ${isActive ? 'active' : ''}" data-category="${cat}">
        ${emoji} ${label}
      </button>
    `;
  }).join('');

  container.innerHTML = specialsChipHtml + allChipHtml + chipsHtml;

  // Add click listeners
  container.querySelectorAll('.category-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.category-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedCategory = btn.dataset.category;
      
      const label = btn.textContent.trim();
      $('#menu-category-title').textContent = label;
      renderMenu();
    });
  });
}

function renderMenu() {
  const grid = $('#food-cards-grid');
  const searchVal = $('#food-search-input').value.toLowerCase().trim();

  const allDishes = [...menuItems, ...(activeCustomDishes || [])];

  // Filter items (skip normal items if combo category selected)
  const filtered = allDishes.filter(item => {
    if (selectedCategory === 'combo') return false;
    const matchesCategory = 
      selectedCategory === 'all' || 
      (selectedCategory === 'featured' ? item.featured === true : item.category === selectedCategory);
    const matchesSearch = !searchVal || item.name.toLowerCase().includes(searchVal);
    return matchesCategory && matchesSearch;
  });

  // Filter combos if Today's Specials, All category, or Combo category is active
  const filteredCombos = activeCombos.filter(combo => {
    if (selectedCategory !== 'all' && selectedCategory !== 'featured' && selectedCategory !== 'combo') return false;
    const matchesSearch = !searchVal || combo.name.toLowerCase().includes(searchVal);
    return combo.available !== false && matchesSearch;
  });

  const totalCount = filtered.length + filteredCombos.length;
  const countText = getLanguage() === 'bn' ? `${totalCount}টি পদ` : `${totalCount} item${totalCount === 1 ? '' : 's'}`;
  $('#menu-count-badge').textContent = countText;

  if (totalCount === 0) {
    if (selectedCategory === 'featured') {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center text-slate-400 space-y-4">
          <p class="text-5xl">🍱</p>
          <div class="space-y-1">
            <p class="text-sm font-bold text-slate-700">No active Specials or Combo Deals today</p>
            <p class="text-xs text-slate-400">Click the "🍽️ All Items" tab above to view our complete menu!</p>
          </div>
        </div>
      `;
    } else {
      grid.innerHTML = `
        <div class="col-span-full py-12 text-center text-slate-400 space-y-2">
          <p class="text-3xl">🍲</p>
          <p class="text-sm font-semibold text-slate-600">No food items match your search</p>
        </div>
      `;
    }
    return;
  }

  // Render combo cards (Blinkit Clean Card Style)
  const combosHtml = filteredCombos.map(combo => {
    const cartItem = cart.find(c => c.item.id === `combo-${combo.id}` || String(c.item.id) === `combo-${combo.id}`);
    const qty = cartItem ? cartItem.quantity : 0;
    const itemsListStr = Array.isArray(combo.items)
      ? combo.items.map(it => `${it.name} (x${it.qty || 1})`).join(' + ')
      : 'No items';

    const hasDiscount = combo.mrp && parseFloat(combo.mrp) > parseFloat(combo.price);
    const comboImg = combo.image_url || combo.image || '/images/food_biryani.png';

    return `
      <div class="food-card p-2.5 sm:p-3 flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white cursor-pointer hover:border-[#0c831f]/50 hover:shadow-md transition-all active:scale-[0.99] relative overflow-hidden" data-item-id="combo-${combo.id}">
        <div>
          <div class="w-full aspect-[4/3] rounded-xl overflow-hidden shrink-0 border border-slate-100 bg-neutral-100 animate-pulse flex items-center justify-center relative mb-2">
            <img src="${comboImg}" alt="${combo.name}" class="w-full h-full object-cover error-fallback" loading="lazy" decoding="async" onload="this.parentElement.classList.remove('animate-pulse', 'bg-neutral-100');" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'; this.parentElement.classList.remove('animate-pulse', 'bg-neutral-100');">
            <span class="text-3xl absolute inset-0 flex items-center justify-center" style="display:none;">🍱</span>
            <span class="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-amber-500 text-[10px] font-black text-slate-950 uppercase tracking-wider shadow-xs">🍱 Combo</span>
          </div>
          <div class="text-left">
            <div class="flex items-start gap-1">
              <span class="text-xs mr-1 shrink-0">🍱</span>
              <h4 class="font-bold text-xs sm:text-sm text-slate-800 line-clamp-2 leading-snug min-h-[2rem] sm:min-h-[2.5rem] flex-1" title="${combo.name}">${combo.name}</h4>
            </div>
            <p class="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 font-medium line-clamp-1 truncate" title="Includes: ${itemsListStr}">${itemsListStr}</p>
            <div class="flex items-baseline gap-1.5 my-1.5">
              <span class="text-xs sm:text-sm font-extrabold text-[#0c831f]">₹${combo.price}</span>
              ${hasDiscount ? `<span class="text-[10px] sm:text-xs font-normal text-slate-400 line-through">₹${combo.mrp}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="pt-1 mt-auto flex justify-end">
          ${qty > 0 ? `
            <div class="card-stepper-btn" onclick="event.stopPropagation()">
              <button type="button" aria-label="Decrease quantity" class="card-stepper-op btn-cart-minus" data-item-id="combo-${combo.id}">−</button>
              <span class="card-stepper-val">${qty}</span>
              <button type="button" aria-label="Increase quantity" class="card-stepper-op btn-cart-plus" data-item-id="combo-${combo.id}">+</button>
            </div>
          ` : `
            <button type="button" class="add-btn btn-cart-add w-full" data-item-id="combo-${combo.id}">
              + ADD
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');

  // Render normal items (Blinkit Clean Card Style with Veg/Non-Veg FSSAI dots)
  const itemsHtml = filtered.map(item => {
    const cartItem = cart.find(c => c.item.id === item.id || String(c.item.id) === String(item.id));
    const qty = cartItem ? cartItem.quantity : 0;
    const itemImage = item.image || '/images/food_biryani.png';
    const emojiStr = item.emoji || '🍛';
    const isAvailable = item.available !== false;
    const catLabel = categoryLabels[item.category] || item.category;
    const isVeg = item.veg === true || item.type === 'veg';
    const vegDot = `<div class="food-type-icon ${isVeg ? '' : 'non-veg'}" title="${isVeg ? 'Veg' : 'Non-Veg'}" style="flex-shrink:0;margin-top:2px;"></div>`;
    const hasDiscount = item.mrp && parseFloat(item.mrp) > parseFloat(item.price);

    return `
      <div class="food-card p-2.5 sm:p-3 flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white ${isAvailable ? 'hover:border-[#0c831f]/50 hover:shadow-md cursor-pointer' : 'opacity-60 grayscale-[20%] cursor-not-allowed'} transition-all active:scale-[0.99] relative overflow-hidden" data-item-id="${item.id}">
        <div>
          <div class="w-full aspect-[4/3] rounded-xl overflow-hidden shrink-0 border border-slate-100 bg-neutral-100 animate-pulse flex items-center justify-center relative mb-2">
            <img src="${itemImage}" alt="${item.name}" class="w-full h-full object-cover error-fallback" loading="lazy" decoding="async" onload="this.parentElement.classList.remove('animate-pulse', 'bg-neutral-100');" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'; this.parentElement.classList.remove('animate-pulse', 'bg-neutral-100');">
            <span class="text-3xl absolute inset-0 flex items-center justify-center" style="display:none;">${emojiStr}</span>
            <span class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-white/95 backdrop-blur-xs text-[9px] sm:text-[10px] font-bold text-slate-700 capitalize border border-slate-200 truncate max-w-[85%]">${catLabel}</span>
            ${item.featured ? `<span class="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-amber-500 text-[9px] font-black text-slate-950 uppercase shadow-xs">⭐ Best</span>` : ''}
          </div>
          <div class="text-left">
            <div class="flex items-start gap-1">
              ${vegDot}
              <h4 class="font-bold text-xs sm:text-sm text-slate-800 line-clamp-2 leading-snug min-h-[2rem] sm:min-h-[2.5rem] flex-1" title="${item.name}">${item.name}</h4>
            </div>
            <div class="flex items-baseline gap-1.5 my-1.5">
              <span class="text-xs sm:text-sm font-extrabold text-[#0c831f]">₹${item.price}</span>
              ${hasDiscount ? `<span class="text-[10px] sm:text-xs font-normal text-slate-400 line-through">₹${item.mrp}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="pt-1 mt-auto flex justify-end">
          ${isAvailable ? (qty > 0 ? `
            <div class="card-stepper-btn" onclick="event.stopPropagation()">
              <button type="button" aria-label="Decrease quantity" class="card-stepper-op btn-cart-minus" data-item-id="${item.id}">−</button>
              <span class="card-stepper-val">${qty}</span>
              <button type="button" aria-label="Increase quantity" class="card-stepper-op btn-cart-plus" data-item-id="${item.id}">+</button>
            </div>
          ` : `
            <button type="button" class="add-btn btn-cart-add w-full" data-item-id="${item.id}">
              + ADD
            </button>
          `) : `
            <button class="add-btn w-full" disabled style="background:#f1f5f9; color:#94a3b8; border-color:#e2e8f0; cursor:not-allowed">Sold Out</button>
          `}
        </div>
      </div>
    `;
  }).join('');

  grid.innerHTML = combosHtml + itemsHtml;

  // Add click handlers for cart buttons
  grid.querySelectorAll('.btn-cart-add, .btn-cart-plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idVal = btn.dataset.itemId;
      const id = idVal.startsWith('combo-') || isNaN(Number(idVal)) ? idVal : parseInt(idVal, 10);
      addToCart(id);
    });
  });

  grid.querySelectorAll('.btn-cart-minus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idVal = btn.dataset.itemId;
      const id = idVal.startsWith('combo-') || isNaN(Number(idVal)) ? idVal : parseInt(idVal, 10);
      removeFromCart(id);
    });
  });

  // Attach card-level clicks to open the detail drawer (both regular food items and combos)
  grid.querySelectorAll('.food-card').forEach(card => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-stepper-btn, .add-btn, .btn-cart-add, .btn-cart-plus, .btn-cart-minus')) return;
      const idVal = card.dataset.itemId;
      openTableDetailDrawer(idVal);
    });
  });
}

function addToCart(itemId) {
  let item = null;
  const strId = String(itemId);
  if (strId.startsWith('combo-')) {
    const comboId = parseInt(strId.replace('combo-', ''), 10);
    const combo = activeCombos.find(c => c.id === comboId);
    if (combo) {
      const itemsListStr = Array.isArray(combo.items)
        ? combo.items.map(it => `${it.name} (x${it.qty || 1})`).join(' + ')
        : 'No items';
      item = {
        id: itemId,
        name: combo.name,
        price: parseFloat(combo.price),
        mrp: combo.mrp ? parseFloat(combo.mrp) : null,
        category: 'specials',
        description: combo.description || `Included: ${itemsListStr}`,
        image: combo.image_url || combo.image || '/images/food_biryani.png',
        isCombo: true,
        items: combo.items || [],
        available: combo.available !== false,
        gst_applicable: combo.gst_applicable !== false
      };
    }
  } else if (strId.startsWith('custom_')) {
    item = (activeCustomDishes || []).find(i => String(i.id) === strId || String(i.db_id) === strId.replace('custom_', ''));
    if (!item && typeof localStorage !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem('limra_custom_foods') || '[]');
        item = saved.find(i => String(i.id) === strId || String(i.db_id) === strId.replace('custom_', ''));
      } catch (e) {}
    }
  } else {
    item = menuItems.find(i => String(i.id) === strId) || (activeCustomDishes || []).find(i => String(i.id) === strId);
  }
  
  if (!item) return;
  if (item.available === false) return; // Prevent adding sold out items

  const cartItem = cart.find(c => String(c.item.id) === String(item.id));
  if (cartItem) {
    cartItem.quantity += 1;
  } else {
    cart.push({ item, quantity: 1 });
  }

  updateCartState();
}

function removeFromCart(itemId) {
  const strId = String(itemId);
  const cartItemIndex = cart.findIndex(c => String(c.item.id) === strId);
  if (cartItemIndex === -1) return;

  const cartItem = cart[cartItemIndex];
  if (cartItem.quantity > 1) {
    cartItem.quantity -= 1;
  } else {
    cart.splice(cartItemIndex, 1);
  }

  updateCartState();
}

function updateCartState() {
  try {
    localStorage.setItem('limra-table-cart', JSON.stringify(cart));
  } catch (e) {
    console.warn('[TableCart] Failed to save cart:', e);
  }
  renderMenu();
  updateCartUI();
}

function updateCartUI() {
  const totalQty = cart.reduce((s, c) => s + c.quantity, 0);
  const subtotal = cart.reduce((s, c) => s + (c.item.price * c.quantity), 0);

  if (appliedCoupon && subtotal < parseFloat(appliedCoupon.min_bill)) {
    appliedCoupon = null;
    const feedback = $('#table-coupon-feedback');
    if (feedback) {
      feedback.textContent = `✗ Coupon cleared: Minimum bill of ₹${parseFloat(appliedCoupon.min_bill).toFixed(2)} required.`;
      feedback.style.color = '#dc2626';
      show(feedback);
    }
  }

  const discountAmt = appliedCoupon ? Math.round(subtotal * (appliedCoupon.discount_pct / 100)) : 0;
  const taxableItems = cart.filter(c => c.item && c.item.gst_applicable !== false);
  const taxableSub = taxableItems.reduce((s, c) => s + (c.item.price * c.quantity), 0);
  const discountRatio = subtotal > 0 ? (discountAmt / subtotal) : 0;
  const netTaxable = Math.max(0, taxableSub - (taxableSub * discountRatio));
  const gst = Math.round(netTaxable * 0.05);
  const totalAmt = subtotal - discountAmt + gst;

  // Update Badges & Totals
  if ($('#cart-count-desktop')) $('#cart-count-desktop').textContent = `${totalQty} item${totalQty === 1 ? '' : 's'}`;
  if ($('#cart-badge-mobile')) $('#cart-badge-mobile').textContent = totalQty;
  if ($('#cart-total-desktop')) $('#cart-total-desktop').textContent = `₹${subtotal.toFixed(2)}`;
  if ($('#cart-total-mobile')) $('#cart-total-mobile').textContent = `₹${subtotal.toFixed(2)}`;

  // Update Floating Quick Cart Pill (Blinkit Style)
  const floatingBar = $('#floating-cart-bar');
  if (floatingBar) {
    if (totalQty > 0) {
      floatingBar.classList.add('visible');
      const countEl = $('#floating-cart-count');
      const amtEl = $('#floating-cart-amount');
      if (countEl) countEl.textContent = `${totalQty} ${totalQty === 1 ? 'ITEM' : 'ITEMS'} IN TRAY`;
      if (amtEl) amtEl.textContent = `₹${totalAmt.toFixed(2)}`;
    } else {
      floatingBar.classList.remove('visible');
    }
  }

  // Update modal checkout breakdown
  if ($('modal-subtotal')) $('modal-subtotal').textContent = `₹${subtotal.toFixed(2)}`;
  
  if ($('modal-discount-row')) {
    if (appliedCoupon) {
      $('modal-discount').textContent = `-₹${discountAmt.toFixed(2)}`;
      show($('modal-discount-row'));
    } else {
      hide($('modal-discount-row'));
    }
  }
  
  if ($('modal-gst')) $('modal-gst').textContent = `₹${gst.toFixed(2)}`;
  if ($('modal-total')) $('modal-total').textContent = `₹${totalAmt.toFixed(2)}`;

  // Enable/Disable Place Order Buttons with dynamic price
  const hasItems = totalQty > 0;
  const btnDesktop = $('#btn-checkout-desktop');
  const btnMobile = $('#btn-checkout-mobile');
  if (btnDesktop) {
    btnDesktop.disabled = !hasItems;
    btnDesktop.innerHTML = `<span>🍽️ Place Table Order (₹${totalAmt.toFixed(2)})</span>`;
  }
  if (btnMobile) {
    btnMobile.disabled = !hasItems;
    btnMobile.innerHTML = `<span>🍽️ Place Table Order (₹${totalAmt.toFixed(2)})</span>`;
  }

  // Render Cart Listings
  renderCartListings(subtotal);
}

function renderCartListings(totalAmt) {
  const desktopContainer = $('#cart-items-desktop-container');
  const mobileContainer = $('#cart-items-mobile-container');

  if (cart.length === 0) {
    const emptyHtml = `
      <div class="py-12 text-center text-slate-400 space-y-2 flex-1 flex flex-col justify-center items-center">
        <p class="text-4xl">🛒</p>
        <p class="text-xs font-bold text-slate-600">Your order tray is empty</p>
        <p class="text-[11px] text-slate-400">Add dishes to place a table order</p>
      </div>
    `;
    desktopContainer.innerHTML = emptyHtml;
    mobileContainer.innerHTML = emptyHtml;
    return;
  }

  const itemsHtml = cart.map(c => {
    const isCombo = c.item.isCombo || (typeof c.item.id === 'string' && c.item.id.startsWith('combo-'));
    const isVeg = c.item.veg === true || c.item.type === 'veg';
    const vegDot = isCombo
      ? `<span class="text-xs shrink-0">🍱</span>`
      : `<div class="food-type-icon ${isVeg ? '' : 'non-veg'}" style="flex-shrink:0;"></div>`;

    return `
      <div class="p-2.5 sm:p-3 rounded-xl border border-slate-200 bg-white shadow-xs flex items-center justify-between gap-2.5">
        <div class="min-w-0 flex-1 text-left">
          <div class="flex items-center gap-1.5">
            ${vegDot}
            <p class="font-bold text-xs truncate text-slate-800">${c.item.name}</p>
          </div>
          <p class="text-[11px] text-[#0c831f] font-extrabold mt-1">₹${c.item.price} <span class="text-slate-400 font-normal">× ${c.quantity}</span></p>
        </div>
        <div class="shrink-0">
          <div class="card-stepper-btn">
            <button type="button" class="card-stepper-op btn-cart-minus" data-item-id="${c.item.id}" aria-label="Decrease quantity">−</button>
            <span class="card-stepper-val">${c.quantity}</span>
            <button type="button" class="card-stepper-op btn-cart-plus" data-item-id="${c.item.id}" aria-label="Increase quantity">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  desktopContainer.innerHTML = itemsHtml;
  mobileContainer.innerHTML = itemsHtml;

  // Click listeners for cart controls
  [desktopContainer, mobileContainer].forEach(container => {
    container.querySelectorAll('.btn-cart-plus').forEach(btn => {
      btn.addEventListener('click', () => {
        const idVal = btn.dataset.itemId;
        const id = idVal.startsWith('combo-') || isNaN(Number(idVal)) ? idVal : parseInt(idVal, 10);
        addToCart(id);
      });
    });

    container.querySelectorAll('.btn-cart-minus').forEach(btn => {
      btn.addEventListener('click', () => {
        const idVal = btn.dataset.itemId;
        const id = idVal.startsWith('combo-') || isNaN(Number(idVal)) ? idVal : parseInt(idVal, 10);
        removeFromCart(id);
      });
    });
  });
}

let cartUIInitialized = false;
let isSubmittingTableOrder = false;
let lastSubmittedTableOrderTime = 0;

function setupCartUI() {
  if (cartUIInitialized) return;
  cartUIInitialized = true;

  setupTableDetailDrawer();

  // Mobile floating cart bar & FAB controls
  $('#floating-cart-bar')?.addEventListener('click', () => {
    show($('#cart-drawer-overlay'));
  });

  $('#cart-fab-btn')?.addEventListener('click', () => {
    show($('#cart-drawer-overlay'));
  });

  $('#cart-drawer-close')?.addEventListener('click', () => {
    hide($('#cart-drawer-overlay'));
  });

  $('#cart-drawer-overlay')?.addEventListener('click', e => {
    if (e.target === $('#cart-drawer-overlay')) hide($('#cart-drawer-overlay'));
  });

  // Checkout modal controls
  const openModal = () => {
    show($('#checkout-modal'));
  };

  const closeModal = () => {
    hide($('#checkout-modal'));
  };

  $('#btn-checkout-desktop')?.addEventListener('click', openModal);
  $('#btn-checkout-mobile')?.addEventListener('click', () => {
    hide($('#cart-drawer-overlay'));
    openModal();
  });

  $('#checkout-modal-close')?.addEventListener('click', closeModal);
  $('#checkout-modal')?.addEventListener('click', e => {
    if (e.target === $('#checkout-modal')) closeModal();
  });

  // Coupon Validation logic
  $('#btn-apply-coupon')?.addEventListener('click', async () => {
    const input = $('#table-coupon-input');
    const feedback = $('#table-coupon-feedback');
    const phoneInput = document.querySelector('#checkout-form input[name="phone"]');
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const code = input.value.trim().toUpperCase();
    
    if (!code) {
      feedback.textContent = 'Please enter a coupon code';
      feedback.style.color = '#ff5b5b';
      feedback.classList.remove('hidden');
      return;
    }
    
    feedback.textContent = 'Validating...';
    feedback.style.color = '#cbd5e1';
    feedback.classList.remove('hidden');
    
    const subtotal = cart.reduce((s, c) => s + (c.item.price * c.quantity), 0);
    
    try {
      const res = await validateCouponCode(code, subtotal, phone);
      if (!res || !res.valid) {
        appliedCoupon = null;
        feedback.textContent = `✗ ${res?.message || 'Invalid or inactive coupon code'}`;
        feedback.style.color = '#ff5b5b';
        feedback.classList.remove('hidden');
        updateCartUI();
        return;
      }
      appliedCoupon = {
        code: res.code || code,
        discount_pct: res.discount_pct || res.coupon?.discount_pct || 0,
        min_bill: res.min_bill || res.coupon?.min_bill || 0
      };
      feedback.textContent = `✓ Code applied! Saved ${appliedCoupon.discount_pct}% on subtotal.`;
      feedback.style.color = '#10b981';
      feedback.classList.remove('hidden');
      updateCartUI();
    } catch (err) {
      appliedCoupon = null;
      feedback.textContent = `✗ ${err.message || 'Failed to validate coupon'}`;
      feedback.style.color = '#ff5b5b';
      feedback.classList.remove('hidden');
      updateCartUI();
    }
  });

  $('#checkout-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (isSubmittingTableOrder) return;
    const now = Date.now();
    if (now - lastSubmittedTableOrderTime < 4000) {
      console.warn('[TableOrder] Duplicate submission blocked by debounce lock');
      return;
    }

    const fd = new FormData(e.target);
    const name = fd.get('name').toString().trim() || 'Guest';
    const phone = fd.get('phone').toString().trim() || 'Dine-In';
    const instruction = fd.get('notes').toString().trim();

    await placeOrderAndShowSuccess(name, phone, instruction, 'cash', null);
  });

  async function placeOrderAndShowSuccess(name, phone, instruction, payment, txnRef) {
    if (isSubmittingTableOrder) return;
    if (!cart || cart.length === 0) {
      alert('Your cart is empty');
      return;
    }

    isSubmittingTableOrder = true;
    lastSubmittedTableOrderTime = Date.now();

    const isBn = getLanguage() === 'bn';
    const submitBtn = $('#btn-submit-order');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = isBn ? 'রান্নাঘরে পাঠানো হচ্ছে...' : 'Sending to Kitchen...';
    }

    try {
      const zone = currentTable <= 9 ? 'indoor' : 'outdoor';

      const subtotal = cart.reduce((s, c) => s + (c.item.price * c.quantity), 0);
      const taxableSubtotal = cart.reduce((s, c) => {
        if (c.item && c.item.gst_applicable === false) return s;
        return s + (c.item.price * c.quantity);
      }, 0);
      const discountAmt = appliedCoupon ? Math.round(subtotal * (appliedCoupon.discount_pct / 100)) : 0;
      const taxableDiscount = appliedCoupon && subtotal > 0 ? Math.round(taxableSubtotal * (appliedCoupon.discount_pct / 100)) : 0;
      const gst = Math.round(Math.max(0, taxableSubtotal - taxableDiscount) * 0.05);

      // Clean up legacy client round storage so browser never forces round 2
      try {
        sessionStorage.removeItem(`limra_table_session_round_${currentTable}`);
      } catch (e) {}

      const couponNote = appliedCoupon ? `[COUPON: ${appliedCoupon.code}] [DISCOUNT_PCT: ${appliedCoupon.discount_pct}%] [DISCOUNT_AMT: ${discountAmt}]` : '';
      const taxNote = `[CGST: 2.5%] [SGST: 2.5%]`;
      const paymentNote = `[PAYMENT: ${payment}] | [PAYMENT_STATUS: ${payment === 'upi' ? 'PAID' : 'PENDING'}]`;
      const combinedNotes = [paymentNote, taxNote, couponNote, instruction].filter(Boolean).join(' | ');

      // Strictly food items and their base prices (no tax/discount pseudo line items)
      const orderItems = cart.map(c => ({
        id: c.item.id,
        name: c.item.isCombo ? `🍱 [COMBO] ${c.item.name} (${c.item.description})` : c.item.name,
        price: Number(c.item.price),
        qty: Number(c.quantity)
      }));

      // Server-side authoritative round determination via place_table_round RPC
      const orderData = await saveTableRound({
        tableNumber: currentTable,
        tableZone: zone,
        customerName: name,
        customerPhone: phone,
        items: orderItems,
        notes: combinedNotes
      });

      if (appliedCoupon) {
        try {
          await redeemCoupon(appliedCoupon.code, phone, orderData.id);
        } catch (err) {
          console.error('Failed to redeem coupon:', err);
        }
      }

      try {
        const { data: promoList } = await insforge.database
          .from('coupons')
          .select('*')
          .eq('active', true)
          .eq('is_auto_send', true)
          .limit(1);
          
        if (promoList && promoList.length > 0) {
          const promo = promoList[0];
          const expDate = new Date(promo.expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
          $('#success-promo-code').textContent = promo.code;
          $('#success-promo-pct').textContent = `${promo.discount_pct}%`;
          $('#success-promo-expiry').textContent = expDate;
          show($('#success-promo-box'));
        } else {
          hide($('#success-promo-box'));
        }
      } catch (err) {
        console.error('Failed to load auto-send promo coupon:', err);
        hide($('#success-promo-box'));
      }

      closeModal();
      cart = [];
      appliedCoupon = null;
      const input = $('#table-coupon-input');
      if (input) input.value = '';
      const feedback = $('#table-coupon-feedback');
      if (feedback) hide(feedback);
      
      updateCartState();
      
      const isBnLang = getLanguage() === 'bn';
      const rawNum = parseInt(orderData.order_number, 10);
      const formattedNum = !isNaN(rawNum) && rawNum > 0 ? (rawNum < 10 ? `0${rawNum}` : `${rawNum}`) : String(orderData.order_number || '01');
      $('#success-order-number').textContent = `#${formattedNum}`;
      $('#success-table-number').textContent = isBnLang ? `টেবিল ${currentTable}` : `Table ${currentTable}`;
      $('#success-diner-name').textContent = name;

      const appendBadge = $('#success-append-badge');
      if (appendBadge) {
        if (orderData.is_subsequent_round || orderData.is_appended) {
          const roundText = orderData.round_number
            ? (isBnLang ? `রাউন্ড ${orderData.round_number} রান্নাঘরে পাঠানো হয়েছে! 🍽️` : `Round ${orderData.round_number} Sent to Kitchen! 🍽️`)
            : (isBnLang ? 'নতুন খাবার রান্নাঘরে পাঠানো হয়েছে! 🍽️' : 'Additional Round Sent to Kitchen! 🍽️');
          appendBadge.textContent = roundText;
          show(appendBadge);
        } else {
          hide(appendBadge);
        }
      }

      hide($('#customer-view'));
      show($('#success-view'));
      triggerGoogleReviewPrompt();
    } catch (err) {
      alert('Failed to place order: ' + err.message);
    } finally {
      isSubmittingTableOrder = false;
      const isBnLang = getLanguage() === 'bn';
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isBnLang ? 'নিশ্চিত করে রান্নাঘরে পাঠান' : 'Confirm & Send to Kitchen';
      }
    }
  }

  function triggerGoogleReviewPrompt(delay = 450) {
    setTimeout(() => {
      const modal = $('#google-review-modal');
      const submitBtn = $('#btn-submit-google-review');
      const closeBtn = $('#btn-close-google-review');
      const cornerBtn = $('#btn-dismiss-review-corner');
      
      if (!modal || !submitBtn || !closeBtn) return;
      
      submitBtn.href = GOOGLE_REVIEW_URL;
      
      const dismiss = () => {
        hide(modal);
      };
      
      submitBtn.onclick = dismiss;
      closeBtn.onclick = dismiss;
      if (cornerBtn) cornerBtn.onclick = dismiss;
      modal.onclick = (e) => {
        if (e.target === modal) dismiss();
      };
      
      show(modal);
    }, delay);
  }

  // Setup direct review button triggers
  ['#btn-header-review', '#btn-banner-review', '#btn-success-review'].forEach(selector => {
    const btn = $(selector);
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        triggerGoogleReviewPrompt(0);
      });
    }
  });

  // Success view ordering more
  $('#btn-order-more').addEventListener('click', () => {
    hide($('#success-view'));
    show($('#customer-view'));
  });
}

// ====================================================
// OWNER/ADMIN VIEW LOGIC (QR CODE PORTAL)
// ====================================================
function initOwnerView() {
  const tableNodes = document.querySelectorAll('.layout-table-node');
  
  tableNodes.forEach(node => {
    node.addEventListener('click', () => {
      tableNodes.forEach(n => n.classList.remove('active'));
      node.classList.add('active');
      
      const id = node.dataset.tableId;
      const isIndoor = parseInt(id, 10) <= 9;
      
      renderQRCard(id, isIndoor ? 'Indoor Area' : 'Outdoor Area');
    });
  });

  // Setup QR Card Buttons
  $('#btn-copy-url').addEventListener('click', () => {
    const copyText = $('#qr-url-input');
    copyText.select();
    navigator.clipboard.writeText(copyText.value);
    
    const originalText = $('#btn-copy-url').textContent;
    $('#btn-copy-url').textContent = 'Copied!';
    setTimeout(() => {
      $('#btn-copy-url').textContent = originalText;
    }, 1500);
  });

  $('#btn-print-qr').addEventListener('click', () => {
    const w = window.open();
    const qrImg = $('#qr-code-image').src;
    const tableTitle = $('#qr-table-title').textContent;
    const subtitle = $('#qr-table-subtitle').textContent;
    const url = $('#qr-url-input').value;

    w.document.write(`
      <html>
      <head>
        <title>Print QR Label</title>
        <style>
          body {
            font-family: 'Inter', sans-serif;
            text-align: center;
            padding: 40px;
            color: #1e293b;
          }
          .label-card {
            border: 3px solid #f59e0b;
            padding: 30px;
            border-radius: 24px;
            max-width: 380px;
            margin: 0 auto;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
          }
          h1 {
            color: #d97706;
            margin: 0 0 5px 0;
            font-size: 28px;
            font-weight: 800;
          }
          p.sub {
            color: #64748b;
            margin: 0 0 20px 0;
            text-transform: uppercase;
            font-size: 11px;
            letter-spacing: 0.1em;
            font-weight: 700;
          }
          img {
            width: 250px;
            height: 250px;
            margin-bottom: 20px;
          }
          p.instructions {
            font-size: 14px;
            margin: 0 0 10px 0;
            color: #334155;
            font-weight: 600;
          }
          p.url {
            font-family: monospace;
            font-size: 10px;
            color: #64748b;
            word-break: break-all;
            margin: 0;
          }
        </style>
      </head>
      <body>
        <div class="label-card">
          <h1>LIMRA Restaurant</h1>
          <p class="sub">${tableTitle} · ${subtitle}</p>
          <img src="${qrImg}" />
          <p class="instructions">📱 Scan to View Menu & Place Order</p>
          <p class="url">${url}</p>
        </div>
        <script>
          window.onload = function() {
            window.print();
            window.close();
          }
        </script>
      </body>
      </html>
    `);
    w.document.close();
  });
}

function renderQRCard(tableId, areaLabel) {
  hide($('#qr-placeholder'));
  show($('#qr-card'));

  $('#qr-table-title').textContent = `Table ${tableId}`;
  $('#qr-table-subtitle').textContent = areaLabel;

  // Generate URL
  const destinationUrl = `${window.location.origin}/table/index.html?table=${tableId}`;
  $('#qr-url-input').value = destinationUrl;

  // Generate QR Code URL using public server
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(destinationUrl)}`;
  $('#qr-code-image').src = qrCodeUrl;

  // Setup Download Link via blob to bypass CORS download issues
  fetch(qrCodeUrl)
    .then(response => response.blob())
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      const dlBtn = $('#btn-download-qr');
      dlBtn.href = blobUrl;
      dlBtn.download = `table_${tableId}_qr.png`;
    })
    .catch(err => {
      console.error('Error fetching QR code blob:', err);
      const dlBtn = $('#btn-download-qr');
      dlBtn.href = qrCodeUrl;
      dlBtn.removeAttribute('download');
    });
}

// ═══════════════════════════════════════
// PRODUCT DETAILS & RECOMMENDATIONS DRAWER
// ═══════════════════════════════════════

// Fetch dynamic recommendations for a menu item inside Dine-In
function getTableRecommendations(item) {
  if (!item) return [];

  const nameLower = (item.name || '').toLowerCase();
  const category = item.category || '';

  let recommendedCategories = [];
  
  if (item.isCombo) {
    // For combo packages, suggest Cold Drinks, Lassi, Milkshakes, Mocktails, or Desserts
    recommendedCategories = ['beverages', 'lassi', 'milkshakes', 'mocktails', 'desserts'];
  }
  // Rule 1: If they select Naan or Breads -> recommend Gravies/Curries
  else if (category === 'bread' || nameLower.includes('naan') || nameLower.includes('roti') || nameLower.includes('kulcha')) {
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

// Open Dine-In Product Detail Drawer
function openTableDetailDrawer(itemId) {
  let isCombo = false;
  let item = null;
  let combo = null;

  if (typeof itemId === 'string' && itemId.startsWith('combo-')) {
    const comboId = parseInt(itemId.replace('combo-', ''), 10);
    combo = activeCombos.find(c => c.id === comboId);
    if (!combo) return;
    isCombo = true;
    const itemsListStr = Array.isArray(combo.items)
      ? combo.items.map(it => `${it.name} (x${it.qty || 1})`).join(' + ')
      : 'No items';
    item = {
      id: itemId,
      name: combo.name,
      price: parseFloat(combo.price),
      mrp: combo.mrp ? parseFloat(combo.mrp) : null,
      category: 'specials',
      description: combo.description ? combo.description : `Special combo pack featuring ${itemsListStr}. Prepared fresh with authentic ingredients at LIMRA Restaurant Egra.`,
      image: combo.image_url || combo.image || '/images/food_biryani.png',
      emoji: '🍱',
      isCombo: true,
      items: combo.items || []
    };
  } else if (String(itemId).startsWith('custom_')) {
    item = (activeCustomDishes || []).find(i => String(i.id) === String(itemId));
    if (!item) {
      try {
        const cached = JSON.parse(localStorage.getItem('limra_custom_foods') || '[]');
        item = cached.find(i => String(i.id) === String(itemId));
      } catch (e) {}
    }
  } else {
    const numId = typeof itemId === 'number' ? itemId : parseInt(itemId, 10);
    item = menuItems.find(m => m.id === numId) || (activeCustomDishes || []).find(i => String(i.id) === String(itemId));
    if (!item && isNaN(numId)) {
      try {
        const cached = JSON.parse(localStorage.getItem('limra_custom_foods') || '[]');
        item = cached.find(i => String(i.id) === String(itemId));
      } catch (e) {}
    }
  }

  if (!item) return;

  const overlay = $('#table-detail-overlay');
  const drawer = $('#table-detail-drawer');
  if (!overlay || !drawer) return;

  // Set standard info
  $('#table-drawer-name').textContent = item.name;
  $('#table-drawer-category').textContent = isCombo ? '🍱 Combo Pack' : (categoryLabels[item.category] || item.category);
  
  // Price and MRP with strike-through discount
  const priceContainer = $('#table-drawer-price');
  if (priceContainer) {
    const hasDiscount = item.mrp && parseFloat(item.mrp) > parseFloat(item.price);
    priceContainer.innerHTML = `
      <span>₹${item.price}</span>
      ${hasDiscount ? `<span class="text-xs font-normal text-slate-400 line-through ml-2">₹${item.mrp}</span>` : ''}
    `;
  }

  // Description
  const descEl = $('#table-drawer-desc');
  if (descEl) {
    descEl.textContent = item.description || `Fresh and authentic ${item.name} prepared with traditional spices and methods at LIMRA Restaurant Egra.`;
  }

  // Included combo items section in drawer
  const comboItemsSec = $('#table-drawer-combo-items');
  const comboItemsList = $('#table-drawer-combo-items-list');
  if (comboItemsSec && comboItemsList) {
    if (isCombo && Array.isArray(item.items) && item.items.length > 0) {
      comboItemsList.innerHTML = item.items.map(it => `
        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold">
          <span>🍴</span>
          <span>${it.name}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/25 text-amber-200 font-bold">×${it.qty || 1}</span>
        </span>
      `).join('');
      show(comboItemsSec);
    } else {
      hide(comboItemsSec);
    }
  }

  // Drawer image handling with fallback emoji
  const drawerImg = $('#table-drawer-image');
  const drawerEmoji = $('#table-drawer-emoji');
  if (drawerImg) {
    drawerImg.style.display = 'block';
    drawerImg.src = item.image || '/images/food_biryani.png';
    drawerImg.onerror = () => {
      drawerImg.style.display = 'none';
      if (drawerEmoji) {
        drawerEmoji.textContent = item.emoji || (isCombo ? '🍱' : '🍛');
        drawerEmoji.style.display = 'flex';
      }
    };
    if (drawerEmoji) drawerEmoji.style.display = 'none';
  }

  // Render actions (+ / - / Add)
  updateTableDrawerActions(item);

  // Render recommendations pairing
  const recGrid = $('#table-drawer-recommendations-grid');
  const recSection = $('#table-drawer-recommendations-section');
  const recommendations = getTableRecommendations(item);

  if (recGrid && recSection) {
    if (recommendations.length > 0) {
      recGrid.innerHTML = '';
      recommendations.forEach(rec => {
        const recCard = document.createElement('div');
        recCard.className = 'flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-2xl hover:border-emerald-500/40 shadow-xs transition-colors cursor-pointer';
        
        const recImg = rec.image || '/images/food_biryani.png';
        const recEmoji = rec.emoji || '🍲';
        const isRecVeg = rec.veg === true || rec.type === 'veg';
        const recVegDot = `<div class="food-type-icon ${isRecVeg ? '' : 'non-veg'}" style="flex-shrink:0;"></div>`;
        
        recCard.innerHTML = `
          <div class="w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-slate-100 bg-neutral-100 flex items-center justify-center relative">
            <img src="${recImg}" alt="${rec.name}" class="w-full h-full object-cover error-fallback" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
            <span class="text-xl absolute inset-0 flex items-center justify-center" style="display:none;">${recEmoji}</span>
          </div>
          <div class="flex-1 min-w-0 text-left">
            <div class="flex items-center gap-1.5">
              ${recVegDot}
              <h5 class="text-xs font-bold text-slate-800 truncate">${rec.name}</h5>
            </div>
            <span class="text-[11px] font-extrabold text-[#0c831f]">₹${rec.price}</span>
          </div>
          <button class="rec-add-btn shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-[#0c831f] hover:bg-[#096a18] active:scale-90 text-white font-extrabold text-sm shadow-xs transition-all">
            +
          </button>
        `;

        // Allow opening the recommendation item detail if clicked (excluding add button)
        recCard.addEventListener('click', (e) => {
          if (!e.target.closest('.rec-add-btn')) {
            openTableDetailDrawer(rec.id);
          }
        });

        // Bind add button click
        recCard.querySelector('.rec-add-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          addToCart(rec.id);
          
          // Re-render current drawer item's action (in case they added the same item that's currently in focus)
          updateTableDrawerActions(item);

          // Checked micro-interaction
          const btn = e.currentTarget;
          btn.textContent = '✓';
          btn.classList.replace('bg-[#0c831f]', 'bg-slate-200');
          btn.classList.replace('text-white', 'text-slate-800');
          setTimeout(() => {
            btn.textContent = '+';
            btn.classList.replace('bg-slate-200', 'bg-[#0c831f]');
            btn.classList.replace('text-slate-800', 'text-white');
          }, 1200);
        });

        recGrid.appendChild(recCard);
      });
      show(recSection);
    } else {
      hide(recSection);
    }
  }

  // Show drawer and overlay
  show(overlay);
  show(drawer);
  void drawer.offsetWidth; // trigger reflow
  overlay.classList.remove('opacity-0');
  drawer.classList.add('open');
}

// Render dynamic quantity controller for drawer
function updateTableDrawerActions(item) {
  const container = $('#table-drawer-actions-container');
  if (!container || !item) return;

  if (item.available === false) {
    container.innerHTML = `
      <button class="add-btn" disabled style="padding: 0.5rem 1.25rem; font-size: 0.85rem; opacity: 0.5; cursor: not-allowed; background: #94a3b8; border-color: #94a3b8; color: #fff;">
        SOLD OUT
      </button>
    `;
    return;
  }

  const cartItem = cart.find(c => c.item.id === item.id || String(c.item.id) === String(item.id));
  const qty = cartItem ? cartItem.quantity : 0;

  if (qty > 0) {
    container.innerHTML = `
      <div class="card-stepper-btn" style="min-width: 90px; padding: 0.35rem 0.6rem;">
        <button type="button" class="card-stepper-op btn-drawer-minus" aria-label="Decrease quantity">−</button>
        <span class="card-stepper-val" style="font-size: 0.95rem;">${qty}</span>
        <button type="button" class="card-stepper-op btn-drawer-plus" aria-label="Increase quantity">+</button>
      </div>
    `;

    container.querySelector('.btn-drawer-plus').addEventListener('click', () => {
      addToCart(item.id);
      updateTableDrawerActions(item);
    });

    container.querySelector('.btn-drawer-minus').addEventListener('click', () => {
      removeFromCart(item.id);
      updateTableDrawerActions(item);
    });
  } else {
    container.innerHTML = `
      <button class="add-btn btn-drawer-add" style="padding: 0.5rem 1.25rem; font-size: 0.85rem;">
        + ADD TO TRAY
      </button>
    `;

    container.querySelector('.btn-drawer-add').addEventListener('click', () => {
      addToCart(item.id);
      updateTableDrawerActions(item);
    });
  }
}

// Close Dine-In Product Detail Drawer
function closeTableDetailDrawer() {
  const overlay = $('#table-detail-overlay');
  const drawer = $('#table-detail-drawer');
  if (!overlay || !drawer) return;

  overlay.classList.add('opacity-0');
  drawer.classList.remove('open');

  setTimeout(() => {
    hide(overlay);
    hide(drawer);
  }, 350);
}

// Bind Drawer Event Listeners
function setupTableDetailDrawer() {
  const overlay = $('#table-detail-overlay');
  const closeBtn = $('#table-drawer-close');

  if (closeBtn) closeBtn.addEventListener('click', closeTableDetailDrawer);
  if (overlay) {
    overlay.addEventListener('click', closeTableDetailDrawer);
  }
  document.addEventListener('keydown', (e) => {
    const drawer = $('#table-detail-drawer');
    if (drawer && !drawer.classList.contains('hidden') && e.key === 'Escape') {
      closeTableDetailDrawer();
    }
  });
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
