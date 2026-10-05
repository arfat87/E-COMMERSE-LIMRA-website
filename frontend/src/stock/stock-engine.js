// ═════════════════════════════════════════════════════════════════════
// STOCK ENGINE — pure functions (no DOM, no network) so it can be tested.
//
//  • Weeks are month-based 7-day blocks: 1–7, 8–14, 15–21, 22–28, 29–end.
//  • Valuation is FIFO: every OUT consumes the OLDEST remaining IN lot first.
//  • Opening + IN − OUT = Closing  (in ₹ and per item in qty)
// ═════════════════════════════════════════════════════════════════════

export const CATEGORIES = [
  'Bhusimal & Spices',
  'Dairy Items',
  'Cold Drinks',
  'Fresh Vegetables',
  'Ice Cream',
  'Packaging & Carry Bags',
  'Cleaning & Washings'
];

export const CATEGORY_ICONS = {
  'Bhusimal & Spices': '🌾',
  'Dairy Items': '🥛',
  'Cold Drinks': '🥤',
  'Fresh Vegetables': '🥦',
  'Ice Cream': '🍦',
  'Packaging & Carry Bags': '📦',
  'Cleaning & Washings': '🧹',
  Other: '📋'
};

const EPS = 1e-9;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ───────────── number / money helpers ─────────────
export function safeNum(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
}

export function round2(n) {
  return Math.round((safeNum(n) + Number.EPSILON) * 100) / 100;
}

export function inr(n) {
  const v = round2(n);
  return '₹ ' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtQty(n) {
  const v = Math.round(safeNum(n) * 1000) / 1000;
  return v.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

// ───────────── date helpers ─────────────
export function parseEntryDate(dateStr, createdAt) {
  const raw = String(dateStr || createdAt || '').trim();
  if (!raw) return new Date();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const p = raw.split('T')[0].split(' ')[0].split('-');
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(raw)) {
    const sep = raw.includes('-') ? '-' : '/';
    const p = raw.split(sep);
    return new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10));
  }
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const c = createdAt ? new Date(createdAt) : new Date();
  return Number.isNaN(c.getTime()) ? new Date() : new Date(c.getFullYear(), c.getMonth(), c.getDate());
}

