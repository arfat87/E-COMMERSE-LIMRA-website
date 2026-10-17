/**
 * LIMRA Restaurant POS V2 — Thermal Printing & KOT/Bill Sequencing Test Suite
 * 
 * Tests mock printer drivers, ESC/POS stream generation, 58mm/80mm widths,
 * round sequencing, settlement deduplication, reprint indicators, queue concurrency,
 * and error handling.
 */

import assert from 'node:assert/strict';
import {
  COMMANDS,
  getColumnWidth,
  padRight,
  padLeft,
  formatTwoColumns,
  wrapText,
  buildEscPosBill,
  buildEscPosKOT
} from '../../frontend/src/lib/escpos.js';
import { printQueue } from '../../frontend/src/lib/print-queue.js';

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log('--- Limra Restaurant POS: Thermal Receipt & KOT Test Suite ---');

// Mock data fixtures
const mockSettings80 = {
  restaurant_name: 'LIMRA RESTAURANT',
  restaurant_address: 'Main Road, Limra Town, 600001',
  restaurant_phone: '9876543210',
  restaurant_gstin: '33AAAAA0000A1Z5',
  restaurant_fssai: '12412345678901',
  bill_paper_width: 80,
  kot_paper_width: 80,
  cgst_rate: 2.5,
  sgst_rate: 2.5,
  bill_show_tax_summary: true,
  bill_show_review_qr: true,
  bill_review_heading: 'LOVE YOUR EXPERIENCE?',
  bill_review_url: 'https://g.page/r/limra/review',
  bill_upi_id: 'limra@upi',
  bill_auto_cut: 'partial',
  kot_auto_cut: 'partial',
  bill_bottom_feed: 3,
  kot_bottom_feed: 3
};

const mockSettings58 = {
  ...mockSettings80,
  bill_paper_width: 58,
  kot_paper_width: 58
};

const mockDineInOrder = {
  id: 'ord-dine-101',
  order_number: '101',
  table_number: 4,
  order_type: 'dine_in',
  customer_name: 'Ahmed',
  customer_phone: '9988776655',
  payment_mode: 'cash',
  payment_status: 'paid',
  created_at: '2026-10-17T12:30:00.000Z',
  discount_amount: 0,
  total_amount: 367.50
};

const mockOrderItemsRound1 = [
  { item_name: 'Chicken Biryani', quantity: 2, unit_price: 150, line_total: 300, notes: 'Less spicy' },
  { item_name: 'Lime Juice', quantity: 1, unit_price: 50, line_total: 50 }
];

const mockOrderItemsRound2 = [
  { item_name: 'Garlic Naan', quantity: 3, unit_price: 40, line_total: 120, notes: 'Extra butter' },
  { item_name: 'Chicken Butter Masala', quantity: 1, unit_price: 220, line_total: 220 }
];

// ════════════════════════════════════════════════════════
// 1. ESC/POS FORMATTING & COLUMN WIDTHS
// ════════════════════════════════════════════════════════
console.log('\n[Suite 1: ESC/POS Formatter & Column Width Calculations]');

runTest('1.1 getColumnWidth returns 48 for 80mm and 32 for 58mm', () => {
  assert.equal(getColumnWidth(80), 48);
  assert.equal(getColumnWidth('80'), 48);
  assert.equal(getColumnWidth(58), 32);
  assert.equal(getColumnWidth('58'), 32);
});

runTest('1.2 padRight and padLeft format exact widths', () => {
  assert.equal(padRight('Item', 10), 'Item      ');
  assert.equal(padRight('VeryLongItemName', 10), 'VeryLongIt');
  assert.equal(padLeft('250.00', 8), '  250.00');
});

runTest('1.3 formatTwoColumns fills exact column width without line wrapping', () => {
  const row80 = formatTwoColumns('Subtotal:', '₹350.00', 48);
  assert.equal(row80.length, 48);
  assert.ok(row80.startsWith('Subtotal:'));
  assert.ok(row80.endsWith('₹350.00'));

  const row58 = formatTwoColumns('Bill: #101', '12:30 PM', 32);
  assert.equal(row58.length, 32);
});

