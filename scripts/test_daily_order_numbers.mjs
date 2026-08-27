async function testDailyOrderNumbering() {
  console.log('--- Step 1: Testing formatDailyOrderNumber logic across multiple dates ---');

  const mockOrders = [
    // Day 1: 2026-08-16 (3 orders)
    { id: 'ord-101', order_number: 101, created_at: '2026-08-16T10:00:00Z', customer_name: 'Customer A', total_amount: 250 },
    { id: 'ord-102', order_number: 102, created_at: '2026-08-16T12:30:00Z', customer_name: 'Customer B', total_amount: 550 },
    { id: 'ord-103', order_number: 103, created_at: '2026-08-16T19:45:00Z', customer_name: 'Customer C', total_amount: 890 },

    // Day 2: 2026-08-17 (starts fresh at 01!)
    { id: 'ord-104', order_number: 1, created_at: '2026-08-17T08:15:00Z', customer_name: 'Customer D', total_amount: 150 },
    { id: 'ord-105', order_number: 2, created_at: '2026-08-17T09:00:00Z', customer_name: 'Customer E', total_amount: 420 },
    { id: 'ord-106', order_number: 3, created_at: '2026-08-17T11:20:00Z', customer_name: 'Customer F', total_amount: 600 }
  ];

  function formatDailyOrderNumber(order, allOrders = mockOrders) {
    if (!order && order !== 0) return '01';

    if (typeof order === 'number' || typeof order === 'string') {
      const num = parseInt(order, 10);
      if (!isNaN(num)) {
        return num < 10 && num > 0 ? `0${num}` : `${num}`;
      }
      return String(order);
    }

    if (order.created_at && Array.isArray(allOrders) && allOrders.length > 0) {
      const orderDate = new Date(order.created_at).toISOString().slice(0, 10);
      const dayOrders = allOrders
        .filter(o => o.created_at && new Date(o.created_at).toISOString().slice(0, 10) === orderDate)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      const idx = dayOrders.findIndex(o => o.id === order.id);
      if (idx !== -1) {
        const dailySeq = idx + 1;
        return dailySeq < 10 ? `0${dailySeq}` : `${dailySeq}`;
      }
    }

    const rawNum = parseInt(order.order_number, 10);
    if (!isNaN(rawNum) && rawNum > 0) {
      return rawNum < 10 ? `0${rawNum}` : `${rawNum}`;
    }

    return '01';
  }

  // Verify Day 1
  const day1_ord1 = formatDailyOrderNumber(mockOrders[0]);
  const day1_ord2 = formatDailyOrderNumber(mockOrders[1]);
  const day1_ord3 = formatDailyOrderNumber(mockOrders[2]);

  console.log(`Day 1 (2026-08-16): Order 1 -> #${day1_ord1}, Order 2 -> #${day1_ord2}, Order 3 -> #${day1_ord3}`);
  if (day1_ord1 !== '01' || day1_ord2 !== '02' || day1_ord3 !== '03') {
    throw new Error('Day 1 numbering did not format as 01, 02, 03');
  }

  // Verify Day 2 resets to 01, 02, 03
  const day2_ord1 = formatDailyOrderNumber(mockOrders[3]);
  const day2_ord2 = formatDailyOrderNumber(mockOrders[4]);
  const day2_ord3 = formatDailyOrderNumber(mockOrders[5]);

  console.log(`Day 2 (2026-08-17): Order 1 -> #${day2_ord1}, Order 2 -> #${day2_ord2}, Order 3 -> #${day2_ord3}`);
  if (day2_ord1 !== '01' || day2_ord2 !== '02' || day2_ord3 !== '03') {
    throw new Error('Day 2 numbering failed to reset to 01');
  }

  console.log('--- Step 2: Testing getTodayDailyOrderNumber for new orders ---');
  function getTodayDailyOrderNumber(allOrders = mockOrders, testDateStr = '2026-08-17') {
    const todayOrders = (allOrders || []).filter(o => {
      if (!o.created_at) return false;
      const d = new Date(o.created_at).toISOString().slice(0, 10);
      return d === testDateStr;
    });
    return todayOrders.length + 1;
  }

  const nextOrderNumToday = getTodayDailyOrderNumber(mockOrders, '2026-08-17');
  console.log(`Next order on 2026-08-17: #${nextOrderNumToday} (formatted: #${nextOrderNumToday < 10 ? '0' + nextOrderNumToday : nextOrderNumToday})`);
  if (nextOrderNumToday !== 4) {
    throw new Error('Next order calculation today mismatch');
  }

  // Tomorrow has 0 orders so it starts at 1 (01)
  const nextOrderNumTomorrow = getTodayDailyOrderNumber(mockOrders, '2026-08-18');
  console.log(`Next order tomorrow (2026-08-18): #${nextOrderNumTomorrow} (formatted: #${nextOrderNumTomorrow < 10 ? '0' + nextOrderNumTomorrow : nextOrderNumTomorrow})`);
  if (nextOrderNumTomorrow !== 1) {
    throw new Error('Tomorrow order failed to start at 1 (01)');
  }

  console.log('Daily Order & Bill Numbering (#01) Tests PASSED ✅');
}

testDailyOrderNumbering().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
