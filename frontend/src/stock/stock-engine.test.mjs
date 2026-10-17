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

// ── Extended Accounting Integrity & FIFO Auditing Tests ──

t('18. Multiple lots (3+ lots) with partial lot consumption', () => {
  const ghee = { id: 'i2', sku: 'GH', name: 'Desi Ghee', category: 'Dairy', unit: 'kg', min: 2, cost: 500, storedQty: 27 };
  const d = {
    items: [ghee],
    ins: [
      { id: 'g1', sku: 'GH', date: '2026-10-01', qty: 10, costPrice: 500, createdAt: '2026-10-01T08:00:00Z' },
      { id: 'g2', sku: 'GH', date: '2026-10-02', qty: 15, costPrice: 520, createdAt: '2026-10-02T08:00:00Z' },
      { id: 'g3', sku: 'GH', date: '2026-10-03', qty: 20, costPrice: 550, createdAt: '2026-10-03T08:00:00Z' }
    ],
    outs: [
      // Consumes 10 from g1 (@500 = 5000) + 8 from g2 (@520 = 4160) = 9160
      { id: 'g_out', sku: 'GH', date: '2026-10-04', qty: 18, createdAt: '2026-10-04T12:00:00Z' }
    ]
  };
  const p = computePeriod(d, W(2026, 10, 1).start, W(2026, 10, 1).end);
  const r = p.rows[0];
  near(r.openQty, 0);
  near(r.inQty, 45);
  near(r.inValue, 10 * 500 + 15 * 520 + 20 * 550); // 5000 + 7800 + 11000 = 23800
  near(r.outQty, 18);
  near(r.outValue, 10 * 500 + 8 * 520); // 5000 + 4160 = 9160
  near(r.closeQty, 27);
  // Remaining: 7 in g2 @ 520 (= 3640) + 20 in g3 @ 550 (= 11000) = 14640
  near(r.closeValue, 14640);
  near(p.totals.adjustment, 0);
  assert.ok(p.balanced);
});

t('19. Partial lot consumption spanning across weekly boundaries', () => {
  const rice = { id: 'i3', sku: 'RC', name: 'Basmati Rice', category: 'Grains', unit: 'kg', min: 10, cost: 80, storedQty: 15 };
  const d = {
    items: [rice],
    ins: [
      { id: 'r1', sku: 'RC', date: '2026-10-02', qty: 20, costPrice: 80, createdAt: '2026-10-02T10:00:00Z' },
      { id: 'r2', sku: 'RC', date: '2026-10-10', qty: 10, costPrice: 90, createdAt: '2026-10-10T10:00:00Z' }
    ],
    outs: [
      { id: 'ro1', sku: 'RC', date: '2026-10-05', qty: 5, createdAt: '2026-10-05T12:00:00Z' }, // leaves 15 @ 80
      // Week 2 out: 10 units -> all from r1 @ 80 = 800
      { id: 'ro2', sku: 'RC', date: '2026-10-11', qty: 10, createdAt: '2026-10-11T12:00:00Z' }
    ]
  };
  const wk1 = computePeriod(d, W(2026, 10, 1).start, W(2026, 10, 1).end);
  const wk2 = computePeriod(d, W(2026, 10, 8).start, W(2026, 10, 8).end);

  // Week 1 closing: 15 @ 80 = 1200
  near(wk1.rows[0].closeQty, 15);
  near(wk1.rows[0].closeValue, 1200);
  assert.ok(wk1.balanced);

  // Week 2 opening: matches week 1 closing
  near(wk2.rows[0].openQty, 15);
  near(wk2.rows[0].openValue, 1200);
  near(wk2.rows[0].inQty, 10);
  near(wk2.rows[0].inValue, 900); // 10 @ 90
  near(wk2.rows[0].outQty, 10);
  near(wk2.rows[0].outValue, 800); // 10 @ 80 from oldest batch r1
  // Remaining: 5 from r1 @ 80 (= 400) + 10 from r2 @ 90 (= 900) = 1300
  near(wk2.rows[0].closeQty, 15);
  near(wk2.rows[0].closeValue, 1300);
  near(wk2.totals.adjustment, 0);
  assert.ok(wk2.balanced);
});

