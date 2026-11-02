/**
 * =============================================================================
 * LIMRA RESTAURANT POS — THERMAL PRINTER & KOT ENGINE (pos/thermal-printer.js)
 * =============================================================================
 * 
 * Provides:
 * 1. ESC/POS binary & command stream compilation for 80mm & 58mm thermal printers.
 * 2. Visual HTML receipt, bill, and KOT template generation.
 * 3. Asynchronous printQueue dispatch with hardware confirmation.
 * 4. Resilient Print Queue modal, alert bar UI, and batch retry controller.
 */

import { posState } from './state.js';
import { showAdminToast } from './audio-alerts.js';
import { escapeHtml, consolidateOrderItems, formatDailyOrderNumber, parseNotesMetadata } from './pos-utils.js';
import { buildEscPosBill, buildEscPosKOT } from '../lib/escpos.js';
import { printQueue } from '../lib/print-queue.js';
import { insforge } from '../lib/insforge.js';

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

export let printerSettings = {
  bill_paper_width: 80,
  kot_paper_width: 80,
  feed_lines_bill: 3,
  feed_lines_kot: 2,
  auto_cut_bill: true,
  auto_cut_kot: true,
  open_cash_drawer: false
};

// Load printer settings from localStorage
if (typeof localStorage !== 'undefined') {
  try {
    const raw = localStorage.getItem('limra_printer_settings');
    if (raw) printerSettings = { ...printerSettings, ...JSON.parse(raw) };
  } catch (e) {}
}

export function getPrinterSettings() {
  return printerSettings;
}

export function savePrinterSettings(newSettings) {
  printerSettings = { ...printerSettings, ...newSettings };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('limra_printer_settings', JSON.stringify(printerSettings));
    } catch (e) {}
  }
}

// ── HTML Bill & KOT Generators ────────────────────────────────────────
export function generateReceiptHtml(order, items = null, settings = null) {
  const num = formatDailyOrderNumber(order);
  const total = Number(order.total_amount || 0).toFixed(2);
  const dateStr = new Date(order.created_at || Date.now()).toLocaleString('en-IN');
  const rawItems = Array.isArray(items) && items.length > 0
    ? items
    : posState.getOrderItemsByOrderId(order?.id);
  const consolidated = consolidateOrderItems(rawItems);

  const itemRowsHtml = consolidated.length > 0 ? consolidated.map(i => `
    <tr style="border-bottom:1px dashed #000;">
      <td style="padding:3px 0;text-align:left;font-size:11px;word-break:break-word;">${escapeHtml(i.item_name || i.name)}</td>
      <td style="padding:3px 0;text-align:center;font-size:11px;">${i.quantity || i.qty || 1}</td>
      <td style="padding:3px 0;text-align:right;padding-right:4px;font-size:11px;">₹${Number(i.unit_price || i.price || 0).toFixed(0)}</td>
      <td style="padding:3px 0;text-align:right;font-size:11px;">₹${Number(i.line_total || ((i.unit_price || i.price || 0) * (i.quantity || i.qty || 1))).toFixed(2)}</td>
    </tr>
  `).join('') : '';

  return `
    <div style="font-family:'Courier New',Courier,monospace,sans-serif;width:272px;max-width:272px;padding:0 2px;margin:0;box-sizing:border-box;">
      <h3 style="text-align:center;margin:0;font-size:14px;letter-spacing:0.5px;">LIMRA RESTAURANT</h3>
      <p style="text-align:center;margin:4px 0;font-size:11px;">Invoice #${num}</p>
      <hr style="border:none;border-top:1.5px solid #000;margin:6px 0;" />
      <p style="margin:2px 0;font-size:11px;">Date: ${dateStr}</p>
      <p style="margin:2px 0;font-size:11px;">Customer: ${escapeHtml(order.customer_name || 'Walk-in')}</p>
      <hr style="border:none;border-top:1px dashed #000;margin:6px 0;" />
      ${itemRowsHtml ? `
        <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin:4px 0;">
          <thead>
            <tr style="border-top:1.5px solid #000;border-bottom:1.5px solid #000;font-size:11px;">
              <th style="text-align:left;width:136px;">Item</th>
              <th style="text-align:center;width:28px;">Qty</th>
              <th style="text-align:right;width:44px;padding-right:4px;">Rate</th>
              <th style="text-align:right;width:60px;">Amt</th>
            </tr>
          </thead>
          <tbody>
            ${itemRowsHtml}
          </tbody>
        </table>
        <hr style="border:none;border-top:1.5px solid #000;margin:6px 0;" />
      ` : ''}
      <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:13px;margin-top:6px;border-top:1.5px solid #000;border-bottom:1.5px solid #000;padding:3px 0;">
        <span>TOTAL:</span>
        <span>₹${total}</span>
      </div>
      <p style="text-align:center;font-size:11px;margin-top:8px;">Thank You! Visit Again.</p>
    </div>
  `;
}

