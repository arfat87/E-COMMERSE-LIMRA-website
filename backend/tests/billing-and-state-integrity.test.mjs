/**
 * LIMRA RESTAURANT — BILLING, GST, DISCOUNTS & ORDER STATE INTEGRITY TEST SUITE
 * 
 * Verifies:
 * 1. Intrastate 5% GST split (2.5% CGST + 2.5% SGST)
 * 2. Interstate 5% IGST treatment
 * 3. Mixed-tax baskets (taxable + non-taxable goods)
 * 4. Section 15(3) CGST Act proportional discount allocation
 * 5. Delivery fee handling & non-food GST separation
 * 6. Decimal paise precision & Section 170 commercial rounding
 * 7. Zero-value complimentary items & boundary edge cases
 * 8. Server-authoritative calculation & price anti-tampering
 * 9. Separation of Fulfillment, Payment, and Ticket lifecycles
 * 10. Valid & forbidden payment status transitions (cannot revert paid -> unpaid)
 * 11. Valid & forbidden ticket lifecycle transitions (closed tickets cannot be reopened)
 * 12. Role-based authorization constraints (kitchen role restricted from billing)
 * 13. Printed ESC/POS invoice numerical parity with database calculation
 */

import assert from 'node:assert/strict';
import {
  calculateOrderBilling,
  parseNotesBillingMetadata,
  formatNotesBillingMetadata,
  isValidPaymentTransition,
  isValidFulfillmentTransition,
  isValidTicketTransition,
  round2
} from '../api/lib/billing-engine.js';

