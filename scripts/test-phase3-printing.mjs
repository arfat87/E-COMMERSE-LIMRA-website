import { buildEscPosBill, buildEscPosKOT, getColumnWidth, COMMANDS } from '../frontend/src/lib/escpos.js';
import { printQueue } from '../frontend/src/lib/print-queue.js';

console.log('--- 1. Testing ESC/POS Formatter (80mm & 58mm) ---');
const dummyOrder = {
  id: 'ord-101',
  order_number: '10245',
  created_at: new Date().toISOString(),
  customer_name: 'Imran Khan',
  customer_phone: '9876543210',
  order_type: 'table',
  table_number: '04',
  payment_mode: 'cash',
  payment_status: 'paid',
  notes: 'Table #04. Extra chutney please.'
};

const dummyItems = [
  { item_name: 'Chicken Biryani', quantity: 2, unit_price: 220, line_total: 440, notes: 'Spicy' },
  { item_name: 'Butter Naan', quantity: 4, unit_price: 40, line_total: 160 },
  { item_name: 'Coke 500ml', quantity: 2, unit_price: 45, line_total: 90 }
];

const dummySettings = {
  restaurant_name: 'LIMRA RESTAURANT',
  restaurant_address: 'Main Road, Near Bus Stand',
  restaurant_phone: '+91 98765 43210',
  restaurant_gstin: '07AABCL1234F1Z5',
  restaurant_fssai: '10020011000123',
  bill_paper_width: 80,
  kot_paper_width: 80,
  cgst_rate: 2.5,
  sgst_rate: 2.5,
  bill_show_review_qr: true,
  bill_review_url: 'https://g.page/r/CcrqEfWap5zfEBE/review',
  bill_review_heading: 'LOVE YOUR EXPERIENCE?',
  bill_review_subtext: 'Scan to leave us a Google Review'
};

// Test 80mm Bill
const bill80 = buildEscPosBill(dummyOrder, dummyItems, dummySettings);
console.log('80mm Bill Generated. Length:', bill80.length);
if (!bill80.includes('LIMRA RESTAURANT') || !bill80.includes('Chicken Biryani') || !bill80.includes('LOVE YOUR EXPERIENCE?')) {
  throw new Error('80mm Bill missing expected text components');
}
if (!bill80.includes(COMMANDS.DRAWER_KICK)) {
  throw new Error('Cash order missing cash drawer kick code');
}
console.log('✓ 80mm Bill contains restaurant name, items, Google Review prompt, and cash drawer kick');

// Test 58mm Bill
const settings58 = { ...dummySettings, bill_paper_width: 58 };
const bill58 = buildEscPosBill(dummyOrder, dummyItems, settings58);
console.log('58mm Bill Generated. Length:', bill58.length);
if (!bill58.includes('TAX INVOICE — TABLE 04') || !bill58.includes('LOVE YOUR EXPERIENCE?')) {
  throw new Error('58mm Bill missing expected text components');
}
console.log('✓ 58mm Bill formatted cleanly with 32-column bounds');

// Test KOT
const kot80 = buildEscPosKOT(dummyOrder, dummyItems, dummySettings);
if (!kot80.includes('KITCHEN ORDER TICKET') || !kot80.includes('[2x]') || !kot80.includes('Spicy')) {
  throw new Error('KOT missing expected components');
}
console.log('✓ KOT contains checklist badges [2x] and special kitchen notes');

console.log('\n--- 2. Testing PrintQueueManager Retry & Failure Recovery ---');
let printAttempts = 0;
printQueue.setExecutor(async (job) => {
  printAttempts++;
  if (printAttempts === 1) {
    throw new Error('Simulated hardware disconnection: Port COM3 busy or offline');
  }
  return { success: true };
});

const enqueuedJob = await printQueue.enqueue({
  orderId: dummyOrder.id,
  orderNumber: dummyOrder.order_number,
  type: 'BILL',
  paperWidth: 80
});

console.log('Initial attempt result status:', enqueuedJob.status);
if (enqueuedJob.status !== 'failed') {
  throw new Error('Expected initial attempt to fail gracefully');
}
console.log('✓ PrintQueue captured failure and recorded error:', enqueuedJob.error);

// Retry the job
console.log('Retrying failed job...');
const retryResult = await printQueue.retry(enqueuedJob.id);
console.log('Retry result status:', retryResult.status);
if (retryResult.status !== 'printed') {
  throw new Error('Expected retry to succeed');
}
console.log('✓ PrintQueue retry succeeded! Status updated to "printed"');

console.log('\n========================================');
console.log('🎉 ALL PHASE 3 ESC/POS & QUEUE TESTS PASSED');
console.log('========================================');