t('20. Same-day interleaved events order IN before OUT', () => {
  const chicken = { id: 'i4', sku: 'CH', name: 'Raw Chicken', category: 'Meat', unit: 'kg', min: 5, cost: 180, storedQty: 10 };
  const d = {
    items: [chicken],
    ins: [
      // Morning purchase delivery at 10:00 AM
      { id: 'cin1', sku: 'CH', date: '2026-10-04', qty: 15, costPrice: 180, createdAt: '2026-10-04T10:00:00Z' }
    ],
    outs: [
      // Lunch usage at 13:00 PM
      { id: 'cout1', sku: 'CH', date: '2026-10-04', qty: 5, createdAt: '2026-10-04T13:00:00Z' }
    ]
  };
  const p = computePeriod(d, W(2026, 10, 1).start, W(2026, 10, 1).end);
  const r = p.rows[0];
  near(r.inQty, 15);
  near(r.outQty, 5);
  near(r.closeQty, 10);
  near(r.outValue, 5 * 180);
  near(r.closeValue, 10 * 180);
  assert.equal(r.status, 'OK');
  assert.ok(p.balanced);
});

t('21. Deficit tracking and price variance on later purchase recovery', () => {
  const paneer = { id: 'i5', sku: 'PN', name: 'Fresh Paneer', category: 'Dairy', unit: 'kg', min: 2, cost: 300, storedQty: 6 };
  // Day 1: OUT 4kg when 0 lots exist -> creates deficit of 4kg estimated at item.cost 300 = 1200 liability
  // Day 3: IN 10kg at actual purchase rate of 320 -> settles 4kg deficit, price variance = 4 * (320 - 300) = 80
  const d = {
    items: [paneer],
    ins: [
      { id: 'pin1', sku: 'PN', date: '2026-10-03', qty: 10, costPrice: 320, createdAt: '2026-10-03T10:00:00Z' }
    ],
    outs: [
      { id: 'pout1', sku: 'PN', date: '2026-10-01', qty: 4, createdAt: '2026-10-01T12:00:00Z' }
    ]
  };
  const p = computePeriod(d, W(2026, 10, 1).start, W(2026, 10, 1).end);
  const r = p.rows[0];
  near(r.inQty, 10);
  near(r.inValue, 3200); // 10 @ 320
  near(r.outQty, 4);
  near(r.outValue, 1200); // 4 @ 300 estimated rate
  near(r.deficitVariance, 80); // 4 * (320 - 300)
  near(r.closeQty, 6);
  // Net remaining on shelf: 6 @ 320 = 1920
  near(r.closeValue, 1920);
  // Accounting identity with deficit price variance:
  // Open(0) + IN(3200) - OUT(1200) - DeficitVar(80) = 1920 = Closing
  near(p.totals.adjustment, 0);
  assert.ok(p.balanced);
});

t('22. High-precision decimal quantities (Grams & Milliliters)', () => {
  const saffron = { id: 'i6', sku: 'SAF', name: 'Pure Saffron', category: 'Spices', unit: 'g', min: 1, cost: 250, storedQty: 5 };
  const d = {
    items: [saffron],
    ins: [
      { id: 's1', sku: 'SAF', date: '2026-10-02', qty: 12.375, costPrice: 240, createdAt: '2026-10-02T09:00:00Z' }
    ],
    outs: [
      { id: 'so1', sku: 'SAF', date: '2026-10-03', qty: 3.125, createdAt: '2026-10-03T12:00:00Z' },
      { id: 'so2', sku: 'SAF', date: '2026-10-04', qty: 4.250, createdAt: '2026-10-04T12:00:00Z' }
    ]
  };
  const p = computePeriod(d, W(2026, 10, 1).start, W(2026, 10, 1).end);
  const r = p.rows[0];
  near(r.inQty, 12.375);
  near(r.inValue, 12.375 * 240); // 2970
  near(r.outQty, 7.375);
  near(r.outValue, 7.375 * 240); // 1770
  near(r.closeQty, 5.000);
  near(r.closeValue, 5.000 * 240); // 1200
  near(p.totals.adjustment, 0);
  assert.ok(p.balanced);
});

