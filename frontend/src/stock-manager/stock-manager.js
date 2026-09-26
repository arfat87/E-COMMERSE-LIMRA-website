import '../style.css';
import './stock-manager.css';
import { insforge } from '../lib/insforge.js';
import { INITIAL_STOCK_ITEMS } from './data/initialStockData.js';

// Safe number & currency helpers
function safeNum(val, fallback = 0) {
  if (val === null || val === undefined) return fallback;
  const num = parseFloat(val);
  return isNaN(num) ? fallback : num;
}

function safeMoney(val) {
  const num = safeNum(val, 0);
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Storage Keys for fast instant local caching
const STORAGE_KEY_ITEMS = 'limra_stock_items_v3';
const STORAGE_KEY_IN = 'limra_stock_in_entries_v3';
const STORAGE_KEY_OUT = 'limra_stock_out_entries_v3';
const STORAGE_KEY_LOGS = 'limra_stock_logs_v3';

// Global State
let stockItems = [];
let stockInEntries = [];
let stockOutEntries = [];
let stockLogs = [];

const _initialNow = new Date();
const _initialYm = `${_initialNow.getFullYear()}-${String(_initialNow.getMonth() + 1).padStart(2, '0')}`;
const _initialDateStr = `${_initialYm}-${String(_initialNow.getDate()).padStart(2, '0')}`;

let currentAppMode = 'live'; // 'live', 'weekly' or 'monthly'
let selectedMonthYear = _initialYm; // Default month (YYYY-MM)
let selectedWeekDate = _initialDateStr; // Default date within week (YYYY-MM-DD)
let monthlyCategoryFilter = 'all';
let monthlyActivityFilter = 'all';

let activeCategory = 'all';
let activeStockLevel = 'all';
let activeStatus = 'all';
let selectedGodown = 'all';
let activeLogFilter = 'all';
let searchQuery = '';
let viewMode = 'feed'; // 'feed' or 'table'
let isDatabaseLoading = false;
let asOnDateEnabled = false;
let asOnDateValue = _initialDateStr;

// ═════════════════════════════════════════════════════════════════════
// ROBUST DATE PARSER & FORMATTING UTILITIES
// ═════════════════════════════════════════════════════════════════════
function parseEntryDate(dateStr, createdAt) {
  const raw = (dateStr || createdAt || '').trim();
  if (!raw) return new Date();

  // If already YYYY-MM-DD or ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parts = raw.split('T')[0].split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  // If DD-MM-YYYY or DD/MM/YYYY
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(raw)) {
    const sep = raw.includes('-') ? '-' : '/';
    const parts = raw.split(sep);
    return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
  }

  const d = new Date(raw);
  return isNaN(d.getTime()) ? (createdAt ? new Date(createdAt) : new Date()) : d;
}

function getYearMonthKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function formatMonthYearLabel(ymKey) {
  if (!ymKey || !ymKey.includes('-')) return ymKey || '';
  const [year, month] = ymKey.split('-');
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const mIdx = parseInt(month, 10) - 1;
  return `${monthNames[mIdx] || month} ${year}`;
}

function getISOWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function getWeekRange(dateOrStr) {
  const d = dateOrStr ? parseEntryDate(dateOrStr) : new Date();
  const day = d.getDay(); // 0 is Sunday, 1 is Monday...
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const formatDateShort = (dt) => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
  };

  const isoWeek = getISOWeekNumber(monday);

  return {
    start: monday,
    end: sunday,
    startDateStr: monday.toISOString().slice(0, 10),
    endDateStr: sunday.toISOString().slice(0, 10),
    label: `${formatDateShort(monday)} — ${formatDateShort(sunday)}`,
    weekNumber: isoWeek,
    year: monday.getFullYear(),
    weekKey: `${monday.getFullYear()}-W${String(isoWeek).padStart(2, '0')}`
  };
}

// ═════════════════════════════════════════════════════════════════════
// DATABASE STATE & OFFLINE CACHE SYNCHRONIZATION
// ═════════════════════════════════════════════════════════════════════

// 1. Initial Instant Cache Load
function loadLocalCache() {
  try {
    const rawItems = localStorage.getItem(STORAGE_KEY_ITEMS);
    if (rawItems) {
      stockItems = JSON.parse(rawItems);
    } else {
      stockItems = JSON.parse(JSON.stringify(INITIAL_STOCK_ITEMS));
    }
  } catch (e) {
    stockItems = JSON.parse(JSON.stringify(INITIAL_STOCK_ITEMS));
  }

  try {
    const rawIn = localStorage.getItem(STORAGE_KEY_IN);
    stockInEntries = rawIn ? JSON.parse(rawIn) : [];
  } catch (e) {
    stockInEntries = [];
  }

  try {
    const rawOut = localStorage.getItem(STORAGE_KEY_OUT);
    stockOutEntries = rawOut ? JSON.parse(rawOut) : [];
  } catch (e) {
    stockOutEntries = [];
  }

  try {
    const rawLogs = localStorage.getItem(STORAGE_KEY_LOGS);
    stockLogs = rawLogs ? JSON.parse(rawLogs) : [];
  } catch (e) {
    stockLogs = [];
  }

  recalculateBalances();
}

function saveLocalCache() {
  try {
    localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(stockItems));
    localStorage.setItem(STORAGE_KEY_IN, JSON.stringify(stockInEntries));
    localStorage.setItem(STORAGE_KEY_OUT, JSON.stringify(stockOutEntries));
    localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(stockLogs));
  } catch (e) {
    console.warn('[StockManager] Save local cache failed:', e);
  }
}

// 2. Fetch Fresh Data Directly from InsForge PostgreSQL Database
async function fetchDatabaseState() {
  const statusBadge = document.getElementById('db-status-badge');
  const statusText = document.getElementById('db-status-text');

  if (statusText) statusText.textContent = 'Syncing DB...';
  if (statusBadge) statusBadge.className = 'stk-db-badge syncing';

  isDatabaseLoading = true;

  try {
    const [itemsRes, inRes, outRes, logsRes] = await Promise.all([
      insforge.database.from('stock_items').select('*').order('sku', { ascending: true }),
      insforge.database.from('stock_in').select('*').order('created_at', { ascending: false }),
      insforge.database.from('stock_out').select('*').order('created_at', { ascending: false }),
      insforge.database.from('stock_logs').select('*').order('created_at', { ascending: false }).limit(100)
    ]);

    if (itemsRes.data && itemsRes.data.length > 0) {
      stockItems = itemsRes.data.map(item => ({
        id: item.id,
        sku: item.sku,
        name: item.name,
        category: item.category || 'Bhusimal & Spices',
        godown: item.godown || 'Main Godown',
        unit: item.unit || 'pcs',
        min: safeNum(item.min_qty, 5),
        cost: safeNum(item.cost_price, 0),
        salePrice: safeNum(item.sale_price, 0),
        supplier: item.supplier || '',
        isAvailable: item.is_available ?? true,
        storedQty: safeNum(item.qty, 0),
        updatedAt: item.updated_at
      }));
    }

    if (inRes.data) {
      stockInEntries = inRes.data.map(entry => ({
        id: entry.id,
        date: entry.date || new Date(entry.created_at || Date.now()).toLocaleDateString('en-GB'),
        sku: entry.item_sku || entry.sku || '',
        description: entry.item_name || entry.description || 'Stock IN',
        unit: entry.unit || 'pcs',
        qty: safeNum(entry.qty, 0),
        costPrice: safeNum(entry.cost_price, 0),
        supplier: entry.supplier || '',
        notes: entry.notes || '',
        createdAt: entry.created_at
      }));
    }

    if (outRes.data) {
      stockOutEntries = outRes.data.map(entry => ({
        id: entry.id,
        date: entry.date || new Date(entry.created_at || Date.now()).toLocaleDateString('en-GB'),
        sku: entry.item_sku || entry.sku || '',
        description: entry.item_name || entry.description || 'Stock OUT',
        unit: entry.unit || 'pcs',
        qty: safeNum(entry.qty, 0),
        usedBy: entry.used_by || '',
        notes: entry.notes || '',
        createdAt: entry.created_at
      }));
    }

    if (logsRes.data) {
      stockLogs = logsRes.data.map(log => ({
        id: log.id,
        date: new Date(log.created_at).toLocaleDateString('en-GB') + ' ' + new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        itemName: log.action ? log.action.split('(')[0].trim() : 'Stock Action',
        type: log.action || 'Movement',
        qtyText: log.details ? (log.details.split('|')[0] || '').trim() : '',
        notes: log.details || '',
        createdAt: log.created_at
      }));
    }

    recalculateBalances();
    saveLocalCache();

    if (statusText) statusText.textContent = 'DB Connected';
    if (statusBadge) statusBadge.className = 'stk-db-badge connected';

    renderAll();
  } catch (err) {
    console.error('[StockManager] Database fetch error:', err);
    if (statusText) statusText.textContent = 'Offline (Cached)';
    if (statusBadge) statusBadge.className = 'stk-db-badge offline';
  } finally {
    isDatabaseLoading = false;
  }
}

// ═════════════════════════════════════════════════════════════════════
// CALCULATION ENGINE: Actual Balance = Total IN - Total OUT (from DB)
// ═════════════════════════════════════════════════════════════════════
function recalculateBalances() {
  const asOnCutoff = asOnDateEnabled && asOnDateValue ? new Date(asOnDateValue + 'T23:59:59.999') : null;

  stockItems.forEach(item => {
    let matchingIn = stockInEntries.filter(e => e.sku === item.sku);
    let matchingOut = stockOutEntries.filter(e => e.sku === item.sku);

    if (asOnCutoff) {
      matchingIn = matchingIn.filter(e => parseEntryDate(e.date, e.createdAt) <= asOnCutoff);
      matchingOut = matchingOut.filter(e => parseEntryDate(e.date, e.createdAt) <= asOnCutoff);
    }

    const totalIn = matchingIn.reduce((sum, e) => sum + safeNum(e.qty), 0);
    const totalOut = matchingOut.reduce((sum, e) => sum + safeNum(e.qty), 0);

    item.totalIn = parseFloat(totalIn.toFixed(2));
    item.totalOut = parseFloat(totalOut.toFixed(2));

    // If transactions exist in DB, balance is Total IN - Total OUT.
    // Otherwise fallback to stored quantity in DB.
    if (matchingIn.length > 0 || matchingOut.length > 0) {
      item.qty = parseFloat((totalIn - totalOut).toFixed(2));
    } else if (asOnCutoff) {
      item.qty = 0;
    } else {
      item.qty = safeNum(item.storedQty, 0);
    }
  });
}

// ═════════════════════════════════════════════════════════════════════
// PERIOD CALCULATION ENGINE: Opening + Period IN - Period OUT = Closing
// Handles both Weekly (Monday-Sunday) and Monthly (1st to Month-End)
// ═════════════════════════════════════════════════════════════════════
function calculatePeriodInventory(type = 'month', param = null) {
  let startOfPeriod;
  let endOfPeriod;
  let periodLabel = '';
  let periodKey = '';

  if (type === 'week') {
    const weekInfo = getWeekRange(param || selectedWeekDate);
    startOfPeriod = weekInfo.start;
    endOfPeriod = weekInfo.end;
    periodLabel = `Week ${weekInfo.weekNumber} (${weekInfo.label})`;
    periodKey = weekInfo.weekKey;
  } else {
    const ym = param || selectedMonthYear || _initialYm;
    const [yearStr, monthStr] = ym.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    startOfPeriod = new Date(year, month - 1, 1, 0, 0, 0, 0);
    endOfPeriod = new Date(year, month, 0, 23, 59, 59, 999);
    periodLabel = formatMonthYearLabel(ym);
    periodKey = ym;
  }

  const monthInList = [];
  const monthOutList = [];

  // Map each SKU with prior transactions and current period movements
  const itemMap = {};
  stockItems.forEach(item => {
    itemMap[item.sku] = {
      id: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category || 'Bhusimal & Spices',
      godown: item.godown || 'Main Godown',
      unit: item.unit || 'pcs',
      min: safeNum(item.min, 0),
      cost: safeNum(item.cost, 0),
      salePrice: safeNum(item.salePrice, 0),
      supplier: item.supplier || '',
      priorInQty: 0,
      priorOutQty: 0,
      monthInQty: 0,
      monthInValue: 0,
      monthInCount: 0,
      monthOutQty: 0,
      monthOutValue: 0,
      monthOutCount: 0,
      latestCost: safeNum(item.cost, 0),
      latestRateDiff: 0
    };
  });

  // Process Stock IN entries
  stockInEntries.forEach(entry => {
    const entryDate = parseEntryDate(entry.date, entry.createdAt);
    const sku = entry.sku;
    if (!sku) return;

    if (!itemMap[sku]) {
      itemMap[sku] = {
        id: entry.itemId || sku,
        sku,
        name: entry.description || sku,
        category: 'Bhusimal & Spices',
        godown: 'Main Godown',
        unit: entry.unit || 'pcs',
        min: 0,
        cost: safeNum(entry.costPrice, 0),
        salePrice: 0,
        supplier: entry.supplier || '',
        priorInQty: 0,
        priorOutQty: 0,
        monthInQty: 0,
        monthInValue: 0,
        monthInCount: 0,
        monthOutQty: 0,
        monthOutValue: 0,
        monthOutCount: 0,
        latestCost: safeNum(entry.costPrice, 0),
        latestRateDiff: safeNum(entry.rateDiff, 0)
      };
    }

    const qty = safeNum(entry.qty, 0);
    const cost = safeNum(entry.costPrice, itemMap[sku].cost);

    if (entryDate < startOfPeriod) {
      itemMap[sku].priorInQty += qty;
    } else if (entryDate >= startOfPeriod && entryDate <= endOfPeriod) {
      itemMap[sku].monthInQty += qty;
      itemMap[sku].monthInValue += (qty * cost);
      itemMap[sku].monthInCount += 1;
      itemMap[sku].latestCost = cost;
      if (entry.rateDiff !== undefined) itemMap[sku].latestRateDiff = entry.rateDiff;
      monthInList.push({
        ...entry,
        entryDate,
        amount: qty * cost
      });
    }
  });

  // Process Stock OUT entries
  stockOutEntries.forEach(entry => {
    const entryDate = parseEntryDate(entry.date, entry.createdAt);
    const sku = entry.sku;
    if (!sku) return;

    if (!itemMap[sku]) {
      itemMap[sku] = {
        id: entry.itemId || sku,
        sku,
        name: entry.description || sku,
        category: 'Bhusimal & Spices',
        godown: 'Main Godown',
        unit: entry.unit || 'pcs',
        min: 0,
        cost: 0,
        salePrice: 0,
        supplier: '',
        priorInQty: 0,
        priorOutQty: 0,
        monthInQty: 0,
        monthInValue: 0,
        monthInCount: 0,
        monthOutQty: 0,
        monthOutValue: 0,
        monthOutCount: 0,
        latestCost: 0,
        latestRateDiff: 0
      };
    }

    const qty = safeNum(entry.qty, 0);
    const cost = itemMap[sku].cost;

    if (entryDate < startOfPeriod) {
      itemMap[sku].priorOutQty += qty;
    } else if (entryDate >= startOfPeriod && entryDate <= endOfPeriod) {
      itemMap[sku].monthOutQty += qty;
      itemMap[sku].monthOutValue += (qty * cost);
      itemMap[sku].monthOutCount += 1;
      monthOutList.push({
        ...entry,
        entryDate,
        costAmount: qty * cost
      });
    }
  });

  // Compute item metrics, category groups, and totals
  let totalOpeningQty = 0;
  let totalOpeningValue = 0;
  let totalInQty = 0;
  let totalInValue = 0;
  let totalOutQty = 0;
  let totalOutValue = 0;
  let totalClosingValue = 0;
  let totalClosingQty = 0;
  let activeSkuCount = 0;

  const categories = {
    'Bhusimal & Spices': { inValue: 0, outValue: 0, closingValue: 0, inQty: 0, outQty: 0, count: 0, icon: '🌾' },
    'Dairy Items': { inValue: 0, outValue: 0, closingValue: 0, inQty: 0, outQty: 0, count: 0, icon: '🥛' },
    'Cold Drinks': { inValue: 0, outValue: 0, closingValue: 0, inQty: 0, outQty: 0, count: 0, icon: '🥤' },
    'Fresh Vegetables': { inValue: 0, outValue: 0, closingValue: 0, inQty: 0, outQty: 0, count: 0, icon: '🥦' },
    'Ice Cream': { inValue: 0, outValue: 0, closingValue: 0, inQty: 0, outQty: 0, count: 0, icon: '🍦' },
    'Packaging & Carry Bags': { inValue: 0, outValue: 0, closingValue: 0, inQty: 0, outQty: 0, count: 0, icon: '📦' },
    'Cleaning & Washings': { inValue: 0, outValue: 0, closingValue: 0, inQty: 0, outQty: 0, count: 0, icon: '🧹' }
  };

  const calculatedItems = Object.values(itemMap).map(i => {
    const openingQty = parseFloat((i.priorInQty - i.priorOutQty).toFixed(2));
    const openingValue = Math.max(0, openingQty) * i.cost;
    const inQty = parseFloat(i.monthInQty.toFixed(2));
    const outQty = parseFloat(i.monthOutQty.toFixed(2));
    const closingQty = parseFloat((openingQty + inQty - outQty).toFixed(2));
    const closingValue = Math.max(0, closingQty) * i.cost;
    const netQty = parseFloat((inQty - outQty).toFixed(2));
    const netValue = i.monthInValue - i.monthOutValue;

    if (inQty > 0 || outQty > 0) {
      activeSkuCount++;
    }

    totalOpeningQty += openingQty;
    totalOpeningValue += openingValue;
    totalInQty += inQty;
    totalInValue += i.monthInValue;
    totalOutQty += outQty;
    totalOutValue += i.monthOutValue;
    totalClosingValue += closingValue;
    totalClosingQty += closingQty;

    const catName = categories[i.category] ? i.category : 'Bhusimal & Spices';
    categories[catName].inValue += i.monthInValue;
    categories[catName].outValue += i.monthOutValue;
    categories[catName].closingValue += closingValue;
    categories[catName].inQty += inQty;
    categories[catName].outQty += outQty;
    categories[catName].count += 1;

    let status = 'Unchanged';
    if (closingQty < 0) status = 'Negative Stock';
    else if (closingQty === 0) status = 'Out of Stock';
    else if (closingQty <= i.min) status = 'Low Stock';
    else if (outQty > 0 && inQty > 0) status = 'Active & Restocked';
    else if (inQty > 0) status = 'Restocked';
    else if (outQty > 0) status = 'Consumed';

    const availableTotal = openingQty + inQty;
    const depletionRate = availableTotal > 0
      ? Math.min(100, (outQty / availableTotal) * 100).toFixed(1)
      : (outQty > 0 ? '100.0' : '0.0');

    return {
      ...i,
      openingQty,
      openingValue,
      monthInQty: inQty,
      monthOutQty: outQty,
      monthOutValue: i.monthOutValue,
      closingQty,
      closingValue,
      netQty,
      netValue,
      depletionRate,
      status
    };
  });

  const topQtyGone = [...calculatedItems]
    .filter(i => i.monthOutQty > 0)
    .sort((a, b) => b.monthOutQty - a.monthOutQty)
    .slice(0, 5);

  const topValueGone = [...calculatedItems]
    .filter(i => i.monthOutValue > 0)
    .sort((a, b) => b.monthOutValue - a.monthOutValue)
    .slice(0, 5);

  return {
    periodType: type,
    periodKey,
    yearMonthStr: periodKey,
    periodLabel,
    monthLabel: periodLabel,
    items: calculatedItems.sort((a, b) => (a.sku || '').localeCompare(b.sku || '')),
    monthInEntries: monthInList.sort((a, b) => b.entryDate - a.entryDate),
    monthOutEntries: monthOutList.sort((a, b) => b.entryDate - a.entryDate),
    topQtyGone,
    topValueGone,
    totals: {
      totalOpeningQty: parseFloat(totalOpeningQty.toFixed(2)),
      totalOpeningValue,
      totalInQty: parseFloat(totalInQty.toFixed(2)),
      totalInValue,
      totalInCount: monthInList.length,
      totalOutQty: parseFloat(totalOutQty.toFixed(2)),
      totalOutValue,
      totalOutCount: monthOutList.length,
      totalNetQty: parseFloat((totalInQty - totalOutQty).toFixed(2)),
      totalNetValue: totalInValue - totalOutValue,
      totalClosingValue,
      totalClosingQty: parseFloat(totalClosingQty.toFixed(2)),
      activeSkuCount
    },
    categories
  };
}

