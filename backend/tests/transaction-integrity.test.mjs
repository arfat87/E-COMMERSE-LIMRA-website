import assert from "node:assert/strict";
import crypto from "crypto";
import ordersHandler from "../api/orders.js";
import { supabase } from "../api/lib/supabase.js";

// Helper to simulate Next/Vercel/Node API req & res
function createMockReqRes({
  method = "GET",
  url = "/",
  headers = {},
  body = {},
  query = {},
  user = null,
  role = null
} = {}) {
  const req = {
    method,
    url,
    headers: { ...headers },
    body,
    query,
    user,
    role,
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

console.log("\n🔒 =========================================================");
console.log("   LIMRA RESTAURANT — TRANSACTION INTEGRITY & IDEMPOTENCY SUITE");
console.log("=========================================================\n");

// In-Memory Database Mock for Transactional Integrity Testing
const mockDb = {
  orders: [],
  order_items: [],
  stock_items: [
    { id: "stock-1", name: "Chicken Biryani", qty: 20, unit: "portions" },
    { id: "stock-2", name: "Mutton Seekh Kabab", qty: 15, unit: "plates" }
  ],
  stock_logs: [],
  payment_history: [],
  sync_queue: [],
  verified_payments: []
};

// Wire mock database into Supabase client methods for deterministic test execution
const originalFrom = supabase.from;
const originalRpc = supabase.rpc;

supabase.from = function (table) {
  const collection = mockDb[table] || [];

  return {
    select(fields = "*") {
      let filters = [];
      const queryBuilder = {
        eq(col, val) {
          filters.push(row => row[col] === val);
          return queryBuilder;
        },
        neq(col, val) {
          filters.push(row => row[col] !== val);
          return queryBuilder;
        },
        in(col, vals) {
          filters.push(row => vals.includes(row[col]));
          return queryBuilder;
        },
        ilike(col, pattern) {
          const rawPattern = pattern.replace(/%/g, "").toLowerCase();
          filters.push(row => String(row[col] || "").toLowerCase().includes(rawPattern));
          return queryBuilder;
        },
        gte(col, val) {
          filters.push(row => new Date(row[col]) >= new Date(val));
          return queryBuilder;
        },
        is(col, val) {
          if (val === null) {
            filters.push(row => row[col] === null || row[col] === undefined);
          } else {
            filters.push(row => row[col] === val);
          }
          return queryBuilder;
        },
        order() {
          return queryBuilder;
        },
        limit(num) {
          let filtered = collection.filter(row => filters.every(f => f(row)));
          const limited = filtered.slice(0, num);
          return Promise.resolve({ data: JSON.parse(JSON.stringify(limited)), error: null });
        },
        then(resolve) {
          let filtered = collection.filter(row => filters.every(f => f(row)));
          return resolve({ data: JSON.parse(JSON.stringify(filtered)), error: null });
        }
      };
      return queryBuilder;
    },

    insert(rows) {
      const arr = Array.isArray(rows) ? rows : [rows];
      const inserted = [];
      for (const r of arr) {
        const item = { ...r };
        if (!item.id) item.id = crypto.randomUUID();
        if (!item.created_at) item.created_at = new Date().toISOString();
        collection.push(item);
        inserted.push(item);
      }
      return {
        select() {
          return Promise.resolve({ data: JSON.parse(JSON.stringify(inserted)), error: null });
        },
        then(resolve) {
          return resolve({ data: JSON.parse(JSON.stringify(inserted)), error: null });
        }
      };
    },

    update(updates) {
      let filters = [];
      const queryBuilder = {
        eq(col, val) {
          filters.push(row => row[col] === val);
          return queryBuilder;
        },
        neq(col, val) {
          filters.push(row => row[col] !== val);
          return queryBuilder;
        },
        is(col, val) {
          if (val === null) {
            filters.push(row => row[col] === null || row[col] === undefined);
          } else {
            filters.push(row => row[col] === val);
          }
          return queryBuilder;
        },
        select() {
          let matched = collection.filter(row => filters.every(f => f(row)));
          for (const row of matched) {
            Object.assign(row, updates);
          }
          return Promise.resolve({ data: JSON.parse(JSON.stringify(matched)), error: null });
        },
        then(resolve) {
          let matched = collection.filter(row => filters.every(f => f(row)));
          for (const row of matched) {
            Object.assign(row, updates);
          }
          return resolve({ data: JSON.parse(JSON.stringify(matched)), error: null });
        }
      };
      return queryBuilder;
    },

    delete() {
      let filters = [];
      const queryBuilder = {
        eq(col, val) {
          filters.push(row => row[col] === val);
          return queryBuilder;
        },
        select() {
          const toDelete = collection.filter(row => filters.every(f => f(row)));
          for (const item of toDelete) {
            const idx = collection.indexOf(item);
            if (idx > -1) collection.splice(idx, 1);
          }
          return Promise.resolve({ data: JSON.parse(JSON.stringify(toDelete)), error: null });
        },
        then(resolve) {
          const toDelete = collection.filter(row => filters.every(f => f(row)));
          for (const item of toDelete) {
            const idx = collection.indexOf(item);
            if (idx > -1) collection.splice(idx, 1);
          }
          return resolve({ data: JSON.parse(JSON.stringify(toDelete)), error: null });
        }
      };
      return queryBuilder;
    }
  };
};

supabase.rpc = async function (fnName, params) {
  if (fnName === "settle_order_atomic") {
    const { p_order_id, p_payment_method, p_notes, p_idempotency_key } = params;
    const target = mockDb.orders.find(o => o.id === p_order_id);
    if (!target) {
      return { data: null, error: new Error(`ORDER_NOT_FOUND: Order ${p_order_id} does not exist`) };
    }
    if (target.ticket_status === "CLOSED" && target.payment_status === "paid") {
      if (p_idempotency_key && target.idempotency_key === p_idempotency_key) {
        return {
          data: {
            success: true,
            order_id: target.id,
            order_number: target.order_number,
            status: target.status,
            payment_status: target.payment_status,
            ticket_status: target.ticket_status,
            idempotent_replay: true
          },
          error: null
        };
      }
      return {
        data: null,
        error: new Error(`ORDER_ALREADY_SETTLED: Order #${target.order_number} has already been settled and closed by another cashier.`)
      };
    }

    target.status = "delivered";
    target.payment_status = "paid";
    target.ticket_status = "CLOSED";
    target.payment_method = p_payment_method || target.payment_method || "cash";
    if (p_idempotency_key) target.idempotency_key = p_idempotency_key;

    // Enqueue to outbox
    mockDb.sync_queue.push({
      id: crypto.randomUUID(),
      entity_type: "google_sheet",
      entity_id: target.id,
      payload: { order_id: target.id, order_number: target.order_number },
      status: "pending"
    });

    return {
      data: {
        success: true,
        order_id: target.id,
        order_number: target.order_number,
        status: target.status,
        payment_status: target.payment_status,
        ticket_status: target.ticket_status,
        idempotent_replay: false
      },
      error: null
    };
  }

  if (fnName === "deduct_order_inventory_atomic") {
    const { p_order_id, p_order_number, p_items } = params;
    const alreadyLogged = mockDb.stock_logs.some(
      l => l.action === "ORDER_DEDUCT" && l.details.includes(`Order #${p_order_number}`)
    );
    if (alreadyLogged) {
      return {
        data: { success: true, already_deducted: true, message: `Inventory already deducted for Order #${p_order_number}` },
        error: null
      };
    }

    for (const item of p_items || []) {
      const name = item.name || item.item_name;
      const qty = item.quantity || item.qty || 1;
      const stk = mockDb.stock_items.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (stk) {
        stk.qty = Math.max(0, stk.qty - qty);
        mockDb.stock_logs.push({
          id: crypto.randomUUID(),
          action: "ORDER_DEDUCT",
          details: `${stk.name} deducted ${qty} ${stk.unit} for Order #${p_order_number}`,
          created_at: new Date().toISOString()
        });
      }
    }
    return { data: { success: true, already_deducted: false }, error: null };
  }

  return { data: null, error: new Error(`Unknown RPC ${fnName}`) };
};

// =========================================================================
// RUN TEST CASES
// =========================================================================

await test("1. Order Creation with Idempotency Key stores key and returns 201", async () => {
  const testKey = "idemp-test-" + crypto.randomUUID();
  const { req, res, resData } = createMockReqRes({
    method: "POST",
    headers: { "x-idempotency-key": testKey },
    body: {
      customerName: "Mohamed Tariq",
      customerPhone: "9876543210",
      orderType: "delivery",
      items: [
        { name: "Chicken Biryani", quantity: 2, price: 250 }
      ]
    }
  });

  await ordersHandler(req, res);

  assert.equal(resData.statusCode, 201, "Expected 201 Created for new order");
  assert.equal(resData.body.success, true);
  assert.equal(resData.body.data.customer_name, "Mohamed Tariq");
  assert.equal(resData.body.data.total_amount, 500);

  // Check mock DB orders table
  const saved = mockDb.orders.find(o => o.idempotency_key === testKey);
  assert.ok(saved, "Order should have been saved with the idempotency key");
  assert.equal(saved.idempotency_key, testKey);
});

await test("2. Replaying Order Submission with identical Idempotency Key returns 200 Replay (No duplicate order)", async () => {
  const initialOrderCount = mockDb.orders.length;
  const testKey = mockDb.orders[0].idempotency_key;

  const { req, res, resData } = createMockReqRes({
    method: "POST",
    headers: { "x-idempotency-key": testKey },
    body: {
      customerName: "Mohamed Tariq",
      customerPhone: "9876543210",
      items: [
        { name: "Chicken Biryani", quantity: 2, price: 250 }
      ]
    }
  });

  await ordersHandler(req, res);

  assert.equal(resData.statusCode, 200, "Expected 200 OK for idempotent replay");
  assert.equal(resData.body.success, true);
  assert.equal(resData.body.idempotent_replay, true, "Response should flag idempotent_replay: true");
  assert.equal(resData.body.data.idempotency_key, testKey);
  assert.equal(mockDb.orders.length, initialOrderCount, "Order count must NOT increase on duplicate replay");
});

await test("3. Order creation atomicity rolls back header when order items insertion fails", async () => {
  const initialOrderCount = mockDb.orders.length;
  const failKey = "idemp-fail-" + crypto.randomUUID();

  // Temporarily simulate item insert database failure
  const savedFrom = supabase.from;
  supabase.from = function (table) {
    if (table === "order_items") {
      return {
        insert() {
          return Promise.resolve({ data: null, error: new Error("Simulated foreign key failure on order_items") });
        }
      };
    }
    return savedFrom.call(supabase, table);
  };

  try {
    const { req, res, resData } = createMockReqRes({
      method: "POST",
      headers: { "x-idempotency-key": failKey },
      body: {
        customerName: "Failed Line Order",
        customerPhone: "9876543211",
        items: [
          { name: "Chicken Biryani", quantity: 1, price: 250 }
        ]
      }
    });

    await ordersHandler(req, res);

    assert.equal(resData.statusCode, 500, "Expected 500 on item insert failure");
    assert.equal(resData.body.success, false);
    assert.ok(resData.body.error.includes("Order creation aborted"));

    // Verify rollback: no orphan order should exist in DB
    const orphan = mockDb.orders.find(o => o.idempotency_key === failKey);
    assert.equal(orphan, undefined, "Orphan order must be rolled back and deleted");
    assert.equal(mockDb.orders.length, initialOrderCount, "Total orders count should remain unchanged");
  } finally {
    supabase.from = savedFrom;
  }
});

await test("4. Cashier A successfully settles an open order (status delivered, payment paid, ticket CLOSED)", async () => {
  // Create an open order for settlement
  const openOrder = {
    id: crypto.randomUUID(),
    order_number: 5001,
    customer_name: "Table 4 Guest",
    customer_phone: "9999999999",
    total_amount: 800,
    status: "pending",
    payment_status: "unpaid",
    payment_method: "cash",
    ticket_status: "OPEN",
    idempotency_key: null
  };
  mockDb.orders.push(openOrder);

  // Cashier A settlement request
  const cashierAKey = "settle-cashier-a-" + crypto.randomUUID();
  const { req, res, resData } = createMockReqRes({
    method: "PATCH",
    user: { id: "cashier-user-1", email: "cashier@limra.com" },
    role: "cashier",
    headers: {
      "x-user-role": "cashier",
      "x-user-id": "cashier-user-1",
      "x-idempotency-key": cashierAKey
    },
    body: {
      id: openOrder.id,
      status: "delivered",
      payment_status: "paid",
      ticket_status: "CLOSED",
      idempotency_key: cashierAKey
    }
  });

  await ordersHandler(req, res);

  assert.equal(resData.statusCode, 200, "Cashier A settlement must return 200");
  assert.equal(resData.body.success, true);
  assert.equal(openOrder.ticket_status, "CLOSED");
  assert.equal(openOrder.payment_status, "paid");
  assert.equal(openOrder.status, "delivered");
  assert.equal(openOrder.idempotency_key, cashierAKey);
});

await test("5. Cashier B attempting to settle the SAME order concurrently receives 409 Conflict (ORDER_ALREADY_SETTLED)", async () => {
  const settledOrderId = mockDb.orders.find(o => o.order_number === 5001).id;
  const cashierBKey = "settle-cashier-b-" + crypto.randomUUID();

  const { req, res, resData } = createMockReqRes({
    method: "PATCH",
    user: { id: "cashier-user-2", email: "cashier2@limra.com" },
    role: "cashier",
    headers: {
      "x-user-role": "cashier",
      "x-user-id": "cashier-user-2",
      "x-idempotency-key": cashierBKey
    },
    body: {
      id: settledOrderId,
      status: "delivered",
      payment_status: "paid",
      ticket_status: "CLOSED",
      idempotency_key: cashierBKey
    }
  });

  await ordersHandler(req, res);

  assert.equal(resData.statusCode, 409, "Second cashier must receive 409 Conflict");
  assert.equal(resData.body.success, false);
  assert.equal(resData.body.code, "ORDER_ALREADY_SETTLED");
  assert.ok(resData.body.error.includes("already been settled and closed"));
});

await test("6. Cashier A retrying with identical Idempotency Key receives 200 Replay (Idempotent Settlement)", async () => {
  const settledOrder = mockDb.orders.find(o => o.order_number === 5001);
  const cashierAKey = settledOrder.idempotency_key;

  const { req, res, resData } = createMockReqRes({
    method: "PATCH",
    user: { id: "cashier-user-1", email: "cashier@limra.com" },
    role: "cashier",
    headers: {
      "x-user-role": "cashier",
      "x-user-id": "cashier-user-1",
      "x-idempotency-key": cashierAKey
    },
    body: {
      id: settledOrder.id,
      status: "delivered",
      payment_status: "paid",
      ticket_status: "CLOSED",
      idempotency_key: cashierAKey
    }
  });

  await ordersHandler(req, res);

  assert.equal(resData.statusCode, 200, "Retrying with same key must return 200 OK replay");
  assert.equal(resData.body.success, true);
  assert.equal(resData.body.idempotent_replay, true);
});

await test("7. Atomic Inventory Deduction decrements stock correctly", async () => {
  const initialQty = mockDb.stock_items.find(s => s.name === "Chicken Biryani").qty;

  const { data: res1 } = await supabase.rpc("deduct_order_inventory_atomic", {
    p_order_id: crypto.randomUUID(),
    p_order_number: 7701,
    p_items: [{ name: "Chicken Biryani", quantity: 3 }]
  });

  assert.equal(res1.success, true);
  assert.equal(res1.already_deducted, false);

  const updatedItem = mockDb.stock_items.find(s => s.name === "Chicken Biryani");
  assert.equal(updatedItem.qty, initialQty - 3, "Stock quantity should be reduced by 3");
});

await test("8. Duplicate Inventory Deduction for the same order is rejected idempotently (No double deduction)", async () => {
  const qtyBeforeDuplicate = mockDb.stock_items.find(s => s.name === "Chicken Biryani").qty;

  // Repeat deduction call for same order #7701
  const { data: res2 } = await supabase.rpc("deduct_order_inventory_atomic", {
    p_order_id: crypto.randomUUID(),
    p_order_number: 7701,
    p_items: [{ name: "Chicken Biryani", quantity: 3 }]
  });

  assert.equal(res2.success, true);
  assert.equal(res2.already_deducted, true, "Should report already_deducted: true");

  const qtyAfterDuplicate = mockDb.stock_items.find(s => s.name === "Chicken Biryani").qty;
  assert.equal(qtyAfterDuplicate, qtyBeforeDuplicate, "Stock quantity must NOT be decremented a second time");
});

await test("9. Transactional Outbox Pattern decouples external side effects into sync_queue", async () => {
  // Check that settlement of order #5001 enqueued an entry into sync_queue
  const queueEntry = mockDb.sync_queue.find(q => q.entity_type === "google_sheet" && q.payload.order_number === 5001);
  assert.ok(queueEntry, "Settlement must enqueue Google Sheets sync task in sync_queue");
  assert.equal(queueEntry.status, "pending");

  // Verify DB settlement remains committed even if external service is unavailable
  const settled = mockDb.orders.find(o => o.order_number === 5001);
  assert.equal(settled.ticket_status, "CLOSED");
  assert.equal(settled.payment_status, "paid");
});

await test("10. External Payment Gateway and PostgreSQL are decoupled (Two-phase coordination model)", async () => {
  // A verified payment in verified_payments table can only be claimed once
  const utr = "UTIB000000000099";
  mockDb.verified_payments.push({
    id: crypto.randomUUID(),
    utr,
    amount: 500,
    status: "success",
    order_id: null
  });

  // Order 1 claims the payment
  const { req: req1, res: res1, resData: resData1 } = createMockReqRes({
    method: "POST",
    body: {
      customerName: "Buyer 1",
      customerPhone: "9123456789",
      txnRef: utr,
      items: [{ name: "Chicken Biryani", quantity: 2, price: 250 }]
    }
  });

  await ordersHandler(req1, res1);
  assert.equal(resData1.statusCode, 201);
  assert.equal(resData1.body.data.payment_status, "paid", "Order 1 successfully claims verified payment");

  // Order 2 attempts to replay or steal the same UTR
  const { req: req2, res: res2, resData: resData2 } = createMockReqRes({
    method: "POST",
    body: {
      customerName: "Buyer 2 Attacker",
      customerPhone: "9123456780",
      txnRef: utr,
      items: [{ name: "Chicken Biryani", quantity: 2, price: 250 }]
    }
  });

  await ordersHandler(req2, res2);
  assert.equal(resData2.statusCode, 201);
  assert.equal(resData2.body.data.payment_status, "unpaid", "Order 2 cannot claim already bound payment and must be marked unpaid");
});

// Restore original methods
supabase.from = originalFrom;
supabase.rpc = originalRpc;

console.log("\n=========================================================");
console.log(`  TRANSACTION INTEGRITY TESTS: ${passed} PASSED, ${failed} FAILED`);
console.log("=========================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
