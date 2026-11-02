/**
 * =============================================================================
 * LIMRA RESTAURANT POS — GST ACCOUNTING & REPORTING ENGINE (pos/reports-gst.js)
 * =============================================================================
 * 
 * Provides:
 * 1. GST Date-Range Filtering (Today, Yesterday, This Month, Last Month, 7d, 30d, Custom).
 * 2. Exact GST 5% Accounting (2.5% CGST + 2.5% SGST) across consolidated bills.
 * 3. Server-side historical range fetching with zero order duplication.
 * 4. Monthly GST Filing CSV Export compliant with SAC code 996331.
 */

import { posState, posEvents } from './state.js';
import { showAdminToast } from './audio-alerts.js';
import { fmtMoney, getLocalDateString, parseNotesMetadata } from './pos-utils.js';
import { insforge } from '../lib/insforge.js';

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

export let activeGstPreset = 'this_month';
export let gstCustomStart = '';
export let gstCustomEnd = '';
export const gstLoadedRanges = new Set();
export let isFetchingGstOrders = false;

// Callbacks injected from admin facade
let _computeOrderTaxDetails = null;
let _getConsolidatedClosedBills = null;
let _getBillSettings = null;
let _ensureOrderItemsLoaded = null;

export function setGstExternalCallbacks(callbacks = {}) {
  if (callbacks.computeOrderTaxDetails) _computeOrderTaxDetails = callbacks.computeOrderTaxDetails;
  if (callbacks.getConsolidatedClosedBills) _getConsolidatedClosedBills = callbacks.getConsolidatedClosedBills;
  if (callbacks.getBillSettings) _getBillSettings = callbacks.getBillSettings;
  if (callbacks.ensureOrderItemsLoaded) _ensureOrderItemsLoaded = callbacks.ensureOrderItemsLoaded;
}

export function formatGstDateLabel(date) {
  if (!date) return '';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

export function getGstDateRangeBounds(preset = activeGstPreset, customStart = gstCustomStart, customEnd = gstCustomEnd) {
  const now = new Date();
  const todayStr = getLocalDateString(now);

  let startDate = null;
  let endDate = null;
  let label = '';
  let rangeKey = '';

  if (preset === 'today') {
    const [y, m, d] = todayStr.split('-').map(Number);
    startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    endDate = new Date(y, m - 1, d, 23, 59, 59, 999);
    label = `Today (${formatGstDateLabel(startDate)})`;
    rangeKey = `gst_today_${todayStr}`;
  } else if (preset === 'yesterday') {
    const yDate = new Date(now);
    yDate.setDate(yDate.getDate() - 1);
    const yestStr = getLocalDateString(yDate);
    const [y, m, d] = yestStr.split('-').map(Number);
    startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    endDate = new Date(y, m - 1, d, 23, 59, 59, 999);
    label = `Yesterday (${formatGstDateLabel(startDate)})`;
    rangeKey = `gst_yesterday_${yestStr}`;
  } else if (preset === 'this_month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    label = `This Month (${now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })})`;
    rangeKey = `gst_month_${now.getFullYear()}_${now.getMonth() + 1}`;
  } else if (preset === 'last_month') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    label = `Last Month (${lastMonthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })})`;
    rangeKey = `gst_month_${startDate.getFullYear()}_${startDate.getMonth() + 1}`;
  } else if (preset === '7d') {
    const start7 = new Date(now);
    start7.setDate(start7.getDate() - 6);
    const start7Str = getLocalDateString(start7);
    const [y, m, d] = start7Str.split('-').map(Number);
    startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    const [eY, eM, eD] = todayStr.split('-').map(Number);
    endDate = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
    label = `Last 7 Days (${formatGstDateLabel(startDate)} – ${formatGstDateLabel(endDate)})`;
    rangeKey = `gst_7d_${start7Str}_${todayStr}`;
  } else if (preset === '30d') {
    const start30 = new Date(now);
    start30.setDate(start30.getDate() - 29);
    const start30Str = getLocalDateString(start30);
    const [y, m, d] = start30Str.split('-').map(Number);
    startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    const [eY, eM, eD] = todayStr.split('-').map(Number);
    endDate = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
    label = `Last 30 Days (${formatGstDateLabel(startDate)} – ${formatGstDateLabel(endDate)})`;
    rangeKey = `gst_30d_${start30Str}_${todayStr}`;
  } else if (preset === 'custom') {
    if (customStart) {
      const [sY, sM, sD] = customStart.split('-').map(Number);
      startDate = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
      const endStr = customEnd || customStart;
      const [eY, eM, eD] = endStr.split('-').map(Number);
      endDate = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
      if (customStart === endStr) {
        label = `${formatGstDateLabel(startDate)}`;
      } else {
        label = `${formatGstDateLabel(startDate)} – ${formatGstDateLabel(endDate)}`;
      }
      rangeKey = `gst_custom_${customStart}_${endStr}`;
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      label = `This Month (${now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })})`;
      rangeKey = `gst_month_${now.getFullYear()}_${now.getMonth() + 1}`;
    }
  }

  return {
    startDate,
    endDate,
    startIso: startDate ? startDate.toISOString() : null,
    endIso: endDate ? endDate.toISOString() : null,
    label,
    rangeKey
  };
}

