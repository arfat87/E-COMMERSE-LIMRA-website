import dotenv from "dotenv";
dotenv.config();
import { supabase } from "../backend/api/lib/supabase.js";
import fs from "fs";

// 1. Read CSV from file or string
const csvData = fs.readFileSync(new URL("./september_orders.csv", import.meta.url), "utf8");

function parseCSVLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
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
  // Format: "1/9/2026, 12:56:07" (D/M/YYYY, HH:mm:ss)
  const clean = dtStr.replace(/"/g, '').trim();
  const [dPart, tPart] = clean.split(',').map(s => s.trim());
  if (!dPart) return new Date().toISOString();
  const [day, month, year] = dPart.split('/').map(Number);
  const [hours, minutes, seconds] = (tPart || "00:00:00").split(':').map(Number);
  // IST is UTC+5:30 -> construct ISO in UTC or offset
  const dateObj = new Date(Date.UTC(year, month - 1, day, hours - 5, minutes - 30, seconds || 0));
  return dateObj.toISOString();
}

async function run() {
  console.log("Starting September orders import...");
  const lines = csvData.split(/\r?\n/).filter(l => l.trim().length > 0);
  const header = parseCSVLine(lines[0]);
  console.log("Header:", header);

  const rows = lines.slice(1);
  console.log(`Found ${rows.length} records to import.`);

  let insertedOrders = 0;
  let insertedItems = 0;
  let skipped = 0;

  for (let idx = 0; idx < rows.length; idx++) {
    const cols = parseCSVLine(rows[idx]);
    if (cols.length < 15) {
      console.warn(`Line ${idx + 2} has incomplete columns (${cols.length}), skipping.`);
      skipped++;
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

    const orderNumber = parseInt(orderNumberRaw, 10);
    const createdAt = parseDateTime(dateTimeRaw);
    const orderType = orderTypeRaw.toLowerCase().trim() || 'table';
    const status = statusRaw.toLowerCase().trim() || 'delivered';
    const paymentStatus = paymentStatusRaw.toLowerCase().trim() || 'paid';

    // Parse table number if applicable
    let tableNum = null;
    if (tableRaw) {
      const match = tableRaw.match(/\d+/);
      if (match) tableNum = parseInt(match[0], 10);
    }

    // Insert order first with ticket_status = 'BILLED' (or 'PAID') so trigger doesn't block order_items
    const orderPayload = {
      order_number: orderNumber,
      customer_name: custName || 'Guest',
      customer_phone: custPhone || '',
      order_type: orderType,
      table_number: tableNum,
      status: status,
      payment_status: paymentStatus,
      payment_method: paymentMode || 'cash',
      total_amount: parseFloat(totalAmount) || 0,
      ticket_status: 'PAID', // Start with PAID to allow items insertion
      notes: `Imported September 2026 record. GST: ${totalGst}`,
      created_at: createdAt,
      updated_at: createdAt
    };

    const { data: newOrder, error: orderErr } = await supabase
      .from('orders')
      .insert(orderPayload)
      .select('id')
      .single();

    if (orderErr) {
      console.error(`Error inserting order #${orderNumber} (${dateTimeRaw}):`, orderErr.message);
      skipped++;
      continue;
    }

    const orderId = newOrder.id;
    insertedOrders++;

    // Parse consolidated items: e.g. "1x COLD DRINGS; 1x Hyderabadi Chicken Biryani (Full); 1x Water 500ml"
    if (consolidatedItems) {
      const itemTokens = consolidatedItems.split(';').map(s => s.trim()).filter(Boolean);
      const itemsToInsert = [];

      for (const token of itemTokens) {
        const itemMatch = token.match(/^(\d+)x\s+(.*)$/i);
        let qty = 1;
        let itemName = token;
        if (itemMatch) {
          qty = parseInt(itemMatch[1], 10) || 1;
          itemName = itemMatch[2].trim();
        }

        itemsToInsert.push({
          order_id: orderId,
          item_name: itemName,
          quantity: qty,
          unit_price: 0, // Calculated or default
          line_total: 0,
          created_at: createdAt
        });
      }

      if (itemsToInsert.length > 0) {
        const { error: itemsErr } = await supabase
          .from('order_items')
          .insert(itemsToInsert);

        if (itemsErr) {
          console.error(`Error inserting items for order ${orderId}:`, itemsErr.message);
        } else {
          insertedItems += itemsToInsert.length;
        }
      }
    }

    // Now update ticket_status to 'CLOSED' if delivered/paid
    if (status === 'delivered') {
      await supabase
        .from('orders')
        .update({ ticket_status: 'CLOSED' })
        .eq('id', orderId);
    }
  }

  console.log(`\nImport completed!`);
  console.log(`Inserted Orders: ${insertedOrders}`);
  console.log(`Inserted Items: ${insertedItems}`);
  console.log(`Skipped: ${skipped}`);
}

run().catch(console.error);