t('23. Historical reversal of posted stock entry restores prior valuation', () => {
  const item = { id: 'i7', sku: 'OIL', name: 'Mustard Oil', category: 'Oils', unit: 'l', min: 5, cost: 140, storedQty: 10 };
  // Before reversal: IN 20 @ 140, Erroneous IN 10 @ 180, OUT 15 @ 140
  const dWithMistake = {
    items: [item],
    ins: [
      { id: 'oil1', sku: 'OIL', date: '2026-10-01', qty: 20, costPrice: 140, createdAt: '2026-10-01T08:00:00Z' },
      { id: 'oil2_err', sku: 'OIL', date: '2026-10-02', qty: 10, costPrice: 180, createdAt: '2026-10-02T08:00:00Z' }
    ],
    outs: [
      { id: 'oil_out', sku: 'OIL', date: '2026-10-03', qty: 15, createdAt: '2026-10-03T12:00:00Z' }
    ]
  };
  // Reversal removes 'oil2_err'
  const dReversed = {
    items: [{ ...item, storedQty: 5 }],
    ins: [
      { id: 'oil1', sku: 'OIL', date: '2026-10-01', qty: 20, costPrice: 140, createdAt: '2026-10-01T08:00:00Z' }
    ],
    outs: [
      { id: 'oil_out', sku: 'OIL', date: '2026-10-03', qty: 15, createdAt: '2026-10-03T12:00:00Z' }
    ]
  };
  const p = computePeriod(dReversed, W(2026, 10, 1).start, W(2026, 10, 1).end);
  const r = p.rows[0];
  near(r.inQty, 20);
  near(r.inValue, 2800);
  near(r.outQty, 15);
  near(r.outValue, 2100);
  near(r.closeQty, 5);
  near(r.closeValue, 700); // 5 @ 140
  near(p.totals.adjustment, 0);
  assert.ok(p.balanced);
});

t('24. Multi-item ledger full reconciliation across diverse categories', () => {
  const items = [
    { id: 'm1', sku: 'CARD', name: 'Green Cardamom', category: 'Spices', unit: 'g', min: 100, cost: 3.5, storedQty: 300 },
    { id: 'm2', sku: 'BUT', name: 'Amul Butter', category: 'Dairy', unit: 'pcs', min: 10, cost: 55, storedQty: 40 },
    { id: 'm3', sku: 'MUT', name: 'Mutton Gosht', category: 'Meat', unit: 'kg', min: 5, cost: 650, storedQty: 15 }
  ];
  const d = {
    items,
    ins: [
      { id: 'mi1', sku: 'CARD', date: '2026-10-01', qty: 500, costPrice: 3.5, createdAt: '2026-10-01T08:00:00Z' },
      { id: 'mi2', sku: 'BUT', date: '2026-10-02', qty: 50, costPrice: 55, createdAt: '2026-10-02T08:00:00Z' },
      { id: 'mi3', sku: 'MUT', date: '2026-10-03', qty: 25, costPrice: 650, createdAt: '2026-10-03T08:00:00Z' }
    ],
    outs: [
      { id: 'mo1', sku: 'CARD', date: '2026-10-04', qty: 200, createdAt: '2026-10-04T12:00:00Z' },
      { id: 'mo2', sku: 'BUT', date: '2026-10-05', qty: 10, createdAt: '2026-10-05T12:00:00Z' },
      { id: 'mo3', sku: 'MUT', date: '2026-10-06', qty: 10, createdAt: '2026-10-06T12:00:00Z' }
    ]
  };
  const p = computePeriod(d, W(2026, 10, 1).start, W(2026, 10, 1).end);
  // Verify all 3 rows balance
  assert.equal(p.rows.length, 3);
  p.rows.forEach(r => {
    near(r.openValue + r.inValue - r.outValue - r.deficitVariance, r.closeValue);
  });
  // Total ledger equation balance
  near(p.totals.adjustment, 0);
  assert.ok(p.balanced);
});

t('25. Legacy opening stock with zero cost rates flags missingRate without inventing phantom price', () => {
  const unknownItem = { id: 'u1', sku: 'UNK', name: 'Legacy Mystery Herb', category: 'Herbs', unit: 'bunch', min: 2, cost: 0, storedQty: 8 };
  const d = {
    items: [unknownItem],
    ins: [],
    outs: []
  };
  const p = computePeriod(d, W(2026, 10, 1).start, W(2026, 10, 1).end);
  const r = p.rows[0];
  assert.equal(r.missingRate, true);
  near(r.openQty, 8);
  near(r.openValue, 0); // Preserved 0 rather than inventing fake price
  near(r.closeQty, 8);
  near(r.closeValue, 0);
});

t('26. Discrepancy detected when master physical stock is less than movement balance', () => {
  // Master storedQty is 2, but recorded IN is 10 and OUT is 0 (net recorded = 10, base = -8)
  const leakingItem = { id: 'l1', sku: 'LEAK', name: 'Cooking Oil', category: 'Oils', unit: 'l', min: 5, cost: 100, storedQty: 2 };
  const d = {
    items: [leakingItem],
    ins: [
      { id: 'lin1', sku: 'LEAK', date: '2026-10-02', qty: 10, costPrice: 100, createdAt: '2026-10-02T10:00:00Z' }
    ],
    outs: []
  };
  const p = computePeriod(d, W(2026, 10, 1).start, W(2026, 10, 1).end);
  const r = p.rows[0];
  assert.equal(r.hasDiscrepancy, true);
  near(r.ledgerVariance, -8);
});

