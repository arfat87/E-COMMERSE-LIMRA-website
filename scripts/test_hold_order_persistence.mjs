import { createClient } from '@insforge/sdk';
import assert from 'assert';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

console.log('🧪 Running Test: Hold Order Persistence Across Sync Cycles');

async function run() {
  const testOrderNumber = 9999;
  const testNotes = '[TABLE: 99] [PAYMENT: cash] [CGST: 2.5%] [SGST: 2.5%] Automated Hold Test';

  // 1. Insert a test hold order
  console.log('1. Creating a test hold order in database...');
  const { data: newOrder, error: insertErr } = await insforge.database
    .from('orders')
    .insert([{
      order_number: testOrderNumber,
      customer_name: 'Test Hold Customer',
      customer_phone: '9876543210',
      order_type: 'table',
      table_number: 99,
      total_amount: 250.00,
      status: 'hold',
      payment_status: 'unpaid',
      notes: testNotes
    }])
    .select()
    .single();

  if (insertErr) throw insertErr;
  console.log(`✅ Test order created with ID: ${newOrder.id} and status: ${newOrder.status}`);
  assert.strictEqual(newOrder.status, 'hold', 'Order status should be hold');

  // 2. Simulate 3 consecutive sync fetch cycles
  console.log('2. Simulating multiple background sync queries...');
  for (let i = 1; i <= 3; i++) {
    const { data: fetchedOrder, error: fetchErr } = await insforge.database
      .from('orders')
      .select('*')
      .eq('id', newOrder.id)
      .single();

    if (fetchErr) throw fetchErr;
    console.log(`   Sync cycle ${i}: Order #${fetchedOrder.order_number} status is "${fetchedOrder.status}"`);
    assert.strictEqual(fetchedOrder.status, 'hold', `Status should remain 'hold' on cycle ${i}`);
  }

  // 3. Test getHeldOrders logic
  const { data: allOrders } = await insforge.database
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });

  const heldOrders = (allOrders || []).filter(o => o.status === 'hold');
  const found = heldOrders.find(o => o.id === newOrder.id);
  assert(found, 'Test hold order should be present in heldOrders list');
  console.log(`✅ getHeldOrders correctly identified held order with status: "${found.status}"`);

  // 4. Clean up test order
  console.log('3. Cleaning up test order...');
  await insforge.database.from('orders').delete().eq('id', newOrder.id);
  console.log('✅ Test order deleted.');

  console.log('\n🎉 HOLD ORDER PERSISTENCE TEST PASSED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
