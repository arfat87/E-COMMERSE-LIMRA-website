import { queryInsforge, insforge } from "./lib/insforge.js";
import crypto from "crypto";

function sqlEscape(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  if (typeof val === "object") {
    if (val instanceof Date) return `'${val.toISOString()}'`;
    return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

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
 * Deduct inventory items in InsForge PostgreSQL stock_items
 */
async function processOrderInventoryDeduction(order) {
  if (!order || !order.items || !Array.isArray(order.items)) return;

  try {
    for (const item of order.items) {
      const qty = Number(item.quantity || item.qty) || 1;
      const itemName = String(item.name || item.item_name || "").trim();

      // Find stock item by name or id
      const stockItems = await queryInsforge(`
        SELECT * FROM public.stock_items 
        WHERE LOWER(name) = LOWER(${sqlEscape(itemName)}) 
           OR id = ${sqlEscape(String(item.id || item.menu_item_id || ""))}
        LIMIT 1;
      `);

      if (stockItems && stockItems.length > 0) {
        const stk = stockItems[0];
        const newQty = Math.max(0, (Number(stk.qty) || 0) - qty);

        await queryInsforge(`
          UPDATE public.stock_items 
          SET qty = ${newQty}, updated_at = NOW() 
          WHERE id = '${stk.id}';
        `);

        await queryInsforge(`
          INSERT INTO public.stock_logs (id, action, details, created_at)
          VALUES (
            '${crypto.randomUUID()}',
            'ORDER_DEDUCT',
            ${sqlEscape(`${stk.name} deducted ${qty} ${stk.unit || "pcs"} for Order #${order.order_number || ""}`)},
            NOW()
          );
        `);
      }
    }
  } catch (err) {
    console.warn("[InsForge Inventory Decrement Notice]:", err.message);
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
      const numTable = tableNumber ? parseInt(tableNumber, 10) : "NULL";
      const cleanZone = sqlEscape(tableZone || (tableNumber ? "indoor" : null));
      const cleanType = sqlEscape(orderType || (tableNumber ? "table" : "delivery"));
      const cName = sqlEscape(customerName.trim());
      const cPhone = sqlEscape(customerPhone.trim());
      const cleanPayStatus = sqlEscape(sanitizePaymentStatus(paymentStatus));
      const cleanTxnRef = sqlEscape(txnRef);

      // Compute Table Round number if this table already has active orders
      let computedRound = Number(roundNumber) || 1;
      if (tableNumber && numTable !== "NULL") {
        try {
          const existingTableOrders = await queryInsforge(`
            SELECT id FROM public.orders
            WHERE (order_type = 'table' OR table_number = ${numTable})
              AND table_number = ${numTable}
              AND created_at >= NOW() - INTERVAL '12 HOURS'
              AND status NOT IN ('cancelled')
            ORDER BY created_at ASC;
          `);
          if (existingTableOrders && existingTableOrders.length > 0) {
            computedRound = Math.max(computedRound, existingTableOrders.length + 1);
          }
        } catch (e) {}
      }

      let rawNotes = notes ? notes.trim() : "";
      if (tableNumber && numTable !== "NULL" && !/\[ROUND:\s*\d+\]/i.test(rawNotes)) {
        rawNotes = `[ROUND: ${computedRound}] ${rawNotes}`.trim();
      }
      const cleanNotes = sqlEscape(rawNotes);

      const orderItems = items.map(function(item) {
        const qty = Math.max(1, Number(item.quantity || item.qty) || 1);
        const price = Number(item.price || item.unit_price) || 0;
        return {
          id: crypto.randomUUID(),
          menu_item_id: item.menu_item_id ? Number(item.menu_item_id) : (item.id ? Number(item.id) : null),
          item_name: String(item.name || item.item_name || "Item"),
          quantity: qty,
          unit_price: price,
          line_total: qty * price
        };
      });

      const subtotal = orderItems.reduce((acc, it) => acc + it.line_total, 0);

      await queryInsforge(`
        INSERT INTO public.orders (
          id, order_number, customer_name, customer_phone, total_amount, status, notes,
          created_at, updated_at, order_type, table_number, table_zone, payment_status, txn_ref
        ) VALUES (
          '${orderUuid}', ${orderNumber}, ${cName}, ${cPhone}, ${subtotal}, 'pending', ${cleanNotes},
          NOW(), NOW(), ${cleanType}, ${numTable}, ${cleanZone}, ${cleanPayStatus}, ${cleanTxnRef}
        );
      `);

      if (orderItems.length > 0) {
        const valuesList = orderItems.map(it => {
          const mId = it.menu_item_id ? Number(it.menu_item_id) : "NULL";
          return `('${it.id}', '${orderUuid}', ${mId}, ${sqlEscape(it.item_name)}, ${it.quantity}, ${it.unit_price}, ${it.line_total}, NOW())`;
        }).join(",\n");

        await queryInsforge(`
          INSERT INTO public.order_items (id, order_id, menu_item_id, item_name, quantity, unit_price, line_total, created_at)
          VALUES ${valuesList};
        `);
      }

      // Notification
      try {
        const notifTitle = tableNumber
          ? (computedRound > 1 ? `🚨 Table ${tableNumber} - Round ${computedRound}!` : `🍽️ Table ${tableNumber} - New Order`)
          : `🛒 New Order #${orderNumber}`;
        const notifMsg = tableNumber
          ? `Table ${tableNumber} placed Round ${computedRound} (${orderItems.length} items · ₹${subtotal})`
          : `New Order #${orderNumber} from ${customerName}`;

        await queryInsforge(`
          INSERT INTO public.notifications (item_id, type, title, message, description, is_read, customer_phone, order_id, created_at)
          VALUES ('${crypto.randomUUID()}', 'order', ${sqlEscape(notifTitle)}, ${sqlEscape(notifMsg)}, ${sqlEscape(notifMsg)}, FALSE, ${cPhone}, '${orderUuid}', NOW());
        `);
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
      const whereClauses = [];

      if (status) whereClauses.push(`status = ${sqlEscape(sanitizeOrderStatus(status))}`);
      if (orderType) whereClauses.push(`order_type = ${sqlEscape(orderType)}`);
      if (tableNumber) whereClauses.push(`table_number = ${parseInt(tableNumber, 10)}`);

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
      const maxLimit = Math.min(parseInt(limit, 10) || 100, 500);

      const orders = await queryInsforge(`
        SELECT * FROM public.orders 
        ${whereSql} 
        ORDER BY created_at DESC 
        LIMIT ${maxLimit};
      `);

      if (orders.length > 0) {
        const orderIds = orders.map(o => `'${o.id}'`).join(", ");
        const items = await queryInsforge(`
          SELECT * FROM public.order_items 
          WHERE order_id IN (${orderIds}) 
          ORDER BY created_at ASC;
        `);

        const itemsByOrderId = {};
        for (const item of items) {
          if (!itemsByOrderId[item.order_id]) itemsByOrderId[item.order_id] = [];
          itemsByOrderId[item.order_id].push(item);
        }

        for (const ord of orders) {
          ord.items = itemsByOrderId[ord.id] || [];
        }
      }

      return res.status(200).json({
        success: true,
        count: orders.length,
        data: orders
      });
    }

    // 3. PATCH / PUT: Update Order Status
    if (req.method === "PATCH" || req.method === "PUT") {
      const { id, order_number, status, payment_status, notes } = req.body || {};

      if (!id && !order_number) {
        return res.status(400).json({ error: "Order id or order_number is required for update." });
      }

      const filterClause = id
        ? (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(id) ? `id = '${id}'` : `order_number = ${toValidInteger(id)}`)
        : `order_number = ${toValidInteger(order_number)}`;

      const setClauses = ["updated_at = NOW()"];
      if (status) setClauses.push(`status = ${sqlEscape(sanitizeOrderStatus(status))}`);
      if (payment_status) setClauses.push(`payment_status = ${sqlEscape(sanitizePaymentStatus(payment_status))}`);
      if (notes !== undefined) setClauses.push(`notes = ${sqlEscape(notes)}`);

      const updated = await queryInsforge(`
        UPDATE public.orders 
        SET ${setClauses.join(", ")} 
        WHERE ${filterClause} 
        RETURNING *;
      `);

      if (!updated || updated.length === 0) {
        return res.status(404).json({ error: "Order not found." });
      }

      const updatedOrder = updated[0];

      // If status is delivered / completed, check and deduct inventory
      if (updatedOrder.status === "delivered" || updatedOrder.status === "confirmed") {
        const items = await queryInsforge(`SELECT * FROM public.order_items WHERE order_id = '${updatedOrder.id}';`);
        updatedOrder.items = items;
        await processOrderInventoryDeduction(updatedOrder);
      }

      return res.status(200).json({
        success: true,
        data: updatedOrder
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("InsForge Orders API Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error"
    });
  }
}