function calculateMonthlyInventory(yearMonthStr) {
  return calculatePeriodInventory('month', yearMonthStr);
}

function calculateWeeklyInventory(weekDateStr) {
  return calculatePeriodInventory('week', weekDateStr);
}

async function addLogToDB(action, details) {
  const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  const logObj = {
    id: logId,
    action,
    details,
    created_at: new Date().toISOString()
  };

  // Add locally immediately
  stockLogs.unshift({
    id: logId,
    date: new Date().toLocaleDateString('en-GB') + ' ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    itemName: action.split('(')[0].trim(),
    type: action,
    qtyText: details.split('|')[0]?.trim() || '',
    notes: details,
    createdAt: logObj.created_at
  });
  if (stockLogs.length > 80) stockLogs = stockLogs.slice(0, 80);
  saveLocalCache();
  renderLogs();

  // Async sync to InsForge DB
  try {
    await insforge.database.from('stock_logs').insert([logObj]);
  } catch (err) {
    console.warn('[StockManager] Log sync to DB error:', err);
  }
}

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const toastClass = {
    success: 'toast-success',
    info: 'toast-info',
    warning: 'toast-warning',
    error: 'toast-error'
  };

  const icons = {
    success: '✅',
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌'
  };

  toast.className = `stock-toast ${toastClass[type] || 'toast-info'}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// Filtered Items for Directory and Balance Box
function getFilteredItems() {
  const query = (searchQuery || '').toLowerCase().trim();

  return stockItems.filter(item => {
    if (!item) return false;

    // Category match
    const catMatch = activeCategory === 'all' || item.category === activeCategory;

    // Godown match
    const godownMatch = selectedGodown === 'all' || item.godown === selectedGodown;

    // Stock Level Filter (All, In Stock, Low Stock, Negative)
    const isNegative = item.qty < 0;
    const isLow = !isNegative && item.qty <= item.min;
    const isInStock = item.qty > 0;

    let levelMatch = true;
    if (activeStockLevel === 'instock') levelMatch = isInStock;
    if (activeStockLevel === 'low') levelMatch = isLow || isNegative;
    if (activeStockLevel === 'negative') levelMatch = isNegative;

    // Status match
    let statusMatch = true;
    if (activeStatus === 'active') statusMatch = item.qty > 0;
    if (activeStatus === 'out') statusMatch = item.qty === 0;

    // Search query match
    const searchMatch = !query ||
      (item.name && item.name.toLowerCase().includes(query)) ||
      (item.sku && item.sku.toLowerCase().includes(query)) ||
      (item.category && item.category.toLowerCase().includes(query)) ||
      (item.supplier && item.supplier.toLowerCase().includes(query));

    return catMatch && godownMatch && levelMatch && statusMatch && searchMatch;
  });
}

// ═════════════════════════════════════════════════════════════════════
// SPREADSHEET TABLES: 📥 STOCK IN, 📤 STOCK OUT, and ⚖️ BALANCE
// ═════════════════════════════════════════════════════════════════════
function renderInOutBalanceTables() {
  const inBody = document.getElementById('table-in-body');
  const outBody = document.getElementById('table-out-body');
  const balanceBody = document.getElementById('table-balance-body');

  const badgeIn = document.getElementById('badge-in-count');
  const badgeOut = document.getElementById('badge-out-count');
  const badgeBalance = document.getElementById('badge-balance-count');

  const q = (searchQuery || '').toLowerCase().trim();

  const filteredIn = q
    ? stockInEntries.filter(e => (e.description && e.description.toLowerCase().includes(q)) || (e.sku && e.sku.toLowerCase().includes(q)))
    : stockInEntries;

  const filteredOut = q
    ? stockOutEntries.filter(e => (e.description && e.description.toLowerCase().includes(q)) || (e.sku && e.sku.toLowerCase().includes(q)))
    : stockOutEntries;

  const filteredItems = getFilteredItems();

  if (badgeIn) badgeIn.textContent = `${filteredIn.length} entries`;
  if (badgeOut) badgeOut.textContent = `${filteredOut.length} entries`;
  if (badgeBalance) badgeBalance.textContent = `${filteredItems.length} items`;

  // 1. Render TABLE 1: STOCK IN
  if (inBody) {
    if (filteredIn.length === 0) {
      inBody.innerHTML = '<tr><td colspan="9" class="py-4 text-center font-medium" style="color:var(--adm-muted);">No Stock IN entries yet. Click "+ Record IN Stock" to add.</td></tr>';
    } else {
      inBody.innerHTML = filteredIn.map(entry => {
        const costPrice = safeNum(entry.costPrice, 0);
        const prevCost = safeNum(entry.previousCostPrice, 0);
        const rateDiff = entry.rateDiff !== undefined ? safeNum(entry.rateDiff, 0) : (prevCost > 0 ? costPrice - prevCost : 0);
        const totalAmt = safeNum(entry.totalAmount, costPrice * safeNum(entry.qty, 0));

        let diffBadge = '<span class="stk-rate-pill rate-same">—</span>';
        if (rateDiff > 0) {
          diffBadge = `<span class="stk-rate-pill rate-up">+₹${rateDiff.toFixed(1)} 🔺</span>`;
        } else if (rateDiff < 0) {
          diffBadge = `<span class="stk-rate-pill rate-down">-₹${Math.abs(rateDiff).toFixed(1)} 🔻</span>`;
        } else if (costPrice > 0 && prevCost > 0) {
          diffBadge = '<span class="stk-rate-pill rate-same">=</span>';
        }

        return `
          <tr>
            <td class="whitespace-nowrap font-mono" style="color:var(--adm-muted);">${entry.date}</td>
            <td class="font-bold font-mono" style="color:#4f46e5;">${entry.sku}</td>
            <td class="font-semibold truncate max-w-[130px] sm:max-w-none" style="color:var(--adm-text);">${entry.description}</td>
            <td style="color:var(--adm-muted);font-size:0.75rem;">${entry.unit}</td>
            <td class="text-right font-black" style="color:#059669;">+${entry.qty}</td>
            <td class="text-right font-mono" style="color:var(--adm-text);">₹ ${safeMoney(costPrice)}</td>
            <td class="text-center">${diffBadge}</td>
            <td class="text-right font-mono font-bold" style="color:#059669;">₹ ${safeMoney(totalAmt)}</td>
            <td class="text-center stock-no-print">
              <button class="btn-del-in font-bold p-1 cursor-pointer transition-transform active:scale-95" style="color:#e11d48;background:none;border:none;" data-id="${entry.id}" title="Delete wrong IN entry">🗑️</button>
            </td>
          </tr>
        `;
      }).join('');

      inBody.querySelectorAll('.btn-del-in').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteStockInEntry(btn.dataset.id);
        });
      });
    }
  }

  // 2. Render TABLE 2: STOCK OUT
  if (outBody) {
    if (filteredOut.length === 0) {
      outBody.innerHTML = '<tr><td colspan="7" class="py-4 text-center font-medium" style="color:var(--adm-muted);">No Stock OUT entries yet. Click "- Record OUT Stock" to add.</td></tr>';
    } else {
      outBody.innerHTML = filteredOut.map(entry => {
        const itm = stockItems.find(i => i.sku === entry.sku);
        const costPrice = safeNum(itm?.cost, 0);
        const costVal = costPrice * safeNum(entry.qty, 0);
        const reason = entry.usedBy || 'Kitchen Prep';

        return `
          <tr>
            <td class="whitespace-nowrap font-mono" style="color:var(--adm-muted);">${entry.date}</td>
            <td class="font-bold font-mono" style="color:#d97706;">${entry.sku}</td>
            <td class="font-semibold truncate max-w-[120px] sm:max-w-none" style="color:var(--adm-text);">${entry.description}</td>
            <td class="truncate max-w-[90px]" style="color:var(--adm-muted);font-size:0.75rem;">${reason}</td>
            <td class="text-right font-black" style="color:#d97706;">-${entry.qty} ${entry.unit || ''}</td>
            <td class="text-right font-mono font-bold" style="color:#d97706;">₹ ${safeMoney(costVal)}</td>
            <td class="text-center stock-no-print">
              <button class="btn-del-out font-bold p-1 cursor-pointer transition-transform active:scale-95" style="color:#e11d48;background:none;border:none;" data-id="${entry.id}" title="Delete wrong OUT entry">🗑️</button>
            </td>
          </tr>
        `;
      }).join('');

      outBody.querySelectorAll('.btn-del-out').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteStockOutEntry(btn.dataset.id);
        });
      });
    }
  }

  // 3. Render TABLE 3: REAL-TIME BALANCE
  if (balanceBody) {
    if (filteredItems.length === 0) {
      balanceBody.innerHTML = '<tr><td colspan="7" class="py-4 text-center font-medium" style="color:var(--adm-muted);">No matching stock items.</td></tr>';
    } else {
      balanceBody.innerHTML = filteredItems.map(item => {
        const isNegative = item.qty < 0;
        const isLow = !isNegative && item.qty <= item.min;
        const isOut = item.qty === 0;
        const itemVal = Math.max(0, safeNum(item.qty, 0)) * safeNum(item.cost, 0);

        let badgeClass = 'color:#0284c7;font-weight:800;';
        let statusBadge = '<span class="adm-pill delivered">In Stock</span>';
        let rowBg = '';

        if (isNegative) {
          badgeClass = 'color:#e11d48;font-weight:900;';
          statusBadge = '<span class="adm-pill cancelled">Negative</span>';
          rowBg = 'background:rgba(244,63,94,0.06);';
        } else if (isOut) {
          badgeClass = 'color:#e11d48;font-weight:900;';
          statusBadge = '<span class="adm-pill cancelled">Out of Stock</span>';
          rowBg = 'background:rgba(244,63,94,0.06);';
        } else if (isLow) {
          badgeClass = 'color:#d97706;font-weight:900;';
          statusBadge = '<span class="adm-pill pending">Low Stock</span>';
          rowBg = 'background:rgba(245,158,11,0.06);';
        }

        return `
          <tr data-action="view-details" data-id="${item.id}" style="cursor:pointer;${rowBg}">
            <td class="font-bold font-mono" style="color:#4f46e5;">${item.sku}</td>
            <td class="font-semibold truncate max-w-[150px] sm:max-w-none" style="color:var(--adm-text);">${item.name}</td>
            <td style="color:var(--adm-muted);font-size:0.75rem;">${item.category}</td>
            <td class="text-right font-mono" style="color:var(--adm-text);">₹ ${safeMoney(item.cost)}</td>
            <td class="text-center font-mono" style="${badgeClass}">${item.qty} ${item.unit}</td>
            <td class="text-right font-mono font-bold" style="color:#059669;">₹ ${safeMoney(itemVal)}</td>
            <td class="text-center">${statusBadge}</td>
            <td class="text-center stock-no-print" onclick="event.stopPropagation()">
              <div style="display:inline-flex;align-items:center;gap:0.3rem;">
                <button data-action="row-in" data-id="${item.id}" class="adm-btn adm-btn-outline adm-btn-sm" style="color:#059669;padding:0.2rem 0.45rem;font-size:0.72rem;font-weight:700;" title="Quick Purchase IN">+ IN</button>
                <button data-action="row-out" data-id="${item.id}" class="adm-btn adm-btn-outline adm-btn-sm" style="color:#d97706;padding:0.2rem 0.45rem;font-size:0.72rem;font-weight:700;" title="Quick Kitchen Usage OUT">- OUT</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      balanceBody.querySelectorAll('tr[data-action="view-details"]').forEach(row => {
        row.addEventListener('click', () => openItemDetailsModal(row.dataset.id));
      });

      balanceBody.querySelectorAll('button[data-action="row-in"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openInOutModal('IN', btn.dataset.id);
        });
      });

      balanceBody.querySelectorAll('button[data-action="row-out"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openInOutModal('OUT', btn.dataset.id);
        });
      });
    }
  }

  renderCriticalStockSection();
}

// ═════════════════════════════════════════════════════════════════════
// DELETE STOCK IN / OUT ENTRIES WITH DATABASE PERSISTENCE
// ═════════════════════════════════════════════════════════════════════
async function deleteStockInEntry(entryId) {
  const index = stockInEntries.findIndex(e => e.id === entryId);
  if (index === -1) return;
  const entry = stockInEntries[index];

  if (!confirm(`Are you sure you want to delete this Stock IN entry?\n\nSKU: ${entry.sku}\nItem: ${entry.description}\nQty: +${entry.qty} ${entry.unit}\nDate: ${entry.date}`)) {
    return;
  }

  // Remove locally
  stockInEntries.splice(index, 1);
  recalculateBalances();
  saveLocalCache();
  renderAll();
  showToast(`Deleted Stock IN entry for "${entry.description}"`, 'info');

  // Database operations
  try {
    await insforge.database.from('stock_in').delete().eq('id', entryId);
    await addLogToDB(
      `${entry.description} (Delete Stock IN)`,
      `-${entry.qty} ${entry.unit} | Removed Stock IN entry for SKU ${entry.sku}`
    );

    // Sync updated item qty
    const targetItem = stockItems.find(i => i.sku === entry.sku);
    if (targetItem) {
      await insforge.database.from('stock_items').update({
        qty: targetItem.qty,
        updated_at: new Date().toISOString()
      }).eq('id', targetItem.id);
    }
  } catch (err) {
    console.error('[StockManager] Error deleting Stock IN from DB:', err);
    showToast('Failed to sync deletion to database.', 'error');
  }
}

async function deleteStockOutEntry(entryId) {
  const index = stockOutEntries.findIndex(e => e.id === entryId);
  if (index === -1) return;
  const entry = stockOutEntries[index];

  if (!confirm(`Are you sure you want to delete this Stock OUT entry?\n\nSKU: ${entry.sku}\nItem: ${entry.description}\nQty: -${entry.qty} ${entry.unit}\nDate: ${entry.date}`)) {
    return;
  }

  // Remove locally
  stockOutEntries.splice(index, 1);
  recalculateBalances();
  saveLocalCache();
  renderAll();
  showToast(`Deleted Stock OUT entry for "${entry.description}"`, 'info');

  // Database operations
  try {
    await insforge.database.from('stock_out').delete().eq('id', entryId);
    await addLogToDB(
      `${entry.description} (Delete Stock OUT)`,
      `+${entry.qty} ${entry.unit} | Removed Stock OUT entry for SKU ${entry.sku}`
    );

    // Sync updated item qty
    const targetItem = stockItems.find(i => i.sku === entry.sku);
    if (targetItem) {
      await insforge.database.from('stock_items').update({
        qty: targetItem.qty,
        updated_at: new Date().toISOString()
      }).eq('id', targetItem.id);
    }
  } catch (err) {
    console.error('[StockManager] Error deleting Stock OUT from DB:', err);
    showToast('Failed to sync deletion to database.', 'error');
  }
}

