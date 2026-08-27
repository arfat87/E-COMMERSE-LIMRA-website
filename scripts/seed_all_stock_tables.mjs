import { createClient } from "@insforge/sdk";
import fs from "fs";
import path from "path";

const client = createClient({
  baseUrl: "https://vb9ucr22.us-east.insforge.app",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNzQ3MjZ9.CORVtgdxoKKq0AhdUN0RY8s1h3jHMUF3ZOB0CpmnoYk"
});

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Handle standard CSV line
    const cols = [];
    let inQuotes = false;
    let current = '';
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cols.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cols.push(current.trim());

    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] !== undefined ? cols[idx].replace(/^"|"$/g, '') : "";
    });
    rows.push(obj);
  }
  return rows;
}

// Let's seed stock_in, stock_out, stock_logs and stock_items
async function seedAll() {
  const stockInCSV = fs.readFileSync("src/stock-manager/data/stock_in.csv", "utf8");
  const stockOutCSV = fs.readFileSync("src/stock-manager/data/stock_out.csv", "utf8");
  const stockItemsCSV = fs.readFileSync("src/stock-manager/data/stock_items.csv", "utf8");
  const stockLogsCSV = fs.readFileSync("src/stock-manager/data/stock_logs.csv", "utf8");

  console.log("Seeding stock_items...");
  const items = parseCSV(stockItemsCSV).map(r => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category,
    unit: r.unit || "pcs",
    qty: parseFloat(r.qty) || 0,
    min_qty: parseFloat(r.min_qty) || 5,
    cost_price: parseFloat(r.cost_price) || 0,
    supplier: r.supplier || "",
    is_available: r.is_available === "true" || r.is_available === true,
    updated_at: r.updated_at || new Date().toISOString()
  }));

  for (let i = 0; i < items.length; i += 50) {
    const chunk = items.slice(i, i + 50);
    const { error } = await client.database.from("stock_items").upsert(chunk);
    if (error) console.error("Error upserting stock_items chunk:", error);
  }
  console.log(`Synced ${items.length} items to database.`);

  console.log("Seeding stock_in...");
  const inEntries = parseCSV(stockInCSV).map(r => ({
    id: r.id,
    date: r.date,
    item_id: r.item_id,
    item_sku: r.item_sku,
    item_name: r.item_name,
    qty: parseFloat(r.qty) || 0,
    unit: r.unit || "pcs",
    cost_price: parseFloat(r.cost_price) || 0,
    supplier: r.supplier || "",
    notes: r.notes || "",
    created_at: r.created_at || new Date().toISOString()
  }));

  for (let i = 0; i < inEntries.length; i += 50) {
    const chunk = inEntries.slice(i, i + 50);
    const { error } = await client.database.from("stock_in").upsert(chunk);
    if (error) console.error("Error upserting stock_in chunk:", error);
  }
  console.log(`Synced ${inEntries.length} IN records to database.`);

  console.log("Seeding stock_out...");
  const outEntries = parseCSV(stockOutCSV).map(r => ({
    id: r.id,
    date: r.date,
    item_id: r.item_id,
    item_sku: r.item_sku,
    item_name: r.item_name,
    qty: parseFloat(r.qty) || 0,
    unit: r.unit || "pcs",
    used_by: r.used_by || "",
    notes: r.notes || "",
    created_at: r.created_at || new Date().toISOString()
  }));

  for (let i = 0; i < outEntries.length; i += 50) {
    const chunk = outEntries.slice(i, i + 50);
    const { error } = await client.database.from("stock_out").upsert(chunk);
    if (error) console.error("Error upserting stock_out chunk:", error);
  }
  console.log(`Synced ${outEntries.length} OUT records to database.`);

  console.log("Seeding stock_logs...");
  const logs = parseCSV(stockLogsCSV).map(r => ({
    id: r.id,
    action: r.action,
    details: r.details,
    created_at: r.created_at || new Date().toISOString()
  }));

  for (let i = 0; i < logs.length; i += 50) {
    const chunk = logs.slice(i, i + 50);
    const { error } = await client.database.from("stock_logs").upsert(chunk);
    if (error) console.error("Error upserting stock_logs chunk:", error);
  }
  console.log(`Synced ${logs.length} log records to database.`);
}

seedAll().catch(console.error);
