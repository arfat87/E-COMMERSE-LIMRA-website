import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const EXPORT_DIR = path.join(projectRoot, "data", "migration_exports");

const INSFORGE_URL = process.env.VITE_INSFORGE_URL || process.env.API_BASE_URL || "https://vb9ucr22.us-east.insforge.app";
const API_KEY = process.env.INSFORGE_ADMIN_KEY || process.env.API_KEY || "ik_799af068e8f4fb05944d04497229fe7d";

async function queryInsforge(sql) {
  const res = await fetch(INSFORGE_URL + "/api/database/advance/rawsql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY
    },
    body: JSON.stringify({ query: sql })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`InsForge SQL HTTP ${res.status}: ${txt}`);
  }

  const json = await res.json();
  return json.rows || json.data || (Array.isArray(json) ? json : []);
}

function loadJson(collectionName) {
  const filePath = path.join(EXPORT_DIR, `${collectionName}.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(`Failed to parse ${collectionName}.json:`, e.message);
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

function toValidInteger(val, fallback = 1) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "number" && !isNaN(val)) return Math.floor(val);
  const str = String(val);
  const match = str.match(/\d+/g);
  if (match) {
    const num = parseInt(match[match.length - 1], 10);
    return isNaN(num) ? fallback : num;
  }
  return fallback;
}

function sqlEscape(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  if (typeof val === "object") {
    if (val instanceof Date) return `'${val.toISOString()}'`;
    return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sanitizeOrderStatus(status) {
  const s = String(status || "pending").toLowerCase().trim();
  const valid = ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled", "hold"];
  if (valid.includes(s)) return s;
  if (s === "completed" || s === "closed" || s === "paid") return "delivered";
  if (s === "accepted") return "confirmed";
  return "pending";
}

function sanitizePaymentStatus(status) {
  const s = String(status || "unpaid").toLowerCase().trim();
  if (s === "paid" || s === "success" || s === "completed") return "paid";
  return "unpaid";
}

function sanitizeCoordinates(lat, lng) {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (isNaN(numLat) || isNaN(numLng) || numLat === 0 || numLng === 0) {
    return { lat: "NULL", lng: "NULL" };
  }
  // InsForge check constraint: lat >= 21.0 AND lat <= 23.0 AND lng >= 86.5 AND lng <= 88.5
  if (numLat >= 21.0 && numLat <= 23.0 && numLng >= 86.5 && numLng <= 88.5) {
    return { lat: numLat, lng: numLng };
  }
  return { lat: "NULL", lng: "NULL" };
}

async function purgeNonSecurityData() {
  console.log("--- 1. PURGING NON-SECURITY OPERATIONAL DATA IN INSFORGE POSTGRESQL ---");
  const purgeTables = [
    "order_items",
    "orders",
    "stock_out_entries",
    "stock_in_entries",
    "stock_out",
    "stock_in",
    "stock_logs",
    "stock_items",
    "notifications",
    "bookings",
    "menu_overrides",
    "delivery_areas",
    "coupon_usage",
    "coupons",
    "combos",
    "printer_settings",
    "reviews",
    "verified_payments",
    "payment_history",
    "phone_verifications"
  ];

  for (const tbl of purgeTables) {
    try {
      await queryInsforge(`DELETE FROM public.${tbl};`);
      console.log(`  ✓ Cleared table public.${tbl}`);
    } catch (e) {
      console.warn(`  ! Notice clearing public.${tbl}:`, e.message);
    }
  }

  console.log("✅ Non-security operational tables purged successfully (Security tables preserved).\n");
}

async function migrateData() {
  console.log("==================================================");
  console.log("🚀 IMPORTING RESTAURANT DATA FROM MONGODB EXPORT INTO INSFORGE");
  console.log("==================================================\n");

  await purgeNonSecurityData();

  // 1. DELIVERY AREAS
  const deliveryAreas = loadJson("delivery_areas");
  console.log(`- Importing ${deliveryAreas.length} Delivery Areas...`);
  if (deliveryAreas.length > 0) {
    const values = deliveryAreas.map(d => {
      const id = Number(d.id) || 1;
      const name = sqlEscape(d.name);
      const charge = Number(d.charge) || 0;
      const created_at = sqlEscape(d.created_at || new Date().toISOString());
      return `(${id}, ${name}, ${charge}, ${created_at})`;
    }).join(",\n");
    await queryInsforge(`INSERT INTO public.delivery_areas (id, name, charge, created_at) VALUES ${values} ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, charge = EXCLUDED.charge;`);
    console.log(`  ✓ ${deliveryAreas.length} delivery areas imported.`);
  }

  // 2. MENU OVERRIDES
  const menuOverrides = loadJson("menu_overrides");
  console.log(`- Importing ${menuOverrides.length} Menu Overrides...`);
  if (menuOverrides.length > 0) {
    const values = menuOverrides.map(m => {
      const id = Number(m.id);
      const price = Number(m.price) || 0;
      const available = m.available !== false;
      const featured = m.featured === true;
      const mrp = m.mrp ? Number(m.mrp) : "NULL";
      const desc = sqlEscape(m.description || "");
      const updated_at = sqlEscape(m.updated_at || new Date().toISOString());
      return `(${id}, ${price}, ${available}, ${featured}, ${mrp}, ${desc}, ${updated_at})`;
    }).join(",\n");
    await queryInsforge(`INSERT INTO public.menu_overrides (id, price, available, featured, mrp, description, updated_at) VALUES ${values} ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price, available = EXCLUDED.available, featured = EXCLUDED.featured, mrp = EXCLUDED.mrp, description = EXCLUDED.description;`);
    console.log(`  ✓ ${menuOverrides.length} menu overrides imported.`);
  }

  // 3. COMBOS
  const combos = loadJson("combos");
  console.log(`- Importing ${combos.length} Combos...`);
  if (combos.length > 0) {
    const values = combos.map((c, idx) => {
      const id = Number(c.id) || (idx + 1);
      const name = sqlEscape(c.name);
      const desc = sqlEscape(c.description || "");
      const price = Number(c.price) || 0;
      const items = sqlEscape(c.items || []);
      const available = c.available !== false;
      const mrp = c.mrp ? Number(c.mrp) : "NULL";
      const image_url = sqlEscape(c.image_url || null);
      const created_at = sqlEscape(c.created_at || new Date().toISOString());
      return `(${id}, ${name}, ${desc}, ${price}, ${items}::jsonb, ${available}, ${mrp}, ${image_url}, ${created_at})`;
    }).join(",\n");
    await queryInsforge(`INSERT INTO public.combos (id, name, description, price, items, available, mrp, image_url, created_at) VALUES ${values} ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price, items = EXCLUDED.items;`);
    console.log(`  ✓ ${combos.length} combos imported.`);
  }

  // 4. COUPONS
  const coupons = loadJson("coupons");
  console.log(`- Importing ${coupons.length} Coupons...`);
  if (coupons.length > 0) {
    const values = coupons.map(c => {
      const code = sqlEscape(String(c.code).trim().toUpperCase());
      const rawPct = Number(c.discount_pct || c.discount_value) || 10;
      const discount_pct = Math.min(100, Math.max(1, rawPct));
      const max_uses = Number(c.max_uses || c.usage_limit) || 100;
      const used_count = Number(c.used_count) || 0;
      const expiry_date = sqlEscape(c.expiry_date || c.valid_until || new Date(Date.now() + 365*24*3600*1000).toISOString());
      const min_bill = Number(c.min_bill || c.min_order) || 0;
      const active = c.active !== false && c.is_active !== false;
      const is_auto_send = c.is_auto_send === true;
      const created_at = sqlEscape(c.created_at || new Date().toISOString());
      return `(${code}, ${discount_pct}, ${max_uses}, ${used_count}, ${expiry_date}, ${min_bill}, ${active}, ${is_auto_send}, ${created_at})`;
    }).join(",\n");
    await queryInsforge(`INSERT INTO public.coupons (code, discount_pct, max_uses, used_count, expiry_date, min_bill, active, is_auto_send, created_at) VALUES ${values} ON CONFLICT (code) DO UPDATE SET discount_pct = EXCLUDED.discount_pct, active = EXCLUDED.active;`);
    console.log(`  ✓ ${coupons.length} coupons imported.`);
  }

  // 5. PRINTER SETTINGS
  const printerSettings = loadJson("printer_settings");
  console.log(`- Importing ${printerSettings.length} Printer Settings...`);
  if (printerSettings.length > 0) {
    for (const p of printerSettings) {
      const id = sqlEscape(p.id || "default_settings");
      const model = sqlEscape(p.printer_model || "POS-58");
      const name = sqlEscape(p.active_printer_name || "Thermal Printer");
      const mode = sqlEscape(p.connection_mode || "usb");
      const kot_w = Number(p.kot_paper_width) || 58;
      const kot_pw = Number(p.kot_printable_width) || 48;
      const bill_w = Number(p.bill_paper_width) || 58;
      const bill_pw = Number(p.bill_printable_width) || 48;
      const r_name = sqlEscape(p.restaurant_name || "LIMRA RESTAURANT");
      const r_addr = sqlEscape(p.restaurant_address || "Galsi, Purba Bardhaman");
      const r_phone = sqlEscape(p.restaurant_phone || "7501299357");
      const r_gstin = sqlEscape(p.restaurant_gstin || "19XXXXX1234X1Z5");
      const r_fssai = sqlEscape(p.restaurant_fssai || "12823013000123");
      const cgst = Number(p.cgst_rate) || 2.5;
      const sgst = Number(p.sgst_rate) || 2.5;
      const updated_at = sqlEscape(p.updated_at || new Date().toISOString());

      await queryInsforge(`
        INSERT INTO public.printer_settings (
          id, printer_model, active_printer_name, connection_mode,
          kot_paper_width, kot_printable_width, bill_paper_width, bill_printable_width,
          restaurant_name, restaurant_address, restaurant_phone, restaurant_gstin, restaurant_fssai,
          cgst_rate, sgst_rate, updated_at
        ) VALUES (
          ${id}, ${model}, ${name}, ${mode},
          ${kot_w}, ${kot_pw}, ${bill_w}, ${bill_pw},
          ${r_name}, ${r_addr}, ${r_phone}, ${r_gstin}, ${r_fssai},
          ${cgst}, ${sgst}, ${updated_at}
        ) ON CONFLICT (id) DO UPDATE SET
          restaurant_name = EXCLUDED.restaurant_name,
          updated_at = EXCLUDED.updated_at;
      `);
    }
    console.log(`  ✓ Printer settings imported.`);
  }

  // 6. REVIEWS
  const reviews = loadJson("reviews");
  console.log(`- Importing ${reviews.length} Reviews...`);
  if (reviews.length > 0) {
    for (const r of reviews) {
      const id = Number(r.id) || 1;
      const order_num = sqlEscape(r.order_number || "ORD-01");
      const rating = Math.min(5, Math.max(1, Number(r.rating) || 5));
      const comment = sqlEscape(r.comment || "");
      const created_at = sqlEscape(r.created_at || new Date().toISOString());
      await queryInsforge(`INSERT INTO public.reviews (id, order_number, rating, comment, created_at) VALUES (${id}, ${order_num}, ${rating}, ${comment}, ${created_at}) ON CONFLICT (id) DO NOTHING;`);
    }
    console.log(`  ✓ Reviews imported.`);
  }

  // 7. BOOKINGS
  const bookings = loadJson("bookings");
  console.log(`- Importing ${bookings.length} Bookings...`);
  if (bookings.length > 0) {
    for (const b of bookings) {
      const id = sqlEscape(toValidUuid(b.id || b._id));
      const b_num = Number(b.booking_number) || 1;
      const rawType = String(b.type || "table").toLowerCase();
      const b_type = sqlEscape(["table", "party", "wedding"].includes(rawType) ? rawType : "table");
      const c_name = sqlEscape(b.customer_name || "Guest");
      const c_phone = sqlEscape(b.customer_phone || "");
      const b_date = sqlEscape(b.booking_date || new Date().toISOString().slice(0, 10));
      const b_time = sqlEscape(b.booking_time || "19:00");
      const guests = Number(b.guests) || 2;
      const rawStatus = String(b.status || "confirmed").toLowerCase();
      const status = sqlEscape(["pending", "confirmed", "completed", "cancelled"].includes(rawStatus) ? rawStatus : "confirmed");
      const created_at = sqlEscape(b.created_at || new Date().toISOString());
      await queryInsforge(`
        INSERT INTO public.bookings (id, booking_number, type, customer_name, customer_phone, booking_date, booking_time, guests, status, created_at)
        VALUES (${id}, ${b_num}, ${b_type}, ${c_name}, ${c_phone}, ${b_date}, ${b_time}, ${guests}, ${status}, ${created_at})
        ON CONFLICT (id) DO NOTHING;
      `);
    }
    console.log(`  ✓ Bookings imported.`);
  }

  // 8. STOCK ITEMS (138 items)
  const stockItems = loadJson("stock_items");
  console.log(`- Importing ${stockItems.length} Stock Inventory Items...`);
  if (stockItems.length > 0) {
    const chunkSize = 50;
    for (let i = 0; i < stockItems.length; i += chunkSize) {
      const chunk = stockItems.slice(i, i + chunkSize);
      const values = chunk.map(s => {
        const id = sqlEscape(s.id || s._id);
        const sku = sqlEscape(s.sku || `SKU-${s.id}`);
        const name = sqlEscape(s.name);
        const category = sqlEscape(s.category || "General");
        const unit = sqlEscape(s.unit || "pcs");
        const qty = Number(s.qty ?? s.current_stock) || 0;
        const min_qty = Number(s.min_qty ?? s.min_threshold) || 5;
        const cost_price = Number(s.cost_price) || 0;
        const supplier = sqlEscape(s.supplier || "Limra Wholesale");
        const is_available = s.is_available !== false;
        const updated_at = sqlEscape(s.updated_at || new Date().toISOString());
        return `(${id}, ${sku}, ${name}, ${category}, ${unit}, ${qty}, ${min_qty}, ${cost_price}, ${supplier}, ${is_available}, ${updated_at})`;
      }).join(",\n");

      await queryInsforge(`
        INSERT INTO public.stock_items (id, sku, name, category, unit, qty, min_qty, cost_price, supplier, is_available, updated_at)
        VALUES ${values}
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          unit = EXCLUDED.unit,
          qty = EXCLUDED.qty,
          min_qty = EXCLUDED.min_qty,
          cost_price = EXCLUDED.cost_price,
          supplier = EXCLUDED.supplier,
          is_available = EXCLUDED.is_available,
          updated_at = EXCLUDED.updated_at;
      `);
    }
    console.log(`  ✓ ${stockItems.length} stock items imported.`);
  }

  // 9. STOCK IN & STOCK IN ENTRIES
  const stockIn = loadJson("stock_in");
  console.log(`- Importing ${stockIn.length} Stock In Records...`);
  if (stockIn.length > 0) {
    const chunkSize = 50;
    for (let i = 0; i < stockIn.length; i += chunkSize) {
      const chunk = stockIn.slice(i, i + chunkSize);
      const values = chunk.map(s => {
        const id = sqlEscape(s.id || s._id);
        const date = sqlEscape(s.date || new Date().toISOString().slice(0, 10));
        const item_id = sqlEscape(s.item_id || s.id);
        const item_sku = sqlEscape(s.item_sku || s.sku || "");
        const item_name = sqlEscape(s.item_name || s.name || "");
        const qty = Number(s.qty) || 0;
        const unit = sqlEscape(s.unit || "kg");
        const cost_price = Number(s.cost_price) || 0;
        const supplier = sqlEscape(s.supplier || "");
        const notes = sqlEscape(s.notes || "");
        const created_at = sqlEscape(s.created_at || new Date().toISOString());
        return `(${id}, ${date}, ${item_id}, ${item_sku}, ${item_name}, ${qty}, ${unit}, ${cost_price}, ${supplier}, ${notes}, ${created_at})`;
      }).join(",\n");

      await queryInsforge(`
        INSERT INTO public.stock_in (id, date, item_id, item_sku, item_name, qty, unit, cost_price, supplier, notes, created_at)
        VALUES ${values}
        ON CONFLICT (id) DO NOTHING;
      `);
      await queryInsforge(`
        INSERT INTO public.stock_in_entries (id, date, item_id, item_sku, item_name, qty, unit, cost_price, supplier, notes, created_at)
        VALUES ${values}
        ON CONFLICT (id) DO NOTHING;
      `);
    }
    console.log(`  ✓ Stock In entries imported.`);
  }

  // 10. STOCK OUT & STOCK OUT ENTRIES
  const stockOut = loadJson("stock_out");
  console.log(`- Importing ${stockOut.length} Stock Out Records...`);
  if (stockOut.length > 0) {
    const chunkSize = 50;
    for (let i = 0; i < stockOut.length; i += chunkSize) {
      const chunk = stockOut.slice(i, i + chunkSize);
      const values = chunk.map(s => {
        const id = sqlEscape(s.id || s._id);
        const date = sqlEscape(s.date || new Date().toISOString().slice(0, 10));
        const item_id = sqlEscape(s.item_id || s.id);
        const item_sku = sqlEscape(s.item_sku || s.sku || "");
        const item_name = sqlEscape(s.item_name || s.name || "");
        const qty = Number(s.qty) || 0;
        const unit = sqlEscape(s.unit || "kg");
        const used_by = sqlEscape(s.used_by || s.department || "Kitchen");
        const notes = sqlEscape(s.notes || s.reason || "");
        const created_at = sqlEscape(s.created_at || new Date().toISOString());
        return `(${id}, ${date}, ${item_id}, ${item_sku}, ${item_name}, ${qty}, ${unit}, ${used_by}, ${notes}, ${created_at})`;
      }).join(",\n");

      await queryInsforge(`
        INSERT INTO public.stock_out (id, date, item_id, item_sku, item_name, qty, unit, used_by, notes, created_at)
        VALUES ${values}
        ON CONFLICT (id) DO NOTHING;
      `);
      await queryInsforge(`
        INSERT INTO public.stock_out_entries (id, date, item_id, item_sku, item_name, qty, unit, used_by, notes, created_at)
        VALUES ${values}
        ON CONFLICT (id) DO NOTHING;
      `);
    }
    console.log(`  ✓ Stock Out entries imported.`);
  }

  // 11. STOCK LOGS
  const stockLogs = loadJson("stock_logs");
  console.log(`- Importing ${stockLogs.length} Stock Audit Logs...`);
  if (stockLogs.length > 0) {
    const chunkSize = 50;
    for (let i = 0; i < stockLogs.length; i += chunkSize) {
      const chunk = stockLogs.slice(i, i + chunkSize);
      const values = chunk.map((s, idx) => {
        const id = sqlEscape(s.id || s._id || `log-${i + idx}`);
        const action = sqlEscape(s.action || s.type || "STOCK_ADJUSTMENT");
        const details = sqlEscape(s.details || (s.item_name ? `${s.item_name} ${s.type} qty:${s.qty} bal:${s.balance_after}` : ""));
        const created_at = sqlEscape(s.created_at || new Date().toISOString());
        return `(${id}, ${action}, ${details}, ${created_at})`;
      }).join(",\n");

      await queryInsforge(`
        INSERT INTO public.stock_logs (id, action, details, created_at)
        VALUES ${values}
        ON CONFLICT (id) DO NOTHING;
      `);
    }
    console.log(`  ✓ ${stockLogs.length} stock audit logs imported.`);
  }

  // 12. ORDERS & ORDER ITEMS (Relational Mapping)
  const orders = loadJson("orders");
  const rawOrderItems = loadJson("order_items");
  console.log(`- Importing ${orders.length} Orders & Order Items...`);

  const orderIdMap = new Map();
  const allOrderItemsToInsert = [];

  for (let idx = 0; idx < orders.length; idx++) {
    const o = orders[idx];
    const originalId = o.id || o._id;
    const orderUuid = toValidUuid(originalId);
    orderIdMap.set(String(originalId), orderUuid);
    if (o._id) orderIdMap.set(String(o._id), orderUuid);
    if (o.id) orderIdMap.set(String(o.id), orderUuid);

    const orderNumber = toValidInteger(o.order_number, 400 + idx);
    const customerName = sqlEscape(o.customer_name || "Customer");
    const customerPhone = sqlEscape(o.customer_phone || "7501299357");
    const totalAmount = Number(o.total_amount ?? o.subtotal) || 0;
    const status = sqlEscape(sanitizeOrderStatus(o.status));
    const notes = sqlEscape(o.notes || "");
    const created_at = sqlEscape(o.created_at || new Date().toISOString());
    const updated_at = sqlEscape(o.updated_at || o.created_at || new Date().toISOString());
    
    const { lat, lng } = sanitizeCoordinates(o.latitude || o.location?.latitude, o.longitude || o.location?.longitude);
    const landmark = sqlEscape(o.landmark || o.location?.landmark || null);
    const deliveryNotes = sqlEscape(o.delivery_notes || o.location?.delivery_notes || null);
    const locationVerified = Boolean(o.location_verified || o.location?.location_verified);
    const orderType = sqlEscape(o.order_type || "delivery");
    const tableNumber = o.table_number ? Number(o.table_number) : "NULL";
    const tableZone = sqlEscape(o.table_zone || (o.table_number ? "indoor" : null));
    const paymentStatus = sqlEscape(sanitizePaymentStatus(o.payment_status || o.payment?.status));
    const txnRef = sqlEscape(o.txn_ref || o.payment?.txn_ref || null);

    await queryInsforge(`
      INSERT INTO public.orders (
        id, order_number, customer_name, customer_phone, total_amount, status, notes,
        created_at, updated_at, latitude, longitude, landmark, delivery_notes, location_verified,
        order_type, table_number, table_zone, payment_status, txn_ref
      ) VALUES (
        '${orderUuid}', ${orderNumber}, ${customerName}, ${customerPhone}, ${totalAmount}, ${status}, ${notes},
        ${created_at}, ${updated_at}, ${lat}, ${lng}, ${landmark}, ${deliveryNotes}, ${locationVerified},
        ${orderType}, ${tableNumber}, ${tableZone}, ${paymentStatus}, ${txnRef}
      ) ON CONFLICT (id) DO UPDATE SET
        total_amount = EXCLUDED.total_amount,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at;
    `);

    // If order has embedded items, prepare them for order_items table
    if (Array.isArray(o.items) && o.items.length > 0) {
      o.items.forEach(it => {
        allOrderItemsToInsert.push({
          id: toValidUuid(it.id || it._id || `${originalId}-${it.name || it.item_name}`),
          order_id: orderUuid,
          menu_item_id: it.menu_item_id ? Number(it.menu_item_id) : (it.id ? Number(it.id) : null),
          item_name: it.item_name || it.name || "Item",
          quantity: Math.max(1, Number(it.quantity || it.qty) || 1),
          unit_price: Number(it.unit_price || it.price) || 0,
          line_total: Number(it.line_total || (Number(it.unit_price || it.price || 0) * (Number(it.quantity || it.qty) || 1))) || 0,
          created_at: o.created_at || new Date().toISOString()
        });
      });
    }
  }

  // Also process standalone order_items records
  for (const item of rawOrderItems) {
    const parentUuid = orderIdMap.get(String(item.order_id)) || toValidUuid(item.order_id);
    allOrderItemsToInsert.push({
      id: toValidUuid(item.id || item._id),
      order_id: parentUuid,
      menu_item_id: item.menu_item_id ? Number(item.menu_item_id) : null,
      item_name: item.item_name || "Item",
      quantity: Math.max(1, Number(item.quantity) || 1),
      unit_price: Number(item.unit_price) || 0,
      line_total: Number(item.line_total) || 0,
      created_at: item.created_at || new Date().toISOString()
    });
  }

  // Deduplicate order items by ID
  const itemMap = new Map();
  allOrderItemsToInsert.forEach(it => itemMap.set(it.id, it));
  const uniqueItems = Array.from(itemMap.values());

  console.log(`- Inserting ${uniqueItems.length} unique order items linked to orders...`);
  if (uniqueItems.length > 0) {
    for (const it of uniqueItems) {
      const itId = sqlEscape(it.id);
      const ordId = sqlEscape(it.order_id);
      const menuId = it.menu_item_id ? Number(it.menu_item_id) : "NULL";
      const name = sqlEscape(it.item_name);
      const qty = Math.max(1, Number(it.quantity) || 1);
      const price = Number(it.unit_price) || 0;
      const total = Number(it.line_total) || (qty * price);
      const created_at = sqlEscape(it.created_at);

      await queryInsforge(`
        INSERT INTO public.order_items (id, order_id, menu_item_id, item_name, quantity, unit_price, line_total, created_at)
        VALUES (${itId}, ${ordId}, ${menuId}, ${name}, ${qty}, ${price}, ${total}, ${created_at})
        ON CONFLICT (id) DO NOTHING;
      `);
    }
    console.log(`  ✓ ${uniqueItems.length} order items imported.`);
  }

  // 13. NOTIFICATIONS
  const notifications = loadJson("notifications");
  console.log(`- Importing ${notifications.length} Notifications...`);
  if (notifications.length > 0) {
    const chunkSize = 50;
    for (let i = 0; i < notifications.length; i += chunkSize) {
      const chunk = notifications.slice(i, i + chunkSize);
      const values = chunk.map((n) => {
        const item_id = sqlEscape(toValidUuid(n.item_id || n.order_id || n._id));
        const type = sqlEscape(n.type || "order");
        const title = sqlEscape(n.title || "Order Notification");
        const message = sqlEscape(n.message || n.description || "");
        const description = sqlEscape(n.description || n.message || "");
        const is_read = n.is_read === true;
        const customer_phone = sqlEscape(n.customer_phone || null);
        const order_id = n.order_id && orderIdMap.has(String(n.order_id)) ? sqlEscape(orderIdMap.get(String(n.order_id))) : "NULL";
        const created_at = sqlEscape(n.created_at || new Date().toISOString());
        return `(${item_id}, ${type}, ${title}, ${message}, ${description}, ${is_read}, ${customer_phone}, ${order_id}, ${created_at})`;
      }).join(",\n");

      await queryInsforge(`
        INSERT INTO public.notifications (item_id, type, title, message, description, is_read, customer_phone, order_id, created_at)
        VALUES ${values};
      `);
    }
    console.log(`  ✓ ${notifications.length} notifications imported.`);
  }

  console.log("\n==================================================");
  console.log("🎉 DATA MIGRATION TO INSFORGE COMPLETED SUCCESSFULLY!");
  console.log("==================================================\n");
}

migrateData().catch(console.error);
