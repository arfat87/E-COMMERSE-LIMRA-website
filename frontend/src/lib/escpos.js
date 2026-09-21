/**
 * LIMRA Restaurant POS V2 — ESC/POS Thermal Printing Formatter
 * Supports both standard 80mm (48 cols) and compact 58mm (32 cols) hardware printers.
 */

// ESC/POS Command Codes
export const COMMANDS = {
  INIT: '\x1B\x40',                  // Initialize printer
  ALIGN_LEFT: '\x1B\x61\x00',         // Left justify
  ALIGN_CENTER: '\x1B\x61\x01',       // Center justify
  ALIGN_RIGHT: '\x1B\x61\x02',        // Right justify
  BOLD_ON: '\x1B\x45\x01',           // Emphasized (bold) mode on
  BOLD_OFF: '\x1B\x45\x00',          // Emphasized mode off
  DOUBLE_HEIGHT: '\x1B\x21\x10',     // Double height text
  DOUBLE_WIDTH: '\x1B\x21\x20',      // Double width text
  DOUBLE_SIZE: '\x1B\x21\x30',       // Double height + width
  NORMAL: '\x1B\x21\x00',            // Reset character styling
  UNDERLINE_ON: '\x1B\x2D\x01',      // Underline on
  UNDERLINE_OFF: '\x1B\x2D\x00',     // Underline off
  LINE_FEED: '\x0A',                 // Line feed
  PARTIAL_CUT: '\x1D\x56\x42\x03',   // Feed 3 lines and partial cut
  FULL_CUT: '\x1D\x56\x41\x03',      // Feed 3 lines and full cut
  DRAWER_KICK: '\x1B\x70\x00\x19\xFA' // Pulse cash drawer pin 2
};

/**
 * Returns column width based on printer settings
 * @param {number|string} paperWidth - 80 or 58
 * @returns {number} 48 for 80mm, 32 for 58mm
 */
export function getColumnWidth(paperWidth = 80) {
  const w = parseInt(String(paperWidth), 10);
  return w === 58 ? 32 : 48;
}

/**
 * Pad string to exact width
 */
export function padRight(str = '', len = 0) {
  const s = String(str);
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

export function padLeft(str = '', len = 0) {
  const s = String(str);
  return s.length >= len ? s.slice(0, len) : ' '.repeat(len - s.length) + s;
}

/**
 * Two-column aligned row: Left text and Right text separated by spaces
 */
export function formatTwoColumns(left = '', right = '', totalWidth = 48) {
  const leftStr = String(left);
  const rightStr = String(right);
  const spaces = totalWidth - leftStr.length - rightStr.length;
  if (spaces > 0) {
    return leftStr + ' '.repeat(spaces) + rightStr;
  }
  // If too wide, truncate left slightly
  const maxLeft = Math.max(0, totalWidth - rightStr.length - 1);
  return leftStr.slice(0, maxLeft) + ' ' + rightStr;
}

/**
 * Wrap text to lines not exceeding maxWidth
 */
export function wrapText(text = '', maxWidth = 48) {
  if (!text) return [];
  const words = String(text).split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + (currentLine ? ' ' : '') + word).length <= maxWidth) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word.length > maxWidth ? word.slice(0, maxWidth) : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Builds standard ESC/POS command stream for a Customer Final Bill Receipt
 * @param {Object} order - Order record
 * @param {Array} items - Array of order items
 * @param {Object} settings - Printer settings record
 * @returns {string} Raw ESC/POS text/command buffer string
 */
