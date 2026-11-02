/**
 * LIMRA RESTAURANT — TESTING SECURITY & DATABASE ISOLATION TEST SUITE
 * 
 * Verifies:
 * 1. Testing Security Guard:
 *    - Automated tests can run ONLY in local development or test environments.
 *    - All automated tests are strictly BLOCKED on production environments.
 *    - Production detection covers NODE_ENV, VERCEL_ENV, APP_ENV, ENVIRONMENT, IS_PRODUCTION.
 *    - Clear, descriptive security error message is emitted on production detection.
 * 2. Database Isolation:
 *    - Production Supabase database (ynrtlcasbndkrqeotgzt) is strictly protected.
 *    - Automated tests NEVER write to, modify, or delete real customer data, bills, payments, or tables.
 *    - In-memory database sandbox provides complete CRUD and RPC simulation without network egress.
 *    - Dedicated development Supabase project configuration (DEV_SUPABASE_URL / SUPABASE_TEST_URL) is supported.
 * 3. Application Protection Layer:
 *    - Payment simulation backdoors are strictly prohibited in production.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isProductionEnvironment,
  isProductionDatabaseUrl,
  assertTestEnvironment,
  createTestDatabaseSandbox,
  PRODUCTION_SUPABASE_REF,
  PRODUCTION_SUPABASE_HOST
} from '../api/lib/test-guard.js';
import verifyPaymentHandler from '../api/verify-payment.js';

describe('SUITE 1: Production Detection & Strict Testing Protection Layer', () => {
  it('1.1 isProductionEnvironment detects NODE_ENV=production', () => {
    assert.equal(isProductionEnvironment({ NODE_ENV: 'production' }), true);
    assert.equal(isProductionEnvironment({ NODE_ENV: 'prod' }), true);
  });

  it('1.2 isProductionEnvironment detects VERCEL_ENV=production', () => {
    assert.equal(isProductionEnvironment({ VERCEL_ENV: 'production' }), true);
  });

  it('1.3 isProductionEnvironment detects APP_ENV and ENVIRONMENT=production', () => {
    assert.equal(isProductionEnvironment({ APP_ENV: 'production' }), true);
    assert.equal(isProductionEnvironment({ ENVIRONMENT: 'production' }), true);
  });

  it('1.4 isProductionEnvironment detects IS_PRODUCTION=true and CF_PAGES_BRANCH=main', () => {
    assert.equal(isProductionEnvironment({ IS_PRODUCTION: 'true' }), true);
    assert.equal(isProductionEnvironment({ CF_PAGES_BRANCH: 'main' }), true);
  });

  it('1.5 isProductionEnvironment returns false for development and test environments', () => {
    assert.equal(isProductionEnvironment({ NODE_ENV: 'development' }), false);
    assert.equal(isProductionEnvironment({ NODE_ENV: 'test' }), false);
    assert.equal(isProductionEnvironment({ NODE_ENV: 'local' }), false);
    assert.equal(isProductionEnvironment({}), false);
  });

  it('1.6 assertTestEnvironment blocks with critical error when production is detected', () => {
    assert.throws(
      () => {
        assertTestEnvironment({
          env: { NODE_ENV: 'production' },
          throwOnly: true,
          runnerName: 'Production Test Blocker Unit Test'
        });
      },
      /CRITICAL SECURITY ERROR: Automated tests are blocked on production environment/
    );
  });

  it('1.7 assertTestEnvironment permits execution in test and development environments', () => {
    const resTest = assertTestEnvironment({
      env: { NODE_ENV: 'test' },
      throwOnly: true
    });
    assert.equal(resTest, true);

    const resDev = assertTestEnvironment({
      env: { NODE_ENV: 'development' },
      throwOnly: true
    });
    assert.equal(resDev, true);
  });
});

describe('SUITE 2: Database Isolation & Production Immunity', () => {
  it('2.1 isProductionDatabaseUrl accurately identifies live production Supabase instance', () => {
    assert.equal(isProductionDatabaseUrl(`https://${PRODUCTION_SUPABASE_HOST}`), true);
    assert.equal(isProductionDatabaseUrl(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`), true);
    assert.equal(isProductionDatabaseUrl('https://limra-prod.supabase.co'), true);
  });

  it('2.2 isProductionDatabaseUrl allows separate development/test Supabase projects', () => {
    assert.equal(isProductionDatabaseUrl('https://dev-limra-pos.supabase.co'), false);
    assert.equal(isProductionDatabaseUrl('https://local-test.supabase.co'), false);
    assert.equal(isProductionDatabaseUrl('http://127.0.0.1:54321'), false);
  });

  it('2.3 Test database sandbox performs isolated CRUD without touching production tables', async () => {
    const sandbox = createTestDatabaseSandbox();

    // 1. Insert order into sandbox
    const testOrderId = 'test-ord-' + Date.now();
    const { data: inserted, error: insertErr } = await sandbox
      .from('orders')
      .insert({
        id: testOrderId,
        order_number: 7777,
        customer_name: 'Sandbox Customer',
        customer_phone: '9876543210',
        payment_status: 'unpaid',
        status: 'pending',
        total_amount: 500
      });

    assert.equal(insertErr, null);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].id, testOrderId);

    // 2. Query order from sandbox
    const { data: queried, error: queryErr } = await sandbox
      .from('orders')
      .select('*')
      .eq('id', testOrderId);

    assert.equal(queryErr, null);
    assert.equal(queried.length, 1);
    assert.equal(queried[0].customer_name, 'Sandbox Customer');

    // 3. Update order in sandbox
    const { data: updated, error: updateErr } = await sandbox
      .from('orders')
      .update({ payment_status: 'paid', status: 'delivered' })
      .eq('id', testOrderId);

    assert.equal(updateErr, null);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].payment_status, 'paid');

    // 4. Delete order from sandbox
    const { data: deleted, error: deleteErr } = await sandbox
      .from('orders')
      .delete()
      .eq('id', testOrderId);

    assert.equal(deleteErr, null);
    assert.equal(deleted.length, 1);

    // 5. Verify order is deleted
    const { data: finalQuery } = await sandbox
      .from('orders')
      .select('*')
      .eq('id', testOrderId);

    assert.equal(finalQuery.length, 0);
  });

  it('2.4 Test database sandbox handles upsert and verified payments safely in memory', async () => {
    const sandbox = createTestDatabaseSandbox();
    const testUtr = 'utr_sandbox_' + Date.now();

    const { data: upserted, error } = await sandbox
      .from('verified_payments')
      .upsert({
        utr: testUtr,
        amount: 350,
        status: 'success'
      });

    assert.equal(error, null);
    assert.equal(upserted.length, 1);
    assert.equal(upserted[0].utr, testUtr);

    const { data: found } = await sandbox
      .from('verified_payments')
      .select('*')
      .eq('utr', testUtr);

    assert.equal(found.length, 1);
    assert.equal(found[0].amount, 350);
  });

  it('2.5 Test database sandbox routes atomic RPCs safely without modifying real inventory', async () => {
    const sandbox = createTestDatabaseSandbox();

    const { data: resDeduct, error: errDeduct } = await sandbox.rpc('deduct_order_inventory_atomic', {
      p_order_id: 'ord-123',
      p_items: [{ menu_item_id: 1, quantity: 2 }]
    });

    assert.equal(errDeduct, null);
    assert.equal(resDeduct.success, true);
    assert.equal(resDeduct.processed_items.length, 1);

    const { data: resSettle, error: errSettle } = await sandbox.rpc('settle_order_atomic', {
      p_order_id: 'ord-123',
      p_payment_method: 'cash'
    });

    assert.equal(errSettle, null);
    assert.equal(resSettle.success, true);
  });
});

describe('SUITE 3: Application Protection Layer in Production', () => {
  it('3.1 /api/verify-payment rejects payment simulation payloads in production environment', async () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origSim = process.env.ALLOW_PAYMENT_SIMULATION;

    try {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_PAYMENT_SIMULATION = 'false';

      let statusCode = 200;
      let responseBody = null;

      const mockReq = {
        method: 'POST',
        body: {
          razorpay_order_id: 'order_test_sim_123',
          razorpay_payment_id: 'pay_sim_456',
          razorpay_signature: 'simulated_valid_signature',
          order_id: 'ord-test-sim'
        },
        headers: {},
        socket: { remoteAddress: '127.0.0.1' }
      };

      const mockRes = {
        status(code) {
          statusCode = code;
          return this;
        },
        setHeader() {
          return this;
        },
        json(data) {
          responseBody = data;
          return this;
        }
      };

      await verifyPaymentHandler(mockReq, mockRes);

      assert.equal(statusCode, 400);
      assert.equal(responseBody.success, false);
      assert.match(responseBody.error, /Payment simulation is strictly disabled/i);
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      process.env.ALLOW_PAYMENT_SIMULATION = origSim;
    }
  });
});
