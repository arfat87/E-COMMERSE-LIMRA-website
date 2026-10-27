import { supabase } from "./lib/supabase.js";
import { authenticateUser } from "./lib/auth-middleware.js";
import { checkRateLimit } from "./lib/rate-limiter.js";
import crypto from "crypto";
import {
  calculateOrderBilling,
  parseNotesBillingMetadata,
  isValidPaymentTransition,
  isValidFulfillmentTransition,
  isValidTicketTransition,
  safeNum
} from "./lib/billing-engine.js";

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
  if (s === "refunded") return "refunded";
  if (s === "failed") return "failed";
  return "unpaid";
}

function isStaffRole(role) {
  if (!role) return false;
  const r = role.toLowerCase().trim();
  return ["owner", "manager", "cashier", "kitchen", "admin"].includes(r);
}

/**
 * Deduct inventory items in Supabase stock_items
 */
async function processOrderInventoryDeduction(order) {
  if (!order || !order.items || !Array.isArray(order.items) || order.items.length === 0) return;

  try {
    const orderUuid = order.id;
    const orderNum = order.order_number;

    // 1. Attempt atomic stored procedure (handles row locking FOR UPDATE and duplicate log check)
    if (orderUuid) {
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc("deduct_order_inventory_atomic", {
          p_order_id: orderUuid,
          p_order_number: Number(orderNum) || 0,
          p_items: order.items
        });
        if (!rpcErr && rpcRes && rpcRes.success) {
          return rpcRes;
        }
      } catch (rpcEx) {
        // Fallback below if RPC is missing
      }
    }

    // 2. Fallback: Idempotent stock deduction check against stock_logs
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
        .eq("name", itemName)
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
  try {
    const authState = await authenticateUser(req);
    const currentUser = authState.user;
    const userRole = authState.role || "anonymous";
    const isStaff = isStaffRole(userRole);

    // ─────────────────────────────────────────────────────────────
    // 1. POST: Create Order (Customer or Staff)
    // ─────────────────────────────────────────────────────────────
    if (req.method === "POST") {
      const rateCheck = checkRateLimit(req, { windowMs: 60000, maxRequests: 30, keyPrefix: "order-create" });
      if (!rateCheck.allowed) {
        return res.status(429).json({
          success: false,
          error: `Too many order attempts. Please wait ${rateCheck.resetInSeconds} seconds.`
        });
      }

      const idempotencyKey = (
        req.headers["x-idempotency-key"] ||
        req.body?.idempotency_key ||
        req.body?.idempotencyKey ||
        ""
      ).trim() || null;

      // Idempotency Replay Protection: If identical key is sent, return existing committed order
      if (idempotencyKey) {
        try {
          const { data: existingOrders } = await supabase
            .from("orders")
            .select("*, items:order_items(*)")
            .eq("idempotency_key", idempotencyKey)
            .limit(1);

          if (existingOrders && existingOrders.length > 0) {
            const existing = existingOrders[0];
            return res.status(200).json({
              success: true,
              idempotent_replay: true,
              data: {
                id: existing.id,
                order_number: existing.order_number,
                customer_name: existing.customer_name,
                customer_phone: existing.customer_phone,
                order_type: existing.order_type,
                table_number: existing.table_number,
                round_number: 1,
                total_amount: existing.total_amount,
                items: existing.items || [],
                status: existing.status,
                payment_status: existing.payment_status,
                payment_method: existing.payment_method,
                ticket_status: existing.ticket_status,
                txn_ref: existing.txn_ref || null,
                idempotency_key: existing.idempotency_key,
                created_at: existing.created_at
              }
            });
          }
        } catch (idempErr) {
          console.warn("[Idempotency Check Warning]:", idempErr.message);
        }
      }

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
        txnRef = null
      } = req.body || {};

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: "Order must contain at least one item." });
      }

      const numTable = tableNumber ? parseInt(tableNumber, 10) : null;
      const cleanType = orderType || (numTable ? "table" : "delivery");
      let finalCustomerName = (customerName || "").trim();
      let finalCustomerPhone = (customerPhone || "").trim();

      if (cleanType === "delivery") {
        if (!finalCustomerName || !finalCustomerPhone) {
          return res.status(400).json({ success: false, error: "Customer name and phone are required for delivery orders." });
        }
      } else {
        if (!finalCustomerName) {
          finalCustomerName = cleanType === "table" ? `Table ${numTable || "Dine-in"}` : "Walk-in Guest";
        }
        if (!finalCustomerPhone) {
          finalCustomerPhone = "9999999999";
        }
      }

      // 1. Server-authoritative price and availability validation
      const menuItemIds = items
        .map(it => it.menu_item_id ? Number(it.menu_item_id) : (it.id && !isNaN(Number(it.id)) && Number(it.id) < 9000 ? Number(it.id) : null))
        .filter(Boolean);

      const comboIds = items
        .map(it => {
          if (it.combo_id) return Number(it.combo_id);
          if (typeof it.id === 'string' && it.id.startsWith('combo-')) {
            const parsed = parseInt(it.id.replace('combo-', ''), 10);
            return !isNaN(parsed) ? parsed : null;
          }
          return null;
        })
        .filter(Boolean);

      const overridesMap = new Map();
      if (menuItemIds.length > 0) {
        try {
          const { data: dbOverrides } = await supabase
            .from("menu_overrides")
            .select("id, price, available")
            .in("id", menuItemIds);
          if (dbOverrides) {
            dbOverrides.forEach(ov => overridesMap.set(Number(ov.id), ov));
          }
        } catch (ovErr) {
          console.warn("[Menu Override Lookup Warning]:", ovErr.message);
        }
      }

      const combosMap = new Map();
      if (comboIds.length > 0) {
        try {
          const { data: dbCombos } = await supabase
            .from("combos")
            .select("id, price, available")
            .in("id", comboIds);
          if (dbCombos) {
            dbCombos.forEach(c => combosMap.set(Number(c.id), c));
          }
        } catch (cErr) {
          console.warn("[Combo Lookup Warning]:", cErr.message);
        }
      }

      // Calculate server-side total and validate all items
      const orderUuid = crypto.randomUUID();
      const orderNumber = generateOrderNumber();
      const cleanZone = tableZone || (numTable ? "indoor" : null);

      const orderItems = [];
      for (const item of items) {
        const qty = Math.max(1, parseInt(item.quantity || item.qty, 10) || 1);
        let price = Math.max(0, Number(item.price || item.unit_price) || 0);
        const mId = item.menu_item_id ? Number(item.menu_item_id) : (item.id && !isNaN(Number(item.id)) && Number(item.id) < 9000 ? Number(item.id) : null);
        const cId = item.combo_id ? Number(item.combo_id) : (typeof item.id === 'string' && item.id.startsWith('combo-') ? parseInt(item.id.replace('combo-', ''), 10) : null);
        const itemName = String(item.name || item.item_name || "Item").slice(0, 100);

        // Check menu item availability and authoritative price
        if (mId && overridesMap.has(mId)) {
          const ov = overridesMap.get(mId);
          if (ov.available === false) {
            return res.status(400).json({ success: false, error: `Item '${itemName}' is currently unavailable or sold out.` });
          }
          if (ov.price !== undefined && ov.price !== null) {
            price = Number(ov.price);
          }
        }

        // Check combo availability and authoritative price
        if (cId && combosMap.has(cId)) {
          const cb = combosMap.get(cId);
          if (cb.available === false) {
            return res.status(400).json({ success: false, error: `Combo deal '${itemName}' is currently unavailable.` });
          }
          if (cb.price !== undefined && cb.price !== null) {
            price = Number(cb.price);
          }
        }

        orderItems.push({
          id: crypto.randomUUID(),
          order_id: orderUuid,
          menu_item_id: mId,
          item_name: itemName,
          quantity: qty,
          unit_price: price,
          line_total: qty * price
        });
      }

      // Authoritative Billing & GST Tax Calculation
      const parsedMeta = parseNotesBillingMetadata(notes);
      let verifiedCoupon = null;
      const couponCode = (req.body?.coupon_code || req.body?.couponCode || parsedMeta.couponCode || "").trim().toUpperCase();
      if (couponCode) {
        try {
          const { data: cData } = await supabase
            .from("coupons")
            .select("*")
            .eq("code", couponCode)
            .eq("active", true)
            .maybeSingle();
          if (cData && (!cData.expiry_date || new Date(cData.expiry_date) > new Date())) {
            verifiedCoupon = cData;
          }
        } catch (cErr) {
          console.warn("[Coupon Lookup Warning]:", cErr.message);
        }
      }

      const reqDeliveryFee = cleanType === "delivery"
        ? safeNum(req.body?.delivery_fee ?? req.body?.deliveryFee ?? parsedMeta.deliveryFee, 0)
        : 0;

      const billing = calculateOrderBilling({
        items: orderItems,
        deliveryFee: reqDeliveryFee,
        coupon: verifiedCoupon,
        discountPct: verifiedCoupon ? verifiedCoupon.discount_pct : (isStaff ? parsedMeta.discountPct : 0),
        discountAmt: isStaff && !verifiedCoupon ? parsedMeta.discountAmt : 0,
        cgstRate: parsedMeta.cgstRate ?? 2.5,
        sgstRate: parsedMeta.sgstRate ?? 2.5,
        isInterstate: parsedMeta.isInterstate
      });

      const serverCalculatedSubtotal = billing.subtotal;
      const serverCalculatedGrandTotal = billing.grandTotal;

      // Secure Payment Status Enforcement:
      // Prevent untrusted customers from marking orders as "paid"
      let cleanPayStatus = "unpaid";
      if (isStaff) {
        // Staff members can specify payment status
        cleanPayStatus = sanitizePaymentStatus(paymentStatus);
      } else if (txnRef && String(txnRef).trim()) {
        // Check if transaction was verified through verified_payments table
        const cleanRef = String(txnRef).trim();
        const { data: verPayment } = await supabase
          .from("verified_payments")
          .select("*")
          .eq("utr", cleanRef)
          .eq("status", "success")
          .limit(1);

        if (verPayment && verPayment.length > 0 && (verPayment[0].amount >= serverCalculatedGrandTotal || verPayment[0].amount >= serverCalculatedSubtotal)) {
          // Replay protection: only permit if unclaimed or already associated with this order
          if (!verPayment[0].order_id || verPayment[0].order_id === orderUuid) {
            cleanPayStatus = "paid";
          } else {
            console.warn(`[Payment Replay Prevented]: Payment UTR ${cleanRef} was already claimed by order ${verPayment[0].order_id}`);
            cleanPayStatus = "unpaid";
          }
        } else {
          cleanPayStatus = "unpaid";
        }
      } else {
        cleanPayStatus = "unpaid";
      }

      const cleanPayMethod = paymentMethod ? String(paymentMethod).toLowerCase() : (cleanPayStatus === "paid" ? "online" : "cash");

      // Handle Dine-in Table Active Tickets
      let computedRound = 1;
      let isSubsequentRound = false;
      let activeParentOrder = null;

      if (numTable) {
        try {
          let activeTickets = null;
          try {
            const ticketRes = await supabase
              .from("orders")
              .select("id, order_number, notes")
              .eq("table_number", numTable)
              .eq("order_type", "table")
              .in("ticket_status", ["OPEN", "HOLD"])
              .gte("created_at", new Date(Date.now() - 12 * 3600 * 1000).toISOString())
              .order("created_at", { ascending: true })
              .limit(1);
            if (!ticketRes.error && ticketRes.data) activeTickets = ticketRes.data;
          } catch (e) {}

          if (!activeTickets || activeTickets.length === 0) {
            const fallbackRes = await supabase
              .from("orders")
              .select("id, order_number, notes")
              .eq("table_number", numTable)
              .eq("order_type", "table")
              .in("status", ["pending", "confirmed", "preparing", "ready", "hold"])
              .gte("created_at", new Date(Date.now() - 12 * 3600 * 1000).toISOString())
              .order("created_at", { ascending: true })
              .limit(1);
            if (!fallbackRes.error && fallbackRes.data) activeTickets = fallbackRes.data;
          }

          if (activeTickets && activeTickets.length > 0) {
            activeParentOrder = activeTickets[0];
            isSubsequentRound = true;

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

      const orderInsertPayload = {
        id: orderUuid,
        order_number: assignedOrderNumber,
        customer_name: finalCustomerName,
        customer_phone: finalCustomerPhone,
        total_amount: serverCalculatedGrandTotal,
        status: "pending",
        ticket_status: "OPEN",
        notes: rawNotes || null,
        order_type: cleanType,
        table_number: numTable,
        table_zone: cleanZone,
        payment_status: cleanPayStatus,
        payment_method: cleanPayMethod,
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null,
        landmark: landmark ? String(landmark).slice(0, 100) : null,
        delivery_notes: deliveryNotes ? String(deliveryNotes).slice(0, 200) : null,
        txn_ref: txnRef || null,
        user_id: currentUser ? currentUser.id : null,
        idempotency_key: idempotencyKey
      };

      let ordData = null;
      let ordErr = null;
      const initialInsert = await supabase.from("orders").insert([orderInsertPayload]).select();
      ordData = initialInsert.data;
      ordErr = initialInsert.error;

      if (ordErr && ordErr.message && (ordErr.message.includes("ticket_status") || ordErr.message.includes("idempotency_key"))) {
        if (ordErr.message.includes("ticket_status")) delete orderInsertPayload.ticket_status;
        if (ordErr.message.includes("idempotency_key")) delete orderInsertPayload.idempotency_key;
        const retryInsert = await supabase.from("orders").insert([orderInsertPayload]).select();
        ordData = retryInsert.data;
        ordErr = retryInsert.error;
      }

      if (ordErr) {
        throw new Error(ordErr.message);
      }

      // Atomic Line Item Insertion: If item insert fails, roll back order to prevent orphan records
      if (orderItems.length > 0) {
        const { error: itemErr } = await supabase.from("order_items").insert(orderItems);
        if (itemErr) {
          console.error("[Order Items Insert Failure - Atomic Rollback]:", itemErr.message);
          await supabase.from("orders").delete().eq("id", orderUuid);
          return res.status(500).json({
            success: false,
            error: `Failed to insert order items: ${itemErr.message}. Order creation aborted.`
          });
        }
      }

      // Atomically claim verified payment record and write audit log
      if (cleanPayStatus === "paid" && txnRef) {
        try {
          await supabase
            .from("verified_payments")
            .update({ order_id: orderUuid })
            .eq("utr", String(txnRef).trim())
            .is("order_id", null);

          await supabase.from("payment_history").insert([
            {
              order_id: orderUuid,
              previous_status: "unpaid",
              new_status: "paid",
              change_reason: `Order created with verified transaction reference (${txnRef})`,
              changed_by: currentUser ? currentUser.id : "system_order_creation",
              created_at: new Date().toISOString()
            }
          ]);
        } catch (claimErr) {
          console.warn("[Payment Claim Warning]:", claimErr.message);
        }
      }

      // Automatic staff notification
      try {
        const notifTitle = tableNumber
          ? isSubsequentRound
            ? `🍽️ Table ${tableNumber} - Round ${computedRound}`
            : `🍽️ Table ${tableNumber} - New Order`
          : `🛒 New Order #${assignedOrderNumber}`;
        const notifMsg = tableNumber
          ? isSubsequentRound
            ? `Table ${tableNumber} placed Round ${computedRound} (${orderItems.length} items · ₹${serverCalculatedSubtotal})`
            : `New Dine-In Order received for ₹${serverCalculatedSubtotal} at Table ${tableNumber}`
          : `New Order #${assignedOrderNumber} from ${finalCustomerName}`;

        await supabase.from("notifications").insert([
          {
            id: crypto.randomUUID(),
            type: "order",
            title: notifTitle,
            message: notifMsg,
            description: notifMsg,
            is_read: false,
            customer_phone: finalCustomerPhone,
            order_id: orderUuid
          }
        ]);
      } catch (e) {}

      return res.status(201).json({
        success: true,
        data: {
          id: orderUuid,
          order_number: assignedOrderNumber,
          customer_name: finalCustomerName,
          customer_phone: finalCustomerPhone,
          order_type: cleanType,
          table_number: numTable,
          round_number: computedRound,
          is_subsequent_round: computedRound > 1,
          total_amount: serverCalculatedSubtotal,
          items: orderItems,
          status: "pending",
          payment_status: cleanPayStatus,
          payment_method: cleanPayMethod,
          txn_ref: txnRef || null
        }
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. GET: Retrieve Orders (Staff or Customer Owner)
    // ─────────────────────────────────────────────────────────────
    if (req.method === "GET") {
      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized. Authentication required to retrieve orders."
        });
      }

      const {
        status,
        orderType,
        tableNumber,
        limit,
        pageSize,
        page,
        offset,
        startDate,
        endDate,
        from,
        to
      } = req.query || {};

      let query = supabase.from("orders").select("*, items:order_items(*)", { count: "exact" });

      // If customer, only permit viewing own orders
      if (!isStaff) {
        query = query.eq("user_id", currentUser.id);
      } else {
        if (status) {
          const s = String(status).toLowerCase().trim();
          if (s === "closed" || s === "settled") {
            query = query.or("status.in.(delivered,completed,closed,cancelled),payment_status.eq.paid");
          } else {
            query = query.eq("status", sanitizeOrderStatus(s));
          }
        }
        if (orderType) query = query.eq("order_type", orderType);
        if (tableNumber) query = query.eq("table_number", parseInt(tableNumber, 10));
      }

      // Date range filtering with timezone safety
      const startFilter = startDate || from;
      const endFilter = endDate || to;
      if (startFilter) query = query.gte("created_at", startFilter);
      if (endFilter) query = query.lte("created_at", endFilter);

      query = query.order("created_at", { ascending: false });

      // Pagination & offset resolution
      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const rawLimit = parseInt(pageSize || limit, 10);
      const resolvedSize = Math.min(Math.max(1, isNaN(rawLimit) ? 100 : rawLimit), 1000);
      const startOffset = offset !== undefined && !isNaN(parseInt(offset, 10))
        ? parseInt(offset, 10)
        : (parsedPage - 1) * resolvedSize;

      query = query.range(startOffset, startOffset + resolvedSize - 1);

      const { data: orders, error: getErr, count } = await query;
      if (getErr) throw new Error(getErr.message);

      return res.status(200).json({
        success: true,
        count: orders ? orders.length : 0,
        totalCount: typeof count === "number" ? count : (orders ? orders.length : 0),
        page: parsedPage,
        pageSize: resolvedSize,
        data: orders || []
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. PATCH / PUT: Update Order Status (Staff Only)
    // ─────────────────────────────────────────────────────────────
    if (req.method === "PATCH" || req.method === "PUT") {
      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized. Staff authentication required to update orders."
        });
      }

      if (!isStaff) {
        return res.status(403).json({
          success: false,
          error: `Forbidden. Role '${userRole}' is not authorized to modify orders.`
        });
      }

      const { id, order_number, status, payment_status, notes, ticket_status } = req.body || {};

      if (!id && !order_number) {
        return res.status(400).json({ success: false, error: "Order id or order_number is required for update." });
      }

      // Fetch current order state to enforce state transition validation and concurrency protection
      let checkQ = supabase.from("orders").select("id, order_number, payment_status, status, ticket_status, payment_method, notes");
      if (id) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(id);
        if (isUuid) checkQ = checkQ.eq("id", id);
        else checkQ = checkQ.eq("order_number", Number(id) || 0);
      } else {
        checkQ = checkQ.eq("order_number", Number(order_number) || 0);
      }
      let { data: currentOrders, error: checkErr } = await checkQ.limit(1);

      if (checkErr && (checkErr.message || "").includes("ticket_status")) {
        let legacyQ = supabase.from("orders").select("id, order_number, payment_status, status, payment_method, notes");
        if (id) {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(id);
          if (isUuid) legacyQ = legacyQ.eq("id", id);
          else legacyQ = legacyQ.eq("order_number", Number(id) || 0);
        } else {
          legacyQ = legacyQ.eq("order_number", Number(order_number) || 0);
        }
        const legacyRes = await legacyQ.limit(1);
        currentOrders = legacyRes.data;
      }

      const currentOrder = currentOrders && currentOrders.length > 0 ? currentOrders[0] : null;

      if (!currentOrder) {
        return res.status(404).json({ success: false, error: "Order not found." });
      }

      // Check for Idempotency Key
      const reqIdempotencyKey = (
        req.headers["x-idempotency-key"] ||
        req.body?.idempotency_key ||
        req.body?.idempotencyKey ||
        ""
      ).trim() || null;

      // Kitchen role enforcement: kitchen staff can only update preparation status
      if (userRole === "kitchen") {
        if (payment_status || ticket_status) {
          return res.status(403).json({
            success: false,
            error: "Forbidden. Kitchen staff cannot alter payment or ticket billing status."
          });
        }
        if (status && !["preparing", "ready", "delivered"].includes(sanitizeOrderStatus(status))) {
          return res.status(403).json({
            success: false,
            error: "Forbidden. Kitchen staff can only transition orders to preparing, ready, or delivered."
          });
        }
      }

      // Explicit Payment State Transition Enforcement:
      if (payment_status && userRole !== "kitchen") {
        const targetPayStatus = sanitizePaymentStatus(payment_status);
        const currPayStatus = currentOrder.payment_status || "unpaid";

        if (!isValidPaymentTransition(currPayStatus, targetPayStatus)) {
          return res.status(400).json({
            success: false,
            error: `Invalid payment state transition from '${currPayStatus}' to '${targetPayStatus}'. Settled 'paid' orders cannot be reverted to 'unpaid'. Use 'refunded' if reversing payment.`
          });
        }
      }

      // Explicit Fulfillment State Transition Enforcement:
      if (status) {
        const targetFulfillStatus = sanitizeOrderStatus(status);
        const currFulfillStatus = currentOrder.status || "pending";

        if (!isValidFulfillmentTransition(currFulfillStatus, targetFulfillStatus, userRole)) {
          return res.status(400).json({
            success: false,
            error: `Invalid fulfillment state transition from '${currFulfillStatus}' to '${targetFulfillStatus}'.`
          });
        }
      }

      // Explicit Ticket Lifecycle State Transition Enforcement:
      if (ticket_status && userRole !== "kitchen") {
        const targetTicketStatus = String(ticket_status).toUpperCase().trim();
        const currTicketStatus = String(currentOrder.ticket_status || "OPEN").toUpperCase().trim();

        if (!isValidTicketTransition(currTicketStatus, targetTicketStatus)) {
          return res.status(400).json({
            success: false,
            error: `Invalid ticket lifecycle state transition from '${currTicketStatus}' to '${targetTicketStatus}'.`
          });
        }
      }

      // Concurrency Control for Final Bill Settlement (Prevents two cashiers from settling the same order)
      const isSettling = (ticket_status === "CLOSED" || sanitizePaymentStatus(payment_status) === "paid") &&
                         (status === "delivered" || currentOrder.status === "delivered" || ticket_status === "CLOSED");

      if (isSettling) {
        if (currentOrder.ticket_status === "CLOSED" && currentOrder.payment_status === "paid") {
          // Idempotency check: if replaying with identical key, return existing settlement
          if (reqIdempotencyKey && currentOrder.idempotency_key === reqIdempotencyKey) {
            return res.status(200).json({
              success: true,
              idempotent_replay: true,
              message: "Order already settled",
              data: currentOrder
            });
          }
          return res.status(409).json({
            success: false,
            code: "ORDER_ALREADY_SETTLED",
            error: `Order #${currentOrder.order_number} has already been settled and closed by another cashier.`
          });
        }

        // Try atomic settle RPC with row-level locking (FOR UPDATE)
        try {
          const { data: settleRes, error: settleErr } = await supabase.rpc("settle_order_atomic", {
            p_order_id: currentOrder.id,
            p_payment_method: req.body.payment_method || currentOrder.payment_method || "cash",
            p_notes: notes || currentOrder.notes || null,
            p_idempotency_key: reqIdempotencyKey
          });

          if (!settleErr && settleRes && settleRes.success) {
            const { data: refreshed } = await supabase
              .from("orders")
              .select("*, items:order_items(*)")
              .eq("id", currentOrder.id)
              .limit(1);

            return res.status(200).json({
              success: true,
              data: refreshed && refreshed.length > 0 ? refreshed[0] : currentOrder,
              message: "Order settled and closed successfully"
            });
          }

          if (settleErr && (settleErr.message || "").includes("ORDER_ALREADY_SETTLED")) {
            return res.status(409).json({
              success: false,
              code: "ORDER_ALREADY_SETTLED",
              error: `Order #${currentOrder.order_number} has already been settled and closed by another cashier.`
            });
          }
        } catch (rpcEx) {
          console.warn("[settle_order_atomic RPC Notice]:", rpcEx.message);
        }
      }

      const updatePayload = { updated_at: new Date().toISOString() };
      if (status) updatePayload.status = sanitizeOrderStatus(status);
      if (payment_status && userRole !== "kitchen") updatePayload.payment_status = sanitizePaymentStatus(payment_status);
      if (req.body.payment_method && userRole !== "kitchen") {
        const pm = String(req.body.payment_method).toLowerCase().trim();
        if (["cash", "upi", "card", "pay_later", "mixed"].includes(pm)) {
          updatePayload.payment_method = pm;
        }
      }
      if (req.body.txn_ref) {
        updatePayload.txn_ref = String(req.body.txn_ref).trim();
      }
      if (notes !== undefined) updatePayload.notes = notes;
      if (ticket_status && userRole !== "kitchen") updatePayload.ticket_status = ticket_status;
      if (reqIdempotencyKey) updatePayload.idempotency_key = reqIdempotencyKey;

      const runUpdate = (payload) => {
        let q = supabase.from("orders").update(payload);
        if (id) {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(id);
          if (isUuid) q = q.eq("id", id);
          else q = q.eq("order_number", Number(id) || 0);
        } else {
          q = q.eq("order_number", Number(order_number) || 0);
        }
        if (isSettling) {
          // Atomic concurrency guard: do not overwrite if already closed
          q = q.neq("ticket_status", "CLOSED");
        }
        return q.select("*, items:order_items(*)");
      };

      let { data: updated, error: updErr } = await runUpdate(updatePayload);

      if (updErr && updErr.message && (updErr.message.includes("ticket_status") || updErr.message.includes("idempotency_key"))) {
        if (updErr.message.includes("ticket_status")) delete updatePayload.ticket_status;
        if (updErr.message.includes("idempotency_key")) delete updatePayload.idempotency_key;
        const retry = await runUpdate(updatePayload);
        updated = retry.data;
        updErr = retry.error;
      }

      if (updErr || !updated || updated.length === 0) {
        if (isSettling) {
          const { data: conflictCheck } = await checkQ.limit(1);
          if (conflictCheck && conflictCheck.length > 0 && conflictCheck[0].ticket_status === "CLOSED") {
            return res.status(409).json({
              success: false,
              code: "ORDER_ALREADY_SETTLED",
              error: `Order #${currentOrder.order_number} was just settled and closed by another cashier.`
            });
          }
        }
        return res.status(404).json({ success: false, error: "Order not found or update failed." });
      }

      const updatedOrder = updated[0];

      if (updatedOrder.status === "delivered" || updatedOrder.status === "confirmed") {
        await processOrderInventoryDeduction(updatedOrder);
      }

      // Enqueue external Google Sheets sync into Transactional Outbox (sync_queue)
      if (isSettling) {
        try {
          await supabase.from("sync_queue").insert([
            {
              entity_type: "google_sheet",
              entity_id: String(updatedOrder.id),
              payload: {
                order_id: updatedOrder.id,
                order_number: updatedOrder.order_number,
                total_amount: updatedOrder.total_amount,
                order_type: updatedOrder.order_type,
                payment_method: updatedOrder.payment_method,
                table_number: updatedOrder.table_number,
                customer_name: updatedOrder.customer_name,
                settled_at: new Date().toISOString()
              },
              status: "pending",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ]);
        } catch (queueErr) {
          console.warn("[Sync Queue Notice]:", queueErr.message);
        }
      }

      // Record payment status audit history
      if (updatePayload.payment_status && updatePayload.payment_status !== currentOrder.payment_status) {
        try {
          await supabase.from("payment_history").insert([
            {
              order_id: updatedOrder.id,
              previous_status: currentOrder.payment_status || "unpaid",
              new_status: updatePayload.payment_status,
              change_reason: `Staff update by ${userRole} (${currentUser?.email || currentUser?.id})`,
              changed_by: currentUser?.id || "staff_manual_update",
              created_at: new Date().toISOString()
            }
          ]);
        } catch (phErr) {
          console.warn("[Payment History Audit Warning]:", phErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        data: updatedOrder
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 4. DELETE: Delete Order (Manager or Owner Only)
    // ─────────────────────────────────────────────────────────────
    if (req.method === "DELETE") {
      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized. Staff credentials required to delete orders."
        });
      }

      if (!["owner", "manager", "admin"].includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: `Forbidden. Role '${userRole}' lacks permission to delete orders. Manager authorization required.`
        });
      }

      const bodyData = req.body || {};
      const queryData = req.query || {};
      const targetId = bodyData.id || queryData.id;
      const targetNum = bodyData.order_number || queryData.order_number;

      if (!targetId && !targetNum) {
        return res.status(400).json({ success: false, error: "Order id or order_number is required for deletion." });
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

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (error) {
    console.error("[Supabase Orders API Error]:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error"
    });
  }
}
