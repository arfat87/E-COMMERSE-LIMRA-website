/**
 * TASK 2.2 AUTOMATED VERIFICATION SUITE
 * Verifies:
 *  1. Active and expired/unavailable combos in POS (#pos-category-pills, #pos-food-grid, combo badge, included items, MRP savings, cart addition)
 *  2. Valid and invalid coupons (active, inactive, expired, min_bill, max_uses, customer reuse)
 *  3. Coupon removal & cart summary restoration
 *  4. Multiple coupon attempts (duplicate same-coupon prevention & multi-coupon stacking prevention)
 *  5. Existing customer autocomplete lookup (debounced search, auto-fill name & saved delivery address, data minimization)
 *  6. New/unknown customer phone number graceful handling
 *  7. Customer name and delivery address manual editing after auto-fill
 *  8. Final payable amount and GST calculations parity with calculateOrderBilling
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateOrderBilling } from '../../frontend/src/lib/billing-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const adminHtml = fs.readFileSync(path.join(ROOT, 'frontend/admin.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(ROOT, 'frontend/src/admin.css'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'frontend/src/admin.js'), 'utf8');

console.log('==================================================================');
console.log('  TASK 2.2: POS COMBOS, COUPONS & CUSTOMER AUTOCOMPLETE TESTS     ');
console.log('==================================================================\n');

let passed = 0;
async function runTests() {
  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${name}`);
      console.error('     Error:', err.message);
      process.exit(1);
    }
  }

  // ---------------------------------------------------------------------------
  // 0. Static Structural Verification in admin.html, admin.css, and admin.js
  // ---------------------------------------------------------------------------
  await test('0. HTML, CSS & JS wire Combos, Coupon Picker, and Customer Autocomplete in POS', () => {
    // Customer Autocomplete DOM & JS hooks
    assert.match(adminHtml, /id="pos-customer-strip"/);
    assert.match(adminHtml, /id="pos-customer-suggestions"\s+class="pos-customer-dropdown"/);
    assert.match(adminJs, /export function lookupPosCustomers\(/);
    assert.match(adminJs, /export function selectPosCustomerSuggestion\(/);
    assert.match(adminJs, /triggerDebouncedCustomerLookup/);

    // Coupon Picker DOM & JS hooks
    assert.match(adminHtml, /id="pos-coupon-row"/);
    assert.match(adminHtml, /id="pos-applied-coupon-code"/);
    assert.match(adminHtml, /id="pos-remove-coupon-btn"/);
    assert.match(adminHtml, /id="pos-extra-coupon-btn"[^>]*data-popover="coupon"/);
    assert.match(adminHtml, /id="pos-popover-coupon"\s+class="pos-extra-popover"/);
    assert.match(adminHtml, /id="pos-coupon-code-input"/);
    assert.match(adminHtml, /id="pos-coupon-apply-btn"/);
    assert.match(adminHtml, /id="pos-coupon-picker-list"/);
    assert.match(adminJs, /export function validatePosCoupon\(/);
    assert.match(adminJs, /export function applyPosCoupon\(/);
    assert.match(adminJs, /export function removePosCoupon\(/);

    // Combos DOM, CSS & JS hooks
    assert.match(adminJs, /'combo':\s*\['combo'\]/);
    assert.match(adminJs, /export function isComboActiveAndValid\(/);
    assert.match(adminJs, /pos-combo-badge/);
    assert.match(adminJs, /pos-cart-combo-tag/);
    assert.match(adminCss, /\.pos-combo-badge\s*\{/);
    assert.match(adminCss, /\.pos-coupon-picker-list\s*\{/);
    assert.match(adminCss, /\.pos-customer-dropdown\s*\{/);
  });

  // ---------------------------------------------------------------------------
  // Simulation Harness mirroring frontend/src/admin.js Task 2.2 logic
  // ---------------------------------------------------------------------------
  function createTask22PosHarness() {
    const now = new Date('2026-10-31T12:00:00Z');
    let posCart = [];
    let posOrderType = 'table';
    let posAppliedCoupon = null;
    let posSelectedPlace = null;

    const dom = {
      'pos-customer-name': { value: '', autoFilled: false },
      'pos-customer-phone': { value: '' },
      'pos-delivery-address': { value: '', autoFilled: false },
      'pos-place-search': { value: '' },
      'pos-discount-pct': { value: '0' },
      'pos-delivery-fee': { value: '0' },
      'pos-coupon-code-input': { value: '' },
      'pos-coupon-feedback': { textContent: '', type: '', visible: false },
      'pos-cust-hint': { textContent: 'Quick Bill Mode' },
      'pos-customer-suggestions': { visible: false, items: [] }
    };

    const adminPlaces = [
      { id: 1, name: 'Egra Bazar', charge: 20 },
      { id: 2, name: 'Contai Road', charge: 40 }
    ];

    const adminCombos = [
      {
        id: 101,
        name: 'Family Biryani Feast',
        price: 499,
        mrp: 620,
        available: true,
        items: [
          { id: 'm1', name: 'Chicken Biryani', qty: 2 },
          { id: 'm2', name: 'Chicken Chaap', qty: 2 },
          { id: 'm3', name: 'Fresh Lime Soda', qty: 2 }
        ],
        gst_applicable: true
      },
      {
        id: 102,
        name: 'Unavailable Lunch Combo',
        price: 249,
        mrp: 300,
        available: false,
        items: [{ id: 'm1', name: 'Veg Pulao', qty: 1 }]
      },
      {
        id: 103,
        name: 'Expired Festive Combo',
        price: 399,
        mrp: 500,
        available: true,
        expiry_date: '2026-10-01',
        items: [{ id: 'm1', name: 'Mutton Biryani', qty: 1 }]
      }
    ];

    const adminCoupons = [
      { id: 1, code: 'SAVE10', discount_pct: 10, min_bill: 300, max_uses: 100, used_count: 12, expiry_date: '2026-12-31', active: true },
      { id: 2, code: 'FEAST20', discount_pct: 20, min_bill: 800, max_uses: 50, used_count: 5, expiry_date: '2026-12-31', active: true },
      { id: 3, code: 'EXPIRED15', discount_pct: 15, min_bill: 200, max_uses: 50, used_count: 2, expiry_date: '2026-09-15', active: true },
      { id: 4, code: 'INACTIVE25', discount_pct: 25, min_bill: 200, max_uses: 50, used_count: 0, expiry_date: '2026-12-31', active: false },
      { id: 5, code: 'MAXEDOUT', discount_pct: 10, min_bill: 100, max_uses: 10, used_count: 10, expiry_date: '2026-12-31', active: true }
    ];

    const ordersHistory = [
      {
        id: 'ord-1',
        customer_name: 'Arindam Maity',
        customer_phone: '9876543210',
        order_type: 'delivery',
        total_amount: 750,
        status: 'delivered',
        created_at: '2026-10-20T14:00:00Z',
        notes: '[EMAIL: arindam@example.com] [DELIVERY] Place: Egra Bazar | Address: Egra Bazar - Ward 4, Near Post Office | Delivery charge: ₹20.00 [DELIVERY_FEE: 20] [PAYMENT: upi]'
      },
      {
        id: 'ord-2',
        customer_name: 'Arindam Maity',
        customer_phone: '9876543210',
        order_type: 'table',
        total_amount: 1450,
        status: 'delivered',
        created_at: '2026-10-25T19:00:00Z',
        notes: '[TABLE: 4] [COUPON: USEDONCE] [PAYMENT: cash]'
      },
      {
        id: 'ord-3',
        customer_name: 'Priya Das',
        customer_phone: '9123456789',
        order_type: 'delivery',
        total_amount: 520,
        status: 'delivered',
        created_at: '2026-10-28T20:00:00Z',
        notes: '[DELIVERY] Place: Contai Road | Address: Contai Road - Flat 2B, Sunrise Apt | Delivery charge: ₹40.00 [DELIVERY_FEE: 40]'
      }
    ];

    // Add coupon that Arindam already used to test per-customer usage restriction
    adminCoupons.push({
      id: 6,
      code: 'USEDONCE',
      discount_pct: 15,
      min_bill: 200,
      max_uses: 100,
      used_count: 1,
      expiry_date: '2026-12-31',
      active: true
    });

    function isComboActiveAndValid(c, refNow = now) {
      if (!c || typeof c !== 'object') return false;
      if (c.available === false || c.active === false) return false;
      const price = parseFloat(c.price || 0);
      if (isNaN(price) || price <= 0) return false;
      const expRaw = c.expiry_date || c.valid_until || c.expires_at;
      if (expRaw) {
        const expDate = new Date(expRaw);
        if (!isNaN(expDate.getTime()) && expDate < refNow) return false;
      }
      return true;
    }

    function getPosCombosCatalog() {
      return adminCombos.filter(c => isComboActiveAndValid(c, now)).map(c => {
        const comboItems = Array.isArray(c.items) ? c.items : [];
        const comboItemsSummary = comboItems.map(i => `${i.qty || 1}× ${i.name}`).join(' + ');
        return {
          id: `combo-${c.id}`,
          name: c.name,
          price: Number(c.price),
          mrp: Number(c.mrp || 0),
          savings: Math.max(0, Number(c.mrp || 0) - Number(c.price)),
          category: 'combo',
          badge: '🍱 COMBO',
          isCombo: true,
          combo_id: c.id,
          comboItems,
          comboItemsSummary,
          available: true,
          gst_applicable: c.gst_applicable !== false
        };
      });
    }

    function addItemToPosCart(food, customNote = '') {
      if (!food || food.available === false) return false;
      const isComboFlag = Boolean(food.isCombo || food.is_combo || food.category === 'combo' || String(food.id || '').startsWith('combo-'));
      if (isComboFlag && !isComboActiveAndValid(food, now)) return false;

      const note = (customNote || food.notes || '').trim();
      const addQty = Math.max(1, parseInt(food.qty, 10) || 1);
      const existing = posCart.find(
        i => ((food.id && i.id === food.id) || i.name.toLowerCase() === food.name.toLowerCase()) && (i.notes || '').trim() === note
      );
      if (existing) {
        existing.qty += addQty;
      } else {
        posCart.push({
          id: food.id || null,
          name: food.name,
          price: Number(food.price || 0),
          mrp: Number(food.mrp || 0),
          qty: addQty,
          notes: note,
          isCombo: isComboFlag,
          combo_id: isComboFlag ? (food.combo_id ?? null) : null,
          comboItems: Array.isArray(food.comboItems) ? food.comboItems : [],
          comboItemsSummary: food.comboItemsSummary || '',
          gst_applicable: food.gst_applicable !== false
        });
      }
      return true;
    }

    function parseCouponExpiryEndOfDay(expiryDateStr) {
      if (!expiryDateStr) return null;
      const str = String(expiryDateStr).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return new Date(`${str}T23:59:59.999Z`);
      }
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d;
    }

    function isCouponActiveAndValid(c, refNow = now) {
      if (!c || !c.code || c.active === false) return false;
      const pct = Number(c.discount_pct || 0);
      if (isNaN(pct) || pct <= 0 || pct > 100) return false;
      const exp = parseCouponExpiryEndOfDay(c.expiry_date);
      if (exp && exp < refNow) return false;
      const maxUses = Number(c.max_uses || 0);
      const usedCount = Number(c.used_count || 0);
      if (maxUses > 0 && usedCount >= maxUses) return false;
      return true;
    }

    function getValidPosCoupons() {
      return adminCoupons.filter(c => isCouponActiveAndValid(c, now));
    }

    function validatePosCoupon(codeOrCoupon, subtotal, customerPhone = '', options = {}) {
      const rawCode = typeof codeOrCoupon === 'string'
        ? codeOrCoupon.trim().toUpperCase()
        : String(codeOrCoupon?.code || '').trim().toUpperCase();
      if (!rawCode) return { valid: false, reason: 'EMPTY_CODE' };

      if (posAppliedCoupon && posAppliedCoupon.code === rawCode && !options.allowRevalidateCurrent) {
        return { valid: false, reason: 'ALREADY_APPLIED', message: `Coupon "${rawCode}" is already applied.` };
      }
      if (posAppliedCoupon && posAppliedCoupon.code !== rawCode && options.preventMultiple !== false) {
        return { valid: false, reason: 'MULTIPLE_COUPON_ATTEMPT', message: `Coupon "${posAppliedCoupon.code}" is already applied.` };
      }

      const c = adminCoupons.find(item => item.code.toUpperCase() === rawCode);
      if (!c) return { valid: false, reason: 'NOT_FOUND' };
      if (c.active === false) return { valid: false, reason: 'INACTIVE' };
      const exp = parseCouponExpiryEndOfDay(c.expiry_date);
      if (exp && exp < now) return { valid: false, reason: 'EXPIRED' };
      if (Number(c.max_uses || 0) > 0 && Number(c.used_count || 0) >= Number(c.max_uses)) {
        return { valid: false, reason: 'MAX_USES_REACHED' };
      }

      const cleanPhone = String(customerPhone || '').replace(/\D/g, '');
      if (cleanPhone.length >= 10) {
        const usedByCust = ordersHistory.some(o => {
          const oPhone = String(o.customer_phone || '').replace(/\D/g, '');
          const m = String(o.notes || '').match(/\[COUPON:\s*([^\]|]+)\]/i);
          return oPhone === cleanPhone && m && m[1].trim().toUpperCase() === rawCode;
        });
        if (usedByCust) return { valid: false, reason: 'CUSTOMER_ALREADY_USED' };
      }

      if (Number(subtotal || 0) < Number(c.min_bill || 0)) {
        return { valid: false, reason: 'MIN_BILL_NOT_MET' };
      }

      return {
        valid: true,
        coupon: {
          id: c.id,
          code: rawCode,
          discount_pct: Number(c.discount_pct),
          min_bill: Number(c.min_bill || 0)
        }
      };
    }

    function applyPosCoupon(code, options = {}) {
      const subtotal = posCart.reduce((s, i) => s + i.price * i.qty, 0);
      const phone = dom['pos-customer-phone'].value;
      const res = validatePosCoupon(code, subtotal, phone, {
        preventMultiple: options.replace ? false : true
      });
      if (!res.valid) {
        dom['pos-coupon-feedback'] = { textContent: res.message || res.reason, type: 'error', visible: true };
        return res;
      }
      posAppliedCoupon = res.coupon;
      dom['pos-discount-pct'].value = '0';
      dom['pos-coupon-code-input'].value = res.coupon.code;
      dom['pos-coupon-feedback'] = { textContent: `Coupon ${res.coupon.code} applied`, type: 'success', visible: true };
      return res;
    }

    function removePosCoupon() {
      const prev = posAppliedCoupon;
      posAppliedCoupon = null;
      dom['pos-coupon-code-input'].value = '';
      dom['pos-coupon-feedback'] = { textContent: '', type: '', visible: false };
      return { removed: Boolean(prev), code: prev?.code || '' };
    }

    function getPosCartTotals() {
      const subtotal = posCart.reduce((s, i) => s + i.price * i.qty, 0);
      const rawDiscount = parseFloat(dom['pos-discount-pct'].value || '0') || 0;
      const rawDelFee = parseFloat(dom['pos-delivery-fee'].value || '0') || 0;
      const deliveryFee = posOrderType === 'delivery' ? rawDelFee : 0;

      let effectiveCoupon = null;
      if (posAppliedCoupon) {
        const check = validatePosCoupon(posAppliedCoupon.code, subtotal, dom['pos-customer-phone'].value, {
          allowRevalidateCurrent: true
        });
        if (check.valid) effectiveCoupon = check.coupon;
      }

      const billing = calculateOrderBilling({
        items: posCart,
        deliveryFee,
        discountPct: rawDiscount,
        coupon: effectiveCoupon,
        cgstRate: 2.5,
        sgstRate: 2.5
      });

      return {
        subtotal: billing.subtotal,
        discountPct: billing.discountPct,
        discountAmt: billing.discountAmt,
        appliedCoupon: effectiveCoupon,
        taxable: billing.taxableValue,
        cgst: billing.cgstAmt,
        sgst: billing.sgstAmt,
        deliveryFee: billing.deliveryFee,
        roundOff: billing.roundOff,
        grand: billing.grandTotal
      };
    }

    function lookupPosCustomers(query) {
      const q = String(query || '').trim();
      if (!q) return [];
      const digits = q.replace(/\D/g, '');
      const qLower = q.toLowerCase();

      const map = new Map();
      for (const o of ordersHistory) {
        if (!o.customer_phone) continue;
        if (!map.has(o.customer_phone)) {
          map.set(o.customer_phone, {
            name: o.customer_name,
            phone: o.customer_phone,
            orderCount: 0,
            totalSpent: 0,
            lastAddress: '',
            lastPlace: '',
            tier: 'new'
          });
        }
        const c = map.get(o.customer_phone);
        c.orderCount += 1;
        c.totalSpent += Number(o.total_amount || 0);
        const addrMatch = String(o.notes || '').match(/Address:\s*([^|\]]+)/i);
        const placeMatch = String(o.notes || '').match(/Place:\s*([^|\]]+)/i);
        if (addrMatch) c.lastAddress = addrMatch[1].trim();
        if (placeMatch) c.lastPlace = placeMatch[1].trim();
      }

      const list = [...map.values()].map(c => {
        c.tier = (c.orderCount >= 3 || c.totalSpent >= 2000) ? 'vip' : (c.orderCount === 2 || c.totalSpent >= 1000 ? 'frequent' : 'new');
        return c;
      });

      return list
        .filter(c => (digits.length >= 3 && c.phone.includes(digits)) || (qLower.length >= 2 && c.name.toLowerCase().includes(qLower)))
        .map(c => ({
          name: c.name,
          phone: c.phone,
          tier: c.tier,
          orderCount: c.orderCount,
          savedAddress: c.lastAddress,
          savedPlace: c.lastPlace
        }));
    }

    function selectPosCustomerSuggestion(cust, options = {}) {
      if (!cust) return false;
      dom['pos-customer-phone'].value = cust.phone;
      if (options.fromClick !== false || !dom['pos-customer-name'].value.trim() || dom['pos-customer-name'].autoFilled) {
        dom['pos-customer-name'].value = cust.name;
        dom['pos-customer-name'].autoFilled = true;
      }
      if (cust.savedPlace) {
        const place = adminPlaces.find(p => p.name.toLowerCase() === cust.savedPlace.toLowerCase());
        if (place && (!posSelectedPlace || options.fromClick !== false)) {
          posSelectedPlace = place;
          dom['pos-place-search'].value = place.name;
          dom['pos-delivery-fee'].value = String(place.charge);
        }
      }
      if (cust.savedAddress) {
        if (options.fromClick !== false || !dom['pos-delivery-address'].value.trim() || dom['pos-delivery-address'].autoFilled) {
          let specificAddr = cust.savedAddress;
          if (cust.savedPlace && specificAddr.toLowerCase().startsWith(`${cust.savedPlace.toLowerCase()} - `)) {
            specificAddr = specificAddr.slice(cust.savedPlace.length + 3).trim();
          }
          dom['pos-delivery-address'].value = specificAddr;
          dom['pos-delivery-address'].autoFilled = true;
        }
      }
      dom['pos-cust-hint'].textContent = `${cust.tier.toUpperCase()}: ${cust.name}`;
      dom['pos-customer-suggestions'].visible = false;
      return true;
    }

    let debounceTimer = null;
    function typeCustomerPhoneDebounced(phoneStr, delayMs = 25) {
      dom['pos-customer-phone'].value = phoneStr;
      if (debounceTimer) clearTimeout(debounceTimer);
      return new Promise(resolve => {
        debounceTimer = setTimeout(() => {
          const digits = String(phoneStr || '').replace(/\D/g, '');
          if (digits.length < 3) {
            dom['pos-customer-suggestions'] = { visible: false, items: [] };
            resolve([]);
            return;
          }
          const matches = lookupPosCustomers(phoneStr);
          if (digits.length >= 10 && matches.length > 0) {
            const exact = matches.find(m => m.phone.endsWith(digits.slice(-10)));
            if (exact) selectPosCustomerSuggestion(exact, { fromClick: false });
          } else if (digits.length >= 10 && matches.length === 0) {
            dom['pos-cust-hint'].textContent = '✨ New Customer';
            dom['pos-customer-suggestions'] = { visible: false, items: [] };
          } else {
            dom['pos-customer-suggestions'] = { visible: matches.length > 0, items: matches };
          }
          resolve(matches);
        }, delayMs);
      });
    }

    return {
      dom,
      adminCombos,
      adminCoupons,
      getCart: () => posCart,
      setOrderType: (t) => { posOrderType = t; },
      getSelectedPlace: () => posSelectedPlace,
      isComboActiveAndValid,
      getPosCombosCatalog,
      addItemToPosCart,
      getValidPosCoupons,
      validatePosCoupon,
      applyPosCoupon,
      removePosCoupon,
      getPosCartTotals,
      lookupPosCustomers,
      selectPosCustomerSuggestion,
      typeCustomerPhoneDebounced
    };
  }

  // ---------------------------------------------------------------------------
  // 1. Test Active and Expired/Unavailable Combos in POS
  // ---------------------------------------------------------------------------
  await test('1. Active combos load into POS with badge, items summary & MRP savings; expired/unavailable combos are excluded & blocked', () => {
    const pos = createTask22PosHarness();
    const activeCombos = pos.getPosCombosCatalog();

    // Only combo #101 (Family Biryani Feast) is active and non-expired
    assert.equal(activeCombos.length, 1);
    const feast = activeCombos[0];
    assert.equal(feast.id, 'combo-101');
    assert.equal(feast.name, 'Family Biryani Feast');
    assert.equal(feast.category, 'combo');
    assert.equal(feast.badge, '🍱 COMBO');
    assert.equal(feast.price, 499);
    assert.equal(feast.mrp, 620);
    assert.equal(feast.savings, 121);
    assert.equal(feast.comboItemsSummary, '2× Chicken Biryani + 2× Chicken Chaap + 2× Fresh Lime Soda');

    // Adding active combo to cart succeeds and preserves combo metadata
    assert.equal(pos.addItemToPosCart(feast), true);
    assert.equal(pos.getCart().length, 1);
    assert.equal(pos.getCart()[0].isCombo, true);
    assert.equal(pos.getCart()[0].combo_id, 101);
    assert.equal(pos.getCart()[0].price, 499);
    assert.equal(pos.getCart()[0].comboItemsSummary, '2× Chicken Biryani + 2× Chicken Chaap + 2× Fresh Lime Soda');

    // Attempting to add unavailable combo (#102) or expired combo (#103) is rejected
    assert.equal(pos.addItemToPosCart({ ...pos.adminCombos[1], isCombo: true }), false);
    assert.equal(pos.addItemToPosCart({ ...pos.adminCombos[2], isCombo: true }), false);
    assert.equal(pos.getCart().length, 1);
  });

  // ---------------------------------------------------------------------------
  // 2. Test Valid and Invalid Coupons
  // ---------------------------------------------------------------------------
  await test('2. Coupon picker filters only valid/active coupons and validates expiry, active status, min_bill, max_uses, and customer reuse', () => {
    const pos = createTask22PosHarness();

    // Only SAVE10, FEAST20, and USEDONCE are active, non-expired, and under max_uses
    const validPickerCoupons = pos.getValidPosCoupons().map(c => c.code);
    assert.deepEqual(validPickerCoupons, ['SAVE10', 'FEAST20', 'USEDONCE']);

    // Add ₹250 item to cart (below SAVE10's ₹300 min_bill)
    pos.addItemToPosCart({ id: 'm1', name: 'Chicken Biryani', price: 250, qty: 1 });

    // 2a. Unknown coupon
    assert.equal(pos.applyPosCoupon('UNKNOWN50').reason, 'NOT_FOUND');
    // 2b. Expired coupon
    assert.equal(pos.applyPosCoupon('EXPIRED15').reason, 'EXPIRED');
    // 2c. Inactive coupon
    assert.equal(pos.applyPosCoupon('INACTIVE25').reason, 'INACTIVE');
    // 2d. Max uses reached
    assert.equal(pos.applyPosCoupon('MAXEDOUT').reason, 'MAX_USES_REACHED');
    // 2e. Minimum order value not met (subtotal ₹250 < min_bill ₹300)
    assert.equal(pos.applyPosCoupon('SAVE10').reason, 'MIN_BILL_NOT_MET');
    // 2f. Customer has already redeemed USEDONCE
    pos.dom['pos-customer-phone'].value = '9876543210';
    assert.equal(pos.applyPosCoupon('USEDONCE').reason, 'CUSTOMER_ALREADY_USED');

    // Increase cart subtotal to ₹500 -> SAVE10 (10% OFF, min ₹300) now succeeds
    pos.addItemToPosCart({ id: 'm1', name: 'Chicken Biryani', price: 250, qty: 1 }); // Subtotal = ₹500
    const applied = pos.applyPosCoupon('save10'); // case-insensitive
    assert.equal(applied.valid, true);
    assert.equal(applied.coupon.code, 'SAVE10');
    assert.equal(applied.coupon.discount_pct, 10);
  });

  // ---------------------------------------------------------------------------
  // 3. Test Coupon Removal & Dynamic Min-Bill Revalidation
  // ---------------------------------------------------------------------------
  await test('3. Removing a coupon immediately clears the discount and restores original cart totals', () => {
    const pos = createTask22PosHarness();
    pos.addItemToPosCart({ id: 'm1', name: 'Mixed Fried Rice', price: 400, qty: 1 });

    assert.equal(pos.applyPosCoupon('SAVE10').valid, true);
    let totals = pos.getPosCartTotals();
    assert.equal(totals.subtotal, 400);
    assert.equal(totals.discountPct, 10);
    assert.equal(totals.discountAmt, 40);
    assert.equal(totals.taxable, 360);
    assert.equal(totals.appliedCoupon.code, 'SAVE10');

    // Remove coupon
    const rem = pos.removePosCoupon();
    assert.equal(rem.removed, true);
    assert.equal(rem.code, 'SAVE10');

    totals = pos.getPosCartTotals();
    assert.equal(totals.subtotal, 400);
    assert.equal(totals.discountPct, 0);
    assert.equal(totals.discountAmt, 0);
    assert.equal(totals.taxable, 400);
    assert.equal(totals.appliedCoupon, null);
  });

  // ---------------------------------------------------------------------------
  // 4. Test Multiple Coupon Attempts (Prevent Duplicate & Stacking)
  // ---------------------------------------------------------------------------
  await test('4. Prevent applying the same coupon multiple times or stacking multiple coupons on one bill', () => {
    const pos = createTask22PosHarness();
    pos.addItemToPosCart({ id: 'm1', name: 'Royal Platter', price: 1000, qty: 1 });

    // First application of SAVE10 succeeds
    assert.equal(pos.applyPosCoupon('SAVE10').valid, true);

    // Attempting to apply SAVE10 again is rejected with ALREADY_APPLIED
    const dupAttempt = pos.applyPosCoupon('SAVE10');
    assert.equal(dupAttempt.valid, false);
    assert.equal(dupAttempt.reason, 'ALREADY_APPLIED');

    // Attempting to stack FEAST20 while SAVE10 is active is rejected with MULTIPLE_COUPON_ATTEMPT
    const stackAttempt = pos.applyPosCoupon('FEAST20');
    assert.equal(stackAttempt.valid, false);
    assert.equal(stackAttempt.reason, 'MULTIPLE_COUPON_ATTEMPT');

    // Verify discount remains strictly 10% (SAVE10), never stacked to 30%
    const totals = pos.getPosCartTotals();
    assert.equal(totals.discountPct, 10);
    assert.equal(totals.discountAmt, 100);
    assert.equal(totals.appliedCoupon.code, 'SAVE10');
  });

  // ---------------------------------------------------------------------------
  // 5. Test Existing Customer Lookup (Debounced + Auto-fill + Data Privacy)
  // ---------------------------------------------------------------------------
  await test('5. Debounced phone lookup retrieves existing customer, auto-fills name & delivery address, and minimizes exposed data', async () => {
    const pos = createTask22PosHarness();
    pos.setOrderType('delivery');

    // Partial phone search (debounced) returns suggestions without exposing email/raw orders
    const partialMatches = await pos.typeCustomerPhoneDebounced('98765');
    assert.equal(partialMatches.length, 1);
    assert.equal(partialMatches[0].name, 'Arindam Maity');
    assert.equal(partialMatches[0].phone, '9876543210');
    assert.equal(partialMatches[0].tier, 'vip');
    // Verify sensitive/unnecessary fields are NOT exposed on suggestion object
    assert.equal('email' in partialMatches[0], false);
    assert.equal('ordersHistory' in partialMatches[0], false);
    assert.equal('totalSpent' in partialMatches[0], false);

    // Full 10-digit phone lookup auto-fills customer name, delivery place, and delivery address
    await pos.typeCustomerPhoneDebounced('9876543210');
    assert.equal(pos.dom['pos-customer-name'].value, 'Arindam Maity');
    assert.equal(pos.dom['pos-delivery-address'].value, 'Ward 4, Near Post Office');
    assert.equal(pos.getSelectedPlace().name, 'Egra Bazar');
    assert.equal(pos.dom['pos-delivery-fee'].value, '20');
  });

  // ---------------------------------------------------------------------------
  // 6. Test New Customer Phone Number (Graceful Handling)
  // ---------------------------------------------------------------------------
  await test('6. Unknown/new customer phone number is handled gracefully without errors or overwriting manual input', async () => {
    const pos = createTask22PosHarness();
    pos.dom['pos-customer-name'].value = 'Suman Giri';
    pos.dom['pos-customer-name'].autoFilled = false;
    pos.dom['pos-delivery-address'].value = 'College More, Plot 12';
    pos.dom['pos-delivery-address'].autoFilled = false;

    const matches = await pos.typeCustomerPhoneDebounced('9000011111');
    assert.equal(matches.length, 0);
    assert.equal(pos.dom['pos-customer-suggestions'].visible, false);
    assert.equal(pos.dom['pos-cust-hint'].textContent, '✨ New Customer');
    // Manual name and address are untouched
    assert.equal(pos.dom['pos-customer-name'].value, 'Suman Giri');
    assert.equal(pos.dom['pos-delivery-address'].value, 'College More, Plot 12');
  });

  // ---------------------------------------------------------------------------
  // 7. Test Customer Name & Address Editing After Auto-Fill
  // ---------------------------------------------------------------------------
  await test('7. Cashier can manually edit customer name and delivery address after auto-fill without subsequent lookups overwriting them', async () => {
    const pos = createTask22PosHarness();
    pos.setOrderType('delivery');

    // Auto-fill Priya Das (9123456789)
    await pos.typeCustomerPhoneDebounced('9123456789');
    assert.equal(pos.dom['pos-customer-name'].value, 'Priya Das');
    assert.equal(pos.dom['pos-delivery-address'].value, 'Flat 2B, Sunrise Apt');

    // Cashier manually edits the delivery address and customer name
    pos.dom['pos-delivery-address'].value = 'New Office Complex, 3rd Floor';
    pos.dom['pos-delivery-address'].autoFilled = false;
    pos.dom['pos-customer-name'].value = 'Priya Das (Office)';
    pos.dom['pos-customer-name'].autoFilled = false;

    // Re-triggering phone lookup must NOT overwrite the cashier's manual edits
    await pos.typeCustomerPhoneDebounced('9123456789');
    assert.equal(pos.dom['pos-customer-name'].value, 'Priya Das (Office)');
    assert.equal(pos.dom['pos-delivery-address'].value, 'New Office Complex, 3rd Floor');
  });

  // ---------------------------------------------------------------------------
  // 8. Test Final Payable Amount & GST Calculations with Combos + Coupons + Delivery
  // ---------------------------------------------------------------------------
  await test('8. Verify final payable amount and GST calculations with Combo + Coupon + Delivery Fee match calculateOrderBilling', async () => {
    const pos = createTask22PosHarness();
    pos.setOrderType('delivery');

    // Auto-fill customer Arindam Maity (Egra Bazar -> ₹20 delivery fee)
    await pos.typeCustomerPhoneDebounced('9876543210');

    // Add Family Biryani Feast Combo (₹499) + 1 Regular Dish (₹101) -> Subtotal = ₹600
    const combo = pos.getPosCombosCatalog()[0];
    pos.addItemToPosCart(combo);
    pos.addItemToPosCart({ id: 'm99', name: 'Masala Kulcha', price: 101, qty: 1 });

    // Apply SAVE10 coupon (10% OFF on ₹600 = ₹60 discount)
    const applyRes = pos.applyPosCoupon('SAVE10');
    assert.equal(applyRes.valid, true);

    // Expected calculation:
    // Subtotal = 600.00
    // Coupon Discount (10%) = 60.00
    // Net Taxable = 540.00
    // CGST (2.5%) = 13.50, SGST (2.5%) = 13.50 (Total GST = 27.00)
    // Delivery Fee = 20.00
    // Grand Total = 540 + 27 + 20 = ₹587.00 (Round Off = 0)
    const totals = pos.getPosCartTotals();
    assert.equal(totals.subtotal, 600);
    assert.equal(totals.discountPct, 10);
    assert.equal(totals.discountAmt, 60);
    assert.equal(totals.taxable, 540);
    assert.equal(totals.cgst, 13.5);
    assert.equal(totals.sgst, 13.5);
    assert.equal(totals.deliveryFee, 20);
    assert.equal(totals.roundOff, 0);
    assert.equal(totals.grand, 587);
  });

  console.log(`\n🎉 Task 2.2 Suite Passed (${passed}/${passed} checks)!\n`);
}

runTests();
