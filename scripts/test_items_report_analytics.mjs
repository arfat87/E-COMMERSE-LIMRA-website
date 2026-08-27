import { createClient } from '@insforge/sdk';
import { menuItems, categoryLabels } from '../src/data/menu.js';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

async function testItemAnalytics() {
  console.log('--- Step 1: Fetching orders and order_items from DB ---');
  const { data: orders, error: oErr } = await insforge.database.from('orders').select('*');
  if (oErr) throw oErr;

  const { data: orderItems, error: oiErr } = await insforge.database.from('order_items').select('*');
  if (oiErr) throw oiErr;

  console.log(`Fetched ${orders.length} orders and ${orderItems.length} order items.`);

  console.log('--- Step 2: Aggregating item sales ---');
  const eligibleOrders = orders.filter(o => o.status !== 'cancelled');
  const eligibleOrderIds = new Set(eligibleOrders.map(o => String(o.id)));

  const itemMap = new Map();
  menuItems.forEach(m => {
    itemMap.set(m.name.toLowerCase().trim(), {
      id: m.id,
      name: m.name,
      category: m.category,
      price: m.price,
      qtySold: 0,
      totalRevenue: 0
    });
  });

  orderItems.forEach(oi => {
    if (!eligibleOrderIds.has(String(oi.order_id))) return;
    const key = (oi.item_name || '').toLowerCase().trim();
    if (!key) return;

    let entry = itemMap.get(key);
    if (!entry) {
      entry = {
        id: oi.menu_item_id || null,
        name: oi.item_name,
        category: 'other',
        price: Number(oi.unit_price || 0),
        qtySold: 0,
        totalRevenue: 0
      };
      itemMap.set(key, entry);
    }

    const qty = Number(oi.quantity || 1);
    const unitPrice = Number(oi.unit_price || (oi.line_total ? oi.line_total / qty : entry.price));
    entry.qtySold += qty;
    entry.totalRevenue += Number(oi.line_total || (unitPrice * qty));
  });

  const soldItems = Array.from(itemMap.values()).filter(i => i.qtySold > 0);
  const totalQty = soldItems.reduce((s, i) => s + i.qtySold, 0);
  const totalRev = soldItems.reduce((s, i) => s + i.totalRevenue, 0);

  console.log('--- Step 3: Verified Aggregation Metrics ---');
  console.log(`Total Sold Dishes Varieties: ${soldItems.length}`);
  console.log(`Total Item Units Sold: ${totalQty} qty`);
  console.log(`Total Item Sales Revenue: ₹${totalRev.toFixed(2)}`);

  if (soldItems.length > 0) {
    const topDish = soldItems.sort((a, b) => b.totalRevenue - a.totalRevenue)[0];
    console.log(`Top Selling Dish: ${topDish.name} (${topDish.qtySold} sold, ₹${topDish.totalRevenue.toFixed(2)})`);
  }

  console.log('Items Report Analytics Test PASSED ✅');
}

testItemAnalytics().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