const ORDER_SELECT_COLUMNS = 'id, order_number, customer_name, customer_phone, total_amount, subtotal_amount, discount_pct, discount_amount, taxable_amount, cgst_amount, sgst_amount, delivery_fee, packaging_fee, round_off_amount, status, payment_status, payment_method, notes, latitude, longitude, landmark, delivery_notes, location_verified, order_type, table_number, table_zone, txn_ref, ticket_status, settled_at, consolidated_into_order_id, created_at, updated_at';

export async function ensureOrdersForGstRange(startIso, endIso, rangeKey, force = false) {
  if (isFetchingGstOrders || !startIso || !endIso || !rangeKey) return;
  if (!force && gstLoadedRanges.has(rangeKey)) return;

  const currentOrders = posState.getOrders();
  if (!force && currentOrders.length > 0) {
    const oldest = new Date(currentOrders[currentOrders.length - 1].created_at || Date.now());
    if (oldest <= new Date(startIso)) {
      gstLoadedRanges.add(rangeKey);
      return;
    }
  }

  isFetchingGstOrders = true;
  try {
    const pageSize = 1000;
    let from = 0;
    let fetched = [];

    while (true) {
      let q = insforge.database
        .from('orders')
        .select(ORDER_SELECT_COLUMNS)
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);

      const { data, error } = await q;
      if (error) {
        console.warn('[GST Hub] Error loading historical batch:', error);
        break;
      }
      if (Array.isArray(data) && data.length > 0) {
        fetched.push(...data);
      }
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }

    if (fetched.length > 0) {
      const orderMap = new Map();
      currentOrders.forEach(o => orderMap.set(String(o.id), o));
      fetched.forEach(o => orderMap.set(String(o.id), o));
      const merged = Array.from(orderMap.values()).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      posState.setOrders(merged);
      posState.persistOrdersCache();
    }
    gstLoadedRanges.add(rangeKey);
  } catch (err) {
    console.error('[GST Hub] Failed to ensure historical orders:', err);
  } finally {
    isFetchingGstOrders = false;
  }
}

export function getGstFilteredOrders(startDate, endDate) {
  const orders = posState.getOrders();
  const nonCancelled = orders.filter(o => o.status !== 'cancelled');
  let matched = nonCancelled;

  if (startDate && endDate) {
    matched = nonCancelled.filter(o => {
      const t = new Date(o.created_at);
      return t >= startDate && t <= endDate;
    });
  }

  if (typeof _getConsolidatedClosedBills === 'function') {
    return _getConsolidatedClosedBills(matched);
  }
  return matched;
}

