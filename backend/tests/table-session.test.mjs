import assert from "node:assert/strict";
import crypto from "crypto";
import dbHandler from "../api/db.js";
import { supabase } from "../api/lib/supabase.js";

// Helper to simulate API req & res
function createMockReqRes({
  method = "POST",
  url = "/api/db",
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

console.log("\n🍽️  =========================================================");
console.log("   LIMRA RESTAURANT — TABLE SESSION & NOTIFICATIONS TEST SUITE");
console.log("=========================================================\n");

// Simulated In-Memory Database for Table Session Tests
const mockDb = {
  orders: [],
  order_items: [],
  notifications: []
};

// Table-level advisory lock simulation
const tableLocks = new Map();

async function simulateTableAdvisoryLock(tableNumber) {
  while (tableLocks.get(tableNumber)) {
    await new Promise(r => setTimeout(r, 10));
  }
  tableLocks.set(tableNumber, true);
  return () => tableLocks.delete(tableNumber);
}

// Implement mock implementation of place_table_round RPC matching migration logic
function mockPlaceTableRound(params) {
  const {
    p_table_number,
    p_table_zone = null,
    p_customer_name = "Dine-in Guest",
    p_customer_phone = "0000000000",
    p_items = [],
    p_notes = null,
    p_round_number = 1,
    p_idempotency_key = null
  } = params;

  // 1. Validation
  if (p_table_number === undefined || p_table_number === null || p_table_number < 1 || p_table_number > 19) {
    throw new Error(`Invalid table number: ${p_table_number}. Must be between 1 and 19`);
  }
  if (!p_items || p_items.length === 0) {
    throw new Error("Order must have at least one item");
  }

  const cleanKey = p_idempotency_key ? String(p_idempotency_key).trim() : null;

  // 2. Idempotency Check
  if (cleanKey) {
    const existing = mockDb.orders.find(o => o.idempotency_key === cleanKey);
    if (existing) {
      let rNum = 1;
      const rMatch = existing.notes && existing.notes.match(/\[ROUND:\s*(\d+)\]/);
      if (rMatch) rNum = parseInt(rMatch[1], 10);

      let parentId = null;
      const pMatch = existing.notes && existing.notes.match(/\[PARENT_ORDER_ID:\s*([0-9a-fA-F-]+)\]/);
      if (pMatch) parentId = pMatch[1];

      return {
        id: existing.id,
        order_number: existing.order_number,
        session_id: parentId || existing.id,
        total_amount: existing.total_amount,
        status: existing.status,
        ticket_status: existing.ticket_status,
        round_number: rNum,
        parent_order_id: parentId,
        is_subsequent_round: rNum > 1,
        idempotent_replay: true,
        table_number: existing.table_number,
        table_zone: existing.table_zone
      };
    }
  }

  // 3. Compute total
  let roundTotal = 0;
  for (const it of p_items) {
    roundTotal += Number(it.line_total || (Number(it.unit_price || it.price || 0) * Number(it.quantity || it.qty || 1)));
  }

  // 4. Determine zone
  const zone = p_table_zone || (p_table_number <= 9 ? "indoor" : "outdoor");

  // 5. Query for ACTIVE ticket at table
  // STRICT: ticket_status IN ('OPEN', 'HOLD') AND status NOT IN ('delivered', 'cancelled') AND payment_status != 'paid'
  const activeTicket = mockDb.orders.find(o =>
    o.order_type === "table" &&
    o.table_number === p_table_number &&
    ["OPEN", "HOLD"].includes(o.ticket_status) &&
    !["delivered", "cancelled"].includes(o.status) &&
    o.payment_status !== "paid"
  );

  let isSubsequent = false;
  let parentId = null;
  let roundNum = 1;
  let orderNum = 1001;
  let roundNotes = "";
  let notifTitle = "";
  let notifMsg = "";

  if (activeTicket) {
    isSubsequent = true;
    parentId = activeTicket.id;
    orderNum = activeTicket.order_number;

    // Count existing rounds in this active session
    const sessionOrders = mockDb.orders.filter(o =>
      o.table_number === p_table_number &&
      (o.id === activeTicket.id || (o.notes && o.notes.includes(`[PARENT_ORDER_ID: ${activeTicket.id}`))) &&
      ["OPEN", "HOLD"].includes(o.ticket_status) &&
      o.status !== "cancelled"
    );

    let maxRound = 1;
    for (const o of sessionOrders) {
      const match = o.notes && o.notes.match(/\[ROUND:\s*(\d+)\]/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxRound) maxRound = n;
      }
    }
    roundNum = maxRound + 1;

    roundNotes = `[ROUND: ${roundNum}] [PARENT_ORDER_ID: ${activeTicket.id}] [TABLE: ${p_table_number}]`;
    if (p_notes && String(p_notes).trim()) roundNotes += ` ${String(p_notes).trim()}`;

    notifTitle = `🍽️ Table ${p_table_number} - Round ${roundNum}`;
    notifMsg = `Table ${p_table_number} (${zone.toUpperCase()}) placed Round ${roundNum} (${p_items.length} items · ₹${roundTotal})`;
  } else {
    isSubsequent = false;
    parentId = null;
    roundNum = 1;
    const maxOrderNum = mockDb.orders.reduce((max, o) => Math.max(max, o.order_number || 1000), 1000);
    orderNum = maxOrderNum + 1;

    roundNotes = `[ROUND: 1] [TABLE: ${p_table_number}]`;
    if (p_notes && String(p_notes).trim()) roundNotes += ` ${String(p_notes).trim()}`;

    notifTitle = `🍽️ Table ${p_table_number} - New Order`;
    notifMsg = `New Dine-In Order received for ₹${roundTotal} at Table ${p_table_number} (${zone.toUpperCase()})`;
  }

  // Insert Order
  const newOrder = {
    id: crypto.randomUUID(),
    order_number: orderNum,
    customer_name: (p_customer_name || "Dine-in Guest").trim(),
    customer_phone: (p_customer_phone || "0000000000").trim(),
    order_type: "table",
    table_number: p_table_number,
    table_zone: zone,
    total_amount: roundTotal,
    status: "pending",
    payment_status: "unpaid",
    ticket_status: "OPEN",
    notes: roundNotes,
    idempotency_key: cleanKey,
    created_at: new Date().toISOString()
  };
  mockDb.orders.push(newOrder);

  // Insert Order Items
  for (const it of p_items) {
    mockDb.order_items.push({
      id: crypto.randomUUID(),
      order_id: newOrder.id,
      menu_item_id: it.menu_item_id || null,
      item_name: it.item_name || it.name,
      quantity: it.quantity || it.qty || 1,
      unit_price: it.unit_price || it.price || 0,
      line_total: it.line_total || 0,
      created_at: new Date().toISOString()
    });
  }

  // Insert Notification
  mockDb.notifications.push({
    id: crypto.randomUUID(),
    type: "order",
    title: notifTitle,
    message: notifMsg,
    description: notifMsg,
    order_id: newOrder.id,
    item_id: `order-${newOrder.id}`,
    customer_phone: newOrder.customer_phone,
    is_read: false,
    created_at: new Date().toISOString()
  });

  return {
    id: newOrder.id,
    order_number: newOrder.order_number,
    session_id: parentId || newOrder.id,
    total_amount: newOrder.total_amount,
    status: newOrder.status,
    ticket_status: newOrder.ticket_status,
    round_number: roundNum,
    parent_order_id: parentId,
    is_subsequent_round: isSubsequent,
    idempotent_replay: false,
    table_number: p_table_number,
    table_zone: zone
  };
}

// Implement mock implementation of request_table_service RPC matching migration logic
function mockRequestTableService(params) {
  const { p_table_number, p_service_type, p_customer_name, p_notes } = params;

  if (p_table_number === undefined || p_table_number === null || p_table_number < 1 || p_table_number > 19) {
    throw new Error(`Invalid table number: ${p_table_number}. Must be between 1 and 19`);
  }
  if (!["call_waiter", "request_bill"].includes(p_service_type)) {
    throw new Error(`Invalid service type: ${p_service_type}. Must be call_waiter or request_bill`);
  }

  const zone = p_table_number <= 9 ? "Indoor" : "Outdoor";

  // Rate-limiting: 60s
  const cutoff = Date.now() - 60000;
  const recentExists = mockDb.notifications.some(n =>
    n.item_id === `table-${p_table_number}` &&
    n.type === p_service_type &&
    !n.is_read &&
    new Date(n.created_at).getTime() >= cutoff
  );

  if (recentExists) {
    return {
      success: true,
      already_notified: true,
      message: p_service_type === "call_waiter"
        ? `Staff has already been notified for Table ${p_table_number}. A waiter is on the way!`
        : `Bill request already received for Table ${p_table_number}. Cashier is preparing your bill!`,
      table_number: p_table_number,
      service_type: p_service_type
    };
  }

  // Check active session
  const activeTicket = mockDb.orders.find(o =>
    o.order_type === "table" &&
    o.table_number === p_table_number &&
    ["OPEN", "HOLD"].includes(o.ticket_status) &&
    !["delivered", "cancelled"].includes(o.status) &&
    o.payment_status !== "paid"
  );

  let title = "";
  let msg = "";

  if (activeTicket) {
    if (p_service_type === "call_waiter") {
      title = `🔔 Table ${p_table_number} - Waiter Called`;
      msg = `Table ${p_table_number} (${zone} · Order #${activeTicket.order_number}) is calling for a waiter.`;
    } else {
      title = `🧾 Table ${p_table_number} - Bill Requested`;
      msg = `Table ${p_table_number} (${zone} · Order #${activeTicket.order_number}) has requested the bill (₹${activeTicket.total_amount}).`;
    }
  } else {
    if (p_service_type === "call_waiter") {
      title = `🔔 Table ${p_table_number} - Waiter Called`;
      msg = `Guest at Table ${p_table_number} (${zone}) is requesting a waiter (no active food order).`;
    } else {
      title = `🧾 Table ${p_table_number} - Bill Requested`;
      msg = `Guest at Table ${p_table_number} (${zone}) requested bill, but no active order is open.`;
    }
  }

  if (p_notes && String(p_notes).trim()) {
    msg += ` Note: ${String(p_notes).trim()}`;
  }

  const notifId = crypto.randomUUID();
  mockDb.notifications.push({
    id: notifId,
    type: p_service_type,
    title,
    message: msg,
    description: msg,
    order_id: activeTicket ? activeTicket.id : null,
    item_id: `table-${p_table_number}`,
    customer_phone: activeTicket ? activeTicket.customer_phone : "0000000000",
    is_read: false,
    created_at: new Date().toISOString()
  });

  return {
    success: true,
    already_notified: false,
    notification_id: notifId,
    table_number: p_table_number,
    table_zone: zone,
    service_type: p_service_type,
    has_active_session: Boolean(activeTicket),
    order_id: activeTicket ? activeTicket.id : null,
    order_number: activeTicket ? activeTicket.order_number : null,
    session_id: activeTicket ? activeTicket.id : null,
    message: p_service_type === "call_waiter"
      ? `Waiter has been called to Table ${p_table_number}! 🔔 Staff will assist you shortly.`
      : `Bill requested for Table ${p_table_number}! 🧾 Cashier will bring your bill.`
  };
}

// Hook mock RPCs into Supabase client
supabase.rpc = async function (fnName, params) {
  try {
    if (fnName === "place_table_round") {
      const data = mockPlaceTableRound(params);
      return { data, error: null };
    }
    if (fnName === "request_table_service") {
      const data = mockRequestTableService(params);
      return { data, error: null };
    }
    return { data: null, error: new Error(`Unknown RPC: ${fnName}`) };
  } catch (err) {
    return { data: null, error: err };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TEST CASES
// ─────────────────────────────────────────────────────────────────────────────

async function runTests() {
  // Test 1: First order at an empty table creates Round 1 and active session
  await test("1. First order at an empty table creates Round 1 and initializes session", async () => {
    mockDb.orders = [];
    mockDb.order_items = [];
    mockDb.notifications = [];

    const res = mockPlaceTableRound({
      p_table_number: 4,
      p_table_zone: "indoor",
      p_customer_name: "Aman Khan",
      p_customer_phone: "9876543210",
      p_items: [
        { menu_item_id: 101, item_name: "Chicken Biryani", quantity: 2, unit_price: 180, line_total: 360 },
        { menu_item_id: 102, item_name: "Phirni", quantity: 2, unit_price: 60, line_total: 120 }
      ],
      p_notes: "Extra onions please"
    });

    assert.equal(res.round_number, 1);
    assert.equal(res.is_subsequent_round, false);
    assert.equal(res.parent_order_id, null);
    assert.equal(res.session_id, res.id);
    assert.equal(res.table_number, 4);
    assert.equal(res.table_zone, "indoor");
    assert.equal(res.ticket_status, "OPEN");
    assert.equal(res.total_amount, 480);

    // Verify DB records
    assert.equal(mockDb.orders.length, 1);
    assert.equal(mockDb.order_items.length, 2);
    assert.equal(mockDb.notifications.length, 1);
    assert.match(mockDb.notifications[0].title, /Table 4 - New Order/);
  });

  // Test 2: Additional round while ticket is open attaches to same session as Round 2
  await test("2. Additional round while ticket is open attaches as Round 2 to same session", async () => {
    const round1 = mockDb.orders[0];

    const res2 = mockPlaceTableRound({
      p_table_number: 4,
      p_customer_name: "Aman Khan",
      p_items: [
        { menu_item_id: 103, item_name: "Butter Naan", quantity: 4, unit_price: 40, line_total: 160 }
      ],
      p_notes: "Crispy please"
    });

    assert.equal(res2.round_number, 2);
    assert.equal(res2.is_subsequent_round, true);
    assert.equal(res2.parent_order_id, round1.id);
    assert.equal(res2.session_id, round1.id);
    assert.equal(res2.order_number, round1.order_number);
    assert.equal(res2.table_number, 4);

    // Notification created for Round 2
    const notif = mockDb.notifications.find(n => n.title.includes("Round 2"));
    assert.ok(notif, "Notification for Round 2 must exist");
    assert.match(notif.message, /Round 2/);
  });

  // Test 3: Third round increments round count to 3
  await test("3. Third round increments round count to Round 3", async () => {
    const round1 = mockDb.orders[0];

    const res3 = mockPlaceTableRound({
      p_table_number: 4,
      p_items: [
        { menu_item_id: 104, item_name: "Mineral Water", quantity: 2, unit_price: 20, line_total: 40 }
      ]
    });

    assert.equal(res3.round_number, 3);
    assert.equal(res3.is_subsequent_round, true);
    assert.equal(res3.parent_order_id, round1.id);
    assert.equal(res3.session_id, round1.id);
    assert.equal(res3.order_number, round1.order_number);
  });

  // Test 4: New order after a ticket is closed starts a brand new session (Round 1)
  await test("4. New order after ticket closure starts a brand new session (Round 1)", async () => {
    // Settle / close previous session for Table 4
    for (const o of mockDb.orders) {
      if (o.table_number === 4) {
        o.ticket_status = "CLOSED";
        o.payment_status = "paid";
        o.status = "delivered";
      }
    }

    // New diner arrives at Table 4
    const newSession = mockPlaceTableRound({
      p_table_number: 4,
      p_customer_name: "New Guest",
      p_items: [
        { menu_item_id: 105, item_name: "Mutton Biryani", quantity: 1, unit_price: 280, line_total: 280 }
      ]
    });

    assert.equal(newSession.round_number, 1);
    assert.equal(newSession.is_subsequent_round, false);
    assert.equal(newSession.parent_order_id, null);
    assert.equal(newSession.session_id, newSession.id);
    assert.notEqual(newSession.order_number, mockDb.orders[0].order_number, "Must get fresh order_number");
  });

  // Test 5: Order after ticket cancellation starts a new session (Round 1)
  await test("5. Order after ticket cancellation starts a brand new session (Round 1)", async () => {
    // Table 7 has an order that was cancelled
    const cancelledOrder = {
      id: crypto.randomUUID(),
      order_number: 1050,
      customer_name: "Cancelled Guest",
      order_type: "table",
      table_number: 7,
      table_zone: "indoor",
      total_amount: 300,
      status: "cancelled",
      payment_status: "unpaid",
      ticket_status: "OPEN",
      notes: "[ROUND: 1] [TABLE: 7]",
      created_at: new Date().toISOString()
    };
    mockDb.orders.push(cancelledOrder);

    // New order at Table 7
    const freshOrder = mockPlaceTableRound({
      p_table_number: 7,
      p_customer_name: "Next Guest",
      p_items: [
        { menu_item_id: 106, item_name: "Chicken Roll", quantity: 2, unit_price: 90, line_total: 180 }
      ]
    });

    assert.equal(freshOrder.round_number, 1);
    assert.equal(freshOrder.is_subsequent_round, false);
    assert.equal(freshOrder.parent_order_id, null);
  });

  // Test 6: Concurrent round submissions serialized by table advisory lock
  await test("6. Concurrent round submissions are serialized without conflicting sessions", async () => {
    // Reset Table 3
    mockDb.orders = mockDb.orders.filter(o => o.table_number !== 3);

    // Simulate two concurrent requests arriving for Table 3
    const req1 = async () => {
      const release = await simulateTableAdvisoryLock(3);
      try {
        await new Promise(r => setTimeout(r, 20)); // simulated DB latency
        return mockPlaceTableRound({
          p_table_number: 3,
          p_customer_name: "Guest A",
          p_items: [{ item_name: "Biryani", quantity: 1, line_total: 180 }]
        });
      } finally {
        release();
      }
    };

    const req2 = async () => {
      const release = await simulateTableAdvisoryLock(3);
      try {
        await new Promise(r => setTimeout(r, 10));
        return mockPlaceTableRound({
          p_table_number: 3,
          p_customer_name: "Guest B",
          p_items: [{ item_name: "Kebab", quantity: 1, line_total: 150 }]
        });
      } finally {
        release();
      }
    };

    const [resA, resB] = await Promise.all([req1(), req2()]);

    // One must be Round 1 and the other Round 2, both bound to the same session!
    const round1Result = resA.round_number === 1 ? resA : resB;
    const round2Result = resA.round_number === 2 ? resA : resB;

    assert.equal(round1Result.round_number, 1);
    assert.equal(round2Result.round_number, 2);
    assert.equal(round2Result.session_id, round1Result.session_id);
    assert.equal(round2Result.parent_order_id, round1Result.id);
    assert.equal(round2Result.order_number, round1Result.order_number);
  });

  // Test 7: Duplicate network retry with same idempotency_key returns idempotent replay
  await test("7. Duplicate network retry returns idempotent replay without creating duplicates", async () => {
    const key = `idemp_retry_${Date.now()}`;
    const initialOrdersCount = mockDb.orders.length;
    const initialItemsCount = mockDb.order_items.length;

    // First attempt
    const res1 = mockPlaceTableRound({
      p_table_number: 6,
      p_customer_name: "Same Guest",
      p_items: [{ item_name: "Salad", quantity: 1, line_total: 50 }],
      p_idempotency_key: key
    });
    assert.equal(res1.idempotent_replay, false);

    // Network retry attempt with same key
    const res2 = mockPlaceTableRound({
      p_table_number: 6,
      p_customer_name: "Same Guest",
      p_items: [{ item_name: "Salad", quantity: 1, line_total: 50 }],
      p_idempotency_key: key
    });

    assert.equal(res2.idempotent_replay, true);
    assert.equal(res2.id, res1.id);
    assert.equal(res2.order_number, res1.order_number);
    assert.equal(res2.total_amount, res1.total_amount);

    // Ensure no extra records were inserted
    assert.equal(mockDb.orders.length, initialOrdersCount + 1);
    assert.equal(mockDb.order_items.length, initialItemsCount + 1);
  });

  // Test 8: "Call Waiter" service signal binds to active session
  await test("8. Call Waiter links to active session and notifies staff", async () => {
    // Active session exists at Table 4 (from Test 4)
    const activeOrder = mockDb.orders.find(o => o.table_number === 4 && o.ticket_status === "OPEN" && o.status !== "cancelled");
    assert.ok(activeOrder, "Active order must exist at Table 4");

    const res = mockRequestTableService({
      p_table_number: 4,
      p_service_type: "call_waiter",
      p_notes: "Need extra napkins"
    });

    assert.equal(res.success, true);
    assert.equal(res.has_active_session, true);
    assert.equal(res.order_id, activeOrder.id);
    assert.equal(res.session_id, activeOrder.id);

    const notif = mockDb.notifications.find(n => n.id === res.notification_id);
    assert.ok(notif);
    assert.match(notif.title, /Table 4 - Waiter Called/);
    assert.match(notif.message, /Need extra napkins/);
    assert.equal(notif.order_id, activeOrder.id);
  });

  // Test 9: "Request Bill" service signal includes bill amount and links to active session
  await test("9. Request Bill links to active session and reports order total", async () => {
    // Clear notifications cooldown for test
    mockDb.notifications = [];

    const activeOrder = mockDb.orders.find(o => o.table_number === 4 && o.ticket_status === "OPEN" && o.status !== "cancelled");

    const res = mockRequestTableService({
      p_table_number: 4,
      p_service_type: "request_bill"
    });

    assert.equal(res.success, true);
    assert.equal(res.service_type, "request_bill");
    assert.equal(res.has_active_session, true);
    assert.equal(res.order_id, activeOrder.id);

    const notif = mockDb.notifications.find(n => n.id === res.notification_id);
    assert.match(notif.title, /Table 4 - Bill Requested/);
    assert.match(notif.message, new RegExp(`₹${activeOrder.total_amount}`));
  });

  // Test 10: Call Waiter on empty table works safely with order_id = null
  await test("10. Call Waiter on empty table operates safely with order_id = null", async () => {
    mockDb.notifications = [];

    const res = mockRequestTableService({
      p_table_number: 12, // Table 12 has no order
      p_service_type: "call_waiter"
    });

    assert.equal(res.success, true);
    assert.equal(res.has_active_session, false);
    assert.equal(res.order_id, null);
    assert.equal(res.table_zone, "Outdoor"); // Table 12 is Outdoor

    const notif = mockDb.notifications.find(n => n.id === res.notification_id);
    assert.match(notif.title, /Table 12 - Waiter Called/);
    assert.match(notif.message, /no active food order/);
    assert.equal(notif.order_id, null);
  });

  // Test 11: 60-second anti-spam deduplication rate-limiting for service requests
  await test("11. 60-second deduplication prevents flooding notifications", async () => {
    // First call already sent in Test 10 for Table 12
    const res2 = mockRequestTableService({
      p_table_number: 12,
      p_service_type: "call_waiter"
    });

    assert.equal(res2.success, true);
    assert.equal(res2.already_notified, true);
    assert.match(res2.message, /Staff has already been notified/);
  });

  // Test 12: Zone preservation and validation bounds (Tables 1-19)
  await test("12. Zone preservation and validation bounds (Tables 1-19)", async () => {
    // Indoor Table (1-9)
    const indoorRes = mockPlaceTableRound({
      p_table_number: 9,
      p_items: [{ item_name: "Tea", quantity: 1, line_total: 20 }]
    });
    assert.equal(indoorRes.table_zone, "indoor");

    // Outdoor Table (10-19)
    const outdoorRes = mockPlaceTableRound({
      p_table_number: 15,
      p_items: [{ item_name: "Coffee", quantity: 1, line_total: 30 }]
    });
    assert.equal(outdoorRes.table_zone, "outdoor");

    // Invalid table number < 1
    assert.throws(() => {
      mockPlaceTableRound({ p_table_number: 0, p_items: [{ item_name: "Tea", line_total: 20 }] });
    }, /Invalid table number/);

    // Invalid table number > 19
    assert.throws(() => {
      mockPlaceTableRound({ p_table_number: 20, p_items: [{ item_name: "Tea", line_total: 20 }] });
    }, /Invalid table number/);

    // Empty items
    assert.throws(() => {
      mockPlaceTableRound({ p_table_number: 5, p_items: [] });
    }, /Order must have at least one item/);
  });

  // Test 13: Database API authorization allowlist permits request_table_service and place_table_round
  await test("13. /api/db allows place_table_round and request_table_service for public callers", async () => {
    // Test public call to request_table_service through /api/db
    mockDb.notifications = [];
    const { req, res, resData } = createMockReqRes({
      method: "POST",
      url: "/api/db",
      body: {
        action: "rpc",
        rpc: "request_table_service",
        params: {
          p_table_number: 2,
          p_service_type: "call_waiter"
        }
      }
    });

    await dbHandler(req, res);
    assert.equal(resData.statusCode, 200, `Expected 200, got ${resData.statusCode}: ${JSON.stringify(resData.body)}`);
    assert.equal(resData.body.data.success, true);
    assert.equal(resData.body.data.service_type, "call_waiter");
  });

  // Test 14: /api/db blocks unpermitted sensitive RPCs from unauthenticated callers
  await test("14. /api/db blocks sensitive RPCs from unauthorized callers", async () => {
    const { req, res, resData } = createMockReqRes({
      method: "POST",
      url: "/api/db",
      body: {
        action: "rpc",
        rpc: "record_stock_in",
        params: { p_item_id: "fake", p_qty: 10 }
      }
    });

    await dbHandler(req, res);
    assert.equal(resData.statusCode, 401, "Expected 401 Unauthorized for sensitive RPC");
    assert.match(resData.body.error.message, /Authentication required/);
  });

  console.log("\n---------------------------------------------------------");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("---------------------------------------------------------\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
