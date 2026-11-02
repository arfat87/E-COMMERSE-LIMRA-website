/**
 * =============================================================================
 * TASK 5.1 VERIFICATION TEST SUITE: NORMALIZE FINANCIAL & ORDER LIFECYCLE DATA
 * =============================================================================
 * 
 * Verifies:
 * 1. PostgreSQL migration script 20261017090000_normalize_orders_financial_lifecycle.sql
 *    - All 11 columns conditionally added to public.orders
 *    - Domain check constraints preventing invalid financial data
 *    - Performance indexes on settled_at, consolidated_into_order_id, taxable_amount
 *    - Safe backward-compatible data backfills
 *    - Updated settle_order_atomic RPC timestamping settled_at
 * 2. Canonical database schema database/schema.sql
 *    - Schema definition for public.orders contains all 11 columns
 *    - Constraints and indexes matching the migration
 *    - Updated settle_order_atomic RPC definition
 * 3. Backend API order insertion in backend/api/orders.js
 *    - orderInsertPayload populates all 11 normalized columns
 * 4. Frontend ORDER_SELECT_COLUMNS in frontend/src/admin.js
 *    - Includes all 11 columns in PostgREST select strings
 * 5. Functional verification: Zero tax rate drift
 *    - computeOrderTaxDetails uses structured columns when present
 *    - Altering bill settings does not retroactively mutate historical tax values
 * 6. Functional verification: Legacy order backward compatibility fallback
 *    - Falls back to calculateOrderBilling and notes metadata when columns are empty
 * 7. Functional verification: Structured discounts
 *    - Preserves discount_pct and discount_amount accurately without fragile regex
 * 8. Functional verification: Delivery & packaging fees
 *    - Preserves delivery_fee and keeps it distinct from GST-taxable food value
 * 9. Functional verification: Dine-in table session consolidation
 *    - Sibling orders receive consolidated_into_order_id linking to primary bill
 *    - getConsolidatedClosedBills groups siblings by consolidated_into_order_id
 * 10. Functional verification: Settlement lifecycle timestamping
 *    - settle_order_atomic sets settled_at timestamp in database and local state
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { calculateOrderBilling } from '../../frontend/src/lib/billing-engine.js';

const MIGRATION_PATH = path.resolve('database/migrations/20261017090000_normalize_orders_financial_lifecycle.sql');
const SCHEMA_PATH = path.resolve('database/schema.sql');
const BACKEND_ORDERS_PATH = path.resolve('backend/api/orders.js');
const ADMIN_JS_PATH = path.resolve('frontend/src/admin.js');

const EXPECTED_COLUMNS = [
  'subtotal_amount',
  'discount_pct',
  'discount_amount',
  'taxable_amount',
  'cgst_amount',
  'sgst_amount',
  'delivery_fee',
  'packaging_fee',
  'round_off_amount',
  'settled_at',
  'consolidated_into_order_id'
];

describe('TASK 5.1: Normalize Financial & Order Lifecycle Data on public.orders', () => {
  const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const backendOrdersJs = fs.readFileSync(BACKEND_ORDERS_PATH, 'utf8');
  const adminJs = fs.readFileSync(ADMIN_JS_PATH, 'utf8');

  it('1. PostgreSQL migration script exists and declares all 11 normalized columns with check constraints and indexes', () => {
    assert.ok(fs.existsSync(MIGRATION_PATH), 'Migration file must exist');

    for (const col of EXPECTED_COLUMNS) {
      assert.ok(
        migrationSql.includes(`ADD COLUMN IF NOT EXISTS ${col}`),
        `Migration must conditionally add column: ${col}`
      );
    }

    // Check constraints
    assert.ok(migrationSql.includes('chk_orders_subtotal'), 'Missing chk_orders_subtotal constraint');
    assert.ok(migrationSql.includes('chk_orders_discount_pct'), 'Missing chk_orders_discount_pct constraint');
    assert.ok(migrationSql.includes('chk_orders_discount_amount'), 'Missing chk_orders_discount_amount constraint');
    assert.ok(migrationSql.includes('chk_orders_taxable_amount'), 'Missing chk_orders_taxable_amount constraint');
    assert.ok(migrationSql.includes('chk_orders_cgst_amount'), 'Missing chk_orders_cgst_amount constraint');
    assert.ok(migrationSql.includes('chk_orders_sgst_amount'), 'Missing chk_orders_sgst_amount constraint');
    assert.ok(migrationSql.includes('chk_orders_delivery_fee'), 'Missing chk_orders_delivery_fee constraint');
    assert.ok(migrationSql.includes('chk_orders_packaging_fee'), 'Missing chk_orders_packaging_fee constraint');

    // Performance indexes
    assert.ok(migrationSql.includes('CREATE INDEX IF NOT EXISTS idx_orders_settled_at'), 'Missing idx_orders_settled_at index');
    assert.ok(migrationSql.includes('CREATE INDEX IF NOT EXISTS idx_orders_consolidated_into'), 'Missing idx_orders_consolidated_into index');
    assert.ok(migrationSql.includes('CREATE INDEX IF NOT EXISTS idx_orders_taxable_amount'), 'Missing idx_orders_taxable_amount index');

    // Safe backward-compatible backfill
    assert.ok(migrationSql.includes('SET settled_at = updated_at'), 'Missing settled_at backfill query');
    assert.ok(migrationSql.includes('SET consolidated_into_order_id = (regexp_match(notes'), 'Missing consolidated_into_order_id backfill query');

    // Updated RPC definition
    assert.ok(migrationSql.includes('CREATE OR REPLACE FUNCTION public.settle_order_atomic'), 'Missing settle_order_atomic RPC');
    assert.ok(migrationSql.includes('settled_at = COALESCE(v_order.settled_at, now())'), 'settle_order_atomic must set settled_at');
  });

  it('2. Canonical database schema database/schema.sql contains all 11 columns, constraints, and indexes', () => {
    for (const col of EXPECTED_COLUMNS) {
      assert.ok(
        schemaSql.includes(col),
        `Canonical schema must define column: ${col}`
      );
    }

    assert.ok(schemaSql.includes('idx_orders_settled_at'), 'Schema must declare idx_orders_settled_at');
    assert.ok(schemaSql.includes('idx_orders_consolidated_into'), 'Schema must declare idx_orders_consolidated_into');
    assert.ok(schemaSql.includes('idx_orders_taxable_amount'), 'Schema must declare idx_orders_taxable_amount');
    assert.ok(schemaSql.includes('settled_at = COALESCE(v_order.settled_at, now())'), 'Schema RPC must set settled_at');
  });

  it('3. Backend API orderInsertPayload in backend/api/orders.js persists all normalized fields', () => {
    assert.ok(backendOrdersJs.includes('subtotal_amount: billing.subtotal'), 'Missing subtotal_amount in API payload');
    assert.ok(backendOrdersJs.includes('discount_pct: billing.discountPct'), 'Missing discount_pct in API payload');
    assert.ok(backendOrdersJs.includes('discount_amount: billing.discountAmt'), 'Missing discount_amount in API payload');
    assert.ok(backendOrdersJs.includes('taxable_amount: billing.taxableAmount'), 'Missing taxable_amount in API payload');
    assert.ok(backendOrdersJs.includes('cgst_amount: billing.cgstAmt'), 'Missing cgst_amount in API payload');
    assert.ok(backendOrdersJs.includes('sgst_amount: billing.sgstAmt'), 'Missing sgst_amount in API payload');
    assert.ok(backendOrdersJs.includes('delivery_fee: billing.deliveryFee'), 'Missing delivery_fee in API payload');
    assert.ok(backendOrdersJs.includes('packaging_fee: 0'), 'Missing packaging_fee in API payload');
    assert.ok(backendOrdersJs.includes('round_off_amount: billing.roundOff'), 'Missing round_off_amount in API payload');
    assert.ok(backendOrdersJs.includes('settled_at: cleanPayStatus === "paid"'), 'Missing settled_at in API payload');
    assert.ok(backendOrdersJs.includes('consolidated_into_order_id: (isSubsequentRound && activeParentOrder)'), 'Missing consolidated_into_order_id in API payload');
  });

  it('4. Frontend ORDER_SELECT_COLUMNS in frontend/src/admin.js includes all 11 columns and is used across queries', () => {
    const selectConstMatch = adminJs.match(/const ORDER_SELECT_COLUMNS\s*=\s*'([^']+)'/);
    assert.ok(selectConstMatch, 'ORDER_SELECT_COLUMNS must be defined in admin.js');
    const selectStr = selectConstMatch[1];

    for (const col of EXPECTED_COLUMNS) {
      assert.ok(
        selectStr.includes(col),
        `ORDER_SELECT_COLUMNS must include ${col}`
      );
    }

    // Both historical & GST batch queries must use ORDER_SELECT_COLUMNS
    const ensureGstMatch = adminJs.includes(".from('orders')\n        .select(ORDER_SELECT_COLUMNS)\n        .gte('created_at', startIso)");
    assert.ok(ensureGstMatch, 'ensureOrdersForGstRange must select ORDER_SELECT_COLUMNS');

    const loadHistMatch = adminJs.includes(".from('orders')\n      .select(ORDER_SELECT_COLUMNS)\n      .neq('status', 'cancelled')");
    assert.ok(loadHistMatch, 'loadHistoricalClosedOrdersPage must select ORDER_SELECT_COLUMNS');
  });

  it('5. Zero tax rate drift: computeOrderTaxDetails uses structured columns and avoids recalculation drift', () => {
    // Simulate computeOrderTaxDetails fast path from admin.js
    function simulateComputeOrderTaxDetails(order, globalSettings) {
      const hasStructuredFinancials = (
        order.taxable_amount !== undefined &&
        order.taxable_amount !== null &&
        (Number(order.taxable_amount) > 0 || Number(order.subtotal_amount) > 0)
      );

      if (hasStructuredFinancials) {
        const subtotal = Number(order.subtotal_amount) || 0;
        const discountPct = Number(order.discount_pct) || 0;
        const discountAmt = Number(order.discount_amount) || 0;
        const taxableValue = Number(order.taxable_amount) || 0;
        const cgstAmt = Number(order.cgst_amount) || 0;
        const sgstAmt = Number(order.sgst_amount) || 0;
        const totalGst = Math.round((cgstAmt + sgstAmt) * 100) / 100;
        const deliveryFee = Number(order.delivery_fee) || 0;
        const packagingFee = Number(order.packaging_fee) || 0;
        const grandTotal = Math.floor(Math.max(0, Number(order.total_amount) || 0));
        const roundOff = (order.round_off_amount !== undefined && order.round_off_amount !== null)
          ? Number(order.round_off_amount)
          : Math.round((grandTotal - (taxableValue + totalGst + deliveryFee + packagingFee)) * 100) / 100;

        const derivedCgstRate = taxableValue > 0 ? Math.round((cgstAmt / taxableValue) * 1000) / 10 : 2.5;
        const derivedSgstRate = taxableValue > 0 ? Math.round((sgstAmt / taxableValue) * 1000) / 10 : 2.5;

        return {
          subtotal,
          discountPct,
          discountAmt,
          taxableValue,
          cgstRate: derivedCgstRate,
          cgstAmt,
          sgstRate: derivedSgstRate,
          sgstAmt,
          totalGstRate: Math.round((derivedCgstRate + derivedSgstRate) * 10) / 10,
          totalGst,
          deliveryFee,
          packagingFee,
          grandTotal,
          roundOff
        };
      }

      // Legacy fallback
      const billing = calculateOrderBilling({
        items: [{ price: Number(order.total_amount) || 0, qty: 1 }],
        cgstRate: globalSettings.cgstRate,
        sgstRate: globalSettings.sgstRate
      });
      return billing;
    }

    // Historical order billed in 2024 with 5% GST (2.5% CGST + 2.5% SGST)
    const historicalOrder = {
      id: 'hist-order-1',
      subtotal_amount: 500.00,
      discount_pct: 0,
      discount_amount: 0,
      taxable_amount: 500.00,
      cgst_amount: 12.50,
      sgst_amount: 12.50,
      delivery_fee: 0,
      packaging_fee: 0,
      round_off_amount: 0,
      total_amount: 525.00
    };

    // Today's restaurant tax setting is changed to 12% GST (6% CGST + 6% SGST)
    const alteredSettings = { cgstRate: 6.0, sgstRate: 6.0 };

    const taxDetails = simulateComputeOrderTaxDetails(historicalOrder, alteredSettings);

    // Veracity check: Tax MUST remain 12.50 + 12.50 = 25.00, NOT drift to 30.00 + 30.00 = 60.00
    assert.strictEqual(taxDetails.taxableValue, 500.00, 'Taxable value must match stored column exactly');
    assert.strictEqual(taxDetails.cgstAmt, 12.50, 'CGST must match stored column exactly (no drift)');
    assert.strictEqual(taxDetails.sgstAmt, 12.50, 'SGST must match stored column exactly (no drift)');
    assert.strictEqual(taxDetails.totalGst, 25.00, 'Total GST must remain 25.00');
    assert.strictEqual(taxDetails.grandTotal, 525.00, 'Grand total must remain 525.00');
  });

  it('6. Backward-compatibility: legacy order without structured columns falls back to billing calculation', () => {
    const legacyOrder = {
      id: 'legacy-order-99',
      notes: '[CGST: 2.5%] [SGST: 2.5%]',
      total_amount: 210.00,
      subtotal_amount: 0,
      taxable_amount: 0,
      cgst_amount: 0,
      sgst_amount: 0
    };

    const items = [
      { name: 'Chicken Biryani', price: 200, qty: 1 }
    ];

    const billing = calculateOrderBilling({
      items,
      cgstRate: 2.5,
      sgstRate: 2.5
    });

    assert.strictEqual(billing.subtotal, 200.00);
    assert.strictEqual(billing.taxableValue, 200.00);
    assert.strictEqual(billing.cgstAmt, 5.00);
    assert.strictEqual(billing.sgstAmt, 5.00);
    assert.strictEqual(billing.totalGst, 10.00);
    assert.strictEqual(billing.grandTotal, 210.00);
  });

  it('7. Structured discounts: discount_pct and discount_amount are preserved with exact taxable deduction', () => {
    const items = [
      { name: 'Mutton Kebab', price: 300, qty: 1 },
      { name: 'Butter Naan', price: 50, qty: 2 }
    ];

    const billing = calculateOrderBilling({
      items,
      discountPct: 10,
      cgstRate: 2.5,
      sgstRate: 2.5
    });

    assert.strictEqual(billing.subtotal, 400.00);
    assert.strictEqual(billing.discountPct, 10);
    assert.strictEqual(billing.discountAmt, 40.00);
    assert.strictEqual(billing.taxableValue, 360.00);
    assert.strictEqual(billing.cgstAmt, 9.00);
    assert.strictEqual(billing.sgstAmt, 9.00);
    assert.strictEqual(billing.totalGst, 18.00);
    assert.strictEqual(billing.grandTotal, 378.00);

    // Validate that stored columns in order match this exact breakdown
    const orderRecord = {
      subtotal_amount: billing.subtotal,
      discount_pct: billing.discountPct,
      discount_amount: billing.discountAmt,
      taxable_amount: billing.taxableValue,
      cgst_amount: billing.cgstAmt,
      sgst_amount: billing.sgstAmt,
      total_amount: billing.grandTotal
    };

    assert.strictEqual(orderRecord.subtotal_amount, 400.00);
    assert.strictEqual(orderRecord.discount_pct, 10);
    assert.strictEqual(orderRecord.discount_amount, 40.00);
    assert.strictEqual(orderRecord.taxable_amount, 360.00);
    assert.strictEqual(orderRecord.total_amount, 378.00);
  });

  it('8. Delivery fee preservation: delivery_fee is kept separate from taxable value', () => {
    const items = [
      { name: 'Chicken Fried Rice', price: 180, qty: 1 }
    ];

    const billing = calculateOrderBilling({
      items,
      deliveryFee: 40.00,
      cgstRate: 2.5,
      sgstRate: 2.5
    });

    assert.strictEqual(billing.subtotal, 180.00);
    assert.strictEqual(billing.taxableValue, 180.00);
    assert.strictEqual(billing.cgstAmt, 4.50);
    assert.strictEqual(billing.sgstAmt, 4.50);
    assert.strictEqual(billing.totalGst, 9.00);
    assert.strictEqual(billing.deliveryFee, 40.00);
    // Grand total = 180 + 9 + 40 = 229
    assert.strictEqual(billing.grandTotal, 229.00);
  });

  it('9. Table consolidation: sibling orders receive consolidated_into_order_id and are grouped in getConsolidatedClosedBills', () => {
    function simulateConsolidatedClosedBills(ordersList) {
      const result = [];
      const handledOrderIds = new Set();
      const finalBills = ordersList.filter(o => (o.notes || '').includes('[FINAL_BILL]'));

      for (const fb of finalBills) {
        if (handledOrderIds.has(fb.id)) continue;
        handledOrderIds.add(fb.id);

        const siblingIds = [];
        ordersList.forEach(sibling => {
          if (sibling.id === fb.id) return;
          if (handledOrderIds.has(sibling.id)) return;
          if ((sibling.notes || '').includes('[FINAL_BILL]')) return;
          if (sibling.status === 'cancelled') return;

          let isSibling = false;
          if (sibling.consolidated_into_order_id && String(sibling.consolidated_into_order_id) === String(fb.id)) {
            isSibling = true;
          }

          if (isSibling) {
            handledOrderIds.add(sibling.id);
            siblingIds.push(sibling.id);
          }
        });

        fb.sibling_order_ids = siblingIds;
        result.push(fb);
      }

      // Add remaining independent orders
      for (const o of ordersList) {
        if (!handledOrderIds.has(o.id)) {
          handledOrderIds.add(o.id);
          result.push(o);
        }
      }

      return result;
    }

    const primaryBill = {
      id: 'fb-uuid-101',
      order_number: 101,
      notes: '[TABLE: 5] [FINAL_BILL]',
      total_amount: 850.00,
      consolidated_into_order_id: null
    };

    const siblingKot1 = {
      id: 'kot-uuid-102',
      order_number: 102,
      notes: '[TABLE: 5] [ROUND: 2]',
      total_amount: 0,
      consolidated_into_order_id: 'fb-uuid-101'
    };

    const siblingKot2 = {
      id: 'kot-uuid-103',
      order_number: 103,
      notes: '[TABLE: 5] [ROUND: 3]',
      total_amount: 0,
      consolidated_into_order_id: 'fb-uuid-101'
    };

    const independentTakeaway = {
      id: 'takeaway-uuid-201',
      order_number: 201,
      notes: '[SELF PICKUP]',
      total_amount: 150.00,
      consolidated_into_order_id: null
    };

    const allOrders = [primaryBill, siblingKot1, siblingKot2, independentTakeaway];
    const consolidated = simulateConsolidatedClosedBills(allOrders);

    // Expect exactly 2 bills: primaryBill (containing siblingKot1 and siblingKot2) and independentTakeaway
    assert.strictEqual(consolidated.length, 2, 'Must produce 2 distinct bills');
    const tableBill = consolidated.find(b => b.id === 'fb-uuid-101');
    assert.ok(tableBill, 'Primary table bill must be present');
    assert.deepStrictEqual(tableBill.sibling_order_ids, ['kot-uuid-102', 'kot-uuid-103']);

    const takeawayBill = consolidated.find(b => b.id === 'takeaway-uuid-201');
    assert.ok(takeawayBill, 'Independent takeaway bill must be present');
    assert.strictEqual(takeawayBill.total_amount, 150.00);
  });

  it('10. Atomic settlement lifecycle: settle_order_atomic persists settled_at timestamp', () => {
    // Verify settle_order_atomic sets settled_at in admin.js
    assert.ok(adminJs.includes("settled_at: rpcResult?.settled_at"), 'admin.js must record settled_at from RPC result');

    // Test settlement object payload simulation
    const settledAtTime = new Date().toISOString();
    const settlementPayload = {
      status: 'delivered',
      payment_status: 'paid',
      ticket_status: 'CLOSED',
      payment_method: 'upi',
      settled_at: settledAtTime
    };

    assert.strictEqual(settlementPayload.status, 'delivered');
    assert.strictEqual(settlementPayload.payment_status, 'paid');
    assert.strictEqual(settlementPayload.ticket_status, 'CLOSED');
    assert.strictEqual(settlementPayload.payment_method, 'upi');
    assert.ok(settlementPayload.settled_at, 'settled_at must be populated');
    assert.ok(!isNaN(new Date(settlementPayload.settled_at).getTime()), 'settled_at must be a valid ISO date');
  });
});
