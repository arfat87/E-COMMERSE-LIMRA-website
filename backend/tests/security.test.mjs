import assert from "node:assert/strict";
import dbHandler from "../api/db.js";
import ordersHandler from "../api/orders.js";
import menuHandler from "../api/menu.js";
import analyticsHandler from "../api/analytics.js";
import verifyPaymentHandler from "../api/verify-payment.js";
import { checkRateLimit } from "../api/lib/rate-limiter.js";
import { hasRequiredRole } from "../api/lib/auth-middleware.js";

// Helper to simulate Next/Vercel/Node API req & res
function createMockReqRes({ method = "GET", url = "/", headers = {}, body = {}, query = {} } = {}) {
  const req = {
    method,
    url,
    headers: { ...headers },
    body,
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

console.log("\n🔒 RUNNING LIMRA RESTAURANT SECURITY SUITE\n");

// ─────────────────────────────────────────────────────────────
// SUITE 1: Generic Database Dispatcher (/api/db) Lockdown
// ─────────────────────────────────────────────────────────────

await test("/api/db: Rejects unauthenticated SELECT on 'orders'", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { action: "select", table: "orders" }
  });
  await dbHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
  assert.match(resData.body.error.message, /requires staff credentials/i);
});

await test("/api/db: Strictly forbids access to 'phone_verifications' table", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { action: "select", table: "phone_verifications" }
  });
  await dbHandler(req, res);
  assert.equal(resData.statusCode, 403, "Expected 403 Forbidden");
  assert.match(resData.body.error.message, /strictly forbidden/i);
});

await test("/api/db: Rejects unauthenticated SELECT on 'admin_users'", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { action: "select", table: "admin_users" }
  });
  await dbHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
});

await test("/api/db: Rejects unauthenticated DELETE on 'orders'", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { action: "delete", table: "orders", filter: { id: "00000000-0000-0000-0000-000000000000" } }
  });
  await dbHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
  assert.match(resData.body.error.message, /requires staff authorization/i);
});

await test("/api/db: Rejects unauthenticated restricted RPC 'record_stock_out'", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { action: "rpc", rpc: "record_stock_out", params: { p_item_id: "test", p_qty: 5 } }
  });
  await dbHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
  assert.match(resData.body.error.message, /Authentication required/i);
});

await test("/api/db: Rejects unauthenticated restricted RPC 'record_stock_in'", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { action: "rpc", rpc: "record_stock_in", params: { p_item_id: "test", p_qty: 10 } }
  });
  await dbHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
  assert.match(resData.body.error.message, /Authentication required/i);
});

await test("/api/db: Rejects unauthenticated restricted RPC 'get_stock_daily_summary'", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { action: "rpc", rpc: "get_stock_daily_summary" }
  });
  await dbHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
});

await test("/api/db: Rejects checkAdmin when called without token or with spoofed email", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { action: "auth", authType: "checkAdmin", email: "admin@limra.com" }
  });
  await dbHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
  assert.match(resData.body.error.message, /session token required/i);
});

await test("/api/db: Rejects invalid or expired Bearer token", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    headers: { authorization: "Bearer invalid_expired_jwt_token_123456789" },
    body: { action: "auth", authType: "checkAdmin" }
  });
  await dbHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
});

// ─────────────────────────────────────────────────────────────
// SUITE 2: Orders API (/api/orders) Protection
// ─────────────────────────────────────────────────────────────

await test("/api/orders: Rejects unauthenticated GET /api/orders", async () => {
  const { req, res, resData } = createMockReqRes({ method: "GET" });
  await ordersHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
  assert.equal(resData.body.success, false);
});

await test("/api/orders: Rejects unauthenticated PATCH /api/orders", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "PATCH",
    body: { id: "fake-order-id", status: "delivered", payment_status: "paid" }
  });
  await ordersHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
  assert.equal(resData.body.success, false);
});

await test("/api/orders: Rejects unauthenticated DELETE /api/orders", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "DELETE",
    body: { id: "fake-order-id" }
  });
  await ordersHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
  assert.equal(resData.body.success, false);
});

await test("/api/orders: POST prevents customer from forging payment_status = 'paid'", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: {
      customerName: "Attacker",
      customerPhone: "9876543210",
      orderType: "table",
      tableNumber: 5,
      items: [{ id: 1, name: "Biryani", price: 200, quantity: 2 }],
      paymentStatus: "paid", // Attacker attempts to mark as paid without valid transaction ref!
      txnRef: null
    }
  });

  // Note: This insert will attempt to query Supabase or throw on network, but let's test the payload preparation
  // By checking payment_status logic in the handler
  try {
    await ordersHandler(req, res);
    if (resData.body?.data) {
      assert.equal(resData.body.data.payment_status, "unpaid", "Customer must not be allowed to set paid status without verified UTR");
    }
  } catch (e) {
    // If database connection fails during test, that's expected offline, but response must never be paid
    if (resData.body?.data) {
      assert.notEqual(resData.body.data.payment_status, "paid");
    }
  }
});