export async function renderGSTSection() {
  const { startDate, endDate, startIso, endIso, label, rangeKey } = getGstDateRangeBounds();

  if ($('dash-gst-period-text')) {
    $('dash-gst-period-text').textContent = `GST Report: ${label}`;
  }

  if (startIso && endIso) {
    await ensureOrdersForGstRange(startIso, endIso, rangeKey);
  }

  const filteredOrders = getGstFilteredOrders(startDate, endDate);

  let sumGross = 0;
  let sumTaxable = 0;
  let sumCGST = 0;
  let sumSGST = 0;
  let sumIGST = 0;
  let sumGST = 0;
  let sumPaidGST = 0;
  let sumPendingGST = 0;

  filteredOrders.forEach(o => {
    let td = { taxableValue: 0, cgstAmt: 0, sgstAmt: 0, totalGst: 0, grandTotal: Number(o.total_amount || 0) };
    if (typeof _computeOrderTaxDetails === 'function') {
      td = _computeOrderTaxDetails(o);
    }
    const taxable = td.taxableValue || 0;
    const cgst = td.cgstAmt || 0;
    const sgst = td.sgstAmt || 0;
    const igst = td.isInterstate ? td.totalGst : 0;
    const totalGst = td.totalGst || (cgst + sgst + igst);
    const gross = td.grandTotal || Number(o.total_amount || 0);

    sumTaxable += taxable;
    sumCGST += cgst;
    sumSGST += sgst;
    sumIGST += igst;
    sumGST += totalGst;
    sumGross += gross;

    if (o.payment_status === 'paid') {
      sumPaidGST += totalGst;
    } else {
      sumPendingGST += totalGst;
    }
  });

  const orderCount = filteredOrders.length;

  if ($('stat-gst-gross')) $('stat-gst-gross').textContent = fmtMoney(sumGross);
  if ($('stat-gst-taxable')) $('stat-gst-taxable').textContent = fmtMoney(sumTaxable);
  if ($('stat-gst-total')) $('stat-gst-total').textContent = fmtMoney(sumGST);
  if ($('stat-gst-cgst')) $('stat-gst-cgst').textContent = fmtMoney(sumCGST);
  if ($('stat-gst-sgst')) $('stat-gst-sgst').textContent = fmtMoney(sumSGST);
  if ($('stat-gst-igst')) $('stat-gst-igst').textContent = fmtMoney(sumIGST);
  if ($('stat-gst-order-count')) $('stat-gst-order-count').textContent = `${orderCount} ${orderCount === 1 ? 'Order' : 'Orders'}`;
  if ($('stat-gst-paid')) $('stat-gst-paid').textContent = fmtMoney(sumPaidGST);
  if ($('stat-gst-pending')) $('stat-gst-pending').textContent = fmtMoney(sumPendingGST);

  const emptyEl = $('dash-gst-empty-state');
  if (emptyEl) {
    emptyEl.style.display = orderCount === 0 ? 'block' : 'none';
  }

  renderGSTMonthlySelect();
}

export function setGstDatePreset(preset) {
  activeGstPreset = preset;

  if (typeof document !== 'undefined') {
    document.querySelectorAll('#dash-gst-presets .gst-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === preset);
    });
  }

  const customWrap = $('dash-gst-custom-range-wrap');
  if (preset === 'custom') {
    if (customWrap) customWrap.style.display = 'flex';
    if (gstCustomStart) {
      renderGSTSection();
    } else {
      const todayStr = getLocalDateString(new Date());
      if ($('dash-gst-start-date')) $('dash-gst-start-date').value = todayStr;
      if ($('dash-gst-end-date')) $('dash-gst-end-date').value = todayStr;
    }
  } else {
    if (customWrap) customWrap.style.display = 'none';
    gstCustomStart = '';
    gstCustomEnd = '';
    if ($('dash-gst-start-date')) $('dash-gst-start-date').value = '';
    if ($('dash-gst-end-date')) $('dash-gst-end-date').value = '';
    renderGSTSection();
  }
}

