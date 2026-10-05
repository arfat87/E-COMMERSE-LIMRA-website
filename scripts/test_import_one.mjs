import dotenv from "dotenv";
dotenv.config();
import { supabase } from "../backend/api/lib/supabase.js";
import { menuItems } from "../frontend/src/data/menu.js";

// Lookup map for menu items
const menuMap = new Map();
for (const item of menuItems) {
  menuMap.set(item.name.toLowerCase().trim(), item);
}

console.log(`Loaded ${menuMap.size} menu items for matching.`);

async function testOne() {
  const createdAt = "2026-09-01T12:56:07+05:30";
  const orderPayload = {
    order_number: 6,
    customer_name: "manik mandal",
    customer_phone: "7363975172",
    order_type: "table",
    table_number: 1,
    status: "delivered",
    payment_status: "paid",
    payment_method: "cash",
    total_amount: 351.75,
    ticket_status: "PAID",
    notes: "Food Taxable: 335, Total GST: 16.75",
    created_at: createdAt,
    updated_at: createdAt
  };

  const { data: newOrder, error: orderErr } = await supabase
    .from("orders")
    .insert(orderPayload)
    .select("id")
    .single();

  if (orderErr) {
    console.error("Order Insert Error:", orderErr);
    return;
  }

  console.log("Inserted order successfully, id:", newOrder.id);

  // Items: "1x COLD DRINGS; 1x Hyderabadi Chicken Biryani (Full); 1x Water 500ml; 1x Water 1 Litre; 1x Chilli Chicken (Bone)"
  const rawItems = [
    { qty: 1, name: "COLD DRINGS" },
    { qty: 1, name: "Hyderabadi Chicken Biryani (Full)" },
    { qty: 1, name: "Water 500ml" },
    { qty: 1, name: "Water 1 Litre" },
    { qty: 1, name: "Chilli Chicken (Bone)" }
  ];

  const itemsToInsert = rawItems.map(i => {
    const matched = menuMap.get(i.name.toLowerCase().trim());
    const unitPrice = matched ? matched.price : 0;
    return {
      order_id: newOrder.id,
      item_name: i.name,
      quantity: i.qty,
      unit_price: unitPrice,
      line_total: unitPrice * i.qty,
      menu_item_id: matched ? matched.id : null,
      created_at: createdAt
    };
  });

  const { error: itemsErr } = await supabase
    .from("order_items")
    .insert(itemsToInsert);

  if (itemsErr) {
    console.error("Items Insert Error:", itemsErr);
  } else {
    console.log("Inserted 5 order items successfully!");
  }

  // Update ticket_status to CLOSED
  const { error: updateErr } = await supabase
    .from("orders")
    .update({ ticket_status: "CLOSED" })
    .eq("id", newOrder.id);

  if (updateErr) {
    console.error("Update Ticket Status Error:", updateErr);
  } else {
    console.log("Ticket status updated to CLOSED successfully!");
  }

  // Clean up test order
  await supabase.from("orders").delete().eq("id", newOrder.id);
  console.log("Test order deleted cleanly.");
}

testOne().catch(console.error);
