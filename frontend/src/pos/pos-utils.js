/**
 * =============================================================================
 * LIMRA RESTAURANT POS — REUSABLE UTILITIES & HELPERS (pos/pos-utils.js)
 * =============================================================================
 * 
 * Pure functions for string escaping, item consolidation, metadata parsing,
 * time formatting, and number formatting.
 */

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseItemNameAndNotes(rawName) {
  if (!rawName) return { name: '', notes: '' };
  const str = String(rawName).trim();
  const match = str.match(/^(.*?)\s*\[Note:\s*(.*?)\]\s*$/i);
  if (match) {
    return { name: match[1].trim(), notes: match[2].trim() };
  }
  return { name: str, notes: '' };
}

export function consolidateOrderItems(items) {
  if (!items || !items.length) return [];
  const map = new Map();
  for (const i of items) {
    const rawName = (i.item_name || i.name || '').trim();
    if (!rawName) continue;
    const parsed = parseItemNameAndNotes(rawName);
    const name = parsed.name || rawName;
    const notes = (i.notes || parsed.notes || '').trim();
    const price = Number(i.unit_price || i.price || 0);
    const qty = Number(i.quantity || i.qty || 1);
    const lineTotal = Number(i.line_total || (price * qty) || 0);
    const key = `${name.toLowerCase()}__${price}__${notes.toLowerCase()}`;
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
        line_total: lineTotal,
        notes: notes
      });
    }
  }
  return Array.from(map.values());
}

export function formatDailyOrderNumber(order) {
  if (!order) return '0000';
  if (order.order_number) return String(order.order_number).padStart(4, '0');
  return String(order.id || '0000').slice(-4);
}

export function fmtDate(d) {
  if (!d) return '—';
  try {
    const dateObj = d instanceof Date ? d : new Date(d);
    if (isNaN(dateObj.getTime())) return '—';
    return dateObj.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (e) {
    return '—';
  }
}

export function formatDateTime(d) {
  return fmtDate(d);
}

export function getLocalDateString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function timeSince(date) {
  if (!date) return '—';
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return `${Math.max(0, seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function parseNotesMetadata(notes, order = null) {
  const result = {
    email: '',
    type: 'pickup',
    address: '',
    area: '',
    distance: '',
    charge: '',
    deliveryFee: 0,
    packagingFee: 0,
    discountPct: 0,
    discountAmt: 0,
    couponCode: '',
    tableNumber: null,
    paymentMode: '',
    cleanNotes: '',
    isPaidFinalBill: false,
    isBilledUnpaid: false
  };

  if (order) {
    if (order.order_type === 'table' || order.table_number) {
      result.type = 'table';
      result.tableNumber = order.table_number ? String(order.table_number) : null;
    } else if (order.order_type === 'delivery') {
      result.type = 'delivery';
    } else if (order.order_type === 'pickup') {
      result.type = 'pickup';
    }

    if (order.payment_method) result.paymentMode = order.payment_method;
    if (order.delivery_fee != null && !isNaN(Number(order.delivery_fee))) {
      result.deliveryFee = Number(order.delivery_fee);
    }
    if (order.packaging_fee != null && !isNaN(Number(order.packaging_fee))) {
      result.packagingFee = Number(order.packaging_fee);
    }
    if (order.discount_pct != null && !isNaN(Number(order.discount_pct))) {
      result.discountPct = Number(order.discount_pct);
    }
    if (order.discount_amount != null && !isNaN(Number(order.discount_amount))) {
      result.discountAmt = Number(order.discount_amount);
    }
  }

  if (!notes) {
    return result;
  }

  let str = String(notes);

  if (str.includes('[FINAL_BILL]') || str.includes('[PAID_FINAL_BILL]')) {
    result.isPaidFinalBill = true;
  }
  if (str.includes('[BILLED_UNPAID]')) {
    result.isBilledUnpaid = true;
  }

  const tableMatch = str.match(/\[TABLE:\s*(.*?)\]/i);
  if (tableMatch) {
    result.type = 'table';
    result.tableNumber = tableMatch[1].trim();
  }

  if (str.includes('[DELIVERY]')) {
    result.type = 'delivery';
  } else if (str.includes('[SELF PICKUP]')) {
    result.type = 'pickup';
  }

  const emailMatch = str.match(/\[EMAIL:\s*(.*?)\]/i);
  if (emailMatch) result.email = emailMatch[1].trim();

  const couponMatch = str.match(/\[COUPON:\s*(.*?)\]/i);
  if (couponMatch) result.couponCode = couponMatch[1].trim();

  const discPctMatch = str.match(/\[DISCOUNT_PCT:\s*([\d.]+)%?\]/i);
  if (discPctMatch && result.discountPct === 0) result.discountPct = parseFloat(discPctMatch[1]);

  const discAmtMatch = str.match(/\[DISCOUNT_AMT:\s*([\d.]+)\]/i);
  if (discAmtMatch && result.discountAmt === 0) result.discountAmt = parseFloat(discAmtMatch[1]);

  const delFeeMatch = str.match(/\[DELIVERY_FEE:\s*([\d.]+)\]/i);
  if (delFeeMatch && result.deliveryFee === 0) result.deliveryFee = parseFloat(delFeeMatch[1]);

  const payMatch = str.match(/\[PAYMENT:\s*(.*?)\]/i);
  if (payMatch) result.paymentMode = payMatch[1].trim();

  const areaMatch = str.match(/Place:\s*([^|]+)/i);
  if (areaMatch) result.area = areaMatch[1].trim();

  const addrMatch = str.match(/Address:\s*([^|]+)/i);
  if (addrMatch) result.address = addrMatch[1].trim();

  result.cleanNotes = str.replace(/\[.*?\]/g, '').replace(/Place:[^|]+(\|)?/gi, '').replace(/Address:[^|]+(\|)?/gi, '').replace(/Delivery charge:[^|]+(\|)?/gi, '').trim();

  return result;
}

export function fmtMoney(num) {
  const n = Number(num || 0);
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
