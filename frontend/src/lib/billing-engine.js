/**
 * LIMRA RESTAURANT — CANONICAL BILLING & GST TAX ENGINE (FRONTEND)
 * 
 * Authoritative Indian Restaurant GST, Discount Allocation, Delivery Fee,
 * and State Machine Transition Validator.
 * 
 * Reference Regulations:
 * - Notification No. 11/2017-Central Tax (Rate) as amended by Notification No. 20/2019-Central Tax (Rate)
 *   (Standalone restaurant service taxable @ 5% GST without ITC)
 * - Intrastate Supply (West Bengal): CGST 2.5% + SGST 2.5%
 * - Interstate Supply: IGST 5.0%
 * - Section 15(3) of CGST Act (Proportional discount allocation across mixed-tax baskets)
 * - Section 170 of CGST Act (Commercial rounding of tax amounts to nearest rupee/paisa)
 */

/** Helper: round to 2 decimal places (paise precision) */
export function round2(num) {
  if (num === null || num === undefined || isNaN(num)) return 0;
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

/** Helper: safe numeric parsing */
export function safeNum(val, fallback = 0) {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

/**
 * Standard Status Enumerations
 */
export const VALID_FULFILLMENT_STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'delivered',
  'cancelled',
  'hold'
];

export const VALID_PAYMENT_STATUSES = [
  'unpaid',
  'paid',
  'refunded',
  'failed'
];

export const VALID_TICKET_STATUSES = [
  'OPEN',
  'HOLD',
  'BILLED',
  'PAID',
  'CLOSED',
  'CANCELLED'
];

/**
 * Parse billing metadata embedded within order notes
 * E.g. "[CGST: 2.5%] [SGST: 2.5%] [DISCOUNT_PCT: 10%] [DISCOUNT_AMT: 50] [DELIVERY_FEE: 40] [COUPON: FLAT50]"
 */
export function parseNotesBillingMetadata(notes) {
  const raw = String(notes || '');
  const result = {
    discountPct: 0,
    discountAmt: 0,
    couponCode: null,
    deliveryFee: 0,
    cgstRate: null,
    sgstRate: null,
    isInterstate: false,
    paymentMethod: null,
    paymentStatus: null,
    tableRound: null
  };

  const discPctMatch = raw.match(/\[(?:DISCOUNT_PCT|DISCOUNT):\s*([^\]|%]+)%?\]/i);
  if (discPctMatch) {
    const p = parseFloat(discPctMatch[1]);
    if (!isNaN(p) && p >= 0) result.discountPct = p;
  }

  const discAmtMatch = raw.match(/\[DISCOUNT_AMT:\s*([^\]|]+)\]/i);
  if (discAmtMatch) {
    const a = parseFloat(discAmtMatch[1]);
    if (!isNaN(a) && a >= 0) result.discountAmt = a;
  }

  const couponMatch = raw.match(/\[COUPON:\s*([^\]|]+)\]/i);
  if (couponMatch) {
    result.couponCode = couponMatch[1].trim();
  }

  const feeMatch = raw.match(/\[(?:DELIVERY_FEE|DELIVERY_CHARGE):\s*([^\]|]+)\]/i);
  if (feeMatch) {
    const f = parseFloat(feeMatch[1]);
    if (!isNaN(f) && f >= 0) result.deliveryFee = f;
  }

  const cgstMatch = raw.match(/\[CGST:\s*([^\]|%]+)%?\]/i);
  if (cgstMatch) {
    const c = parseFloat(cgstMatch[1]);
    if (!isNaN(c) && c >= 0) result.cgstRate = c;
  }

  const sgstMatch = raw.match(/\[SGST:\s*([^\]|%]+)%?\]/i);
  if (sgstMatch) {
    const s = parseFloat(sgstMatch[1]);
    if (!isNaN(s) && s >= 0) result.sgstRate = s;
  }

  const igstMatch = raw.match(/\[IGST:\s*([^\]|%]+)%?\]/i);
  if (igstMatch) {
    result.isInterstate = true;
  }

  const payMethodMatch = raw.match(/\[PAYMENT:\s*([^\]|]+)\]/i);
  if (payMethodMatch) {
    result.paymentMethod = payMethodMatch[1].trim();
  }

  const payStatusMatch = raw.match(/\[PAYMENT_STATUS:\s*([^\]|]+)\]/i);
  if (payStatusMatch) {
    result.paymentStatus = payStatusMatch[1].trim().toLowerCase();
  }

  const roundMatch = raw.match(/\[ROUND:\s*(\d+)\]/i);
  if (roundMatch) {
    result.tableRound = parseInt(roundMatch[1], 10);
  }

  return result;
}

