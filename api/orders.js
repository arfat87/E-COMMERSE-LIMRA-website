import { supabase } from "./lib/supabase.js";
import crypto from "crypto";

function generateOrderNumber() {
  return Math.floor(1000 + Math.random() * 9000);
}

function sanitizeOrderStatus(status) {
  const s = String(status || "pending").toLowerCase().trim();
  const valid = ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled", "hold"];
  if (valid.includes(s)) return s;
  if (s === "completed" || s === "closed" || s === "paid") return "delivered";
  if (s === "accepted") return "confirmed";
  return "pending";
}

function sanitizePaymentStatus(status) {
  const s = String(status || "unpaid").toLowerCase().trim();
  if (s === "paid" || s === "success" || s === "completed") return "paid";
  return "unpaid";
}

/**
 * Deduct inventory items in Supabase stock_items
 */
async function processOrderInventoryDeduction(order) {
  if (!order || !order.items || !Array.isArray(order.items) || order.items.length === 0) return;

  try {
    // Idempotency: prevent deducting inventory multiple times for the same order
    const orderNum = order.order_number;
    if (orderNum) {
      const { data: existingLogs } = await supabase
        .from("stock_logs")
        .select("id")
        .eq("action", "ORDER_DEDUCT")
        .ilike("details", `%Order #${orderNum}%`)
        .limit(1);

      if (existingLogs && existingLogs.length > 0) {
        return;
      }
    }

    for (const item of order.items) {
      const qty = Number(item.quantity || item.qty) || 1;
      const itemName = String(item.name || item.item_name || "").trim();

      const { data: stockList } = await supabase
        .from("stock_items")
        .select("*")
        .ilike("name", itemName)
        .limit(1);

      if (stockList && stockList.length > 0) {
        const stk = stockList[0];
        const newQty = Math.max(0, (Number(stk.qty) || 0) - qty);

        await supabase
          .from("stock_items")
          .update({ qty: newQty, updated_at: new Date().toISOString() })
          .eq("id", stk.id);

        await supabase.from("stock_logs").insert([
          {
            id: crypto.randomUUID(),
            action: "ORDER_DEDUCT",
            details: `${stk.name} deducted ${qty} ${stk.unit || "pcs"} for Order #${order.order_number || ""}`,
            created_at: new Date().toISOString()
          }
        ]);
      }
    }
  } catch (err) {
    console.warn("[Inventory Decrement Notice]:", err.message);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // 1. POST: Create Order
    if (req.method === "POST") {
      const {
        customerName,
        customerPhone,
        items,
        notes = "",
        latitude = null,
        longitude = null,
        landmark = null,
        deliveryNotes = null,
        orderType = "delivery",
        tableNumber = null,
        tableZone = null,
        paymentMethod = "cod",
        paymentStatus = "unpaid",
        txnRef = null,
        roundNumber = 1
      } = req.body || {};

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Order must contain at least one item." });
      }

      if (!customerName || !customerPhone) {
        return res.status(400).json({ error: "Customer name and phone are required." });
      }

      const orderUuid = crypto.randomUUID();
      const orderNumber = generateOrderNumber();
      const numTable = tableNumber ? parseInt(tableNumber, 10) : null;
      const cleanZone = tableZone || (tableNumber ? "indoor" : null);
      const cleanType = orderType || (tableNumber ? "table" : "delivery");
      const cleanPayStatus = sanitizePaymentStatus(paymentStatus);

      let computedRound = 1;
      let isSubsequentRound = false;
      let activeParentOrder = null;

      if (numTable) {
        try {
          // 1. Query for an active ticket at this table
          let activeTickets = null;
          try {
            const res = await supabase
              .from("orders")
              .select("id, order_number, notes")
              .eq("table_number", numTable)
              .eq("order_type", "table")
              .in("ticket_status", ["OPEN", "HOLD"])
              .gte("created_at", new Date(Date.now() - 12 * 3600 * 1000).toISOString())
              .order("created_at", { ascending: true })
              .limit(1);
            if (!res.error && res.data) activeTickets = res.data;
          } catch (e) {}

          if (!activeTickets || activeTickets.length === 0) {
            // Fallback in case ticket_status column does not exist yet
            const res = await supabase
              .from("orders")
              .select("id, order_number, notes")
              .eq("table_number", numTable)
              .eq("order_type", "table")
              .in("status", ["pending", "confirmed", "preparing", "ready", "hold"])
              .gte("created_at", new Date(Date.now() - 12 * 3600 * 1000).toISOString())
              .order("created_at", { ascending: true })
              .limit(1);
            if (!res.error && res.data) activeTickets = res.data;
          }

          if (activeTickets && activeTickets.length > 0) {
            activeParentOrder = activeTickets[0];
            isSubsequentRound = true;

            // Calculate next round number from orders in this session
            const { data: sessionOrders } = await supabase
              .from("orders")
              .select("notes")
              .eq("table_number", numTable)
              .eq("order_type", "table")
              .gte("created_at", new Date(Date.now() - 12 * 3600 * 1000).toISOString());

            let maxRound = 1;
            if (sessionOrders) {
              for (const ord of sessionOrders) {
                const match = ord.notes && ord.notes.match(/\[ROUND:\s*(\d+)\]/i);
                if (match && parseInt(match[1], 10) > maxRound) {
                  maxRound = parseInt(match[1], 10);
                }
              }
            }
            computedRound = maxRound + 1;
          } else {
            computedRound = 1;
            isSubsequentRound = false;
          }
        } catch (e) {
          computedRound = 1;
        }
      }

      let rawNotes = notes ? notes.trim() : "";
      if (numTable) {
        rawNotes = rawNotes.replace(/\[ROUND:\s*\d+\]/gi, "").trim();
        if (isSubsequentRound && activeParentOrder) {
          rawNotes = `[ROUND: ${computedRound}] [PARENT_ORDER_ID: ${activeParentOrder.id}] [TABLE: ${numTable}] ${rawNotes}`.trim();
        } else {
          rawNotes = `[ROUND: 1] [TABLE: ${numTable}] ${rawNotes}`.trim();
        }
      }

      const assignedOrderNumber = (isSubsequentRound && activeParentOrder) ? activeParentOrder.order_number : orderNumber;

      const orderItems = items.map(function (item) {
        const qty = Math.max(1, Number(item.quantity || item.qty) || 1);
        const price = Number(item.price || item.unit_price) || 0;
        return {
          id: crypto.randomUUID(),
          order_id: orderUuid,
          menu_item_id: item.menu_item_id ? Number(item.menu_item_id) : (item.id ? Number(item.id) : null),
          item_name: String(item.name || item.item_name || "Item"),
          quantity: qty,
          unit_price: price,
          line_total: qty * price
        };
      });

      const subtotal = orderItems.reduce((acc, it) => acc + it.line_total, 0);

      // Insert Order with self-healing fallback for ticket_status
      const orderInsertPayload = {
        id: orderUuid,
        order_number: assignedOrderNumber,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        total_amount: subtotal,
        status: "pending",
        ticket_status: "OPEN",
        notes: rawNotes || null,
        order_type: cleanType,
        table_number: numTable,
        table_zone: cleanZone,
        payment_status: cleanPayStatus,
        payment_method: paymentMethod || "cash",
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null,
        landmark: landmark || null,
        delivery_notes: deliveryNotes || null,
        txn_ref: txnRef || null
      };

      let ordData = null;
      let ordErr = null;
      const initialInsert = await supabase.from("orders").insert([orderInsertPayload]).select();
      ordData = initialInsert.data;
      ordErr = initialInsert.error;

      // If database schema does not yet have ticket_status, strip and retry
      if (ordErr && ordErr.message && ordErr.message.includes("ticket_status")) {
        delete orderInsertPayload.ticket_status;
        const retryInsert = await supabase.from("orders").insert([orderInsertPayload]).select();
        ordData = retryInsert.data;
        ordErr = retryInsert.error;
      }

      if (ordErr) {
        throw new Error(ordErr.message);
      }

      // Insert Order Items
      if (orderItems.length > 0) {
        const { error: itemErr } = await supabase.from("order_items").insert(orderItems);
        if (itemErr) {
          console.warn("[Order Items Insert Notice]:", itemErr.message);
        }
      }

      // Insert Staff Notification
      try {
        const notifTitle = tableNumber
          ? isSubsequentRound
            ? `🍽️ Table ${tableNumber} - Round ${computedRound}`
            : `🍽️ Table ${tableNumber} - New Order`
          : `🛒 New Order #${assignedOrderNumber}`;
        const notifMsg = tableNumber
          ? isSubsequentRound
            ? `Table ${tableNumber} placed Round ${computedRound} (${orderItems.length} items · ₹${subtotal})`
            : `New Dine-In Order received for ₹${subtotal} at Table ${tableNumber}`
          : `New Order #${assignedOrderNumber} from ${customerName}`;

        await supabase.from("notifications").insert([
          {
            id: crypto.randomUUID(),
            type: "order",
            title: notifTitle,
            message: notifMsg,
            description: notifMsg,
            is_read: false,
            customer_phone: customerPhone.trim(),
            order_id: orderUuid
          }
        ]);
      } catch (e) {}

      return res.status(201).json({
        success: true,
        data: {
          id: orderUuid,
          order_number: orderNumber,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          order_type: orderType,
          table_number: tableNumber,
          round_number: computedRound,
          is_subsequent_round: computedRound > 1,
          total_amount: subtotal,
          items: orderItems,
          status: "pending",
          payment_status: paymentStatus
        }
      });
    }

    // 2. GET: Retrieve Orders
    if (req.method === "GET") {
      const { status, orderType, tableNumber, limit = 100 } = req.query || {};
      let query = supabase.from("orders").select("*, items:order_items(*)");

      if (status) query = query.eq("status", sanitizeOrderStatus(status));
      if (orderType) query = query.eq("order_type", orderType);
      if (tableNumber) query = query.eq("table_number", parseInt(tableNumber, 10));

      const maxLimit = Math.min(parseInt(limit, 10) || 100, 500);
      query = query.order("created_at", { ascending: false }).limit(maxLimit);

      const { data: orders, error: getErr } = await query;
      if (getErr) throw new Error(getErr.message);

      return res.status(200).json({
        success: true,
        count: orders ? orders.length : 0,
        data: orders || []
      });
    }

    // 3. PATCH / PUT: Update Order Status
    if (req.method === "PATCH" || req.method === "PUT") {
      const { id, order_number, status, payment_status, notes, ticket_status } = req.body || {};

      if (!id && !order_number) {
        return res.status(400).json({ error: "Order id or order_number is required for update." });
      }

      const updatePayload = { updated_at: new Date().toISOString() };
      if (status) updatePayload.status = sanitizeOrderStatus(status);
      if (payment_status) updatePayload.payment_status = sanitizePaymentStatus(payment_status);
      if (notes !== undefined) updatePayload.notes = notes;
      if (ticket_status) updatePayload.ticket_status = ticket_status;

      const runUpdate = (payload) => {
        let q = supabase.from("orders").update(payload);
        if (id) {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(id);
          if (isUuid) q = q.eq("id", id);
          else q = q.eq("order_number", Number(id) || 0);
        } else {
          q = q.eq("order_number", Number(order_number) || 0);
        }
        return q.select("*, items:order_items(*)");
      };

      let { data: updated, error: updErr } = await runUpdate(updatePayload);

      // Self-healing: if ticket_status column does not exist on orders table
      if (updErr && updErr.message && updErr.message.includes("ticket_status")) {
        delete updatePayload.ticket_status;
        const retry = await runUpdate(updatePayload);
        updated = retry.data;
        updErr = retry.error;
      }

      if (updErr || !updated || updated.length === 0) {
        return res.status(404).json({ error: "Order not found or update failed." });
      }

      const updatedOrder = updated[0];

      if (updatedOrder.status === "delivered" || updatedOrder.status === "confirmed") {
        await processOrderInventoryDeduction(updatedOrder);
      }

      return res.status(200).json({
        success: true,
        data: updatedOrder
      });
    }

    // 4. DELETE: Delete Order
    if (req.method === "DELETE") {
      const { id, order_number } = req.body || req.query || {};
      const targetId = id || req.query?.id;
      const targetNum = order_number || req.query?.order_number;

      if (!targetId && !targetNum) {
        return res.status(400).json({ error: "Order id or order_number is required for deletion." });
      }

      let q = supabase.from("orders").delete();
      if (targetId) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(targetId);
        if (isUuid) q = q.eq("id", targetId);
        else q = q.eq("order_number", Number(targetId) || 0);
      } else {
        q = q.eq("order_number", Number(targetNum) || 0);
      }

      const { data, error } = await q.select();
      if (error) throw error;

      return res.status(200).json({
        success: true,
        message: "Order deleted successfully",
        data: data ? data[0] : null
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[Supabase Orders API Error]:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error"
    });
  }
}
