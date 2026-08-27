import { createClient } from '@insforge/sdk';
import assert from 'assert';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

console.log('🧪 Testing: Closed Section Shows ONLY Final Bill With ALL Merged Items from All Rounds');

function parseNotesMetadata(notes, order = {}) {
  const result = { type: 'pickup', tableNumber: '' };
  if (notes && notes.includes('[DELIVERY]')) result.type = 'delivery';
  if (notes && notes.includes('[TABLE:')) {
    result.type = 'table';
    const m = notes.match(/\[TABLE:\s*([^\]]+)\]/i);
    if (m) result.tableNumber = m[1].trim();
  }
  return result;
}

function consolidateOrderItems(items) {
  if (!items || !items.length) return [];
  const map = new Map();
  for (const i of items) {
    const name = (i.item_name || i.name || '').trim();
    if (!name) continue;
    const price = Number(i.unit_price || i.price || 0);
    const qty = Number(i.quantity || i.qty || 1);
    const lineTotal = Number(i.line_total || (price * qty) || 0);
    const key = `${name.toLowerCase()}__${price}`;
    if (map.has(key)) {
      const existing = map.get(key);
      existing.quantity += qty;
      existing.qty = existing.quantity;
      existing.line_total += lineTotal;
    } else {
      map.set(key, {
        ...i,
        item_name: name,
        name: name,
        unit_price: price,
        price: price,
        quantity: qty,
        qty: qty,
        line_total: lineTotal
      });
    }
  }
  return Array.from(map.values());
}

function getItemsForOrder(orderId, allOrders, allOrderItems) {
  const primaryItems = allOrderItems.filter(i => i.order_id === orderId);
  const targetOrder = allOrders.find(o => o.id === orderId);
  if (!targetOrder) return primaryItems;

  const parsed = parseNotesMetadata(targetOrder.notes, targetOrder);
  const tableNum = parsed.tableNumber || targetOrder.table_number;
  const isTable = parsed.type === 'table' || targetOrder.order_type === 'table' || Boolean(tableNum);

  if (isTable && targetOrder.notes && (targetOrder.notes.includes('[FINAL_BILL]') || targetOrder.notes.includes('[KOTS:'))) {
    const tTime = new Date(targetOrder.created_at).getTime();
    const siblingOrders = allOrders.filter(sibling => {
      if (sibling.id === orderId) return false;
      const sParsed = parseNotesMetadata(sibling.notes, sibling);
      const sTableNum = sParsed.tableNumber || sibling.table_number;
      if (String(sTableNum) === String(tableNum)) {
        const sTime = new Date(sibling.created_at).getTime();
        return Math.abs(tTime - sTime) <= 12 * 3600 * 1000;
      }
      return false;
    });

    if (siblingOrders.length > 0) {
      const siblingIds = new Set(siblingOrders.map(s => s.id));
      const siblingItems = allOrderItems.filter(i => siblingIds.has(i.order_id));
      return [...primaryItems, ...siblingItems];
    }
  }

  return primaryItems;
}

function getConsolidatedClosedBills(ordersList) {
  if (!ordersList || !ordersList.length) return [];
  const result = [];
  const handledOrderIds = new Set();
  const tableOrders = [];
  
  for (const o of ordersList) {
    const parsed = parseNotesMetadata(o.notes, o);
    const tableNum = parsed.tableNumber || o.table_number;
    const isTable = parsed.type === 'table' || o.order_type === 'table' || Boolean(tableNum);
    if (!isTable) result.push(o);
    else tableOrders.push(o);
  }

  const finalBills = tableOrders.filter(o => (o.notes || '').includes('[FINAL_BILL]'));
  for (const fb of finalBills) {
    if (handledOrderIds.has(fb.id)) continue;
    handledOrderIds.add(fb.id);

    const parsed = parseNotesMetadata(fb.notes, fb);
    const tableNum = parsed.tableNumber || fb.table_number;
    const fbTime = new Date(fb.created_at).getTime();

    tableOrders.forEach(sibling => {
      if (handledOrderIds.has(sibling.id)) return;
      const sParsed = parseNotesMetadata(sibling.notes, sibling);
      const sTableNum = sParsed.tableNumber || sibling.table_number;
      if (String(sTableNum) === String(tableNum)) {
        const sTime = new Date(sibling.created_at).getTime();
        if (Math.abs(fbTime - sTime) <= 12 * 3600 * 1000) {
          handledOrderIds.add(sibling.id);
        }
      }
    });

    result.push(fb);
  }

  return result;
}

