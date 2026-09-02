import { pingDatabase, supabase, SUPABASE_URL } from "./lib/supabase.js";

const TABLES = [
  "admin_users",
  "bookings",
  "combos",
  "coupon_usage",
  "coupons",
  "customer_profiles",
  "delivery_areas",
  "menu_overrides",
  "notifications",
  "order_items",
  "orders",
  "payment_history",
  "phone_verifications",
  "printer_settings",
  "reviews",
  "security_audit_logs",
  "stock_in",
  "stock_in_entries",
  "stock_items",
  "stock_logs",
  "stock_out",
  "stock_out_entries",
  "verified_payments"
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const pingRes = await pingDatabase();

    const tableCounts = {};
    if (pingRes.status !== "pending_credentials") {
      const results = await Promise.allSettled(
        TABLES.map(async (t) => {
          const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
          return { table: t, count: error ? 0 : Number(count || 0) };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          tableCounts[r.value.table] = r.value.count;
        }
      }
    } else {
      for (const t of TABLES) {
        tableCounts[t] = 0;
      }
    }

    return res.status(200).json({
      status: pingRes.status || "connected",
      database: "Supabase PostgreSQL (BaaS)",
      url: SUPABASE_URL,
      latencyMs: pingRes.latencyMs || 0,
      serverTime: pingRes.serverTime || new Date().toISOString(),
      collections: tableCounts,
      tables: tableCounts,
      ping: pingRes
    });
  } catch (error) {
    console.error("[Supabase Status Error]:", error);
    return res.status(500).json({
      status: "error",
      error: error.message || "Failed to connect to Supabase BaaS"
    });
  }
}
