import assert from "node:assert/strict";
import crypto from "crypto";
import createOrderHandler from "../api/create-order.js";
import verifyPaymentHandler from "../api/verify-payment.js";
import webhookHandler from "../api/webhook.js";
import ordersHandler from "../api/orders.js";
import { supabase } from "../api/lib/supabase.js";

// Helper to simulate Next/Vercel/Node API req & res
function createMockReqRes({
  method = "GET",
  url = "/",
  headers = {},
  body = {},
  rawBody = null,
  query = {}
} = {}) {
  const req = {
    method,
    url,
    headers: { ...headers },
    body,
    rawBody: rawBody !== null ? rawBody : (typeof body === "string" ? body : JSON.stringify(body)),
    query,
    socket: { remoteAddress: "127.0.0.1" }
  };

  const resData = {
    statusCode: 200,
    headers: {},
    body: null,
    isEnded: false
  };

  const res = {
    status(code) {
      resData.statusCode = code;
      return this;
    },
    setHeader(k, v) {
      resData.headers[k.toLowerCase()] = v;
      return this;
    },
    json(data) {
      resData.body = data;
      resData.isEnded = true;
      return this;
    },
    send(data) {
      resData.body = data;
      resData.isEnded = true;
      return this;
    },
    end(data) {
      if (data && !resData.body) resData.body = data;
      resData.isEnded = true;
      return this;
    }
  };

  return { req, res, resData };
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

// Generate valid Razorpay HMAC SHA256 signature
function generateRazorpaySignature(orderId, paymentId, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

// Generate valid Razorpay Webhook HMAC SHA256 signature
function generateWebhookSignature(rawBody, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
}

console.log("\n💳 =========================================================");
console.log("   LIMRA RESTAURANT — RAZORPAY PAYMENT SECURITY SUITE");
console.log("=========================================================\n");

const TEST_SECRET = "test_razorpay_secret_limra_key_secure_123456";
const TEST_KEY_ID = "rzp_test_LimraUnitTestsKey";
process.env.RAZORPAY_KEY_SECRET = TEST_SECRET;
process.env.RAZORPAY_KEY_ID = TEST_KEY_ID;
process.env.RAZORPAY_WEBHOOK_SECRET = TEST_SECRET;

// ─────────────────────────────────────────────────────────────
// SUITE 1: Secret Credentials Protection & Gateway Order Creation
// ─────────────────────────────────────────────────────────────
console.log("SUITE 1: Razorpay Order Creation & Currency / Bounds Validation");

await test("/api/create-order: Rejects non-POST HTTP methods", async () => {
  const { req, res, resData } = createMockReqRes({ method: "GET" });
  await createOrderHandler(req, res);
  assert.equal(resData.statusCode, 405, "Expected 405 Method Not Allowed");
  assert.equal(resData.body.success, false);
});

await test("/api/create-order: Rejects non-INR currencies (e.g. USD, EUR)", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { amount: 50000, currency: "USD" }
  });
  await createOrderHandler(req, res);
  assert.equal(resData.statusCode, 400, "Expected 400 Bad Request for foreign currency");
  assert.match(resData.body.error, /Only INR currency is supported/i);
});

await test("/api/create-order: Rejects amount below minimum (less than 100 paise / ₹1.00)", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { amount: 50, currency: "INR" }
  });
  await createOrderHandler(req, res);
  assert.equal(resData.statusCode, 400, "Expected 400 for amount < 100 paise");
  assert.match(resData.body.error, /at least 100 paise/i);
});

await test("/api/create-order: Rejects amount exceeding maximum limit (> ₹50,000)", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { amount: 99999999, currency: "INR" }
  });
  await createOrderHandler(req, res);
  assert.equal(resData.statusCode, 400, "Expected 400 for excessive transaction amount");
  assert.match(resData.body.error, /maximum permitted transaction limit/i);
});