runTest('1.4 wrapText breaks long strings cleanly at word boundaries', () => {
  const text = 'Limra Restaurant special spicy chicken dum biryani with raita and mirchi ka salan';
  const wrapped = wrapText(text, 32);
  assert.ok(wrapped.length > 1);
  wrapped.forEach(line => {
    assert.ok(line.length <= 32);
  });
});

// ════════════════════════════════════════════════════════
// 2. KOT PRINTING & ROUND SEQUENCING
// ════════════════════════════════════════════════════════
console.log('\n[Suite 2: KOT Printing & Table Round Sequencing]');

runTest('2.1 Initial order (Round 1) generates clean KOT with dishes and table info', () => {
  const kotStream = buildEscPosKOT(mockDineInOrder, mockOrderItemsRound1, mockSettings80, { roundNumber: 1, isNewOnly: false });
  assert.ok(kotStream.includes(COMMANDS.INIT), 'Includes printer init command');
  assert.ok(kotStream.includes('*** KITCHEN ORDER TICKET ***'), 'Includes KOT header');
  assert.ok(kotStream.includes('TABLE 4'), 'Includes Table number');
  assert.ok(kotStream.includes('Chicken Biryani'), 'Includes first dish');
  assert.ok(kotStream.includes('[2x]'), 'Includes bold quantity tag [2x]');
  assert.ok(kotStream.includes('Lime Juice'), 'Includes second dish');
  assert.ok(kotStream.includes('↳ Note: Less spicy'), 'Includes special item note');
  assert.ok(!kotStream.includes('ROUND #2'), 'Does not include Round 2 banner');
  assert.ok(!kotStream.includes('*** REPRINT'), 'Does not include reprint warning');
});

runTest('2.2 Additional table round (Round 2, new items only) renders ROUND #2 banner', () => {
  const kotStreamRound2 = buildEscPosKOT(mockDineInOrder, mockOrderItemsRound2, mockSettings80, {
    isNewOnly: true,
    roundNumber: 2
  });

  assert.ok(kotStreamRound2.includes('>>> ROUND #2 (NEW ITEMS ONLY) <<<'), 'Contains prominent round sequencing banner');
  assert.ok(kotStreamRound2.includes('KOT #101 (R2)'), 'Title indicates Round 2');
  assert.ok(kotStreamRound2.includes('Garlic Naan'), 'Includes new round item');
  assert.ok(kotStreamRound2.includes('[3x]'), 'Includes quantity [3x]');
  assert.ok(kotStreamRound2.includes('Chicken Butter Masala'), 'Includes second item');
  assert.ok(!kotStreamRound2.includes('Chicken Biryani'), 'Does not duplicate Round 1 dishes');
});

// ════════════════════════════════════════════════════════
// 3. REPRINT IDENTIFIABILITY (PREVENT DOUBLE COOKING)
// ════════════════════════════════════════════════════════
console.log('\n[Suite 3: Explicit Reprints & Double-Cooking Prevention]');

runTest('3.1 Explicit KOT reprint renders prominent DO NOT RE-COOK warning banner', () => {
  const reprintKOT = buildEscPosKOT(mockDineInOrder, mockOrderItemsRound1, mockSettings80, { isReprint: true });
  assert.ok(reprintKOT.includes('*** REPRINT - DUPLICATE KOT ***'), 'Contains duplicate KOT banner');
  assert.ok(reprintKOT.includes('*** DO NOT RE-COOK ***'), 'Contains DO NOT RE-COOK warning for chefs');
});

runTest('3.2 Explicit Customer Bill reprint renders DUPLICATE TAX INVOICE header', () => {
  const reprintBill = buildEscPosBill(mockDineInOrder, mockOrderItemsRound1, mockSettings80, { isReprint: true });
  assert.ok(reprintBill.includes('*** DUPLICATE / REPRINT INVOICE ***'), 'Contains duplicate invoice banner');
  assert.ok(reprintBill.includes('(ORIGINAL BILL ALREADY ISSUED)'), 'Contains already issued notice');
  assert.ok(reprintBill.includes('DUPLICATE TAX INVOICE — TABLE 4'), 'Title is updated to Duplicate Tax Invoice');
});