/**
 * Format billing metadata tags into notes string
 */
export function formatNotesBillingMetadata({
  discountPct = 0,
  discountAmt = 0,
  couponCode = null,
  deliveryFee = 0,
  cgstRate = 2.5,
  sgstRate = 2.5,
  isInterstate = false,
  paymentMethod = null,
  paymentStatus = null,
  tableRound = null
} = {}) {
  const tags = [];

  if (tableRound) tags.push(`[ROUND: ${tableRound}]`);
  if (couponCode) tags.push(`[COUPON: ${couponCode}]`);
  if (discountPct > 0) tags.push(`[DISCOUNT_PCT: ${discountPct}%]`);
  if (discountAmt > 0) tags.push(`[DISCOUNT_AMT: ${round2(discountAmt)}]`);

  if (deliveryFee > 0) tags.push(`[DELIVERY_FEE: ${round2(deliveryFee)}]`);

  if (isInterstate) {
    tags.push(`[IGST: ${round2(cgstRate + sgstRate)}%]`);
  } else {
    tags.push(`[CGST: ${round2(cgstRate)}%]`);
    tags.push(`[SGST: ${round2(sgstRate)}%]`);
  }

  if (paymentMethod) tags.push(`[PAYMENT: ${paymentMethod}]`);
  if (paymentStatus) tags.push(`[PAYMENT_STATUS: ${paymentStatus.toUpperCase()}]`);

  return tags.join(' ');
}

/**
 * Authoritative Order Billing & Tax Calculation Function
 *
 * @param {Object} params
 * @param {Array} params.items - Array of dish objects { name, price, qty, gst_applicable, notes }
 * @param {number} [params.deliveryFee=0] - Explicit delivery fee in ₹
 * @param {Object} [params.coupon=null] - Coupon object { code, discount_pct, min_bill, max_discount }
 * @param {number} [params.discountPct=0] - Percentage discount if no coupon object
 * @param {number} [params.discountAmt=0] - Flat discount amount in ₹ if applicable
 * @param {number} [params.cgstRate=2.5] - Central GST rate % (default 2.5%)
 * @param {number} [params.sgstRate=2.5] - State GST rate % (default 2.5%)
 * @param {boolean} [params.isInterstate=false] - True if interstate supply (uses IGST @ 5%)
 * @returns {Object} Comprehensive billing breakdown
 */
