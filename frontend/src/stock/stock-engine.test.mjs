// Run:  node src/stock/stock-engine.test.mjs
import assert from 'node:assert/strict';
import { computePeriod, getWeekInfo, shiftWeek, previewOut, getItemLots, inr } from './stock-engine.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name); };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.005, `${m || ''} expected ${b} got ${a}`);

const D = (s) => new Date(s + 'T00:00:00');
const W = (y, m, d) => getWeekInfo(new Date(y, m - 1, d));

// ── Weeks (month-based 7 day blocks) ──
t('weeks Oct 2026: 1-7, 8-14, 15-21, 22-28, 29-31', () => {
  const r = [1, 8, 15, 22, 29].map(d => W(2026, 10, d));
  assert.deepEqual(r.map(w => [w.start.getDate(), w.end.getDate(), w.index]), [[1, 7, 1], [8, 14, 2], [15, 21, 3], [22, 28, 4], [29, 31, 5]]);
  assert.equal(W(2026, 10, 7).index, 1); assert.equal(W(2026, 10, 31).index, 5);
});
t('Feb 2027 has only 4 weeks (28 days)', () => {
  const w = W(2027, 2, 28); assert.equal(w.index, 4); assert.equal(w.end.getDate(), 28); assert.equal(w.weeksInMonth, 4);
});
t('leap Feb 2028: week 5 = 29 only', () => {
  const w = W(2028, 2, 29); assert.equal(w.index, 5); assert.equal(w.dayCount, 1);
});
t('shiftWeek crosses months both ways', () => {
  const nxt = shiftWeek(W(2026, 10, 30), +1);
  assert.deepEqual([nxt.month, nxt.index, nxt.start.getDate()], [10, 1, 1]);
  const prv = shiftWeek(W(2026, 10, 3), -1);
  assert.deepEqual([prv.month, prv.index, prv.start.getDate(), prv.end.getDate()], [8, 5, 29, 30]);
});

// ── FIFO: the onion example from the requirement ──
const onion = { id: 'i1', sku: 'ON', name: 'Onion', category: 'Fresh Vegetables', unit: 'kg', min: 5, cost: 30, storedQty: 5 };
const data = {
  items: [onion],
  ins: [
    { id: 'a', sku: 'ON', date: '2026-10-01', qty: 10, costPrice: 20, createdAt: '2026-10-01T05:00:00Z' },
    { id: 'b', sku: 'ON', date: '2026-10-03', qty: 10, costPrice: 30, createdAt: '2026-10-03T05:00:00Z' }
  ],
  outs: [
    { id: 'c', sku: 'ON', date: '2026-10-02', qty: 4, createdAt: '2026-10-02T05:00:00Z' },
    { id: 'd', sku: 'ON', date: '2026-10-04', qty: 8, createdAt: '2026-10-04T05:00:00Z' },
    { id: 'e', sku: 'ON', date: '2026-10-09', qty: 3, createdAt: '2026-10-09T05:00:00Z' }
  ]
};
const wk1 = computePeriod(data, W(2026, 10, 1).start, W(2026, 10, 1).end);
const wk2 = computePeriod(data, W(2026, 10, 8).start, W(2026, 10, 8).end);

t('week 1: old lot goes out first (₹20 before ₹30)', () => {
  const r = wk1.rows[0];
  near(r.openValue, 0); near(r.inValue, 500);
  // OUT 4kg@20=80 ; OUT 8kg = 6@20 + 2@30 = 180  → 260
  near(r.outValue, 260);
  near(r.closeQty, 8); near(r.closeValue, 240); // 8 kg left @30
  near(wk1.totals.adjustment, 0); assert.ok(wk1.balanced);
});
t('week 2: opening = week 1 closing, uses remaining lot', () => {
  const r = wk2.rows[0];
  near(r.openQty, 8); near(r.openValue, 240);
  near(r.outValue, 90); near(r.closeQty, 5); near(r.closeValue, 150);
  assert.ok(wk2.balanced);
});
t('opening + IN − OUT = closing (₹ totals)', () => {
  [wk1, wk2].forEach(p => near(p.totals.openValue + p.totals.inValue - p.totals.outValue, p.totals.closeValue));
});
t('day by day: IN/OUT/closing per day', () => {
  const d1 = wk1.days[0], d2 = wk1.days[1], d4 = wk1.days[3];
  near(d1.inValue, 200); near(d1.closeValue, 200);
  near(d2.outValue, 80); near(d2.closeValue, 120);
  near(d4.outValue, 180); near(d4.closeValue, 240);
  assert.equal(wk1.days.length, 7);
});
t('same-day IN is consumed by same-day OUT', () => {
  const p = computePeriod({ items: [{ ...onion, storedQty: 0 }], ins: [{ id: 'x', sku: 'ON', date: '2026-10-01', qty: 5, costPrice: 10, createdAt: '2026-10-01T12:00:00Z' }], outs: [{ id: 'y', sku: 'ON', date: '2026-10-01', qty: 5, createdAt: '2026-10-01T01:00:00Z' }] }, W(2026, 10, 1).start, W(2026, 10, 1).end);
  near(p.rows[0].outValue, 50); near(p.rows[0].closeQty, 0);
});