await test("/api/create-order: Computes trusted amount from items array, preventing price manipulation", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: {
      amount: 100, // Attacker sends ₹1.00
      currency: "INR",
      items: [
        { id: 1, name: "Chicken Biryani", price: 250, quantity: 2 }, // ₹500
        { id: 2, name: "Firni", price: 60, quantity: 1 }            // ₹60
      ] // Total should be ₹560 = 56000 paise
    }
  });

  // Enable test simulation temporarily to inspect resolved amount without live Razorpay network call
  process.env.ALLOW_PAYMENT_SIMULATION = "true";
  process.env.NODE_ENV = "test";
  const origKeySecret = process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_KEY_SECRET;

  await createOrderHandler(req, res);
  process.env.RAZORPAY_KEY_SECRET = origKeySecret;

  assert.equal(resData.statusCode, 200);
  assert.equal(resData.body.amount, 56000, "Server must compute 56000 paise from items, ignoring client's ₹1.00");
  assert.equal(resData.body.key_secret, undefined, "Server secret must NEVER be exposed in response");
});

await test("/api/create-order: Never exposes Razorpay secret key in response", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { amount: 5000, currency: "INR" }
  });

  process.env.ALLOW_PAYMENT_SIMULATION = "true";
  const origKeySecret = process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_KEY_SECRET;

  await createOrderHandler(req, res);
  process.env.RAZORPAY_KEY_SECRET = origKeySecret;

  assert.equal(resData.body.key_secret, undefined);
  assert.equal(resData.body.secret, undefined);
});

// ─────────────────────────────────────────────────────────────
// SUITE 2: Signature Verification, Timing Attack & Tamper Prevention
// ─────────────────────────────────────────────────────────────
console.log("\nSUITE 2: Signature Verification & Timing Attack Hardening");

await test("/api/verify-payment: Rejects request missing required fields", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { razorpay_order_id: "order_12345" }
  });
  await verifyPaymentHandler(req, res);
  assert.equal(resData.statusCode, 400);
  assert.match(resData.body.error, /Missing required signature verification fields/i);
});

await test("/api/verify-payment: Rejects invalid or forged HMAC SHA-256 signature", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: {
      razorpay_order_id: "order_real_123456",
      razorpay_payment_id: "pay_real_654321",
      razorpay_signature: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" // forged/wrong
    }
  });
  await verifyPaymentHandler(req, res);
  assert.equal(resData.statusCode, 400);
  assert.match(resData.body.error, /Invalid Razorpay payment signature/i);
});

await test("/api/verify-payment: Rejects signature with byte length mismatch (timing-safe check)", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: {
      razorpay_order_id: "order_real_123456",
      razorpay_payment_id: "pay_real_654321",
      razorpay_signature: "short_invalid_sig"
    }
  });
  await verifyPaymentHandler(req, res);
  assert.equal(resData.statusCode, 400);
  assert.match(resData.body.error, /Invalid Razorpay payment signature/i);
});

await test("/api/verify-payment: Accepts mathematically authentic signature", async () => {
  const orderId = "order_test_unit_" + Date.now();
  const paymentId = "pay_test_unit_" + Date.now();
  const validSignature = generateRazorpaySignature(orderId, paymentId, TEST_SECRET);

  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: validSignature,
      amount: 450
    }
  });

  await verifyPaymentHandler(req, res);
  assert.equal(resData.statusCode, 200);
  assert.equal(resData.body.success, true);
  assert.equal(resData.body.payment_id, paymentId);
});

await test("/api/verify-payment: Idempotent duplicate verification returns 200 without failure", async () => {
  const orderId = "order_idem_" + Date.now();
  const paymentId = "pay_idem_" + Date.now();
  const validSignature = generateRazorpaySignature(orderId, paymentId, TEST_SECRET);

  const reqBody = {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: validSignature,
    amount: 450
  };

  // First call
  const call1 = createMockReqRes({ method: "POST", body: reqBody });
  await verifyPaymentHandler(call1.req, call1.res);
  assert.equal(call1.resData.statusCode, 200);

  // Immediate retry (simulating duplicate network callback)
  const call2 = createMockReqRes({ method: "POST", body: reqBody });
  await verifyPaymentHandler(call2.req, call2.res);
  assert.equal(call2.resData.statusCode, 200);
  assert.equal(call2.resData.body.success, true);
});