export async function generateKOTHtml(order = {}, items = [], options = false) {
  if (!order) order = {};
  const kotOpts = typeof options === 'boolean'
    ? { isNewOnly: options, isReprint: false, roundNumber: options ? 2 : 1 }
    : { isNewOnly: Boolean(options?.isNewOnly), isReprint: Boolean(options?.isReprint), roundNumber: Number(options?.roundNumber || 1) };

  const orderNum = formatDailyOrderNumber(order);
  const meta = parseNotesMetadata(order.notes, order);
  const tableStr = meta.tableNumber || order.table_number ? `Table ${meta.tableNumber || order.table_number}` : (order.order_type === 'table' ? 'Dine-in' : 'Takeaway / Delivery');
  const nowStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  const rawItems = Array.isArray(items) && items.length > 0 ? items : posState.getOrderItemsByOrderId(order.id);
  const consolidated = consolidateOrderItems(rawItems);

  const isReprint = Boolean(kotOpts.isReprint);
  const isMultiRound = Boolean(kotOpts.roundNumber > 1 || (meta.roundNumber && meta.roundNumber > 1));

  const itemsHtml = consolidated.map(i => `
    <tr style="border-bottom:1px dashed #000;">
      <td style="padding:4px 0;font-size:13px;font-weight:bold;">${escapeHtml(i.item_name || i.name)}</td>
      <td style="padding:4px 0;text-align:right;font-size:13px;font-weight:900;">${i.quantity || i.qty}×</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:'Courier New',monospace;padding:8px;max-width:300px;font-size:12px;">
      <div style="text-align:center;font-weight:900;font-size:14px;">KITCHEN ORDER TICKET (KOT)</div>
      ${isReprint ? '<div style="text-align:center;font-size:11px;font-weight:bold;color:#b91c1c;">— REPRINT COPY (DO NOT DUPLICATE) —</div>' : ''}
      ${isMultiRound ? `<div style="text-align:center;font-size:11px;font-weight:bold;background:#eee;">ROUND ${kotOpts.roundNumber} ADD-ON</div>` : ''}
      <hr style="border:none;border-top:1px dashed #000;margin:4px 0;" />
      <div style="display:flex;justify-content:space-between;font-weight:bold;">
        <span>Order #${orderNum}</span>
        <span>${escapeHtml(tableStr)}</span>
      </div>
      <div style="font-size:10px;color:#555;">Time: ${nowStr}</div>
      <hr style="border:none;border-top:1px dashed #000;margin:4px 0;" />
      <table style="width:100%;border-collapse:collapse;">
        ${itemsHtml}
      </table>
      ${meta.cleanNotes ? `<div style="margin-top:6px;font-size:11px;font-weight:bold;">Notes: ${escapeHtml(meta.cleanNotes)}</div>` : ''}
    </div>
  `;
}

// ── Print Queue UI & Modal Manager ────────────────────────────────────
export function initPrintQueueUI() {
  const badgeEl = $('print-queue-badge');
  const alertBar = $('adm-print-alert-bar');
  const alertMsg = $('adm-print-alert-msg');
  const alertRetryBtn = $('adm-print-alert-retry-btn');
  const alertDismissBtn = $('adm-print-alert-dismiss-btn');
  const modal = $('adm-print-queue-modal');
  const modalClose = $('print-queue-modal-close');
  const btnOpenQueue = $('btn-print-queue');
  const btnRetryAll = $('btn-queue-retry-all');
  const btnClearPrinted = $('btn-queue-clear-printed');
  const tbody = $('print-queue-tbody');
  const kpiTotal = $('queue-kpi-total');
  const kpiFailed = $('queue-kpi-failed');

  let alertDismissed = false;

  const updateQueueUI = (jobs = []) => {
    const failedJobs = jobs.filter(j => j.status === 'failed');
    const failedCount = failedJobs.length;

    if (badgeEl) {
      if (failedCount > 0) {
        badgeEl.textContent = failedCount;
        badgeEl.classList.remove('adm-hidden', 'hidden');
      } else {
        badgeEl.classList.add('adm-hidden');
      }
    }

    if (alertBar && alertMsg) {
      if (failedCount > 0 && !alertDismissed) {
        const latest = failedJobs[0];
        alertMsg.textContent = `Print failed for ${latest.type} #${latest.orderNumber} (${latest.error || 'Printer Offline'}) — Check connection & retry.`;
        alertBar.classList.remove('adm-hidden', 'hidden');
      } else {
        alertBar.classList.add('adm-hidden');
      }
    }

    if (kpiTotal) kpiTotal.textContent = `Total Jobs: ${jobs.length}`;
    if (kpiFailed) kpiFailed.textContent = `Failed: ${failedCount}`;

    if (tbody) {
      if (!jobs || jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--adm-muted);">No active or recent print jobs in queue</td></tr>';
        return;
      }

      tbody.innerHTML = jobs.map(job => {
        const isFailed = job.status === 'failed';
        const isPrinted = job.status === 'printed';
        const isPrinting = job.status === 'printing';

        let statusBadge = '<span style="color:#64748b;font-weight:700;">Pending</span>';
        if (isPrinted) {
          statusBadge = '<span style="background:#ecfdf5;color:#059669;padding:2px 8px;border-radius:4px;font-weight:800;font-size:0.75rem;">Printed ✓</span>';
        } else if (isFailed) {
          statusBadge = `<span style="background:#fef2f2;color:#ef4444;padding:2px 8px;border-radius:4px;font-weight:800;font-size:0.75rem;" title="${escapeHtml(job.error || '')}">Failed ⚠️</span>`;
        } else if (isPrinting) {
          statusBadge = '<span style="background:#fffbeb;color:#d97706;padding:2px 8px;border-radius:4px;font-weight:800;font-size:0.75rem;">Printing… ⏳</span>';
        }

        const typeBadge = `<span style="padding:2px 6px;border-radius:4px;font-size:0.75rem;font-weight:800;${job.type === 'BILL' ? 'background:#e0f2fe;color:#0369a1;' : 'background:#ede9fe;color:#6d28d9;'}">${job.type}</span>`;
        const timeStr = new Date(job.createdAt || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

        return `
          <tr style="border-bottom:1px solid var(--adm-border);">
            <td style="padding:8px 8px;font-weight:800;color:#0f172a;">#${escapeHtml(job.orderNumber)}</td>
            <td style="padding:8px 8px;">${typeBadge}</td>
            <td style="padding:8px 8px;">${statusBadge}</td>
            <td style="padding:8px 8px;color:#64748b;font-weight:600;">${job.attempts} / ${job.maxRetries || 3}</td>
            <td style="padding:8px 8px;color:#64748b;font-size:0.75rem;">${timeStr}</td>
            <td style="padding:8px 8px;text-align:right;">
              ${isFailed ? `
                <button type="button" class="adm-btn adm-btn-sm queue-retry-btn" data-job-id="${job.id}" style="background:#ef4444;color:#fff;border:none;border-radius:6px;font-weight:800;padding:2px 8px;font-size:0.75rem;">
                  🔄 Retry
                </button>
              ` : `
                <button type="button" class="adm-btn adm-btn-outline adm-btn-sm queue-reprint-btn" data-job-id="${job.id}" style="font-size:0.75rem;padding:2px 8px;">
                  Reprint
                </button>
              `}
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.queue-retry-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const jobId = btn.dataset.jobId;
          btn.disabled = true;
          btn.textContent = '⏳';
          const res = await printQueue.retry(jobId);
          if (res && res.status === 'printed') {
            showAdminToast(`Job #${res.orderNumber} printed successfully! ✅`, 'success');
          } else {
            showAdminToast(`Retry failed for #${res?.orderNumber || 'job'}: ${res?.error || 'Offline'}`, 'error');
          }
        });
      });

      tbody.querySelectorAll('.queue-reprint-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const jobId = btn.dataset.jobId;
          btn.disabled = true;
          btn.textContent = '⏳';
          const res = await printQueue.retry(jobId);
          if (res && res.status === 'printed') {
            showAdminToast(`Job #${res.orderNumber} printed successfully! ✅`, 'success');
          } else {
            showAdminToast(`Reprint failed for #${res?.orderNumber || 'job'}: ${res?.error || 'Offline'}`, 'error');
          }
        });
      });
    }
  };

  printQueue.subscribe(updateQueueUI);

  btnOpenQueue?.addEventListener('click', () => {
    if (modal) modal.style.display = 'flex';
  });

  modalClose?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  btnRetryAll?.addEventListener('click', async () => {
    showAdminToast('Retrying all failed print jobs…', 'info');
    await printQueue.retryAllFailed();
  });

  btnClearPrinted?.addEventListener('click', () => {
    printQueue.clearPrinted();
    showAdminToast('Cleared printed jobs from history.', 'info');
  });

  alertRetryBtn?.addEventListener('click', async () => {
    alertRetryBtn.disabled = true;
    alertRetryBtn.textContent = '⏳ Retrying…';
    await printQueue.retryAllFailed();
  });

  alertDismissBtn?.addEventListener('click', () => {
    alertDismissed = true;
    if (alertBar) alertBar.classList.add('adm-hidden');
  });
}

