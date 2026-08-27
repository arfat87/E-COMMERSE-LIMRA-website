import dotenv from "dotenv";
dotenv.config();
import { getDb } from "../api/lib/mongodb.js";

const requestedTables = [
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

const INSFORGE_URL = process.env.VITE_INSFORGE_URL || process.env.API_BASE_URL || "https://vb9ucr22.us-east.insforge.app";
const API_KEY = process.env.API_KEY || process.env.INSFORGE_ADMIN_KEY || "ik_799af068e8f4fb05944d04497229fe7d";

async function fetchFromInsforge(table) {
  try {
    const res = await fetch(INSFORGE_URL + "/api/database/advance/rawsql", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ query: "SELECT * FROM public." + table + " LIMIT 5000;" })
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.rows || json.data || (Array.isArray(json) ? json : []);
  } catch (e) {
    return [];
  }
}

async function auditAndSync() {
  const db = await getDb();
  console.log("=== Comprehensive Database Audit & Sync to MongoDB Atlas ===\n");
  
  const report = [];

  for (const table of requestedTables) {
    // 1. Fetch from InsForge
    const insRows = await fetchFromInsforge(table);
    const col = db.collection(table);

    // 2. If InsForge has data, upsert into MongoDB Atlas
    if (insRows && insRows.length > 0) {
      const ops = insRows.map(row => {
        const filter = row.id ? { id: row.id } : (row.utr ? { utr: row.utr } : (row.order_number ? { order_number: row.order_number } : (row.code ? { code: row.code } : { _insforge_id: row.id || JSON.stringify(row) })));
        return {
          updateOne: {
            filter: filter,
            update: { $set: row },
            upsert: true
          }
        };
      });
      await col.bulkWrite(ops);
    } else {
      // Ensure collection exists in MongoDB
      try {
        await db.createCollection(table);
      } catch (e) {}
    }

    // 3. Count in MongoDB Atlas
    const mongoCount = await col.countDocuments();
    report.push({
      table,
      insforgeCount: insRows.length,
      mongoCount: mongoCount,
      status: mongoCount >= insRows.length ? "SYNCED" : "MISMATCH"
    });
  }

  console.log("-------------------------------------------------------------------------");
  console.log("| Table / Collection Name    | InsForge Rows | MongoDB Atlas Docs | Status  |");
  console.log("-------------------------------------------------------------------------");
  for (const r of report) {
    console.log(
      "| " + r.table.padEnd(26) +
      " | " + String(r.insforgeCount).padStart(13) +
      " | " + String(r.mongoCount).padStart(18) +
      " | " + r.status.padEnd(7) + " |"
    );
  }
  console.log("-------------------------------------------------------------------------");
  process.exit(0);
}

auditAndSync().catch(console.error);
