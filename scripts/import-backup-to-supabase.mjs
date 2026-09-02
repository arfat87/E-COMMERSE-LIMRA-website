import fs from "fs";
import readline from "readline";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const filePath = "C:\\Users\\salim\\Downloads\\20260901_170632.sql\\20260901_170632.sql";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function parsePostgresValue(val, colName) {
  if (val === "\\N" || val === null || val === undefined) return null;
  val = val.replace(/\\t/g, "\t").replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\\\/g, "\\");

  if (val === "t" || val === "true" || val === "TRUE") return true;
  if (val === "f" || val === "false" || val === "FALSE") return false;

  if (colName === "items" || colName === "addresses" || colName === "favorite_items" || colName === "details" || colName === "metadata") {
    try {
      return JSON.parse(val);
    } catch (e) {
      return val;
    }
  }

  if (
    colName === "quantity" ||
    colName === "qty" ||
    colName === "min_qty" ||
    colName === "guests" ||
    colName === "rating" ||
    colName === "order_number" ||
    colName === "booking_number" ||
    colName === "table_number" ||
    colName === "max_uses" ||
    colName === "used_count"
  ) {
    const n = Number(val);
    if (!isNaN(n)) return n;
  }

  if (
    colName === "price" ||
    colName === "mrp" ||
    colName === "total_amount" ||
    colName === "unit_price" ||
    colName === "line_total" ||
    colName === "cost_price" ||
    colName === "sale_price" ||
    colName === "delivery_fee" ||
    colName === "charge" ||
    colName === "min_order" ||
    colName === "min_bill" ||
    colName === "discount_pct" ||
    colName === "amount" ||
    colName === "total_spent" ||
    colName === "cgst_rate" ||
    colName === "sgst_rate" ||
    colName === "kot_paper_width" ||
    colName === "bill_paper_width" ||
    colName === "latitude" ||
    colName === "longitude"
  ) {
    const f = parseFloat(val);
    if (!isNaN(f)) return f;
  }

  return val;
}