export function calculateOrderBilling({
  items = [],
  deliveryFee = 0,
  coupon = null,
  discountPct = 0,
  discountAmt = 0,
  cgstRate = 2.5,
  sgstRate = 2.5,
  isInterstate = false
} = {}) {
  // 1. Process items and normalize quantities and rates
  let subtotal = 0;
  let taxableSubtotal = 0;
  let nonTaxableSubtotal = 0;

  const normalizedItems = (items || []).map(item => {
    const qty = Math.max(1, parseInt(item.quantity || item.qty, 10) || 1);
    const price = Math.max(0, safeNum(item.price ?? item.unit_price, 0));
    const lineTotal = round2(qty * price);
    
    // An item is taxable unless explicitly flagged non-taxable or marked [NO_GST]
    const isTaxable = item.gst_applicable !== false &&
                      !(typeof item.notes === 'string' && item.notes.includes('[NO_GST]'));

    subtotal = round2(subtotal + lineTotal);
    if (isTaxable) {
      taxableSubtotal = round2(taxableSubtotal + lineTotal);
    } else {
      nonTaxableSubtotal = round2(nonTaxableSubtotal + lineTotal);
    }

    return {
      name: String(item.name || item.item_name || 'Item'),
      quantity: qty,
      unit_price: price,
      line_total: lineTotal,
      gst_applicable: isTaxable
    };
  });

  // 2. Compute Discounts
  let finalDiscountAmt = 0;
  let effectiveDiscountPct = 0;

  if (coupon && typeof coupon === 'object') {
    const minBill = safeNum(coupon.min_bill, 0);
    const pct = safeNum(coupon.discount_pct, 0);
    if (subtotal >= minBill && pct > 0) {
      effectiveDiscountPct = pct;
      finalDiscountAmt = round2(subtotal * (pct / 100));
      if (coupon.max_discount && finalDiscountAmt > coupon.max_discount) {
        finalDiscountAmt = round2(coupon.max_discount);
      }
    }
  } else if (discountAmt > 0) {
    finalDiscountAmt = round2(discountAmt);
    effectiveDiscountPct = subtotal > 0 ? round2((discountAmt / subtotal) * 100) : 0;
  } else if (discountPct > 0) {
    effectiveDiscountPct = discountPct;
    finalDiscountAmt = round2(subtotal * (discountPct / 100));
  }

  // Clamp discount so it never exceeds subtotal
  finalDiscountAmt = Math.min(subtotal, Math.max(0, finalDiscountAmt));

  // 3. Proportional Discount Allocation (CGST Act Section 15(3))
  // A general invoice discount must be allocated across taxable and non-taxable portions
  let taxableDiscountAmt = 0;
  let nonTaxableDiscountAmt = 0;

  if (subtotal > 0 && finalDiscountAmt > 0) {
    taxableDiscountAmt = round2(finalDiscountAmt * (taxableSubtotal / subtotal));
    nonTaxableDiscountAmt = round2(finalDiscountAmt - taxableDiscountAmt);
  }

  const netTaxableValue = round2(Math.max(0, taxableSubtotal - taxableDiscountAmt));
  const netNonTaxableValue = round2(Math.max(0, nonTaxableSubtotal - nonTaxableDiscountAmt));

  // 4. Taxes Calculation
  const cleanCgstRate = Math.max(0, safeNum(cgstRate, 2.5));
  const cleanSgstRate = Math.max(0, safeNum(sgstRate, 2.5));
  const totalGstRate = round2(cleanCgstRate + cleanSgstRate);

  let cgstAmt = 0;
  let sgstAmt = 0;
  let igstAmt = 0;
  let totalGst = 0;

  if (netTaxableValue > 0) {
    if (isInterstate) {
      igstAmt = round2(netTaxableValue * (totalGstRate / 100));
      totalGst = igstAmt;
    } else {
      cgstAmt = round2(netTaxableValue * (cleanCgstRate / 100));
      sgstAmt = round2(netTaxableValue * (cleanSgstRate / 100));
      totalGst = round2(cgstAmt + sgstAmt);
    }
  }

  // 5. Delivery Fee
  const cleanDeliveryFee = round2(Math.max(0, safeNum(deliveryFee, 0)));

  // 6. Grand Total
  // Grand Total = (Subtotal - Discount) + Total GST + Delivery Fee
  const unroundedGrandTotal = round2(
    (subtotal - finalDiscountAmt) + totalGst + cleanDeliveryFee
  );

  // Commercial integer rounding for cash/billing (e.g. 538.50 -> 539.00)
  const roundedGrandTotal = Math.round(unroundedGrandTotal);
  const roundOff = round2(roundedGrandTotal - unroundedGrandTotal);

  return {
    items: normalizedItems,
    itemCount: normalizedItems.reduce((acc, i) => acc + i.quantity, 0),
    subtotal,
    taxableSubtotal,
    nonTaxableSubtotal,
    discountPct: effectiveDiscountPct,
    discountAmt: finalDiscountAmt,
    taxableDiscountAmt,
    nonTaxableDiscountAmt,
    taxableValue: netTaxableValue,
    nonTaxableValue: netNonTaxableValue,
    cgstRate: isInterstate ? 0 : cleanCgstRate,
    cgstAmt,
    sgstRate: isInterstate ? 0 : cleanSgstRate,
    sgstAmt,
    igstRate: isInterstate ? totalGstRate : 0,
    igstAmt,
    totalGstRate,
    totalGst,
    deliveryFee: cleanDeliveryFee,
    grandTotal: unroundedGrandTotal,
    roundedGrandTotal,
    roundOff,
    isInterstate
  };
}