async function run() {
  const testTable = 99;
  const createdOrderIds = [];

  try {
    // 1. Create Round 1 order for Table 99: 2 Biryani @ 200, 2 Naan @ 50
    console.log('1. Creating Round 1 for Table 99 (2x Biryani, 2x Naan)...');
    const { data: ord1 } = await insforge.database.from('orders').insert([{
      order_number: 9901,
      customer_name: 'Diner Table 99',
      customer_phone: '9988776655',
      order_type: 'table',
      table_number: testTable,
      total_amount: 500,
      status: 'hold',
      payment_status: 'unpaid',
      notes: `[TABLE: ${testTable}] [KOT #101]`
    }]).select().single();
    createdOrderIds.push(ord1.id);

    await insforge.database.from('order_items').insert([
      { order_id: ord1.id, item_name: 'Chicken Biryani', quantity: 2, unit_price: 200, line_total: 400 },
      { order_id: ord1.id, item_name: 'Butter Naan', quantity: 2, unit_price: 50, line_total: 100 }
    ]);

    // 2. Create Round 2 order for Table 99: 2 Naan @ 50, 1 Paneer Tikka @ 200
    console.log('2. Creating Round 2 for Table 99 (2x Naan, 1x Paneer Tikka)...');
    const { data: ord2 } = await insforge.database.from('orders').insert([{
      order_number: 9905,
      customer_name: 'Diner Table 99',
      customer_phone: '9988776655',
      order_type: 'table',
      table_number: testTable,
      total_amount: 300,
      status: 'hold',
      payment_status: 'unpaid',
      notes: `[TABLE: ${testTable}] [KOT #105]`
    }]).select().single();
    createdOrderIds.push(ord2.id);

    await insforge.database.from('order_items').insert([
      { order_id: ord2.id, item_name: 'Butter Naan', quantity: 2, unit_price: 50, line_total: 100 },
      { order_id: ord2.id, item_name: 'Paneer Tikka', quantity: 1, unit_price: 200, line_total: 200 }
    ]);

    // 3. Simulate Create Final Bill settlement
    console.log('3. Settling Table 99 session with Final Bill (Total ₹800 + tax)...');
    await insforge.database.from('orders').update({
      total_amount: 840, // 800 + 5% GST
      status: 'delivered',
      payment_status: 'paid',
      notes: `[TABLE: ${testTable}] [FINAL_BILL] [KOTS: #9901 + #9905] [CGST: 2.5%] [SGST: 2.5%] [PAYMENT: cash]`
    }).eq('id', ord1.id);

    await insforge.database.from('orders').update({
      status: 'delivered',
      payment_status: 'paid'
    }).eq('id', ord2.id);

    // 4. Fetch orders and order_items from DB
    const { data: allOrders } = await insforge.database.from('orders').select('*').in('id', createdOrderIds);
    const { data: allOrderItems } = await insforge.database.from('order_items').select('*').in('order_id', createdOrderIds);

    // 5. Verify Close Section shows ONLY the Final Bill
    const closedBills = getConsolidatedClosedBills(allOrders);
    console.log(`4. Closed bills count: ${closedBills.length} (Expected: 1)`);
    assert.strictEqual(closedBills.length, 1, 'Close section must display ONLY 1 Final Bill');
    const finalBill = closedBills[0];
    assert.strictEqual(finalBill.id, ord1.id, 'Final bill should be the primary order');

    // 6. Verify Final Bill contains ALL MERGED ITEMS from all rounds
    const rawItems = getItemsForOrder(finalBill.id, allOrders, allOrderItems);
    const mergedDishes = consolidateOrderItems(rawItems);

    console.log('5. Merged Dishes in Final Bill:');
    mergedDishes.forEach(d => console.log(`   • ${d.quantity}x ${d.item_name} @ ₹${d.unit_price} = ₹${d.line_total}`));

    assert.strictEqual(mergedDishes.length, 3, 'Must contain 3 distinct menu dishes');
    
    const biryani = mergedDishes.find(d => d.item_name === 'Chicken Biryani');
    assert(biryani && biryani.quantity === 2, 'Should have 2x Chicken Biryani from Round 1');

    const naan = mergedDishes.find(d => d.item_name === 'Butter Naan');
    assert(naan && naan.quantity === 4, 'Should have 4x Butter Naan merged from Round 1 (2) + Round 2 (2)');

    const tikka = mergedDishes.find(d => d.item_name === 'Paneer Tikka');
    assert(tikka && tikka.quantity === 1, 'Should have 1x Paneer Tikka from Round 2');

    console.log('✅ ALL ITEMS AND MERGED QUANTITIES VERIFIED IN FINAL BILL!');

  } finally {
    console.log('6. Cleaning up test orders...');
    if (createdOrderIds.length) {
      await insforge.database.from('order_items').delete().in('order_id', createdOrderIds);
      await insforge.database.from('orders').delete().in('id', createdOrderIds);
      console.log('✅ Cleaned up.');
    }
  }

  console.log('\n🎉 ALL MERGED ITEMS IN FINAL BILL VERIFICATION PASSED!');
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