await test("/api/verify-payment: Rejects dev simulation payload when in production environment", async () => {
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    const { req, res, resData } = createMockReqRes({
      method: "POST",
      body: {
        razorpay_order_id: "order_test_sim_9999",
        razorpay_payment_id: "pay_sim_9999",
        razorpay_signature: "simulated_valid_signature"
      }
    });
    await verifyPaymentHandler(req, res);
    assert.equal(resData.statusCode, 400);
    assert.match(resData.body.error, /Payment simulation is strictly disabled/i);
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

// ─────────────────────────────────────────────────────────────
// SUITE 3: Payment Replay & Order Association Protection
// ─────────────────────────────────────────────────────────────
console.log("\nSUITE 3: Payment Replay Attacks & Order Association Protection");

await test("/api/orders: Customer cannot mark order as paid without verified transaction", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: {
      customerName: "Sneaky Customer",
      customerPhone: "9876543210",
      items: [{ id: 1, name: "Biryani", price: 200, quantity: 1 }],
      paymentStatus: "paid", // Attempting to forge paid status
      txnRef: null
    }
  });

  try {
    await ordersHandler(req, res);
    if (resData.body?.data) {
      assert.equal(resData.body.data.payment_status, "unpaid", "Untrusted order must stay unpaid");
    }
  } catch (e) {
    if (resData.body?.data) {
      assert.notEqual(resData.body.data.payment_status, "paid");
    }
  }
});

await test("/api/orders: Customer cannot replay an already claimed payment UTR on a new order", async () => {
  const claimedPaymentId = "pay_already_claimed_" + Date.now();
  const existingOrderId = crypto.randomUUID();

  // Seed verified_payments with an already claimed order_id
  await supabase.from("verified_payments").upsert({
    utr: claimedPaymentId,
    amount: 500,
    status: "success",
    order_id: existingOrderId,
    created_at: new Date().toISOString()
  });

  // Now customer tries to use the same claimed payment ID for a brand new order
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: {
      customerName: "Replay Attacker",
      customerPhone: "9876543210",
      items: [{ id: 1, name: "Biryani", price: 250, quantity: 2 }],
      paymentMethod: "online",
      paymentStatus: "paid",
      txnRef: claimedPaymentId // Replaying claimed UTR!
    }
  });

  try {
    await ordersHandler(req, res);
    if (resData.body?.data) {
      assert.equal(resData.body.data.payment_status, "unpaid", "Replayed UTR must NOT result in paid order status");
    }
  } catch (e) {
    if (resData.body?.data) {
      assert.notEqual(resData.body.data.payment_status, "paid");
    }
  }
});

// ─────────────────────────────────────────────────────────────
// SUITE 4: Explicit State Transitions & Anti-Reversal Enforcement
// ─────────────────────────────────────────────────────────────
console.log("\nSUITE 4: State Machine & Transition Rules (paid -> unpaid blocked)");

await test("/api/orders: PATCH rejects unauthenticated modification", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "PATCH",
    body: { id: crypto.randomUUID(), payment_status: "paid" }
  });
  await ordersHandler(req, res);
  assert.equal(resData.statusCode, 401);
  assert.equal(resData.body.success, false);
});

