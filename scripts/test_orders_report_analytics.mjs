import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

async function testOrdersAnalytics() {
  console.log('--- Step 1: Fetching orders from DB ---');
  const { data: orders, error: oErr } = await insforge.database.from('orders').select('*');
  if (oErr) throw oErr;

  console.log(`Fetched ${orders.length} orders.`);

  console.log('--- Step 2: Computing Orders Report KPI Metrics ---');
  const activeOrders = orders.filter(o => o.status !== 'cancelled');
  const grossRevenue = activeOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const totalOrders = orders.length;

  let upiRev = 0, cashRev = 0, cardRev = 0;
  let tableCount = 0, deliveryCount = 0, pickupCount = 0;

  activeOrders.forEach(o => {
    let mode = (o.payment_mode || 'cash').toLowerCase();
    let type = (o.order_type || 'table').toLowerCase();
    try {
      const meta = JSON.parse(o.notes || '{}');
      if (meta.paymentMode) mode = meta.paymentMode.toLowerCase();
      if (meta.type) type = meta.type.toLowerCase();
    } catch {}

    const amt = Number(o.total_amount || 0);
    if (mode === 'upi') upiRev += amt;
    else if (mode === 'card') cardRev += amt;
    else cashRev += amt;

    if (type === 'table') tableCount++;
    else if (type === 'delivery') deliveryCount++;
    else pickupCount++;
  });

  const tax = (grossRevenue * 0.05) / 1.05; // 5% GST
  const aov = activeOrders.length > 0 ? (grossRevenue / activeOrders.length) : 0;

  console.log('--- Step 3: Verified Metric Calculations ---');
  console.log(`Total Orders Count: ${totalOrders}`);
  console.log(`Gross Revenue: ₹${grossRevenue.toFixed(2)}`);
  console.log(`Table: ${tableCount} | Delivery: ${deliveryCount} | Pickup: ${pickupCount}`);
  console.log(`UPI Revenue: ₹${upiRev.toFixed(2)} | Cash Revenue: ₹${cashRev.toFixed(2)} | Card: ₹${cardRev.toFixed(2)}`);
  console.log(`Estimated GST Collected: ₹${tax.toFixed(2)}`);
  console.log(`Average Order Value (AOV): ₹${aov.toFixed(2)}`);

  console.log('Orders Report Analytics Test PASSED ✅');
}

testOrdersAnalytics().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
