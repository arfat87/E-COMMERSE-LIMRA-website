/**
 * =============================================================================
 * LIMRA RESTAURANT POS — CATALOG, COMBOS, COUPONS & CRM (pos/catalog-crm.js)
 * =============================================================================
 * 
 * Provides:
 * 1. Combos & Meal Deals manager (validation, hub metrics, modal, cards).
 * 2. Coupons & Promo Codes engine (validation, hub metrics, modal, auto-send).
 * 3. Customer CRM & Autocomplete (lookup, data minimization, tiers, CSV export).
 * 4. Delivery Places & Zones manager (place table, modal, fee calculations).
 * 5. Table & Hall Bookings manager (render, status transitions, lifecycle).
 */

import { posState, posEvents } from './state.js';
import { escapeHtml } from './pos-utils.js';
import { showAdminToast } from './audio-alerts.js';

// ── Combos & Meal Deals Engine ────────────────────────────────────────

/**
 * Validates whether a combo deal is currently active and within expiry bounds.
 */
export function isComboActiveAndValid(c, now = new Date()) {
  if (!c || typeof c !== 'object') return false;
  if (c.available === false || c.active === false) return false;
  const price = parseFloat(c.price || 0);
  if (isNaN(price) || price <= 0) return false;
  const expRaw = c.expiry_date || c.valid_until || c.expires_at;
  if (expRaw) {
    const expDate = new Date(expRaw);
    if (!isNaN(expDate.getTime()) && expDate < now) return false;
  }
  return true;
}

/**
 * Computes analytics and filtered list for Combos Hub.
 */
export function computeCombosHubData(combos = null, filter = 'all', search = '') {
  const adminCombos = combos || posState.getAdminCombos() || [];
  const now = new Date();

  const totalCombos = adminCombos.length;
  const activeCombos = adminCombos.filter(c => isComboActiveAndValid(c, now)).length;

  let totalSavingsPct = 0;
  let savingsCount = 0;
  let totalPrice = 0;

  adminCombos.forEach(c => {
    const price = Number(c.price || 0);
    const mrp = Number(c.mrp || 0);
    totalPrice += price;
    if (mrp > price && mrp > 0) {
      totalSavingsPct += ((mrp - price) / mrp) * 100;
      savingsCount++;
    }
  });

  const avgPrice = totalCombos > 0 ? totalPrice / totalCombos : 0;
  const avgSavings = savingsCount > 0 ? Math.round(totalSavingsPct / savingsCount) : 0;

  let list = adminCombos.slice();
  if (filter === 'active') {
    list = list.filter(c => isComboActiveAndValid(c, now));
  } else if (filter === 'disabled') {
    list = list.filter(c => !isComboActiveAndValid(c, now));
  }

  const q = String(search || '').toLowerCase().trim();
  if (q) {
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.description || '').toLowerCase().includes(q) ||
      String(c.price || '').includes(q)
    );
  }

  return {
    list,
    totalCombos,
    activeCombos,
    avgPrice,
    avgSavings
  };
}

// ── Coupons & Promo Codes Engine ──────────────────────────────────────

/**
 * Parses end-of-day timestamp for coupon expiry.
 */