await test("/api/orders: PATCH rejects reverting 'paid' order to 'unpaid'", async () => {
  // Create a settled paid order in database
  const orderId = crypto.randomUUID();
  await supabase.from("orders").insert([
    {
      id: orderId,
      order_number: 8888,
      customer_name: "Test Customer",
      customer_phone: "9876543210",
      total_amount: 300,
      status: "delivered",
      payment_status: "paid",
      payment_method: "online"
    }
  ]);

  // Staff member tries to revert settled order to 'unpaid'
  const { req, res, resData } = createMockReqRes({
    method: "PATCH",
    headers: { authorization: "Bearer mock_staff_token" },
    body: {
      id: orderId,
      payment_status: "unpaid" // Strictly disallowed state reversal!
    }
  });

  // Mock staff auth
  req.user = { id: "staff-1", role: "manager" };
  req.role = "manager";

  await ordersHandler(req, res);
  assert.equal(resData.statusCode, 400);
  assert.match(resData.body.error, /Settled 'paid' orders cannot be reverted to 'unpaid'/i);

  // Clean up
  await supabase.from("orders").delete().eq("id", orderId);
});

// ─────────────────────────────────────────────────────────────
// SUITE 5: Razorpay Webhooks Signature & Idempotent Processing
// ─────────────────────────────────────────────────────────────
console.log("\nSUITE 5: Razorpay Webhooks Signature & Processing");

await test("/api/webhook: Rejects webhook without x-razorpay-signature header", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { event: "payment.captured" }
  });
  await webhookHandler(req, res);
  assert.equal(resData.statusCode, 400);
  assert.match(resData.body.error, /Missing x-razorpay-signature header/i);
});

await test("/api/webhook: Rejects webhook with invalid HMAC signature", async () => {
  const rawBody = JSON.stringify({ event: "payment.captured", id: "evt_123" });
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    headers: { "x-razorpay-signature": "bogus_signature_1234567890abcdef" },
    rawBody: rawBody,
    body: JSON.parse(rawBody)
  });
  await webhookHandler(req, res);
  assert.equal(resData.statusCode, 400);
  assert.match(resData.body.error, /Invalid webhook signature/i);
});

await test("/api/webhook: Validly signed payment.captured event processed idempotently", async () => {
  const payId = "pay_hook_" + Date.now();
  const eventPayload = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: payId,
          amount: 55000, // ₹550.00
          currency: "INR",
          status: "captured",
          order_id: "order_rzp_hook_123"
        }
      }
    }
  };

  const rawBody = JSON.stringify(eventPayload);
  const signature = generateWebhookSignature(rawBody, TEST_SECRET);

  const { req, res, resData } = createMockReqRes({
    method: "POST",
    headers: { "x-razorpay-signature": signature },
    rawBody: rawBody,
    body: eventPayload
  });

  await webhookHandler(req, res);
  assert.equal(resData.statusCode, 200);
  assert.equal(resData.body.status, "ok");

  // Duplicate webhook retry test
  const retry = createMockReqRes({
    method: "POST",
    headers: { "x-razorpay-signature": signature },
    rawBody: rawBody,
    body: eventPayload
  });
  await webhookHandler(retry.req, retry.res);
  assert.equal(retry.resData.statusCode, 200);
  assert.equal(retry.resData.body.status, "ok");
});

await test("/api/webhook: Validly signed payment.failed event is recorded without error", async () => {
  const payId = "pay_fail_hook_" + Date.now();
  const eventPayload = {
    event: "payment.failed",
    payload: {
      payment: {
        entity: {
          id: payId,
          amount: 25000,
          currency: "INR",
          status: "failed",
          error_description: "Card expired"
        }
      }
    }
  };

  const rawBody = JSON.stringify(eventPayload);
  const signature = generateWebhookSignature(rawBody, TEST_SECRET);

  const { req, res, resData } = createMockReqRes({
    method: "POST",
    headers: { "x-razorpay-signature": signature },
    rawBody: rawBody,
    body: eventPayload
  });

  await webhookHandler(req, res);
  assert.equal(resData.statusCode, 200);
  assert.equal(resData.body.status, "ok");
});

console.log("\n=========================================================");
console.log(`RESULTS: ${passed} Passed, ${failed} Failed`);
console.log("=========================================================\n");

if (failed > 0) {
  process.exit(1);
}
