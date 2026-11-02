/**
 * =============================================================================
 * LIMRA RESTAURANT POS — TABLES FLOOR PLAN & BILLING (pos/tables-billing.js)
 * =============================================================================
 * 
 * Provides:
 * 1. Dining tables floor plan metrics (total_tables, table status 1..N).
 * 2. Table transfer & table swap operations (atomic RPC & local cache sync).
 * 3. Outstanding and closed bills filtering across order types.
 * 4. Floor plan modal and target state transitions.
 */

import { posState, posEvents } from './state.js';
import { escapeHtml, parseNotesMetadata } from './pos-utils.js';
import { showAdminToast } from './audio-alerts.js';
import { insforge } from '../lib/insforge.js';

let currentTransferSourceTable = null;

/**
 * Returns dynamic table count configured in printer/store settings (default: 19).
 */
export function getTotalTablesCount(settings = null) {
  const s = settings || posState.getCurrentUser();
  if (typeof localStorage !== 'undefined') {
    const fromSettings = parseInt(localStorage.getItem('qz-total-tables'), 10);
    if (!isNaN(fromSettings) && fromSettings > 0) return fromSettings;
  }
  return 19;
}

/**
 * Updates order notes with target table number and auditable transfer/swap tag.
 */
export function updateNotesTableNumber(notes = '', newTableNum, oldTableNum = null, staff = 'Staff', isSwap = false) {
  let result = String(notes || '');
  if (/\[TABLE:\s*(?:Table\s*)?\d+\]/i.test(result)) {
    result = result.replace(/\[TABLE:\s*(?:Table\s*)?\d+\]/gi, `[TABLE: Table ${newTableNum}]`);
  } else {
    result = `[TABLE: Table ${newTableNum}] ` + result;
  }
  const tag = isSwap
    ? ` [SWAPPED_FROM_TABLE_${oldTableNum || 'UNK'}_BY_${staff}]`
    : ` [TRANSFERRED_FROM_TABLE_${oldTableNum || 'UNK'}_BY_${staff}]`;
  return result + tag;
}

/**
 * Returns unpaid, active bills awaiting settlement.
 */
export function getOutstandingBills(typeFilter = 'all', orderList = null) {
  const orders = orderList || (typeof window !== 'undefined' && Array.isArray(window.orders) && window.orders.length ? window.orders : (posState.getOrders() || []));
  return orders.filter(o => {
    if (o.status === 'cancelled' || o.ticket_status === 'CANCELLED') return false;
    if (o.payment_status === 'paid' || o.ticket_status === 'CLOSED') return false;
    const isBilled = o.ticket_status === 'BILLED' || o.status === 'billed' || (o.notes && (o.notes.includes('[FINAL_BILL]') || o.notes.includes('[BILLED_UNPAID]')));
    if (!isBilled) return false;

    if (typeFilter && typeFilter !== 'all') {
      const meta = parseNotesMetadata(o.notes, o);
      const isTable = o.order_type === 'table' || meta.type === 'table' || meta.tableNumber || o.table_number;
      const isDelivery = o.order_type === 'delivery' || meta.type === 'delivery';
      const isPickup = o.order_type === 'pickup' || o.order_type === 'takeaway' || meta.type === 'pickup' || meta.type === 'takeaway';
      if (typeFilter === 'table' && !isTable) return false;
      if (typeFilter === 'delivery' && !isDelivery) return false;
      if ((typeFilter === 'pickup' || typeFilter === 'takeaway') && !isPickup) return false;
    }
    return true;
  }).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
}

export function getOutstandingTableBills(orderList = null) {
  return getOutstandingBills('table', orderList);
}

/**
 * Returns closed / paid bills for history and auditing.
 */
export function getClosedBills(typeFilter = 'all', orderList = null) {
  const orders = orderList || (typeof window !== 'undefined' && Array.isArray(window.orders) && window.orders.length ? window.orders : (posState.getOrders() || []));
  return orders.filter(o => {
    if (o.status === 'cancelled' || o.ticket_status === 'CANCELLED') return false;
    const isPaidOrClosed = o.payment_status === 'paid' || o.ticket_status === 'CLOSED' || o.status === 'delivered';
    if (!isPaidOrClosed) return false;
    if (o.payment_status === 'unpaid' && o.ticket_status === 'BILLED') return false;

    if (typeFilter && typeFilter !== 'all') {
      const meta = parseNotesMetadata(o.notes, o);
      const isTable = o.order_type === 'table' || meta.type === 'table' || meta.tableNumber || o.table_number;
      const isDelivery = o.order_type === 'delivery' || meta.type === 'delivery';
      const isPickup = o.order_type === 'pickup' || o.order_type === 'takeaway' || meta.type === 'pickup' || meta.type === 'takeaway';
      if (typeFilter === 'table' && !isTable) return false;
      if (typeFilter === 'delivery' && !isDelivery) return false;
      if ((typeFilter === 'pickup' || typeFilter === 'takeaway') && !isPickup) return false;
    }
    return true;
  }).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
}

