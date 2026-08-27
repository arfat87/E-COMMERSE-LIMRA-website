import dns from "dns";
try { dns.setServers(["8.8.8.8", "1.1.1.1"]); } catch (e) {}
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient, ServerApiVersion } from "mongodb";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const EXPORT_DIR = path.join(projectRoot, "data", "migration_exports");

if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://arfatalis451_db_user:QGLrLdwQK0j8h33K@limra.pp0vnqp.mongodb.net/limra_restaurant?retryWrites=true&w=majority&appName=limra";
const DB_NAME = process.env.MONGODB_DB_NAME || "limra_restaurant";

const COLLECTIONS = [
  "orders",
  "order_items",
  "stock_items",
  "stock_in",
  "stock_out",
  "stock_logs",
  "stock_in_entries",
  "stock_out_entries",
  "notifications",
  "bookings",
  "menu_overrides",
  "delivery_areas",
  "coupons",
  "coupon_usage",
  "combos",
  "printer_settings",
  "reviews",
  "customer_profiles",
  "phone_verifications",
  "verified_payments",
  "payment_history",
  "security_audit_logs",
  "admin_users"
];

function convertToCSV(items) {
  if (!items || items.length === 0) return "";
  const headerSet = new Set();
  items.forEach(it => {
    Object.keys(it).forEach(k => headerSet.add(k));
  });
  const headers = Array.from(headerSet);

  const csvRows = [];
  csvRows.push(headers.join(","));

  for (const row of items) {
    const values = headers.map(header => {
      let val = row[header];
      if (val === null || val === undefined) return '""';
      if (typeof val === "object") {
        val = JSON.stringify(val);
      }
      const escaped = String(val).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(","));
  }
  return csvRows.join("\n");
}

async function exportAll() {
  console.log("==================================================");
  console.log("📦 EXPORTING DATA FROM MONGODB ATLAS TO LOCAL ARCHIVE");
  console.log(`📁 Destination: ${EXPORT_DIR}`);
  console.log("==================================================\n");

  const client = new MongoClient(MONGO_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
  });

  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`✅ Connected to MongoDB Atlas database: ${DB_NAME}\n`);

  const summary = [];

  for (const colName of COLLECTIONS) {
    try {
      const col = db.collection(colName);
      const docs = await col.find({}).toArray();

      // 1. Save JSON dump
      const jsonPath = path.join(EXPORT_DIR, `${colName}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(docs, null, 2), "utf8");

      // 2. Save CSV dump (flattening ObjectIds and nested objects)
      const sanitized = docs.map(d => {
        const copy = { ...d };
        if (copy._id) copy._id = copy._id.toString();
        return copy;
      });
      const csvContent = convertToCSV(sanitized);
      const csvPath = path.join(EXPORT_DIR, `${colName}.csv`);
      fs.writeFileSync(csvPath, csvContent, "utf8");

      summary.push({ collection: colName, count: docs.length, jsonFile: `${colName}.json`, csvFile: `${colName}.csv` });
      console.log(`  ✓ ${colName.padEnd(25)} -> ${String(docs.length).padStart(4)} docs exported (JSON + CSV)`);
    } catch (err) {
      console.error(`  ✗ Error exporting ${colName}:`, err.message);
    }
  }

  // Save export manifest
  const manifest = {
    exported_at: new Date().toISOString(),
    source_database: DB_NAME,
    collections_summary: summary
  };
  fs.writeFileSync(path.join(EXPORT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  await client.close();
  console.log("\n==================================================");
  console.log("🎉 ALL MONGODB COLLECTIONS EXPORTED SUCCESSFULLY!");
  console.log("==================================================\n");
}

exportAll().catch(console.error);
