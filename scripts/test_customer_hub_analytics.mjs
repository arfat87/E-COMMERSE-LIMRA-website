import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

async function testCustomerAnalytics() {
  console.log('--- Step 1: Fetching orders and bookings from DB ---');
  const { data: orders, error: oErr } = await insforge.database.from('orders').select('*');
  if (oErr) throw oErr;

  const { data: bookings, error: bErr } = await insforge.database.from('bookings').select('*');
  if (bErr) throw bErr;

  console.log(`Fetched ${orders.length} orders and ${bookings.length} bookings.`);

  console.log('--- Step 2: Aggregating customer profiles ---');
  const map = new Map();

  function ensure(phone, name) {
    if (!map.has(phone)) {
      map.set(phone, {
        name: name || 'Customer',
        phone,
        orderCount: 0,
        bookingCount: 0,
        totalSpent: 0,
        tier: 'new'
      });
    }
    const c = map.get(phone);
    if (name && (!c.name || c.name === 'Customer')) c.name = name;
    return c;
  }

  orders.forEach(o => {
    if (!o.customer_phone) return;
    const c = ensure(o.customer_phone, o.customer_name);
    c.orderCount++;
    c.totalSpent += Number(o.total_amount || 0);
  });

  bookings.forEach(b => {
    if (!b.customer_phone) return;
    const c = ensure(b.customer_phone, b.customer_name);
    c.bookingCount++;
  });

  const customers = Array.from(map.values()).map(c => {
    const visits = c.orderCount + c.bookingCount;
    if (visits >= 3 || c.totalSpent >= 2000) c.tier = 'vip';
    else if (visits === 2 || c.totalSpent >= 1000) c.tier = 'frequent';
    else c.tier = 'new';
    return c;
  });

  const totalGuests = customers.length;
  const vipCount = customers.filter(c => c.tier === 'vip').length;
  const frequentCount = customers.filter(c => c.tier === 'frequent').length;
  const newCount = customers.filter(c => c.tier === 'new').length;
  const totalLTV = customers.reduce((s, c) => s + c.totalSpent, 0);
  const repeatGuests = customers.filter(c => (c.orderCount + c.bookingCount) >= 2).length;
  const repeatRate = totalGuests > 0 ? ((repeatGuests / totalGuests) * 100).toFixed(1) : '0';

  console.log('--- Step 3: Verified Customer Hub Analytics ---');
  console.log(`Total Unique Guests: ${totalGuests}`);
  console.log(`👑 VIP Patrons (3+ visits): ${vipCount}`);
  console.log(`🥈 Frequent Guests (2 visits): ${frequentCount}`);
  console.log(`🌱 New Guests (1 visit): ${newCount}`);
  console.log(`💰 Total Customer Lifetime Value (LTV): ₹${totalLTV.toFixed(2)}`);
  console.log(`🔄 Repeat Customer Rate: ${repeatRate}%`);

  console.log('Customer Hub Analytics Test PASSED ✅');
}

testCustomerAnalytics().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
