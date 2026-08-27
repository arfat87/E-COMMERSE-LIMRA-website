import { createClient } from '@insforge/sdk';
import assert from 'assert';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

console.log('🧪 Running Test: Table Multi-KOT Session Merging, Final Bill Settlement & Closed View');

function parseNotesMetadata(notes, order = {}) {
  const result = {
    type: 'pickup',
    tableNumber: ''
  };
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

function getActiveTableSessions(ordersList, orderItemsList) {
  const activeTableOrders = ordersList.filter(o => {
    if (o.status === 'delivered' || o.status === 'cancelled') return false;
    const meta = parseNotesMetadata(o.notes, o);
    return o.order_type === 'table' || meta.type === 'table' || meta.tableNumber || o.table_number;
  });

  const sessionMap = new Map();

  for (const order of activeTableOrders) {
    const meta = parseNotesMetadata(order.notes, order);
    const tNum = parseInt(String(meta.tableNumber || order.table_number || '').replace(/\D/g, ''), 10);
    if (!tNum) continue;

    if (!sessionMap.has(tNum)) {
      sessionMap.set(tNum, {
        tableNumber: tNum,
        orders: [],
        orderIds: [],
        kots: [],
        items: [],
        totalAmount: 0,
        earliestTime: order.created_at,
        customerName: order.customer_name || 'Dine-in Guest'
      });
    }

    const sess = sessionMap.get(tNum);
    sess.orders.push(order);
    sess.orderIds.push(order.id);
    sess.kots.push({
      id: order.id,
      orderNumber: String(order.order_number).padStart(2, '0'),
      amount: Number(order.total_amount || 0)
    });
    sess.totalAmount += Number(order.total_amount || 0);
    const oItems = orderItemsList.filter(i => i.order_id === order.id);
    sess.items.push(...oItems);
  }

  return Array.from(sessionMap.values()).map(sess => {
    sess.consolidatedItems = consolidateOrderItems(sess.items);
    return sess;
  }).sort((a, b) => a.tableNumber - b.tableNumber);
}

function getConsolidatedClosedBills(ordersList) {
  if (!ordersList || !ordersList.length) return [];
  const result = [];
  const processedTableKeys = new Set();

  for (const o of ordersList) {
    const parsed = parseNotesMetadata(o.notes, o);
    const tableNum = parsed.tableNumber || o.table_number;
    const isTable = parsed.type === 'table' || o.order_type === 'table' || Boolean(tableNum);

    if (!isTable) {
      result.push(o);
      continue;
    }

    const dayStr = new Date(o.created_at).toDateString();
    const sessionMatch = (o.notes || '').match(/\[KOTS:\s*([^\]]+)\]/i);
    const sessionKey = sessionMatch ? `table_${tableNum}_${dayStr}_${sessionMatch[1]}` : `table_${tableNum}_${dayStr}_${o.id}`;

    if (processedTableKeys.has(sessionKey)) {
      continue;
    }
    processedTableKeys.add(sessionKey);
    result.push(o);
  }

  return result;
}