export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayKey() {
  return dayKey(new Date());
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function dayName(d) {
  return DAYS[d.getDay()];
}

export function shortDate(d) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// ───────────── month-based weeks ─────────────
// Week 1 = 1–7, Week 2 = 8–14, Week 3 = 15–21, Week 4 = 22–28, Week 5 = 29–month end
export function getWeekInfo(input) {
  const d = input instanceof Date ? input : parseEntryDate(input);
  const y = d.getFullYear();
  const m = d.getMonth();
  const dim = new Date(y, m + 1, 0).getDate();
  const index = Math.min(5, Math.floor((d.getDate() - 1) / 7) + 1);
  const startDay = (index - 1) * 7 + 1;
  const endDay = index === 5 ? dim : Math.min(index * 7, dim);
  const start = new Date(y, m, startDay, 0, 0, 0, 0);
  const end = new Date(y, m, endDay, 23, 59, 59, 999);
  const weeksInMonth = dim > 28 ? 5 : 4;
  return {
    key: `${y}-${String(m + 1).padStart(2, '0')}-W${index}`,
    year: y,
    month: m,
    index,
    weeksInMonth,
    start,
    end,
    dayCount: endDay - startDay + 1,
    title: `Week ${index}`,
    rangeLabel: `${startDay}–${endDay} ${MONTHS[m]} ${y}`,
    label: `Week ${index} · ${startDay}–${endDay} ${MONTHS[m]} ${y}`
  };
}

export function shiftWeek(week, delta) {
  if (delta > 0) return getWeekInfo(new Date(week.year, week.month, week.end.getDate() + 1));
  return getWeekInfo(new Date(week.year, week.month, week.start.getDate() - 1));
}

export function getMonthInfo(ym) {
  const [y, m] = ym.split('-').map(n => parseInt(n, 10));
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return {
    key: ym,
    year: y,
    month: m - 1,
    start: new Date(y, m - 1, 1, 0, 0, 0, 0),
    end: new Date(y, m, 0, 23, 59, 59, 999),
    label: `${names[m - 1]} ${y}`
  };
}

// ───────────── FIFO period engine ─────────────
/**
 * Replays the whole history (oldest → newest) with FIFO lots and returns
 * opening / IN / OUT / closing for [start, end].
 *
 * data = { items, ins, outs }
 *   items: { id, sku, name, category, unit, min, cost, storedQty }
 *   ins:   { id, date, sku, itemId, description, unit, qty, costPrice, supplier, notes, createdAt }
 *   outs:  { id, date, sku, itemId, description, unit, qty, usedBy, notes, createdAt }
 */
export function computePeriod(data, start, end) {
  const items = data.items || [];
  const ins = data.ins || [];
  const outs = data.outs || [];

  const rows = new Map();
  const mkRow = (key, src = {}) => ({
    key,
    id: src.id || key,
    sku: src.sku || key,
    name: src.name || src.description || key,
    category: src.category || 'Other',
    unit: src.unit || 'pcs',
    min: safeNum(src.min, 0),
    rate: safeNum(src.cost, 0),
    supplier: src.supplier || '',
    orphan: !src.id,
    openQty: 0, openValue: 0,
    inQty: 0, inValue: 0,
    outQty: 0, outValue: 0,
    closeQty: 0, closeValue: 0,
    oldestLot: null,
    missingRate: false,
    status: 'OK'
  });

  items.forEach(it => {
    const key = it.sku || it.id;
    if (key) rows.set(key, mkRow(key, it));
  });
  const ensure = (key, e) => {
    if (!rows.has(key)) {
      rows.set(key, mkRow(key, { sku: e.sku, name: e.description, unit: e.unit, cost: e.costPrice }));
    }
    return rows.get(key);
  };

  // Build chronological event list
  const keyOf = (o) => o.sku || o.itemId || '';
  const createdMs = (o) => Date.parse(o.createdAt) || 0;
  const events = [];
  ins.forEach((e, i) => {
    const key = keyOf(e);
    if (key) events.push({ type: 'IN', e, key, t: parseEntryDate(e.date, e.createdAt), c: createdMs(e), seq: i });
  });
  outs.forEach((e, i) => {
    const key = keyOf(e);
    if (key) events.push({ type: 'OUT', e, key, t: parseEntryDate(e.date, e.createdAt), c: createdMs(e), seq: i });
  });
  events.sort((a, b) => {
    const da = dayKey(a.t), db = dayKey(b.t);
    if (da !== db) return da < db ? -1 : 1;
    if (a.type !== b.type) return a.type === 'IN' ? -1 : 1; // same day: purchases first
    return a.c - b.c || a.seq - b.seq;
  });

  // Lots
  const lots = new Map();     // key -> [{ qty, cost, t, base }]
  const deficit = new Map();  // key -> qty issued beyond available lots
  const lastCost = new Map();
  let total = 0;

  const lotsOf = (key) => {
    if (!lots.has(key)) lots.set(key, []);
    return lots.get(key);
  };

  // Legacy / unexplained balance: stored qty that has no IN entry behind it
  const sumIn = {}, sumOut = {};
  events.forEach(ev => {
    if (ev.e?.id === '__preview__') return;
    const q = safeNum(ev.e.qty, 0);
    if (ev.type === 'IN') sumIn[ev.key] = (sumIn[ev.key] || 0) + q;
    else sumOut[ev.key] = (sumOut[ev.key] || 0) + q;
  });
  items.forEach(it => {
    const key = it.sku || it.id;
    if (!key || it.storedQty === undefined) return;
    const base = safeNum(it.storedQty, 0) - ((sumIn[key] || 0) - (sumOut[key] || 0));
    if (base > 0.001) {
      const cost = safeNum(it.cost, 0);
      lotsOf(key).push({ qty: base, cost, t: new Date(0), base: true });
      lastCost.set(key, cost);
      total += base * cost;
    }
  });

  const snapshot = (key) => {
    const ls = lots.get(key) || [];
    const q = ls.reduce((s, l) => s + l.qty, 0) - (deficit.get(key) || 0);
    const v = ls.reduce((s, l) => s + l.qty * l.cost, 0);
    return { q, v };
  };

  let openCaptured = false;
  let openTotal = 0;
  const captureOpen = () => {
    openTotal = total;
    rows.forEach((row, key) => {
      const s = snapshot(key);
      row.openQty = s.q;
      row.openValue = s.v;
    });
    openCaptured = true;
  };

  const periodIns = [];
  const periodOuts = [];
  const dayClose = {};

  for (const ev of events) {
    if (ev.t > end) break;
    if (!openCaptured && ev.t >= start) captureOpen();

    const row = ensure(ev.key, ev.e);
    const ls = lotsOf(ev.key);
    const qty = safeNum(ev.e.qty, 0);
    const inPeriod = ev.t >= start;

    if (ev.type === 'IN') {
      const cost = safeNum(ev.e.costPrice, row.rate);
      let remaining = qty;
      const d = deficit.get(ev.key) || 0;
      if (d > EPS) {
        const cover = Math.min(d, qty);
        deficit.set(ev.key, d - cover);
        remaining -= cover;
      }
      if (remaining > EPS) {
        ls.push({ qty: remaining, cost, t: ev.t });
        total += remaining * cost;
      }
      lastCost.set(ev.key, cost);
      if (inPeriod) {
        row.inQty += qty;
        row.inValue += qty * cost;
        periodIns.push({ ...ev.e, key: ev.key, entryDate: ev.t, name: row.name, amount: qty * cost, rate: cost });
      }
    } else {
      let remaining = qty;
      let consumed = 0;
      while (remaining > EPS && ls.length > 0) {
        const lot = ls[0];
        const take = Math.min(lot.qty, remaining);
        consumed += take * lot.cost;
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= EPS) ls.shift();
      }
      let usage = consumed;
      if (remaining > EPS) {
        const fb = lastCost.has(ev.key) ? lastCost.get(ev.key) : row.rate;
        usage += remaining * fb;
        deficit.set(ev.key, (deficit.get(ev.key) || 0) + remaining);
      }
      total -= consumed;
      if (inPeriod) {
        row.outQty += qty;
        row.outValue += usage;
        periodOuts.push({ ...ev.e, key: ev.key, entryDate: ev.t, name: row.name, amount: usage, rate: qty > 0 ? usage / qty : 0 });
      }
    }
    if (inPeriod) dayClose[dayKey(ev.t)] = total;
  }
  if (!openCaptured) captureOpen();
  const closeTotal = total;

  // Closing snapshot
  rows.forEach((row, key) => {
    const s = snapshot(key);
    row.closeQty = s.q;
    row.closeValue = s.v;
    const ls = lots.get(key) || [];
    const first = ls.find(l => !l.base) || ls[0];
    row.oldestLot = first && !first.base ? first.t : null;
    row.missingRate = ls.some(l => l.qty > EPS && l.cost <= 0);
    row.status = row.closeQty < -EPS ? 'Negative'
      : row.closeQty <= EPS ? 'Out'
        : (row.min > 0 && row.closeQty <= row.min ? 'Low' : 'OK');
    row.hasMovement = row.inQty > EPS || row.outQty > EPS;
  });

  const rowList = [...rows.values()]
    .filter(r => !r.orphan || r.openQty !== 0 || r.inQty > 0 || r.outQty > 0 || r.closeQty !== 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Totals
  const t = {
    openValue: 0, inValue: 0, outValue: 0, closeValue: 0,
    openItems: 0, closeItems: 0, inCount: periodIns.length, outCount: periodOuts.length,
    adjustment: 0
  };
  const byCategory = {};
  rowList.forEach(r => {
    t.openValue += r.openValue;
    t.inValue += r.inValue;
    t.outValue += r.outValue;
    t.closeValue += r.closeValue;
    if (r.openQty > EPS) t.openItems += 1;
    if (r.closeQty > EPS) t.closeItems += 1;
    const c = byCategory[r.category] || (byCategory[r.category] = { inValue: 0, outValue: 0, closeValue: 0, count: 0 });
    c.inValue += r.inValue;
    c.outValue += r.outValue;
    c.closeValue += r.closeValue;
    c.count += 1;
  });
  t.openValue = openTotal; // authoritative (includes SKUs not in item list)
  t.closeValue = closeTotal;
  t.adjustment = round2(t.closeValue - (t.openValue + t.inValue - t.outValue));

  // Day by day
  const days = [];
  const dayMap = {};
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = dayKey(d);
    const day = { key, date: new Date(d), ins: [], outs: [], inValue: 0, outValue: 0, closeValue: 0 };
    dayMap[key] = day;
    days.push(day);
  }
  periodIns.forEach(e => { const d = dayMap[dayKey(e.entryDate)]; if (d) { d.ins.push(e); d.inValue += e.amount; } });
  periodOuts.forEach(e => { const d = dayMap[dayKey(e.entryDate)]; if (d) { d.outs.push(e); d.outValue += e.amount; } });
  let carry = openTotal;
  days.forEach(d => {
    if (dayClose[d.key] !== undefined) carry = dayClose[d.key];
    d.closeValue = carry;
  });

  return {
    start, end,
    rows: rowList,
    totals: t,
    byCategory,
    days,
    ins: periodIns.sort((a, b) => b.entryDate - a.entryDate),
    outs: periodOuts.sort((a, b) => b.entryDate - a.entryDate),
    balanced: Math.abs(t.adjustment) < 1
  };
}

/** Live stock snapshot (end of today). */
export function computeNow(data) {
  const now = new Date();
  return computePeriod(data, startOfDay(now), endOfDay(now));
}

/** What would a given OUT quantity cost right now (FIFO preview)? */
export function previewOut(data, sku, qty) {
  const res = computeNow(data);
  const row = res.rows.find(r => r.key === sku);
  if (!row) return { available: 0, cost: 0, unit: '' };
  // Re-run quickly with a virtual OUT today to read its FIFO value
  const virtual = {
    ...data,
    outs: [...(data.outs || []), { id: '__preview__', sku, qty, date: todayKey(), createdAt: '9999-12-31T00:00:00.000Z' }]
  };
  const r2 = computeNow(virtual);
  const pv = r2.outs.find(o => o.id === '__preview__');
  return { available: row.closeQty, cost: pv ? pv.amount : 0, unit: row.unit, lastRate: row.rate };
}
