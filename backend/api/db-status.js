import { pingDatabase, queryInsforge, INSFORGE_URL } from "./lib/insforge.js";

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
    for (const t of TABLES) {
      try {
        const rows = await queryInsforge(`SELECT COUNT(*) as count FROM public.${t};`);
        tableCounts[t] = Number(rows[0]?.count || 0);
      } catch (e) {
        tableCounts[t] = 0;
      }
    }

    return res.status(200).json({
      status: "connected",
      database: "InsForge PostgreSQL (BaaS)",
      url: INSFORGE_URL,
      latencyMs: pingRes.latencyMs,
      serverTime: pingRes.serverTime,
      collections: tableCounts,
      tables: tableCounts,
      ping: pingRes
    });
  } catch (error) {
    console.error("InsForge Status Error:", error);
    return res.status(500).json({
      status: "error",
      error: error.message || "Failed to connect to InsForge BaaS"
    });
  }
}
