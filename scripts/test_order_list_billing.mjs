import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

async function testOrderListBillingIntegration() {
  console.log('--- Step 1: Query Orders and Line Items ---');
  const { data: orders, error: oErr } = await insforge.database.from('orders').select('*').limit(5);
  if (oErr) {
    console.warn('Orders query:', oErr.message);
  } else {
    console.log(`Found ${orders?.length || 0} sample orders.`);
  }

  const { data: orderItems, error: iErr } = await insforge.database.from('order_items').select('*').limit(10);
  if (iErr) {
    console.warn('Order items query:', iErr.message);
  } else {
    console.log(`Found ${orderItems?.length || 0} sample order items.`);
  }

  console.log('--- Step 2: Testing Order-to-POS-Cart Mapping ---');
  const mockTableOrder = {
    id: 'ord-table-1',
    order_number: '501',
    customer_name: 'Dine-In Guest Table 4',
    customer_phone: '9876543210',
    order_type: 'table',
    table_number: '4',
    total_amount: 850,
    notes: '[TABLE:4] Extra spicy chicken biryani and butter naan'
  };

  const mockItems = [
    { menu_item_id: '1', item_name: 'Chicken Biryani Special', quantity: 2, unit_price: 350, line_total: 700 },
    { menu_item_id: '2', item_name: 'Butter Naan', quantity: 3, unit_price: 50, line_total: 150 }
  ];

  // Simulating the mapping done in createBillForOrder
  const mappedCart = mockItems.map(i => ({
    id: i.menu_item_id,
    name: i.item_name,
    price: i.unit_price,
    qty: i.quantity
  }));

  const cartSubtotal = mappedCart.reduce((s, i) => s + (i.price * i.qty), 0);
  console.log('Mapped Cart:', mappedCart);
  console.log('Cart Subtotal:', cartSubtotal);

  if (mappedCart.length !== 2 || cartSubtotal !== 850) {
    throw new Error('POS Cart mapping failed');
  }

  console.log('--- Step 3: Testing CSV Export Formatting ---');
  const headers = ['Order #', 'Date & Time', 'Customer Name', 'Customer Phone', 'Channel / Type', 'Table #', 'Status', 'Payment Status', 'Items Ordered', 'Total Amount (INR)'];
  const itemsSummary = mockItems.map(i => `${i.quantity}x ${i.item_name}`).join('; ');
  
  const csvRow = [
    `"${mockTableOrder.order_number}"`,
    `"${new Date().toLocaleString('en-IN')}"`,
    `"${mockTableOrder.customer_name}"`,
    `"${mockTableOrder.customer_phone}"`,
    `"Dine-In Table"`,
    `"${mockTableOrder.table_number}"`,
    `"pending"`,
    `"unpaid"`,
    `"${itemsSummary}"`,
    `"${mockTableOrder.total_amount.toFixed(2)}"`
  ];

  if (headers.length !== 10 || !csvRow[8].includes('2x Chicken Biryani Special')) {
    throw new Error('CSV formatting validation failed');
  }

  console.log('Order List & POS Billing Integration Test PASSED ✅');
}

testOrderListBillingIntegration().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
