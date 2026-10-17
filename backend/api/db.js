import { supabase } from "./lib/supabase.js";
import { authenticateUser } from "./lib/auth-middleware.js";
import { checkRateLimit } from "./lib/rate-limiter.js";
import crypto from "crypto";

async function parseRequestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return {};
    }
  }
  return new Promise((resolve) => {
    let chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// ─────────────────────────────────────────────────────────────
// PERMISSIONS AND ALLOWLIST DEFINITIONS
// ─────────────────────────────────────────────────────────────

// RPCs permitted for public (unauthenticated / guest) callers
const PUBLIC_PERMITTED_RPCS = new Set([
  "place_order",
  "place_table_round",
  "place_booking",
  "request_table_service",
  "get_customer_orders",
  "get_customer_bookings",
  "get_customer_notifications",
  "get_customer_unread_count",
  "mark_notification_as_read",
  "mark_all_notifications_as_read"
]);

// RPCs requiring staff authorization with minimum required roles
const STAFF_RESTRICTED_RPCS = {
  record_stock_in: ["owner", "manager", "admin"],
  record_stock_out: ["owner", "manager", "cashier", "kitchen", "admin"],
  reverse_stock_entry: ["owner", "manager", "admin"],
  get_stock_daily_summary: ["owner", "manager", "cashier", "admin"],
  update_order_payment_status: ["owner", "manager", "cashier", "admin"]
};

// Tables accessible for public SELECT
const PUBLIC_READ_TABLES = new Set([
  "menu_overrides",
  "combos",
  "delivery_areas",
  "coupons",
  "reviews"
]);

// Tables that must NEVER be accessed or manipulated via generic db.js dispatcher
const FORBIDDEN_TABLES = new Set([
  "phone_verifications",
  "security_audit_logs",
  "verified_payments"
]);

function isStaffRole(role) {
  if (!role) return false;
  const r = role.toLowerCase().trim();
  return ["owner", "manager", "cashier", "kitchen", "admin"].includes(r);
}

function roleCanAccessRpc(role, rpcName) {
  if (!role) return false;
  const r = role.toLowerCase().trim();
  if (r === "owner") return true;

  const allowedRoles = STAFF_RESTRICTED_RPCS[rpcName];
  if (!allowedRoles) return false;

  if (r === "admin" || r === "manager") {
    return true;
  }
  return allowedRoles.includes(r);
}

export default async function handler(req, res) {
  try {
    // 1. Rate Limiting Check
    const rateCheck = checkRateLimit(req, { windowMs: 60000, maxRequests: 120, keyPrefix: "db-api" });
    if (!rateCheck.allowed) {
      return res.status(429).json({
        data: null,
        error: { message: `Rate limit exceeded. Try again in ${rateCheck.resetInSeconds} seconds.` }
      });
    }

    const parsedBody = await parseRequestBody(req);
    const { action, table, collection, filter, data, updates, options, rpc, params, auth } = parsedBody || {};
    const targetTable = table || collection || req.query?.table || req.query?.collection;

    // Resolve caller identity and role
    const authState = await authenticateUser(req);
    const currentUser = authState.user;
    const userRole = authState.role || "anonymous";

    // ─────────────────────────────────────────────────────────────
    // 2. RPC DISPATCHER
    // ─────────────────────────────────────────────────────────────
    if (action === "rpc" || rpc) {
      const rpcName = String(rpc || parsedBody.name || "").trim();
      const rpcParams = params || parsedBody.params || {};

      if (!rpcName) {
        return res.status(400).json({ data: null, error: { message: "RPC function name is required" } });
      }

      // Check if public RPC
      const isPublicRpc = PUBLIC_PERMITTED_RPCS.has(rpcName);

      if (!isPublicRpc) {
        // Must be authenticated staff member
        if (!currentUser) {
          return res.status(401).json({
            data: null,
            error: { message: `Unauthorized. Authentication required to execute RPC '${rpcName}'.` }
          });
        }

        if (!roleCanAccessRpc(userRole, rpcName)) {
          return res.status(403).json({
            data: null,
            error: { message: `Forbidden. Role '${userRole}' is not authorized to call RPC '${rpcName}'.` }
          });
        }
      }

      // Input validation for public customer lookups
      if (["get_customer_orders", "get_customer_bookings", "get_customer_notifications"].includes(rpcName)) {
        const phone = rpcParams.p_phone || rpcParams.phone;
        const cleanPhone = String(phone || "").replace(/\D/g, "");
        if (cleanPhone.length < 10) {
          return res.status(200).json({ data: [], error: null });
        }
      }

      // Execute RPC
      const { data: rpcData, error: rpcError } = await supabase.rpc(rpcName, rpcParams);
      if (!rpcError) {
        return res.status(200).json({ data: rpcData, error: null });
      }

      // Fallback for custom update_order_payment_status (Staff Only)
      if (rpcName === "update_order_payment_status" && isStaffRole(userRole)) {
        const orderId = rpcParams.p_order_id;
        const rawStatus = String(rpcParams.p_payment_status || "unpaid").toLowerCase();
        const status = rawStatus === "paid" || rawStatus === "success" ? "paid" : "unpaid";
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(orderId);

        let q = supabase.from("orders").update({ payment_status: status, updated_at: new Date().toISOString() });
        if (isUuid) q = q.eq("id", orderId);
        else q = q.eq("order_number", Number(orderId) || 0);

        const { data: updData, error: updErr } = await q.select();
        if (!updErr) return res.status(200).json({ data: true, error: null });
      }

      return res.status(400).json({ data: null, error: { message: rpcError.message } });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. AUTH & SECURITY DISPATCHER
    // ─────────────────────────────────────────────────────────────
    if (action === "auth" || auth) {
      const authType = (auth && auth.type) || parsedBody.authType;

      // 3.1 Check Admin: strictly authenticate via Bearer token
      if (authType === "checkAdmin") {
        if (!currentUser) {
          return res.status(401).json({
            data: null,
            error: { message: "Unauthorized. Valid administrator session token required." }
          });
        }

        if (isStaffRole(userRole)) {
          return res.status(200).json({
            data: {
              user_id: currentUser.id,
              email: currentUser.email,
              role: userRole
            },
            error: null
          });
        }

        return res.status(403).json({
          data: null,
          error: { message: "Forbidden. Account is not an authorized administrator." }
        });
      }

      // 3.2 Sign In With Password
      if (authType === "signInWithPassword" || authType === "login") {
        const cleanEmail = String(parsedBody.email || "").trim().toLowerCase();
        const { password } = parsedBody;

        if (!cleanEmail || !password) {
          return res.status(400).json({ data: null, error: { message: "Email and password are required" } });
        }

        const loginRate = checkRateLimit(req, { windowMs: 60000, maxRequests: 10, keyPrefix: "login-brute-guard" });
        if (!loginRate.allowed) {
          return res.status(429).json({
            data: null,
            error: { message: `Too many login attempts. Please wait ${loginRate.resetInSeconds} seconds.` }
          });
        }

        try {
          const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password
          });
          if (!authErr && authData?.user) {
            return res.status(200).json({ data: authData, error: null });
          }
          if (authErr) {
            return res.status(401).json({ data: null, error: { message: authErr.message || "Invalid credentials" } });
          }
        } catch (e) {
          return res.status(401).json({ data: null, error: { message: e.message || "Authentication failed" } });
        }

        return res.status(401).json({ data: null, error: { message: "Invalid email or password" } });
      }

      // 3.3 Sign Out
      if (authType === "signOut" || authType === "logout") {
        return res.status(200).json({ data: { success: true }, error: null });
      }

      return res.status(400).json({ data: null, error: { message: `Unsupported auth action: '${authType}'` } });
    }

    // ─────────────────────────────────────────────────────────────
    // 4. STANDARD CRUD DISPATCHER
    // ─────────────────────────────────────────────────────────────
    if (!targetTable) {
      return res.status(400).json({ error: "Table name is required" });
    }

    const cleanTable = String(targetTable).trim().toLowerCase();

    // 4.0 Completely blocked tables
    if (FORBIDDEN_TABLES.has(cleanTable)) {
      return res.status(403).json({
        data: null,
        error: { message: `Direct access to table '${cleanTable}' is strictly forbidden.` }
      });
    }

    // 4.1 Check Table Access Authorization
    const isStaff = isStaffRole(userRole);

    // If caller is NOT staff:
    if (!isStaff) {
      // Non-staff can only SELECT safe public catalog tables
      if (req.method !== "GET" && action !== "select") {
        // Exception: allow inserting reviews
        if (cleanTable === "reviews" && (action === "insert" || req.method === "POST")) {
          // Public review insertion handled below
        } else {
          return res.status(401).json({
            data: null,
            error: { message: `Unauthorized. Writing to table '${cleanTable}' requires staff authorization.` }
          });
        }
      } else {
        // Non-staff SELECT
        if (!PUBLIC_READ_TABLES.has(cleanTable)) {
          // Check if customer is selecting their own records
          if (cleanTable === "orders" && currentUser) {
            // Customer can only view own orders; enforced in filter
          } else if (cleanTable === "customer_profiles" && currentUser) {
            // Customer can only view own profile; enforced in filter
          } else {
            return res.status(401).json({
              data: null,
              error: { message: `Unauthorized. Reading from table '${cleanTable}' requires staff credentials.` }
            });
          }
        }
      }
    }

    // Staff role restrictions:
    // Kitchen staff can only read orders, order_items, stock_items and update order status
    if (userRole === "kitchen") {
      if (["delete", "insert"].includes(action) && cleanTable === "orders") {
        return res.status(403).json({
          data: null,
          error: { message: "Forbidden. Kitchen staff cannot create or delete orders." }
        });
      }
      if (["printer_settings", "admin_users"].includes(cleanTable)) {
        return res.status(403).json({
          data: null,
          error: { message: `Forbidden. Kitchen staff cannot access table '${cleanTable}'.` }
        });
      }
    }

    // Cashier role restrictions:
    if (userRole === "cashier") {
      if (action === "delete" && cleanTable === "orders") {
        return res.status(403).json({
          data: null,
          error: { message: "Forbidden. Cashiers cannot delete orders. Manager authorization required." }
        });
      }
      if (cleanTable === "admin_users") {
        return res.status(403).json({
          data: null,
          error: { message: "Forbidden. Cashiers cannot manage administrator users." }
        });
      }
    }

    // Only 'owner' can modify admin_users table
    if (cleanTable === "admin_users" && action !== "select") {
      if (userRole !== "owner") {
        return res.status(403).json({
          data: null,
          error: { message: "Forbidden. Only restaurant owners can modify administrative staff users." }
        });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 4.2 CRUD OPERATIONS
    // ─────────────────────────────────────────────────────────────

    // 4.2.1 SELECT
    if (action === "select" || (!action && req.method === "GET")) {
      let query = supabase.from(cleanTable).select((options && options.select) || "*");

      // Enforce customer ownership for non-staff
      if (!isStaff && currentUser) {
        if (cleanTable === "orders") {
          query = query.eq("user_id", currentUser.id);
        } else if (cleanTable === "customer_profiles") {
          query = query.eq("id", currentUser.id);
        }
      }

      if (filter && typeof filter === "object") {
        for (const [key, val] of Object.entries(filter)) {
          if (val === null) {
            query = query.is(key, null);
          } else {
            query = query.eq(key, val);
          }
        }
      }

      const limit = Math.min((options && options.limit) || 1000, 2000);
      query = query.limit(limit);

      if (options && options.sort) {
        const sortCol = Object.keys(options.sort)[0];
        const ascending = options.sort[sortCol] === 1;
        query = query.order(sortCol, { ascending });
      }

      const { data: rows, error: selectErr } = await query;
      if (selectErr) {
        return res.status(400).json({ data: null, error: { message: selectErr.message } });
      }
      return res.status(200).json({ data: rows || [], error: null });
    }

    // 4.2.2 INSERT
    if (action === "insert" || (!action && req.method === "POST")) {
      let records = Array.isArray(data) ? data : [data || {}];
      if (records.length === 0) return res.status(200).json({ data: [], error: null });

      // Sanitize review insertion
      if (cleanTable === "reviews" && !isStaff) {
        records = records.map((r) => ({
          customer_name: String(r.customer_name || "Guest").trim().slice(0, 50),
          customer_phone: String(r.customer_phone || "").replace(/\D/g, "").slice(0, 15),
          rating: Math.max(1, Math.min(5, parseInt(r.rating, 10) || 5)),
          comment: String(r.comment || "").trim().slice(0, 500),
          order_number: r.order_number ? String(r.order_number).slice(0, 20) : null,
          approved: false, // Reviews require staff approval before public display
          created_at: new Date().toISOString()
        }));
      }

      // Prevent mass assignment of privileged fields on orders if inserted through db.js
      if (cleanTable === "orders" && !["owner", "manager", "admin"].includes(userRole)) {
        records = records.map((r) => {
          const sanitized = { ...r };
          delete sanitized.id;
          if (sanitized.payment_status === "paid" && userRole !== "cashier") {
            sanitized.payment_status = "unpaid";
          }
          return sanitized;
        });
      }

      const { data: inserted, error: insertErr } = await supabase
        .from(cleanTable)
        .insert(records)
        .select();

      if (insertErr) {
        return res.status(400).json({ data: null, error: { message: insertErr.message } });
      }
      return res.status(201).json({ data: inserted || [], error: null });
    }

    // 4.2.3 UPDATE
    if (action === "update" || (!action && (req.method === "PATCH" || req.method === "PUT"))) {
      if (!filter || typeof filter !== "object" || Object.keys(filter).length === 0) {
        return res.status(400).json({
          data: null,
          error: { message: "Filter criteria required to prevent accidental mass updates." }
        });
      }

      const rawUpdate = updates || data || {};
      const safeUpdate = { ...rawUpdate };

      // Prevent mutating primary immutable fields
      delete safeUpdate.id;
      delete safeUpdate.created_at;

      // Role-specific field protection on orders
      if (cleanTable === "orders") {
        if (userRole === "kitchen") {
          // Kitchen can only update preparation status
          const allowedKitchenKeys = ["status", "updated_at"];
          for (const key of Object.keys(safeUpdate)) {
            if (!allowedKitchenKeys.includes(key)) {
              delete safeUpdate[key];
            }
          }
        }
      }

      let query = supabase.from(cleanTable).update({
        ...safeUpdate,
        updated_at: new Date().toISOString()
      });

      for (const [key, val] of Object.entries(filter)) {
        query = query.eq(key, val);
      }

      const { data: updated, error: updateErr } = await query.select();
      if (updateErr) {
        return res.status(400).json({ data: null, error: { message: updateErr.message } });
      }
      return res.status(200).json({ data: updated || [], error: null });
    }

    // 4.2.4 DELETE
    if (action === "delete" || (!action && req.method === "DELETE")) {
      if (!filter || typeof filter !== "object" || Object.keys(filter).length === 0) {
        return res.status(400).json({
          data: null,
          error: { message: "Specific filter criteria required to prevent accidental mass deletion." }
        });
      }

      // Restrict deletion of orders to owners and managers only
      if (cleanTable === "orders" && !["owner", "manager", "admin"].includes(userRole)) {
        return res.status(403).json({
          data: null,
          error: { message: "Forbidden. Order deletion requires owner or manager authorization." }
        });
      }

      let query = supabase.from(cleanTable).delete();

      for (const [key, val] of Object.entries(filter)) {
        query = query.eq(key, val);
      }

      const { data: deleted, error: deleteErr } = await query.select();
      if (deleteErr) {
        return res.status(400).json({ data: null, error: { message: deleteErr.message } });
      }
      return res.status(200).json({ data: { deletedCount: deleted ? deleted.length : 1 }, error: null });
    }

    return res.status(400).json({ error: "Unsupported action: " + action });
  } catch (error) {
    console.error("[Supabase API Dispatcher Error]:", error);
    return res.status(500).json({
      data: null,
      error: { message: error.message || "Internal server error" }
    });
  }
}