/**
 * State Transition Validation Functions
 */

/**
 * Validate payment status transitions
 * Permitted transitions:
 * - unpaid -> paid, failed
 * - failed -> unpaid, paid
 * - paid -> refunded (CANNOT revert to unpaid)
 * - refunded -> terminal (cannot be altered)
 */
export function isValidPaymentTransition(currentStatus, targetStatus) {
  const curr = String(currentStatus || 'unpaid').toLowerCase().trim();
  const tgt = String(targetStatus || 'unpaid').toLowerCase().trim();

  if (curr === tgt) return true; // Idempotent no-op

  if (curr === 'refunded') {
    return false; // Terminal state
  }

  if (curr === 'paid') {
    return tgt === 'refunded'; // Only permitted transition from paid is refunded
  }

  if (curr === 'unpaid') {
    return tgt === 'paid' || tgt === 'failed';
  }

  if (curr === 'failed') {
    return tgt === 'unpaid' || tgt === 'paid';
  }

  return false;
}

/**
 * Validate order fulfillment status transitions
 */
export function isValidFulfillmentTransition(currentStatus, targetStatus, role = 'staff') {
  const curr = String(currentStatus || 'pending').toLowerCase().trim();
  const tgt = String(targetStatus || 'pending').toLowerCase().trim();

  if (curr === tgt) return true; // Idempotent no-op

  if (curr === 'cancelled') {
    return false; // Cancelled is terminal
  }

  if (curr === 'delivered') {
    // Only management can void/cancel a delivered order
    if (tgt === 'cancelled') {
      return ['owner', 'manager', 'admin'].includes(role);
    }
    return false; // Delivered is otherwise terminal
  }

  // Kitchen role can only move through preparation steps
  if (role === 'kitchen') {
    if (!['preparing', 'ready', 'delivered'].includes(tgt)) {
      return false;
    }
  }

  switch (curr) {
    case 'pending':
      return ['confirmed', 'preparing', 'hold', 'delivered', 'cancelled'].includes(tgt);
    case 'confirmed':
      return ['preparing', 'hold', 'ready', 'delivered', 'cancelled'].includes(tgt);
    case 'preparing':
      return ['ready', 'delivered', 'cancelled'].includes(tgt);
    case 'ready':
      return ['delivered', 'cancelled'].includes(tgt);
    case 'hold':
      return ['confirmed', 'preparing', 'delivered', 'cancelled'].includes(tgt);
    default:
      return false;
  }
}

/**
 * Validate ticket status transitions
 * Permitted transitions:
 * - OPEN -> HOLD, BILLED, CLOSED, CANCELLED
 * - HOLD -> OPEN, CANCELLED
 * - BILLED -> PAID, CLOSED, OPEN (un-bill to add items)
 * - PAID -> CLOSED
 * - CLOSED -> terminal
 * - CANCELLED -> terminal
 */
export function isValidTicketTransition(currentStatus, targetStatus) {
  const curr = String(currentStatus || 'OPEN').toUpperCase().trim();
  const tgt = String(targetStatus || 'OPEN').toUpperCase().trim();

  if (curr === tgt) return true; // Idempotent no-op

  if (curr === 'CLOSED' || curr === 'CANCELLED') {
    return false; // Terminal states
  }

  switch (curr) {
    case 'OPEN':
      return ['HOLD', 'BILLED', 'CLOSED', 'CANCELLED'].includes(tgt);
    case 'HOLD':
      return ['OPEN', 'CANCELLED'].includes(tgt);
    case 'BILLED':
      return ['PAID', 'CLOSED', 'OPEN'].includes(tgt);
    case 'PAID':
      return ['CLOSED'].includes(tgt);
    default:
      return false;
  }
}