t('27. getItemLots returns deficit and discrepancy alerts for audit inspection', () => {
  const badItem = { id: 'b1', sku: 'BAD', name: 'Deficit Item', category: 'Misc', unit: 'pcs', min: 1, cost: 50, storedQty: -3 };
  const d = {
    items: [badItem],
    ins: [],
    outs: [
      { id: 'bo1', sku: 'BAD', date: '2026-10-02', qty: 3, createdAt: '2026-10-02T10:00:00Z' }
    ]
  };
  const info = getItemLots(d, 'BAD');
  assert.equal(info.deficitQty, 3);
  near(info.deficitValue, 150); // 3 @ 50
  assert.equal(info.activeLots.length, 0);
});

t('28. Three-week cascading revaluation upon backdated purchase in week 1', () => {
  const item = { id: 'c1', sku: 'CAS', name: 'Cashews', category: 'Nuts', unit: 'kg', min: 2, cost: 800, storedQty: 10 };
  // Initial scenario: Week 1 has no purchases. Week 2 has IN 10 @ 900. Week 3 has OUT 5.
  // Then a backdated purchase is introduced in Week 1: IN 10 @ 750.
  const d = {
    items: [item],
    ins: [
      { id: 'cas_wk1', sku: 'CAS', date: '2026-10-03', qty: 10, costPrice: 750, createdAt: '2026-10-03T10:00:00Z' },
      { id: 'cas_wk2', sku: 'CAS', date: '2026-10-10', qty: 10, costPrice: 900, createdAt: '2026-10-10T10:00:00Z' }
    ],
    outs: [
      // Consumed in week 3: FIFO mandates this must consume from week 1 batch @ 750 first!
      { id: 'cas_wk3', sku: 'CAS', date: '2026-10-17', qty: 5, createdAt: '2026-10-17T12:00:00Z' }
    ]
  };

  const wk1 = computePeriod(d, W(2026, 10, 1).start, W(2026, 10, 1).end);
  const wk2 = computePeriod(d, W(2026, 10, 8).start, W(2026, 10, 8).end);
  const wk3 = computePeriod(d, W(2026, 10, 15).start, W(2026, 10, 15).end);

  // Week 1: Close = 10 @ 750 = 7500
  near(wk1.rows[0].closeQty, 10);
  near(wk1.rows[0].closeValue, 7500);
  assert.ok(wk1.balanced);

  // Week 2: Open = 10 @ 750 (7500) + IN 10 @ 900 (9000) = Close 20 (16500)
  near(wk2.rows[0].openQty, 10);
  near(wk2.rows[0].openValue, 7500);
  near(wk2.rows[0].closeQty, 20);
  near(wk2.rows[0].closeValue, 16500);
  assert.ok(wk2.balanced);

  // Week 3: Open = 20 (16500). OUT 5 @ 750 (oldest week 1 lot) = 3750.
  // Remaining: 5 @ 750 (3750) + 10 @ 900 (9000) = 12750.
  near(wk3.rows[0].openQty, 20);
  near(wk3.rows[0].openValue, 16500);
  near(wk3.rows[0].outQty, 5);
  near(wk3.rows[0].outValue, 3750);
  near(wk3.rows[0].closeQty, 15);
  near(wk3.rows[0].closeValue, 12750);
  assert.ok(wk3.balanced);
});

t('29. Missing master cost falls back safely without NaN or infinite loops', () => {
  const zeroCostItem = { id: 'z1', sku: 'NIL', name: 'Salt Packets', category: 'Condiments', unit: 'pcs', min: 10, cost: 0, storedQty: 100 };
  const d = {
    items: [zeroCostItem],
    ins: [],
    outs: [
      { id: 'zo1', sku: 'NIL', date: '2026-10-02', qty: 20, createdAt: '2026-10-02T10:00:00Z' }
    ]
  };
  const p = computePeriod(d, W(2026, 10, 1).start, W(2026, 10, 1).end);
  const r = p.rows[0];
  assert.equal(r.missingRate, true);
  near(r.openQty, 120);
  near(r.openValue, 0);
  near(r.outQty, 20);
  near(r.outValue, 0);
  near(r.closeQty, 100);
  near(r.closeValue, 0);
  assert.ok(p.balanced);
});

console.log(`\n${passed} tests passed`);

