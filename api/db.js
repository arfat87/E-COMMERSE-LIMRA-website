import { supabase } from "./lib/supabase.js";
import crypto from "crypto";

function toValidUuid(rawId) {
  if (!rawId) return crypto.randomUUID();
  const str = String(rawId).trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return str.toLowerCase();
  }
  const cleanHex = str.replace(/[^0-9a-fA-F]/g, "");
  if (cleanHex.length >= 24) {
    const padded = cleanHex.padEnd(32, "0").slice(0, 32);
    return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-4${padded.slice(13, 16)}-8${padded.slice(17, 20)}-${padded.slice(20, 32)}`.toLowerCase();
  }
  const hash = crypto.createHash("md5").update(str).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`.toLowerCase();
}

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

export default async function handler(req, res) {
  if (res.setHeader) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
    );
  }

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const parsedBody = await parseRequestBody(req);
    const { action, table, collection, filter, data, updates, options, rpc, params, auth } = parsedBody || {};
    const targetTable = table || collection || req.query?.table || req.query?.collection;

    // --- 1. RPC DISPATCHER ---
    if (action === "rpc" || rpc) {
      const rpcName = rpc || parsedBody.name;
      const rpcParams = params || parsedBody.params || {};

      const { data: rpcData, error: rpcError } = await supabase.rpc(rpcName, rpcParams);
      if (!rpcError) {
        return res.status(200).json({ data: rpcData, error: null });
      }

      // Fallback for custom RPC names if not yet in database
      if (rpcName === "update_order_payment_status") {
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

    // --- 2. AUTH & SECURITY DISPATCHER ---
    if (action === "auth" || auth) {
      const authType = (auth && auth.type) || parsedBody.authType;
      const cleanEmail = String(parsedBody.email || "").trim().toLowerCase();

      // 2.1 Check Admin
      if (authType === "checkAdmin") {
        const knownAdmins = [
          "arfatalis451@gmail.com",
          "admin@limra.com",
          "orkiya220@gmail.com",
          "arifsk78637@gmail.com"
        ];

        if (cleanEmail && knownAdmins.includes(cleanEmail)) {
          return res.status(200).json({ data: { email: cleanEmail, role: "admin" }, error: null });
        }

        if (cleanEmail) {
          const { data: adminList } = await supabase
            .from("admin_users")
            .select("*")
            .eq("email", cleanEmail)
            .limit(1);

          if (adminList && adminList.length > 0) {
            return res.status(200).json({
              data: { email: adminList[0].email, user_id: adminList[0].user_id, role: "admin" },
              error: null
            });
          }
        }

        return res.status(200).json({ data: null, error: null });
      }

      // 2.2 Sign In With Password
      if (authType === "signInWithPassword" || authType === "login") {
        const { password } = parsedBody;
        if (!cleanEmail || !password) {
          return res.status(400).json({ data: null, error: { message: "Email and password are required" } });
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

      // 2.3 Sign Out
      if (authType === "signOut" || authType === "logout") {
        try {
          await supabase.auth.signOut();
        } catch (e) {}
        return res.status(200).json({ data: { success: true }, error: null });
      }

      return res.status(200).json({ data: { ok: true }, error: null });
    }

    // --- 3. STANDARD CRUD DISPATCHER ---
    if (!targetTable) {
      return res.status(400).json({ error: "Table name is required" });
    }

    // 3.1 SELECT
    if (action === "select" || (!action && req.method === "GET")) {
      let query = supabase.from(targetTable).select((options && options.select) || "*");

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

    // 3.2 INSERT
    if (action === "insert" || (!action && req.method === "POST")) {
      const records = Array.isArray(data) ? data : [data || {}];
      if (records.length === 0) return res.status(200).json({ data: [], error: null });

      const { data: inserted, error: insertErr } = await supabase
        .from(targetTable)
        .insert(records)
        .select();

      if (insertErr) {
        return res.status(400).json({ data: null, error: { message: insertErr.message } });
      }
      return res.status(201).json({ data: inserted || [], error: null });
    }

    // 3.3 UPDATE
    if (action === "update" || (!action && (req.method === "PATCH" || req.method === "PUT"))) {
      if (!filter || typeof filter !== "object" || Object.keys(filter).length === 0) {
        return res.status(400).json({ data: null, error: { message: "Filter is required for update operations to prevent accidental mass updates" } });
      }
      const updateData = updates || data || {};
      let query = supabase.from(targetTable).update(updateData);

      for (const [key, val] of Object.entries(filter)) {
        query = query.eq(key, val);
      }

      const { data: updated, error: updateErr } = await query.select();
      if (updateErr) {
        return res.status(400).json({ data: null, error: { message: updateErr.message } });
      }
      return res.status(200).json({ data: updated || [], error: null });
    }

    // 3.4 DELETE
    if (action === "delete" || (!action && req.method === "DELETE")) {
      if (!filter || typeof filter !== "object" || Object.keys(filter).length === 0) {
        return res.status(400).json({ data: null, error: { message: "Filter is required for delete operations to prevent accidental mass deletion" } });
      }
      let query = supabase.from(targetTable).delete();

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