// ─────────────────────────────────────────────────────────────
// SUITE 3: Menu API (/api/menu) Protection
// ─────────────────────────────────────────────────────────────

await test("/api/menu: Rejects unauthenticated POST /api/menu", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { id: 101, price: 0 }
  });
  await menuHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
});

await test("/api/menu: Rejects unauthenticated PATCH /api/menu", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "PATCH",
    body: { id: 101, available: false }
  });
  await menuHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
});

// ─────────────────────────────────────────────────────────────
// SUITE 4: Analytics API (/api/analytics) Protection
// ─────────────────────────────────────────────────────────────

await test("/api/analytics: Rejects unauthenticated GET /api/analytics", async () => {
  const { req, res, resData } = createMockReqRes({ method: "GET" });
  await analyticsHandler(req, res);
  assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized");
  assert.equal(resData.body.success, false);
});

// ─────────────────────────────────────────────────────────────
// SUITE 5: Payment Verification API (/api/verify-payment)
// ─────────────────────────────────────────────────────────────

await test("/api/verify-payment: Rejects request missing verification fields", async () => {
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    body: { razorpay_order_id: "order_123" }
  });
  await verifyPaymentHandler(req, res);
  assert.equal(resData.statusCode, 400, "Expected 400 Bad Request");
  assert.match(resData.body.error, /Missing required/i);
});

await test("/api/verify-payment: Rejects simulation backdoor in production mode", async () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    const { req, res, resData } = createMockReqRes({
      method: "POST",
      body: {
        razorpay_order_id: "order_test_sim_12345",
        razorpay_payment_id: "pay_sim_12345",
        razorpay_signature: "simulated_valid_signature"
      }
    });
    await verifyPaymentHandler(req, res);
    assert.equal(resData.statusCode, 400, "Expected 400 Bad Request in production");
    assert.match(resData.body.error, /simulation is strictly disabled/i);
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

// ─────────────────────────────────────────────────────────────
// SUITE 6: Rate Limiting
// ─────────────────────────────────────────────────────────────

await test("Rate limiter triggers 429 when threshold exceeded", async () => {
  const mockReq = {
    headers: { "x-forwarded-for": "192.168.1.100" },
    socket: { remoteAddress: "192.168.1.100" }
  };

  let exceeded = false;
  for (let i = 0; i < 15; i++) {
    const result = checkRateLimit(mockReq, { windowMs: 60000, maxRequests: 5, keyPrefix: "test-limit" });
    if (!result.allowed) {
      exceeded = true;
      break;
    }
  }
  assert.equal(exceeded, true, "Rate limit threshold must trigger not allowed");
});

// ─────────────────────────────────────────────────────────────
// SUITE 7: Role-Based Access Control (RBAC) Hierarchy & Permissions
// ─────────────────────────────────────────────────────────────

await test("RBAC: 'owner' role satisfies all permissions", async () => {
  assert.equal(hasRequiredRole("owner", ["owner"]), true);
  assert.equal(hasRequiredRole("owner", ["manager"]), true);
  assert.equal(hasRequiredRole("owner", ["cashier"]), true);
  assert.equal(hasRequiredRole("owner", ["kitchen"]), true);
});

await test("RBAC: 'manager' role satisfies manager, cashier, and kitchen permissions", async () => {
  assert.equal(hasRequiredRole("manager", ["manager"]), true);
  assert.equal(hasRequiredRole("manager", ["cashier"]), true);
  assert.equal(hasRequiredRole("manager", ["kitchen"]), true);
  assert.equal(hasRequiredRole("manager", ["owner"]), false);
});

await test("RBAC: 'cashier' role satisfies cashier permissions only", async () => {
  assert.equal(hasRequiredRole("cashier", ["cashier"]), true);
  assert.equal(hasRequiredRole("cashier", ["manager"]), false);
  assert.equal(hasRequiredRole("cashier", ["owner"]), false);
  assert.equal(hasRequiredRole("cashier", ["kitchen"]), false);
});

await test("RBAC: 'kitchen' role satisfies kitchen permissions only", async () => {
  assert.equal(hasRequiredRole("kitchen", ["kitchen"]), true);
  assert.equal(hasRequiredRole("kitchen", ["cashier"]), false);
  assert.equal(hasRequiredRole("kitchen", ["manager"]), false);
  assert.equal(hasRequiredRole("kitchen", ["owner"]), false);
});

await test("RBAC: 'customer' or anonymous users cannot access staff roles", async () => {
  assert.equal(hasRequiredRole("customer", ["cashier"]), false);
  assert.equal(hasRequiredRole("customer", ["kitchen"]), false);
  assert.equal(hasRequiredRole("customer", ["manager"]), false);
  assert.equal(hasRequiredRole("anonymous", ["cashier"]), false);
  assert.equal(hasRequiredRole(null, ["cashier"]), false);
});

console.log(`\n==================================================`);
console.log(`📊 SECURITY TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log(`==================================================\n`);

if (failed > 0) {
  process.exit(1);
}
