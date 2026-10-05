import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import crypto from "crypto";
import { supabase } from "../backend/api/lib/supabase.js";
import { menuItems } from "../frontend/src/data/menu.js";

// 1. Build menu item lookup map
const menuMap = new Map();
for (const item of menuItems) {
  menuMap.set(item.name.toLowerCase().trim(), item);
}

// 2. Parse CSV
function parseLine(line) {
  const result = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
    } else if (c === ',' && !inQ) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseDateTime(dtStr) {
  const clean = dtStr.replace(/"/g, '').trim();
  const [dPart, tPart] = clean.split(',').map(s => s.trim());
  if (!dPart) return new Date().toISOString();
  const [day, month, year] = dPart.split('/').map(Number);
  const [hours, minutes, seconds] = (tPart || "00:00:00").split(':').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds || 0)}+05:30`;
}

async function main() {
  console.log("Reading scripts/september_orders.csv...");
  const content = fs.readFileSync("scripts/september_orders.csv", "utf8");
  const lines = content.trim().split("\n");
  const rows = lines.slice(1);
  console.log(`Found ${rows.length} records to import.`);

  const parsedOrders = [];
  const parsedItems = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const line = rows[idx].trim();
    if (!line) continue;
    const cols = parseLine(line);
    if (cols.length < 15) {
      console.warn(`Skipping incomplete row ${idx + 2}:`, line);
      continue;
    }

    const [
      orderNumberRaw,
      dateTimeRaw,
      custName,
      custPhone,
      orderTypeRaw,
      tableRaw,
      statusRaw,
      paymentStatusRaw,
      paymentMode,
      consolidatedItems,
      foodTaxable,
      cgst,
      sgst,
      totalGst,
      totalAmount
    ] = cols;

    const orderId = crypto.randomUUID();
    const createdAt = parseDateTime(dateTimeRaw);
    const orderNumber = parseInt(orderNumberRaw, 10) || (idx + 1);
    const orderType = orderTypeRaw.toLowerCase().trim() || 'table';
    const status = statusRaw.toLowerCase().trim() || 'delivered';
    const paymentStatus = paymentStatusRaw.toLowerCase().trim() || 'paid';
    const totalAmt = parseFloat(totalAmount) || 0;

    let tableNum = null;
    if (tableRaw) {
      const match = tableRaw.match(/\d+/);
      if (match) tableNum = parseInt(match[0], 10);
    }

    const noteDetails = `Food Taxable: ${foodTaxable || 0}, CGST: ${cgst || 0}, SGST: ${sgst || 0}, Total GST: ${totalGst || 0}`;

    parsedOrders.push({
      id: orderId,
      order_number: orderNumber,
      customer_name: custName || 'Guest',
      customer_phone: custPhone || '',
      order_type: orderType,
      table_number: tableNum,
      status: status,
      payment_status: paymentStatus,
      payment_method: 'cash', // Cash/UPI
      total_amount: totalAmt,
      ticket_status: 'PAID', // Temporarily PAID so items can attach
      final_ticket_status: status === 'cancelled' ? 'CANCELLED' : 'CLOSED',
      notes: noteDetails,
      created_at: createdAt,
      updated_at: createdAt
    });

    // Parse items
    if (consolidatedItems) {
      const tokens = consolidatedItems.split(';').map(t => t.trim()).filter(Boolean);
      for (const tok of tokens) {
        const match = tok.match(/^(\d+)\s*x\s*(.*)$/i);
        let qty = 1;
        let itemName = tok;
        if (match) {
          qty = parseInt(match[1], 10) || 1;
          itemName = match[2].trim();
        }

        const matched = menuMap.get(itemName.toLowerCase().trim());
        const unitPrice = matched ? matched.price : 0;

        parsedItems.push({
          id: crypto.randomUUID(),
          order_id: orderId,
          item_name: itemName,
          quantity: qty,
          unit_price: unitPrice,
          line_total: unitPrice * qty,
          menu_item_id: matched ? matched.id : null,
          created_at: createdAt
        });
      }
    }
  }

  console.log(`Parsed ${parsedOrders.length} orders and ${parsedItems.length} items.`);

  // Batch insert orders in chunks of 50
  const BATCH_SIZE = 50;
  let ordersSuccess = 0;
  let itemsSuccess = 0;

  for (let i = 0; i < parsedOrders.length; i += BATCH_SIZE) {
    const orderBatch = parsedOrders.slice(i, i + BATCH_SIZE);
    const orderIds = new Set(orderBatch.map(o => o.id));
    const itemBatch = parsedItems.filter(item => orderIds.has(item.order_id));

    // Prepare payload without extra internal fields
    const ordersToInsert = orderBatch.map(({ final_ticket_status, ...rest }) => rest);

    const { error: oErr } = await supabase.from('orders').insert(ordersToInsert);
    if (oErr) {
      console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} orders error:`, oErr.message);
      continue;
    }
    ordersSuccess += orderBatch.length;

    // Insert items for this batch
    if (itemBatch.length > 0) {
      const { error: iErr } = await supabase.from('order_items').insert(itemBatch);
      if (iErr) {
        console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} items error:`, iErr.message);
      } else {
        itemsSuccess += itemBatch.length;
      }
    }

    // Update ticket_status to final status
    const closedIds = orderBatch.filter(o => o.final_ticket_status === 'CLOSED').map(o => o.id);
    const cancelledIds = orderBatch.filter(o => o.final_ticket_status === 'CANCELLED').map(o => o.id);

    if (closedIds.length > 0) {
      await supabase.from('orders').update({ ticket_status: 'CLOSED' }).in('id', closedIds);
    }
    if (cancelledIds.length > 0) {
      await supabase.from('orders').update({ ticket_status: 'CANCELLED' }).in('id', cancelledIds);
    }

    process.stdout.write(`Processed ${Math.min(i + BATCH_SIZE, parsedOrders.length)} / ${parsedOrders.length} orders...\r`);
  }

  console.log(`\n\n🎉 Import Complete!`);
  console.log(`Total Orders inserted: ${ordersSuccess} / ${parsedOrders.length}`);
  console.log(`Total Items inserted: ${itemsSuccess} / ${parsedItems.length}`);
}

main().catch(console.error);