export function parseCouponExpiryEndOfDay(expiryStr) {
  if (!expiryStr) return null;
  const d = new Date(expiryStr);
  if (isNaN(d.getTime())) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Validates a coupon code against subtotal, customer history, and constraints.
 */
export function validatePosCoupon(codeOrCoupon, subtotal = 0, customerPhone = '', options = {}) {
  const couponsList = options.coupons || posState.getAdminCoupons() || [];
  const currentApplied = options.appliedCoupon;
  const now = options.now ? new Date(options.now) : new Date();
  const rawCode = typeof codeOrCoupon === 'string'
    ? codeOrCoupon.trim().toUpperCase()
    : String(codeOrCoupon?.code || '').trim().toUpperCase();

  if (!rawCode) {
    return { valid: false, reason: 'EMPTY_CODE', message: 'Please enter a coupon code.' };
  }

  if (currentApplied && String(currentApplied.code || '').toUpperCase() === rawCode && !options.allowRevalidateCurrent) {
    return { valid: false, reason: 'ALREADY_APPLIED', message: `Coupon "${rawCode}" is already applied to this bill.` };
  }

  if (currentApplied && String(currentApplied.code || '').toUpperCase() !== rawCode && options.preventMultiple) {
    return {
      valid: false,
      reason: 'MULTIPLE_COUPON_ATTEMPT',
      message: `Coupon "${currentApplied.code}" is already applied. Remove it before applying another coupon.`
    };
  }

  const c = (typeof codeOrCoupon === 'object' && codeOrCoupon && codeOrCoupon.code)
    ? codeOrCoupon
    : couponsList.find(item => String(item?.code || '').trim().toUpperCase() === rawCode);

  if (!c) {
    return { valid: false, reason: 'NOT_FOUND', message: `Invalid coupon code "${rawCode}".` };
  }

  if (c.active === false) {
    return { valid: false, reason: 'INACTIVE', message: `Coupon "${rawCode}" is inactive.` };
  }

  const expDate = parseCouponExpiryEndOfDay(c.expiry_date);
  if (expDate && expDate < now) {
    return { valid: false, reason: 'EXPIRED', message: `Coupon "${rawCode}" has expired (${c.expiry_date}).` };
  }

  const maxUses = parseInt(c.max_uses, 10);
  const usedCount = parseInt(c.used_count || 0, 10);
  if (!isNaN(maxUses) && maxUses > 0 && usedCount >= maxUses) {
    return { valid: false, reason: 'MAX_USES_REACHED', message: `Coupon "${rawCode}" usage limit has been reached.` };
  }

  const minBill = parseFloat(c.min_bill || 0);
  if (!isNaN(minBill) && minBill > 0 && subtotal < minBill) {
    return {
      valid: false,
      reason: 'MIN_BILL_NOT_MET',
      minBill,
      message: `Minimum bill of ₹${minBill.toFixed(2)} required for coupon "${rawCode}" (Current items: ₹${subtotal.toFixed(2)}).`
    };
  }

  // Customer phone reuse check
  const pastOrders = options.pastOrders || posState.getOrders() || [];
  const digits = String(customerPhone || '').replace(/\D/g, '');
  if (digits && digits.length >= 10 && !c.allow_repeat) {
    const alreadyUsed = pastOrders.some(o => {
      if (o.status === 'cancelled') return false;
      const oPhone = String(o.customer_phone || '').replace(/\D/g, '');
      if (oPhone !== digits) return false;
      const notes = String(o.notes || '').toUpperCase();
      return notes.includes(`COUPON: ${rawCode}`) || notes.includes(`COUPON:${rawCode}`);
    });

    if (alreadyUsed) {
      return {
        valid: false,
        reason: 'CUSTOMER_ALREADY_USED',
        message: `Customer ${digits.slice(-4)} has already redeemed coupon "${rawCode}".`
      };
    }
  }

  // Calculate discount
  const discountPct = Math.min(100, Math.max(0, parseFloat(c.discount_pct || 0)));
  const discountAmount = Math.round(((subtotal * discountPct) / 100) * 100) / 100;

  return {
    valid: true,
    coupon: c,
    code: rawCode,
    discountPct,
    discountAmount,
    message: `Coupon "${rawCode}" applied: ${discountPct}% off (₹${discountAmount.toFixed(2)} saved).`
  };
}

/**
 * Computes analytics and filtered list for Coupons Hub.
 */
export function computeCouponsHubData(coupons = null, orders = null, filter = 'all', search = '') {
  const adminCoupons = coupons || posState.getAdminCoupons() || [];
  const pastOrders = orders || posState.getOrders() || [];
  const now = new Date();

  const activeCoupons = adminCoupons.filter(c =>
    c.active &&
    new Date(c.expiry_date) >= now &&
    (c.used_count || 0) < (c.max_uses || 999999)
  ).length;

  const totalRedemptions = adminCoupons.reduce((sum, c) => sum + (parseInt(c.used_count, 10) || 0), 0);

  let discountGiven = 0;
  if (Array.isArray(pastOrders)) {
    pastOrders.forEach(o => {
      if (o.notes && o.notes.includes('COUPON:')) {
        const match = o.notes.match(/DISCOUNT:\s*₹?([0-9.]+)/i);
        if (match) discountGiven += parseFloat(match[1]);
      }
    });
  }

  if (discountGiven === 0 && totalRedemptions > 0) {
    discountGiven = adminCoupons.reduce((sum, c) => {
      const avgSaved = (c.min_bill || 200) * ((c.discount_pct || 10) / 100);
      return sum + ((c.used_count || 0) * avgSaved);
    }, 0);
  }

  let topCoupon = null;
  let maxUses = 0;
  adminCoupons.forEach(c => {
    const uses = parseInt(c.used_count, 10) || 0;
    if (uses > maxUses) {
      maxUses = uses;
      topCoupon = c.code;
    }
  });

  let list = adminCoupons.slice();
  if (filter === 'active') {
    list = list.filter(c => c.active && new Date(c.expiry_date) >= now && (c.used_count || 0) < (c.max_uses || 999999));
  } else if (filter === 'expired') {
    list = list.filter(c => !c.active || new Date(c.expiry_date) < now || (c.used_count || 0) >= (c.max_uses || 999999));
  } else if (filter === 'autosend') {
    list = list.filter(c => c.is_auto_send);
  }

  const q = String(search || '').toLowerCase().trim();
  if (q) {
    list = list.filter(c =>
      (c.code || '').toLowerCase().includes(q) ||
      String(c.discount_pct || '').includes(q) ||
      String(c.min_bill || '').includes(q)
    );
  }

  return {
    list,
    activeCoupons,
    totalRedemptions,
    discountGiven,
    topCoupon
  };
}

// ── Customer CRM & Autocomplete Engine ────────────────────────────────

/**
 * Builds aggregated customer loyalty and spending profiles from orders history.
 */
export function buildCustomerStats(orders = null) {
  const orderList = orders || posState.getOrders() || [];
  const map = new Map();

  for (const o of orderList) {
    if (!o) continue;
    const phone = String(o.customer_phone || '').trim();
    if (!phone || phone === '9999999999' || phone === '0000000000') continue;

    const name = String(o.customer_name || '').trim();
    const amount = Number(o.total_amount || 0);
    const date = o.created_at ? new Date(o.created_at) : new Date();

    if (!map.has(phone)) {
      map.set(phone, {
        phone,
        name: name || 'Customer',
        orderCount: 0,
        totalSpent: 0,
        firstOrder: date,
        lastOrder: date,
        lastAddress: o.delivery_address || '',
        lastPlace: o.delivery_place || '',
        tier: 'new'
      });
    }

    const rec = map.get(phone);
    rec.orderCount += 1;
    if (o.payment_status === 'paid' || o.ticket_status === 'CLOSED') {
      rec.totalSpent += amount;
    }
    if (name && name !== 'Customer' && name !== 'Walk-in Guest') {
      rec.name = name;
    }
    if (date > rec.lastOrder) {
      rec.lastOrder = date;
      if (o.delivery_address) rec.lastAddress = o.delivery_address;
      if (o.delivery_place) rec.lastPlace = o.delivery_place;
    }
  }

  // Calculate Loyalty Tiers
  for (const rec of map.values()) {
    if (rec.orderCount >= 10 || rec.totalSpent >= 5000) {
      rec.tier = 'gold';
    } else if (rec.orderCount >= 4 || rec.totalSpent >= 1500) {
      rec.tier = 'silver';
    } else if (rec.orderCount >= 2) {
      rec.tier = 'bronze';
    } else {
      rec.tier = 'new';
    }
  }

  return Array.from(map.values());
}

/**
 * Fast debounced autocomplete search for POS customer input.
 * Implements strict data minimization (excludes sensitive payment/order references).
 */
export function lookupPosCustomers(query, options = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const digits = q.replace(/\D/g, '');
  const qLower = q.toLowerCase();
  const limit = options.limit || 6;

  const stats = Array.isArray(options.customersList) ? options.customersList : buildCustomerStats();
  const filtered = stats.filter(c => {
    if (!c || !c.phone) return false;
    const cDigits = String(c.phone).replace(/\D/g, '');
    if (!cDigits || cDigits === '9999999999' || cDigits === '0000000000') return false;
    const cName = String(c.name || '').trim();
    const matchesPhone = digits.length >= 3 && cDigits.includes(digits);
    const matchesName = qLower.length >= 2 && cName && cName.toLowerCase().includes(qLower) && cName !== 'Customer' && cName !== 'Walk-in Guest';
    return matchesPhone || matchesName;
  });

  filtered.sort((a, b) => {
    const aDigits = String(a.phone).replace(/\D/g, '');
    const bDigits = String(b.phone).replace(/\D/g, '');
    if (digits.length >= 3) {
      const aStarts = aDigits.startsWith(digits) || aDigits.endsWith(digits) ? 1 : 0;
      const bStarts = bDigits.startsWith(digits) || bDigits.endsWith(digits) ? 1 : 0;
      if (bStarts !== aStarts) return bStarts - aStarts;
    }
    return (b.orderCount || 0) - (a.orderCount || 0);
  });

  return filtered.slice(0, limit).map(c => ({
    name: (c.name && c.name !== 'Customer' && c.name !== 'Walk-in Guest') ? c.name : '',
    phone: String(c.phone || '').trim(),
    tier: c.tier || 'new',
    orderCount: Number(c.orderCount || 0),
    savedAddress: String(c.lastAddress || '').trim(),
    savedPlace: String(c.lastPlace || '').trim()
  }));
}

/**
 * Generates CSV content for customer loyalty records.
 */
export function exportCustomersCSV(customersList = null) {
  const list = customersList || buildCustomerStats();
  const headers = ['Phone', 'Name', 'Tier', 'Orders', 'Total Spent (INR)', 'Last Order Date', 'Saved Address'];
  
  const rows = list.map(c => [
    `"${c.phone}"`,
    `"${(c.name || '').replace(/"/g, '""')}"`,
    c.tier,
    c.orderCount,
    (c.totalSpent || 0).toFixed(2),
    c.lastOrder ? new Date(c.lastOrder).toISOString().slice(0, 10) : '',
    `"${(c.lastAddress || '').replace(/"/g, '""')}"`
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