export function buildEscPosBill(order = {}, items = [], settings = {}) {
  const width = getColumnWidth(settings.bill_paper_width || 80);
  const is58 = width === 32;
  const separator = '-'.repeat(width);
  const doubleSeparator = '='.repeat(width);

  let out = COMMANDS.INIT;

  // 1. Kick cash drawer if payment is cash
  const payMode = (order.payment_mode || '').toLowerCase();
  if (payMode.includes('cash')) {
    out += COMMANDS.DRAWER_KICK;
  }

  // 2. Header
  out += COMMANDS.ALIGN_CENTER;
  out += COMMANDS.BOLD_ON + COMMANDS.DOUBLE_SIZE;
  out += (settings.restaurant_name || 'LIMRA RESTAURANT') + COMMANDS.LINE_FEED;
  out += COMMANDS.NORMAL;

  if (settings.restaurant_address) {
    const addrLines = wrapText(settings.restaurant_address, width);
    addrLines.forEach(l => { out += l + COMMANDS.LINE_FEED; });
  }

  let contactLine = '';
  if (settings.restaurant_phone) contactLine += `Tel: ${settings.restaurant_phone} `;
  if (settings.restaurant_gstin) contactLine += `GSTIN: ${settings.restaurant_gstin}`;
  if (contactLine) {
    wrapText(contactLine.trim(), width).forEach(l => { out += l + COMMANDS.LINE_FEED; });
  }
  if (settings.restaurant_fssai) {
    out += `FSSAI: ${settings.restaurant_fssai}` + COMMANDS.LINE_FEED;
  }

  // 3. Invoice Title
  out += doubleSeparator + COMMANDS.LINE_FEED;
  out += COMMANDS.BOLD_ON;
  const tableNum = order.table_number || (order.notes && order.notes.match(/Table\s*#?(\d+)/i)?.[1]) || '';
  const orderType = (order.order_type || 'dine_in').toUpperCase();
  if (tableNum) {
    out += `TAX INVOICE — TABLE ${tableNum}` + COMMANDS.LINE_FEED;
  } else if (orderType === 'DELIVERY') {
    out += `TAX INVOICE — HOME DELIVERY` + COMMANDS.LINE_FEED;
  } else {
    out += `TAX INVOICE — ${orderType}` + COMMANDS.LINE_FEED;
  }
  out += COMMANDS.BOLD_OFF;
  out += separator + COMMANDS.LINE_FEED;

  // 4. Order Metadata
  out += COMMANDS.ALIGN_LEFT;
  const ordNo = order.order_number ? `#${order.order_number}` : '—';
  const orderDate = new Date(order.created_at || Date.now()).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true
  });
  out += formatTwoColumns(`Bill: ${ordNo}`, orderDate, width) + COMMANDS.LINE_FEED;
  if (order.customer_name) {
    const custPhone = order.customer_phone ? ` (${order.customer_phone})` : '';
    out += `Guest: ${order.customer_name}${custPhone}`.slice(0, width) + COMMANDS.LINE_FEED;
  }
  out += separator + COMMANDS.LINE_FEED;

  // 5. Items Table Header
  out += COMMANDS.BOLD_ON;
  if (is58) {
    // 58mm: Item (16) Qty (3) Rate (6) Amt (7) = 32
    out += padRight('Item', 16) + padLeft('Qty', 3) + padLeft('Rate', 6) + padLeft('Amt', 7) + COMMANDS.LINE_FEED;
  } else {
    // 80mm: Item (26) Qty (4) Rate (8) Amt (10) = 48
    out += padRight('Item', 26) + padLeft('Qty', 4) + padLeft('Rate', 8) + padLeft('Amt', 10) + COMMANDS.LINE_FEED;
  }
  out += COMMANDS.BOLD_OFF;
  out += separator + COMMANDS.LINE_FEED;

  // 6. Item Rows
  let itemsSubtotal = 0;
  (items || []).forEach(item => {
    const name = item.item_name || item.name || 'Item';
    const qty = Number(item.quantity || item.qty || 1);
    const price = Number(item.unit_price || item.price || 0);
    const lineTotal = Number(item.line_total || (qty * price) || 0);
    itemsSubtotal += lineTotal;

    const qtyStr = String(qty);
    const rateStr = price.toFixed(0);
    const totalStr = lineTotal.toFixed(2);

    if (is58) {
      const nameCol = 16;
      if (name.length <= nameCol) {
        out += padRight(name, nameCol) + padLeft(qtyStr, 3) + padLeft(rateStr, 6) + padLeft(totalStr, 7) + COMMANDS.LINE_FEED;
      } else {
        out += name.slice(0, nameCol) + padLeft(qtyStr, 3) + padLeft(rateStr, 6) + padLeft(totalStr, 7) + COMMANDS.LINE_FEED;
        out += ' ' + name.slice(nameCol, nameCol + 28) + COMMANDS.LINE_FEED;
      }
    } else {
      const nameCol = 26;
      if (name.length <= nameCol) {
        out += padRight(name, nameCol) + padLeft(qtyStr, 4) + padLeft(rateStr, 8) + padLeft(totalStr, 10) + COMMANDS.LINE_FEED;
      } else {
        out += name.slice(0, nameCol) + padLeft(qtyStr, 4) + padLeft(rateStr, 8) + padLeft(totalStr, 10) + COMMANDS.LINE_FEED;
        out += ' ' + name.slice(nameCol, nameCol + 44) + COMMANDS.LINE_FEED;
      }
    }

    if (item.notes) {
      out += `  * ${item.notes}`.slice(0, width) + COMMANDS.LINE_FEED;
    }
  });

  out += separator + COMMANDS.LINE_FEED;

  // 7. Totals & Tax Calculation
  const discountAmt = Number(order.discount_amount || 0);
  const taxable = Math.max(0, itemsSubtotal - discountAmt);
  const cgstRate = Number(settings.cgst_rate ?? 2.5);
  const sgstRate = Number(settings.sgst_rate ?? 2.5);
  const cgst = taxable * (cgstRate / 100);
  const sgst = taxable * (sgstRate / 100);
  const deliveryFee = Number(order.delivery_fee || 0);
  const grandTotal = Number(order.total_amount || (taxable + cgst + sgst + deliveryFee));

  out += formatTwoColumns('Subtotal:', `₹${itemsSubtotal.toFixed(2)}`, width) + COMMANDS.LINE_FEED;
  if (discountAmt > 0) {
    out += formatTwoColumns('Discount:', `-₹${discountAmt.toFixed(2)}`, width) + COMMANDS.LINE_FEED;
    out += formatTwoColumns('Net Taxable:', `₹${taxable.toFixed(2)}`, width) + COMMANDS.LINE_FEED;
  }
  if (settings.bill_show_tax_summary !== false) {
    out += formatTwoColumns(`CGST @ ${cgstRate}%:`, `₹${cgst.toFixed(2)}`, width) + COMMANDS.LINE_FEED;
    out += formatTwoColumns(`SGST @ ${sgstRate}%:`, `₹${sgst.toFixed(2)}`, width) + COMMANDS.LINE_FEED;
  }
  if (deliveryFee > 0) {
    out += formatTwoColumns('Delivery Fee:', `₹${deliveryFee.toFixed(2)}`, width) + COMMANDS.LINE_FEED;
  }

  out += doubleSeparator + COMMANDS.LINE_FEED;
  out += COMMANDS.BOLD_ON + COMMANDS.DOUBLE_HEIGHT;
  out += formatTwoColumns('GRAND TOTAL:', `₹${grandTotal.toFixed(2)}`, width) + COMMANDS.LINE_FEED;
  out += COMMANDS.NORMAL;
  out += doubleSeparator + COMMANDS.LINE_FEED;

  // 8. Payment Mode
  const paymentMode = (order.payment_mode || 'CASH').toUpperCase();
  const paymentStatus = (order.payment_status || 'PAID').toUpperCase();
  out += formatTwoColumns(`Payment: ${paymentMode}`, `Status: ${paymentStatus}`, width) + COMMANDS.LINE_FEED;

  // 9. Google Review Prompt & QR Notice
  if (settings.bill_show_review_qr !== false) {
    out += separator + COMMANDS.LINE_FEED;
    out += COMMANDS.ALIGN_CENTER;
    out += '***** LOVE YOUR EXPERIENCE? *****' + COMMANDS.LINE_FEED;
    out += COMMANDS.BOLD_ON;
    out += (settings.bill_review_heading || 'LOVE YOUR EXPERIENCE?') + COMMANDS.LINE_FEED;
    out += COMMANDS.BOLD_OFF;
    out += (settings.bill_review_subtext || 'Scan to leave us a Google Review') + COMMANDS.LINE_FEED;
    const reviewUrl = settings.bill_review_url || 'https://g.page/r/CcrqEfWap5zfEBE/review';
    out += `>> ${reviewUrl} <<` + COMMANDS.LINE_FEED;
  }

  // 10. Footer Message & Cut
  out += separator + COMMANDS.LINE_FEED;
  out += COMMANDS.ALIGN_CENTER;
  out += (settings.bill_footer_message || 'Thank you for dining with us! Visit again.') + COMMANDS.LINE_FEED;
  out += (settings.restaurant_name || 'LIMRA RESTAURANT') + COMMANDS.LINE_FEED;

  // Feed and cut
  const feedLines = Math.max(2, parseInt(settings.bill_bottom_feed || 3, 10));
  out += COMMANDS.LINE_FEED.repeat(feedLines);
  out += (settings.bill_auto_cut === 'full' ? COMMANDS.FULL_CUT : COMMANDS.PARTIAL_CUT);

  return out;
}