export function getClosedTableBills(orderList = null) {
  return getClosedBills('table', orderList);
}

/**
 * Opens table transfer modal for moving active session to a free table.
 */
export function openTableTransferModal(sourceTableNum) {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('adm-table-transfer-modal');
  if (!modal) return;

  currentTransferSourceTable = sourceTableNum;
  modal.style.display = 'flex';
}

/**
 * Closes table transfer modal.
 */
export function closeTableTransferModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('adm-table-transfer-modal');
  if (modal) modal.style.display = 'none';
  currentTransferSourceTable = null;
}

/**
 * Updates UI feedback notice and enables/disables transfer vs swap buttons.
 */
export function updateTransferModalTargetState() {
  if (typeof document === 'undefined') return;
  const select = document.getElementById('table-transfer-target-select');
  const notice = document.getElementById('table-transfer-status-notice');
  const transferBtn = document.getElementById('btn-do-table-transfer');
  const swapBtn = document.getElementById('btn-do-table-swap');
  if (!select || !notice) return;

  const selectedOpt = select.selectedOptions[0];
  if (!selectedOpt) return;

  const targetState = selectedOpt.dataset.state;
  const targetNum = parseInt(select.value, 10);

  if (targetState === 'free') {
    notice.style.background = '#f0fdf4';
    notice.style.borderColor = '#bbf7d0';
    notice.style.color = '#166534';
    notice.innerHTML = `🟢 <strong>Table ${targetNum} is Free:</strong> Active orders will be transferred to Table ${targetNum}. Source Table ${currentTransferSourceTable} will become Available.`;
    if (transferBtn) {
      transferBtn.style.display = 'inline-flex';
      transferBtn.disabled = false;
    }
    if (swapBtn) swapBtn.style.display = 'none';
  } else if (targetState === 'occupied') {
    notice.style.background = '#fffbeb';
    notice.style.borderColor = '#fde68a';
    notice.style.color = '#92400e';
    notice.innerHTML = `🟡 <strong>Table ${targetNum} is currently Occupied:</strong> Direct transfer is prohibited. Click <strong>Confirm Table Swap</strong> to safely interchange Table ${currentTransferSourceTable} and Table ${targetNum} sessions.`;
    if (transferBtn) transferBtn.style.display = 'none';
    if (swapBtn) {
      swapBtn.style.display = 'inline-flex';
      swapBtn.disabled = false;
    }
  } else if (targetState === 'billed') {
    notice.style.background = '#eff6ff';
    notice.style.borderColor = '#bfdbfe';
    notice.style.color = '#1e40af';
    notice.innerHTML = `🔵 <strong>Table ${targetNum} has an Unpaid Bill:</strong> Cannot transfer or swap to Table ${targetNum} while an outstanding bill is awaiting payment. Settle the bill first.`;
    if (transferBtn) {
      transferBtn.style.display = 'inline-flex';
      transferBtn.disabled = true;
    }
    if (swapBtn) swapBtn.style.display = 'none';
  }
}

/**
 * Transfers all active orders of source table to an available target table.
 */
