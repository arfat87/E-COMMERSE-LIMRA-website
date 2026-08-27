import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import { getCollection } from "../api/lib/mongodb.js";

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const cols = [];
    let inQuotes = false;
    let current = "";
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        cols.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cols.push(current.trim());

    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] !== undefined ? cols[idx].replace(/^"|"$/g, "") : "";
    });
    rows.push(obj);
  }
  return rows;
}

async function seedStockHistory() {
  console.log("=== Seeding Stock In / Out / Logs to MongoDB Atlas (Bulk) ===");
  
  // 1. Stock IN
  const stockInCSV = fs.readFileSync("src/stock-manager/data/stock_in.csv", "utf8");
  const inRows = parseCSV(stockInCSV).map(r => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category,
    unit: r.unit || "pcs",
    qty: parseFloat(r.qty) || 0,
    cost_price: parseFloat(r.cost_price) || 0,
    total_cost: parseFloat(r.total_cost) || 0,
    supplier: r.supplier || "",
    invoice_no: r.invoice_no || "",
    date: r.date || new Date().toISOString(),
    notes: r.notes || "",
    created_at: r.created_at || r.date || new Date()
  }));

  const inCol = await getCollection("stock_in");
  if (inRows.length > 0) {
    const inOps = inRows.map(doc => ({ updateOne: { filter: { id: doc.id }, update: { $set: doc }, upsert: true } }));
    await inCol.bulkWrite(inOps);
  }
  console.log("• stock_in: " + inRows.length + " entries seeded");

  // 2. Stock OUT
  const stockOutCSV = fs.readFileSync("src/stock-manager/data/stock_out.csv", "utf8");
  const outRows = parseCSV(stockOutCSV).map(r => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category,
    unit: r.unit || "pcs",
    qty: parseFloat(r.qty) || 0,
    reason: r.reason || "Kitchen Usage",
    date: r.date || new Date().toISOString(),
    department: r.department || "Kitchen",
    notes: r.notes || "",
    created_at: r.created_at || r.date || new Date()
  }));

  const outCol = await getCollection("stock_out");
  if (outRows.length > 0) {
    const outOps = outRows.map(doc => ({ updateOne: { filter: { id: doc.id }, update: { $set: doc }, upsert: true } }));
    await outCol.bulkWrite(outOps);
  }
  console.log("• stock_out: " + outRows.length + " entries seeded");

  // 3. Stock Logs
  const stockLogsCSV = fs.readFileSync("src/stock-manager/data/stock_logs.csv", "utf8");
  const logRows = parseCSV(stockLogsCSV).map(r => ({
    id: r.id,
    type: r.type || "IN",
    sku: r.sku,
    name: r.name,
    qty: parseFloat(r.qty) || 0,
    unit: r.unit || "pcs",
    details: r.details || "",
    user: r.user || "Admin",
    date: r.date || new Date().toISOString(),
    created_at: r.created_at || r.date || new Date()
  }));

  const logsCol = await getCollection("stock_logs");
  if (logRows.length > 0) {
    const logOps = logRows.map(doc => ({ updateOne: { filter: { id: doc.id }, update: { $set: doc }, upsert: true } }));
    await logsCol.bulkWrite(logOps);
  }
  console.log("• stock_logs: " + logRows.length + " entries seeded");

  console.log("\n✅ All Stock In / Out / Logs history synced to MongoDB Atlas successfully!");
  process.exit(0);
}

seedStockHistory().catch(console.error);