// ═════════════════════════════════════════════════════════════════════
// CRITICAL OUT-OF-STOCK & LOW-STOCK ALERTS MINI-CARDS
// ═════════════════════════════════════════════════════════════════════
function renderCriticalStockSection() {
  const sectionEl = document.getElementById('critical-stock-section');
  const gridEl = document.getElementById('critical-items-grid');
  const badgeEl = document.getElementById('critical-count-badge');
  if (!sectionEl || !gridEl) return;

  const criticalItems = stockItems.filter(item => item.qty <= item.min);

  if (badgeEl) badgeEl.textContent = `${criticalItems.length} critical item${criticalItems.length === 1 ? '' : 's'}`;

  if (criticalItems.length === 0) {
    sectionEl.classList.add('hidden');
    gridEl.innerHTML = '';
    return;
  }

  sectionEl.classList.remove('hidden');
  sectionEl.classList.remove('adm-hidden');
  gridEl.innerHTML = criticalItems.map(item => {
    const isOut = item.qty === 0;
    const isNegative = item.qty < 0;

    let statusPill = '<span class="adm-pill pending">Low Stock</span>';
    if (isNegative) {
      statusPill = '<span class="adm-pill cancelled">Negative</span>';
    } else if (isOut) {
      statusPill = '<span class="adm-pill cancelled">Out of Stock</span>';
    }

    return `
      <div data-action="view-details" data-id="${item.id}" class="adm-card" style="padding:0.85rem;cursor:pointer;border-left:4px solid #ef4444;transition:transform 0.15s ease,box-shadow 0.15s ease;">
        <div style="display:flex;align-items:start;justify-content:space-between;gap:0.4rem;margin-bottom:0.4rem;">
          <span class="stk-rate-pill rate-same" style="font-weight:800;color:#4f46e5;">${item.sku}</span>
          ${statusPill}
        </div>
        <div>
          <h4 style="font-size:0.85rem;font-weight:800;color:var(--adm-text);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${item.name}">${item.name}</h4>
          <p style="font-size:0.72rem;color:var(--adm-muted);margin:2px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.category}</p>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding-top:0.4rem;border-top:1px solid var(--adm-border);font-size:0.75rem;margin-top:0.4rem;">
          <span style="color:var(--adm-muted);">Balance:</span>
          <span style="font-weight:900;font-family:monospace;color:${item.qty <= 0 ? '#e11d48' : '#d97706'};">${item.qty} ${item.unit}</span>
        </div>
      </div>
    `;
  }).join('');

  gridEl.querySelectorAll('div[data-action="view-details"]').forEach(card => {
    card.addEventListener('click', () => openItemDetailsModal(card.dataset.id));
  });
}