export async function executeTableTransfer(sourceTableNum = currentTransferSourceTable, targetTableNum = null, reason = '') {
  if (!sourceTableNum) {
    showAdminToast('Source table not specified', 'error');
    return false;
  }
  if (!targetTableNum && typeof document !== 'undefined') {
    const sel = document.getElementById('table-transfer-target-select');
    targetTableNum = sel ? parseInt(sel.value, 10) : null;
  }
  if (!targetTableNum || isNaN(targetTableNum)) {
    showAdminToast('Please select a valid target table', 'error');
    return false;
  }
  if (sourceTableNum === targetTableNum) {
    showAdminToast('Source and target tables cannot be the same', 'error');
    return false;
  }

  const staffReason = reason || '';
  const currentStaff = posState.getCurrentUser()?.name || 'Staff';

  try {
    let rpcSuccess = false;
    try {
      const { data: rpcRes, error: rpcErr } = await insforge.database.rpc('transfer_table_session_atomic', {
        p_source_table: sourceTableNum,
        p_target_table: targetTableNum,
        p_staff_name: currentStaff,
        p_reason: staffReason
      });

      if (rpcErr) {
        if (rpcErr.message && rpcErr.message.includes('TARGET_TABLE_OCCUPIED')) {
          showAdminToast(`Table ${targetTableNum} is occupied! Use Table Swap instead.`, 'error');
          return false;
        }
      } else if (rpcRes && rpcRes.success) {
        rpcSuccess = true;
      }
    } catch (rpcEx) {
      console.warn('[Table Transfer RPC Exception]:', rpcEx.message);
    }

    if (!rpcSuccess) {
      try {
        await insforge.database
          .from('orders')
          .update({
            table_number: targetTableNum,
            updated_at: new Date().toISOString()
          })
          .eq('table_number', sourceTableNum)
          .not('status', 'in', '("delivered","cancelled")')
          .not('ticket_status', 'in', '("CLOSED","CANCELLED")');
      } catch (dbErr) {
        console.warn('[Table Transfer Direct DB Warning]:', dbErr.message);
      }
    }

    const orders = posState.getOrders();
    const activeOrders = orders.filter(o => {
      if (o.status === 'delivered' || o.status === 'cancelled' || o.ticket_status === 'CLOSED' || o.ticket_status === 'CANCELLED') return false;
      const meta = parseNotesMetadata(o.notes, o);
      const tNum = parseInt(String(meta.tableNumber || o.table_number || '').replace(/\D/g, ''), 10);
      return tNum === sourceTableNum;
    });

    activeOrders.forEach(ord => {
      ord.table_number = targetTableNum;
      ord.notes = updateNotesTableNumber(ord.notes, targetTableNum, sourceTableNum, currentStaff);
      ord.updated_at = new Date().toISOString();
    });

    posState.setOrders(orders);
    showAdminToast(`Table ${sourceTableNum} successfully transferred to Table ${targetTableNum}! 🪑➡️🪑`, 'success');
    closeTableTransferModal();
    return true;
  } catch (err) {
    showAdminToast('Failed to transfer table: ' + err.message, 'error');
    return false;
  }
}

/**
 * Atomically swaps two occupied table sessions between Table A and Table B.
 */
export async function executeTableSwap(tableANum = currentTransferSourceTable, tableBNum = null, reason = '') {
  if (!tableANum) {
    showAdminToast('Source table not specified', 'error');
    return false;
  }
  if (!tableBNum && typeof document !== 'undefined') {
    const sel = document.getElementById('table-transfer-target-select');
    tableBNum = sel ? parseInt(sel.value, 10) : null;
  }
  if (!tableBNum || isNaN(tableBNum)) {
    showAdminToast('Please select a valid table to swap with', 'error');
    return false;
  }
  if (tableANum === tableBNum) {
    showAdminToast('Cannot swap a table with itself', 'error');
    return false;
  }

  const staffReason = reason || '';
  const currentStaff = posState.getCurrentUser()?.name || 'Staff';

  try {
    let rpcSuccess = false;
    try {
      const { data: rpcRes, error: rpcErr } = await insforge.database.rpc('swap_table_sessions_atomic', {
        p_table_a: tableANum,
        p_table_b: tableBNum,
        p_staff_name: currentStaff,
        p_reason: staffReason
      });

      if (rpcErr) {
        console.warn('[Table Swap RPC Warning]:', rpcErr.message);
      } else if (rpcRes && rpcRes.success) {
        rpcSuccess = true;
      }
    } catch (rpcEx) {
      console.warn('[Table Swap RPC Exception]:', rpcEx.message);
    }

    const orders = posState.getOrders();
    const activeOrdersA = orders.filter(o => {
      if (o.status === 'delivered' || o.status === 'cancelled' || o.ticket_status === 'CLOSED' || o.ticket_status === 'CANCELLED') return false;
      const meta = parseNotesMetadata(o.notes, o);
      return parseInt(String(meta.tableNumber || o.table_number || '').replace(/\D/g, ''), 10) === tableANum;
    });

    const activeOrdersB = orders.filter(o => {
      if (o.status === 'delivered' || o.status === 'cancelled' || o.ticket_status === 'CLOSED' || o.ticket_status === 'CANCELLED') return false;
      const meta = parseNotesMetadata(o.notes, o);
      return parseInt(String(meta.tableNumber || o.table_number || '').replace(/\D/g, ''), 10) === tableBNum;
    });

    activeOrdersA.forEach(ord => {
      ord.table_number = tableBNum;
      ord.notes = updateNotesTableNumber(ord.notes, tableBNum, tableANum, currentStaff, true);
      ord.updated_at = new Date().toISOString();
    });

    activeOrdersB.forEach(ord => {
      ord.table_number = tableANum;
      ord.notes = updateNotesTableNumber(ord.notes, tableANum, tableBNum, currentStaff, true);
      ord.updated_at = new Date().toISOString();
    });

    posState.setOrders(orders);
    showAdminToast(`Table ${tableANum} and Table ${tableBNum} successfully swapped! 🔄🪑`, 'success');
    closeTableTransferModal();
    return true;
  } catch (err) {
    showAdminToast('Failed to swap tables: ' + err.message, 'error');
    return false;
  }
}