// ── Print Deduplication & Idempotency Store ──────────────────────────
const PRINTED_TOKENS_STORAGE_KEY = 'limra_printed_job_tokens';

function loadPrintedTokensFromStorage() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(PRINTED_TOKENS_STORAGE_KEY);
      if (raw) return new Set(JSON.parse(raw));
    }
  } catch (e) {}
  return new Set();
}

function persistPrintedTokensToStorage(set) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const arr = Array.from(set).slice(-150);
      sessionStorage.setItem(PRINTED_TOKENS_STORAGE_KEY, JSON.stringify(arr));
    }
  } catch (e) {}
}

const printedTokens = loadPrintedTokensFromStorage();

export function hasJobBeenPrinted(token) {
  return printedTokens.has(token);
}

export function markJobAsPrinted(token) {
  printedTokens.add(token);
  persistPrintedTokensToStorage(printedTokens);
}

export function clearPrintedJobTokens() {
  printedTokens.clear();
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(PRINTED_TOKENS_STORAGE_KEY);
    }
  } catch (e) {}
}

// ── Thermal Print Triggers ────────────────────────────────────────────
export async function printKOT(order, itemsList, options = false) {
  if (!order || !order.id) {
    showAdminToast('No order found to print KOT.', 'error');
    return null;
  }
  const kotOpts = typeof options === 'boolean'
    ? { isNewOnly: options, isReprint: false, roundNumber: options ? 2 : 1 }
    : { isNewOnly: Boolean(options?.isNewOnly), isReprint: Boolean(options?.isReprint), roundNumber: Number(options?.roundNumber || 1) };

  const dedupeKey = `kot:${order.id}:${kotOpts.roundNumber || 1}`;

  // If this is an automatic print (not manual reprint) and has already been printed, skip to prevent duplicates
  if (!kotOpts.isReprint && hasJobBeenPrinted(dedupeKey)) {
    console.log(`[Silent Print] KOT for order ${order.id} round ${kotOpts.roundNumber} already printed. Skipping duplicate.`);
    return { status: 'printed', alreadyPrinted: true, orderNumber: formatDailyOrderNumber(order) };
  }

  let items = itemsList;
  if (!items || items.length === 0) {
    items = posState.getOrderItemsByOrderId(order.id);
  }
  if ((!items || items.length === 0) && order.id) {
    try {
      const { data: dbItems } = await insforge.database.from('order_items').select('*').eq('order_id', order.id);
      if (dbItems && dbItems.length > 0) {
        items = dbItems;
        posState.addOrderItems(dbItems);
      }
    } catch (e) {
      console.warn('Could not fetch items from DB for KOT:', e);
    }
  }

  const p = printerSettings;
  const html = await generateKOTHtml(order, items, kotOpts);
  let escposText = '';
  try {
    escposText = buildEscPosKOT(order, items, p, kotOpts);
  } catch (e) {
    console.warn('[ESC/POS] Error building KOT command stream:', e);
  }

  const job = await printQueue.enqueue({
    orderId: order.id,
    orderNumber: formatDailyOrderNumber(order),
    type: 'KOT',
    paperWidth: p.kot_paper_width || 80,
    isReprint: kotOpts.isReprint,
    roundNumber: kotOpts.roundNumber,
    payload: { html, escposText, order, items }
  });

  const isSuccess = job && (job.status === 'printed' || job.status === 'hardware_confirmed' || job.status === 'spooled');
  if (isSuccess) {
    markJobAsPrinted(dedupeKey);
    const tag = kotOpts.isReprint ? ' (Reprint)' : '';
    showAdminToast(`Sent to Kitchen ✓ (KOT #${job.orderNumber}${tag})`, 'success');
  } else {
    showAdminToast(`⚠️ Print failed for KOT #${job?.orderNumber || 'Order'} (Saved to Queue)`, 'error');
  }

  return job;
}