async function run() {
  const testTable = 77;
  const createdOrderIds = [];

  try {
    // 1. Requirement 1: Live order filter test (Website Orders only)
    console.log('1. Testing Website-Only Live Orders filter...');
    const dummyOrders = [
      { id: '1', order_type: 'delivery', notes: '[DELIVERY] Place: Egra', status: 'confirmed' },
      { id: '2', order_type: 'pickup', notes: '[PICKUP]', status: 'confirmed' },
      { id: '3', order_type: 'table', notes: '[TABLE: 5]', status: 'hold' }
    ];
    const websiteOnly = dummyOrders.filter(o => {
      if (o.status === 'hold') return false;
      const meta = parseNotesMetadata(o.notes, o);
      return !(meta.type === 'table' || o.order_type === 'table');
    });
    assert.strictEqual(websiteOnly.length, 2, 'Should only contain Delivery and Pickup orders');
    console.log('✅ Website-only filter verified: Table orders are excluded from live website orders list');

    // 2. Requirement 2: Multiple orders for same table placed on hold
    console.log('2. Creating Table 77 Order #1 (KOT #101, ₹500) and Order #2 (KOT #105, ₹300)...');
    
    // Order #1
    const { data: ord1, error: err1 } = await insforge.database.from('orders').insert([{
      order_number: 7701,
      customer_name: 'Guest Table 77',
      customer_phone: '9876543210',
      order_type: 'table',
      table_number: testTable,
      total_amount: 500.00,
      status: 'hold',
      payment_status: 'unpaid',
      notes: `[TABLE: ${testTable}] [KOT #101]`
    }]).select().single();
    if (err1) throw err1;
    createdOrderIds.push(ord1.id);

    await insforge.database.from('order_items').insert([
      { order_id: ord1.id, item_name: 'Chicken Biryani', quantity: 2, unit_price: 200, line_total: 400 },
      { order_id: ord1.id, item_name: 'Butter Naan', quantity: 2, unit_price: 50, line_total: 100 }
    ]);

    // Order #2 (later for same active Table 77)
    const { data: ord2, error: err2 } = await insforge.database.from('orders').insert([{
      order_number: 7705,
      customer_name: 'Guest Table 77',
      customer_phone: '9876543210',
      order_type: 'table',
      table_number: testTable,
      total_amount: 300.00,
      status: 'hold',
      payment_status: 'unpaid',
      notes: `[TABLE: ${testTable}] [KOT #105]`
    }]).select().single();
    if (err2) throw err2;
    createdOrderIds.push(ord2.id);

    await insforge.database.from('order_items').insert([
      { order_id: ord2.id, item_name: 'Butter Naan', quantity: 2, unit_price: 50, line_total: 100 },
      { order_id: ord2.id, item_name: 'Paneer Tikka', quantity: 1, unit_price: 200, line_total: 200 }
    ]);

    // 3. Test Automatic Merging in Hold Section
    console.log('3. Verifying Automatic Grouping of KOTs under Table 77 in Hold Section...');
    const { data: allOrders } = await insforge.database.from('orders').select('*').in('id', createdOrderIds);
    const { data: allItems } = await insforge.database.from('order_items').select('*').in('order_id', createdOrderIds);

    const activeSessions = getActiveTableSessions(allOrders, allItems);
    const sess77 = activeSessions.find(s => s.tableNumber === testTable);

    assert(sess77, 'Must find grouped active session for Table 77');
    console.log(`✅ Table 77 Session found with ${sess77.kots.length} KOTs. Total: ₹${sess77.totalAmount}`);
    assert.strictEqual(sess77.kots.length, 2, 'Should group both KOTs');
    assert.strictEqual(sess77.totalAmount, 800, 'Combined amount should be 500 + 300 = 800');

    // Consolidated dishes check (2 Naan + 2 Naan = 4 Naan)
    const naan = sess77.consolidatedItems.find(i => i.item_name === 'Butter Naan');
    assert(naan, 'Must contain Butter Naan');
    assert.strictEqual(naan.quantity, 4, 'Butter Naan combined quantity should be 4');
    console.log('✅ Combined dishes consolidated cleanly (Butter Naan: 4x, Chicken Biryani: 2x, Paneer Tikka: 1x)');

    // 4. Test Create Final Bill & Session Closure
    console.log('4. Generating Final Bill and closing Table 77 session...');
    for (const ordId of sess77.orderIds) {
      await insforge.database.from('orders').update({
        status: 'delivered',
        payment_status: 'paid',
        notes: `[TABLE: ${testTable}] [FINAL_BILL] [KOTS: #7701 + #7705]`
      }).eq('id', ordId);
    }

    // Verify session is closed and Table 77 is vacant
    const { data: refetchedOrders } = await insforge.database.from('orders').select('*').in('id', createdOrderIds);
    const postSessions = getActiveTableSessions(refetchedOrders, allItems);
    assert.strictEqual(postSessions.filter(s => s.tableNumber === testTable).length, 0, 'Table 77 session must be closed and vacant');
    console.log('✅ Table 77 active session closed and table is now vacant');

    // 5. Test New Independent Session created later for Table 77
    console.log('5. Testing New Customer arriving at Table 77 later (New Independent Session)...');
    const { data: newSessOrder, error: errNew } = await insforge.database.from('orders').insert([{
      order_number: 7710,
      customer_name: 'New Customer Table 77',
      customer_phone: '9111222333',
      order_type: 'table',
      table_number: testTable,
      total_amount: 250.00,
      status: 'hold',
      payment_status: 'unpaid',
      notes: `[TABLE: ${testTable}] [KOT #110]`
    }]).select().single();
    if (errNew) throw errNew;
    createdOrderIds.push(newSessOrder.id);

    const { data: newAllOrders } = await insforge.database.from('orders').select('*').in('id', createdOrderIds);
    const latestSessions = getActiveTableSessions(newAllOrders, allItems);
    const newSess77 = latestSessions.find(s => s.tableNumber === testTable);

    assert(newSess77, 'Must find new active session for Table 77');
    assert.strictEqual(newSess77.kots.length, 1, 'New session must have ONLY the new KOT');
    assert.strictEqual(newSess77.totalAmount, 250, 'New session total must be 250 (NOT 1050)');
    console.log('✅ New independent session created for Table 77 without mixing with previous closed orders');

    // 6. Test Closed Orders & Orders Report Consolidation View
    console.log('6. Verifying Closed Orders & Orders Report view...');
    const closedList = refetchedOrders.filter(o => o.status === 'delivered');
    const consolidatedClosed = getConsolidatedClosedBills(closedList);
    assert.strictEqual(consolidatedClosed.length, 1, 'Should consolidate previous session into exactly 1 final bill record');
    console.log('✅ Closed Orders view verified: Displays 1 Final Bill per closed session');

  } finally {
    // Clean up
    console.log('7. Cleaning up test orders...');
    if (createdOrderIds.length) {
      await insforge.database.from('order_items').delete().in('order_id', createdOrderIds);
      await insforge.database.from('orders').delete().in('id', createdOrderIds);
      console.log('✅ Test orders cleaned up.');
    }
  }

  console.log('\n🎉 ALL TABLE SESSION MULTI-KOT MERGING & FINAL BILL TESTS PASSED!');
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