// ── Backdated entry reshuffles FIFO automatically ──
t('backdated cheaper IN becomes the oldest lot', () => {
  const d2 = { ...data, ins: [...data.ins, { id: 'z', sku: 'ON', date: '2026-09-28', qty: 2, costPrice: 15, createdAt: '2026-10-05T05:00:00Z' }], items: [{ ...onion, storedQty: 7 }] };
  const p = computePeriod(d2, W(2026, 10, 1).start, W(2026, 10, 1).end);
  near(p.rows[0].openQty, 2); near(p.rows[0].openValue, 30);
  near(p.rows[0].outValue, 230); // 2@15 + 2@20 + 8@20 = 230
  assert.ok(p.balanced);
});

// ── Negative stock & legacy base ──
t('OUT beyond stock: valued at last rate and flagged Negative', () => {
  const p = computePeriod({ items: [{ ...onion, storedQty: -2 }], ins: [{ id: 'x', sku: 'ON', date: '2026-10-01', qty: 3, costPrice: 10, createdAt: '2026-10-01T01:00:00Z' }], outs: [{ id: 'y', sku: 'ON', date: '2026-10-02', qty: 5, createdAt: '2026-10-02T01:00:00Z' }] }, W(2026, 10, 1).start, W(2026, 10, 1).end);
  const r = p.rows[0]; near(r.outValue, 50); near(r.closeQty, -2); assert.equal(r.status, 'Negative');
});
t('legacy stored qty without IN entries becomes the opening lot', () => {
  const p = computePeriod({ items: [{ ...onion, cost: 5, storedQty: 10 }], ins: [], outs: [] }, W(2026, 10, 1).start, W(2026, 10, 1).end);
  near(p.rows[0].openQty, 10); near(p.rows[0].openValue, 50); near(p.totals.closeValue, 50);
});
t('stored qty that equals IN−OUT adds no phantom stock', () => {
  const p = computePeriod({ items: [{ ...onion, storedQty: 6 }], ins: [{ id: 'x', sku: 'ON', date: '2026-10-01', qty: 10, costPrice: 10, createdAt: '2026-10-01T01:00:00Z' }], outs: [{ id: 'y', sku: 'ON', date: '2026-10-02', qty: 4, createdAt: '2026-10-02T01:00:00Z' }] }, W(2026, 10, 1).start, W(2026, 10, 1).end);
  near(p.rows[0].closeQty, 6); near(p.rows[0].closeValue, 60);
});
t('zero-rate lot is flagged missingRate', () => {
  const p = computePeriod({ items: [onion], ins: [{ id: 'x', sku: 'ON', date: '2026-10-01', qty: 3, costPrice: 0, createdAt: '2026-10-01T01:00:00Z' }], outs: [] }, W(2026, 10, 1).start, W(2026, 10, 1).end);
  assert.equal(p.rows[0].missingRate, true);
});
t('previewOut gives FIFO cost for a planned OUT', () => {
  const today = new Date(); const ds = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const pv = previewOut({ items: [{ ...onion, storedQty: 20 }], ins: [{ id: 'a', sku: 'ON', date: ds(new Date(today.getTime() - 3 * 864e5)), qty: 10, costPrice: 20, createdAt: new Date(today.getTime() - 3 * 864e5).toISOString() }, { id: 'b', sku: 'ON', date: ds(new Date(today.getTime() - 864e5)), qty: 10, costPrice: 30, createdAt: new Date(today.getTime() - 864e5).toISOString() }], outs: [] }, 'ON', 12);
  near(pv.cost, 10 * 20 + 2 * 30); near(pv.available, 20);
});
t('inr() formats Indian grouping', () => assert.equal(inr(1234567.5), '₹ 12,34,567.50'));
t('getItemLots returns remaining batches in strict FIFO order', () => {
  const d = {
    items: [{ ...onion, storedQty: 15 }],
    ins: [
      { id: 'b1', sku: 'ON', date: '2026-10-01', qty: 10, costPrice: 20, createdAt: '2026-10-01T10:00:00Z' },
      { id: 'b2', sku: 'ON', date: '2026-10-03', qty: 10, costPrice: 30, createdAt: '2026-10-03T10:00:00Z' }
    ],
    outs: [
      { id: 'o1', sku: 'ON', date: '2026-10-04', qty: 5, createdAt: '2026-10-04T12:00:00Z' }
    ]
  };
  const lotsInfo = getItemLots(d, 'ON');
  // 10@20 + 10@30 = 20 total in. Out of 5 consumed oldest batch b1 first!
  // b1 now has 5 remaining @ 20. b2 has 10 remaining @ 30.
  assert.equal(lotsInfo.activeLots.length, 2);
  assert.equal(lotsInfo.activeLots[0].qty, 5);
  assert.equal(lotsInfo.activeLots[0].cost, 20);
  assert.equal(lotsInfo.activeLots[1].qty, 10);
  assert.equal(lotsInfo.activeLots[1].cost, 30);
  near(lotsInfo.totalQty, 15);
  near(lotsInfo.totalValue, 5 * 20 + 10 * 30); // 400
  near(lotsInfo.avgRate, 400 / 15);
});

console.log(`\n${passed} tests passed`);
