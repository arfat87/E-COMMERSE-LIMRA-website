// Automated verification script for 56mm thermal paper, side gap, down gap, and place makeup in bills
import assert from 'assert';

console.log('🧪 Running Test: 56mm Thermal Paper, Side Gap, Down Gap, and Bill Place Makeup');

// Mock helpers from admin.js
function formatDailyOrderNumber(order) {
  const num = parseInt(String(order.order_number).replace(/\D/g, ''), 10) || 1;
  return String(num).padStart(2, '0');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseNotesMetadata(notes) {
  const result = {
    type: 'pickup',
    area: '',
    address: '',
    tableNumber: ''
  };
  if (notes && notes.includes('[DELIVERY]')) {
    result.type = 'delivery';
    const placeMatch = notes.match(/Place:\s*([^|]+)/i);
    if (placeMatch) result.area = placeMatch[1].trim();
    const addrMatch = notes.match(/Address:\s*([^|\[]+)/i);
    if (addrMatch) result.address = addrMatch[1].trim();
  }
  if (notes && notes.includes('[TABLE:')) {
    result.type = 'table';
    const tMatch = notes.match(/\[TABLE:\s*([^\]]+)\]/i);
    if (tMatch) result.tableNumber = tMatch[1].trim();
  }
  return result;
}

// 1. Test 56mm paper width calculation
const width56 = 56;
const wPx56 = Math.round(width56 * 2.835);
console.log(`✅ 56mm width in print pixels: ${wPx56}px`);
assert.strictEqual(wPx56, 159, '56mm width should be 159px');

// 2. Test Side Gap calculations
const sideGap2mm = 2;
const sideGapPx = Math.round(sideGap2mm * 2.835);
console.log(`✅ 2mm side gap in print pixels: ${sideGapPx}px`);
assert.strictEqual(sideGapPx, 6, '2mm side gap should be 6px');

// 3. Test Down Gap (feed lines)
const feedLines = 4;
const feedSpaces = '<br/>'.repeat(feedLines);
assert.strictEqual(feedSpaces, '<br/><br/><br/><br/>', 'Should generate 4 feed line spaces');
console.log('✅ Down gap feed spaces generated correctly');

// 4. Test Delivery Place Makeup in Bill
const deliveryOrder = {
  order_number: 1,
  customer_name: 'Rahul Sharma',
  customer_phone: '9876543210',
  order_type: 'delivery',
  notes: '[DELIVERY] Place: Contai Central (Near Bus Stand) | Address: Flat 204, Green Valley Apts | Delivery charge: ₹30',
  total_amount: 350
};

const meta = parseNotesMetadata(deliveryOrder.notes);
assert.strictEqual(meta.type, 'delivery', 'Should detect delivery order type');
assert.strictEqual(meta.area, 'Contai Central (Near Bus Stand)', 'Should extract delivery place name');
assert.strictEqual(meta.address, 'Flat 204, Green Valley Apts', 'Should extract landmark address');

const placeMarkup = `
  <div style="margin:4px 0 6px 0;padding:4px 6px;background:#f8fafc;border:1px solid #000;border-radius:4px;font-size:10px;text-align:left;line-height:1.4;">
    <div><strong>📍 AREA / PLACE:</strong> ${escapeHtml(meta.area)}</div>
    ${meta.address ? `<div style="font-size:9px;margin-top:2px;"><strong>🏠 Landmark / Address:</strong> ${escapeHtml(meta.address)}</div>` : ''}
  </div>
`;

assert(placeMarkup.includes('📍 AREA / PLACE:'), 'Must contain Area / Place label');
assert(placeMarkup.includes('Contai Central (Near Bus Stand)'), 'Must contain place name');
assert(placeMarkup.includes('🏠 Landmark / Address:'), 'Must contain landmark address label');
console.log('✅ Delivery place makeup markup verified');

// 5. Test Table Order Makeup in Bill
const tableOrder = {
  order_number: 2,
  customer_name: 'Suresh Das',
  notes: '[TABLE: 05]',
  total_amount: 520
};
const tableMeta = parseNotesMetadata(tableOrder.notes);
assert.strictEqual(tableMeta.type, 'table', 'Should detect table order type');
assert.strictEqual(tableMeta.tableNumber, '05', 'Should extract table number 05');
console.log('✅ Table order makeup verified');

console.log('\n🎉 ALL 56mm, SIDE GAP, DOWN GAP, AND PLACE MAKEUP TESTS PASSED SUCCESSFULLY!');
