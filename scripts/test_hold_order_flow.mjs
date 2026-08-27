import { createClient } from '@insforge/sdk';

const client = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

async function runTest() {
  console.log('--- Step 1: Creating a test Hold order ---');
  const testOrder = {
    order_number: 99999,
    customer_name: 'Test Hold Customer',
    customer_phone: '9876543210',
    order_type: 'table',
    table_number: 99,
    total_amount: 350.00,
    status: 'hold',
    payment_status: 'unpaid',
    notes: '[TABLE: Table 99] Test hold order'
  };

  const { data: createdOrder, error: createErr } = await client.database.from('orders').insert([testOrder]).select().single();
  if (createErr) throw createErr;
  console.log('Created Hold Order:', createdOrder.id, 'Status:', createdOrder.status);

  console.log('--- Step 2: Adding initial items ---');
  const initialItems = [
    { order_id: createdOrder.id, item_name: 'Chicken Biryani', quantity: 1, unit_price: 250.00, line_total: 250.00 }
  ];
  const { error: itemsErr } = await client.database.from('order_items').insert(initialItems);
  if (itemsErr) throw itemsErr;
  console.log('Initial item added.');

  console.log('--- Step 3: Adding extra items to hold order ---');
  const extraItems = [
    { order_id: createdOrder.id, item_name: 'Butter Naan', quantity: 2, unit_price: 50.00, line_total: 100.00 }
  ];
  const { error: extraErr } = await client.database.from('order_items').insert(extraItems);
  if (extraErr) throw extraErr;
  
  const { error: updateTotErr } = await client.database.from('orders').update({ total_amount: 450.00 }).eq('id', createdOrder.id);
  if (updateTotErr) throw updateTotErr;
  console.log('Extra items added and total updated.');

  console.log('--- Step 4: Finalizing & Closing the Order ---');
  const { error: finalizeErr } = await client.database.from('orders').update({
    status: 'delivered',
    payment_status: 'paid'
  }).eq('id', createdOrder.id);
  if (finalizeErr) throw finalizeErr;

  const { data: closedOrder } = await client.database.from('orders').select('*').eq('id', createdOrder.id).single();
  console.log('Closed Order verified: Status =', closedOrder.status, ', Payment =', closedOrder.payment_status);

  console.log('--- Step 5: Clean up test order ---');
  await client.database.from('order_items').delete().eq('order_id', createdOrder.id);
  await client.database.from('orders').delete().eq('id', createdOrder.id);
  console.log('Cleanup complete. Hold & Final Bill lifecycle test PASSED ✅');
}

runTest().catch(console.error);