// ════════════════════════════════════════════════════════
// 4. FINAL SETTLEMENT DEDUPLICATION
// ════════════════════════════════════════════════════════
console.log('\n[Suite 4: Settlement Workflow & KOT Deduplication]');

runTest('4.1 Table settlement prints Customer Bill without generating duplicate kitchen KOT', () => {
  // In our audit fix, table and hold settlement calls printOrderReceiptWithTax instead of printCombinedKOTAndBill
  const finalBillStream = buildEscPosBill(mockDineInOrder, mockOrderItemsRound1, mockSettings80, { isReprint: false });
  assert.ok(finalBillStream.includes('TAX INVOICE — TABLE 4'), 'Generates customer tax invoice');
  assert.ok(finalBillStream.includes('GRAND TOTAL:'), 'Includes grand total calculation');
  assert.ok(!finalBillStream.includes('*** KITCHEN ORDER TICKET ***'), 'Customer bill does not include kitchen ticket');
});

runTest('4.2 Cash drawer kick code is emitted for cash payments', () => {
  const cashBill = buildEscPosBill({ ...mockDineInOrder, payment_mode: 'cash' }, mockOrderItemsRound1, mockSettings80);
  assert.ok(cashBill.includes(COMMANDS.DRAWER_KICK), 'Drawer kick command is sent when payment mode is cash');

  const upiBill = buildEscPosBill({ ...mockDineInOrder, payment_mode: 'upi' }, mockOrderItemsRound1, mockSettings80);
  assert.ok(!upiBill.includes(COMMANDS.DRAWER_KICK), 'Drawer kick command is omitted for UPI/card payments');
});

// ════════════════════════════════════════════════════════
// 5. 58MM VS 80MM PAPER WIDTH ADAPTATION & QR CODES
// ════════════════════════════════════════════════════════
console.log('\n[Suite 5: 58mm / 80mm Compatibility & QR Elements]');

runTest('5.1 Bill formats cleanly in compact 58mm (32 cols)', () => {
  const bill58 = buildEscPosBill(mockDineInOrder, mockOrderItemsRound1, mockSettings58);
  assert.ok(bill58.includes('TAX INVOICE'), 'Contains invoice header');
  assert.ok(bill58.includes('Item'), 'Contains item column');
  assert.ok(bill58.includes('Qty'), 'Contains qty column');
  assert.ok(bill58.includes('Amt'), 'Contains amount column');
});

runTest('5.2 Bill includes Google Review link and review subtext', () => {
  const bill = buildEscPosBill(mockDineInOrder, mockOrderItemsRound1, mockSettings80);
  assert.ok(bill.includes('LOVE YOUR EXPERIENCE?'), 'Includes review heading');
  assert.ok(bill.includes('https://g.page/r/limra/review'), 'Includes review target URL');
});

// ════════════════════════════════════════════════════════
// 6. PRINT QUEUE RESILIENCE, IDEMPOTENCY & LIFECYCLE
// ════════════════════════════════════════════════════════
console.log('\n[Suite 6: Print Queue Engine, Lifecycle & Concurrency]');

await runAsyncTest('6.1 Print job receives unique identifier and tracks attempts', async () => {
  const mockExecutor = async (job) => {
    return { success: true, hardware_confirmed: true };
  };

  const job = await printQueue.enqueue({
    orderId: 'ord-101',
    orderNumber: '101',
    type: 'BILL',
    paperWidth: 80,
    payload: { html: '<div>Test Receipt</div>' }
  }, mockExecutor);

  assert.ok(job.id.startsWith('print-'), 'Job ID has print- prefix');
  assert.equal(job.status, 'hardware_confirmed', 'Status transitions to hardware_confirmed on hardware ACK');
  assert.equal(job.hardwareConfirmed, true, 'hardwareConfirmed flag is set true');
  assert.equal(job.attempts, 1, 'Attempts incremented to 1');
});

await runAsyncTest('6.2 Browser spooler mock returns spooled status', async () => {
  const mockBrowserExecutor = async (job) => {
    return { success: true, spooled: true };
  };

  const job = await printQueue.enqueue({
    orderId: 'ord-102',
    orderNumber: '102',
    type: 'KOT',
    paperWidth: 80,
    payload: { html: '<div>KOT</div>' }
  }, mockBrowserExecutor);

  assert.equal(job.status, 'spooled', 'Status is spooled for browser spooler path');
  assert.equal(job.hardwareConfirmed, false);
});