export function applyGstCustomRange(startStr, endStr) {
  if (!startStr) {
    showAdminToast('Please select a start date.', 'warning');
    return;
  }
  const finalEnd = endStr || startStr;
  if (startStr > finalEnd) {
    showAdminToast('Start date cannot be after end date.', 'warning');
    return;
  }

  activeGstPreset = 'custom';
  gstCustomStart = startStr;
  gstCustomEnd = finalEnd;

  if (typeof document !== 'undefined') {
    document.querySelectorAll('#dash-gst-presets .gst-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === 'custom');
    });
  }

  const customWrap = $('dash-gst-custom-range-wrap');
  if (customWrap) customWrap.style.display = 'flex';

  renderGSTSection();
}

export function resetGstFilter() {
  activeGstPreset = 'this_month';
  gstCustomStart = '';
  gstCustomEnd = '';

  if ($('dash-gst-start-date')) $('dash-gst-start-date').value = '';
  if ($('dash-gst-end-date')) $('dash-gst-end-date').value = '';

  const customWrap = $('dash-gst-custom-range-wrap');
  if (customWrap) customWrap.style.display = 'none';

  if (typeof document !== 'undefined') {
    document.querySelectorAll('#dash-gst-presets .gst-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === 'this_month');
    });
  }

  renderGSTSection();
  showAdminToast('GST filter reset to current month.', 'info');
}

export function renderGSTMonthlySelect() {
  const select = $('dash-gst-month-select');
  if (!select) return;

  const orders = posState.getOrders();
  const monthMap = new Map();
  orders.forEach(o => {
    if (o.created_at) {
      const d = new Date(o.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      monthMap.set(key, label);
    }
  });

  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!monthMap.has(currentKey)) {
    monthMap.set(currentKey, now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }));
  }

  const sortedMonths = Array.from(monthMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  const prevVal = select.value;
  select.innerHTML = `
    <option value="this_month">This Month (${monthMap.get(currentKey) || 'Current Month'})</option>
    <option value="custom" ${activeGstPreset === 'custom' ? 'selected' : ''}>Custom Date Range</option>
    <optgroup label="Select Specific Month">
      ${sortedMonths.map(([k, label]) => `<option value="${k}">${label}</option>`).join('')}
    </optgroup>
  `;

  if (activeGstPreset === 'custom') {
    select.value = 'custom';
  } else if (activeGstPreset === 'this_month') {
    select.value = 'this_month';
  } else if (prevVal && select.querySelector(`option[value="${prevVal}"]`)) {
    select.value = prevVal;
  }
}

