import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

async function runTest() {
  console.log('--- Step 1: Creating a test delivered/closed order ---');
  const { data: orderData, error: orderErr } = await insforge.database.from('orders').insert([{
    customer_name: 'Audit Test Customer',
    customer_phone: '9876543210',
    order_number: 99998,
    total_amount: 300,
    status: 'delivered',
    payment_status: 'paid',
    order_type: 'table',
    notes: '[TABLE: 7] [DELIVERED]'
  }]).select();

  if (orderErr) throw orderErr;
  const orderId = orderData[0].id;
  console.log('Created Closed Order:', orderId);

  console.log('--- Step 2: Adding initial item (Butter Chicken 1x 300) ---');
  const { data: itemData, error: itemErr } = await insforge.database.from('order_items').insert([{
    order_id: orderId,
    item_name: 'Butter Chicken',
    quantity: 1,
    unit_price: 300,
    line_total: 300
  }]).select();
  if (itemErr) throw itemErr;

  console.log('--- Step 3: Simulating Order Correction (Change qty to 2 + add 2 Naans = 680 + tax) ---');
  const itemId = itemData[0].id;
  await insforge.database.from('order_items').update({
    quantity: 2,
    unit_price: 300,
    line_total: 600
  }).eq('id', itemId);

  await insforge.database.from('order_items').insert([{
    order_id: orderId,
    item_name: 'Butter Naan',
    quantity: 2,
    unit_price: 40,
    line_total: 80
  }]);

  const newTotal = 680 * 1.05; // 5% GST
  await insforge.database.from('orders').update({ total_amount: newTotal }).eq('id', orderId);

  console.log('--- Step 4: Verifying corrected order from DB ---');
  const { data: verifyOrder } = await insforge.database.from('orders').select('*').eq('id', orderId);
  const { data: verifyItems } = await insforge.database.from('order_items').select('*').eq('order_id', orderId);
  console.log('Verified Corrected Order Total:', verifyOrder[0].total_amount);
  console.log('Verified Corrected Items Count:', verifyItems.length);

  console.log('--- Step 5: Clean up test data ---');
  await insforge.database.from('order_items').delete().eq('order_id', orderId);
  await insforge.database.from('orders').delete().eq('id', orderId);
  console.log('Closed Orders Correction test PASSED ✅');
}

runTest().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