// ═════════════════════════════════════════════════════════════════════
// KPI SUMMARY CARDS
// ═════════════════════════════════════════════════════════════════════
function renderKPIs() {
  const totalItems = stockItems.length;
  let lowCount = 0;
  let totalValue = 0;

  stockItems.forEach(item => {
    if (item.qty <= item.min) lowCount++;
    const validQty = Math.max(0, safeNum(item.qty, 0));
    totalValue += (validQty * safeNum(item.cost, 0));
  });

  // Calculate Out Today (Kitchen Consumption)
  const todayStr = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
  const todayIso = new Date().toISOString().slice(0, 10);
  const outTodayQty = stockOutEntries
    .filter(e => {
      const eDate = (e.date || '').replace(/\//g, '-');
      const curDateFormatted = todayStr.replace(/\//g, '-');
      return eDate === curDateFormatted || (e.createdAt && e.createdAt.startsWith(todayIso));
    })
    .reduce((sum, e) => sum + safeNum(e.qty, 0), 0);

  const totalEl = document.getElementById('kpi-total-items');
  const lowEl = document.getElementById('kpi-low-items');
  const outTodayEl = document.getElementById('kpi-out-today');
  const valEl = document.getElementById('kpi-total-value');

  if (totalEl) totalEl.textContent = totalItems;
  if (lowEl) lowEl.textContent = lowCount;
  if (outTodayEl) outTodayEl.textContent = `${outTodayQty.toFixed(1)} units`;
  if (valEl) valEl.textContent = '₹ ' + safeMoney(totalValue);
}

// ═════════════════════════════════════════════════════════════════════
// MASTER INVENTORY DIRECTORY (Card Feed & Table Views)
// ═════════════════════════════════════════════════════════════════════
function renderCardFeed() {
  const feedContainer = document.getElementById('stock-feed-container');
  const emptyState = document.getElementById('stock-empty-state');
  const badge = document.getElementById('stock-count-badge');
  const filtered = getFilteredItems();

  if (badge) badge.textContent = `${filtered.length} item(s)`;

  if (filtered.length === 0) {
    if (feedContainer) feedContainer.innerHTML = '';
    emptyState?.classList.remove('hidden');
    return;
  }

  emptyState?.classList.add('hidden');
  if (!feedContainer) return;

  const monthData = calculateMonthlyInventory(selectedMonthYear);
  const monthItemMap = {};
  monthData.items.forEach(mi => {
    monthItemMap[mi.sku] = mi;
  });

  feedContainer.innerHTML = filtered.map(item => {
    const isNegative = item.qty < 0;
    const isLow = !isNegative && item.qty <= item.min;
    const itemValue = Math.max(0, item.qty) * item.cost;
    const mItem = monthItemMap[item.sku] || { monthOutQty: 0, monthOutValue: 0, depletionRate: '0.0' };

    let qtyColor = '#059669';
    if (isNegative || item.qty === 0) qtyColor = '#e11d48';
    else if (isLow) qtyColor = '#d97706';

    return `
      <div data-action="view-details" data-id="${item.id}" class="stk-feed-card" style="cursor:pointer;${isNegative ? 'border-left:4px solid #f43f5e;' : ''}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;border-bottom:1px solid var(--adm-border);padding-bottom:0.6rem;margin-bottom:0.6rem;">
          <div>
            <div style="display:flex;align-items:center;gap:0.4rem;">
              <span class="stk-rate-pill rate-same" style="font-weight:800;color:#4f46e5;">${item.sku}</span>
              <h3 style="font-size:0.92rem;font-weight:800;color:var(--adm-text);margin:0;" class="truncate">${item.name}</h3>
            </div>
            ${item.supplier ? `<p style="font-size:0.72rem;color:var(--adm-muted);margin:3px 0 0;" class="truncate max-w-[180px]">Supplier: ${item.supplier}</p>` : ''}
          </div>
          <span class="adm-pill confirmed" style="font-size:0.68rem;">
            ${item.category}
          </span>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.78rem;">
          <div style="display:flex;align-items:center;gap:0.4rem;">
            <span style="color:var(--adm-muted);">Stock Value:</span>
            <span style="font-weight:800;color:#059669;font-family:monospace;">₹ ${safeMoney(itemValue)}</span>
          </div>

          <div style="display:flex;align-items:center;gap:0.4rem;">
            <span style="color:var(--adm-muted);">Balance:</span>
            <span style="font-weight:900;font-family:monospace;color:${qtyColor};">${item.qty} ${item.unit}</span>
          </div>
        </div>

        <!-- Monthly Balance Gone for this SKU -->
        <div style="margin-top:0.6rem;padding-top:0.5rem;border-top:1px solid var(--adm-border);display:flex;align-items:center;justify-content:space-between;font-size:0.72rem;background:var(--adm-bg);padding:0.4rem 0.6rem;border-radius:8px;">
          <span style="color:var(--adm-muted);font-weight:600;display:flex;align-items:center;gap:0.25rem;">
            <span>🔥</span> Month Usage:
          </span>
          <div style="text-align:right;">
            <span style="font-weight:800;font-family:monospace;color:${mItem.monthOutQty > 0 ? '#e11d48' : 'var(--adm-muted)'};">
              ${mItem.monthOutQty > 0 ? `-${mItem.monthOutQty} ${item.unit}` : '0 gone'}
            </span>
            ${mItem.monthOutQty > 0 ? `<span style="font-size:0.68rem;color:#d97706;font-family:monospace;margin-left:0.25rem;font-weight:700;">(₹ ${safeMoney(mItem.monthOutValue)})</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  feedContainer.querySelectorAll('div[data-action="view-details"]').forEach(card => {
    card.addEventListener('click', () => openItemDetailsModal(card.dataset.id));
  });
}

function renderTable() {
  const tbody = document.getElementById('stock-table-body');
  if (!tbody) return;

  const filtered = getFilteredItems();
  const monthData = calculateMonthlyInventory(selectedMonthYear);
  const monthItemMap = {};
  monthData.items.forEach(mi => {
    monthItemMap[mi.sku] = mi;
  });

  tbody.innerHTML = filtered.map(item => {
    const isNegative = item.qty < 0;
    const isOut = item.qty === 0;
    const isLow = !isNegative && !isOut && item.qty <= item.min;
    const mItem = monthItemMap[item.sku] || { monthOutQty: 0, monthOutValue: 0, depletionRate: '0.0' };
    
    let statusBadge = '<span class="adm-pill delivered">In Stock</span>';
    if (isNegative) {
      statusBadge = `<span class="adm-pill cancelled">Negative (${item.qty})</span>`;
    } else if (isOut) {
      statusBadge = '<span class="adm-pill cancelled">Out of Stock</span>';
    } else if (isLow) {
      statusBadge = '<span class="adm-pill pending">Low Stock</span>';
    }

    const itemValue = (Math.max(0, item.qty) * item.cost);

    return `
      <tr data-action="view-details" data-id="${item.id}" style="cursor:pointer;${isNegative ? 'background:rgba(244,63,94,0.06);' : ''}">
        <td>
          <div style="display:flex;align-items:center;gap:0.4rem;">
            <span class="stk-rate-pill rate-same" style="font-weight:800;color:#4f46e5;">${item.sku}</span>
            <span style="font-weight:700;color:var(--adm-text);">${item.name}</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.4rem;margin-top:2px;font-size:0.72rem;color:var(--adm-muted);">
            <span>${item.supplier || 'No supplier'}</span>
            ${mItem.monthOutQty > 0 ? `<span style="color:#e11d48;font-family:monospace;font-weight:700;">• Gone this month: -${mItem.monthOutQty} ${item.unit} (₹ ${safeMoney(mItem.monthOutValue)})</span>` : ''}
          </div>
        </td>
        <td>
          <span class="adm-pill confirmed" style="font-size:0.7rem;">${item.category}</span>
        </td>
        <td style="color:var(--adm-muted);font-size:0.75rem;">${item.godown || 'Main Godown'}</td>
        <td class="text-center font-mono font-black" style="color:${isNegative ? '#e11d48' : '#059669'};">
          ${item.qty} ${item.unit}
        </td>
        <td class="text-right font-mono" style="color:var(--adm-text);">₹ ${safeMoney(item.salePrice)}</td>
        <td class="text-right font-mono" style="color:var(--adm-muted);">₹ ${safeMoney(item.cost)}</td>
        <td class="text-right font-mono font-bold" style="color:#059669;">₹ ${safeMoney(itemValue)}</td>
        <td class="text-center">${statusBadge}</td>
        <td class="text-right stock-no-print" onclick="event.stopPropagation()">
          <div style="display:inline-flex;align-items:center;gap:0.3rem;">
            <button data-action="row-in" data-id="${item.id}" class="adm-btn adm-btn-outline adm-btn-sm" style="color:#059669;padding:0.2rem 0.45rem;font-size:0.72rem;font-weight:700;" title="Record Purchase IN">+ IN</button>
            <button data-action="row-out" data-id="${item.id}" class="adm-btn adm-btn-outline adm-btn-sm" style="color:#d97706;padding:0.2rem 0.45rem;font-size:0.72rem;font-weight:700;" title="Record Kitchen Usage OUT">- OUT</button>
            <button data-action="quick-adjust" data-id="${item.id}" class="adm-btn adm-btn-outline adm-btn-sm" style="color:#4f46e5;padding:0.2rem 0.45rem;font-size:0.72rem;" title="Adjust Stock">⚡</button>
            <button data-action="edit" data-id="${item.id}" class="adm-btn adm-btn-outline adm-btn-sm" style="padding:0.2rem 0.45rem;font-size:0.72rem;" title="Edit Item Details">✏️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('tr[data-action="view-details"]').forEach(row => {
    row.addEventListener('click', () => openItemDetailsModal(row.dataset.id));
  });

  tbody.querySelectorAll('button[data-action="row-in"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openInOutModal('IN', btn.dataset.id);
    });
  });

  tbody.querySelectorAll('button[data-action="row-out"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openInOutModal('OUT', btn.dataset.id);
    });
  });

  tbody.querySelectorAll('button[data-action="quick-adjust"]').forEach(btn => {
    btn.addEventListener('click', () => openAdjustModal(btn.dataset.id));
  });

  tbody.querySelectorAll('button[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => openItemModal(btn.dataset.id));
  });
}

// ═════════════════════════════════════════════════════════════════════
// RECENT AUDIT LEDGER
// ═════════════════════════════════════════════════════════════════════
function renderLogs() {
  const tbody = document.getElementById('stock-logs-body');
  if (!tbody) return;

  const filtered = activeLogFilter === 'all'
    ? stockLogs
    : stockLogs.filter(l => l.type && l.type.toLowerCase().includes(activeLogFilter.toLowerCase()));

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center font-medium" style="color:var(--adm-muted);">No stock transaction logs matching filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.slice(0, 50).map(log => {
    let statusPill = '<span class="adm-pill confirmed">Log</span>';
    if (log.type && log.type.includes('IN')) {
      statusPill = `<span class="adm-pill delivered">${log.type}</span>`;
    } else if (log.type && log.type.includes('OUT')) {
      statusPill = `<span class="adm-pill pending">${log.type}</span>`;
    } else if (log.type && log.type.includes('Delete')) {
      statusPill = `<span class="adm-pill cancelled">${log.type}</span>`;
    } else if (log.type) {
      statusPill = `<span class="adm-pill confirmed">${log.type}</span>`;
    }

    return `
      <tr>
        <td class="whitespace-nowrap font-mono text-[11px]" style="color:var(--adm-muted);">${log.date}</td>
        <td style="font-weight:700;color:var(--adm-text);">${log.itemName}</td>
        <td>${statusPill}</td>
        <td class="text-center font-bold font-mono" style="color:${log.qtyText.startsWith('-') ? '#d97706' : '#059669'};">${log.qtyText}</td>
        <td style="color:var(--adm-muted);font-size:0.75rem;">${log.notes || '—'}</td>
      </tr>
    `;
  }).join('');
}

// ═════════════════════════════════════════════════════════════════════
// PERIOD / MONTHLY DASHBOARD RENDERING SYSTEM
// ═════════════════════════════════════════════════════════════════════
function renderPeriodKPIs(periodData) {
  const t = periodData.totals;
  const isWeekly = currentAppMode === 'weekly';

  // Title & Header Badges
  const bannerTitle = document.getElementById('monthly-banner-title');
  const monthBadge = document.getElementById('monthly-badge-selected-month');
  const modeBadge = document.getElementById('period-badge-mode');
  const bannerDesc = document.getElementById('period-banner-desc');

  if (isWeekly) {
    if (modeBadge) modeBadge.textContent = 'Weekly Statement';
    if (bannerTitle) bannerTitle.innerHTML = `<span>🗓️</span> Weekly Financial Statement — ${periodData.periodLabel}`;
    if (monthBadge) monthBadge.textContent = periodData.periodLabel;
    if (bannerDesc) bannerDesc.textContent = 'Weekly Opening Balance (₹), Inward Purchases (+), Kitchen Consumption (-), and Closing Balance (₹) complete valuation.';
  } else {
    if (modeBadge) modeBadge.textContent = 'Monthly Statement';
    if (bannerTitle) bannerTitle.innerHTML = `<span>📅</span> Monthly Financial Statement — ${periodData.monthLabel}`;
    if (monthBadge) monthBadge.textContent = periodData.monthLabel;
    if (bannerDesc) bannerDesc.textContent = 'Automated monthly accounting of Opening Balance (₹), Inward Purchases (+), Outward Usage (-) & Closing Balance (₹).';
  }

  // Update Category section header text
  const catSecTitle = document.querySelector('#monthly-categories-grid')?.parentElement?.querySelector('h3');
  if (catSecTitle) {
    catSecTitle.innerHTML = isWeekly
      ? `<span>🏷️</span> Category-Wise Weekly Spend & Usage (7 Stock Groups)`
      : `<span>🏷️</span> Category-Wise Monthly Spend & Usage (7 Stock Groups)`;
  }

  // Card 1: Opening Balance (Initial Stock Valuation)
  const openValEl = document.getElementById('pkpi-opening-value');
  const openQtyEl = document.getElementById('pkpi-opening-qty');
  const openChipEl = document.getElementById('mkpi-opening-value-chip');
  if (openValEl) openValEl.textContent = `₹ ${safeMoney(t.totalOpeningValue)}`;
  if (openQtyEl) openQtyEl.textContent = `${t.totalOpeningQty} units`;
  if (openChipEl) openChipEl.textContent = isWeekly ? 'Week Start' : 'Month Start';

  // Card 2: Inward / Purchases (Total Received)
  const inQtyEl = document.getElementById('mkpi-in-qty');
  const inValEl = document.getElementById('mkpi-in-value');
  const inCntEl = document.getElementById('mkpi-in-count');
  if (inQtyEl) inQtyEl.textContent = `+${t.totalInQty} units`;
  if (inValEl) inValEl.textContent = `₹ ${safeMoney(t.totalInValue)}`;
  if (inCntEl) inCntEl.textContent = `${t.totalInCount} entries`;

  // Card 3: Outward / Usage (Total Consumed)
  const outQtyEl = document.getElementById('mkpi-out-qty');
  const outValEl = document.getElementById('mkpi-out-value');
  const outCntEl = document.getElementById('mkpi-out-count');
  if (outQtyEl) outQtyEl.textContent = `-${t.totalOutQty} units`;
  if (outValEl) outValEl.textContent = `₹ ${safeMoney(t.totalOutValue)}`;
  if (outCntEl) outCntEl.textContent = `${t.totalOutCount} entries`;

  // Card 4: Net Movement (Net Variation)
  const netQtyEl = document.getElementById('mkpi-net-qty');
  const netValEl = document.getElementById('mkpi-net-value');
  const activeItemsEl = document.getElementById('mkpi-active-items');
  if (netQtyEl) {
    netQtyEl.textContent = `${t.totalNetQty >= 0 ? '+' : ''}${t.totalNetQty} units`;
    netQtyEl.className = `text-xl font-black font-mono ${t.totalNetQty >= 0 ? 'text-emerald-300' : 'text-amber-300'}`;
  }
  if (netValEl) {
    netValEl.textContent = `${t.totalNetValue >= 0 ? '+' : ''}₹ ${safeMoney(t.totalNetValue)}`;
  }
  if (activeItemsEl) activeItemsEl.textContent = `${t.activeSkuCount} active SKUs`;

  // Card 5: Closing Valuation (Ending Stock on Hand)
  const closeValEl = document.getElementById('mkpi-closing-value');
  const closeQtyEl = document.getElementById('mkpi-closing-qty');
  if (closeValEl) closeValEl.textContent = `₹ ${safeMoney(t.totalClosingValue)}`;
  if (closeQtyEl) closeQtyEl.textContent = `${t.totalClosingQty} units`;
}

const renderMonthlyKPIs = renderPeriodKPIs;

function renderMonthlyCategoryBreakdown(monthData) {
  const grid = document.getElementById('monthly-categories-grid');
  if (!grid) return;

  const cats = monthData.categories;
  const catNames = [
    'Bhusimal & Spices',
    'Dairy Items',
    'Cold Drinks',
    'Fresh Vegetables',
    'Ice Cream',
    'Packaging & Carry Bags',
    'Cleaning & Washings'
  ];

  grid.innerHTML = catNames.map(name => {
    const c = cats[name] || { inValue: 0, outValue: 0, closingValue: 0, inQty: 0, outQty: 0, count: 0, icon: '📦' };

    return `
      <div class="monthly-cat-card">
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--adm-border,#e8e3dc);padding-bottom:0.5rem;">
          <div style="display:flex;align-items:center;gap:0.4rem;font-weight:700;color:var(--adm-text);font-size:0.8rem;" class="truncate" title="${name}">
            <span style="font-size:1.05rem;">${c.icon || '📦'}</span>
            <span class="truncate">${name}</span>
          </div>
          <span class="stk-rate-pill rate-same" style="font-size:0.68rem;">${c.count} SKUs</span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;padding-top:0.6rem;font-size:0.75rem;">
          <div>
            <span style="display:block;color:var(--adm-muted);font-size:0.65rem;font-weight:700;text-transform:uppercase;">Purchases (IN)</span>
            <span style="font-weight:800;color:#059669;font-family:monospace;">₹ ${safeMoney(c.inValue)}</span>
            <span style="display:block;font-size:0.68rem;color:#059669;font-family:monospace;">+${c.inQty.toFixed(1)} u</span>
          </div>
          <div style="text-align:right;">
            <span style="display:block;color:var(--adm-muted);font-size:0.65rem;font-weight:700;text-transform:uppercase;">Usage (OUT)</span>
            <span style="font-weight:800;color:#d97706;font-family:monospace;">₹ ${safeMoney(c.outValue)}</span>
            <span style="display:block;font-size:0.68rem;color:#d97706;font-family:monospace;">-${c.outQty.toFixed(1)} u</span>
          </div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;padding-top:0.5rem;margin-top:0.5rem;border-top:1px solid var(--adm-border);font-size:0.75rem;">
          <span style="color:var(--adm-muted);">Closing Value:</span>
          <span style="font-weight:800;color:#4f46e5;font-family:monospace;">₹ ${safeMoney(c.closingValue)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderMonthlyLeaderboards(monthData) {
  const qtyList = document.getElementById('monthly-top-qty-gone-list');
  const valList = document.getElementById('monthly-top-value-gone-list');

  if (qtyList) {
    if (!monthData.topQtyGone || monthData.topQtyGone.length === 0) {
      qtyList.innerHTML = '<p style="font-size:0.75rem;color:var(--adm-muted);padding:1rem 0;text-align:center;">No consumption recorded for this period.</p>';
    } else {
      qtyList.innerHTML = monthData.topQtyGone.map((item, idx) => `
        <div data-action="view-details" data-id="${item.id}" style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.75rem;border-radius:10px;background:var(--adm-card);border:1px solid var(--adm-border);cursor:pointer;transition:all 0.15s ease;">
          <div style="display:flex;align-items:center;gap:0.6rem;min-width:0;">
            <span style="width:22px;height:22px;border-radius:50%;background:#ffe4e6;color:#e11d48;font-size:0.68rem;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0;">#${idx + 1}</span>
            <div style="overflow:hidden;">
              <span style="font-size:0.8rem;font-weight:700;color:var(--adm-text);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</span>
              <span style="font-size:0.68rem;color:var(--adm-muted);font-family:monospace;">${item.sku} • ${item.category}</span>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <span style="font-size:0.8rem;font-weight:900;color:#e11d48;font-family:monospace;display:block;">-${item.monthOutQty} ${item.unit}</span>
            <span style="font-size:0.68rem;color:var(--adm-muted);font-family:monospace;">₹ ${safeMoney(item.monthOutValue)}</span>
          </div>
        </div>
      `).join('');

      qtyList.querySelectorAll('div[data-action="view-details"]').forEach(card => {
        card.addEventListener('click', () => openItemDetailsModal(card.dataset.id));
      });
    }
  }

  if (valList) {
    if (!monthData.topValueGone || monthData.topValueGone.length === 0) {
      valList.innerHTML = '<p style="font-size:0.75rem;color:var(--adm-muted);padding:1rem 0;text-align:center;">No consumption expenditure recorded for this period.</p>';
    } else {
      valList.innerHTML = monthData.topValueGone.map((item, idx) => `
        <div data-action="view-details" data-id="${item.id}" style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.75rem;border-radius:10px;background:var(--adm-card);border:1px solid var(--adm-border);cursor:pointer;transition:all 0.15s ease;">
          <div style="display:flex;align-items:center;gap:0.6rem;min-width:0;">
            <span style="width:22px;height:22px;border-radius:50%;background:#fef3c7;color:#d97706;font-size:0.68rem;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0;">#${idx + 1}</span>
            <div style="overflow:hidden;">
              <span style="font-size:0.8rem;font-weight:700;color:var(--adm-text);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</span>
              <span style="font-size:0.68rem;color:var(--adm-muted);font-family:monospace;">${item.sku} • ${item.category}</span>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <span style="font-size:0.8rem;font-weight:900;color:#d97706;font-family:monospace;display:block;">₹ ${safeMoney(item.monthOutValue)}</span>
            <span style="font-size:0.68rem;color:#e11d48;font-family:monospace;">-${item.monthOutQty} ${item.unit}</span>
          </div>
        </div>
      `).join('');

      valList.querySelectorAll('div[data-action="view-details"]').forEach(card => {
        card.addEventListener('click', () => openItemDetailsModal(card.dataset.id));
      });
    }
  }
}

function renderMonthlyMatrixTable(monthData) {
  const tbody = document.getElementById('monthly-matrix-body');
  const tfoot = document.getElementById('monthly-matrix-foot');
  const badge = document.getElementById('monthly-matrix-count-badge');
  if (!tbody) return;

  const q = (searchQuery || '').toLowerCase().trim();
  
  const filtered = monthData.items.filter(item => {
    // Category filter
    if (monthlyCategoryFilter !== 'all' && item.category !== monthlyCategoryFilter) return false;

    // Activity filter
    if (monthlyActivityFilter === 'consumed' && item.monthOutQty === 0) return false;
    if (monthlyActivityFilter === 'moved' && item.monthInQty === 0 && item.monthOutQty === 0) return false;
    if (monthlyActivityFilter === 'purchased' && item.monthInQty === 0) return false;
    if (monthlyActivityFilter === 'low' && item.closingQty > item.min) return false;

    // Search query
    if (q) {
      const match = (item.name && item.name.toLowerCase().includes(q)) ||
        (item.sku && item.sku.toLowerCase().includes(q)) ||
        (item.category && item.category.toLowerCase().includes(q)) ||
        (item.supplier && item.supplier.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  if (badge) badge.textContent = `${filtered.length} items`;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="padding:2rem;text-align:center;color:var(--adm-muted);font-weight:500;">No stock items match the selected monthly filters.</td></tr>';
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = filtered.map(item => {
    let statusClass = 'badge-status-unchanged';
    if (item.status.includes('Negative')) statusClass = 'badge-status-negative';
    else if (item.status.includes('Out') || item.status.includes('Low')) statusClass = 'badge-status-low';
    else if (item.status.includes('Restocked')) statusClass = 'badge-status-restocked';
    else if (item.status.includes('Consumed')) statusClass = 'badge-status-consumed';

    const isNegative = item.closingQty < 0;
    const isZero = item.closingQty === 0;

    return `
      <tr data-action="view-details" data-id="${item.id}" style="cursor:pointer;${isNegative ? 'background:rgba(244,63,94,0.06);' : ''}">
        <td>
          <div style="display:flex;align-items:center;gap:0.4rem;">
            <span class="stk-rate-pill rate-same" style="font-weight:800;color:#4f46e5;">${item.sku}</span>
            <span style="font-weight:700;color:var(--adm-text);">${item.name}</span>
          </div>
          ${item.supplier ? `<p style="font-size:0.72rem;color:var(--adm-muted);margin:2px 0 0;" class="truncate max-w-[200px]">${item.supplier}</p>` : ''}
        </td>
        <td>
          <span class="adm-pill confirmed" style="font-size:0.68rem;">${item.category}</span>
        </td>
        <td style="color:var(--adm-muted);font-family:monospace;font-size:0.75rem;">${item.unit}</td>
        <td class="text-right font-mono" style="color:var(--adm-muted);">₹ ${safeMoney(item.cost)}</td>
        
        <!-- Opening Stock -->
        <td class="text-right" style="background:rgba(0,0,0,0.02);">
          <div class="font-bold font-mono" style="color:var(--adm-text);">${item.openingQty}</div>
          <div style="font-size:0.68rem;color:var(--adm-muted);font-family:monospace;">₹ ${safeMoney(item.openingValue)}</div>
        </td>

        <!-- Month IN / Purchases -->
        <td class="text-right" style="background:rgba(16,185,129,0.04);">
          <div class="font-bold font-mono" style="color:#059669;">${item.monthInQty > 0 ? '+' + item.monthInQty : '0'}</div>
          <div style="font-size:0.68rem;color:#059669;font-family:monospace;">₹ ${safeMoney(item.monthInValue)}</div>
        </td>

        <!-- Total Balance Gone (OUT -) -->
        <td class="text-right" style="background:rgba(244,63,94,0.04);">
          <div class="font-black font-mono" style="color:#e11d48;">${item.monthOutQty > 0 ? '-' + item.monthOutQty : '0'} ${item.unit}</div>
          <div style="font-size:0.68rem;color:#e11d48;font-weight:700;font-family:monospace;">₹ ${safeMoney(item.monthOutValue)}</div>
          ${item.monthOutQty > 0 ? `<div style="font-size:0.65rem;color:var(--adm-muted);font-family:monospace;">${item.depletionRate}% used</div>` : ''}
        </td>

        <!-- Closing Stock -->
        <td class="text-right" style="background:rgba(99,102,241,0.04);">
          <div class="font-black font-mono" style="color:${isNegative ? '#e11d48' : (isZero ? '#e11d48' : '#4f46e5')};">${item.closingQty}</div>
          <div style="font-size:0.68rem;font-family:monospace;color:${item.netQty >= 0 ? '#059669' : '#d97706'};">Net: ${item.netQty >= 0 ? '+' : ''}${item.netQty}</div>
        </td>

        <!-- Closing Value -->
        <td class="text-right font-black font-mono" style="color:#4f46e5;">
          ₹ ${safeMoney(item.closingValue)}
        </td>

        <!-- Status -->
        <td class="text-center">
          <span class="badge-monthly-status ${statusClass}">${item.status}</span>
        </td>

        <!-- Action / Ledger -->
        <td class="text-center stock-no-print" onclick="event.stopPropagation()">
          <button data-action="view-details" data-id="${item.id}" class="adm-btn adm-btn-outline adm-btn-sm" style="padding:0.2rem 0.5rem;font-size:0.72rem;">
            🔍 View
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('tr[data-action="view-details"]').forEach(row => {
    row.addEventListener('click', () => openItemDetailsModal(row.dataset.id));
  });

  tbody.querySelectorAll('button[data-action="view-details"]').forEach(btn => {
    btn.addEventListener('click', () => openItemDetailsModal(btn.dataset.id));
  });

  // Render Tfoot summary totals for the filtered set
  const filteredOpenVal = filtered.reduce((s, i) => s + i.openingValue, 0);
  const filteredInVal = filtered.reduce((s, i) => s + i.monthInValue, 0);
  const filteredOutVal = filtered.reduce((s, i) => s + i.monthOutValue, 0);
  const filteredCloseVal = filtered.reduce((s, i) => s + i.closingValue, 0);

  if (tfoot) {
    tfoot.innerHTML = `
      <tr>
        <td colspan="4" style="padding:0.75rem 0.85rem;text-transform:uppercase;font-weight:900;color:var(--adm-text);font-size:0.75rem;letter-spacing:0.04em;">
          Total Summary (${filtered.length} Filtered SKUs)
        </td>
        <td class="text-right font-mono" style="padding:0.75rem 0.85rem;font-weight:800;color:var(--adm-text);font-size:0.8rem;">
          ₹ ${safeMoney(filteredOpenVal)}
        </td>
        <td class="text-right font-mono" style="padding:0.75rem 0.85rem;font-weight:800;color:#059669;font-size:0.8rem;">
          +₹ ${safeMoney(filteredInVal)}
        </td>
        <td class="text-right font-mono" style="padding:0.75rem 0.85rem;font-weight:800;color:#e11d48;font-size:0.8rem;">
          -₹ ${safeMoney(filteredOutVal)}
        </td>
        <td class="text-right font-mono" style="padding:0.75rem 0.85rem;font-weight:800;color:#4f46e5;font-size:0.8rem;">
          Net ₹ ${safeMoney(filteredInVal - filteredOutVal)}
        </td>
        <td class="text-right font-mono" style="padding:0.75rem 0.85rem;font-weight:900;color:#4f46e5;font-size:0.85rem;">
          ₹ ${safeMoney(filteredCloseVal)}
        </td>
        <td colspan="2" class="text-center" style="font-size:0.7rem;color:var(--adm-muted);">
          Period End
        </td>
      </tr>
    `;
  }
}

function renderMonthlyInOutTables(monthData) {
  const inBody = document.getElementById('monthly-in-body');
  const outBody = document.getElementById('monthly-out-body');
  const badgeIn = document.getElementById('monthly-badge-in-count');
  const badgeOut = document.getElementById('monthly-badge-out-count');

  if (badgeIn) badgeIn.textContent = `${monthData.monthInEntries.length} entries`;
  if (badgeOut) badgeOut.textContent = `${monthData.monthOutEntries.length} entries`;

  if (inBody) {
    if (monthData.monthInEntries.length === 0) {
      inBody.innerHTML = `<tr><td colspan="5" class="py-4 text-center font-medium" style="color:var(--adm-muted);">No inward purchase entries for ${monthData.monthLabel}.</td></tr>`;
    } else {
      inBody.innerHTML = monthData.monthInEntries.slice(0, 35).map(e => `
        <tr>
          <td class="font-mono whitespace-nowrap" style="color:var(--adm-muted);">${e.date}</td>
          <td class="font-bold font-mono" style="color:#4f46e5;">${e.sku}</td>
          <td class="font-semibold truncate max-w-[130px] sm:max-w-none" style="color:var(--adm-text);">${e.description}</td>
          <td class="text-right font-bold" style="color:#059669;">+${e.qty} ${e.unit}</td>
          <td class="text-right font-mono font-bold" style="color:#059669;">₹ ${safeMoney(e.amount)}</td>
        </tr>
      `).join('');
    }
  }

  if (outBody) {
    if (monthData.monthOutEntries.length === 0) {
      outBody.innerHTML = `<tr><td colspan="5" class="py-4 text-center font-medium" style="color:var(--adm-muted);">No outward usage entries for ${monthData.monthLabel}.</td></tr>`;
    } else {
      outBody.innerHTML = monthData.monthOutEntries.slice(0, 35).map(e => `
        <tr>
          <td class="font-mono whitespace-nowrap" style="color:var(--adm-muted);">${e.date}</td>
          <td class="font-bold font-mono" style="color:#d97706;">${e.sku}</td>
          <td class="font-semibold truncate max-w-[130px] sm:max-w-none" style="color:var(--adm-text);">${e.description}</td>
          <td class="text-right font-bold" style="color:#d97706;">-${e.qty} ${e.unit}</td>
          <td class="text-right font-mono font-bold" style="color:#d97706;">₹ ${safeMoney(e.costAmount)}</td>
        </tr>
      `).join('');
    }
  }
}

function renderPeriodDashboard() {
  const periodData = currentAppMode === 'weekly'
    ? calculateWeeklyInventory(selectedWeekDate)
    : calculateMonthlyInventory(selectedMonthYear);
  renderPeriodKPIs(periodData);
  renderMonthlyCategoryBreakdown(periodData);
  renderMonthlyLeaderboards(periodData);
  renderMonthlyMatrixTable(periodData);
  renderMonthlyInOutTables(periodData);
}

function renderMonthlyDashboard() {
  renderPeriodDashboard();
}

function renderWeeklyDashboard() {
  renderPeriodDashboard();
}

let currentDailyDate = new Date().toISOString().slice(0, 10);

async function renderDailySummaryBlock(dateStr = null) {
  if (dateStr) currentDailyDate = dateStr;
  const dateInput = document.getElementById('daily-summary-date');
  if (dateInput && !dateInput.value) dateInput.value = currentDailyDate;

  const openingEl = document.getElementById('ds-opening-balance');
  const openingValEl = document.getElementById('ds-opening-val');
  const inEl = document.getElementById('ds-stock-in');
  const inValEl = document.getElementById('ds-stock-in-val');
  const outEl = document.getElementById('ds-stock-out');
  const outValEl = document.getElementById('ds-stock-out-val');
  const adjEl = document.getElementById('ds-adjustments');
  const netValEl = document.getElementById('ds-net-val');
  const curEl = document.getElementById('ds-current-balance');
  const curValEl = document.getElementById('ds-current-val');
  if (!openingEl) return;

  // Local calculation for currentDailyDate
  const targetDate = currentDailyDate;
  const [y, m, d] = targetDate.split('-');
  const dateFormatted = `${d}-${m}-${y}`; // DD-MM-YYYY
  const dateAlt = `${d}/${m}/${y}`;

  const inEntriesToday = stockInEntries.filter(e => e.date === dateFormatted || e.date === dateAlt || (e.createdAt && e.createdAt.startsWith(targetDate)));
  const outEntriesToday = stockOutEntries.filter(e => e.date === dateFormatted || e.date === dateAlt || (e.createdAt && e.createdAt.startsWith(targetDate)));

  const inToday = inEntriesToday.reduce((sum, e) => sum + safeNum(e.qty, 0), 0);
  const inTodayVal = inEntriesToday.reduce((sum, e) => sum + safeNum(e.totalAmount, safeNum(e.costPrice, 0) * safeNum(e.qty, 0)), 0);

  const outToday = outEntriesToday.reduce((sum, e) => sum + safeNum(e.qty, 0), 0);
  const outTodayVal = outEntriesToday.reduce((sum, e) => {
    const itm = stockItems.find(i => i.sku === e.sku);
    const cost = safeNum(itm?.cost, 0);
    return sum + (safeNum(e.qty, 0) * cost);
  }, 0);

  const curBalance = stockItems.reduce((sum, i) => sum + safeNum(i.qty, 0), 0);
  const curBalanceVal = stockItems.reduce((sum, i) => sum + (Math.max(0, safeNum(i.qty, 0)) * safeNum(i.cost, 0)), 0);
  const openingBalance = curBalance - inToday + outToday;
  const openingBalanceVal = Math.max(0, curBalanceVal - inTodayVal + outTodayVal);

  const netQty = inToday - outToday;
  const netVal = inTodayVal - outTodayVal;

  openingEl.textContent = `${openingBalance.toFixed(1)} u`;
  if (openingValEl) openingValEl.textContent = `₹ ${safeMoney(openingBalanceVal)}`;

  inEl.textContent = `+${inToday.toFixed(1)} u`;
  if (inValEl) inValEl.textContent = `+₹ ${safeMoney(inTodayVal)}`;

  outEl.textContent = `-${outToday.toFixed(1)} u`;
  if (outValEl) outValEl.textContent = `-₹ ${safeMoney(outTodayVal)}`;

  adjEl.textContent = `${netQty >= 0 ? '+' : ''}${netQty.toFixed(1)} u`;
  if (netValEl) netValEl.textContent = `${netVal >= 0 ? '+' : ''}₹ ${safeMoney(netVal)}`;

  curEl.textContent = `${curBalance.toFixed(1)} u`;
  if (curValEl) curValEl.textContent = `₹ ${safeMoney(curBalanceVal)}`;
}

function exportDailySummaryCSV() {
  const dateStr = currentDailyDate || new Date().toISOString().slice(0, 10);
  const openVal = document.getElementById('ds-opening-balance')?.textContent || '0';
  const openRs = document.getElementById('ds-opening-val')?.textContent || '0';
  const inVal = document.getElementById('ds-stock-in')?.textContent || '0';
  const inRs = document.getElementById('ds-stock-in-val')?.textContent || '0';
  const outVal = document.getElementById('ds-stock-out')?.textContent || '0';
  const outRs = document.getElementById('ds-stock-out-val')?.textContent || '0';
  const adjVal = document.getElementById('ds-adjustments')?.textContent || '0';
  const netRs = document.getElementById('ds-net-val')?.textContent || '0';
  const curVal = document.getElementById('ds-current-balance')?.textContent || '0';
  const curRs = document.getElementById('ds-current-val')?.textContent || '0';

  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "LIMRA Restaurant - Daily Stock Summary Report\n";
  csvContent += `Date,${dateStr}\n\n`;
  csvContent += "Metric,Quantity,Valuation (INR)\n";
  csvContent += `Opening Balance,${openVal},"${openRs}"\n`;
  csvContent += `Stock In (Purchases),${inVal},"${inRs}"\n`;
  csvContent += `Stock Out (Kitchen Usage),${outVal},"${outRs}"\n`;
  csvContent += `Net Day Movement,${adjVal},"${netRs}"\n`;
  csvContent += `Closing / Current Balance,${curVal},"${curRs}"\n\n`;
  csvContent += "SKU,Item Name,Category,Unit,Current Balance,Cost Price,Valuation (INR)\n";

  stockItems.forEach(i => {
    const v = Math.max(0, safeNum(i.qty, 0)) * safeNum(i.cost, 0);
    csvContent += `"${i.sku}","${(i.name || '').replace(/"/g, '""')}","${i.category}","${i.unit}",${i.qty},${i.cost},${v.toFixed(2)}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `LIMRA_Daily_Stock_Summary_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Exported Daily Stock Summary (${dateStr}) to CSV`, 'success');
}

function exportDailySummaryPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return alert('PDF export engine is loading. Please try again.');
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const dateStr = currentDailyDate || new Date().toISOString().slice(0, 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('LIMRA Restaurant — Daily Stock Summary', 14, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${dateStr} | Generated: ${new Date().toLocaleTimeString('en-IN')}`, 14, 25);

  const openVal = document.getElementById('ds-opening-balance')?.textContent || '0';
  const openRs = document.getElementById('ds-opening-val')?.textContent || '0';
  const inVal = document.getElementById('ds-stock-in')?.textContent || '0';
  const inRs = document.getElementById('ds-stock-in-val')?.textContent || '0';
  const outVal = document.getElementById('ds-stock-out')?.textContent || '0';
  const outRs = document.getElementById('ds-stock-out-val')?.textContent || '0';
  const curVal = document.getElementById('ds-current-balance')?.textContent || '0';
  const curRs = document.getElementById('ds-current-val')?.textContent || '0';

  const summaryData = [
    ['Opening Balance', openVal, openRs],
    ['Stock In (Purchases Today)', inVal, inRs],
    ['Stock Out (Kitchen Usage Today)', outVal, outRs],
    ['Closing / Current Balance', curVal, curRs]
  ];

  if (doc.autoTable) {
    doc.autoTable({
      head: [['Inventory Equation (What do I have? What came in? What went out?)', 'Quantity', 'Valuation (₹)']],
      body: summaryData,
      startY: 30,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255] }
    });

    const itemRows = stockItems.slice(0, 40).map(i => [
      i.sku, i.name, i.category, i.unit, i.qty, i.qty <= i.min ? 'LOW' : 'GOOD'
    ]);

    doc.autoTable({
      head: [['SKU', 'Item Name', 'Category', 'Unit', 'Balance', 'Status']],
      body: itemRows,
      startY: doc.lastAutoTable.finalY + 10,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: [52, 211, 153], fontSize: 8 },
      styles: { fontSize: 7, cellPadding: 1.5 }
    });
  }

  doc.save(`LIMRA_Daily_Stock_${dateStr}.pdf`);
  showToast(`Exported Daily Stock Summary (${dateStr}) to PDF`, 'success');
}

function renderAll() {
  if (currentAppMode === 'monthly' || currentAppMode === 'weekly') {
    renderPeriodDashboard();
  } else {
    renderKPIs();
    renderDailySummaryBlock();
    renderInOutBalanceTables();
    renderCardFeed();
    renderTable();
    renderLogs();
  }
}

// ═════════════════════════════════════════════════════════════════════
// RECORD STOCK IN / OUT ENTRY MODAL WORKFLOW WITH DATABASE PERSISTENCE
// ═════════════════════════════════════════════════════════════════════
function openInOutModal(mode = 'IN', presetItemId = null) {
  const modal = document.getElementById('modal-inout-entry');
  const title = document.getElementById('modal-inout-title');
  const modeInput = document.getElementById('inout-mode');
  const dateInput = document.getElementById('inout-date');
  const itemSelect = document.getElementById('inout-item-select');
  const unitDisplay = document.getElementById('inout-unit-display');
  const qtyInput = document.getElementById('inout-qty');
  const submitBtn = document.getElementById('inout-submit-btn');
  const reasonWrap = document.getElementById('inout-reason-wrap');
  const inExtraWrap = document.getElementById('inout-in-extra-wrap');
  const overrideContainer = document.getElementById('inout-override-container');
  const allowNegativeChk = document.getElementById('inout-allow-negative');
  const prevBalanceEl = document.getElementById('inout-prev-balance');
  const afterBalanceEl = document.getElementById('inout-after-balance');

  // Rate difference elements
  const costInput = document.getElementById('inout-cost');
  const totalAmountInput = document.getElementById('inout-total-amount');
  const prevRateDisplay = document.getElementById('inout-prev-rate-display');
  const newRateDisplay = document.getElementById('inout-new-rate-display');
  const rateDiffBadge = document.getElementById('inout-rate-diff-badge');
  const impactMsg = document.getElementById('inout-batch-impact-msg');
  const updateMasterChk = document.getElementById('inout-update-master-cost');

  if (!modal || !itemSelect) return;

  modeInput.value = mode;
  title.textContent = mode === 'IN' ? '📥 Record Stock IN Entry (Purchases & Receipts)' : '📤 Record Stock OUT Entry (Kitchen Usage & Waste)';
  submitBtn.textContent = mode === 'IN' ? 'Save IN Entry' : 'Confirm Stock OUT';
  submitBtn.className = 'adm-btn adm-btn-primary';
  submitBtn.style.background = mode === 'IN' ? '#059669' : '#d97706';
  submitBtn.style.borderColor = mode === 'IN' ? '#059669' : '#d97706';

  dateInput.value = new Date().toISOString().slice(0, 10);
  qtyInput.value = '';
  if (allowNegativeChk) allowNegativeChk.checked = false;
  if (overrideContainer) overrideContainer.classList.add('hidden');
  if (updateMasterChk) updateMasterChk.checked = true;

  if (mode === 'IN') {
    reasonWrap?.classList.add('hidden');
    inExtraWrap?.classList.remove('hidden');
  } else {
    reasonWrap?.classList.remove('hidden');
    inExtraWrap?.classList.add('hidden');
  }

  // Sort and populate options
  const sorted = [...stockItems].sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));
  itemSelect.innerHTML = sorted.map(item => `
    <option value="${item.sku}" data-id="${item.id}" data-unit="${item.unit}" data-name="${item.name}" data-qty="${item.qty}" data-cost="${item.cost}" ${presetItemId && item.id === presetItemId ? 'selected' : ''}>${item.sku} — ${item.name} (${item.category})</option>
  `).join('');

  function updateRateComparison() {
    if (mode !== 'IN') return;
    const selectedOpt = itemSelect.options[itemSelect.selectedIndex];
    if (!selectedOpt) return;
    const itm = stockItems.find(i => i.sku === selectedOpt.value);
    const prevRate = safeNum(itm?.cost, safeNum(selectedOpt.dataset.cost, 0));
    const unit = selectedOpt.dataset.unit || 'pcs';

    if (prevRateDisplay) {
      prevRateDisplay.textContent = `₹ ${safeMoney(prevRate)} / ${unit}`;
    }

    const newRate = safeNum(costInput?.value, 0);
    const qty = safeNum(qtyInput.value, 0);

    if (newRateDisplay) {
      newRateDisplay.textContent = `₹ ${safeMoney(newRate)} / ${unit}`;
    }

    if (rateDiffBadge) {
      if (newRate <= 0) {
        rateDiffBadge.textContent = '— Enter Rate';
        rateDiffBadge.className = 'stk-rate-pill rate-same';
        if (impactMsg) impactMsg.textContent = '';
      } else {
        const diff = newRate - prevRate;
        const pct = prevRate > 0 ? ((diff / prevRate) * 100).toFixed(1) : '0.0';

        if (diff > 0.001) {
          rateDiffBadge.textContent = `🔺 +₹ ${safeMoney(diff)} Higher (+${pct}%)`;
          rateDiffBadge.className = 'stk-rate-pill rate-up';
          if (impactMsg) {
            impactMsg.innerHTML = `<span style="color:#e11d48;font-weight:700;">⚠️ Higher by ₹${safeMoney(diff)}/${unit}!</span> Additional batch cost: ₹${safeMoney(diff * qty)}.`;
          }
        } else if (diff < -0.001) {
          rateDiffBadge.textContent = `🔻 -₹ ${safeMoney(Math.abs(diff))} Lower (-${Math.abs(pct)}%)`;
          rateDiffBadge.className = 'stk-rate-pill rate-down';
          if (impactMsg) {
            impactMsg.innerHTML = `<span style="color:#059669;font-weight:700;">🎉 Lower by ₹${safeMoney(Math.abs(diff))}/${unit}!</span> Total batch savings: ₹${safeMoney(Math.abs(diff) * qty)}.`;
          }
        } else {
          rateDiffBadge.textContent = `✅ Same Rate (No Variance)`;
          rateDiffBadge.className = 'stk-rate-pill rate-same';
          if (impactMsg) {
            impactMsg.textContent = `Previous and new rate are identical (₹ ${safeMoney(newRate)} / ${unit}).`;
          }
        }
      }
    }
  }

  function updateLiveBalancePreview() {
    const selectedOpt = itemSelect.options[itemSelect.selectedIndex];
    if (!selectedOpt) return;
    const curQty = safeNum(selectedOpt.dataset.qty, 0);
    const unit = selectedOpt.dataset.unit || 'pcs';
    if (unitDisplay) unitDisplay.value = unit;
    if (prevBalanceEl) prevBalanceEl.textContent = `${curQty} ${unit}`;

    const inputQty = safeNum(qtyInput.value, 0);
    let afterQty = curQty;
    if (mode === 'IN') {
      afterQty = curQty + inputQty;
    } else {
      afterQty = curQty - inputQty;
    }

    if (afterBalanceEl) {
      afterBalanceEl.textContent = `${parseFloat(afterQty.toFixed(2))} ${unit}`;
      afterBalanceEl.className = 'font-bold';
      afterBalanceEl.style.color = afterQty < 0 ? '#e11d48' : (afterQty <= 5 ? '#d97706' : '#059669');
    }

    if (mode === 'OUT' && afterQty < 0 && inputQty > 0) {
      if (overrideContainer) overrideContainer.classList.remove('hidden');
      const overrideMsg = document.getElementById('inout-override-msg');
      if (overrideMsg) {
        overrideMsg.textContent = `Insufficient Stock! Available balance is ${curQty} ${unit}. Deducting ${inputQty} ${unit} leaves ${parseFloat(afterQty.toFixed(2))} ${unit}.`;
      }
      if (submitBtn && !allowNegativeChk?.checked) {
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
      }
    } else {
      if (overrideContainer) overrideContainer.classList.add('hidden');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }
  }

  itemSelect.onchange = () => {
    updateLiveBalancePreview();
    if (mode === 'IN') {
      const itm = stockItems.find(i => i.sku === itemSelect.value);
      if (costInput && itm && itm.cost > 0) {
        costInput.value = itm.cost;
      }
      if (totalAmountInput) {
        const q = safeNum(qtyInput.value, 0);
        totalAmountInput.value = itm && itm.cost > 0 && q > 0 ? (itm.cost * q).toFixed(2) : '';
      }
      updateRateComparison();
    }
  };

  qtyInput.oninput = () => {
    updateLiveBalancePreview();
    if (mode === 'IN') {
      const q = safeNum(qtyInput.value, 0);
      const c = safeNum(costInput?.value, 0);
      if (totalAmountInput && c > 0) {
        totalAmountInput.value = (c * q).toFixed(2);
      }
      updateRateComparison();
    }
  };

  if (costInput) {
    costInput.oninput = () => {
      const q = safeNum(qtyInput.value, 0);
      const c = safeNum(costInput.value, 0);
      if (totalAmountInput && q > 0) {
        totalAmountInput.value = (c * q).toFixed(2);
      }
      updateRateComparison();
    };
  }

  if (totalAmountInput) {
    totalAmountInput.oninput = () => {
      const q = safeNum(qtyInput.value, 0);
      const tot = safeNum(totalAmountInput.value, 0);
      if (costInput && q > 0) {
        costInput.value = (tot / q).toFixed(2);
      }
      updateRateComparison();
    };
  }

  allowNegativeChk?.addEventListener('change', () => {
    if (submitBtn) {
      if (allowNegativeChk.checked) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      } else {
        const selectedOpt = itemSelect.options[itemSelect.selectedIndex];
        const curQty = safeNum(selectedOpt?.dataset.qty, 0);
        const inputQty = safeNum(qtyInput.value, 0);
        if (mode === 'OUT' && (curQty - inputQty) < 0) {
          submitBtn.disabled = true;
          submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
      }
    }
  });

  // Prepopulate rate for initial selected item if IN
  if (mode === 'IN') {
    const initItem = stockItems.find(i => presetItemId ? i.id === presetItemId : i.sku === itemSelect.value) || stockItems[0];
    if (costInput && initItem && initItem.cost > 0) {
      costInput.value = initItem.cost;
    }
    if (totalAmountInput) totalAmountInput.value = '';
    updateRateComparison();
  }

  updateLiveBalancePreview();
  modal.classList.remove('hidden');
}

function closeInOutModal() {
  document.getElementById('modal-inout-entry')?.classList.add('hidden');
}

async function handleInOutSubmit(e) {
  e.preventDefault();
  const mode = document.getElementById('inout-mode').value;
  const date = document.getElementById('inout-date').value;
  const itemSelect = document.getElementById('inout-item-select');
  const selectedOpt = itemSelect.options[itemSelect.selectedIndex];
  const sku = itemSelect.value;
  const description = selectedOpt.dataset.name || 'Item';
  const itemId = selectedOpt.dataset.id || '';
  const unit = selectedOpt.dataset.unit || 'pcs';
  const qty = safeNum(document.getElementById('inout-qty').value, 0);
  const allowNegative = document.getElementById('inout-allow-negative')?.checked || false;
  const reason = document.getElementById('inout-reason')?.value || 'Kitchen Prep';
  const costPrice = safeNum(document.getElementById('inout-cost')?.value, 0);
  const totalAmount = safeNum(document.getElementById('inout-total-amount')?.value, costPrice * qty);
  const updateMasterCost = document.getElementById('inout-update-master-cost')?.checked || false;
  const supplier = document.getElementById('inout-supplier')?.value || '';
  const notes = document.getElementById('inout-notes')?.value || '';

  if (qty <= 0) {
    showToast('Please enter a valid quantity greater than 0.', 'error');
    return;
  }

  const targetItem = stockItems.find(i => i.sku === sku) || { id: itemId, cost: costPrice, supplier, qty: 0 };
  const prevCost = safeNum(targetItem.cost, 0);
  const rateDiff = costPrice > 0 ? parseFloat((costPrice - prevCost).toFixed(2)) : 0;

  if (mode === 'IN' && costPrice <= 0) {
    showToast('Please enter the purchase rate (₹ / unit).', 'warning');
    document.getElementById('inout-cost')?.focus();
    return;
  }

  // Hard negative check on client
  if (mode === 'OUT' && (safeNum(targetItem.qty, 0) - qty) < 0 && !allowNegative) {
    showToast(`Insufficient stock! Available balance is ${targetItem.qty} ${unit}. Check admin override to proceed.`, 'error');
    return;
  }

  const entryId = (mode === 'IN' ? 'in_' : 'out_') + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  const nowIso = new Date().toISOString();

  // Optimistic local update
  const entryLocal = {
    id: entryId,
    date,
    sku,
    description,
    unit,
    qty,
    costPrice: mode === 'IN' ? costPrice : targetItem.cost,
    previousCostPrice: prevCost,
    rateDiff: mode === 'IN' ? rateDiff : 0,
    totalAmount: mode === 'IN' ? totalAmount : (targetItem.cost * qty),
    supplier: mode === 'IN' ? (supplier || targetItem.supplier || '') : targetItem.supplier,
    usedBy: mode === 'OUT' ? reason : '',
    notes,
    createdAt: nowIso
  };

  if (mode === 'IN') {
    stockInEntries.unshift(entryLocal);
    if (updateMasterCost && costPrice > 0) {
      targetItem.cost = costPrice;
      const mi = stockItems.find(i => i.sku === sku);
      if (mi) mi.cost = costPrice;
    }
    const diffNotice = rateDiff !== 0 ? ` (Rate: ₹${safeMoney(costPrice)}, ${rateDiff > 0 ? '+' : ''}₹${safeMoney(rateDiff)} vs last)` : '';
    showToast(`Recorded Stock IN: +${qty} ${unit} for "${description}"${diffNotice}`, 'success');
  } else {
    stockOutEntries.unshift(entryLocal);
    showToast(`Recorded Stock OUT: -${qty} ${unit} for "${description}" (${reason})`, 'warning');
  }

  recalculateBalances();
  saveLocalCache();
  closeInOutModal();
  renderAll();

  // Call Server-Side RPC
  try {
    if (mode === 'OUT') {
      const { data: rpcData, error: rpcErr } = await insforge.rpc('record_stock_out', {
        p_item_id: targetItem.id,
        p_qty: qty,
        p_reason: reason,
        p_used_by: 'Kitchen Staff',
        p_notes: notes,
        p_allow_negative: allowNegative
      });

      if (rpcErr) {
        console.warn('[StockManager] record_stock_out RPC fallback to direct insert:', rpcErr);
        await insforge.database.from('stock_out').insert([{
          id: entryId,
          date,
          item_id: targetItem.id,
          item_sku: sku,
          item_name: description,
          qty,
          unit,
          used_by: reason,
          notes: notes + (allowNegative ? ' [OVERRIDE: Negative Stock Allowed]' : ''),
          created_at: nowIso
        }]);
        await addLogToDB(
          `${description} (Stock OUT (-))`,
          `-${qty} ${unit} | Reason: ${reason} | ${notes}`
        );
        const updatedItem = stockItems.find(i => i.sku === sku);
        if (updatedItem) {
          await insforge.database.from('stock_items').update({
            qty: updatedItem.qty,
            cost_price: updatedItem.cost,
            updated_at: nowIso
          }).eq('id', updatedItem.id);
        }
      }
    } else {
      const { data: rpcData, error: rpcErr } = await insforge.rpc('record_stock_in', {
        p_item_id: targetItem.id,
        p_qty: qty,
        p_cost_price: costPrice || targetItem.cost || null,
        p_supplier: supplier || targetItem.supplier || null,
        p_notes: notes
      });

      if (updateMasterCost && costPrice > 0) {
        await insforge.database.from('stock_items').update({
          cost_price: costPrice,
          updated_at: nowIso
        }).eq('id', targetItem.id);
      }

      if (rpcErr) {
        console.warn('[StockManager] record_stock_in RPC fallback to direct insert:', rpcErr);
        await insforge.database.from('stock_in').insert([{
          id: entryId,
          date,
          item_id: targetItem.id,
          item_sku: sku,
          item_name: description,
          qty,
          unit,
          cost_price: costPrice || targetItem.cost || 0,
          supplier: supplier || targetItem.supplier || '',
          notes,
          created_at: nowIso
        }]);
        await addLogToDB(
          `${description} (Stock IN (+))`,
          `+${qty} ${unit} @ ₹${safeMoney(costPrice || targetItem.cost)} | ${notes}`
        );
        const updatedItem = stockItems.find(i => i.sku === sku);
        if (updatedItem) {
          await insforge.database.from('stock_items').update({
            qty: updatedItem.qty,
            cost_price: updatedItem.cost,
            updated_at: nowIso
          }).eq('id', updatedItem.id);
        }
      }
    }
  } catch (err) {
    console.error('[StockManager] Database sync error:', err);
    showToast('Entry saved locally, background sync pending.', 'info');
  }
}

// ═════════════════════════════════════════════════════════════════════
// ITEM DETAILS DRAWER / MODAL
// ═════════════════════════════════════════════════════════════════════
function openItemDetailsModal(itemId) {
  const item = stockItems.find(i => i.id === itemId);
  if (!item) return;

  const modal = document.getElementById('modal-item-details');
  if (!modal) return;

  document.getElementById('detail-item-sku').textContent = item.sku;
  document.getElementById('detail-item-name').textContent = item.name;
  document.getElementById('detail-item-supplier').textContent = `Supplier: ${item.supplier || 'Not specified'}`;
  document.getElementById('detail-item-category-badge').textContent = item.category;

  document.getElementById('detail-sale-price').textContent = `₹ ${safeMoney(item.salePrice)}`;
  document.getElementById('detail-purchase-price').textContent = `₹ ${safeMoney(item.cost)}`;
  document.getElementById('detail-in-stock').textContent = `${item.qty} ${item.unit}`;
  document.getElementById('detail-stock-value').textContent = `₹ ${safeMoney(Math.max(0, item.qty) * item.cost)}`;

  // Status chip
  const statusChip = document.getElementById('detail-stock-status-chip');
  if (statusChip) {
    if (item.qty < 0) {
      statusChip.textContent = '⚠️ Negative Stock';
      statusChip.className = 'adm-pill cancelled';
    } else if (item.qty === 0) {
      statusChip.textContent = '⚠️ Out of Stock';
      statusChip.className = 'adm-pill cancelled';
    } else if (item.qty <= item.min) {
      statusChip.textContent = '⚠️ Low Stock';
      statusChip.className = 'adm-pill pending';
    } else {
      statusChip.textContent = '✓ Good';
      statusChip.className = 'adm-pill delivered';
    }
  }

  // Calculate Last Stock In
  const itemInEntries = stockInEntries.filter(e => e.sku === item.sku);
  const lastIn = itemInEntries[0];
  const lastInQtyEl = document.getElementById('detail-last-in-qty');
  const lastInSubEl = document.getElementById('detail-last-in-sub');
  if (lastInQtyEl && lastInSubEl) {
    if (lastIn) {
      lastInQtyEl.textContent = `+${lastIn.qty} ${item.unit}`;
      lastInSubEl.textContent = `Date: ${lastIn.date} · Supplier: ${lastIn.supplier || item.supplier || 'Direct'}`;
    } else {
      lastInQtyEl.textContent = 'None recorded';
      lastInSubEl.textContent = 'No inward stock entries yet';
    }
  }

  // Calculate Stock Out Today for this item
  const todayStr = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
  const todayIso = new Date().toISOString().slice(0, 10);
  const itemOutToday = stockOutEntries
    .filter(e => {
      const eDate = (e.date || '').replace(/\//g, '-');
      return e.sku === item.sku && (eDate === todayStr || (e.createdAt && e.createdAt.startsWith(todayIso)));
    })
    .reduce((s, e) => s + safeNum(e.qty, 0), 0);

  const outTodayQtyEl = document.getElementById('detail-out-today-qty');
  const outTodaySubEl = document.getElementById('detail-out-today-sub');
  if (outTodayQtyEl && outTodaySubEl) {
    outTodayQtyEl.textContent = itemOutToday > 0 ? `-${itemOutToday} ${item.unit}` : '0 units';
    outTodaySubEl.textContent = itemOutToday > 0 ? "Today's Kitchen Usage" : 'No usage recorded today';
  }

  // Wire up action buttons: [+ STOCK IN], [- STOCK OUT], [VIEW HISTORY]
  const btnDetailIn = document.getElementById('btn-detail-stock-in');
  const btnDetailOut = document.getElementById('btn-detail-stock-out');
  const btnDetailHist = document.getElementById('btn-detail-history');

  if (btnDetailIn) {
    btnDetailIn.onclick = () => {
      closeItemDetailsModal();
      openInOutModal('IN', item.id);
    };
  }

  if (btnDetailOut) {
    btnDetailOut.onclick = () => {
      closeItemDetailsModal();
      openInOutModal('OUT', item.id);
    };
  }

  if (btnDetailHist) {
    btnDetailHist.onclick = () => {
      const ledgerWrap = document.getElementById('detail-ledger-body');
      ledgerWrap?.scrollIntoView({ behavior: 'smooth' });
    };
  }

  // Monthly Balance Gone Analytics for this item
  const monthData = calculateMonthlyInventory(selectedMonthYear);
  const mItem = monthData.items.find(mi => mi.sku === item.sku) || { monthOutQty: 0, monthOutValue: 0, depletionRate: '0.0' };

  const monthBadge = document.getElementById('detail-month-label-badge');
  const goneQtyEl = document.getElementById('detail-month-gone-qty');
  const goneValEl = document.getElementById('detail-month-gone-value');
  const goneRateEl = document.getElementById('detail-month-depletion-rate');

  if (monthBadge) monthBadge.textContent = monthData.monthLabel;
  if (goneQtyEl) goneQtyEl.textContent = `-${mItem.monthOutQty} ${item.unit}`;
  if (goneValEl) goneValEl.textContent = `₹ ${safeMoney(mItem.monthOutValue)}`;
  if (goneRateEl) goneRateEl.textContent = `${mItem.depletionRate}% used`;

  const whatsappLink = document.getElementById('detail-supplier-link');
  if (whatsappLink) {
    const rawNumber = (item.supplier || '').replace(/[^0-9]/g, '');
    if (rawNumber && rawNumber.length >= 10) {
      whatsappLink.href = `https://wa.me/91${rawNumber.slice(-10)}?text=Hello%20LIMRA%20Restaurant%20needs%20restock%20for%20${encodeURIComponent(item.name)}`;
      whatsappLink.style.display = 'flex';
    } else {
      whatsappLink.style.display = 'none';
    }
  }

  // Ledger body for this item
  const ledgerBody = document.getElementById('detail-ledger-body');
  const countEl = document.getElementById('detail-tx-count');

  const inRows = stockInEntries.filter(e => e.sku === item.sku).map(e => ({ ...e, type: 'IN (+)' }));
  const outRows = stockOutEntries.filter(e => e.sku === item.sku).map(e => ({ ...e, type: 'OUT (-)' }));
  const combined = [...inRows, ...outRows].sort((a, b) => b.date.localeCompare(a.date));

  if (countEl) countEl.textContent = `${combined.length} entries`;

  if (ledgerBody) {
    if (combined.length === 0) {
      ledgerBody.innerHTML = '<tr><td colspan="3" style="padding:1rem;text-align:center;color:var(--adm-muted);">No IN or OUT ledger records for this item yet.</td></tr>';
    } else {
      ledgerBody.innerHTML = combined.map(e => `
        <tr class="adm-table-row">
          <td style="padding:0.45rem 0.75rem;border-bottom:1px solid var(--adm-border,#e8e3dc);">
            <span style="font-weight:700;color:var(--adm-text);">${e.type}</span>
            <span style="color:var(--adm-muted);font-size:0.75rem;margin-left:0.35rem;font-family:monospace;">${e.date}</span>
          </td>
          <td style="padding:0.45rem 0.75rem;text-align:center;font-weight:700;font-family:monospace;border-bottom:1px solid var(--adm-border,#e8e3dc);color:${e.type.includes('IN') ? '#059669' : '#d97706'};">${e.qty} ${e.unit}</td>
          <td style="padding:0.45rem 0.75rem;text-align:right;font-family:monospace;border-bottom:1px solid var(--adm-border,#e8e3dc);color:var(--adm-text);">₹ ${safeMoney(e.qty * item.cost)}</td>
        </tr>
      `).join('');
    }
  }

  document.getElementById('btn-details-adjust-stock').onclick = () => {
    closeItemDetailsModal();
    openAdjustModal(item.id);
  };

  document.getElementById('btn-details-edit').onclick = () => {
    closeItemDetailsModal();
    openItemModal(item.id);
  };

  modal.classList.remove('hidden');
}

function closeItemDetailsModal() {
  document.getElementById('modal-item-details')?.classList.add('hidden');
}

// ═════════════════════════════════════════════════════════════════════
// QUICK ADJUST MODAL WITH DATABASE PERSISTENCE
// ═════════════════════════════════════════════════════════════════════
function openAdjustModal(itemId) {
  const item = stockItems.find(i => i.id === itemId);
  if (!item) return;

  const modal = document.getElementById('modal-adjust-stock');
  if (!modal) return;

  document.getElementById('adjust-target-id').value = item.id;
  document.getElementById('adjust-item-display').value = `${item.sku} — ${item.name}`;
  document.getElementById('adjust-godown-select').value = item.godown || 'Main Godown';
  document.getElementById('adjust-workflow-unit').value = item.unit || 'pcs';
  document.getElementById('adjust-workflow-qty').value = '';
  document.getElementById('adjust-workflow-notes').value = '';
  document.getElementById('adjust-mode').value = 'add';

  const costInput = document.getElementById('adjust-workflow-cost');
  if (costInput) costInput.value = item.cost > 0 ? item.cost : '';

  const btnAdd = document.getElementById('toggle-type-add');
  const btnReduce = document.getElementById('toggle-type-reduce');
  if (btnAdd && btnReduce) {
    btnAdd.className = 'erp-toggle-btn btn-add active';
    btnReduce.className = 'erp-toggle-btn btn-reduce';
  }

  modal.classList.remove('hidden');
}

function closeAdjustModal() {
  document.getElementById('modal-adjust-stock')?.classList.add('hidden');
}

async function handleAdjustSubmit(e) {
  e.preventDefault();
  const itemId = document.getElementById('adjust-target-id').value;
  const item = stockItems.find(i => i.id === itemId);
  if (!item) return;

  const mode = document.getElementById('adjust-mode').value; // 'add' or 'reduce'
  const qty = safeNum(document.getElementById('adjust-workflow-qty').value, 0);
  const notes = document.getElementById('adjust-workflow-notes').value || 'Workflow Adjustment';
  const godown = document.getElementById('adjust-godown-select').value;
  const date = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  if (qty <= 0) {
    showToast('Please enter a valid quantity greater than 0.', 'error');
    return;
  }

  const costInput = document.getElementById('adjust-workflow-cost');
  const inputCost = safeNum(costInput?.value, 0);
  if (mode === 'add' && inputCost > 0) {
    item.cost = inputCost;
    const mi = stockItems.find(i => i.id === itemId);
    if (mi) mi.cost = inputCost;
  }

  const entryId = (mode === 'add' ? 'in_' : 'out_') + Date.now() + '_' + Math.random().toString(36).substr(2, 4);

  const entryLocal = {
    id: entryId,
    date,
    sku: item.sku,
    description: item.name,
    unit: item.unit,
    qty,
    costPrice: item.cost,
    totalAmount: item.cost * qty,
    supplier: item.supplier || '',
    usedBy: mode === 'reduce' ? godown : '',
    notes,
    createdAt: nowIso
  };

  if (mode === 'add') {
    stockInEntries.unshift(entryLocal);
    showToast(`Added +${qty} ${item.unit} to "${item.name}" (Rate: ₹${safeMoney(item.cost)})`, 'success');
  } else {
    stockOutEntries.unshift(entryLocal);
    showToast(`Reduced -${qty} ${item.unit} from "${item.name}"`, 'warning');
  }

  recalculateBalances();
  saveLocalCache();
  closeAdjustModal();
  renderAll();

  // Async sync to Database
  try {
    if (mode === 'add') {
      await insforge.database.from('stock_in').insert([{
        id: entryId,
        date,
        item_id: item.id,
        item_sku: item.sku,
        item_name: item.name,
        qty,
        unit: item.unit,
        cost_price: item.cost,
        supplier: item.supplier || '',
        notes,
        created_at: nowIso
      }]);
      await addLogToDB(
        `${item.name} (Stock IN (+))`,
        `+${qty} ${item.unit} @ ₹${safeMoney(item.cost)} | ${notes}`
      );
    } else {
      await insforge.database.from('stock_out').insert([{
        id: entryId,
        date,
        item_id: item.id,
        item_sku: item.sku,
        item_name: item.name,
        qty,
        unit: item.unit,
        used_by: godown,
        notes,
        created_at: nowIso
      }]);
      await addLogToDB(
        `${item.name} (Stock OUT (-))`,
        `-${qty} ${item.unit} | ${notes}`
      );
    }

    await insforge.database.from('stock_items').update({
      qty: item.qty,
      cost_price: item.cost,
      updated_at: nowIso
    }).eq('id', item.id);
  } catch (err) {
    console.error('[StockManager] Adjust sync to DB failed:', err);
  }
}

// ═════════════════════════════════════════════════════════════════════
// ADD / EDIT STOCK ITEM MODAL WITH DATABASE PERSISTENCE
// ═════════════════════════════════════════════════════════════════════
function openItemModal(itemId = null) {
  const modal = document.getElementById('modal-item');
  const title = document.getElementById('modal-item-title');
  if (!modal) return;

  const item = itemId ? stockItems.find(i => i.id === itemId) : null;

  document.getElementById('form-item-id').value = item ? item.id : '';
  title.innerHTML = item ? '<span>✏️</span> Edit Stock Item' : '<span>📦</span> Add New Item';

  document.getElementById('form-item-name').value = item ? item.name : '';
  document.getElementById('form-item-sku').value = item ? item.sku : `J${String(stockItems.length + 1).padStart(3, '0')}`;
  document.getElementById('form-item-category').value = item ? item.category : 'Bhusimal & Spices';
  document.getElementById('form-item-godown').value = item ? item.godown : 'Main Godown';
  document.getElementById('form-item-unit').value = item ? item.unit : 'kg';
  document.getElementById('form-item-qty').value = item ? (item.qty ?? '') : '';
  document.getElementById('form-item-min').value = item ? item.min : '10';
  document.getElementById('form-item-sale-price').value = item ? item.salePrice || '' : '';
  document.getElementById('form-item-cost').value = item ? item.cost : '';
  document.getElementById('form-item-supplier').value = item ? item.supplier || '' : '';

  modal.classList.remove('hidden');
}

function closeItemModal() {
  document.getElementById('modal-item')?.classList.add('hidden');
}

async function handleItemSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('form-item-id').value;
  const name = document.getElementById('form-item-name').value.trim();
  let sku = document.getElementById('form-item-sku').value.trim();
  const category = document.getElementById('form-item-category').value;
  const godown = document.getElementById('form-item-godown').value;
  const unit = document.getElementById('form-item-unit').value;
  const baseQty = safeNum(document.getElementById('form-item-qty').value, 0);
  const min = safeNum(document.getElementById('form-item-min').value, 5);
  const salePrice = safeNum(document.getElementById('form-item-sale-price').value, 0);
  const cost = safeNum(document.getElementById('form-item-cost').value, 0);
  const supplier = document.getElementById('form-item-supplier').value.trim();
  const nowIso = new Date().toISOString();

  if (!sku) {
    sku = `J${String(stockItems.length + 1).padStart(3, '0')}`;
  }

  if (id) {
    const item = stockItems.find(i => i.id === id);
    if (item) {
      item.name = name;
      item.sku = sku;
      item.category = category;
      item.godown = godown;
      item.unit = unit;
      item.min = min;
      item.salePrice = salePrice;
      item.cost = cost;
      item.supplier = supplier;
      showToast(`Updated item "${name}"`, 'success');

      recalculateBalances();
      saveLocalCache();
      closeItemModal();
      renderAll();

      try {
        await insforge.database.from('stock_items').update({
          name,
          sku,
          category,
          unit,
          min_qty: min,
          cost_price: cost,
          sale_price: salePrice,
          supplier,
          updated_at: nowIso
        }).eq('id', id);

        await addLogToDB(
          `${name} (Edit Item Details)`,
          `Parameters updated for SKU ${sku}`
        );
      } catch (err) {
        console.error('[StockManager] Update item in DB error:', err);
      }
    }
  } else {
    const newId = 'stk_' + Date.now();
    const newItem = {
      id: newId,
      sku,
      name,
      category,
      godown,
      unit,
      qty: baseQty,
      storedQty: baseQty,
      min,
      cost,
      salePrice,
      supplier,
      isAvailable: true,
      updatedAt: nowIso
    };
    stockItems.unshift(newItem);

    // If initial qty > 0, create initial Stock IN entry
    if (baseQty > 0) {
      const initInId = 'in_init_' + Date.now();
      const dateStr = new Date().toISOString().slice(0, 10);
      stockInEntries.unshift({
        id: initInId,
        date: dateStr,
        sku,
        description: name,
        unit,
        qty: baseQty,
        costPrice: cost,
        previousCostPrice: cost,
        rateDiff: 0,
        totalAmount: cost * baseQty,
        supplier,
        notes: 'Opening stock balance for newly created item',
        createdAt: nowIso
      });

      try {
        await insforge.database.from('stock_in').insert([{
          id: initInId,
          date: dateStr,
          item_id: newId,
          item_sku: sku,
          item_name: name,
          qty: baseQty,
          unit,
          cost_price: cost,
          supplier,
          notes: 'Opening stock balance for newly created item',
          created_at: nowIso
        }]);
      } catch (e) {
        console.warn('[StockManager] Initial Stock IN sync error:', e);
      }
    }

    showToast(`Created new item "${name}" (${sku})`, 'success');

    recalculateBalances();
    saveLocalCache();
    closeItemModal();
    renderAll();

    try {
      await insforge.database.from('stock_items').insert([{
        id: newId,
        sku,
        name,
        category,
        unit,
        qty: newItem.qty,
        min_qty: min,
        cost_price: cost,
        sale_price: salePrice,
        godown,
        supplier,
        is_available: true,
        updated_at: nowIso
      }]);

      await addLogToDB(
        `${name} (Add New Item)`,
        `Created new inventory SKU ${sku} with initial balance ${baseQty} ${unit}`
      );
    } catch (err) {
      console.error('[StockManager] Insert item in DB error:', err);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════
// EXPORT ENGINE (Excel & PDF)
// ═════════════════════════════════════════════════════════════════════
function exportToExcel() {
  if (typeof XLSX === 'undefined') {
    return alert('Excel export engine (SheetJS) is loading. Please try again.');
  }

  const data = getFilteredItems().map((i, idx) => ({
    'Sl No': idx + 1,
    'SKU Code': i.sku,
    'Item Description': i.name,
    'Category': i.category,
    'Godown Location': i.godown,
    'Unit': i.unit,
    'Total Stock IN': i.totalIn || 0,
    'Total Stock OUT': i.totalOut || 0,
    'Actual Balance Qty': i.qty,
    'Min Reorder Level': i.min,
    'Purchase Cost (INR)': i.cost,
    'Sale Price (INR)': i.salePrice || 0,
    'Stock Valuation (INR)': Math.max(0, i.qty) * i.cost,
    'Stock Status': i.qty < 0 ? 'Negative Stock' : (i.qty <= i.min ? 'Low Stock / Alert' : 'In Stock'),
    'Supplier Contact': i.supplier || ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock Summary');
  XLSX.writeFile(workbook, `LIMRA_Stock_Summary_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast('Exported Stock Directory to Excel (.xlsx)', 'success');
}

async function syncStockToGoogleSheet() {
  const webhookUrl = localStorage.getItem('limra_google_sheet_webhook') || 'https://script.google.com/macros/s/AKfycbyGV5EmfydSULN6aOwj-H4XslL5rMc7U1TDHOCbWyubG5H4ykc56c6BjnkR0c1YQ0wW/exec';
  if (!webhookUrl) {
    showToast('Google Sheet Webhook URL not configured.', 'error');
    return;
  }

  const items = (stockItems && stockItems.length > 0) ? stockItems : INITIAL_STOCK_ITEMS;
  showToast(`Syncing ${items.length} stock items to "Stock Summary" in Google Sheet... ⏳`, 'info');

  const payload = {
    type: 'stock_summary',
    action: 'stock_summary',
    items: items
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    showToast(`Successfully synced ${items.length} items to "Stock Summary" tab! 📊✅`, 'success');
  } catch (err) {
    showToast('Failed to sync to Google Sheet: ' + err.message, 'error');
  }
}

function exportToPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return alert('PDF export engine is loading. Please try again.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const filtered = getFilteredItems();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('LIMRA Restaurant — Stock & Inventory Report', 14, 18);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated on: ${new Date().toLocaleString('en-IN')} | Total Items: ${filtered.length}`, 14, 25);

  const headers = [['SKU', 'Description', 'Category', 'Unit', 'IN', 'OUT', 'Balance', 'Cost', 'Value', 'Status']];
  const rows = filtered.map(i => [
    i.sku,
    i.name,
    i.category,
    i.unit,
    i.totalIn || 0,
    i.totalOut || 0,
    i.qty,
    `₹ ${safeMoney(i.cost)}`,
    `₹ ${safeMoney(Math.max(0, i.qty) * i.cost)}`,
    i.qty < 0 ? 'Negative' : (i.qty <= i.min ? 'Low' : 'In Stock')
  ]);

  if (doc.autoTable) {
    doc.autoTable({
      head: headers,
      body: rows,
      startY: 30,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: [52, 211, 153] },
      styles: { fontSize: 7 }
    });
  }

  doc.save(`LIMRA_Stock_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  showToast('Exported Stock Report to PDF', 'success');
}

// ═════════════════════════════════════════════════════════════════════
// MONTHLY EXPORT ENGINE (Excel .xlsx & PDF Statements)
// ═════════════════════════════════════════════════════════════════════
function exportMonthlyToExcel() {
  if (typeof XLSX === 'undefined') {
    return alert('Excel export engine (SheetJS) is loading. Please try again.');
  }

  const monthData = calculateMonthlyInventory(selectedMonthYear);
  const data = monthData.items.map((i, idx) => ({
    'Sl No': idx + 1,
    'SKU Code': i.sku,
    'Item Description': i.name,
    'Category': i.category,
    'Godown': i.godown || 'Main Godown',
    'Unit': i.unit,
    'Cost Price (INR)': i.cost,
    'Opening Stock Qty': i.openingQty,
    'Opening Stock Value (INR)': parseFloat(i.openingValue.toFixed(2)),
    'Month IN Purchases (Qty)': i.monthInQty,
    'Month Purchases Spend (INR)': parseFloat(i.monthInValue.toFixed(2)),
    'Total Balance Gone Qty (Month OUT)': i.monthOutQty,
    'Total Cost of Balance Gone (INR)': parseFloat(i.monthOutValue.toFixed(2)),
    'Stock Depletion Rate (%)': `${i.depletionRate}%`,
    'Net Movement Qty': i.netQty,
    'Closing Stock Qty': i.closingQty,
    'Closing Stock Value (INR)': parseFloat(i.closingValue.toFixed(2)),
    'Monthly Status': i.status,
    'Supplier': i.supplier || ''
  }));

  // Summary row
  data.push({
    'Sl No': 'TOTALS',
    'SKU Code': '—',
    'Item Description': `Monthly Summary (${monthData.monthLabel})`,
    'Category': '—',
    'Godown': '—',
    'Unit': '—',
    'Cost Price (INR)': '—',
    'Opening Stock Qty': '—',
    'Opening Stock Value (INR)': parseFloat(monthData.totals.totalOpeningValue.toFixed(2)),
    'Month IN Purchases (Qty)': monthData.totals.totalInQty,
    'Month Purchases Spend (INR)': parseFloat(monthData.totals.totalInValue.toFixed(2)),
    'Total Balance Gone Qty (Month OUT)': monthData.totals.totalOutQty,
    'Total Cost of Balance Gone (INR)': parseFloat(monthData.totals.totalOutValue.toFixed(2)),
    'Stock Depletion Rate (%)': '—',
    'Net Movement Qty': monthData.totals.totalNetQty,
    'Closing Stock Qty': monthData.totals.totalClosingQty,
    'Closing Stock Value (INR)': parseFloat(monthData.totals.totalClosingValue.toFixed(2)),
    'Monthly Status': `${monthData.totals.activeSkuCount} Active SKUs`,
    'Supplier': '—'
  });

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, `Stock ${selectedMonthYear}`);
  XLSX.writeFile(workbook, `LIMRA_Stock_Monthly_Calculation_${selectedMonthYear}.xlsx`);
  showToast(`Exported Monthly Statement (${monthData.monthLabel}) to Excel (.xlsx)`, 'success');
}

function exportMonthlyToPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return alert('PDF export engine is loading. Please try again.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape', 'mm', 'a4');
  const monthData = calculateMonthlyInventory(selectedMonthYear);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(`LIMRA Restaurant — Monthly Stock Calculation Statement`, 14, 15);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Month: ${monthData.monthLabel} (${selectedMonthYear}) | Generated on: ${new Date().toLocaleString('en-IN')}`, 14, 21);

  doc.setFontSize(8);
  doc.text(
    `Purchases (IN): ₹ ${safeMoney(monthData.totals.totalInValue)} (${monthData.totals.totalInQty} units) | Total Balance Gone (OUT): ₹ ${safeMoney(monthData.totals.totalOutValue)} (${monthData.totals.totalOutQty} units) | Ending Valuation: ₹ ${safeMoney(monthData.totals.totalClosingValue)}`,
    14,
    26
  );

  const headers = [[
    'SKU', 'Item Description', 'Category', 'Unit', 'Cost',
    'Open', 'Purchases (+)', 'Spend (₹)', 'Balance Gone (-OUT)', 'Cost Gone (₹)', 'Closing', 'Ending Val (₹)', 'Status'
  ]];

  const rows = monthData.items.map(i => [
    i.sku,
    i.name,
    i.category,
    i.unit,
    `₹ ${safeMoney(i.cost)}`,
    i.openingQty,
    i.monthInQty > 0 ? `+${i.monthInQty}` : '0',
    `₹ ${safeMoney(i.monthInValue)}`,
    i.monthOutQty > 0 ? `-${i.monthOutQty}` : '0',
    `₹ ${safeMoney(i.monthOutValue)}`,
    i.closingQty,
    `₹ ${safeMoney(i.closingValue)}`,
    i.status
  ]);

  if (doc.autoTable) {
    doc.autoTable({
      head: headers,
      body: rows,
      startY: 30,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: [52, 211, 153], fontSize: 7, fontStyle: 'bold' },
      styles: { fontSize: 6.5, cellPadding: 1.2 }
    });
  }

  doc.save(`LIMRA_Stock_Monthly_Report_${selectedMonthYear}.pdf`);
  showToast(`Exported Monthly Statement (${monthData.monthLabel}) to PDF`, 'success');
}

function exportWeeklyToExcel() {
  if (typeof XLSX === 'undefined') {
    return alert('Excel export engine (SheetJS) is loading. Please try again.');
  }

  const weekData = calculateWeeklyInventory(selectedWeekDate);
  const data = weekData.items.map((i, idx) => ({
    'Sl No': idx + 1,
    'SKU Code': i.sku,
    'Item Description': i.name,
    'Category': i.category,
    'Godown': i.godown || 'Main Godown',
    'Unit': i.unit,
    'Cost Price (INR)': i.cost,
    'Opening Stock Qty': i.openingQty,
    'Opening Stock Value (INR)': parseFloat(i.openingValue.toFixed(2)),
    'Week IN Purchases (Qty)': i.monthInQty,
    'Week Purchases Spend (INR)': parseFloat(i.monthInValue.toFixed(2)),
    'Total Balance Gone Qty (Week OUT)': i.monthOutQty,
    'Total Cost of Balance Gone (INR)': parseFloat(i.monthOutValue.toFixed(2)),
    'Stock Depletion Rate (%)': `${i.depletionRate}%`,
    'Net Movement Qty': i.netQty,
    'Closing Stock Qty': i.closingQty,
    'Closing Stock Value (INR)': parseFloat(i.closingValue.toFixed(2)),
    'Weekly Status': i.status,
    'Supplier': i.supplier || ''
  }));

  // Summary row
  data.push({
    'Sl No': 'TOTALS',
    'SKU Code': '—',
    'Item Description': `Weekly Summary (${weekData.periodLabel})`,
    'Category': '—',
    'Godown': '—',
    'Unit': '—',
    'Cost Price (INR)': '—',
    'Opening Stock Qty': '—',
    'Opening Stock Value (INR)': parseFloat(weekData.totals.totalOpeningValue.toFixed(2)),
    'Week IN Purchases (Qty)': weekData.totals.totalInQty,
    'Week Purchases Spend (INR)': parseFloat(weekData.totals.totalInValue.toFixed(2)),
    'Total Balance Gone Qty (Week OUT)': weekData.totals.totalOutQty,
    'Total Cost of Balance Gone (INR)': parseFloat(weekData.totals.totalOutValue.toFixed(2)),
    'Stock Depletion Rate (%)': '—',
    'Net Movement Qty': weekData.totals.totalNetQty,
    'Closing Stock Qty': weekData.totals.totalClosingQty,
    'Closing Stock Value (INR)': parseFloat(weekData.totals.totalClosingValue.toFixed(2)),
    'Weekly Status': `${weekData.totals.activeSkuCount} Active SKUs`,
    'Supplier': '—'
  });

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, `Week ${weekData.periodKey}`);
  XLSX.writeFile(workbook, `LIMRA_Stock_Weekly_Statement_${weekData.periodKey}.xlsx`);
  showToast(`Exported Weekly Statement (${weekData.periodLabel}) to Excel (.xlsx)`, 'success');
}

function exportWeeklyToPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return alert('PDF export engine is loading. Please try again.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape', 'mm', 'a4');
  const weekData = calculateWeeklyInventory(selectedWeekDate);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(`LIMRA Restaurant — Weekly Stock Financial Statement`, 14, 15);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Period: ${weekData.periodLabel} | Generated on: ${new Date().toLocaleString('en-IN')}`, 14, 21);

  doc.setFontSize(8);
  doc.text(
    `Opening: ₹ ${safeMoney(weekData.totals.totalOpeningValue)} | Purchases (IN): ₹ ${safeMoney(weekData.totals.totalInValue)} (+${weekData.totals.totalInQty} u) | Balance Gone (OUT): ₹ ${safeMoney(weekData.totals.totalOutValue)} (-${weekData.totals.totalOutQty} u) | Closing Val: ₹ ${safeMoney(weekData.totals.totalClosingValue)}`,
    14,
    26
  );

  const headers = [[
    'SKU', 'Item Description', 'Category', 'Unit', 'Cost',
    'Open Qty', 'Purchases (+)', 'Purchases (₹)', 'Usage (-)', 'Usage Cost (₹)', 'Closing Qty', 'Closing Val (₹)', 'Status'
  ]];

  const rows = weekData.items.map(i => [
    i.sku,
    i.name,
    i.category,
    i.unit,
    `₹ ${safeMoney(i.cost)}`,
    i.openingQty,
    i.monthInQty > 0 ? `+${i.monthInQty}` : '0',
    `₹ ${safeMoney(i.monthInValue)}`,
    i.monthOutQty > 0 ? `-${i.monthOutQty}` : '0',
    `₹ ${safeMoney(i.monthOutValue)}`,
    i.closingQty,
    `₹ ${safeMoney(i.closingValue)}`,
    i.status
  ]);

  if (doc.autoTable) {
    doc.autoTable({
      head: headers,
      body: rows,
      startY: 30,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: [52, 211, 153], fontSize: 7, fontStyle: 'bold' },
      styles: { fontSize: 6.5, cellPadding: 1.2 }
    });
  }

  doc.save(`LIMRA_Stock_Weekly_Statement_${weekData.periodKey}.pdf`);
  showToast(`Exported Weekly Statement (${weekData.periodLabel}) to PDF`, 'success');
}

// ═════════════════════════════════════════════════════════════════════
// DOM EVENT LISTENERS & INITIALIZATION
// ═════════════════════════════════════════════════════════════════════
function setupEventListeners() {
  // Mode Switcher Buttons (Live Operations vs Weekly Financials vs Monthly Financials)
  const tabLive = document.getElementById('tab-mode-live');
  const tabWeekly = document.getElementById('tab-mode-weekly');
  const tabMonthly = document.getElementById('tab-mode-monthly');
  const viewLive = document.getElementById('view-live-container');
  const viewMonthly = document.getElementById('view-monthly-container');
  const weeklyQuickControls = document.getElementById('weekly-quick-controls');
  const monthlyQuickControls = document.getElementById('monthly-quick-controls');

  const activeTabClass = 'pos-cat-pill active';
  const inactiveTabClass = 'pos-cat-pill';

  function switchAppMode(mode) {
    currentAppMode = mode;
    if (tabLive) tabLive.className = mode === 'live' ? activeTabClass : inactiveTabClass;
    if (tabWeekly) tabWeekly.className = mode === 'weekly' ? activeTabClass : inactiveTabClass;
    if (tabMonthly) tabMonthly.className = mode === 'monthly' ? activeTabClass : inactiveTabClass;

    if (mode === 'live') {
      viewLive?.classList.remove('adm-hidden', 'hidden');
      viewMonthly?.classList.add('adm-hidden');
      weeklyQuickControls?.classList.add('adm-hidden');
      monthlyQuickControls?.classList.add('adm-hidden');
    } else if (mode === 'weekly') {
      viewLive?.classList.add('adm-hidden');
      viewMonthly?.classList.remove('adm-hidden', 'hidden');
      weeklyQuickControls?.classList.remove('adm-hidden', 'hidden');
      monthlyQuickControls?.classList.add('adm-hidden');
      const weekBadge = document.getElementById('weekly-badge-range');
      const weekPicker = document.getElementById('weekly-select-picker');
      if (weekPicker && !weekPicker.value) weekPicker.value = selectedWeekDate;
      if (weekBadge) weekBadge.textContent = getWeekRange(selectedWeekDate).label;
    } else if (mode === 'monthly') {
      viewLive?.classList.add('adm-hidden');
      viewMonthly?.classList.remove('adm-hidden', 'hidden');
      weeklyQuickControls?.classList.add('adm-hidden');
      monthlyQuickControls?.classList.remove('adm-hidden', 'hidden');
    }

    renderAll();
  }

  tabLive?.addEventListener('click', () => switchAppMode('live'));
  tabWeekly?.addEventListener('click', () => switchAppMode('weekly'));
  tabMonthly?.addEventListener('click', () => switchAppMode('monthly'));

  // Weekly Navigation Controls
  const weekPicker = document.getElementById('weekly-select-picker');
  const weekBadge = document.getElementById('weekly-badge-range');
  if (weekPicker) {
    weekPicker.value = selectedWeekDate;
    if (weekBadge) weekBadge.textContent = getWeekRange(selectedWeekDate).label;
    weekPicker.addEventListener('change', (e) => {
      selectedWeekDate = e.target.value || _initialDateStr;
      if (weekBadge) weekBadge.textContent = getWeekRange(selectedWeekDate).label;
      renderAll();
    });
  }

  document.getElementById('btn-week-current')?.addEventListener('click', () => {
    selectedWeekDate = new Date().toISOString().slice(0, 10);
    if (weekPicker) weekPicker.value = selectedWeekDate;
    if (weekBadge) weekBadge.textContent = getWeekRange(selectedWeekDate).label;
    renderAll();
  });

  document.getElementById('btn-week-prev')?.addEventListener('click', () => {
    const d = parseEntryDate(selectedWeekDate);
    d.setDate(d.getDate() - 7);
    selectedWeekDate = d.toISOString().slice(0, 10);
    if (weekPicker) weekPicker.value = selectedWeekDate;
    if (weekBadge) weekBadge.textContent = getWeekRange(selectedWeekDate).label;
    renderAll();
  });

  document.getElementById('btn-week-next')?.addEventListener('click', () => {
    const d = parseEntryDate(selectedWeekDate);
    d.setDate(d.getDate() + 7);
    selectedWeekDate = d.toISOString().slice(0, 10);
    if (weekPicker) weekPicker.value = selectedWeekDate;
    if (weekBadge) weekBadge.textContent = getWeekRange(selectedWeekDate).label;
    renderAll();
  });

  document.getElementById('btn-week-excel')?.addEventListener('click', exportWeeklyToExcel);
  document.getElementById('btn-week-pdf')?.addEventListener('click', exportWeeklyToPDF);

  // Month Picker & Quick Navigation
  const monthPicker = document.getElementById('monthly-select-picker');
  if (monthPicker) {
    monthPicker.value = selectedMonthYear;
    monthPicker.addEventListener('change', (e) => {
      selectedMonthYear = e.target.value || _initialYm;
      renderAll();
    });
  }

  document.getElementById('btn-month-current')?.addEventListener('click', () => {
    const now = new Date();
    const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    selectedMonthYear = curYm;
    if (monthPicker) monthPicker.value = curYm;
    renderAll();
  });

  document.getElementById('btn-month-prev')?.addEventListener('click', () => {
    const [y, m] = selectedMonthYear.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    selectedMonthYear = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (monthPicker) monthPicker.value = selectedMonthYear;
    renderAll();
  });

  document.getElementById('btn-month-next')?.addEventListener('click', () => {
    const [y, m] = selectedMonthYear.split('-').map(Number);
    const d = new Date(y, m, 1);
    selectedMonthYear = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (monthPicker) monthPicker.value = selectedMonthYear;
    renderAll();
  });

  // Monthly/Weekly Matrix Filters
  document.getElementById('monthly-cat-filter')?.addEventListener('change', (e) => {
    monthlyCategoryFilter = e.target.value;
    const periodData = currentAppMode === 'weekly' ? calculateWeeklyInventory(selectedWeekDate) : calculateMonthlyInventory(selectedMonthYear);
    renderMonthlyMatrixTable(periodData);
  });

  document.getElementById('monthly-activity-filter')?.addEventListener('change', (e) => {
    monthlyActivityFilter = e.target.value;
    const periodData = currentAppMode === 'weekly' ? calculateWeeklyInventory(selectedWeekDate) : calculateMonthlyInventory(selectedMonthYear);
    renderMonthlyMatrixTable(periodData);
  });

  // Monthly & Contextual Hero Export Triggers
  document.getElementById('btn-month-excel')?.addEventListener('click', exportMonthlyToExcel);
  document.getElementById('btn-month-pdf')?.addEventListener('click', exportMonthlyToPDF);
  document.getElementById('btn-monthly-export-xls-hero')?.addEventListener('click', () => {
    if (currentAppMode === 'weekly') exportWeeklyToExcel();
    else exportMonthlyToExcel();
  });
  document.getElementById('btn-monthly-export-pdf-hero')?.addEventListener('click', () => {
    if (currentAppMode === 'weekly') exportWeeklyToPDF();
    else exportMonthlyToPDF();
  });

  // As on Date Checkbox & Input
  const chkAsOn = document.getElementById('chk-as-on-date');
  const dateAsOn = document.getElementById('date-as-on');

  chkAsOn?.addEventListener('change', (e) => {
    asOnDateEnabled = e.target.checked;
    if (dateAsOn) {
      dateAsOn.disabled = !asOnDateEnabled;
      if (asOnDateEnabled) asOnDateValue = dateAsOn.value;
    }
    recalculateBalances();
    renderAll();
  });

  dateAsOn?.addEventListener('change', (e) => {
    asOnDateValue = e.target.value;
    if (asOnDateEnabled) {
      recalculateBalances();
      renderAll();
    }
  });
  // Daily Summary Block Listeners
  const dailyDateInput = document.getElementById('daily-summary-date');
  if (dailyDateInput) {
    dailyDateInput.value = currentDailyDate;
    dailyDateInput.addEventListener('change', (e) => {
      renderDailySummaryBlock(e.target.value);
    });
  }

  document.getElementById('btn-daily-today')?.addEventListener('click', () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    if (dailyDateInput) dailyDateInput.value = todayIso;
    renderDailySummaryBlock(todayIso);
  });

  document.getElementById('btn-export-daily-csv')?.addEventListener('click', exportDailySummaryCSV);
  document.getElementById('btn-export-daily-pdf')?.addEventListener('click', exportDailySummaryPDF);

  // Record IN & OUT Buttons (Standard + Hero Quick Actions)
  document.getElementById('btn-record-in')?.addEventListener('click', () => openInOutModal('IN'));
  document.getElementById('btn-hero-record-in')?.addEventListener('click', () => openInOutModal('IN'));
  document.getElementById('btn-record-out')?.addEventListener('click', () => openInOutModal('OUT'));
  document.getElementById('btn-hero-record-out')?.addEventListener('click', () => openInOutModal('OUT'));
  document.getElementById('modal-inout-close')?.addEventListener('click', closeInOutModal);
  document.getElementById('inout-cancel-btn')?.addEventListener('click', closeInOutModal);
  document.getElementById('form-inout-entry')?.addEventListener('submit', handleInOutSubmit);

  // Add Item Button (Standard + Hero Quick Action)
  document.getElementById('btn-add-item')?.addEventListener('click', () => openItemModal());
  document.getElementById('btn-hero-add-item')?.addEventListener('click', () => openItemModal());
  document.getElementById('modal-item-close')?.addEventListener('click', closeItemModal);
  document.getElementById('btn-cancel-item')?.addEventListener('click', closeItemModal);
  document.getElementById('form-stock-item')?.addEventListener('submit', handleItemSubmit);

  // Adjust Stock Form
  document.getElementById('modal-adjust-stock-close')?.addEventListener('click', closeAdjustModal);
  document.getElementById('btn-cancel-adjust-workflow')?.addEventListener('click', closeAdjustModal);
  document.getElementById('form-adjust-stock-workflow')?.addEventListener('submit', handleAdjustSubmit);

  // Adjust Stock Toggle Buttons (Add vs Reduce)
  document.getElementById('toggle-type-add')?.addEventListener('click', () => {
    document.getElementById('adjust-mode').value = 'add';
    document.getElementById('toggle-type-add').className = 'erp-toggle-btn btn-add active';
    document.getElementById('toggle-type-reduce').className = 'erp-toggle-btn btn-reduce';
  });

  document.getElementById('toggle-type-reduce')?.addEventListener('click', () => {
    document.getElementById('adjust-mode').value = 'reduce';
    document.getElementById('toggle-type-reduce').className = 'erp-toggle-btn btn-reduce active';
    document.getElementById('toggle-type-add').className = 'erp-toggle-btn btn-add';
  });

  // Details Modal
  document.getElementById('modal-details-close')?.addEventListener('click', closeItemDetailsModal);
  document.getElementById('btn-details-back')?.addEventListener('click', closeItemDetailsModal);

  // Exports
  document.getElementById('btn-header-excel')?.addEventListener('click', exportToExcel);
  document.getElementById('btn-header-pdf')?.addEventListener('click', exportToPDF);
  document.getElementById('btn-header-sheets')?.addEventListener('click', syncStockToGoogleSheet);
  document.getElementById('btn-details-excel')?.addEventListener('click', exportToExcel);

  // Search Toggle
  const searchOverlay = document.getElementById('search-overlay-bar');
  const searchInput = document.getElementById('stock-search');

  document.getElementById('btn-toggle-search')?.addEventListener('click', () => {
    searchOverlay?.classList.toggle('hidden');
    if (!searchOverlay?.classList.contains('hidden')) {
      searchInput?.focus();
    }
  });

  document.getElementById('btn-close-search')?.addEventListener('click', () => {
    searchOverlay?.classList.add('hidden');
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    renderAll();
  });

  searchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderAll();
  });

  // Filter Select Chips
  document.getElementById('chip-cat-select')?.addEventListener('change', (e) => {
    activeCategory = e.target.value;
    document.getElementById('active-filter-badge').textContent = activeCategory === 'all' ? 'All Categories' : activeCategory;
    renderAll();
  });

  document.getElementById('chip-stock-select')?.addEventListener('change', (e) => {
    activeStockLevel = e.target.value;
    renderAll();
  });

  document.getElementById('chip-status-select')?.addEventListener('change', (e) => {
    activeStatus = e.target.value;
    renderAll();
  });

  // Drawer Multi-Filters
  const modalFilters = document.getElementById('modal-filters');
  document.getElementById('btn-open-funnel')?.addEventListener('click', () => modalFilters?.classList.remove('hidden'));
  document.getElementById('modal-filters-close')?.addEventListener('click', () => modalFilters?.classList.add('hidden'));
  
  document.getElementById('btn-drawer-apply')?.addEventListener('click', () => {
    activeCategory = document.getElementById('drawer-cat-select').value;
    activeStockLevel = document.getElementById('drawer-stock-select').value;
    selectedGodown = document.getElementById('drawer-godown-select').value;

    document.getElementById('chip-cat-select').value = activeCategory;
    document.getElementById('chip-stock-select').value = activeStockLevel;
    document.getElementById('active-filter-badge').textContent = activeCategory === 'all' ? 'All Categories' : activeCategory;

    modalFilters?.classList.add('hidden');
    renderAll();
  });

  document.getElementById('btn-drawer-reset')?.addEventListener('click', () => {
    activeCategory = 'all';
    activeStockLevel = 'all';
    selectedGodown = 'all';
    document.getElementById('drawer-cat-select').value = 'all';
    document.getElementById('drawer-stock-select').value = 'all';
    document.getElementById('drawer-godown-select').value = 'all';
    document.getElementById('chip-cat-select').value = 'all';
    document.getElementById('chip-stock-select').value = 'all';
    document.getElementById('active-filter-badge').textContent = 'All Categories';
    modalFilters?.classList.add('hidden');
    renderAll();
  });

  // View Switcher (Cards vs Table)
  const btnFeed = document.getElementById('btn-toggle-view-feed');
  const btnTable = document.getElementById('btn-toggle-view-table');
  const feedWrap = document.getElementById('stock-feed-container');
  const tableWrap = document.getElementById('stock-table-container');

  btnFeed?.addEventListener('click', () => {
    viewMode = 'feed';
    btnFeed.className = 'adm-btn adm-btn-primary adm-btn-sm';
    btnTable.className = 'adm-btn adm-btn-outline adm-btn-sm';
    feedWrap?.classList.remove('adm-hidden', 'hidden');
    tableWrap?.classList.add('adm-hidden', 'hidden');
  });

  btnTable?.addEventListener('click', () => {
    viewMode = 'table';
    btnTable.className = 'adm-btn adm-btn-primary adm-btn-sm';
    btnFeed.className = 'adm-btn adm-btn-outline adm-btn-sm';
    tableWrap?.classList.remove('adm-hidden', 'hidden');
    feedWrap?.classList.add('adm-hidden', 'hidden');
  });

  // More Options Menu
  const btnMore = document.getElementById('btn-more-options');
  const menuMore = document.getElementById('dropdown-more-menu');

  btnMore?.addEventListener('click', (e) => {
    e.stopPropagation();
    menuMore?.classList.toggle('hidden');
  });

  document.addEventListener('click', () => menuMore?.classList.add('hidden'));

  document.getElementById('menu-toggle-view')?.addEventListener('click', () => {
    if (viewMode === 'feed') btnTable?.click();
    else btnFeed?.click();
  });

  document.getElementById('menu-reset-defaults')?.addEventListener('click', () => {
    if (confirm('Re-sync inventory directly from PostgreSQL database?')) {
      fetchDatabaseState();
      showToast('Syncing with PostgreSQL database...', 'info');
    }
  });

  document.getElementById('menu-print-page')?.addEventListener('click', () => window.print());

  // Log filter & Clear
  document.getElementById('log-filter-type')?.addEventListener('change', (e) => {
    activeLogFilter = e.target.value;
    renderLogs();
  });

  document.getElementById('btn-clear-logs')?.addEventListener('click', () => {
    if (confirm('Clear audit logs display?')) {
      stockLogs = [];
      saveLocalCache();
      renderLogs();
      showToast('Audit log view cleared', 'info');
    }
  });

  // Empty state button
  document.getElementById('btn-empty-clear-filters')?.addEventListener('click', () => {
    searchQuery = '';
    activeCategory = 'all';
    activeStockLevel = 'all';
    activeStatus = 'all';
    selectedGodown = 'all';
    if (searchInput) searchInput.value = '';
    document.getElementById('chip-cat-select').value = 'all';
    document.getElementById('chip-stock-select').value = 'all';
    document.getElementById('chip-status-select').value = 'all';
    renderAll();
  });

  // Repair boundary
  document.getElementById('btn-repair-inventory')?.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY_ITEMS);
    localStorage.removeItem(STORAGE_KEY_IN);
    localStorage.removeItem(STORAGE_KEY_OUT);
    localStorage.removeItem(STORAGE_KEY_LOGS);
    loadLocalCache();
    fetchDatabaseState();
    document.getElementById('stock-error-boundary')?.classList.add('hidden');
    showToast('Inventory database synchronization refreshed', 'success');
  });
}

let isStockInitialized = false;

export function initStockSummarySection() {
  if (isStockInitialized) {
    // Retain state, refresh calculations and views seamlessly
    recalculateBalances();
    renderAll();
    return;
  }
  isStockInitialized = true;
  try {
    loadLocalCache();
    setupEventListeners();
    renderAll();
    fetchDatabaseState();
  } catch (err) {
    console.error('Stock Manager Initialization Error:', err);
    document.getElementById('stock-error-boundary')?.classList.remove('hidden');
  }
}

// Auto-run on DOM Ready if loaded directly via standalone stock-manager/index.html
if (typeof window !== 'undefined' && document.getElementById('btn-header-back')) {
  document.addEventListener('DOMContentLoaded', () => {
    initStockSummarySection();
  });
}