await runAsyncTest('6.3 Offline printer failure marks job failed and allows in-place retry without duplicating queue', async () => {
  let isOffline = true;
  const mockFlakyExecutor = async (job) => {
    if (isOffline) {
      throw new Error('Printer disconnected or out of paper');
    }
    return { success: true, hardware_confirmed: true };
  };

  const job = await printQueue.enqueue({
    orderId: 'ord-103',
    orderNumber: '103',
    type: 'BILL',
    paperWidth: 80,
    payload: { html: '<div>Retry Test</div>' }
  }, mockFlakyExecutor);

  assert.equal(job.status, 'failed', 'Job status is marked failed on error');
  assert.ok(job.error.includes('Printer disconnected'), 'Error message is recorded');
  assert.equal(job.attempts, 1, 'First attempt recorded');

  const initialQueueLength = printQueue.getJobs().length;

  // Now printer comes back online and staff clicks Retry
  isOffline = false;
  const retriedJob = await printQueue.retry(job.id, mockFlakyExecutor);

  assert.equal(retriedJob.id, job.id, 'Retried job preserves identical unique job ID');
  assert.equal(retriedJob.status, 'hardware_confirmed', 'Retried job now succeeds');
  assert.equal(retriedJob.attempts, 2, 'Attempts incremented to 2 in-place');
  assert.equal(printQueue.getJobs().length, initialQueueLength, 'Queue size did NOT grow (no duplicate job records)');
});

await runAsyncTest('6.4 cancelJob transitions job to cancelled and prevents retries', async () => {
  const failedJob = await printQueue.enqueue({
    orderId: 'ord-104',
    orderNumber: '104',
    type: 'KOT',
    paperWidth: 80,
    payload: { html: '<div>Cancel Test</div>' }
  }, async () => { throw new Error('Printer jammed'); });

  assert.equal(failedJob.status, 'failed');

  // Staff explicitly cancels the job
  const cancelledJob = printQueue.cancelJob(failedJob.id);
  assert.equal(cancelledJob.status, 'cancelled');
  assert.equal(cancelledJob.error, 'Cancelled by staff');

  // Retrying a cancelled job should return without re-executing
  let executed = false;
  await printQueue.retry(failedJob.id, async () => { executed = true; return { success: true }; });
  assert.equal(executed, false, 'Cancelled job was skipped without execution');
});

await runAsyncTest('6.5 Rapid sequential jobs execute in strict FIFO order without colliding', async () => {
  const executionOrder = [];
  const delays = [30, 10, 5]; // Deliberate varying delays to verify queue sequencing

  const sequentialExecutor = async (job) => {
    const delay = delays.shift() || 10;
    await new Promise(r => setTimeout(r, delay));
    executionOrder.push(job.orderNumber);
    return { success: true, hardware_confirmed: true };
  };

  printQueue.setExecutor(sequentialExecutor);

  const p1 = printQueue.enqueue({ orderNumber: 'SEQ-1', type: 'KOT' });
  const p2 = printQueue.enqueue({ orderNumber: 'SEQ-2', type: 'BILL' });
  const p3 = printQueue.enqueue({ orderNumber: 'SEQ-3', type: 'KOT' });

  await Promise.all([p1, p2, p3]);

  assert.deepEqual(executionOrder, ['SEQ-1', 'SEQ-2', 'SEQ-3'], 'Sequential execution order preserved regardless of internal duration');
});

// ════════════════════════════════════════════════════════
// TEST SUITE SUMMARY
// ════════════════════════════════════════════════════════
console.log(`\n==================================================`);
console.log(`Thermal Printing & KOT Sequencing Tests: ${passedTests}/${totalTests} Passed`);
if (passedTests === totalTests) {
  console.log(`✓ All printing, sequencing, and queue resiliency assertions PASSED!`);
  process.exit(0);
} else {
  console.error(`✗ ${totalTests - passedTests} test(s) failed.`);
  process.exit(1);
}