export async function exportMonthlyGSTFilingCSV(options = {}) {
  const { startDate, endDate, startIso, endIso, label } = getGstDateRangeBounds(options.preset || activeGstPreset, options.customStart || gstCustomStart, options.customEnd || gstCustomEnd);

  if (startIso && endIso && !options.orders) {
    try {
      await ensureOrdersForGstRange(startIso, endIso, `gst_export_${startIso}_${endIso}`);
    } catch (e) {}
  }

  const targetOrders = options.orders || getGstFilteredOrders(startDate, endDate);
  if (!targetOrders || targetOrders.length === 0) {
    showAdminToast('No orders found for the selected GST reporting period.', 'error');
    return null;
  }

  if (typeof _ensureOrderItemsLoaded === 'function') {
    await _ensureOrderItemsLoaded(targetOrders.map(o => o.id));
  }

  const s = typeof _getBillSettings === 'function' ? _getBillSettings() : { restaurantName: 'LIMRA RESTAURANT', gstin: '' };
  const restaurantName = s.restaurantName || 'LIMRA RESTAURANT';
  const gstin = s.gstin || 'NOT SPECIFIED';

  const headers = [
    'Invoice / Order #',
    'Invoice Date',
    'Customer Name',
    'Customer Phone',
    'Order Type',
    'Payment Mode',
    'Payment Status',
    'SAC Code',
    'Taxable Value (INR)',
    'CGST Rate (%)',
    'CGST Amount (INR)',
    'SGST Rate (%)',
    'SGST Amount (INR)',
    'Total GST (INR)',
    'Invoice Total (INR)',
    'Restaurant Name',
    'Restaurant GSTIN'
  ];

  let sumTaxable = 0;
  let sumCGST = 0;
  let sumSGST = 0;
  let sumGST = 0;
  let sumTotal = 0;

  const rows = targetOrders.map(o => {
    let td = { taxableValue: 0, cgstAmt: 0, sgstAmt: 0, totalGst: 0, grandTotal: Number(o.total_amount || 0) };
    if (typeof _computeOrderTaxDetails === 'function') {
      td = _computeOrderTaxDetails(o);
    }
    const meta = parseNotesMetadata(o.notes, o);
    const taxable = td.taxableValue;
    const cgstAmt = td.cgstAmt;
    const sgstAmt = td.sgstAmt;
    const gstAmt = td.totalGst;
    const totalAmt = td.grandTotal;

    sumTaxable += taxable;
    sumCGST += cgstAmt;
    sumSGST += sgstAmt;
    sumGST += gstAmt;
    sumTotal += totalAmt;

    const dateStr = new Date(o.created_at).toLocaleDateString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });

    const orderType = meta.type === 'table' ? `Dine-In (Table ${meta.tableNumber || o.table_number || '—'})` : (meta.type === 'delivery' ? 'Online Delivery' : 'Pickup / Takeaway');
    const paymentMode = (o.payment_method || meta.paymentMode || o.payment_mode || meta.payment || (o.payment_status === 'paid' ? 'UPI/Online' : 'Cash/Pending')).toUpperCase();

    return [
      `"${o.order_number || o.id}"`,
      `"${dateStr}"`,
      `"${(o.customer_name || 'Walk-in Customer').replace(/"/g, '""')}"`,
      `"${o.customer_phone || ''}"`,
      `"${orderType}"`,
      `"${paymentMode}"`,
      `"${(o.payment_status || 'unpaid').toUpperCase()}"`,
      `"996331"`,
      `"${taxable.toFixed(2)}"`,
      `"2.50%"`,
      `"${cgstAmt.toFixed(2)}"`,
      `"2.50%"`,
      `"${sgstAmt.toFixed(2)}"`,
      `"${gstAmt.toFixed(2)}"`,
      `"${totalAmt.toFixed(2)}"`,
      `"${restaurantName}"`,
      `"${gstin}"`
    ];
  });

  rows.push([
    '"TOTALS"',
    '""',
    `"${targetOrders.length} Invoices"`,
    '""',
    '""',
    '""',
    '""',
    '""',
    `"${sumTaxable.toFixed(2)}"`,
    '""',
    `"${sumCGST.toFixed(2)}"`,
    '""',
    `"${sumSGST.toFixed(2)}"`,
    `"${sumGST.toFixed(2)}"`,
    `"${sumTotal.toFixed(2)}"`,
    `"${restaurantName}"`,
    `"${gstin}"`
  ]);

  const fileRangeStr = startDate && endDate
    ? `${getLocalDateString(startDate)}_to_${getLocalDateString(endDate)}`
    : 'All';

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

  if (typeof document !== 'undefined') {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `LIMRA_Restaurant_GST_Report_${fileRangeStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showAdminToast(`GST Report CSV for ${label} downloaded! 📥`, 'success');
  }

  return csvContent;
}

export function initGSTSectionListeners() {
  if (typeof document === 'undefined') return;

  document.querySelectorAll('#dash-gst-presets .gst-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setGstDatePreset(btn.dataset.preset);
    });
  });

  $('dash-gst-apply-btn')?.addEventListener('click', () => {
    const s = $('dash-gst-start-date')?.value;
    const e = $('dash-gst-end-date')?.value;
    applyGstCustomRange(s, e);
  });

  $('dash-gst-reset-btn')?.addEventListener('click', () => {
    resetGstFilter();
  });

  $('dash-gst-month-select')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'custom') {
      setGstDatePreset('custom');
    } else if (val === 'this_month') {
      setGstDatePreset('this_month');
    } else if (val) {
      const [year, month] = val.split('-').map(Number);
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0);
      applyGstCustomRange(getLocalDateString(start), getLocalDateString(end));
    }
  });

  $('dash-gst-export-csv-btn')?.addEventListener('click', async () => {
    await exportMonthlyGSTFilingCSV();
  });
}