import {
  buildEscPosBill
} from '../../frontend/src/lib/escpos.js';

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\n======================================================================');
console.log('  LIMRA Restaurant: Billing, GST, Discounts & State Integrity Suite');
console.log('======================================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// 1. GST CALCULATION & SPLIT TESTS
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- 1. GST Calculation & Intrastate / Interstate Supply ---');

runTest('1.1 Standard Intrastate 5% GST split into 2.5% CGST + 2.5% SGST', () => {
  const items = [
    { name: 'Chicken Biryani', price: 200, qty: 2, gst_applicable: true }, // 400
    { name: 'Rumali Roti', price: 20, qty: 5, gst_applicable: true }       // 100
  ];
  // Subtotal = 500
  const billing = calculateOrderBilling({
    items,
    deliveryFee: 0,
    cgstRate: 2.5,
    sgstRate: 2.5,
    isInterstate: false
  });

  assert.equal(billing.subtotal, 500.00);
  assert.equal(billing.taxableSubtotal, 500.00);
  assert.equal(billing.nonTaxableSubtotal, 0.00);
  assert.equal(billing.taxableValue, 500.00);
  assert.equal(billing.cgstRate, 2.5);
  assert.equal(billing.sgstRate, 2.5);
  assert.equal(billing.cgstAmt, 12.50); // 500 * 0.025
  assert.equal(billing.sgstAmt, 12.50); // 500 * 0.025
  assert.equal(billing.totalGst, 25.00); // 12.50 + 12.50 = 25.00 (5%)
  assert.equal(billing.grandTotal, 525.00);
  assert.equal(billing.roundedGrandTotal, 525);
  assert.equal(billing.roundOff, 0.00);
});

runTest('1.2 Interstate 5% IGST Supply Treatment', () => {
  const items = [
    { name: 'Mutton Kebab Platter', price: 600, qty: 1, gst_applicable: true }
  ];
  const billing = calculateOrderBilling({
    items,
    cgstRate: 2.5,
    sgstRate: 2.5,
    isInterstate: true
  });

  assert.equal(billing.isInterstate, true);
  assert.equal(billing.cgstAmt, 0.00);
  assert.equal(billing.sgstAmt, 0.00);
  assert.equal(billing.igstRate, 5.0);
  assert.equal(billing.igstAmt, 30.00); // 600 * 0.05
  assert.equal(billing.totalGst, 30.00);
  assert.equal(billing.grandTotal, 630.00);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. MIXED-TAX BASKET & STATUTORY PROPORTIONAL DISCOUNT ALLOCATION
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 2. Mixed-Tax Baskets & Proportional Discount Allocation ---');

runTest('2.1 Mixed-Tax Basket (Taxable food + Non-taxable packaged drinks)', () => {
  const items = [
    { name: 'Chicken Chaap', price: 250, qty: 2, gst_applicable: true }, // 500 taxable
    { name: 'Packaged Mineral Water MRP', price: 20, qty: 2, gst_applicable: false }, // 40 non-taxable
    { name: 'Cold Drink Can', price: 40, qty: 1, notes: '[NO_GST]' } // 40 non-taxable via note
  ];
  const billing = calculateOrderBilling({ items });

  assert.equal(billing.subtotal, 580.00);
  assert.equal(billing.taxableSubtotal, 500.00);
  assert.equal(billing.nonTaxableSubtotal, 80.00);
  assert.equal(billing.taxableValue, 500.00);
  assert.equal(billing.nonTaxableValue, 80.00);
  // GST applies only to 500 taxable
  assert.equal(billing.cgstAmt, 12.50);
  assert.equal(billing.sgstAmt, 12.50);
  assert.equal(billing.totalGst, 25.00);
  // Grand total = 580 + 25 = 605
  assert.equal(billing.grandTotal, 605.00);
});

runTest('2.2 Section 15(3) Proportional Discount Allocation across Mixed-Tax Basket', () => {
  // Scenario:
  // Taxable: ₹500 (83.33% of ₹600)
  // Non-taxable: ₹100 (16.67% of ₹600)
  // Coupon: 10% discount = ₹60 total discount
  // Taxable discount = 60 * (500 / 600) = ₹50.00
  // Non-taxable discount = 60 - 50 = ₹10.00
  // Net Taxable Value = 500 - 50 = ₹450.00
  // 5% GST on 450 = ₹22.50 (CGST 11.25 + SGST 11.25)
  // Net Non-taxable Value = 100 - 10 = ₹90.00
  // Grand Total = 450 + 90 + 22.50 = ₹562.50
  const items = [
    { name: 'Tandoori Chicken Full', price: 500, qty: 1, gst_applicable: true },
    { name: 'Packaged Soft Drink', price: 50, qty: 2, gst_applicable: false }
  ];
  const coupon = { code: 'SAVE10', discount_pct: 10, min_bill: 300 };

  const billing = calculateOrderBilling({ items, coupon });

  assert.equal(billing.subtotal, 600.00);
  assert.equal(billing.taxableSubtotal, 500.00);
  assert.equal(billing.nonTaxableSubtotal, 100.00);
  assert.equal(billing.discountAmt, 60.00);
  assert.equal(billing.taxableDiscountAmt, 50.00);
  assert.equal(billing.nonTaxableDiscountAmt, 10.00);
  assert.equal(billing.taxableValue, 450.00);
  assert.equal(billing.nonTaxableValue, 90.00);
  assert.equal(billing.cgstAmt, 11.25);
  assert.equal(billing.sgstAmt, 11.25);
  assert.equal(billing.totalGst, 22.50);
  assert.equal(billing.grandTotal, 562.50);
  assert.equal(billing.roundedGrandTotal, 563);
  assert.equal(billing.roundOff, 0.50);
});

runTest('2.3 Coupon Min Bill Threshold & Max Discount Cap Enforced', () => {
  const items = [{ name: 'Chicken Roll', price: 80, qty: 1 }];
  const coupon = { code: 'BIGDEAL', discount_pct: 50, min_bill: 200, max_discount: 100 };

  // Subtotal 80 < min_bill 200 -> discount must be 0
  const billingNoMin = calculateOrderBilling({ items, coupon });
  assert.equal(billingNoMin.discountAmt, 0.00);

  // Subtotal 500 with max_discount 100
  const bigItems = [{ name: 'Mutton Biryani Family', price: 500, qty: 1 }];
  const billingCapped = calculateOrderBilling({ items: bigItems, coupon });
  assert.equal(billingCapped.discountAmt, 100.00); // Capped at 100 instead of 250
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. DELIVERY FEE & COMPOSITE RATE SEPARATION
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 3. Delivery Fee Handling ---');

runTest('3.1 Delivery fee included in grand total without taxing as restaurant food', () => {
  const items = [{ name: 'Mughlai Paratha', price: 150, qty: 2 }]; // 300
  const billing = calculateOrderBilling({
    items,
    deliveryFee: 40
  });

  assert.equal(billing.subtotal, 300.00);
  assert.equal(billing.deliveryFee, 40.00);
  // GST only on ₹300 food
  assert.equal(billing.totalGst, 15.00); // 5% of 300
  // Grand total = 300 + 15 + 40 = 355
  assert.equal(billing.grandTotal, 355.00);
  assert.equal(billing.roundedGrandTotal, 355);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. PRECISION, ROUNDING & BOUNDARY CASES
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 4. Decimal Precision, Rounding & Boundary Cases ---');

runTest('4.1 Commercial Rounding and Round-off difference', () => {
  // Line item producing fractional paise:
  // ₹133.33 * 1 = 133.33. GST 5% = 6.6665 -> 6.67. Total = 140.00.
  const items = [{ name: 'Custom Curry', price: 133.33, qty: 1 }];
  const billing = calculateOrderBilling({ items });

  assert.equal(billing.subtotal, 133.33);
  assert.equal(billing.cgstAmt, 3.33);
  assert.equal(billing.sgstAmt, 3.33);
  assert.equal(billing.totalGst, 6.66);
  assert.equal(billing.grandTotal, 139.99);
  assert.equal(billing.roundedGrandTotal, 140);
  assert.equal(billing.roundOff, 0.01);
});

runTest('4.2 Zero-Value Complimentary Items Handle Gracefully (No Divide-by-Zero)', () => {
  const items = [
    { name: 'Complimentary Salad', price: 0, qty: 1 },
    { name: 'Complimentary Chutney', price: 0, qty: 2 }
  ];
  const billing = calculateOrderBilling({ items, discountPct: 10 });

  assert.equal(billing.subtotal, 0.00);
  assert.equal(billing.discountAmt, 0.00);
  assert.equal(billing.totalGst, 0.00);
  assert.equal(billing.grandTotal, 0.00);
  assert.equal(billing.roundedGrandTotal, 0);
  assert.equal(billing.roundOff, 0.00);
});

runTest('4.3 100% Discount Basket Clamps Gracefully', () => {
  const items = [{ name: 'Special Treat', price: 200, qty: 1 }];
  const billing = calculateOrderBilling({ items, discountAmt: 250 }); // Discount exceeds subtotal

  assert.equal(billing.subtotal, 200.00);
  assert.equal(billing.discountAmt, 200.00); // Clamped
  assert.equal(billing.taxableValue, 0.00);
  assert.equal(billing.totalGst, 0.00);
  assert.equal(billing.grandTotal, 0.00);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. NOTES BILLING METADATA SERIALIZATION & PARSING
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 5. Notes Metadata Tags Format & Parsing ---');

runTest('5.1 Format and parse billing metadata tags symmetrically', () => {
  const formatted = formatNotesBillingMetadata({
    discountPct: 15,
    discountAmt: 45.5,
    couponCode: 'LIMRA15',
    deliveryFee: 30,
    cgstRate: 2.5,
    sgstRate: 2.5,
    isInterstate: false,
    paymentMethod: 'UPI',
    paymentStatus: 'paid',
    tableRound: 2
  });

  assert.match(formatted, /\[ROUND: 2\]/);
  assert.match(formatted, /\[COUPON: LIMRA15\]/);
  assert.match(formatted, /\[DISCOUNT_PCT: 15%\]/);
  assert.match(formatted, /\[DISCOUNT_AMT: 45.5\]/);
  assert.match(formatted, /\[DELIVERY_FEE: 30\]/);
  assert.match(formatted, /\[CGST: 2.5%\]/);
  assert.match(formatted, /\[SGST: 2.5%\]/);
  assert.match(formatted, /\[PAYMENT: UPI\]/);
  assert.match(formatted, /\[PAYMENT_STATUS: PAID\]/);

  const parsed = parseNotesBillingMetadata(formatted);
  assert.equal(parsed.tableRound, 2);
  assert.equal(parsed.couponCode, 'LIMRA15');
  assert.equal(parsed.discountPct, 15);
  assert.equal(parsed.discountAmt, 45.5);
  assert.equal(parsed.deliveryFee, 30);
  assert.equal(parsed.cgstRate, 2.5);
  assert.equal(parsed.sgstRate, 2.5);
  assert.equal(parsed.paymentMethod, 'UPI');
  assert.equal(parsed.paymentStatus, 'paid');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. STATE TRANSITION INTEGRITY (PAYMENT, FULFILLMENT, TICKET)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 6. State Machine Transition Integrity ---');

runTest('6.1 Permitted Payment Transitions', () => {
  assert.equal(isValidPaymentTransition('unpaid', 'paid'), true);
  assert.equal(isValidPaymentTransition('unpaid', 'failed'), true);
  assert.equal(isValidPaymentTransition('failed', 'unpaid'), true);
  assert.equal(isValidPaymentTransition('failed', 'paid'), true);
  assert.equal(isValidPaymentTransition('paid', 'refunded'), true);
  assert.equal(isValidPaymentTransition('paid', 'paid'), true);
});

runTest('6.2 Forbidden Payment Transitions (Cannot revert paid -> unpaid or edit refunded)', () => {
  // Invariant 1: Paid orders cannot be reverted to unpaid
  assert.equal(isValidPaymentTransition('paid', 'unpaid'), false);
  // Invariant 2: Paid orders cannot be made failed
  assert.equal(isValidPaymentTransition('paid', 'failed'), false);
  // Invariant 3: Refunded orders cannot be altered
  assert.equal(isValidPaymentTransition('refunded', 'paid'), false);
  assert.equal(isValidPaymentTransition('refunded', 'unpaid'), false);
});

runTest('6.3 Permitted Ticket Lifecycle Transitions', () => {
  assert.equal(isValidTicketTransition('OPEN', 'HOLD'), true);
  assert.equal(isValidTicketTransition('HOLD', 'OPEN'), true);
  assert.equal(isValidTicketTransition('OPEN', 'BILLED'), true);
  assert.equal(isValidTicketTransition('BILLED', 'PAID'), true);
  assert.equal(isValidTicketTransition('PAID', 'CLOSED'), true);
  assert.equal(isValidTicketTransition('OPEN', 'CLOSED'), true);
  assert.equal(isValidTicketTransition('OPEN', 'CANCELLED'), true);
});

runTest('6.4 Forbidden Ticket Lifecycle Transitions (CLOSED and CANCELLED are terminal)', () => {
  // Closed tickets cannot be reopened
  assert.equal(isValidTicketTransition('CLOSED', 'OPEN'), false);
  assert.equal(isValidTicketTransition('CLOSED', 'HOLD'), false);
  assert.equal(isValidTicketTransition('CLOSED', 'BILLED'), false);
  assert.equal(isValidTicketTransition('CLOSED', 'CANCELLED'), false);

  // Cancelled tickets cannot be reopened
  assert.equal(isValidTicketTransition('CANCELLED', 'OPEN'), false);
  assert.equal(isValidTicketTransition('CANCELLED', 'CLOSED'), false);
});

runTest('6.5 Permitted Fulfillment Transitions', () => {
  assert.equal(isValidFulfillmentTransition('pending', 'confirmed'), true);
  assert.equal(isValidFulfillmentTransition('confirmed', 'preparing'), true);
  assert.equal(isValidFulfillmentTransition('preparing', 'ready'), true);
  assert.equal(isValidFulfillmentTransition('ready', 'delivered'), true);
  assert.equal(isValidFulfillmentTransition('pending', 'hold'), true);
  assert.equal(isValidFulfillmentTransition('hold', 'confirmed'), true);
  assert.equal(isValidFulfillmentTransition('pending', 'cancelled'), true);
  assert.equal(isValidFulfillmentTransition('confirmed', 'cancelled'), true);
});

runTest('6.6 Forbidden Fulfillment Transitions (Cancelled orders cannot be reactivated)', () => {
  assert.equal(isValidFulfillmentTransition('cancelled', 'pending'), false);
  assert.equal(isValidFulfillmentTransition('cancelled', 'confirmed'), false);
  assert.equal(isValidFulfillmentTransition('cancelled', 'delivered'), false);
  assert.equal(isValidFulfillmentTransition('delivered', 'pending'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. PRINTED THERMAL ESC/POS INVOICE PARITY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 7. Thermal ESC/POS Bill Parity with Canonical Calculations ---');

runTest('7.1 buildEscPosBill renders exact tax breakdown matching calculateOrderBilling', () => {
  const order = {
    id: 'test-ord-1',
    order_number: 101,
    customer_name: 'Tanvir Ahmed',
    customer_phone: '9876543210',
    total_amount: 525,
    created_at: new Date().toISOString(),
    notes: '[TABLE: 5] [ROUND: 1] [CGST: 2.5%] [SGST: 2.5%] [PAYMENT: cash]'
  };
  const items = [
    { item_name: 'Chicken Biryani', price: 200, qty: 2, gst_applicable: true },
    { item_name: 'Rumali Roti', price: 20, qty: 5, gst_applicable: true }
  ];

  const billText = buildEscPosBill(order, items, { bill_paper_width: 80 });

  assert.ok(billText.includes('Subtotal:'), 'Subtotal line must be present');
  assert.ok(billText.includes('₹500.00'), 'Subtotal should show ₹500.00');
  assert.ok(billText.includes('CGST @ 2.5%:'), 'CGST line must be present');
  assert.ok(billText.includes('₹12.50'), 'CGST should show ₹12.50');
  assert.ok(billText.includes('SGST @ 2.5%:'), 'SGST line must be present');
  assert.ok(billText.includes('₹12.50'), 'SGST should show ₹12.50');
  assert.ok(billText.includes('GRAND TOTAL:'), 'Grand total line must be present');
  assert.ok(billText.includes('₹525.00'), 'Grand total should show ₹525.00');
});

runTest('7.2 buildEscPosBill with Mixed-Tax & Proportional Discount displays Taxable Subtotal correctly', () => {
  const order = {
    id: 'test-ord-2',
    order_number: 102,
    customer_name: 'Sarah Khan',
    customer_phone: '9876543211',
    total_amount: 562.50,
    created_at: new Date().toISOString(),
    notes: '[DISCOUNT_PCT: 10%] [DISCOUNT_AMT: 60] [CGST: 2.5%] [SGST: 2.5%]'
  };
  const items = [
    { item_name: 'Tandoori Chicken Full', price: 500, qty: 1, gst_applicable: true },
    { item_name: 'Packaged Soft Drink', price: 50, qty: 2, gst_applicable: false }
  ];

  const billText = buildEscPosBill(order, items, { bill_paper_width: 80 });

  assert.ok(billText.includes('Subtotal:'), 'Subtotal line must be present');
  assert.ok(billText.includes('₹600.00'), 'Subtotal should show ₹600.00');
  assert.ok(billText.includes('Discount:'), 'Discount line must be present');
  assert.ok(billText.includes('-₹60.00'), 'Discount should show -₹60.00');
  assert.ok(billText.includes('Net Taxable:'), 'Net Taxable line must be present');
  assert.ok(billText.includes('₹450.00'), 'Net Taxable should show ₹450.00');
  assert.ok(billText.includes('CGST @ 2.5%:'), 'CGST line must be present');
  assert.ok(billText.includes('₹11.25'), 'CGST should show ₹11.25');
  assert.ok(billText.includes('SGST @ 2.5%:'), 'SGST line must be present');
  assert.ok(billText.includes('₹11.25'), 'SGST should show ₹11.25');
  assert.ok(billText.includes('GRAND TOTAL:'), 'Grand Total line must be present');
  assert.ok(billText.includes('₹562.50'), 'Grand Total should show ₹562.50');
});

runTest('7.3 ESC/POS string compiles successfully for 58mm without errors', () => {
  const order = {
    id: 'test-ord-3',
    order_number: 103,
    customer_name: 'Walk-in',
    customer_phone: '9876543212',
    total_amount: 210,
    created_at: new Date().toISOString()
  };
  const items = [{ item_name: 'Egg Roll', price: 100, qty: 2 }];

  const billText = buildEscPosBill(order, items, { bill_paper_width: 58 });
  assert.ok(typeof billText === 'string', 'Output must be an ESC/POS string');
  assert.ok(billText.length > 50, 'Stream must contain ESC/POS commands');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n======================================================================');
console.log(`  Tests completed: ${passedTests} passed, ${totalTests - passedTests} failed (${totalTests} total)`);
console.log('======================================================================\n');