async function extractTableData() {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const tables = {};
  let currentTable = null;
  let currentColumns = [];

  for await (const line of rl) {
    if (line.startsWith("COPY public.")) {
      const match = line.match(/^COPY public\.([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s+FROM stdin;/);
      if (match) {
        currentTable = match[1];
        currentColumns = match[2].split(",").map((c) => c.trim());
        tables[currentTable] = { columns: currentColumns, rows: [] };
      } else {
        currentTable = null;
      }
      continue;
    }

    if (currentTable) {
      if (line === "\\." || line.trim() === "\\.") {
        currentTable = null;
        continue;
      }
      if (line.trim() !== "") {
        const rawFields = line.split("\t");
        const rowObj = {};
        for (let i = 0; i < currentColumns.length; i++) {
          const col = currentColumns[i];
          const rawVal = rawFields[i];
          rowObj[col] = parsePostgresValue(rawVal, col);
        }
        tables[currentTable].rows.push(rowObj);
      }
    }
  }

  return tables;
}

function mapRowForTable(tableName, clean) {
  if (tableName === "delivery_areas") {
    return {
      name: clean.name,
      delivery_fee: clean.charge !== undefined ? clean.charge : (clean.delivery_fee || 0),
      min_order: clean.min_order || 0,
      estimated_time: clean.estimated_time || "30-45 mins",
      active: clean.active !== false,
      created_at: clean.created_at || new Date().toISOString()
    };
  }

  if (tableName === "admin_users") {
    return {
      email: clean.email,
      role: "admin",
      created_at: clean.created_at || new Date().toISOString()
    };
  }

  if (tableName === "customer_profiles") {
    return {
      phone: clean.phone || null,
      name: clean.name || "",
      email: clean.email || null,
      phone_verified: clean.phone_verified === true,
      addresses: clean.address ? [{ address: clean.address }] : (clean.addresses || []),
      created_at: clean.created_at || new Date().toISOString(),
      updated_at: clean.updated_at || new Date().toISOString()
    };
  }

  if (tableName === "orders") {
    return {
      id: clean.id,
      order_number: Number(clean.order_number) || 1000,
      customer_name: clean.customer_name || "Customer",
      customer_phone: clean.customer_phone || "",
      total_amount: Number(clean.total_amount) || 0,
      status: ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled", "hold"].includes(clean.status) ? clean.status : "pending",
      payment_status: ["paid", "success"].includes(clean.payment_status) ? "paid" : "unpaid",
      payment_method: clean.payment_method || "cash",
      notes: clean.notes || null,
      latitude: clean.latitude ? Number(clean.latitude) : null,
      longitude: clean.longitude ? Number(clean.longitude) : null,
      landmark: clean.landmark || null,
      delivery_notes: clean.delivery_notes || null,
      location_verified: clean.location_verified === true,
      order_type: ["delivery", "pickup", "takeaway", "dine_in", "table"].includes(clean.order_type) ? clean.order_type : "delivery",
      table_number: clean.table_number ? Number(clean.table_number) : null,
      table_zone: clean.table_zone || (clean.table_number ? "indoor" : null),
      txn_ref: clean.txn_ref || null,
      created_at: clean.created_at || new Date().toISOString(),
      updated_at: clean.updated_at || new Date().toISOString()
    };
  }

  if (tableName === "order_items") {
    return {
      id: clean.id,
      order_id: clean.order_id,
      menu_item_id: clean.menu_item_id ? Number(clean.menu_item_id) : null,
      item_name: clean.item_name || "Item",
      quantity: Math.max(1, Number(clean.quantity) || 1),
      unit_price: Number(clean.unit_price) || 0,
      line_total: Number(clean.line_total) || 0,
      created_at: clean.created_at || new Date().toISOString()
    };
  }

  if (tableName === "stock_items") {
    return {
      id: clean.id,
      sku: clean.sku || null,
      name: clean.name,
      category: clean.category || "General",
      unit: clean.unit || "pcs",
      qty: Number(clean.qty) || 0,
      min_qty: Number(clean.min_qty) || 5,
      cost_price: Number(clean.cost_price) || 0,
      sale_price: Number(clean.sale_price) || 0,
      godown: clean.godown || "Main Godown",
      supplier: clean.supplier || "Limra Wholesale",
      is_available: clean.is_available !== false,
      updated_at: clean.updated_at || new Date().toISOString()
    };
  }

  if (tableName === "stock_in") {
    return {
      id: clean.id,
      date: clean.date || null,
      item_id: clean.item_id || null,
      item_sku: clean.item_sku || null,
      item_name: clean.item_name || "",
      qty: Number(clean.qty) || 0,
      unit: clean.unit || "pcs",
      cost_price: Number(clean.cost_price) || 0,
      supplier: clean.supplier || null,
      notes: clean.notes || null,
      created_at: clean.created_at || new Date().toISOString()
    };
  }

  if (tableName === "stock_out") {
    return {
      id: clean.id,
      date: clean.date || null,
      item_id: clean.item_id || null,
      item_sku: clean.item_sku || null,
      item_name: clean.item_name || "",
      qty: Number(clean.qty) || 0,
      unit: clean.unit || "pcs",
      used_by: clean.used_by || null,
      notes: clean.notes || null,
      created_at: clean.created_at || new Date().toISOString()
    };
  }

  if (tableName === "stock_logs") {
    return {
      id: clean.id,
      action: clean.action || "",
      details: typeof clean.details === "object" ? JSON.stringify(clean.details) : String(clean.details || ""),
      created_at: clean.created_at || new Date().toISOString()
    };
  }

  if (tableName === "stock_in_entries") {
    return {
      id: clean.id,
      item_id: clean.item_id || null,
      item_name: clean.item_name || "",
      qty: Number(clean.qty) || 0,
      unit: clean.unit || "pcs",
      supplier: clean.supplier || null,
      cost_price: Number(clean.cost_price) || 0,
      created_at: clean.created_at || new Date().toISOString()
    };
  }

  if (tableName === "stock_out_entries") {
    return {
      id: clean.id,
      item_id: clean.item_id || null,
      item_name: clean.item_name || "",
      qty: Number(clean.qty) || 0,
      unit: clean.unit || "pcs",
      reason: clean.notes || clean.reason || "",
      ref_no: clean.ref_no || null,
      recorded_by: clean.used_by || clean.recorded_by || null,
      created_at: clean.created_at || new Date().toISOString()
    };
  }

  if (tableName === "notifications") {
    return {
      id: clean.id,
      customer_phone: clean.customer_phone || "",
      order_id: clean.order_id || null,
      item_id: clean.item_id ? String(clean.item_id) : null,
      title: clean.title || "Notification",
      message: clean.message || clean.description || "",
      description: clean.description || clean.message || "",
      type: clean.type || "order",
      is_read: clean.is_read === true,
      created_at: clean.created_at || new Date().toISOString(),
      updated_at: clean.updated_at || new Date().toISOString()
    };
  }

  if (tableName === "combos") {
    return {
      id: Number(clean.id),
      name: clean.name || "Combo",
      description: clean.description || "",
      price: Number(clean.price) || 0,
      mrp: clean.mrp ? Number(clean.mrp) : null,
      items: Array.isArray(clean.items) ? clean.items : [],
      available: clean.available !== false,
      image_url: clean.image_url || null,
      created_at: clean.created_at || new Date().toISOString()
    };
  }

  if (tableName === "menu_overrides") {
    return {
      id: Number(clean.id),
      price: Number(clean.price) || 0,
      mrp: clean.mrp ? Number(clean.mrp) : null,
      available: clean.available !== false,
      featured: clean.featured === true,
      description: clean.description || "",
      updated_at: clean.updated_at || new Date().toISOString()
    };
  }

  if (tableName === "security_audit_logs") {
    return {
      id: clean.id,
      action: clean.action || "",
      ip_address: clean.ip_address || null,
      device_information: clean.device_information || null,
      result: clean.result || "success",
      details: typeof clean.details === "object" ? clean.details : null,
      created_at: clean.created_at || new Date().toISOString()
    };
  }

  return clean;
}

async function upsertBatch(tableName, rawRows, conflictCol = "id", chunkSize = 100) {
  if (!rawRows || rawRows.length === 0) return 0;
  const rows = rawRows.map((r) => mapRowForTable(tableName, r));
  let total = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const options = conflictCol ? { onConflict: conflictCol } : undefined;

    const { error } = await supabase.from(tableName).upsert(chunk, options);
    if (error) {
      // If batch fails, insert rows one by one
      for (const row of chunk) {
        const { error: singleErr } = await supabase.from(tableName).upsert(row, options);
        if (!singleErr) {
          total++;
        }
      }
    } else {
      total += chunk.length;
    }
  }

  return total;
}

async function runImport() {
  console.log("\n=======================================================");
  console.log("🚀 RESTORING ALL BACKUP DATA INTO SUPABASE");
  console.log("=======================================================");
  console.log(`📍 Supabase URL:  ${SUPABASE_URL}`);
  console.log(`📁 Backup File:   ${filePath}\n`);

  const tables = await extractTableData();
  console.log("Parsed all tables. Starting relational database import...\n");

  const importOrder = [
    { name: "admin_users", conflict: "email" },
    { name: "customer_profiles", conflict: "phone" },
    { name: "delivery_areas", conflict: "name" },
    { name: "menu_overrides", conflict: "id" },
    { name: "combos", conflict: "id" },
    { name: "reviews", conflict: "id" },
    { name: "stock_items", conflict: "id" },
    { name: "stock_in", conflict: "id" },
    { name: "stock_out", conflict: "id" },
    { name: "stock_logs", conflict: "id" },
    { name: "stock_in_entries", conflict: "id" },
    { name: "stock_out_entries", conflict: "id" },
    { name: "orders", conflict: "id" },
    { name: "order_items", conflict: "id" },
    { name: "notifications", conflict: "id" },
    { name: "security_audit_logs", conflict: "id" }
  ];

  const results = {};

  for (const item of importOrder) {
    const tblData = tables[item.name];
    if (tblData && tblData.rows.length > 0) {
      process.stdout.write(`- Importing ${item.name} (${tblData.rows.length} rows)... `);
      const count = await upsertBatch(item.name, tblData.rows, item.conflict);
      results[item.name] = `${count} / ${tblData.rows.length} rows restored`;
      console.log(`✓ (${count} inserted/updated)`);
    } else {
      results[item.name] = "0 rows (empty in backup)";
    }
  }

  console.log("\n=======================================================");
  console.log("🎉 ALL PREVIOUS DATABASE BACKUP DATA IMPORTED TO SUPABASE!");
  console.log("=======================================================");
  console.table(results);
}

runImport().catch((err) => {
  console.error("❌ Fatal Import Error:", err);
  process.exit(1);
});
