import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const EXPORT_DIR = path.join(projectRoot, "data", "migration_exports");

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("\n❌ ERROR: Supabase credentials not found in environment.");
  console.error("Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in your .env file.\n");
  console.error("Example .env:");
  console.error("SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co");
  console.error("SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsIn...\n");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

function loadJson(collectionName) {
  const filePath = path.join(EXPORT_DIR, `${collectionName}.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[WARN] Could not parse ${collectionName}.json:`, e.message);
    return [];
  }
}

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

async function upsertBatch(table, items, conflictColumn, chunkSize = 100) {
  if (!items || items.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const options = conflictColumn ? { onConflict: conflictColumn } : undefined;
    const { data, error } = await supabase.from(table).upsert(chunk, options);
    if (error) {
      console.warn(`  ⚠️ Warning on table "${table}" (chunk ${i + 1}-${i + chunk.length}):`, error.message);
    } else {
      total += chunk.length;
    }
  }
  return total;
}

async function runMigration() {
  console.log("\n=======================================================");
  console.log("🚀 LIMRA RESTAURANT — SUPABASE DATA MIGRATION");
  console.log("=======================================================");
  console.log(`📍 Supabase Project URL: ${SUPABASE_URL}`);
  console.log(`📂 Source Directory:     ${EXPORT_DIR}\n`);

  // 1. Connection Ping Test
  console.log("Step 1: Testing Supabase connection...");
  const { data: testData, error: testErr } = await supabase.from("printer_settings").select("id").limit(1);
  if (testErr) {
    console.error("❌ Failed to query Supabase:", testErr.message);
    console.error("\n💡 NOTE: Have you executed `supabase_schema.sql` in your Supabase SQL Editor?");
    console.error("1. Open https://supabase.com/dashboard/project/_/sql");
    console.error("2. Paste the contents of `supabase_schema.sql`");
    console.error("3. Click 'Run' to create all tables and RPCs, then re-run this migration.\n");
    process.exit(1);
  }
  console.log("✅ Supabase connection successful!\n");

  const results = {};

  // 2. Delivery Areas
  const deliveryAreas = loadJson("delivery_areas").map(d => ({
    id: toValidUuid(d.id || d._id),
    name: String(d.name || d.area_name).trim(),
    min_order: Number(d.min_order) || 0,
    delivery_fee: Number(d.delivery_fee) || 0,
    estimated_time: d.estimated_time || "30-45 mins",
    active: d.active !== false,
    created_at: d.created_at || new Date().toISOString()
  }));
  results.delivery_areas = await upsertBatch("delivery_areas", deliveryAreas, "id");
  console.log(`✓ Delivery Areas: ${results.delivery_areas} rows imported`);

  // 3. Menu Overrides
  const menuOverrides = loadJson("menu_overrides").map(m => ({
    id: Number(m.id || m._id),
    price: Number(m.price) || 0,
    mrp: m.mrp ? Number(m.mrp) : null,
    available: m.available !== false,
    featured: m.featured === true,
    description: m.description || "",
    updated_at: m.updated_at || new Date().toISOString()
  }));
  results.menu_overrides = await upsertBatch("menu_overrides", menuOverrides, "id");
  console.log(`✓ Menu Overrides: ${results.menu_overrides} rows imported`);

  // 4. Combos
  const combos = loadJson("combos").map((c, idx) => ({
    id: Number(c.id || c._id) || (idx + 1),
    name: String(c.name || "Combo").trim(),
    description: c.description || "",
    price: Number(c.price) || 0,
    mrp: c.mrp ? Number(c.mrp) : null,
    items: Array.isArray(c.items) ? c.items : [],
    available: c.available !== false,
    image_url: c.image_url || null,
    created_at: c.created_at || new Date().toISOString()
  }));
  results.combos = await upsertBatch("combos", combos, "id");
  console.log(`✓ Combos: ${results.combos} rows imported`);

  // 5. Coupons
  const coupons = loadJson("coupons").map(c => ({
    code: String(c.code).trim().toUpperCase(),
    discount_pct: Number(c.discount_pct || c.discount_value) || 10,
    max_uses: Number(c.max_uses || c.usage_limit) || 100,
    used_count: Number(c.used_count) || 0,
    expiry_date: c.expiry_date || c.valid_until || new Date(Date.now() + 365*24*3600*1000).toISOString(),
    min_bill: Number(c.min_bill || c.min_order) || 0,
    active: c.active !== false && c.is_active !== false,
    is_auto_send: c.is_auto_send === true,
    created_at: c.created_at || new Date().toISOString()
  }));
  results.coupons = await upsertBatch("coupons", coupons, "code");
  console.log(`✓ Coupons: ${results.coupons} rows imported`);

  // 6. Printer Settings
  const printerSettings = loadJson("printer_settings").map(p => ({
    id: String(p.id || "default"),
    printer_model: p.printer_model || "TVS RP3200 Plus",
    active_printer_name: p.active_printer_name || "Thermal Printer",
    connection_mode: p.connection_mode || "qz_tray",
    kot_paper_width: Number(p.kot_paper_width) || 80,
    kot_printable_width: Number(p.kot_printable_width) || 72,
    kot_top_margin: Number(p.kot_top_margin) || 0,
    kot_bottom_feed: Number(p.kot_bottom_feed) || 3,
    kot_font_size: p.kot_font_size || "large",
    kot_auto_cut: p.kot_auto_cut || "partial",
    bill_paper_width: Number(p.bill_paper_width) || 80,
    bill_printable_width: Number(p.bill_printable_width) || 72,
    bill_top_margin: Number(p.bill_top_margin) || 0,
    bill_bottom_feed: Number(p.bill_bottom_feed) || 4,
    bill_auto_cut: p.bill_auto_cut || "full",
    restaurant_name: p.restaurant_name || "LIMRA RESTAURANT",
    restaurant_address: p.restaurant_address || "Main Road, Near Bus Stand",
    restaurant_phone: p.restaurant_phone || "+91 98765 43210",
    restaurant_gstin: p.restaurant_gstin || "",
    restaurant_fssai: p.restaurant_fssai || "",
    cgst_rate: Number(p.cgst_rate) || 2.5,
    sgst_rate: Number(p.sgst_rate) || 2.5,
    updated_at: p.updated_at || new Date().toISOString()
  }));
  results.printer_settings = await upsertBatch("printer_settings", printerSettings, "id");
  console.log(`✓ Printer Settings: ${results.printer_settings} rows imported`);

  // 7. Stock Items
  const stockItems = loadJson("stock_items").map(s => ({
    id: String(s.id || s._id),
    sku: s.sku || `SKU-${s.id}`,
    name: String(s.name).trim(),
    category: s.category || "General",
    unit: s.unit || "pcs",
    qty: Number(s.qty ?? s.current_stock) || 0,
    min_qty: Number(s.min_qty ?? s.min_threshold) || 5,
    cost_price: Number(s.cost_price) || 0,
    sale_price: Number(s.sale_price || s.price) || 0,
    godown: s.godown || "Main Godown",
    supplier: s.supplier || "Limra Wholesale",
    is_available: s.is_available !== false,
    updated_at: s.updated_at || new Date().toISOString()
  }));
  results.stock_items = await upsertBatch("stock_items", stockItems, "id");
  console.log(`✓ Stock Inventory Items: ${results.stock_items} rows imported`);

  // 8. Stock In & Out
  const stockIn = loadJson("stock_in").map(s => ({
    id: String(s.id || s._id || crypto.randomUUID()),
    date: s.date || new Date().toISOString(),
    item_id: String(s.item_id || ""),
    item_sku: s.item_sku || "",
    item_name: s.item_name || "",
    qty: Number(s.qty) || 0,
    unit: s.unit || "pcs",
    cost_price: Number(s.cost_price) || 0,
    supplier: s.supplier || "",
    notes: s.notes || "",
    created_at: s.created_at || new Date().toISOString()
  }));
  results.stock_in = await upsertBatch("stock_in", stockIn, "id");
  console.log(`✓ Stock In Logs: ${results.stock_in} rows imported`);

  const stockOut = loadJson("stock_out").map(s => ({
    id: String(s.id || s._id || crypto.randomUUID()),
    date: s.date || new Date().toISOString(),
    item_id: String(s.item_id || ""),
    item_sku: s.item_sku || "",
    item_name: s.item_name || "",
    qty: Number(s.qty) || 0,
    unit: s.unit || "pcs",
    used_by: s.used_by || "",
    notes: s.notes || "",
    created_at: s.created_at || new Date().toISOString()
  }));
  results.stock_out = await upsertBatch("stock_out", stockOut, "id");
  console.log(`✓ Stock Out Logs: ${results.stock_out} rows imported`);

  const stockLogs = loadJson("stock_logs").map(s => ({
    id: String(s.id || s._id || crypto.randomUUID()),
    action: s.action || "LOG",
    details: typeof s.details === "object" ? JSON.stringify(s.details) : String(s.details || ""),
    created_at: s.created_at || new Date().toISOString()
  }));
  results.stock_logs = await upsertBatch("stock_logs", stockLogs, "id");
  console.log(`✓ Stock General Logs: ${results.stock_logs} rows imported`);

  // 9. Orders
  const rawOrders = loadJson("orders");
  const orders = rawOrders.map(o => ({
    id: toValidUuid(o.id || o._id),
    order_number: Number(o.order_number) || Math.floor(1000 + Math.random() * 9000),
    customer_name: o.customer_name || "Customer",
    customer_phone: o.customer_phone || "",
    total_amount: Number(o.total_amount) || 0,
    status: ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled", "hold"].includes(o.status) ? o.status : "pending",
    payment_status: ["paid", "success"].includes(o.payment_status) ? "paid" : "unpaid",
    payment_method: o.payment_method || "cash",
    notes: o.notes || null,
    latitude: o.latitude ? Number(o.latitude) : null,
    longitude: o.longitude ? Number(o.longitude) : null,
    landmark: o.landmark || null,
    delivery_notes: o.delivery_notes || null,
    location_verified: o.location_verified === true,
    order_type: ["delivery", "pickup", "takeaway", "dine_in", "table"].includes(o.order_type) ? o.order_type : "delivery",
    table_number: o.table_number ? Number(o.table_number) : null,
    table_zone: o.table_zone || "indoor",
    txn_ref: o.txn_ref || null,
    created_at: o.created_at || new Date().toISOString(),
    updated_at: o.updated_at || new Date().toISOString()
  }));
  results.orders = await upsertBatch("orders", orders, "id");
  console.log(`✓ Orders: ${results.orders} rows imported`);

  // 10. Order Items
  const rawOrderItems = loadJson("order_items");
  const orderItems = rawOrderItems.map(it => ({
    id: toValidUuid(it.id || it._id),
    order_id: toValidUuid(it.order_id),
    menu_item_id: it.menu_item_id ? Number(it.menu_item_id) : null,
    item_name: it.item_name || it.name || "Item",
    quantity: Math.max(1, Number(it.quantity || it.qty) || 1),
    unit_price: Number(it.unit_price || it.price) || 0,
    line_total: Number(it.line_total) || ((Number(it.unit_price || it.price) || 0) * (Math.max(1, Number(it.quantity || it.qty) || 1))),
    created_at: it.created_at || new Date().toISOString()
  }));
  results.order_items = await upsertBatch("order_items", orderItems, "id");
  console.log(`✓ Order Items: ${results.order_items} rows imported`);

  // 11. Bookings
  const rawBookings = loadJson("bookings");
  const bookings = rawBookings.map(b => ({
    id: toValidUuid(b.id || b._id),
    booking_number: Number(b.booking_number) || 1,
    type: ["table", "party", "wedding"].includes(b.type) ? b.type : "table",
    customer_name: b.customer_name || "Guest",
    customer_phone: b.customer_phone || "",
    booking_date: b.booking_date ? String(b.booking_date).slice(0, 10) : null,
    booking_time: b.booking_time || "19:00",
    guests: b.guests ? Number(b.guests) : null,
    preference: b.preference || null,
    seat_label: b.seat_label || null,
    event_type: b.event_type || null,
    budget: b.budget || null,
    catering: b.catering || null,
    venue: b.venue || null,
    message: b.message || null,
    notes: b.notes || null,
    status: ["pending", "confirmed", "completed", "cancelled"].includes(b.status) ? b.status : "pending",
    created_at: b.created_at || new Date().toISOString(),
    updated_at: b.updated_at || new Date().toISOString()
  }));
  results.bookings = await upsertBatch("bookings", bookings, "id");
  console.log(`✓ Bookings: ${results.bookings} rows imported`);

  // 12. Notifications
  const rawNotifs = loadJson("notifications");
  const notifs = rawNotifs.map(n => ({
    id: toValidUuid(n.id || n._id),
    customer_phone: n.customer_phone || "",
    order_id: n.order_id ? toValidUuid(n.order_id) : null,
    item_id: n.item_id ? String(n.item_id) : null,
    title: n.title || "Notification",
    message: n.message || n.description || "",
    description: n.description || n.message || "",
    type: n.type || "order",
    is_read: n.is_read === true,
    created_at: n.created_at || new Date().toISOString(),
    updated_at: n.updated_at || new Date().toISOString()
  }));
  results.notifications = await upsertBatch("notifications", notifs, "id");
  console.log(`✓ Notifications: ${results.notifications} rows imported`);

  // 13. Customer Profiles
  const rawProfiles = loadJson("customer_profiles");
  const profiles = rawProfiles.map(p => ({
    id: toValidUuid(p.id || p._id),
    phone: p.phone ? String(p.phone).trim() : null,
    name: p.name || "",
    email: p.email || null,
    phone_verified: p.phone_verified === true,
    addresses: Array.isArray(p.addresses) ? p.addresses : [],
    favorite_items: Array.isArray(p.favorite_items) ? p.favorite_items : [],
    total_orders: Number(p.total_orders) || 0,
    total_spent: Number(p.total_spent) || 0,
    created_at: p.created_at || new Date().toISOString(),
    updated_at: p.updated_at || new Date().toISOString()
  }));
  results.customer_profiles = await upsertBatch("customer_profiles", profiles, "id");
  console.log(`✓ Customer Profiles: ${results.customer_profiles} rows imported`);

  console.log("\n=======================================================");
  console.log("🎉 SUPABASE DATA MIGRATION COMPLETE!");
  console.log("=======================================================");
  console.table(results);
}

runMigration().catch(err => {
  console.error("❌ Migration error:", err);
  process.exit(1);
});