/**
 * Builds standard ESC/POS command stream for Kitchen Order Ticket (KOT)
 * @param {Object} order - Order record
 * @param {Array} items - Array of order items
 * @param {Object} settings - Printer settings record
 * @returns {string} Raw ESC/POS text/command buffer string
 */
export function buildEscPosKOT(order = {}, items = [], settings = {}) {
  const width = getColumnWidth(settings.kot_paper_width || 80);
  const separator = '-'.repeat(width);
  const doubleSeparator = '='.repeat(width);

  let out = COMMANDS.INIT;
  out += COMMANDS.ALIGN_CENTER;
  out += COMMANDS.BOLD_ON + COMMANDS.DOUBLE_SIZE;
  out += '*** KITCHEN ORDER TICKET ***' + COMMANDS.LINE_FEED;
  out += COMMANDS.NORMAL;

  const tableNum = order.table_number || (order.notes && order.notes.match(/Table\s*#?(\d+)/i)?.[1]) || '';
  const orderType = (order.order_type || 'dine_in').toUpperCase();

  out += doubleSeparator + COMMANDS.LINE_FEED;
  out += COMMANDS.BOLD_ON + COMMANDS.DOUBLE_HEIGHT;
  if (tableNum) {
    out += `TABLE ${tableNum} (${orderType})` + COMMANDS.LINE_FEED;
  } else {
    out += `ORDER TYPE: ${orderType}` + COMMANDS.LINE_FEED;
  }
  out += COMMANDS.NORMAL;
  out += separator + COMMANDS.LINE_FEED;

  out += COMMANDS.ALIGN_LEFT;
  const ordNo = order.order_number ? `#${order.order_number}` : '—';
  const timeStr = new Date(order.created_at || Date.now()).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true
  });
  out += formatTwoColumns(`KOT #${ordNo}`, `Time: ${timeStr}`, width) + COMMANDS.LINE_FEED;
  if (order.customer_name) {
    out += `Guest: ${order.customer_name}`.slice(0, width) + COMMANDS.LINE_FEED;
  }
  out += separator + COMMANDS.LINE_FEED;

  // Dishes checklist with bold quantities
  out += COMMANDS.BOLD_ON;
  out += padRight('Qty', 6) + padRight('Item Description', width - 6) + COMMANDS.LINE_FEED;
  out += COMMANDS.BOLD_OFF;
  out += separator + COMMANDS.LINE_FEED;

  (items || []).forEach(item => {
    const name = item.item_name || item.name || 'Item';
    const qty = Number(item.quantity || item.qty || 1);
    const qtyStr = `[${qty}x]`;

    out += COMMANDS.BOLD_ON;
    out += padRight(qtyStr, 6) + name.slice(0, width - 6) + COMMANDS.LINE_FEED;
    out += COMMANDS.BOLD_OFF;

    if (item.notes) {
      out += `      ↳ Note: ${item.notes}`.slice(0, width) + COMMANDS.LINE_FEED;
    }
  });

  if (order.notes && !order.notes.includes('ROUND:')) {
    out += separator + COMMANDS.LINE_FEED;
    out += COMMANDS.BOLD_ON;
    out += 'SPECIAL INSTRUCTIONS:' + COMMANDS.LINE_FEED;
    out += COMMANDS.BOLD_OFF;
    wrapText(order.notes, width).forEach(l => { out += l + COMMANDS.LINE_FEED; });
  }

  out += doubleSeparator + COMMANDS.LINE_FEED;
  const feedLines = Math.max(2, parseInt(settings.kot_bottom_feed || 3, 10));
  out += COMMANDS.LINE_FEED.repeat(feedLines);
  out += (settings.kot_auto_cut === 'full' ? COMMANDS.FULL_CUT : COMMANDS.PARTIAL_CUT);

  return out;
}
