import { createClient } from '@insforge/sdk';
import assert from 'assert';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

console.log('🧪 Running Test: Table Multi-Round Order Accumulation, Settlement & Closed Orders View');

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

async function run() {
  const testTable = 88; // Unique test table number
  let createdOrderId = null;

  try {
    // 1. Place Initial Order (Round 1) for Table 88
    console.log('1. Placing Round 1 for Table 88 (1x Chicken Biryani @ 200, 1x Cola @ 40)...');
    const { data: initialOrder, error: oErr } = await insforge.database
      .from('orders')
      .insert([{
        order_number: 8801,
        customer_name: 'Diner Round 1',
        customer_phone: '9998887776',
        order_type: 'table',
        table_number: testTable,
        total_amount: 240.00,
        status: 'hold',
        payment_status: 'unpaid',
        notes: `[TABLE: ${testTable}] [PAYMENT: cash]`
      }])
      .select()
      .single();

    if (oErr) throw oErr;
    createdOrderId = initialOrder.id;

    // Insert Round 1 items
    await insforge.database.from('order_items').insert([
      { order_id: createdOrderId, item_name: 'Chicken Biryani', quantity: 1, unit_price: 200, line_total: 200 },
      { order_id: createdOrderId, item_name: 'Cola', quantity: 1, unit_price: 40, line_total: 40 }
    ]);
    console.log(`✅ Round 1 created. Order ID: ${createdOrderId}, Total: ₹${initialOrder.total_amount}`);

    // 2. Simulate Customer Ordering Round 2 from Table 88 (2x Butter Naan @ 40, 1x Chicken Biryani @ 200)
    console.log('2. Placing Round 2 for Table 88 (2x Butter Naan @ 40, 1x Chicken Biryani @ 200)...');
    const round2Items = [
      { item_name: 'Butter Naan', quantity: 2, unit_price: 40, line_total: 80 },
      { item_name: 'Chicken Biryani', quantity: 1, unit_price: 200, line_total: 200 }
    ];

    // Check active order for table 88
    const { data: activeOrders } = await insforge.database
      .from('orders')
      .select('*')
      .eq('table_number', testTable)
      .in('status', ['hold', 'confirmed', 'pending'])
      .order('created_at', { ascending: false })
      .limit(1);

    assert(activeOrders && activeOrders.length > 0, 'Must find active order for Table 88');
    const targetOrder = activeOrders[0];
    assert.strictEqual(targetOrder.id, createdOrderId, 'Target order should match Round 1 order ID');

    // Accumulate items into existing order
    const round2Rows = round2Items.map(i => ({
      order_id: targetOrder.id,
      item_name: i.item_name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      line_total: i.line_total
    }));
    await insforge.database.from('order_items').insert(round2Rows);

    const round2AddedTotal = round2Items.reduce((s, i) => s + i.line_total, 0);
    const accumulatedTotal = Number(targetOrder.total_amount) + round2AddedTotal;

    await insforge.database.from('orders').update({
      total_amount: accumulatedTotal,
      notes: `${targetOrder.notes} | [ADDITIONAL_ROUND]`
    }).eq('id', targetOrder.id);

    console.log(`✅ Round 2 accumulated. New Table 88 total: ₹${accumulatedTotal} (Expected: ₹520)`);
    assert.strictEqual(accumulatedTotal, 520, 'Accumulated total should be 240 + 280 = 520');

    // 3. Test Item Consolidation (merging duplicates across rounds)
    const { data: allOrderItems } = await insforge.database
      .from('order_items')
      .select('*')
      .eq('order_id', createdOrderId);

    assert.strictEqual(allOrderItems.length, 4, 'Should have 4 individual item records in DB');

    const consolidated = consolidateOrderItems(allOrderItems);
    console.log('3. Consolidating all items for final bill output:');
    consolidated.forEach(i => console.log(`   • ${i.quantity}x ${i.item_name} @ ₹${i.unit_price} = ₹${i.line_total}`));

    assert.strictEqual(consolidated.length, 3, 'Should consolidate duplicate Chicken Biryani into 3 unique menu items');
    const biryaniItem = consolidated.find(i => i.item_name === 'Chicken Biryani');
    assert(biryaniItem, 'Must contain Chicken Biryani');
    assert.strictEqual(biryaniItem.quantity, 2, 'Chicken Biryani quantity should be 1 + 1 = 2');
    assert.strictEqual(biryaniItem.line_total, 400, 'Chicken Biryani line total should be 400');

    // 4. Settle and Close Table 88 Order
    console.log('4. Settling and generating final bill for Table 88...');
    await insforge.database.from('orders').update({
      status: 'delivered',
      payment_status: 'paid'
    }).eq('id', createdOrderId);

    // 5. Verify Closed Orders view
    const { data: closedOrder } = await insforge.database
      .from('orders')
      .select('*')
      .eq('id', createdOrderId)
      .single();

    assert.strictEqual(closedOrder.status, 'delivered');
    assert.strictEqual(closedOrder.payment_status, 'paid');
    assert.strictEqual(Number(closedOrder.total_amount), 520);
    console.log(`✅ Closed order verified as 1 unified final bill: #${closedOrder.order_number} for ₹${closedOrder.total_amount}`);

  } finally {
    // Clean up
    if (createdOrderId) {
      console.log('5. Cleaning up test order...');
      await insforge.database.from('order_items').delete().eq('order_id', createdOrderId);
      await insforge.database.from('orders').delete().eq('id', createdOrderId);
      console.log('✅ Test order deleted.');
    }
  }

  console.log('\n🎉 ALL TABLE MULTI-ROUND ACCUMULATION & UNIFIED CLOSED BILL TESTS PASSED!');
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
