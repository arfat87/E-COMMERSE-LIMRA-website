const INSFORGE_URL = process.env.VITE_INSFORGE_URL || process.env.API_BASE_URL || "https://vb9ucr22.us-east.insforge.app";
const API_KEY = process.env.INSFORGE_ADMIN_KEY || process.env.API_KEY || "ik_799af068e8f4fb05944d04497229fe7d";

const tables = [
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

async function queryInsforge(sql) {
  const res = await fetch(INSFORGE_URL + "/api/database/advance/rawsql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ query: sql })
  });
  const json = await res.json();
  return json.rows || [];
}

async function audit() {
  console.log("==================================================");
  console.log("📊 INSFORGE POSTGRESQL DATABASE AUDIT REPORT");
  console.log(`🔗 URL: ${INSFORGE_URL}`);
  console.log("==================================================\n");

  console.log("---------------------------------------------------------");
  console.log("| Table Name                  | Row Count | Status      |");
  console.log("---------------------------------------------------------");

  let totalRows = 0;
  for (const t of tables) {
    try {
      const rows = await queryInsforge(`SELECT COUNT(*) as count FROM public.${t};`);
      const count = Number(rows[0]?.count || 0);
      totalRows += count;
      console.log(`| ${t.padEnd(27)} | ${String(count).padStart(9)} | ✅ OK        |`);
    } catch (e) {
      console.log(`| ${t.padEnd(27)} |     ERROR | ❌ FAILED   |`);
    }
  }
  console.log("---------------------------------------------------------");
  console.log(`| TOTAL RESTAURANT RECORDS    | ${String(totalRows).padStart(9)} |             |`);
  console.log("---------------------------------------------------------\n");

  // Sample check on orders
  const sampleOrders = await queryInsforge("SELECT id, order_number, customer_name, total_amount, status FROM public.orders ORDER BY created_at DESC LIMIT 5;");
  console.log("Sample Active Orders in InsForge:");
  console.table(sampleOrders);

  // Sample check on stock items
  const sampleStock = await queryInsforge("SELECT id, name, category, qty, unit FROM public.stock_items ORDER BY id ASC LIMIT 5;");
  console.log("\nSample Stock Items in InsForge:");
  console.table(sampleStock);
}

audit().catch(console.error);
