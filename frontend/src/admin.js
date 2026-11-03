import './style.css';
import './admin.css';
import { Chart, registerables } from 'chart.js';
import { insforge, getMenuOverrides, saveMenuOverride, uploadDishPhotoToStorage, getCoupons, saveCoupon, deleteCoupon, redeemCoupon, getCombos, saveCombo, deleteCombo, getCustomDishes, saveCustomDish, deleteCustomDish, getDeliveryAreas, getCustomerOrders, invalidateRefCache, offlineSync, POS_MUTATION_TYPES, ERROR_TYPES, classifyError } from './lib/insforge.js';
import { compressDishImage, formatFileSize, COMPRESSION_LIMITS } from './lib/image-optimizer.js';
import { PaymentService } from './lib/payments.js';
import { menuItems, categoryImages, categoryLabels, categoryEmojis, categoryTabOrder } from './data/menu.js';
import { getAdminLoginUrl } from './lib/admin-routes.js';
import { sendEmailNotification, generateOrderConfirmedHtml, generateOrderCancelledHtml } from './lib/email-service.js';
import QRCode from 'qrcode';
import { LIMRA_LOGO_BASE64 } from './lib/logo-data.js';
import { printQueue } from './lib/print-queue.js';
import { buildEscPosBill, buildEscPosKOT, COMMANDS as ESC_COMMANDS } from './lib/escpos.js';
import { calculateOrderBilling, parseNotesBillingMetadata, isValidPaymentTransition, isValidFulfillmentTransition, isValidTicketTransition, formatRupee, formatBillAmount } from './lib/billing-engine.js';
import { initStockSummarySection } from './admin-stock.js';
import { initSalesReportHub, loadSalesReportData } from './sales-report/sales-report.js';
import { posState, posEvents } from './pos/state.js';
import {
  notifiedBusinessOrderIds,
  cashierCreatedOrderIds,
  getAudioCtx,
  warmUpAudio,
  initAudioUnlockListeners,
  isVoiceAnnouncementEnabled,
  setVoiceAnnouncementEnabled,
  speakTableRoundAnnouncement,
  generateTableRoundChimeWavUri,
  getTableRoundFallbackAudioElement,
  playTableRoundChime,
  playNotificationChime,
  testNotificationSound,
  testTableRoundSound,
  initToastContainer,
  showAdminToast,
  showBusinessNotification,
  showDashboardToast,
  setNotificationNavigationHandler
} from './pos/audio-alerts.js';
import * as posDomainKds from './pos/kds.js';
import * as posDomainReportsGst from './pos/reports-gst.js';
import * as posDomainPrinter from './pos/thermal-printer.js';
import * as posDomainCatalogCrm from './pos/catalog-crm.js';
import * as posDomainSettingsStaff from './pos/settings-staff.js';
import * as posDomainWorkstation from './pos/workstation.js';
import * as posDomainTablesBilling from './pos/tables-billing.js';
import * as posUtils from './pos/pos-utils.js';

// Category aliases to support group categories, legacy keys, and multi-category filters in Admin
export const categoryAliases = {
  // Combos & Deals
  'combo': ['combo'],
  'combos': ['combo'],
  'deals': ['combo'],

  // Tandoor & Kabab
  'tandoori': ['tandoor-kabab'],
  'tandoor': ['tandoor-kabab'],
  'kababs': ['tandoor-kabab'],
  'kebab': ['tandoor-kabab'],
  'kebabs': ['tandoor-kabab'],
  'tandoor-kabab': ['tandoor-kabab'],
  
  // Chinese & Noodles
  'chinese': ['chinese-veg', 'chinese-nonveg', 'noodles'],
  'chinese-veg': ['chinese-veg'],
  'chinese-nonveg': ['chinese-nonveg'],
  'noodles': ['noodles'],
  'noodle': ['noodles'],
  
  // Fried Rice & Rice
  'rice': ['veg-rice', 'nonveg-rice'],
  'fried-rice': ['veg-rice', 'nonveg-rice'],
  'veg-rice': ['veg-rice'],
  'nonveg-rice': ['nonveg-rice'],
  
  // Curries / Gravies
  'curries': ['veg-curry', 'nonveg-curry'],
  'curry': ['veg-curry', 'nonveg-curry'],
  'gravy': ['veg-curry', 'nonveg-curry'],
  'gravies': ['veg-curry', 'nonveg-curry'],
  'veg-curry': ['veg-curry'],
  'nonveg-curry': ['nonveg-curry'],
  
  // Starters
  'starters': ['veg-starters', 'nonveg-starters'],
  'starter': ['veg-starters', 'nonveg-starters'],
  'veg-starters': ['veg-starters'],
  'nonveg-starters': ['nonveg-starters'],
  
  // Soups
  'soups': ['soup'],
  'soup': ['soup'],
  
  // Breads / Naan & Roti
  'breads': ['bread'],
  'bread': ['bread'],
  'naan': ['bread'],
  'roti': ['bread'],
  
  // Biryani
  'biryani': ['biryani'],
  
  // Thali
  'thali': ['thali'],
  
  // Desserts
  'dessert': ['desserts'],
  'desserts': ['desserts'],
  'sweets': ['desserts'],
  
  // Salads & Papad
  'salads': ['salads'],
  'salad': ['salads'],
  
  // Momos & Chaat
  'momos': ['momos-chaat'],
  'chaat': ['momos-chaat'],
  'momos-chaat': ['momos-chaat'],
  
  // Beverages & Drinks
  'drinks': ['juices', 'lassi', 'milkshakes', 'mocktails', 'beverages'],
  'beverages': ['beverages'],
  'juices': ['juices'],
  'lassi': ['lassi'],
  'milkshakes': ['milkshakes'],
  'mocktails': ['mocktails']
};

Chart.register(...registerables);

// ═══════════════════════════════════════
// ═══════════════════════════════════════
// AUDIO CONTEXT & NOTIFICATION CHIME (Extracted to pos/audio-alerts.js)
// ═══════════════════════════════════════

// Initialize audio unlock listeners
initAudioUnlockListeners();


// ═══════════════════════════════════════
// GLOBAL STATE & CONSTANTS
// ═══════════════════════════════════════

const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled', 'hold', 'merged'];
const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_LABEL = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  hold: 'Hold',
  merged: 'Merged'
};

let orders = [];
let orderItems = [];
let bookings = [];
let adminPlaces = [];
let dashboardMap = null;
let dashboardMarkersGroup = null;
let activeMapFilter = 'all';
let currentUser = null;
let selectedOrderId = null;
let ordersPage = 1;
let activeOrderTypeFilter = 'all';
const ORDERS_PER_PAGE = 10;
const charts = {};

const knownNotificationIds = new Set();
const knownOrderIds = new Set();
let activeNotifications = [];
let quickAdjusterInitialized = false;

// ═══════════════════════════════════════
// REAL-TIME NOTIFICATION STATE & CHIME
// ═══════════════════════════════════════

// Automatically mark all notification records for an order as read in memory and database
async function markOrderNotificationsRead(orderId) {
  if (!orderId) return;
  const strId = String(orderId);
  try {
    // 1. Update in-memory notifications
    let countUpdated = 0;
    activeNotifications.forEach(n => {
      if (String(n.item_id) === strId || String(n.order_id) === strId) {
        n.is_read = true;
        countUpdated++;
      }
    });
    if (countUpdated > 0) {
      renderNotifications();
    }

    // 2. Update DB records
    await insforge.database
      .from('notifications')
      .update({ is_read: true })
      .or(`item_id.eq.${strId},order_id.eq.${strId}`);
  } catch (err) {
    console.warn('[Admin] Failed to mark order notifications as read:', err);
  }
}

window.markOrderNotificationsRead = markOrderNotificationsRead;

function renderNotifications() {
  const dot = $('notification-dot');
  const list = $('notification-items');
  if (!list) return;
  
  const notifs = activeNotifications || [];
  const unreadCount = notifs.filter(n => !n.is_read).length;

  if (dot) {
    if (unreadCount > 0) {
      dot.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      show(dot);
    } else {
      hide(dot);
    }
  }
  
  if (notifs.length === 0) {
    list.innerHTML = '<p class="adm-dropdown-empty">No new notifications</p>';
    return;
  }
  
  list.innerHTML = notifs.map(n => {
    const isOrder = n.type === 'order' || n.type === 'order_status';
    const isWaiter = n.type === 'call_waiter';
    const isBill = n.type === 'request_bill';
    const icon = isOrder ? '🍽️' : (isWaiter ? '🔔' : (isBill ? '🧾' : (n.type === 'booking' ? '📅' : '⚡')));
    const timeStr = n.created_at ? new Date(n.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';
    const isUnread = !n.is_read;

    // Look up linked order status or service badge if applicable
    let statusChip = '';
    if (isWaiter) {
      statusChip = '<span style="font-size:0.75rem;padding:1px 6px;border-radius:999px;background:#ecfdf5;color:#047857;font-weight:700;">🔔 Waiter</span>';
    } else if (isBill) {
      statusChip = '<span style="font-size:0.75rem;padding:1px 6px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-weight:700;">🧾 Bill</span>';
    }
    const targetId = n.item_id || n.order_id;
    if (targetId && isOrder) {
      const ord = orders.find(o => String(o.id) === String(targetId));
      if (ord) {
        if (ord.status === 'delivered' || ord.status === 'completed' || ord.status === 'closed' || ord.payment_status === 'paid') {
          statusChip = '<span style="font-size:0.75rem;padding:1px 6px;border-radius:999px;background:#ecfdf5;color:#059669;font-weight:700;">✓ Settled</span>';
        } else if (ord.status === 'cancelled') {
          statusChip = '<span style="font-size:0.75rem;padding:1px 6px;border-radius:999px;background:#fef2f2;color:#dc2626;font-weight:700;">✕ Cancelled</span>';
        } else if (ord.status === 'hold') {
          statusChip = '<span style="font-size:0.75rem;padding:1px 6px;border-radius:999px;background:#fffbeb;color:#d97706;font-weight:700;">⏸️ Hold</span>';
        } else {
          statusChip = '<span style="font-size:0.75rem;padding:1px 6px;border-radius:999px;background:#eef2ff;color:#4f46e5;font-weight:700;">● Active</span>';
        }
      }
    }

    return `
      <div class="adm-notification-item ${isUnread ? 'unread' : ''}" data-item-id="${targetId || ''}" data-type="${n.type}" data-notif-id="${n.id}">
        <div class="adm-notification-icon">${icon}</div>
        <div class="adm-notification-body">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.25rem;">
            <p class="adm-notification-title" style="margin:0;font-weight:${isUnread ? '800' : '600'};">${escapeHtml(n.title || 'Notification')}</p>
            ${statusChip}
          </div>
          <p class="adm-notification-desc" style="margin:2px 0 0 0;font-size:0.75rem;color:${isUnread ? '#334155' : 'var(--adm-muted)'};">${escapeHtml(n.message || n.description || '')}</p>
          <p class="adm-notification-time" style="margin:2px 0 0 0;font-size:0.75rem;color:var(--adm-muted);">${timeStr}</p>
        </div>
        <button type="button" class="adm-notif-dismiss" data-dismiss-id="${n.id}" title="Mark as read">✕</button>
      </div>
    `;
  }).join('');
  
  // Wire dismiss button clicks
  list.querySelectorAll('.adm-notif-dismiss').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const notifId = String(btn.dataset.dismissId);
      try {
        await insforge.database.from('notifications').update({ is_read: true }).eq('id', notifId);
        const match = activeNotifications.find(x => String(x.id) === notifId);
        if (match) match.is_read = true;
        renderNotifications();
      } catch (err) {
        console.warn('Failed to dismiss notification:', err);
      }
    });
  });

  // Wire notification item row clicks
  list.querySelectorAll('.adm-notification-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.classList.contains('adm-notif-dismiss')) return;
      const type = el.dataset.type;
      const itemId = el.dataset.itemId;
      const notifId = String(el.dataset.notifId);
      
      try {
        await insforge.database.from('notifications').update({ is_read: true }).eq('id', notifId);
        const match = activeNotifications.find(x => String(x.id) === notifId);
        if (match) match.is_read = true;
        renderNotifications();
      } catch (err) {
        console.warn('Failed to mark notification read:', err);
      }
      
      hide($('notification-dropdown'));
      
      if ((type === 'order' || type === 'order_status') && itemId) {
        selectedOrderId = itemId;
        switchPanel('orders');
        renderOrderDetail(itemId);
      } else if (type === 'booking') {
        switchPanel('bookings');
        $('bookings-list')?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

// ── STRICT POS NOTIFICATION SYSTEM: DEDUPLICATION & ROUTING (pos/audio-alerts.js) ──
setNotificationNavigationHandler((payload) => {
  if (payload.type === 'website') {
    if (payload.orderId) {
      selectedOrderId = payload.orderId;
      switchPanel('orders');
      renderOrderDetail(payload.orderId);
    }
  } else {
    if (typeof window !== 'undefined' && typeof window.tablesSubtab !== 'undefined') window.tablesSubtab = 'all';
    tablesSubtab = 'all';
    switchPanel('tables');
    renderTablesPanel();
    if (payload.orderId) {
      selectedOrderId = payload.orderId;
      renderOrderDetail(payload.orderId);
    }
  }
});

// Expose on window for runtime testing and inspection
if (typeof window !== 'undefined') {
  window.warmUpAudio = warmUpAudio;
  window.isVoiceAnnouncementEnabled = isVoiceAnnouncementEnabled;
  window.setVoiceAnnouncementEnabled = setVoiceAnnouncementEnabled;
  window.testTableRoundSound = testTableRoundSound;
  window.testNotificationSound = testNotificationSound;
  window.notifiedBusinessOrderIds = notifiedBusinessOrderIds;
  window.cashierCreatedOrderIds = cashierCreatedOrderIds;
  window.showAdminToast = showAdminToast;
  window.showBusinessNotification = showBusinessNotification;
}

const $ = id => document.getElementById(id);
const show = el => { if (el) { el.classList.remove('adm-hidden', 'hidden'); } };
const hide = el => { if (el) { el.classList.add('adm-hidden'); } };

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseNotesMetadata(notes, order = null) {
  const result = {
    email: '',
    type: 'pickup',
    address: '',
    area: '',
    distance: '',
    charge: '',
    deliveryFee: 0,
    discountPct: 0,
    discountAmt: 0,
    couponCode: '',
    cgstRate: null,
    sgstRate: null,
    payment: '',
    paymentStatus: '',
    customNote: '',
    tableNumber: '',
    roundNumber: null,
    parentOrderId: null
  };
  
  if (order) {
    if (order.order_type === 'table') {
      result.type = 'table';
      result.tableNumber = String(order.table_number || '');
    } else if (order.order_type === 'delivery') {
      result.type = 'delivery';
    } else if (order.order_type === 'pickup') {
      result.type = 'pickup';
    }
    if (order.delivery_fee !== undefined && order.delivery_fee !== null) {
      const oFee = Number(order.delivery_fee);
      if (!isNaN(oFee) && oFee >= 0) result.deliveryFee = oFee;
    }
    if (order.discount_pct !== undefined && order.discount_pct !== null) {
      const dPct = Number(order.discount_pct);
      if (!isNaN(dPct) && dPct >= 0) result.discountPct = dPct;
    }
    if (order.discount_amount !== undefined && order.discount_amount !== null) {
      const dAmt = Number(order.discount_amount);
      if (!isNaN(dAmt) && dAmt >= 0) result.discountAmt = dAmt;
    }
    if (order.consolidated_into_order_id) {
      result.parentOrderId = String(order.consolidated_into_order_id);
    }
    if (order.settled_at) {
      result.settledAt = String(order.settled_at);
    }
  }
  
  if (!notes) return result;
  
  const emailMatch = notes.match(/\[EMAIL:\s*([^\]|]+)\]/i);
  if (emailMatch) {
    result.email = emailMatch[1].trim();
  }
  
  const roundMatch = notes.match(/\[ROUND:\s*(\d+)\]/i);
  if (roundMatch) {
    result.roundNumber = parseInt(roundMatch[1], 10);
  }

  const parentMatch = notes.match(/\[PARENT_ORDER_ID:\s*([^\]|]+)\]/i);
  if (parentMatch) {
    result.parentOrderId = parentMatch[1].trim();
  }

  const tableMatch = notes.match(/\[TABLE:\s*([^\]|]+)\]/i);
  if (tableMatch) {
    result.tableNumber = tableMatch[1].trim();
    result.type = 'table';
  } else if (notes.includes('[DELIVERY]')) {
    result.type = 'delivery';
  } else if (notes.includes('[SELF PICKUP]')) {
    result.type = 'pickup';
  }
  
  if (result.type === 'delivery') {
    const addrMatch = notes.match(/Address:\s*([^|\]]+)/i);
    const areaMatch = notes.match(/(?:Selected Area|Place):\s*([^|\]]+)/i);
    const distMatch = notes.match(/Distance:\s*([^|\]]+)/i);
    const chargeMatch = notes.match(/Delivery\s+(?:charge|fee):\s*([^|\]]+)/i);
    
    if (addrMatch) result.address = addrMatch[1].trim();
    if (areaMatch && areaMatch[1].trim() !== 'N/A') result.area = areaMatch[1].trim();
    if (distMatch) result.distance = distMatch[1].trim();
    if (chargeMatch) {
      result.charge = chargeMatch[1].trim();
      const parsedNum = parseFloat(result.charge.replace(/[^0-9.]/g, ''));
      if (!isNaN(parsedNum) && parsedNum >= 0) result.deliveryFee = parsedNum;
    }
  }

  const deliveryFeeMatch = notes.match(/\[(?:DELIVERY_FEE|DELIVERY_CHARGE):\s*([^\]|]+)\]/i);
  if (deliveryFeeMatch) {
    const dNum = parseFloat(deliveryFeeMatch[1].replace(/[^0-9.]/g, ''));
    if (!isNaN(dNum) && dNum >= 0) result.deliveryFee = dNum;
  }

  const couponMatch = notes.match(/\[COUPON:\s*([^\]|]+)\]/i);
  if (couponMatch) {
    result.couponCode = couponMatch[1].trim().toUpperCase();
  }

  const discPctMatch = notes.match(/\[(?:DISCOUNT_PCT|DISCOUNT):\s*([^\]|%]+)%?\]/i);
  if (discPctMatch) {
    const pNum = parseFloat(discPctMatch[1]);
    if (!isNaN(pNum)) result.discountPct = pNum;
  }

  const discAmtMatch = notes.match(/\[DISCOUNT_AMT:\s*([^\]|]+)\]/i);
  if (discAmtMatch) {
    const aNum = parseFloat(discAmtMatch[1].replace(/[^0-9.]/g, ''));
    if (!isNaN(aNum)) result.discountAmt = aNum;
  }

  const cgstMatch = notes.match(/\[CGST:\s*([^\]|%]+)%?\]/i);
  if (cgstMatch) {
    const cNum = parseFloat(cgstMatch[1]);
    if (!isNaN(cNum)) result.cgstRate = cNum;
  }

  const sgstMatch = notes.match(/\[SGST:\s*([^\]|%]+)%?\]/i);
  if (sgstMatch) {
    const sNum = parseFloat(sgstMatch[1]);
    if (!isNaN(sNum)) result.sgstRate = sNum;
  }
  
  const paymentMatch = notes.match(/\[PAYMENT:\s*([^\]|]+)\]/i);
  if (paymentMatch) {
    result.payment = paymentMatch[1].trim();
  }
  const statusMatch = notes.match(/\[PAYMENT_STATUS:\s*([^\]|]+)\]/i);
  if (statusMatch) {
    result.paymentStatus = statusMatch[1].trim();
  }
  result.paymentMode = result.payment || (order ? (order.payment_method || order.payment_mode) : '') || 'cash';
  
  let cleanNote = notes
    .replace(/\[EMAIL:[^\]]+\]/gi, '')
    .replace(/\[ROUND:[^\]]+\]/gi, '')
    .replace(/\[PARENT_ORDER_ID:[^\]]+\]/gi, '')
    .replace(/\[TABLE:[^\]]+\]/gi, '')
    .replace(/\[DELIVERY\]\s*Place:[^|]+/gi, '')
    .replace(/\[DELIVERY\]\s*Address:[^|]+/gi, '')
    .replace(/Address:[^|]+/gi, '')
    .replace(/Selected Area:[^|]+/gi, '')
    .replace(/Distance:[^|]+/gi, '')
    .replace(/Delivery charge:[^|]+/gi, '')
    .replace(/\[DELIVERY_FEE:[^\]]+\]/gi, '')
    .replace(/\[COUPON:[^\]]+\]/gi, '')
    .replace(/\[(?:DISCOUNT_PCT|DISCOUNT):[^\]]+\]/gi, '')
    .replace(/\[DISCOUNT_AMT:[^\]]+\]/gi, '')
    .replace(/\[CGST:[^\]]+\]/gi, '')
    .replace(/\[SGST:[^\]]+\]/gi, '')
    .replace(/\[SELF PICKUP\]/gi, '')
    .replace(/\[PAYMENT:[^\]]+\]/gi, '')
    .replace(/\[PAYMENT_STATUS:[^\]]+\]/gi, '')
    .replace(/\|/g, '')
    .replace(/\s+/g, ' ')
    .trim();
    
  result.customNote = cleanNote;

  if (order) {
    if (order.discount_pct !== undefined && order.discount_pct !== null && Number(order.discount_pct) > 0) {
      result.discountPct = Number(order.discount_pct);
    }
    if (order.discount_amount !== undefined && order.discount_amount !== null && Number(order.discount_amount) > 0) {
      result.discountAmt = Number(order.discount_amount);
    }
    if (order.delivery_fee !== undefined && order.delivery_fee !== null && Number(order.delivery_fee) > 0) {
      result.deliveryFee = Number(order.delivery_fee);
    }
    if (order.consolidated_into_order_id) {
      result.parentOrderId = String(order.consolidated_into_order_id);
    }
    if (order.settled_at) {
      result.settledAt = String(order.settled_at);
    }
  }

  return result;
}

function getOrderRoundInfo(order, allOrders = orders) {
  if (!order) return { isTable: false, roundNumber: 1, isRound: false, label: '' };
  const meta = parseNotesMetadata(order.notes, order);
  const isTable = meta.type === 'table' || order.order_type === 'table' || Boolean(meta.tableNumber || order.table_number);
  if (!isTable) {
    return { isTable: false, roundNumber: 1, isRound: false, label: '' };
  }

  if (meta.roundNumber && meta.roundNumber > 0) {
    return {
      isTable: true,
      roundNumber: meta.roundNumber,
      isRound: meta.roundNumber > 1,
      label: `Round ${meta.roundNumber}`
    };
  }

  // Fallback: Compute chronological round number among active/same-day orders for this table
  const tNum = parseInt(String(meta.tableNumber || order.table_number || '').replace(/\D/g, ''), 10);
  if (!tNum || !Array.isArray(allOrders) || allOrders.length === 0) {
    return { isTable: true, roundNumber: 1, isRound: false, label: 'Round 1' };
  }

  const orderTime = new Date(order.created_at || Date.now()).getTime();
  const sessionWindow = 12 * 3600 * 1000;
  const tableSessionOrders = allOrders
    .filter(o => {
      const oMeta = parseNotesMetadata(o.notes, o);
      const oTNum = parseInt(String(oMeta.tableNumber || o.table_number || '').replace(/\D/g, ''), 10);
      if (oTNum !== tNum) return false;
      const oTime = new Date(o.created_at || Date.now()).getTime();
      return Math.abs(orderTime - oTime) <= sessionWindow;
    })
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

  const idx = tableSessionOrders.findIndex(o => o.id === order.id);
  const roundNum = idx !== -1 ? (idx + 1) : 1;
  return {
    isTable: true,
    roundNumber: roundNum,
    isRound: roundNum > 1,
    label: `Round ${roundNum}`
  };
}

function fmtDate(d) {
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

function fmtDateShort(d) {
  if (!d) return '—';
  try {
    const dateObj = d instanceof Date ? d : new Date(d);
    if (isNaN(dateObj.getTime())) return '—';
    return dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (e) {
    return '—';
  }
}

function formatDateTime(d) {
  return fmtDate(d);
}
window.formatDateTime = formatDateTime;

function fmtMoney(n) {
  return formatBillAmount(n);
}

function formatDailyOrderNumber(order, allOrders = orders) {
  if (!order && order !== 0) return '01';

  // If order is a primitive number or string
  if (typeof order === 'number' || typeof order === 'string') {
    const num = parseInt(order, 10);
    if (!isNaN(num)) {
      return num < 10 && num > 0 ? `0${num}` : `${num}`;
    }
    return String(order);
  }

  // 1. Direct explicit order_number check (prioritize authentic order number)
  const rawNum = parseInt(order.order_number, 10);
  if (!isNaN(rawNum) && rawNum > 0) {
    return rawNum < 10 ? `0${rawNum}` : `${rawNum}`;
  }

  // 2. If this order is a child/subsequent round with a parentOrderId, find the parent's order number
  if (order.notes && Array.isArray(allOrders)) {
    const meta = parseNotesMetadata(order.notes, order);
    if (meta.parentOrderId) {
      const parentOrder = allOrders.find(o => o.id === meta.parentOrderId);
      if (parentOrder && parentOrder.id !== order.id) {
        return formatDailyOrderNumber(parentOrder, allOrders);
      }
    }
  }

  // 3. Daily sequence index fallback within that specific day
  if (order.created_at && Array.isArray(allOrders) && allOrders.length > 0) {
    const orderDate = new Date(order.created_at).toISOString().slice(0, 10);
    const dayOrders = allOrders
      .filter(o => o.created_at && new Date(o.created_at).toISOString().slice(0, 10) === orderDate)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const idx = dayOrders.findIndex(o => o.id === order.id);
    if (idx !== -1) {
      const dailySeq = idx + 1;
      return dailySeq < 10 ? `0${dailySeq}` : `${dailySeq}`;
    }
  }

  return '01';
}

function getTodayDailyOrderNumber(allOrders = orders) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayOrders = (allOrders || []).filter(o => {
    if (!o.created_at) return false;
    const d = new Date(o.created_at).toISOString().slice(0, 10);
    return d === todayStr;
  });
  return todayOrders.length + 1;
}

function statusPill(status, isTable = false) {
  const cls = status === 'pending' ? 'new' : status;
  let label = STATUS_LABEL[status] || status;
  if (isTable) {
    if (status === 'ready') label = 'Served';
    else if (status === 'delivered') label = 'Completed';
    else if (status === 'preparing') label = 'Preparing';
    else if (status === 'pending') label = 'Pending';
    else if (status === 'hold') label = 'On Hold';
    else if (status === 'merged') label = 'Merged (Hold)';
  }
  return `<span class="adm-pill ${cls}">${label}</span>`;
}

function paymentStatusPill(status) {
  const s = String(status || 'unpaid').toLowerCase();
  if (s === 'paid' || s === 'completed') {
    return `<span class="adm-pill completed" style="text-transform: uppercase;">PAID</span>`;
  }
  return `<span class="adm-pill cancelled" style="text-transform: uppercase;">UNPAID</span>`;
}

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    delete charts[key];
  }
}

function isFoodDishItem(i) {
  if (!i) return false;
  const name = (i.item_name || i.name || '').toLowerCase();
  if (/^gst\b|^tax\b|^cgst\b|^sgst\b|^delivery\s*charge|^delivery\s*fee|^promo\s*discount|^discount\b/i.test(name)) return false;
  if ([9997, 9998, 9999].includes(Number(i.id || i.menu_item_id))) return false;
  return true;
}

function getItemsForOrder(orderId) {
  if (!orderId) return [];
  const primaryItems = orderItems.filter(i => String(i.order_id) === String(orderId) && isFoodDishItem(i));
  const targetOrder = orders.find(o => String(o.id) === String(orderId));
  if (!targetOrder) return primaryItems;

  // If this order object has explicit sibling_order_ids from consolidation
  if (targetOrder.sibling_order_ids && targetOrder.sibling_order_ids.length > 0) {
    const siblingIds = new Set(targetOrder.sibling_order_ids.map(id => String(id)));
    const siblingItems = orderItems.filter(i => siblingIds.has(String(i.order_id)) && isFoodDishItem(i));
    return [...primaryItems, ...siblingItems];
  }

  // If primaryItems already has dishes and covers the order total, return primaryItems directly
  const primarySub = primaryItems.reduce((s, i) => s + Number(i.line_total || ((i.unit_price || 0) * (i.quantity || 1))), 0);
  const orderTot = Number(targetOrder.total_amount || 0);
  if (primarySub > 0 && orderTot > 0 && Math.abs(primarySub * 1.05 - orderTot) < 25) {
    return primaryItems;
  }

  // If primaryItems is empty, check if sibling KOTs explicitly listed in notes have the items
  const parsed = parseNotesMetadata(targetOrder.notes, targetOrder);
  const tableNum = parsed.tableNumber || targetOrder.table_number;
  const isTable = parsed.type === 'table' || targetOrder.order_type === 'table' || Boolean(tableNum);

  if (isTable && targetOrder.notes && (targetOrder.notes.includes('[FINAL_BILL]') || targetOrder.notes.includes('[KOTS:')) && primaryItems.length === 0) {
    const kotsMatch = targetOrder.notes.match(/\[KOTS:\s*([^\]]+)\]/i);
    if (kotsMatch) {
      const parts = kotsMatch[1].split(/[\s+,#]+/).filter(Boolean);
      const kotNums = new Set(parts.map(p => parseInt(p, 10)).filter(n => !isNaN(n)));
      const siblingOrders = orders.filter(s => {
        if (String(s.id) === String(orderId)) return false;
        if (s.status === 'cancelled') return false;
        const sNum = parseInt(s.order_number, 10);
        return kotNums.has(sNum);
      });
      if (siblingOrders.length > 0) {
        const siblingIds = new Set(siblingOrders.map(s => String(s.id)));
        const siblingItems = orderItems.filter(i => siblingIds.has(String(i.order_id)) && isFoodDishItem(i));
        return [...primaryItems, ...siblingItems];
      }
    }
  }

  return primaryItems;
}

function parseItemNameAndNotes(rawName) {
  if (!rawName) return { name: '', notes: '' };
  const str = String(rawName).trim();
  const match = str.match(/^(.*?)\s*\[Note:\s*(.*?)\]\s*$/i);
  if (match) {
    return { name: match[1].trim(), notes: match[2].trim() };
  }
  return { name: str, notes: '' };
}

function consolidateOrderItems(items) {
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

/**
 * Standard Restaurant GST Tax Computation Engine
 * Computes exact Food Subtotal, Taxable Value, CGST @ 2.5%, SGST @ 2.5%, Total GST @ 5%, Delivery Charges, and Final Grand Total
 * Triggers on final consolidated bill records.
 */
function computeOrderTaxDetails(order, optionalItemsList) {
  if (!order) {
    return {
      items: [],
      itemCount: 0,
      subtotal: 0,
      discountPct: 0,
      discountAmt: 0,
      taxableValue: 0,
      cgstRate: 2.5,
      cgstAmt: 0,
      sgstRate: 2.5,
      sgstAmt: 0,
      totalGstRate: 5.0,
      totalGst: 0,
      deliveryFee: 0,
      grandTotal: 0
    };
  }

  const rawItems = optionalItemsList || getItemsForOrder(order.id);
  const items = consolidateOrderItems(rawItems.filter(isFoodDishItem));

  // 1. Structured Column Fast Path:
  // If order contains normalized financial breakdown columns, return exact stored values directly.
  // This eliminates tax rate drift and preserves historical audit veracity even if restaurant tax settings change.
  const hasStructuredFinancials = (
    order.taxable_amount !== undefined &&
    order.taxable_amount !== null &&
    (Number(order.taxable_amount) > 0 || Number(order.subtotal_amount) > 0)
  );

  if (hasStructuredFinancials) {
    const subtotal = Number(order.subtotal_amount) || 0;
    const discountPct = Number(order.discount_pct) || 0;
    const discountAmt = Number(order.discount_amount) || 0;
    const taxableValue = Number(order.taxable_amount) || 0;
    const cgstAmt = Number(order.cgst_amount) || 0;
    const sgstAmt = Number(order.sgst_amount) || 0;
    const totalGst = Math.round((cgstAmt + sgstAmt) * 100) / 100;
    const deliveryFee = Number(order.delivery_fee) || 0;
    const packagingFee = Number(order.packaging_fee) || 0;
    const grandTotal = Math.floor(Math.max(0, Number(order.total_amount) || 0));
    const roundOff = (order.round_off_amount !== undefined && order.round_off_amount !== null)
      ? Number(order.round_off_amount)
      : Math.round((grandTotal - (taxableValue + totalGst + deliveryFee + packagingFee)) * 100) / 100;

    const derivedCgstRate = taxableValue > 0 ? Math.round((cgstAmt / taxableValue) * 1000) / 10 : 2.5;
    const derivedSgstRate = taxableValue > 0 ? Math.round((sgstAmt / taxableValue) * 1000) / 10 : 2.5;

    return {
      items,
      itemCount: items.reduce((sum, i) => sum + Number(i.quantity || i.qty || 1), 0),
      subtotal,
      discountPct,
      discountAmt,
      taxableValue,
      cgstRate: derivedCgstRate,
      cgstAmt,
      sgstRate: derivedSgstRate,
      sgstAmt,
      totalGstRate: Math.round((derivedCgstRate + derivedSgstRate) * 10) / 10,
      totalGst,
      deliveryFee,
      packagingFee,
      grandTotal,
      roundOff
    };
  }

  const s = getBillSettings();
  const parsed = parseNotesMetadata(order.notes, order);
  const billingMeta = parseNotesBillingMetadata(order.notes);

  const cgstRate = billingMeta.cgstRate ?? parsed.cgstRate ?? (s.cgstRate ?? 2.5);
  const sgstRate = billingMeta.sgstRate ?? parsed.sgstRate ?? (s.sgstRate ?? 2.5);
  const isInterstate = billingMeta.isInterstate || false;

  const isDelivery = parsed.type === 'delivery' || order.order_type === 'delivery';
  let deliveryFee = 0;
  if (isDelivery) {
    if (order.delivery_fee !== undefined && order.delivery_fee !== null && !isNaN(Number(order.delivery_fee))) {
      deliveryFee = Math.max(0, Number(order.delivery_fee));
    } else if (billingMeta.deliveryFee !== undefined && billingMeta.deliveryFee !== null && !isNaN(Number(billingMeta.deliveryFee))) {
      deliveryFee = Math.max(0, Number(billingMeta.deliveryFee));
    } else if (parsed.deliveryFee !== undefined && parsed.deliveryFee !== null && !isNaN(Number(parsed.deliveryFee))) {
      deliveryFee = Math.max(0, Number(parsed.deliveryFee));
    }
  }

  const discountPct = billingMeta.discountPct || parsed.discountPct || 0;
  const discountAmt = billingMeta.discountAmt || parsed.discountAmt || 0;

  const billing = calculateOrderBilling({
    items,
    deliveryFee,
    discountPct,
    discountAmt,
    cgstRate,
    sgstRate,
    isInterstate
  });

  let subtotal = billing.subtotal;
  let taxableValue = billing.taxableValue;
  let cgstAmt = billing.cgstAmt;
  let sgstAmt = billing.sgstAmt;
  let totalGst = billing.totalGst;

  const rawOrderTot = Number(order.total_amount) || 0;
  let grandTotal = 0;

  if (billing.grandTotal > 0) {
    grandTotal = billing.grandTotal;
    // If order.total_amount was explicitly stored in DB:
    // If it already matches billing.grandTotal (with deliveryFee), floor to whole rupees
    if (rawOrderTot > 0 && Math.abs(rawOrderTot - billing.grandTotal) <= 1) {
      grandTotal = Math.floor(rawOrderTot);
    }
  } else if (rawOrderTot > 0) {
    // If items subtotal is 0 or no items recorded, back-calculate from rawOrderTot
    const totalGstRate = billing.totalGstRate;
    taxableValue = Math.max(0, (rawOrderTot - deliveryFee) / (1 + totalGstRate / 100));
    subtotal = taxableValue;
    cgstAmt = Math.round((taxableValue * (cgstRate / 100)) * 100) / 100;
    sgstAmt = Math.round((taxableValue * (sgstRate / 100)) * 100) / 100;
    totalGst = Math.round((cgstAmt + sgstAmt) * 100) / 100;
    grandTotal = Math.floor(rawOrderTot);
  }

  // Standardize grand total to whole rupees
  grandTotal = Math.floor(Math.max(0, grandTotal));

  // Harmonize taxableValue and GST if grandTotal has discrepancy > ₹1
  if (grandTotal > 0 && Math.abs(taxableValue + totalGst + deliveryFee - grandTotal) > 1) {
    const totalGstRate = billing.totalGstRate;
    taxableValue = Math.round((Math.max(0, (grandTotal - deliveryFee) / (1 + totalGstRate / 100))) * 100) / 100;
    totalGst = Math.round((grandTotal - deliveryFee - taxableValue) * 100) / 100;
    cgstAmt = Math.round((totalGst / 2) * 100) / 100;
    sgstAmt = Math.round((totalGst - cgstAmt) * 100) / 100;
  }

  const roundOff = billing.roundOff !== undefined ? billing.roundOff : Math.round((grandTotal - (taxableValue + totalGst + deliveryFee)) * 100) / 100;

  return {
    items,
    itemCount: items.reduce((sum, i) => sum + Number(i.quantity || i.qty || 1), 0),
    subtotal,
    discountPct: billing.discountPct,
    discountAmt: billing.discountAmt,
    taxableValue,
    cgstRate: billing.cgstRate,
    cgstAmt,
    sgstRate: billing.sgstRate,
    sgstAmt,
    totalGstRate: billing.totalGstRate,
    totalGst,
    deliveryFee,
    grandTotal,
    roundOff
  };
}

function getEffectiveOrderTotal(order) {
  if (!order) return 0;

  // Prefer computeOrderTaxDetails authoritative grandTotal
  try {
    const td = computeOrderTaxDetails(order);
    if (td && td.grandTotal > 0) return td.grandTotal;
  } catch (e) {}

  const direct = Number(order.total_amount);
  const parsed = parseNotesMetadata(order.notes, order);
  const isDelivery = parsed.type === 'delivery' || order.order_type === 'delivery';
  const delFee = isDelivery ? Math.max(0, Number(order.delivery_fee ?? parsed.deliveryFee ?? 0)) : 0;

  if (!isNaN(direct) && direct > 0) {
    if (isDelivery && delFee > 0) {
      const items = getItemsForOrder(order.id);
      if (items && items.length > 0) {
        const sub = items.reduce((s, i) => s + Number(i.line_total || ((i.unit_price || i.price || 0) * (i.quantity || i.qty || 1)) || 0), 0);
        if (Math.abs(direct - sub) < 5 || Math.abs(direct - sub * 1.05) < 5) {
          return Math.round((direct + delFee) * 100) / 100;
        }
      }
    }
    return direct;
  }

  return 0;
}

function getGlobalSearch() {
  return ($('global-search')?.value || '').toLowerCase().trim();
}

// ── Auth gate (dashboard only) ──────────────────────────

function redirectToLogin() {
  const isLocalDev = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '0.0.0.0' ||
    (typeof import.meta !== 'undefined' && import.meta.env?.DEV === true)
  );
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isStrict = urlParams?.get('strict_auth') === 'true';
  if (isLocalDev && !isStrict) {
    return;
  }
  window.location.replace(getAdminLoginUrl(window.location.pathname + window.location.search));
}

// ═════════════════════════════════════════════════════════════════
// STAFF IDENTITY & ROLE-BASED ACCESS CONTROL (RBAC) ENGINE
// ═════════════════════════════════════════════════════════════════

let currentAdminUser = null;

const ROLE_WORKSPACE_PERMISSIONS = {
  owner: ['dashboard', 'order-detail', 'orders', 'tables', 'kitchen', 'foods', 'stock', 'daily-sales-report', 'settings'],
  admin: ['dashboard', 'order-detail', 'orders', 'tables', 'kitchen', 'foods', 'stock', 'daily-sales-report', 'settings'],
  manager: ['dashboard', 'order-detail', 'orders', 'tables', 'kitchen', 'foods', 'stock', 'daily-sales-report', 'settings'],
  cashier: ['dashboard', 'order-detail', 'orders', 'tables', 'kitchen', 'foods'],
  kitchen: ['kitchen'],
  waiter: ['tables', 'orders', 'kitchen'],
  captain: ['tables', 'orders', 'kitchen']
};

function normalizeStaffRole(role) {
  if (!role) return 'cashier';
  const r = String(role).toLowerCase().trim();
  if (r.includes('owner')) return 'owner';
  if (r.includes('manager')) return 'manager';
  if (r.includes('chef') || r.includes('kitchen') || r.includes('cook')) return 'kitchen';
  if (r.includes('waiter') || r.includes('captain') || r.includes('service')) return 'waiter';
  if (r.includes('cashier') || r.includes('billing')) return 'cashier';
  if (r.includes('admin')) return 'admin';
  return 'cashier';
}

function hasStaffPermission(workspaceOrAction, userRole = null) {
  const role = normalizeStaffRole(userRole || currentAdminUser?.role || 'owner');
  const allowed = ROLE_WORKSPACE_PERMISSIONS[role] || ROLE_WORKSPACE_PERMISSIONS.cashier;
  return allowed.includes(workspaceOrAction);
}

function applyStaffRoleUIRestrictions() {
  const role = normalizeStaffRole(currentAdminUser?.role || 'owner');
  const allowedWorkspaces = ROLE_WORKSPACE_PERMISSIONS[role] || ROLE_WORKSPACE_PERMISSIONS.cashier;

  // 1. Hide/show workspace buttons in sidebar
  document.querySelectorAll('#sidebar .adm-nav .adm-nav-item[data-panel]').forEach(btn => {
    const panel = btn.dataset.panel;
    const isAllowed = allowedWorkspaces.includes(panel);
    btn.classList.toggle('adm-role-restricted', !isAllowed);
    btn.style.display = isAllowed ? '' : 'none';
  });

  // 2. Hide/show action buttons based on privilege
  if (role === 'cashier' || role === 'kitchen' || role === 'waiter') {
    // Hide closed order void / edit modal trigger
    const voidBtn = $('btn-open-closed-order-modal');
    if (voidBtn) voidBtn.style.display = 'none';
  }

  // 3. Update header staff identity pill
  const greeting = $('admin-greeting');
  if (greeting && currentAdminUser) {
    greeting.innerHTML = `Hello, <strong>${escapeHtml(currentAdminUser.name || 'Staff')}</strong> <span style="font-size:0.75rem;padding:2px 7px;border-radius:999px;background:#fef3c7;color:#b45309;font-weight:800;margin-left:4px;">${role.toUpperCase()}</span>`;
  }
}

async function checkAdminAccess() {
  const isLocalDev = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '0.0.0.0' ||
    (typeof import.meta !== 'undefined' && import.meta.env?.DEV === true)
  );
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isStrict = urlParams?.get('strict_auth') === 'true';

  let foundAdminRow = null;

  if (currentUser) {
    const cleanEmail = (currentUser.email || '').toLowerCase().trim();
    if (currentUser.id) {
      try {
        const { data: byId } = await insforge.database
          .from('admin_users')
          .select('*')
          .eq('user_id', currentUser.id)
          .maybeSingle();
        if (byId) foundAdminRow = byId;
      } catch (e) {}
    }

    if (!foundAdminRow && cleanEmail) {
      try {
        const { data: byEmail } = await insforge.database
          .from('admin_users')
          .select('*')
          .eq('email', cleanEmail)
          .maybeSingle();
        if (byEmail) foundAdminRow = byEmail;
      } catch (e) {}
    }
  }

  if (foundAdminRow) {
    currentAdminUser = {
      id: foundAdminRow.id,
      user_id: foundAdminRow.user_id,
      name: foundAdminRow.name || foundAdminRow.email.split('@')[0],
      role: normalizeStaffRole(foundAdminRow.role || 'admin'),
      email: foundAdminRow.email,
      phone: foundAdminRow.phone || '',
      shift: foundAdminRow.shift || '',
      status: foundAdminRow.status || 'on_duty'
    };
    window.currentAdminUser = currentAdminUser;
    applyStaffRoleUIRestrictions();
    return true;
  }

  if (isLocalDev && !isStrict) {
    currentAdminUser = {
      id: 'dev-owner-id',
      name: 'Salim Khan',
      role: 'owner',
      email: currentUser?.email || 'salim@limra.com',
      phone: '+91 99887 76655',
      shift: '10:00 AM - 08:00 PM',
      status: 'on_duty'
    };
    window.currentAdminUser = currentAdminUser;
    applyStaffRoleUIRestrictions();
    return true;
  }

  if (currentUser) {
    const cleanEmail = (currentUser.email || '').toLowerCase().trim();
    const knownAdmins = ['arfatalis451@gmail.com', 'admin@limra.com', 'orkiya220@gmail.com', 'arifsk78637@gmail.com'];
    if (knownAdmins.includes(cleanEmail)) {
      currentAdminUser = {
        id: 'known-admin-id',
        name: cleanEmail.split('@')[0],
        role: 'admin',
        email: cleanEmail,
        status: 'on_duty'
      };
      window.currentAdminUser = currentAdminUser;
      applyStaffRoleUIRestrictions();
      return true;
    }
  }

  return false;
}

window.currentAdminUser = currentAdminUser;
window.hasStaffPermission = hasStaffPermission;
window.normalizeStaffRole = normalizeStaffRole;
window.applyStaffRoleUIRestrictions = applyStaffRoleUIRestrictions;
window.ROLE_WORKSPACE_PERMISSIONS = ROLE_WORKSPACE_PERMISSIONS;

async function fetchAllTableRows(table, select = '*', orderCol = 'created_at', ascending = false, maxRows = 1000) {
  const pageSize = Math.min(1000, maxRows);
  let allRows = [];
  let from = 0;
  while (allRows.length < maxRows) {
    const remaining = maxRows - allRows.length;
    const chunkLimit = Math.min(pageSize, remaining);
    let query = insforge.database
      .from(table)
      .select(select)
      .range(from, from + chunkLimit - 1);
    if (orderCol) {
      query = query.order(orderCol, { ascending });
    }
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < chunkLimit) break;
    from += chunkLimit;
  }
  return allRows;
}

let lastSyncTimestamp = null;
let lastStaticConfigTimestamp = 0;
const STATIC_CONFIG_TTL_MS = 5 * 60 * 1000; // 5-minute cache for static config

async function loadStaticConfigData(force = false) {
  const now = Date.now();
  if (!force && (now - lastStaticConfigTimestamp < STATIC_CONFIG_TTL_MS) && adminPlaces.length > 0) {
    return;
  }
  try {
    const [placesRes, combosRes, customDishesRes, overridesRes] = await Promise.all([
      getDeliveryAreas(force).catch(() => []),
      getCombos(force).catch(() => []),
      getCustomDishes(force).catch(() => []),
      getMenuOverrides(force).catch(() => [])
    ]);

    if (Array.isArray(combosRes)) adminCombos = combosRes;
    if (Array.isArray(customDishesRes)) customCreatedFoods = customDishesRes;
    if (Array.isArray(overridesRes)) activeMenuOverrides = overridesRes;
    if (Array.isArray(placesRes) && placesRes.length > 0) {
      adminPlaces = placesRes;
    }
    lastStaticConfigTimestamp = now;
  } catch (err) {
    console.warn('[DataSync] Warning loading static config:', err);
  }
}

function processNotificationsAndAlerts(incomingNotifs, currentAllOrders, newlyArrivedOrders, isFirstLoad) {
  // 1. Initial Load Protection: On startup or page refresh, register all existing orders
  // and notifications as already known so NO historical notifications are announced.
  if (isFirstLoad) {
    (currentAllOrders || []).forEach(o => {
      if (o && o.id) {
        knownOrderIds.add(String(o.id));
        notifiedBusinessOrderIds.add(String(o.id));
      }
      if (o && o.order_number) {
        notifiedBusinessOrderIds.add(String(o.order_number));
      }
    });
    (incomingNotifs || []).forEach(n => {
      if (n && n.id) knownNotificationIds.add(String(n.id));
    });
    return;
  }

  // 2. Mark incoming notification records as known to avoid re-evaluating
  (incomingNotifs || []).forEach(n => {
    if (n && n.id) knownNotificationIds.add(String(n.id));
  });

  // 3. Process new candidate orders. Deduplicate via notifiedBusinessOrderIds & cashierCreatedOrderIds.
  const candidates = [];
  const candidateIds = new Set();

  function addCandidate(order) {
    if (!order || !order.id) return;
    const strId = String(order.id);
    if (candidateIds.has(strId)) return;
    if (cashierCreatedOrderIds.has(strId)) return; // Internal cashier-created POS order -> SUPPRESS
    if (notifiedBusinessOrderIds.has(strId)) return; // Already notified -> SUPPRESS

    // Finished, delivered, closed, or cancelled orders do not generate new notifications
    if (order.status === 'delivered' || order.status === 'completed' || order.status === 'closed' || order.status === 'cancelled') {
      notifiedBusinessOrderIds.add(strId);
      return;
    }

    candidateIds.add(strId);
    candidates.push(order);
  }

  // Check incoming notifications pointing to order IDs
  (incomingNotifs || []).forEach(n => {
    if (!n.is_read && n.type === 'order') {
      const targetOrderId = n.item_id || n.order_id;
      if (targetOrderId) {
        const order = (currentAllOrders || []).find(o => String(o.id) === String(targetOrderId));
        if (order) addCandidate(order);
      }
    }
  });

  // Check newly arrived orders from delta sync / realtime
  (newlyArrivedOrders || []).forEach(order => {
    addCandidate(order);
  });

  if (candidates.length === 0) return;

  let chimeNeeded = false;
  let hasTableEvent = false;
  let lastTableRound = 1;
  let lastTableNum = '—';
  let lastTableOrder = null;

  // Process ONLY the two allowed business notification types
  candidates.forEach(order => {
    const strId = String(order.id);
    if (notifiedBusinessOrderIds.has(strId)) return;
    notifiedBusinessOrderIds.add(strId);
    knownOrderIds.add(strId);

    const meta = parseNotesMetadata(order.notes, order);
    const roundInfo = getOrderRoundInfo(order, currentAllOrders);
    const isTable = order.order_type === 'table' || meta.type === 'table' || Boolean(order.table_number || meta.tableNumber);
    const tableNum = order.table_number || meta.tableNumber || '—';
    const roundNum = meta.roundNumber || roundInfo.roundNumber || 1;

    if (isTable) {
      // ════════════════════════════════════════════════════════════════
      // TYPE 2: NEW TABLE QR ORDER RECEIVED
      // ════════════════════════════════════════════════════════════════
      const orderItemsList = (orderItems || []).filter(i => String(i.order_id) === strId);
      const itemsCount = orderItemsList.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0) || 1;
      const orderNum = `#ORD-${formatDailyOrderNumber(order)}`;

      showBusinessNotification({
        type: 'table_qr',
        orderId: order.id,
        orderNumber: orderNum,
        tableNumber: `Table ${tableNum}`,
        itemCount: itemsCount,
        amount: Number(order.total_amount || 0),
        order
      });

      chimeNeeded = true;
      hasTableEvent = true;
      lastTableRound = roundNum;
      lastTableNum = tableNum;
      lastTableOrder = order;
    } else {
      // ════════════════════════════════════════════════════════════════
      // TYPE 1: NEW WEBSITE ORDER RECEIVED (Delivery / Takeaway)
      // ════════════════════════════════════════════════════════════════
      const orderNum = `#ORD-${formatDailyOrderNumber(order)}`;
      const customerName = order.customer_name || 'Online Customer';
      const orderTypeStr = (meta.type === 'delivery' || order.order_type === 'delivery') ? 'Delivery' : 'Takeaway';

      showBusinessNotification({
        type: 'website',
        orderId: order.id,
        orderNumber: orderNum,
        customerName: customerName,
        orderType: orderTypeStr,
        amount: Number(order.total_amount || 0),
        order
      });

      chimeNeeded = true;

      // Trigger incoming order prompt modal if pending
      try {
        if (order.status === 'pending') {
          triggerIncomingOrderPrompt(order);
        }
      } catch (promptErr) {
        console.error('[Incoming Order] Prompt failed:', promptErr);
      }
    }
  });

  if (hasTableEvent && lastTableRound >= 2) {
    playTableRoundChime(lastTableRound, lastTableNum, lastTableOrder);
  } else if (chimeNeeded) {
    playNotificationChime();
  }
}

// ── Incoming Online Website Orders (Accept / Reject Flow) ───────────────
let currentIncomingOrder = null;

export function closeIncomingOrderModal() {
  const modal = $('adm-incoming-order-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }
  currentIncomingOrder = null;
}
window.closeIncomingOrderModal = closeIncomingOrderModal;

export async function triggerIncomingOrderPrompt(order) {
  if (!order) return;
  // If order is already settled, delivered or cancelled, ignore
  if (order.status === 'delivered' || order.status === 'completed' || order.status === 'closed' || order.status === 'cancelled' || order.status === 'preparing') {
    return;
  }
  currentIncomingOrder = order;

  // Sound notification
  try { playNewOrderSound(); } catch(e) {}

  const modal = $('adm-incoming-order-modal');
  if (!modal) return;

  const parsed = parseNotesMetadata(order.notes, order);
  const isDelivery = parsed.type === 'delivery' || order.order_type === 'delivery';

  if ($('incoming-order-modal-title')) {
    $('incoming-order-modal-title').textContent = `🔔 New Online Order #${formatDailyOrderNumber(order)}!`;
  }
  if ($('incoming-order-cust-name')) {
    $('incoming-order-cust-name').textContent = order.customer_name || 'Customer';
  }
  if ($('incoming-order-cust-phone')) {
    $('incoming-order-cust-phone').textContent = order.customer_phone || '—';
  }
  if ($('incoming-order-type-badge')) {
    $('incoming-order-type-badge').textContent = isDelivery ? '🚗 Home Delivery' : '🥡 Takeaway Pickup';
    $('incoming-order-type-badge').style.background = isDelivery ? '#ecfdf5' : '#eef2ff';
    $('incoming-order-type-badge').style.color = isDelivery ? '#059669' : '#4f46e5';
  }
  if ($('incoming-order-time')) {
    $('incoming-order-time').textContent = timeSince(order.created_at || new Date().toISOString());
  }

  // Address
  const addrBox = $('incoming-order-address-box');
  const addrText = $('incoming-order-address-text');
  if (addrBox && addrText) {
    if (parsed.address) {
      addrText.textContent = ` ${parsed.address} ${parsed.area ? `(${parsed.area})` : ''}`;
      addrBox.style.display = 'block';
    } else {
      addrBox.style.display = 'none';
    }
  }

  // Instructions / Notes
  const notesBox = $('incoming-order-notes-box');
  const notesText = $('incoming-order-notes-text');
  if (notesBox && notesText) {
    if (parsed.customNote) {
      notesText.textContent = ` ${parsed.customNote}`;
      notesBox.style.display = 'block';
    } else {
      notesBox.style.display = 'none';
    }
  }

  // Payment method
  if ($('incoming-order-payment-method')) {
    const isPaid = order.payment_status === 'paid' || parsed.paymentStatus === 'paid';
    $('incoming-order-payment-method').textContent = isPaid ? '✅ Paid Online' : '💵 Cash on Delivery';
  }

  // Total
  if ($('incoming-order-total-amt')) {
    $('incoming-order-total-amt').textContent = fmtMoney(order.total_amount || 0);
  }

  // Items List
  let rawItems = getItemsForOrder(order.id);
  if (!rawItems || rawItems.length === 0) {
    try {
      const { data: dbItems } = await insforge.database.from('order_items').select('*').eq('order_id', order.id);
      if (dbItems && dbItems.length > 0) {
        rawItems = dbItems;
        for (const dbi of dbItems) {
          if (!orderItems.some(x => x.id === dbi.id)) orderItems.push(dbi);
        }
      }
    } catch(err) { console.warn('[Incoming Prompt] DB items fetch error:', err); }
  }

  const items = consolidateOrderItems(rawItems || []);
  if ($('incoming-order-items-count')) {
    $('incoming-order-items-count').textContent = items.length;
  }
  const itemsContainer = $('incoming-order-items-list');
  if (itemsContainer) {
    if (items.length === 0) {
      itemsContainer.innerHTML = '<div style="font-size:.8rem;color:var(--adm-muted);text-align:center;padding:.5rem 0;">No items loaded yet.</div>';
    } else {
      itemsContainer.innerHTML = items.map(i => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px dashed #f1f5f9;font-size:.85rem;">
          <span style="font-weight:700;color:#1e293b;">${i.quantity}× ${escapeHtml(i.item_name || i.name)}</span>
          <span style="font-weight:700;color:#059669;">₹${Number(i.line_total || (i.price * i.quantity) || 0).toFixed(0)}</span>
        </div>
      `).join('');
    }
  }

  // Non-blocking display & focus preservation
  const activeEl = document.activeElement;
  modal.classList.add('open');
  modal.style.display = 'block';

  // Explicitly ensure keyboard focus remains on cashier's active typing element
  if (activeEl && typeof activeEl.focus === 'function' && document.body.contains(activeEl)) {
    try { activeEl.focus(); } catch (e) {}
  }
}
window.triggerIncomingOrderPrompt = triggerIncomingOrderPrompt;

async function acceptIncomingOnlineOrder() {
  if (!currentIncomingOrder) return;
  const order = currentIncomingOrder;

  try {
    // 1. Update status to 'preparing' and ticket_status to 'OPEN'
    await updateOrderStatus(order.id, 'preparing');
    order.status = 'preparing';
    order.ticket_status = 'OPEN';

    // 2. Fetch order items for KOT
    let items = getItemsForOrder(order.id);
    if (!items || !items.length) {
      const { data: dbItems } = await insforge.database.from('order_items').select('*').eq('order_id', order.id);
      if (dbItems) items = dbItems;
    }

    // 3. Print Kitchen Order Ticket (KOT)
    try {
      await printKOT(order, items);
      showAdminToast(`Order #${formatDailyOrderNumber(order)} accepted! KOT sent to kitchen. 🍳`, 'success');
    } catch(printErr) {
      console.warn('[Incoming] KOT print error:', printErr);
      showAdminToast(`Order #${formatDailyOrderNumber(order)} accepted! (Printer offline - check print queue)`, 'info');
    }

    // 4. Mark notifications read
    await markOrderNotificationsRead(order.id);

    // 5. Close modal
    closeIncomingOrderModal();

    // 6. Refresh Panels
    renderHoldOrdersPanel();
    renderKitchenPanel();
    renderOverview();
    renderOrdersTable();
    renderBillingQuickCards();
  } catch(err) {
    showAdminToast('Failed to accept order: ' + err.message, 'error');
  }
}
window.acceptIncomingOnlineOrder = acceptIncomingOnlineOrder;

async function rejectIncomingOnlineOrder() {
  if (!currentIncomingOrder) return;
  const order = currentIncomingOrder;

  if (!confirm(`Are you sure you want to REJECT and cancel Order #${formatDailyOrderNumber(order)}?`)) {
    return;
  }

  try {
    await updateOrderStatus(order.id, 'cancelled');
    order.status = 'cancelled';
    order.ticket_status = 'CANCELLED';

    await markOrderNotificationsRead(order.id);

    showAdminToast(`Order #${formatDailyOrderNumber(order)} was rejected and cancelled.`, 'info');

    closeIncomingOrderModal();

    renderHoldOrdersPanel();
    renderKitchenPanel();
    renderOverview();
    renderOrdersTable();
    renderClosedOrdersPanel();
    renderBillingQuickCards();
  } catch(err) {
    showAdminToast('Failed to reject order: ' + err.message, 'error');
  }
}
window.rejectIncomingOnlineOrder = rejectIncomingOnlineOrder;

function persistOrdersCache() {
  try {
    if (Array.isArray(orders)) {
      localStorage.setItem('limra_cached_orders', JSON.stringify(orders.slice(0, 150)));
      if (typeof window !== 'undefined') {
        window.orders = orders;
      }
      if (typeof posState !== 'undefined' && typeof posState.setOrders === 'function') {
        posState.setOrders(orders);
      }
    }
    if (Array.isArray(orderItems)) {
      localStorage.setItem('limra_cached_order_items', JSON.stringify(orderItems.slice(0, 500)));
      if (typeof window !== 'undefined') {
        window.orderItems = orderItems;
      }
    }
  } catch (e) {
    console.warn('[Cache Persist Warn]:', e);
  }
}
window.persistOrdersCache = persistOrdersCache;

async function loadOrders(force = true) {
  if (typeof refreshDashboard === 'function') {
    return await refreshDashboard(force);
  }
  return await loadData(force);
}
window.loadOrders = loadOrders;

const ORDER_SELECT_COLUMNS = 'id, order_number, customer_name, customer_phone, total_amount, subtotal_amount, discount_pct, discount_amount, taxable_amount, cgst_amount, sgst_amount, delivery_fee, packaging_fee, round_off_amount, status, payment_status, payment_method, notes, latitude, longitude, landmark, delivery_notes, location_verified, order_type, table_number, table_zone, txn_ref, ticket_status, settled_at, consolidated_into_order_id, created_at, updated_at';
const ORDER_ITEM_SELECT_COLUMNS = 'id, order_id, menu_item_id, item_name, quantity, unit_price, line_total, created_at';

function getScopedActiveOrderIdsForItems(orderList = orders) {
  if (!Array.isArray(orderList) || orderList.length === 0) return [];
  const todayStr = getLocalDateString(new Date());
  const scopedIds = new Set();

  // 1. All active/unsettled orders (kitchen, tables, hold, unpaid bills) + today's orders
  for (const o of orderList) {
    if (!o || !o.id) continue;
    const isTerminal = o.status === 'delivered' || o.status === 'completed' || o.status === 'closed' || o.status === 'cancelled';
    const isUnpaid = o.payment_status !== 'paid' && o.status !== 'cancelled';
    const isToday = o.created_at && getLocalDateString(o.created_at) === todayStr;
    if (!isTerminal || isUnpaid || isToday) {
      scopedIds.add(String(o.id));
    }
  }

  // 2. First page of recent orders for immediate Order List display
  const firstPageLimit = typeof ORDERS_PER_PAGE === 'number' ? ORDERS_PER_PAGE : 25;
  for (let i = 0; i < Math.min(orderList.length, firstPageLimit); i++) {
    if (orderList[i]?.id) scopedIds.add(String(orderList[i].id));
  }

  // 3. Currently selected order in Order Detail / POS Billing
  if (selectedOrderId) {
    scopedIds.add(String(selectedOrderId));
  }

  return Array.from(scopedIds);
}

async function loadData(isManual = false) {
  const isFirstLoad = !lastSyncTimestamp || isManual || (knownNotificationIds.size === 0 && knownOrderIds.size === 0);

  // A. SCOPED BASELINE LOAD (On initial page boot or manual force-sync)
  if (isFirstLoad) {
    // 0ms instant render of active panel only from cache if available
    try {
      if (orders.length === 0) {
        const cachedOrders = JSON.parse(localStorage.getItem('limra_cached_orders') || '[]');
        const cachedItems = JSON.parse(localStorage.getItem('limra_cached_order_items') || '[]');
        if (cachedOrders.length > 0) {
          orders = cachedOrders;
          orderItems = cachedItems;
          renderAll();
        }
      }
    } catch (e) {}

    const fetchStartTime = new Date(Date.now() - 10000).toISOString();

    // Step 1: Query recent orders, bookings, notifications, and static config in parallel (NO unscoped order_items dump)
    const [ordersRes, bookingsRes, notifsRes] = await Promise.all([
      insforge.database.from('orders').select(ORDER_SELECT_COLUMNS).order('created_at', { ascending: false }).limit(300),
      insforge.database.from('bookings').select('*').order('created_at', { ascending: false }).limit(100),
      insforge.database.from('notifications').select('*').order('created_at', { ascending: false }).limit(35),
      loadStaticConfigData(isManual)
    ]);

    if (bookingsRes && bookingsRes.error) throw bookingsRes.error;
    if (notifsRes && notifsRes.error) throw notifsRes.error;

    const maxPendingAge = Date.now() - 2 * 60 * 60 * 1000; // 2 hours
    const isRecentLocalOrder = (o) => {
      if (!o) return false;
      const isLocal = o._isOfflineQueued || String(o.id || '').startsWith('offline-');
      if (!isLocal) return false;
      const t = o.created_at ? new Date(o.created_at).getTime() : 0;
      return t > maxPendingAge;
    };

    const pendingLocalOrders = (orders || []).filter(isRecentLocalOrder);

    if (ordersRes && ordersRes.data) {
      orders = ordersRes.data;
    } else if (ordersRes && ordersRes.error) {
      console.warn('[Orders Baseline Query Warn, falling back to select(*)]:', ordersRes.error);
      const fallbackOrdersRes = await insforge.database.from('orders').select('*').order('created_at', { ascending: false }).limit(300);
      if (fallbackOrdersRes && fallbackOrdersRes.data) {
        orders = fallbackOrdersRes.data;
      } else {
        throw ordersRes.error;
      }
    } else {
      orders = [];
    }

    // Preserve and re-merge unconfirmed local/offline orders so browser refresh never erases held orders
    if (pendingLocalOrders.length > 0) {
      for (const localOrd of pendingLocalOrders) {
        const existsInCloud = orders.some(o => o.id === localOrd.id || (localOrd.idempotency_key && o.idempotency_key === localOrd.idempotency_key));
        if (!existsInCloud) {
          orders.unshift(localOrd);
        }
      }
    }

    try {
      const cachedRaw = JSON.parse(localStorage.getItem('limra_cached_orders') || '[]');
      const cachedPending = cachedRaw.filter(isRecentLocalOrder);
      for (const cachedOrd of cachedPending) {
        const exists = orders.some(o => o.id === cachedOrd.id || (cachedOrd.idempotency_key && o.idempotency_key === cachedOrd.idempotency_key));
        if (!exists) {
          orders.unshift(cachedOrd);
        }
      }
    } catch (e) {}

    // Step 2: Fetch order_items strictly scoped to active, today's, and visible first-page orders
    const scopedOrderIds = getScopedActiveOrderIdsForItems(orders);
    if (isManual) {
      loadedItemOrderIds.clear();
      orderItems = [];
    }
    if (scopedOrderIds.length > 0) {
      await ensureOrderItemsLoaded(scopedOrderIds, { force: isManual });
    }

    bookings = (bookingsRes && bookingsRes.data) || [];
    const fetchedNotifs = (notifsRes && notifsRes.data) || [];

    // Cache recent orders & scoped items to localStorage
    persistOrdersCache();

    processNotificationsAndAlerts(fetchedNotifs, orders, orders, true);

    activeNotifications = fetchedNotifs;
    renderNotifications();
    lastSyncTimestamp = fetchStartTime;
    if ($('last-updated')) {
      $('last-updated').textContent = `Updated ${new Date().toLocaleTimeString('en-IN')}`;
    }
    return;
  }

  // B. ULTRA-LIGHTWEIGHT INCREMENTAL DELTA SYNC (Runs on smart polling heartbeat & realtime events)
  const syncSince = lastSyncTimestamp;
  const nextSyncTime = new Date(Date.now() - 10000).toISOString();

  const [deltaOrdersRes, deltaItemsSignalRes, deltaBookingsRes, notifsRes] = await Promise.all([
    insforge.database
      .from('orders')
      .select(ORDER_SELECT_COLUMNS)
      .or(`updated_at.gte.${syncSince},created_at.gte.${syncSince}`)
      .order('created_at', { ascending: false }),
    insforge.database
      .from('order_items')
      .select(ORDER_ITEM_SELECT_COLUMNS)
      .gte('created_at', syncSince)
      .order('created_at', { ascending: false })
      .limit(200),
    insforge.database
      .from('bookings')
      .select('*')
      .or(`updated_at.gte.${syncSince},created_at.gte.${syncSince}`)
      .order('created_at', { ascending: false }),
    insforge.database
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(25),
    loadStaticConfigData(false)
  ]);

  if (deltaBookingsRes && deltaBookingsRes.error) throw deltaBookingsRes.error;
  if (notifsRes && notifsRes.error) throw notifsRes.error;

  let deltaOrders = [];
  if (deltaOrdersRes && deltaOrdersRes.data) {
    deltaOrders = deltaOrdersRes.data;
  } else if (deltaOrdersRes && deltaOrdersRes.error) {
    console.warn('[Delta Sync Orders selective query warning, falling back]:', deltaOrdersRes.error);
    const fbDelta = await insforge.database
      .from('orders')
      .select('*')
      .or(`updated_at.gte.${syncSince},created_at.gte.${syncSince}`)
      .order('created_at', { ascending: false });
    if (fbDelta && fbDelta.data) {
      deltaOrders = fbDelta.data;
    } else {
      throw deltaOrdersRes.error;
    }
  }

  const recentCreatedItems = (deltaItemsSignalRes && Array.isArray(deltaItemsSignalRes.data)) ? deltaItemsSignalRes.data : [];
  const deltaBookings = (deltaBookingsRes && deltaBookingsRes.data) || [];
  const fetchedNotifs = (notifsRes && notifsRes.data) || [];

  // If new order_items arrived for an order not yet in memory or deltaOrders, fetch that parent order too
  if (recentCreatedItems.length > 0) {
    const knownAndDeltaIds = new Set([
      ...orders.map(o => String(o.id)),
      ...deltaOrders.map(o => String(o.id))
    ]);
    const missingParentOrderIds = Array.from(
      new Set(recentCreatedItems.map(i => String(i.order_id)).filter(id => id && !knownAndDeltaIds.has(id)))
    );
    if (missingParentOrderIds.length > 0) {
      let parentOrders = null;
      try {
        const res = await insforge.database
          .from('orders')
          .select(ORDER_SELECT_COLUMNS)
          .in('id', missingParentOrderIds);
        if (res.error) throw res.error;
        parentOrders = res.data;
      } catch (err) {
        const fbRes = await insforge.database
          .from('orders')
          .select('*')
          .in('id', missingParentOrderIds);
        parentOrders = fbRes.data;
      }
      if (Array.isArray(parentOrders) && parentOrders.length > 0) {
        deltaOrders.push(...parentOrders);
      }
    }
  }

  // Merge delta orders into memory
  if (deltaOrders.length > 0) {
    const orderMap = new Map();
    orders.forEach(o => orderMap.set(String(o.id), o));
    deltaOrders.forEach(o => orderMap.set(String(o.id), o));
    orders = Array.from(orderMap.values()).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  // Determine all orders whose order_items need refreshing (deltaOrders + orders with recently created items)
  const affectedOrderIds = Array.from(
    new Set([
      ...deltaOrders.map(o => String(o.id)),
      ...recentCreatedItems.map(i => String(i.order_id))
    ].filter(Boolean))
  );

  if (affectedOrderIds.length > 0) {
    await ensureOrderItemsLoaded(affectedOrderIds, { force: true });
  }

  // Also ensure any active (non-closed) orders in memory that still lack loaded items are synchronized
  const activeMissingItemIds = orders
    .filter(o => o && o.id && !['delivered', 'completed', 'closed', 'cancelled'].includes(o.status) && !loadedItemOrderIds.has(String(o.id)))
    .map(o => String(o.id));
  if (activeMissingItemIds.length > 0) {
    await ensureOrderItemsLoaded(activeMissingItemIds);
  }

  if (deltaOrders.length > 0 || affectedOrderIds.length > 0) {
    persistOrdersCache();
  }

  // Merge delta bookings into memory
  if (deltaBookings.length > 0) {
    const bookingMap = new Map();
    bookings.forEach(b => bookingMap.set(String(b.id), b));
    deltaBookings.forEach(b => bookingMap.set(String(b.id), b));
    bookings = Array.from(bookingMap.values()).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  // Process notifications and alerts for new arrivals
  processNotificationsAndAlerts(fetchedNotifs, orders, deltaOrders, false);

  activeNotifications = fetchedNotifs;
  renderNotifications();
  lastSyncTimestamp = nextSyncTime;
  if ($('last-updated')) {
    $('last-updated').textContent = `Updated ${new Date().toLocaleTimeString('en-IN')}`;
  }
}

function buildCustomerStats() {
  const map = new Map();

  function ensure(phone, name) {
    if (!map.has(phone)) {
      map.set(phone, {
        name: name || 'Customer',
        phone,
        orderCount: 0,
        bookingCount: 0,
        tableBookings: 0,
        partyBookings: 0,
        weddingBookings: 0,
        totalSpent: 0,
        lastOrder: null,
        lastBooking: null,
        lastActivity: null,
        firstVisit: null,
        items: {},
        recentBookings: [],
        ordersHistory: [],
        lastAddress: '',
        lastPlace: '',
        lastAddressDate: null,
        tier: 'new'
      });
    }
    const c = map.get(phone);
    if (name && (!c.name || c.name === 'Customer' || c.name === 'Walk-in Customer' || c.name === 'Walk-in Guest')) c.name = name;
    return c;
  }

  function touchActivity(c, date) {
    if (!date) return;
    if (!c.lastActivity || new Date(date) > new Date(c.lastActivity)) {
      c.lastActivity = date;
    }
    if (!c.firstVisit || new Date(date) < new Date(c.firstVisit)) {
      c.firstVisit = date;
    }
  }

  orders.forEach(order => {
    if (!order.customer_phone) return;
    const c = ensure(order.customer_phone, order.customer_name);
    c.orderCount += 1;
    c.totalSpent += Number(order.total_amount || 0);
    c.ordersHistory.push(order);
    const meta = parseNotesMetadata(order.notes, order);
    if (meta.email) c.email = meta.email;
    const orderAddr = (meta.address || order.address || '').trim();
    const orderArea = (meta.area || '').trim();
    if ((orderAddr || orderArea) && (!c.lastAddressDate || new Date(order.created_at || 0) >= new Date(c.lastAddressDate))) {
      if (orderAddr) c.lastAddress = orderAddr;
      if (orderArea) c.lastPlace = orderArea;
      c.lastAddressDate = order.created_at || new Date().toISOString();
    }
    if (!c.lastOrder || new Date(order.created_at) > new Date(c.lastOrder)) {
      c.lastOrder = order.created_at;
      if (order.customer_name && order.customer_name !== 'Customer' && order.customer_name !== 'Walk-in Guest') c.name = order.customer_name;
    }
    touchActivity(c, order.created_at);
    getItemsForOrder(order.id).forEach(item => {
      if (isFoodItem(item.item_name)) {
        c.items[item.item_name] = (c.items[item.item_name] || 0) + Number(item.quantity || 1);
      }
    });
  });

  bookings.forEach(booking => {
    if (!booking.customer_phone) return;
    const c = ensure(booking.customer_phone, booking.customer_name);
    c.bookingCount += 1;
    const meta = parseNotesMetadata(booking.notes);
    if (meta.email) c.email = meta.email;
    if (booking.type === 'table') c.tableBookings += 1;
    if (booking.type === 'party') c.partyBookings += 1;
    if (booking.type === 'wedding') c.weddingBookings += 1;
    if (!c.lastBooking || new Date(booking.created_at) > new Date(c.lastBooking)) {
      c.lastBooking = booking.created_at;
      if (booking.customer_name && booking.customer_name !== 'Customer') c.name = booking.customer_name;
    }
    touchActivity(c, booking.created_at);
    c.recentBookings.push(booking);
  });

  return [...map.values()]
    .map(c => {
      c.recentBookings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      c.ordersHistory.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const totalVisits = c.orderCount + c.bookingCount;
      c.totalVisits = totalVisits;
      if (totalVisits >= 3 || c.totalSpent >= 2000) {
        c.tier = 'vip';
      } else if (totalVisits === 2 || c.totalSpent >= 1000) {
        c.tier = 'frequent';
      } else {
        c.tier = 'new';
      }
      return c;
    })
    .sort((a, b) => {
      const aDate = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const bDate = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return bDate - aDate;
    });
}

function isFoodItem(itemName) {
  if (!itemName) return false;
  const lowerName = itemName.toLowerCase();
  return !(
    lowerName.includes('gst') ||
    lowerName.includes('tax') ||
    lowerName.includes('delivery') ||
    lowerName.includes('discount') ||
    lowerName.includes('off') ||
    lowerName.includes('coupon') ||
    lowerName.includes('charge') ||
    lowerName.includes('packaging')
  );
}

function getTopItems(limit = 8) {
  const counts = {};
  orderItems.forEach(item => {
    if (isFoodItem(item.item_name)) {
      counts[item.item_name] = (counts[item.item_name] || 0) + item.quantity;
    }
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function getOrdersByDayOfWeek() {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  orders.forEach(o => { counts[new Date(o.created_at).getDay()] += 1; });
  return counts;
}

function getRevenueByMonth() {
  const rev = new Array(12).fill(0);
  orders.filter(o => o.status !== 'cancelled').forEach(o => {
    rev[new Date(o.created_at).getMonth()] += getEffectiveOrderTotal(o);
  });
  return rev;
}

function getBookingsByDayOfWeek() {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  bookings.forEach(b => {
    const d = b.booking_date || b.created_at;
    if (d) counts[new Date(d).getDay()] += 1;
  });
  return counts;
}

// ── Dashboard ───────────────────────────────────────────

function renderStats() {
  const now = new Date();
  const todayStr = getLocalDateString(now);
  const yDate = new Date(now);
  yDate.setDate(yDate.getDate() - 1);
  const yesterdayStr = getLocalDateString(yDate);
  const nowMs = now.getTime();

  // All-time metrics for legacy badges & reports
  let allPending = 0;
  let allDelivered = 0;
  let allRevenue = 0;
  let allPaidCount = 0;
  let allUnpaidCount = 0;
  let allPendingPayments = 0;
  let allCollectedRev = 0;
  let allOutstandingRev = 0;

  // Today's metrics
  let todayTotalOrders = 0;
  let todayGrossRev = 0;
  let todayPaidRev = 0;
  let todayPendingRev = 0;
  let todayPaidCount = 0;
  let todayPendingCount = 0;
  let todayDineIn = 0;
  let todayOnline = 0;
  let yesterdayPaidRev = 0;

  // Payment method breakdowns (today settled only)
  let cashCollected = 0;
  let upiCollected = 0;
  let cardCollected = 0;
  let settledTxnCount = 0;

  // Active KDS Kitchen metrics
  let kdsPendingCount = 0;
  let kdsPreparingCount = 0;
  let kdsReadyCount = 0;
  let kdsDelayedCount = 0;
  let kdsMaxWaitMins = 0;

  // Held orders count
  let heldOrdersCount = 0;
  let heldTotalAmount = 0;

  // Single-pass O(N) aggregation across orders
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const isCancelled = (o.status === 'cancelled' || o.ticket_status === 'CANCELLED');
    const isClosed = (o.ticket_status === 'CLOSED');
    const isPaid = (o.payment_status === 'paid');
    const orderTotal = getEffectiveOrderTotal(o);
    const orderDateStr = getLocalDateString(o.created_at);
    const isToday = (orderDateStr === todayStr);
    const isYesterday = (orderDateStr === yesterdayStr);

    // All-time stats
    if (o.status === 'pending') allPending++;
    if (o.status === 'delivered') allDelivered++;
    if (o.status === 'hold') {
      heldOrdersCount++;
      heldTotalAmount += orderTotal;
    }
    if (isPaid) {
      allPaidCount++;
      if (!isCancelled) allCollectedRev += orderTotal;
    } else {
      allUnpaidCount++;
      allPendingPayments += orderTotal;
      if (!isCancelled) allOutstandingRev += orderTotal;
    }
    if (!isCancelled) allRevenue += orderTotal;

    // Today's stats
    if (isToday) {
      todayTotalOrders++;
      const meta = parseNotesMetadata(o.notes, o);
      const isTableOrder = (meta.type === 'table' || o.order_type === 'table');
      if (isTableOrder) todayDineIn++;
      else todayOnline++;

      if (!isCancelled) {
        todayGrossRev += orderTotal;
        if (isPaid) {
          todayPaidRev += orderTotal;
          todayPaidCount++;
          settledTxnCount++;

          // Breakdown by payment mode
          const mode = (o.payment_method || meta.paymentMode || o.payment_mode || meta.payment || '').toLowerCase();
          if (mode.includes('card')) {
            cardCollected += orderTotal;
          } else if (mode.includes('upi') || mode.includes('online') || mode.includes('razorpay') || meta.type === 'delivery') {
            upiCollected += orderTotal;
          } else {
            cashCollected += orderTotal;
          }
        } else {
          todayPendingRev += orderTotal;
          todayPendingCount++;
        }
      }
    } else if (isYesterday && !isCancelled && isPaid) {
      yesterdayPaidRev += orderTotal;
    }

    // Kitchen KDS active items
    if (!isCancelled && !isClosed && o.status !== 'delivered') {
      if (o.status === 'pending' || o.status === 'confirmed') {
        kdsPendingCount++;
      } else if (o.status === 'preparing') {
        kdsPreparingCount++;
      } else if (o.status === 'ready') {
        kdsReadyCount++;
      }

      if (['pending', 'confirmed', 'preparing', 'ready'].includes(o.status)) {
        const orderTime = o.created_at ? new Date(o.created_at).getTime() : nowMs;
        const waitMins = Math.max(0, Math.floor((nowMs - orderTime) / 60000));
        if (waitMins > kdsMaxWaitMins) kdsMaxWaitMins = waitMins;
        if (waitMins >= 20 && o.status !== 'ready') {
          kdsDelayedCount++;
        }
      }
    }
  }

  // Dining Table stats from existing table functions
  const totalTables = getTotalTablesCount();
  const tableSessions = getActiveTableSessions();
  const unpaidTableBills = typeof getOutstandingBills === 'function' ? getOutstandingBills('table') : getOutstandingTableBills();

  let freeTables = 0;
  let occupiedTables = 0;
  let billedTables = 0;

  for (let tNum = 1; tNum <= totalTables; tNum++) {
    const sess = tableSessions.find(s => s.tableNumber === tNum);
    const tableBill = unpaidTableBills.find(b => {
      const meta = parseNotesMetadata(b.notes, b);
      const bNum = parseInt(String(meta.tableNumber || b.table_number || '').replace(/\D/g, ''), 10);
      return bNum === tNum;
    });

    if (sess && sess.orders.length > 0) {
      occupiedTables++;
    } else if (tableBill) {
      billedTables++;
    } else {
      freeTables++;
    }
  }

  // --- RENDER CARD 1: Today's Net Sales ---
  if ($('kpi-today-net-sales')) $('kpi-today-net-sales').textContent = fmtMoney(todayPaidRev);
  if ($('kpi-today-sales-sub')) $('kpi-today-sales-sub').textContent = `₹${todayPaidRev.toFixed(2)} Paid · ₹${todayPendingRev.toFixed(2)} Unpaid`;
  if ($('kpi-today-orders-count')) $('kpi-today-orders-count').textContent = `${todayPaidCount} Orders completed`;
  if ($('kpi-today-benchmark')) {
    if (yesterdayPaidRev > 0) {
      $('kpi-today-benchmark').textContent = `vs Yesterday: ${fmtMoney(yesterdayPaidRev)}`;
    } else if (todayPaidCount > 0) {
      $('kpi-today-benchmark').textContent = `Avg: ${fmtMoney(todayPaidRev / todayPaidCount)}`;
    } else {
      $('kpi-today-benchmark').textContent = 'Shift started';
    }
  }

  // --- RENDER CARD 2: Payment Collections ---
  if ($('kpi-total-collected')) $('kpi-total-collected').textContent = fmtMoney(todayPaidRev);
  if ($('kpi-cash-collected')) $('kpi-cash-collected').textContent = fmtMoney(cashCollected);
  if ($('kpi-upi-collected')) $('kpi-upi-collected').textContent = fmtMoney(upiCollected);
  if ($('kpi-card-collected')) $('kpi-card-collected').textContent = fmtMoney(cardCollected);
  if ($('kpi-collected-txns')) $('kpi-collected-txns').textContent = `${settledTxnCount} Settlements`;
  if ($('kpi-payments-unpaid')) $('kpi-payments-unpaid').textContent = `₹${todayPendingRev.toFixed(2)} Unpaid`;

  // --- RENDER CARD 3: Dining Table Status ---
  const activeTablesCount = occupiedTables + billedTables;
  const tablePct = Math.round((activeTablesCount / Math.max(totalTables, 1)) * 100);
  if ($('kpi-table-occupancy')) $('kpi-table-occupancy').textContent = `${occupiedTables} / ${totalTables} Occupied`;
  if ($('kpi-table-bar-fill')) $('kpi-table-bar-fill').style.width = `${tablePct}%`;
  if ($('kpi-table-free-pill')) $('kpi-table-free-pill').textContent = `🟢 ${freeTables} Free`;
  if ($('kpi-table-busy-pill')) $('kpi-table-busy-pill').textContent = `🟡 ${occupiedTables} Seated`;
  if ($('kpi-table-billed-pill')) $('kpi-table-billed-pill').textContent = `🔴 ${billedTables} Billed`;

  // --- RENDER CARD 4: Kitchen KDS Status ---
  const totalActiveKds = kdsPendingCount + kdsPreparingCount + kdsReadyCount;
  if ($('kpi-kds-active-count')) $('kpi-kds-active-count').textContent = `${totalActiveKds} Active KOTs`;
  if ($('kpi-kds-breakdown')) $('kpi-kds-breakdown').textContent = `${kdsPreparingCount} Cooking · ${kdsPendingCount} Queued · ${kdsReadyCount} Ready`;
  if ($('kpi-kds-max-wait')) $('kpi-kds-max-wait').textContent = `Wait: ${kdsMaxWaitMins}m`;

  const delayBadge = $('kpi-kds-delay-badge');
  if (delayBadge) {
    if (kdsDelayedCount > 0) {
      delayBadge.className = 'dash-kds-badge delayed';
      delayBadge.textContent = `⚠️ ${kdsDelayedCount} Delayed (>20m)`;
    } else {
      delayBadge.className = 'dash-kds-badge ok';
      delayBadge.textContent = '✓ On Track (0 Delayed)';
    }
  }

  // --- Legacy Hero & Stat Elements (Backward Compatibility) ---
  if ($('dash-hero-today-sales')) $('dash-hero-today-sales').textContent = fmtMoney(todayGrossRev);
  if ($('dash-hero-today-sales-sub')) $('dash-hero-today-sales-sub').textContent = `₹${todayPaidRev.toFixed(2)} Paid · ₹${todayPendingRev.toFixed(2)} Pending`;
  if ($('dash-hero-today-orders')) $('dash-hero-today-orders').textContent = `${todayTotalOrders} Orders`;
  if ($('dash-hero-today-orders-sub')) $('dash-hero-today-orders-sub').textContent = `${todayDineIn} Dine-in · ${todayOnline} Online/Takeaway`;
  if ($('dash-hero-hold-orders')) $('dash-hero-hold-orders').textContent = `${heldOrdersCount} KOTs`;
  if ($('dash-hero-hold-orders-sub')) $('dash-hero-hold-orders-sub').textContent = `₹${heldTotalAmount.toFixed(2)} pending settlement`;
  if ($('dash-hero-digital-cash')) $('dash-hero-digital-cash').textContent = `₹${(upiCollected + cardCollected).toFixed(2)} UPI/Card`;
  if ($('dash-hero-digital-cash-sub')) $('dash-hero-digital-cash-sub').textContent = `₹${cashCollected.toFixed(2)} Cash received`;

  if ($('stat-total-orders')) $('stat-total-orders').textContent = orders.length;
  if ($('stat-revenue')) $('stat-revenue').textContent = fmtMoney(allRevenue);
  if ($('stat-paid-orders')) $('stat-paid-orders').textContent = allPaidCount;
  if ($('stat-unpaid-orders')) $('stat-unpaid-orders').textContent = allUnpaidCount;
  if ($('stat-today-payments')) $('stat-today-payments').textContent = fmtMoney(todayPaidRev);
  if ($('stat-pending-payments')) $('stat-pending-payments').textContent = fmtMoney(allPendingPayments);
  if ($('stat-collected-revenue')) $('stat-collected-revenue').textContent = fmtMoney(allCollectedRev);
  if ($('stat-outstanding-revenue')) $('stat-outstanding-revenue').textContent = fmtMoney(allOutstandingRev);

  // Render GST compliance & accounting section with active date filters
  renderGSTSection();

  // Sidebar badges
  const orderBadge = $('pending-orders-badge');
  if (allPending > 0) { orderBadge.textContent = allPending; show(orderBadge); }
  else hide(orderBadge);

  const bookBadge = $('pending-bookings-badge');
  const pendingBook = bookings.filter(b => b.status === 'pending').length;
  if (pendingBook > 0) { bookBadge.textContent = pendingBook; show(bookBadge); }
  else hide(bookBadge);
}

// ── 📊 GST TAX ACCOUNTING & DATE-RANGE REPORTING HUB ─────────────
let activeGstPreset = 'this_month';
let gstCustomStart = '';
let gstCustomEnd = '';
const gstLoadedRanges = new Set();
let isFetchingGstOrders = false;

function formatGstDateLabel(date) {
  if (!date) return '';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function getGstDateRangeBounds(preset = activeGstPreset, customStart = gstCustomStart, customEnd = gstCustomEnd) {
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

async function ensureOrdersForGstRange(startIso, endIso, rangeKey, force = false) {
  if (isFetchingGstOrders || !startIso || !endIso || !rangeKey) return;
  if (!force && gstLoadedRanges.has(rangeKey)) return;

  // Check if existing in-memory orders already cover prior to startIso
  if (!force && orders.length > 0) {
    const oldest = new Date(orders[orders.length - 1].created_at || Date.now());
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
      orders.forEach(o => orderMap.set(String(o.id), o));
      fetched.forEach(o => orderMap.set(String(o.id), o));
      orders = Array.from(orderMap.values()).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      persistOrdersCache();
    }
    gstLoadedRanges.add(rangeKey);
  } catch (err) {
    console.error('[GST Hub] Failed to ensure historical orders:', err);
  } finally {
    isFetchingGstOrders = false;
  }
}

function getGstFilteredOrders(startDate, endDate) {
  const nonCancelled = orders.filter(o => o.status !== 'cancelled');
  let matched = nonCancelled;

  if (startDate && endDate) {
    matched = nonCancelled.filter(o => {
      const t = new Date(o.created_at);
      return t >= startDate && t <= endDate;
    });
  }

  // Deduplicate and consolidate table sessions so individual KOT rounds are not double counted
  return getConsolidatedClosedBills(matched);
}

async function renderGSTSection() {
  const { startDate, endDate, startIso, endIso, label, rangeKey } = getGstDateRangeBounds();

  // 1. Update period display banner
  if ($('dash-gst-period-text')) {
    $('dash-gst-period-text').textContent = `GST Report: ${label}`;
  }

  // 2. Fetch server-side historical data if needed
  if (startIso && endIso) {
    await ensureOrdersForGstRange(startIso, endIso, rangeKey);
  }

  // 3. Compute GST metrics on consolidated filtered orders
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
    const td = computeOrderTaxDetails(o);
    const taxable = td.taxableValue || 0;
    const cgst = td.cgstAmt || 0;
    const sgst = td.sgstAmt || 0;
    const igst = (td.isInterstate ? td.totalGst : 0);
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

  // 4. Update KPI card displays
  if ($('stat-gst-gross')) $('stat-gst-gross').textContent = fmtMoney(sumGross);
  if ($('stat-gst-taxable')) $('stat-gst-taxable').textContent = fmtMoney(sumTaxable);
  if ($('stat-gst-total')) $('stat-gst-total').textContent = fmtMoney(sumGST);
  if ($('stat-gst-cgst')) $('stat-gst-cgst').textContent = fmtMoney(sumCGST);
  if ($('stat-gst-sgst')) $('stat-gst-sgst').textContent = fmtMoney(sumSGST);
  if ($('stat-gst-igst')) $('stat-gst-igst').textContent = fmtMoney(sumIGST);
  if ($('stat-gst-order-count')) $('stat-gst-order-count').textContent = `${orderCount} ${orderCount === 1 ? 'Order' : 'Orders'}`;
  if ($('stat-gst-paid')) $('stat-gst-paid').textContent = fmtMoney(sumPaidGST);
  if ($('stat-gst-pending')) $('stat-gst-pending').textContent = fmtMoney(sumPendingGST);

  // 5. Empty State toggle
  const emptyEl = $('dash-gst-empty-state');
  if (emptyEl) {
    emptyEl.style.display = orderCount === 0 ? 'block' : 'none';
  }

  // 6. Update Month select dropdown to match
  renderGSTMonthlySelect();
}

function setGstDatePreset(preset) {
  activeGstPreset = preset;

  // Highlight active preset button
  document.querySelectorAll('#dash-gst-presets .gst-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === preset);
  });

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

function applyGstCustomRange(startStr, endStr) {
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

  document.querySelectorAll('#dash-gst-presets .gst-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === 'custom');
  });

  const customWrap = $('dash-gst-custom-range-wrap');
  if (customWrap) customWrap.style.display = 'flex';

  renderGSTSection();
}

function resetGstFilter() {
  activeGstPreset = 'this_month';
  gstCustomStart = '';
  gstCustomEnd = '';

  if ($('dash-gst-start-date')) $('dash-gst-start-date').value = '';
  if ($('dash-gst-end-date')) $('dash-gst-end-date').value = '';

  const customWrap = $('dash-gst-custom-range-wrap');
  if (customWrap) customWrap.style.display = 'none';

  document.querySelectorAll('#dash-gst-presets .gst-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === 'this_month');
  });

  renderGSTSection();
  showAdminToast('GST filter reset to current month.', 'info');
}

function renderGSTMonthlySelect() {
  const select = $('dash-gst-month-select');
  if (!select) return;

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

async function exportMonthlyGSTFilingCSV() {
  const { startDate, endDate, startIso, endIso, label } = getGstDateRangeBounds();

  if (startIso && endIso) {
    await ensureOrdersForGstRange(startIso, endIso, `gst_export_${startIso}_${endIso}`);
  }

  const targetOrders = getGstFilteredOrders(startDate, endDate);
  if (targetOrders.length === 0) {
    showAdminToast('No orders found for the selected GST reporting period.', 'error');
    return;
  }

  // Ensure line items are loaded for accurate itemized GST computation
  await ensureOrderItemsLoaded(targetOrders.map(o => o.id));

  const s = typeof getBillSettings === 'function' ? getBillSettings() : { restaurantName: 'LIMRA RESTAURANT', gstin: '' };
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
    const td = computeOrderTaxDetails(o);
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

  // Add Summary Total Row
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

function initGSTSectionListeners() {
  // Preset buttons
  document.querySelectorAll('#dash-gst-presets .gst-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setGstDatePreset(btn.dataset.preset);
    });
  });

  // Apply custom range button
  $('dash-gst-apply-btn')?.addEventListener('click', () => {
    const s = $('dash-gst-start-date')?.value;
    const e = $('dash-gst-end-date')?.value;
    applyGstCustomRange(s, e);
  });

  // Reset filter button
  $('dash-gst-reset-btn')?.addEventListener('click', resetGstFilter);

  // Month selector dropdown change
  $('dash-gst-month-select')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'custom') {
      setGstDatePreset('custom');
    } else if (val === 'this_month') {
      setGstDatePreset('this_month');
    } else if (/^\d{4}-\d{2}$/.test(val)) {
      const [y, m] = val.split('-').map(Number);
      const startStr = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const endStr = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      applyGstCustomRange(startStr, endStr);
    }
  });

  // Export CSV button
  $('dash-export-gst-csv-btn')?.addEventListener('click', exportMonthlyGSTFilingCSV);
}

window.setGstDatePreset = setGstDatePreset;
window.applyGstCustomRange = applyGstCustomRange;
window.resetGstFilter = resetGstFilter;
window.getGstDateRangeBounds = getGstDateRangeBounds;
window.getGstFilteredOrders = getGstFilteredOrders;
window.renderGSTSection = renderGSTSection;
window.exportMonthlyGSTFilingCSV = exportMonthlyGSTFilingCSV;

function exportTodaySummaryCSV() {
  const todayStr = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.created_at).toDateString() === todayStr);

  if (todayOrders.length === 0) {
    showAdminToast('No orders recorded today yet to export.', 'error');
    return;
  }

  const headers = ['Order #', 'Date & Time', 'Customer Name', 'Customer Phone', 'Type', 'Table #', 'Status', 'Payment Status', 'Total Amount (INR)'];
  const rows = todayOrders.map(o => {
    const meta = parseNotesMetadata(o.notes, o);
    return [
      `"${o.order_number || o.id}"`,
      `"${new Date(o.created_at).toLocaleString('en-IN')}"`,
      `"${(o.customer_name || 'Walk-in').replace(/"/g, '""')}"`,
      `"${o.customer_phone || ''}"`,
      `"${meta.type || o.order_type || 'table'}"`,
      `"${meta.tableNumber || o.table_number || ''}"`,
      `"${o.status}"`,
      `"${o.payment_status}"`,
      `"${Number(o.total_amount || 0).toFixed(2)}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.setAttribute('download', `LIMRA_Today_Orders_Summary_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAdminToast('Today orders exported to CSV! 📥', 'success');
}

function initDashboardQuickListeners() {
  $('dash-quick-pos-btn')?.addEventListener('click', () => {
    switchPanel('order-detail');
    setTimeout(() => {
      $('billing-new-btn')?.click();
    }, 100);
  });

  $('dash-quick-tables-btn')?.addEventListener('click', () => {
    switchPanel('tables');
  });

  $('dash-quick-sync-btn')?.addEventListener('click', () => {
    refreshDashboard(true);
  });

  $('dash-quick-export-today-btn')?.addEventListener('click', exportTodaySummaryCSV);

  // Phase 2 KPI Card Interactive Navigation
  const cardSales = $('card-kpi-sales');
  if (cardSales && !cardSales.dataset.bound) {
    cardSales.dataset.bound = 'true';
    cardSales.addEventListener('click', () => switchPanel('daily-sales-report'));
    cardSales.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchPanel('daily-sales-report');
      }
    });
  }

  const cardPayments = $('card-kpi-payments');
  if (cardPayments && !cardPayments.dataset.bound) {
    cardPayments.dataset.bound = 'true';
    cardPayments.addEventListener('click', () => switchPanel('daily-sales-report'));
    cardPayments.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchPanel('daily-sales-report');
      }
    });
  }

  const cardTables = $('card-kpi-tables');
  if (cardTables && !cardTables.dataset.bound) {
    cardTables.dataset.bound = 'true';
    cardTables.addEventListener('click', () => switchPanel('tables'));
    cardTables.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchPanel('tables');
      }
    });
  }

  const cardKitchen = $('card-kpi-kitchen');
  if (cardKitchen && !cardKitchen.dataset.bound) {
    cardKitchen.dataset.bound = 'true';
    cardKitchen.addEventListener('click', () => switchPanel('kitchen'));
    cardKitchen.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchPanel('kitchen');
      }
    });
  }

  // Phase 3 Two-Column Header Navigation Buttons
  $('dash-btn-view-floor')?.addEventListener('click', () => switchPanel('tables'));
  $('dash-btn-view-all-orders')?.addEventListener('click', () => switchPanel('orders'));

  initGSTSectionListeners();

  $('btn-admin-header-sales-report')?.addEventListener('click', () => switchPanel('daily-sales-report'));
  $('dash-quick-daily-report-btn')?.addEventListener('click', () => switchPanel('daily-sales-report'));
  $('pos-hub-daily-bill-report')?.addEventListener('click', () => switchPanel('daily-sales-report'));
  $('panel-analytics-sales-report-btn')?.addEventListener('click', () => switchPanel('daily-sales-report'));
  $('items-report-daily-bill-btn')?.addEventListener('click', () => switchPanel('daily-sales-report'));
}

function renderDonuts() {
  const total = orders.length || 1;
  const delivered = orders.filter(o => o.status === 'delivered').length;
  const pending = orders.filter(o => o.status === 'pending').length;
  const revenue = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + Number(o.total_amount), 0);
  const maxRev = Math.max(revenue, 1);

  const items = [
    { label: 'Total Order', pct: Math.round((orders.length / Math.max(total, 1)) * 100) || 0, color: '#ff5b5b', bg: 'conic-gradient(#ff5b5b 0% 81%, #fdecea 81% 100%)' },
    { label: 'Pending', pct: Math.round((pending / total) * 100), color: '#00b074', bg: `conic-gradient(#00b074 0% ${Math.round((pending / total) * 100)}%, #e6f7f1 ${Math.round((pending / total) * 100)}% 100%)` },
    { label: 'Delivered', pct: Math.round((delivered / total) * 100), color: '#2d9cdb', bg: `conic-gradient(#2d9cdb 0% ${Math.round((delivered / total) * 100)}%, #e8f4fd ${Math.round((delivered / total) * 100)}% 100%)` },
  ];

  if (orders.length === 0) {
    $('donut-stats').innerHTML = '<p class="adm-empty w-full">No order data yet</p>';
    return;
  }

  $('donut-stats').innerHTML = items.map(it => `
    <div class="adm-donut-item">
      <div class="adm-donut-ring" style="background:${it.bg}; color:${it.color}">${it.pct}%</div>
      <p class="adm-donut-label">${it.label}</p>
    </div>
  `).join('');
}

function renderCharts() {
  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
  };

  destroyChart('ordersWeek');
  charts.ordersWeek = new Chart($('chart-orders-week'), {
    type: 'line',
    data: {
      labels: DAYS,
      datasets: [{
        data: getOrdersByDayOfWeek(),
        borderColor: '#2d9cdb',
        backgroundColor: 'rgba(45, 156, 219, 0.15)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#2d9cdb',
      }],
    },
    options: { ...chartDefaults, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } } },
  });

  destroyChart('revenue');
  charts.revenue = new Chart($('chart-revenue'), {
    type: 'line',
    data: {
      labels: MONTHS,
      datasets: [{
        data: getRevenueByMonth(),
        borderColor: '#00b074',
        backgroundColor: 'rgba(0, 176, 116, 0.1)',
        fill: true,
        tension: 0.4,
      }],
    },
    options: { ...chartDefaults, scales: { y: { beginAtZero: true } } },
  });

  destroyChart('bookings');
  charts.bookings = new Chart($('chart-bookings'), {
    type: 'bar',
    data: {
      labels: DAYS,
      datasets: [{
        data: getBookingsByDayOfWeek(),
        backgroundColor: ['#00b074', '#2d9cdb', '#f2994a', '#9b59b6', '#ff5b5b', '#00b074', '#2d9cdb'],
        borderRadius: 8,
      }],
    },
    options: { ...chartDefaults, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } },
  });
}

const categoryColors = {
  soup: '#ff5b5b',
  'veg-starters': '#2d9cdb',
  'nonveg-starters': '#f2994a',
  'tandoor-kabab': '#9b59b6',
  bread: '#00b074',
  biryani: '#ffc107',
  'veg-curry': '#e83e8c',
  'nonveg-curry': '#fd7e14',
  'veg-rice': '#20c997',
  'nonveg-rice': '#17a2b8',
  'chinese-veg': '#6f42c1',
  'chinese-nonveg': '#dc3545',
  noodles: '#28a745',
  thali: '#6c757d',
  desserts: '#ff85a2',
  salads: '#b5e2fa',
  'momos-chaat': '#edafb8',
  juices: '#38b000',
  lassi: '#ffc6ff',
  milkshakes: '#bdb2ff',
  mocktails: '#9bf6ff',
  beverages: '#a0c4ff'
};

function getCategorySalesData() {
  const counts = {};
  Object.keys(categoryLabels).forEach(cat => {
    counts[cat] = 0;
  });
  orderItems.forEach(item => {
    const order = orders.find(o => o.id === item.order_id);
    if (order && order.status !== 'cancelled') {
      const menu = menuItems.find(m => m.name === item.item_name);
      if (menu && menu.category) {
        counts[menu.category] = (counts[menu.category] || 0) + item.quantity;
      }
    }
  });
  return counts;
}

// ════════════════════════════════════════════════════════
// 📈 ORDERS REPORT & AUDIT ENGINE
// ════════════════════════════════════════════════════════

let ordersReportDateFilter = 'all';
let ordersReportCustomStart = null;
let ordersReportCustomEnd = null;
let ordersReportTypeFilter = 'all';
let ordersReportModeFilter = 'all';
let ordersReportStatusFilter = 'all';
let ordersReportSearch = '';
let ordersSalesTrendChartInstance = null;
let ordersPaySplitChartInstance = null;

function getConsolidatedClosedBills(ordersList) {
  if (!ordersList || !ordersList.length) return [];
  
  const result = [];
  const handledOrderIds = new Set();

  // 1. Separate table orders and non-table orders
  const tableOrders = [];
  const nonTableOrders = [];
  
  for (const o of ordersList) {
    const parsed = parseNotesMetadata(o.notes, o);
    const tableNum = parsed.tableNumber || o.table_number;
    const isTable = parsed.type === 'table' || o.order_type === 'table' || Boolean(tableNum);
    
    if (!isTable) {
      nonTableOrders.push(o);
    } else {
      tableOrders.push(o);
    }
  }

  // 2. Process table orders: prioritize Final Bills without swallowing independent bills
  const finalBills = tableOrders.filter(o => (o.notes || '').includes('[FINAL_BILL]'));
  finalBills.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  
  for (const fb of finalBills) {
    if (handledOrderIds.has(fb.id)) continue;
    handledOrderIds.add(fb.id);

    const parsed = parseNotesMetadata(fb.notes, fb);
    const tableNum = parsed.tableNumber || fb.table_number;
    const fbTime = new Date(fb.created_at).getTime();

    // Check if notes list specific KOTs, e.g. [KOTS: #35]
    const kotsMatch = (fb.notes || '').match(/\[KOTS:\s*([^\]]+)\]/i);
    const listedKotNums = new Set();
    if (kotsMatch) {
      const parts = kotsMatch[1].split(/[\s+,#]+/).filter(Boolean);
      parts.forEach(p => {
        const n = parseInt(p, 10);
        if (!isNaN(n)) listedKotNums.add(n);
      });
    }

    const siblingIds = [];
    tableOrders.forEach(sibling => {
      if (sibling.id === fb.id) return;
      if (handledOrderIds.has(sibling.id)) return;
      if ((sibling.notes || '').includes('[FINAL_BILL]')) return; // Never swallow another Final Bill!
      if (sibling.status === 'cancelled') return;

      const sParsed = parseNotesMetadata(sibling.notes, sibling);
      const sTableNum = sParsed.tableNumber || sibling.table_number;
      if (String(sTableNum) !== String(tableNum)) return;

      const sNum = parseInt(sibling.order_number, 10);
      const sTot = Number(sibling.total_amount || 0);
      const fbTot = Number(fb.total_amount || 0);

      // Only swallow sibling if it was explicitly consolidated or has 0 total and matches listed KOTs
      let isSibling = false;
      if (sibling.consolidated_into_order_id && String(sibling.consolidated_into_order_id) === String(fb.id)) {
        isSibling = true;
      } else if (listedKotNums.size > 0 && listedKotNums.has(sNum) && sTot <= 0) {
        isSibling = true;
      }

      if (isSibling) {
        handledOrderIds.add(sibling.id);
        siblingIds.push(sibling.id);
      }
    });

    fb.sibling_order_ids = siblingIds;
    result.push(fb);
  }

  // 3. For any remaining table orders: preserve each settled order with revenue
  const remainingTableOrders = tableOrders.filter(o => !handledOrderIds.has(o.id));
  remainingTableOrders.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  for (const ro of remainingTableOrders) {
    if (handledOrderIds.has(ro.id)) continue;
    handledOrderIds.add(ro.id);
    result.push(ro);
  }

  // 4. Non-table orders (Delivery / Pickup)
  for (const o of nonTableOrders) {
    if (handledOrderIds.has(o.id)) continue;
    handledOrderIds.add(o.id);
    result.push(o);
  }

  return result;
}

function computeOrdersReportData() {
  const now = new Date();
  const todayStr = getLocalDateString(now);
  const yDate = new Date(now);
  yDate.setDate(yDate.getDate() - 1);
  const yestStr = getLocalDateString(yDate);

  // Show settled/closed bills with complete accuracy
  let list = getConsolidatedClosedBills(orders);

  // 1. Date Filtering
  if (ordersReportDateFilter === 'today') {
    list = list.filter(o => getLocalDateString(o.created_at) === todayStr);
  } else if (ordersReportDateFilter === 'yesterday') {
    list = list.filter(o => getLocalDateString(o.created_at) === yestStr);
  } else if (ordersReportDateFilter === 'week') {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    list = list.filter(o => new Date(o.created_at) >= weekStart);
  } else if (ordersReportDateFilter === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    list = list.filter(o => new Date(o.created_at) >= monthStart);
  } else if (ordersReportDateFilter === 'custom' && ordersReportCustomStart) {
    const cStart = new Date(ordersReportCustomStart + 'T00:00:00');
    const cEnd = ordersReportCustomEnd ? new Date(ordersReportCustomEnd + 'T23:59:59.999') : new Date(ordersReportCustomStart + 'T23:59:59.999');
    list = list.filter(o => {
      const t = new Date(o.created_at);
      return t >= cStart && t <= cEnd;
    });
  }

  // 2. Order Type Filter
  if (ordersReportTypeFilter !== 'all') {
    list = list.filter(o => {
      const parsed = parseNotesMetadata(o.notes, o);
      return parsed.type === ordersReportTypeFilter || o.order_type === ordersReportTypeFilter;
    });
  }

  // 3. Payment Mode Filter
  if (ordersReportModeFilter !== 'all') {
    list = list.filter(o => {
      const parsed = parseNotesMetadata(o.notes, o);
      const mode = (parsed.paymentMode || o.payment_mode || 'cash').toLowerCase();
      return mode === ordersReportModeFilter;
    });
  }

  // 4. Status Filter
  if (ordersReportStatusFilter !== 'all') {
    if (ordersReportStatusFilter === 'delivered') {
      list = list.filter(o => o.status === 'delivered' || o.payment_status === 'paid');
    } else {
      list = list.filter(o => o.status === ordersReportStatusFilter);
    }
  }

  // 5. Search Filter
  if (ordersReportSearch) {
    const q = ordersReportSearch.toLowerCase().trim();
    list = list.filter(o => {
      const parsed = parseNotesMetadata(o.notes, o);
      return (
        String(o.order_number || '').includes(q) ||
        (o.customer_name && o.customer_name.toLowerCase().includes(q)) ||
        (o.customer_phone && o.customer_phone.includes(q)) ||
        String(parsed.tableNumber || o.table_number || '').toLowerCase().includes(q)
      );
    });
  }

  // Sort newest first
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // 6. Aggregate KPI Metrics using standard Restaurant GST calculation on Consolidated Bills
  const activeOrders = list.filter(o => o.status !== 'cancelled');
  let grossRev = 0;
  let taxableRev = 0;
  let cgstRev = 0;
  let sgstRev = 0;
  let taxCollected = 0;

  let tableOrdersCount = 0;
  let deliveryOrdersCount = 0;
  let upiRev = 0;
  let cashRev = 0;
  let cardRev = 0;
  let payLaterRev = 0;

  activeOrders.forEach(o => {
    const td = computeOrderTaxDetails(o);
    grossRev += td.grandTotal;
    taxableRev += td.taxableValue;
    cgstRev += td.cgstAmt;
    sgstRev += td.sgstAmt;
    taxCollected += td.totalGst;

    const parsed = parseNotesMetadata(o.notes, o);
    const type = parsed.type || o.order_type || 'table';
    if (type === 'table') tableOrdersCount++;
    else if (type === 'delivery') deliveryOrdersCount++;

    const mode = (parsed.paymentMode || o.payment_mode || 'cash').toLowerCase();
    const amt = td.grandTotal;
    if (mode === 'upi') upiRev += amt;
    else if (mode === 'cash') cashRev += amt;
    else if (mode === 'card') cardRev += amt;
    else payLaterRev += amt;
  });

  const totalOrdersCount = list.length;
  const aov = activeOrders.length > 0 ? (grossRev / activeOrders.length) : 0;

  return {
    list,
    activeOrders,
    grossRev,
    taxableRev,
    cgstRev,
    sgstRev,
    totalOrdersCount,
    tableOrdersCount,
    deliveryOrdersCount,
    upiRev,
    cashRev,
    cardRev,
    payLaterRev,
    taxCollected,
    aov
  };
}

function renderOrdersReportCharts(activeOrders) {
  // Chart 1: Sales Revenue Trend
  const canvasTrend = $('chart-orders-sales-trend');
  if (canvasTrend) {
    let labels = [];
    let data = [];

    if (ordersReportDateFilter === 'today' || ordersReportDateFilter === 'yesterday') {
      labels = ['8 AM', '10 AM', '12 PM', '2 PM', '4 PM', '6 PM', '8 PM', '10 PM', '12 AM'];
      const buckets = new Array(labels.length).fill(0);
      activeOrders.forEach(o => {
        const hour = new Date(o.created_at).getHours();
        const idx = Math.min(labels.length - 1, Math.max(0, Math.floor((hour - 6) / 2)));
        buckets[idx] += Number(o.total_amount || 0);
      });
      data = buckets;
    } else if (ordersReportDateFilter === 'week') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const now = new Date();
      labels = [];
      data = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        labels.push(days[d.getDay()]);
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const dayEnd = dayStart + 86400000;
        const daySum = activeOrders
          .filter(o => {
            const t = new Date(o.created_at).getTime();
            return t >= dayStart && t < dayEnd;
          })
          .reduce((s, o) => s + Number(o.total_amount || 0), 0);
        data.push(daySum);
      }
    } else {
      labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      data = MONTHS.map((_, i) => activeOrders.filter(o => new Date(o.created_at).getMonth() === i).reduce((s, o) => s + Number(o.total_amount || 0), 0));
    }

    if (ordersSalesTrendChartInstance) {
      ordersSalesTrendChartInstance.destroy();
    }

    ordersSalesTrendChartInstance = new Chart(canvasTrend, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Sales Revenue',
          data,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.08)',
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: '#10b981'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` Revenue: ₹${Number(ctx.raw || 0).toFixed(2)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 }, callback: (v) => `₹${v}` } }
        }
      }
    });
  }

  // Chart 2: Payment Mode Split
  const canvasPay = $('chart-orders-payment-split');
  if (canvasPay) {
    let upi = 0, cash = 0, card = 0, payLater = 0;
    activeOrders.forEach(o => {
      const parsed = parseNotesMetadata(o.notes, o);
      const mode = (parsed.paymentMode || o.payment_mode || 'cash').toLowerCase();
      const amt = Number(o.total_amount || 0);
      if (mode === 'upi') upi += amt;
      else if (mode === 'card') card += amt;
      else if (mode === 'pay_later') payLater += amt;
      else cash += amt;
    });

    const labels = ['📱 UPI', '💵 Cash', '💳 Card', '⏳ Pay Later'];
    const data = [upi, cash, card, payLater];
    const colors = ['#6366f1', '#10b981', '#06b6d4', '#f59e0b'];

    const hasData = data.some(v => v > 0);

    if (ordersPaySplitChartInstance) {
      ordersPaySplitChartInstance.destroy();
    }

    ordersPaySplitChartInstance = new Chart(canvasPay, {
      type: 'doughnut',
      data: {
        labels: hasData ? labels : ['No Data'],
        datasets: [{
          data: hasData ? data : [1],
          backgroundColor: hasData ? colors : ['#e2e8f0'],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ₹${Number(ctx.raw || 0).toFixed(2)}`
            }
          }
        },
        cutout: '65%'
      }
    });
  }
}

let isFetchingHistoricalOrders = false;
const historicalLoadedRanges = new Set();

async function ensureHistoricalOrdersForReport() {
  if (isFetchingHistoricalOrders) return;

  const now = new Date();
  let startIso = null;
  let endIso = null;
  let rangeKey = '';

  if (ordersReportDateFilter === 'week') {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    startIso = weekStart.toISOString();
    endIso = now.toISOString();
    rangeKey = `week_${getLocalDateString(weekStart)}`;
  } else if (ordersReportDateFilter === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    startIso = monthStart.toISOString();
    endIso = now.toISOString();
    rangeKey = `month_${now.getFullYear()}_${now.getMonth() + 1}`;
  } else if (ordersReportDateFilter === 'all') {
    rangeKey = 'all_orders';
  } else if (ordersReportDateFilter === 'custom' && ordersReportCustomStart) {
    const cStart = new Date(ordersReportCustomStart + 'T00:00:00');
    const cEnd = ordersReportCustomEnd ? new Date(ordersReportCustomEnd + 'T23:59:59.999') : new Date(ordersReportCustomStart + 'T23:59:59.999');
    startIso = cStart.toISOString();
    endIso = cEnd.toISOString();
    rangeKey = `custom_${ordersReportCustomStart}_${ordersReportCustomEnd || ordersReportCustomStart}`;
  }

  // If 'today' or 'yesterday', our recent loaded orders in memory are sufficient
  if (!rangeKey || historicalLoadedRanges.has(rangeKey)) return;

  // Check if current memory orders already stretch back far enough to cover startIso
  if (orders.length > 0 && startIso) {
    const oldestOrderDate = new Date(orders[orders.length - 1].created_at || Date.now());
    if (oldestOrderDate <= new Date(startIso)) {
      historicalLoadedRanges.add(rangeKey);
      return;
    }
  }

  isFetchingHistoricalOrders = true;
  try {
    let q = insforge.database
      .from('orders')
      .select(ORDER_SELECT_COLUMNS)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });

    if (startIso) q = q.gte('created_at', startIso);
    if (endIso) q = q.lte('created_at', endIso);

    const { data: histOrders, error } = await q;
    if (!error && Array.isArray(histOrders) && histOrders.length > 0) {
      // Merge into orders array deduplicating by ID
      const orderMap = new Map();
      orders.forEach(o => orderMap.set(String(o.id), o));
      histOrders.forEach(o => orderMap.set(String(o.id), o));
      orders = Array.from(orderMap.values()).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      // Fetch items for any orders missing from orderItems
      const knownItemOrderIds = new Set(orderItems.map(i => String(i.order_id)));
      const missingOrderIds = histOrders.map(o => String(o.id)).filter(id => !knownItemOrderIds.has(id));

      if (missingOrderIds.length > 0) {
        const CHUNK_SIZE = 150;
        for (let i = 0; i < missingOrderIds.length; i += CHUNK_SIZE) {
          const chunk = missingOrderIds.slice(i, i + CHUNK_SIZE);
          const { data: chunkItems, error: itemErr } = await insforge.database
            .from('order_items')
            .select('id, order_id, menu_item_id, item_name, quantity, unit_price, line_total, created_at')
            .in('order_id', chunk);
          if (!itemErr && Array.isArray(chunkItems) && chunkItems.length > 0) {
            orderItems = orderItems.concat(chunkItems);
          }
        }
      }

      historicalLoadedRanges.add(rangeKey);
    }
  } catch (err) {
    console.warn('[AdminReport] Warning fetching historical orders:', err);
  } finally {
    isFetchingHistoricalOrders = false;
  }
}

async function renderOrdersReport() {
  if (ordersReportDateFilter === 'week' || ordersReportDateFilter === 'month' || ordersReportDateFilter === 'all' || ordersReportDateFilter === 'custom') {
    await ensureHistoricalOrdersForReport();
  }
  const {
    list,
    activeOrders,
    grossRev,
    taxableRev,
    cgstRev,
    sgstRev,
    totalOrdersCount,
    tableOrdersCount,
    deliveryOrdersCount,
    upiRev,
    cashRev,
    taxCollected,
    aov
  } = computeOrdersReportData();

  // 1. KPI Cards
  if ($('ord-kpi-gross-rev')) $('ord-kpi-gross-rev').textContent = `₹${grossRev.toFixed(2)}`;
  if ($('ord-kpi-orders-count')) $('ord-kpi-orders-count').textContent = `${activeOrders.length} Settled Orders`;

  if ($('ord-kpi-total-orders')) $('ord-kpi-total-orders').textContent = `${totalOrdersCount} Orders`;
  if ($('ord-kpi-table-delivery-split')) $('ord-kpi-table-delivery-split').textContent = `${tableOrdersCount} Table · ${deliveryOrdersCount} Delivery`;

  if ($('ord-kpi-upi-cash')) $('ord-kpi-upi-cash').textContent = `₹${upiRev.toFixed(0)} / ₹${cashRev.toFixed(0)}`;
  const totalPay = upiRev + cashRev;
  const upiRatio = totalPay > 0 ? ((upiRev / totalPay) * 100).toFixed(0) : '0';
  const cashRatio = totalPay > 0 ? ((cashRev / totalPay) * 100).toFixed(0) : '0';
  if ($('ord-kpi-upi-cash-ratio')) $('ord-kpi-upi-cash-ratio').textContent = `UPI: ${upiRatio}% · Cash: ${cashRatio}%`;

  if ($('ord-kpi-tax-amt')) $('ord-kpi-tax-amt').textContent = `₹${taxCollected.toFixed(2)}`;
  if ($('ord-kpi-aov')) $('ord-kpi-aov').textContent = `₹${aov.toFixed(2)}`;

  // 2. Charts
  renderOrdersReportCharts(activeOrders);

  // 3. Summary Bar
  if ($('orders-report-count')) $('orders-report-count').textContent = `${list.length} ${list.length === 1 ? 'bill' : 'bills'}`;
  if ($('orders-report-amount')) $('orders-report-amount').textContent = `₹${grossRev.toFixed(2)}`;
  if ($('orders-report-tax-amt')) $('orders-report-tax-amt').textContent = `₹${taxCollected.toFixed(2)} (CGST ₹${cgstRev.toFixed(2)} + SGST ₹${sgstRev.toFixed(2)})`;

  // 4. Data Table
  const tbody = $('orders-report-table-body');
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:2.5rem;color:var(--adm-muted);">No consolidated orders match your selected filters.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(o => {
    const rawItems = getItemsForOrder(o.id);
    const taxDetails = computeOrderTaxDetails(o, rawItems);
    const items = taxDetails.items;
    const parsed = parseNotesMetadata(o.notes, o);
    const tableNum = parsed.tableNumber || o.table_number || '';
    const isTable = parsed.type === 'table';
    const typeLabel = isTable
      ? `<span style="background:#eef2ff;color:#4f46e5;padding:.15rem .5rem;border-radius:999px;font-weight:700;font-size:.75rem;">🪑 Table ${tableNum || '—'}</span>`
      : (parsed.type === 'delivery' ? '<span style="background:#eff6ff;color:#1d4ed8;padding:.15rem .5rem;border-radius:999px;font-weight:600;font-size:.75rem;">🚗 Delivery</span>' : '<span style="background:#fef3c7;color:#b45309;padding:.15rem .5rem;border-radius:999px;font-weight:600;font-size:.75rem;">🥡 Pickup</span>');

    const itemsSummary = items.length
      ? items.slice(0, 2).map(i => `${i.quantity || i.qty}× ${escapeHtml(i.item_name || i.name)}`).join(', ') + (items.length > 2 ? ` +${items.length - 2} more` : '')
      : '<span style="color:var(--adm-muted);">No items recorded</span>';

    const isPaid = o.payment_status === 'paid';
    const isCancelled = o.status === 'cancelled';
    const payModeStr = parsed.paymentMode || o.payment_mode || 'Cash/UPI';
    const payBadge = isPaid
      ? `<span style="background:#f0fdf4;color:#166534;font-size:0.75rem;font-weight:700;padding:.1rem .4rem;border-radius:4px;border:1px solid #bbf7d0;">Paid · ${escapeHtml(payModeStr)}</span>`
      : (isCancelled ? '<span style="background:#fee2e2;color:#b91c1c;font-size:0.75rem;font-weight:700;padding:.1rem .4rem;border-radius:4px;">Cancelled</span>' : '<span style="background:#fef2f2;color:#991b1b;font-size:0.75rem;font-weight:700;padding:.1rem .4rem;border-radius:4px;border:1px solid #fecaca;">Unpaid</span>');

    const d = new Date(o.created_at);
    const dateStr = d.toLocaleDateString('en-IN', { day:'2-digit', month:'short' }) + ', ' + d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });

    return `
      <tr>
        <td>
          <strong style="color:#111827;font-size:.88rem;">#${formatDailyOrderNumber(o)}</strong>
        </td>
        <td>
          <div style="font-weight:700;color:#111827;font-size:.85rem;">${escapeHtml(o.customer_name || 'Walk-in')}</div>
          <div style="font-size:.75rem;color:var(--adm-muted);">${escapeHtml(o.customer_phone || '—')}</div>
        </td>
        <td>${typeLabel}</td>
        <td style="max-width:200px;font-size:.8rem;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${items.map(i=>`${i.quantity || i.qty}x ${i.item_name || i.name}`).join(', ')}">
          ${itemsSummary}
        </td>
        <td>${payBadge}</td>
        <td style="text-align:right;font-size:.82rem;font-weight:600;color:#334155;">₹${taxDetails.taxableValue.toFixed(2)}</td>
        <td style="text-align:right;font-size:.82rem;color:#64748b;">₹${taxDetails.cgstAmt.toFixed(2)}</td>
        <td style="text-align:right;font-size:.82rem;color:#64748b;">₹${taxDetails.sgstAmt.toFixed(2)}</td>
        <td style="text-align:right;font-size:.82rem;font-weight:700;color:#4f46e5;">₹${taxDetails.totalGst.toFixed(2)}</td>
        <td style="text-align:right;">
          <strong style="font-size:.9rem;color:${isCancelled ? '#9ca3af' : '#059669'};">₹${taxDetails.grandTotal.toFixed(2)}</strong>
        </td>
        <td style="font-size:.78rem;color:var(--adm-muted);">${dateStr}</td>
        <td style="text-align:right;">
          <button type="button" class="adm-btn adm-btn-outline adm-btn-sm ord-rep-print-btn" data-id="${o.id}" style="font-size:.75rem;padding:.25rem .55rem;" title="Print bill receipt">
            🧾 Bill
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.ord-rep-print-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const order = orders.find(o => String(o.id) === String(btn.dataset.id));
      if (!order) return;
      await printOrderReceiptWithTax(order);
    });
  });
}

// Alias for backwards compatibility
function renderAnalytics() {
  renderOrdersReport();
}

async function exportOrdersReportCSV() {
  await ensureHistoricalOrdersForReport();
  const { list } = computeOrdersReportData();
  if (!list.length) {
    showAdminToast('No orders data to export.', 'error');
    return;
  }

  const headers = [
    'Invoice / Bill No',
    'Invoice Date',
    'Invoice Time',
    'Customer Name',
    'Customer Phone',
    'Order Channel',
    'Table No',
    'Payment Mode',
    'Payment Status',
    'Consolidated Items',
    'Food Base Subtotal (INR)',
    'Discount (INR)',
    'Taxable Value (INR)',
    'CGST Rate (%)',
    'CGST Amount (INR)',
    'SGST Rate (%)',
    'SGST Amount (INR)',
    'Total GST (5%) (INR)',
    'Delivery Charges (INR)',
    'Invoice Grand Total (INR)',
    'Status'
  ];

  const rows = list.map(o => {
    const td = computeOrderTaxDetails(o);
    const parsed = parseNotesMetadata(o.notes, o);
    const d = new Date(o.created_at);
    const dateStr = d.toLocaleDateString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const itemsStr = td.items.map(i => `${i.quantity || i.qty}x ${i.item_name || i.name} @ ₹${(i.unit_price || i.price).toFixed(2)}`).join('; ');

    return [
      `"${formatDailyOrderNumber(o)}"`,
      `"${dateStr}"`,
      `"${timeStr}"`,
      `"${(o.customer_name || 'Walk-in').replace(/"/g, '""')}"`,
      `"${o.customer_phone || ''}"`,
      `"${parsed.type || o.order_type || 'table'}"`,
      `"${parsed.tableNumber || o.table_number || ''}"`,
      `"${parsed.paymentMode || o.payment_mode || 'Cash/UPI'}"`,
      `"${o.payment_status || 'paid'}"`,
      `"${itemsStr.replace(/"/g, '""')}"`,
      `"${td.subtotal.toFixed(2)}"`,
      `"${td.discountAmt.toFixed(2)}"`,
      `"${td.taxableValue.toFixed(2)}"`,
      `"${td.cgstRate}%"`,
      `"${td.cgstAmt.toFixed(2)}"`,
      `"${td.sgstRate}%"`,
      `"${td.sgstAmt.toFixed(2)}"`,
      `"${td.totalGst.toFixed(2)}"`,
      `"${td.deliveryFee.toFixed(2)}"`,
      `"${td.grandTotal.toFixed(2)}"`,
      `"${o.status}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `LIMRA_Restaurant_GST_Audit_Report_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAdminToast('Orders sales & GST report exported to Excel CSV! 📥', 'success');
}

function initOrdersReportListeners() {
  // Date Preset Buttons
  $('orders-report-date-presets')?.querySelectorAll('.pos-cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      $('orders-report-date-presets').querySelectorAll('.pos-cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ordersReportDateFilter = btn.dataset.range;
      const customWrap = $('orders-report-custom-date-wrap');
      if (customWrap) customWrap.style.display = ordersReportDateFilter === 'custom' ? 'flex' : 'none';
      if (ordersReportDateFilter !== 'custom') renderOrdersReport();
    });
  });

  // Custom Date Apply
  $('orders-report-apply-custom-date')?.addEventListener('click', () => {
    ordersReportCustomStart = $('orders-report-start-date')?.value || null;
    ordersReportCustomEnd = $('orders-report-end-date')?.value || null;
    renderOrdersReport();
  });

  // Filters & Search
  $('orders-report-type-filter')?.addEventListener('change', (e) => {
    ordersReportTypeFilter = e.target.value;
    renderOrdersReport();
  });

  $('orders-report-mode-filter')?.addEventListener('change', (e) => {
    ordersReportModeFilter = e.target.value;
    renderOrdersReport();
  });

  $('orders-report-status-filter')?.addEventListener('change', (e) => {
    ordersReportStatusFilter = e.target.value;
    renderOrdersReport();
  });

  $('orders-report-search')?.addEventListener('input', (e) => {
    ordersReportSearch = e.target.value;
    renderOrdersReport();
  });

  $('orders-report-export-btn')?.addEventListener('click', exportOrdersReportCSV);
}

// ── Dashboard Date Search & Summary ──────────────────────────

let activeDashDatePreset = 'today';

function getLocalDateString(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDashDateRange() {
  const customDateVal = $('dash-date-input')?.value;
  if (customDateVal) {
    const formatted = new Date(customDateVal + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return {
      type: 'single',
      dateStr: customDateVal,
      label: `Selected Date: ${formatted}`
    };
  }

  const now = new Date();
  const todayStr = getLocalDateString(now);

  if (activeDashDatePreset === 'today') {
    const formatted = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return { type: 'single', dateStr: todayStr, label: `Summary for Today (${formatted})` };
  }

  if (activeDashDatePreset === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const yStr = getLocalDateString(y);
    const formatted = y.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return { type: 'single', dateStr: yStr, label: `Summary for Yesterday (${formatted})` };
  }

  if (activeDashDatePreset === 'week') {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const startFmt = start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const endFmt = end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return { type: 'range', start, end, label: `Summary for Last 7 Days (${startFmt} – ${endFmt})` };
  }

  if (activeDashDatePreset === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const monthFmt = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    return { type: 'range', start, end, label: `Summary for ${monthFmt}` };
  }

  return { type: 'all', label: 'Summary for All Time' };
}

function renderDashboardDateFilter() {
  const range = getDashDateRange();
  let filtered = [];

  if (range.type === 'single') {
    filtered = orders.filter(o => getLocalDateString(o.created_at) === range.dateStr);
  } else if (range.type === 'range') {
    filtered = orders.filter(o => {
      const d = new Date(o.created_at);
      return d >= range.start && d <= range.end;
    });
  } else {
    filtered = [...orders];
  }

  const validOrders = filtered.filter(o => o.status !== 'cancelled');
  const totalCount = filtered.length;
  const totalAmount = validOrders.reduce((sum, o) => sum + getEffectiveOrderTotal(o), 0);
  const paidAmount = validOrders.filter(o => o.payment_status === 'paid').reduce((sum, o) => sum + getEffectiveOrderTotal(o), 0);
  const unpaidAmount = validOrders.filter(o => o.payment_status === 'unpaid' || !o.payment_status).reduce((sum, o) => sum + getEffectiveOrderTotal(o), 0);
  const onlineCount = filtered.filter(o => o.order_type !== 'table').length;
  const tableCount = filtered.filter(o => o.order_type === 'table').length;

  if ($('dash-date-summary-label')) $('dash-date-summary-label').textContent = range.label;
  if ($('dash-date-order-count')) $('dash-date-order-count').textContent = `${totalCount} order${totalCount === 1 ? '' : 's'}`;
  if ($('dash-date-order-amount')) $('dash-date-order-amount').textContent = fmtMoney(totalAmount);
  if ($('dash-date-paid-amount')) $('dash-date-paid-amount').textContent = fmtMoney(paidAmount);
  if ($('dash-date-unpaid-amount')) $('dash-date-unpaid-amount').textContent = fmtMoney(unpaidAmount);
  if ($('dash-date-type-breakdown')) $('dash-date-type-breakdown').textContent = `${onlineCount} Online · ${tableCount} Table`;

  // Render preview table rows
  const tbody = $('dash-date-orders-table-body');
  if (tbody) {
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="adm-empty">No orders found for this date selection</td></tr>`;
    } else {
      const previewPage = filtered.slice(0, 15);
      tbody.innerHTML = previewPage.map(order => {
        const parsedMeta = parseNotesMetadata(order.notes, order);
        let typeText = '🥡 Pickup';
        if (parsedMeta.type === 'delivery') {
          typeText = '🚗 Delivery';
        } else if (parsedMeta.type === 'table') {
          typeText = `🍽️ Table ${parsedMeta.tableNumber}`;
        }
        const timeStr = new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        const dateStr = fmtDateShort(order.created_at);

        return `
          <tr class="dash-date-order-row" data-order-id="${order.id}" style="cursor: pointer;">
            <td><strong>#${order.order_number}</strong></td>
            <td><strong>${escapeHtml(order.customer_name)}</strong> <br/><span class="adm-info-muted" style="font-size: 11px;">${order.customer_phone}</span></td>
            <td><span class="adm-badge" style="font-size: 11px;">${typeText}</span></td>
            <td><strong style="color: var(--adm-green);">${fmtMoney(getEffectiveOrderTotal(order))}</strong></td>
            <td>${statusPill(order.status, parsedMeta.type === 'table')}</td>
            <td>${paymentStatusPill(order.payment_status || 'unpaid')}</td>
            <td>${dateStr} <br/><span class="adm-info-muted" style="font-size: 11px;">${timeStr}</span></td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.dash-date-order-row').forEach(row => {
        row.addEventListener('click', () => {
          const id = row.dataset.orderId;
          if (id) openOrderDetail(id);
        });
      });
    }
  }
}

function updateDashboardHeader() {
  const dateEl = $('dash-current-date');
  const shiftEl = $('dash-active-shift');
  const staffEl = $('dash-staff-user');
  const now = new Date();

  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  if (shiftEl) {
    const hr = now.getHours();
    if (hr >= 11 && hr < 17) {
      shiftEl.innerHTML = '<span class="shift-dot lunch"></span> Lunch Shift';
      shiftEl.className = 'dash-shift-pill lunch';
    } else if (hr >= 17 && hr <= 23) {
      shiftEl.innerHTML = '<span class="shift-dot dinner"></span> Dinner Shift';
      shiftEl.className = 'dash-shift-pill dinner';
    } else {
      shiftEl.innerHTML = '<span class="shift-dot prep"></span> Prep / Late Shift';
      shiftEl.className = 'dash-shift-pill prep';
    }
  }

  if (staffEl) {
    const name = currentAdminUser?.name || 'Salim Khan';
    const role = (currentAdminUser?.role || 'Manager').toUpperCase();
    staffEl.textContent = `👤 ${name} (${role})`;
  }

  if ($('last-updated')) {
    $('last-updated').textContent = `Updated ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  }
}
window.updateDashboardHeader = updateDashboardHeader;

function formatTimeAgo(dateInput) {
  if (!dateInput) return 'just now';
  const diffMs = Date.now() - new Date(dateInput).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

function renderActionableTables() {
  const container = $('dash-actionable-tables-list');
  const badge = $('dash-actionable-tables-badge');
  if (!container) return;

  const tableSessions = getActiveTableSessions();
  const unpaidTableBills = typeof getOutstandingBills === 'function' ? getOutstandingBills('table') : getOutstandingTableBills();
  const nowMs = Date.now();

  const actionableList = [];

  // 1. Add active seated table sessions
  tableSessions.forEach(sess => {
    const primaryOrder = sess.orders && sess.orders[0];
    const totalAmt = sess.orders.reduce((sum, o) => sum + getEffectiveOrderTotal(o), 0);
    const orderCount = sess.orders.length;
    const firstCreated = sess.orders.reduce((earliest, o) => {
      const t = o.created_at ? new Date(o.created_at).getTime() : nowMs;
      return Math.min(earliest, t);
    }, nowMs);
    const elapsedMins = Math.max(0, Math.floor((nowMs - firstCreated) / 60000));
    const customerName = primaryOrder?.customer_name && primaryOrder.customer_name !== 'Customer' ? primaryOrder.customer_name : 'Walk-in Guest';

    actionableList.push({
      type: 'session',
      tableNumber: sess.tableNumber,
      zone: sess.zone || `Table ${sess.tableNumber}`,
      primaryOrderId: primaryOrder?.id,
      customerName,
      elapsedMins,
      orderCount,
      totalAmt,
      isBilled: false,
      session: sess,
      order: primaryOrder
    });
  });

  // 2. Add unpaid printed table bills if not already represented in active sessions
  unpaidTableBills.forEach(bill => {
    const parsedMeta = parseNotesMetadata(bill.notes, bill);
    const tNum = parseInt(String(parsedMeta.tableNumber || bill.table_number || '').replace(/\D/g, ''), 10);
    if (!tNum || actionableList.some(item => item.tableNumber === tNum)) return;

    const billCreated = bill.created_at ? new Date(bill.created_at).getTime() : nowMs;
    const elapsedMins = Math.max(0, Math.floor((nowMs - billCreated) / 60000));
    const customerName = bill.customer_name && bill.customer_name !== 'Customer' ? bill.customer_name : 'Dine-In Guest';

    actionableList.push({
      type: 'bill',
      tableNumber: tNum,
      zone: bill.table_zone || `Table ${tNum}`,
      primaryOrderId: bill.id,
      customerName,
      elapsedMins,
      orderCount: 1,
      totalAmt: getEffectiveOrderTotal(bill),
      isBilled: true,
      order: bill
    });
  });

  // Sort by table number ascending
  actionableList.sort((a, b) => a.tableNumber - b.tableNumber);

  if (badge) {
    badge.textContent = `${actionableList.length} Active`;
  }

  if (actionableList.length === 0) {
    container.innerHTML = `
      <div class="dash-ops-empty">
        <div class="dash-ops-empty-icon">🪑</div>
        <p class="dash-ops-empty-title">All tables available</p>
        <p class="dash-ops-empty-sub">Ready to seat incoming restaurant guests</p>
      </div>
    `;
    return;
  }

  container.innerHTML = actionableList.map(item => {
    const stateClass = item.isBilled ? 'billed' : 'seated';
    const stateLabel = item.isBilled ? 'Bill Printed' : `Seated ${item.elapsedMins}m`;
    const pillClass = item.isBilled ? 'dash-tnum-pill billed' : 'dash-tnum-pill';

    return `
      <div class="dash-table-item">
        <div class="dash-table-item-left">
          <span class="${pillClass}">T-${item.tableNumber}</span>
          <div class="dash-table-meta-text">
            <strong class="dash-table-guest-name">${escapeHtml(item.customerName)}</strong>
            <span class="dash-table-details-sub">${item.zone} · ${item.orderCount} order${item.orderCount > 1 ? 's' : ''}</span>
          </div>
        </div>
        <div class="dash-table-item-right">
          <div class="dash-table-price-wrap">
            <strong class="dash-table-price">${fmtMoney(item.totalAmt)}</strong>
            <span class="dash-table-state-tag ${stateClass}">${stateLabel}</span>
          </div>
          <div class="dash-table-btns">
            <button type="button" class="dash-tbl-btn resume" data-action="resume-table" data-order-id="${item.primaryOrderId || ''}" data-table-num="${item.tableNumber}" title="Open Table in POS Workstation">
              ✏️ Resume
            </button>
            <button type="button" class="dash-tbl-btn settle" data-action="settle-table" data-order-id="${item.primaryOrderId || ''}" data-table-num="${item.tableNumber}" title="Settle Bill">
              💳 Settle
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Bind Resume and Settle action buttons
  container.querySelectorAll('.dash-tbl-btn[data-action="resume-table"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const orderId = btn.dataset.orderId;
      if (orderId) {
        loadHoldOrderToPos(orderId);
      } else {
        switchPanel('order-detail');
      }
    });
  });

  container.querySelectorAll('.dash-tbl-btn[data-action="settle-table"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tNum = parseInt(btn.dataset.tableNum, 10);
      const orderId = btn.dataset.orderId;
      const sess = tableSessions.find(s => s.tableNumber === tNum);
      if (sess) {
        openHoldSettleModal({ type: 'table', tableNumber: tNum, session: sess });
      } else if (orderId) {
        const ord = orders.find(o => o.id === orderId);
        if (ord) openHoldSettleModal(ord);
      }
    });
  });
}
window.renderActionableTables = renderActionableTables;

function renderLiveOrdersStream() {
  const container = $('dash-live-orders-stream');
  const badge = $('dash-live-orders-badge');
  if (!container) return;

  const now = new Date();
  const todayStr = getLocalDateString(now);

  // Get active or recent orders of today (exclude cancelled)
  const streamOrders = orders.filter(o => {
    if (o.status === 'cancelled' || o.ticket_status === 'CANCELLED') return false;
    return getLocalDateString(o.created_at) === todayStr;
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const activeCount = streamOrders.filter(o => o.status !== 'delivered' && o.ticket_status !== 'CLOSED').length;
  if (badge) {
    badge.textContent = `${activeCount > 0 ? activeCount : streamOrders.length} Active`;
  }

  const displayOrders = streamOrders.slice(0, 5);

  if (displayOrders.length === 0) {
    container.innerHTML = `
      <div class="dash-ops-empty">
        <div class="dash-ops-empty-icon">⚡</div>
        <p class="dash-ops-empty-title">No orders yet today</p>
        <p class="dash-ops-empty-sub">New orders will appear here in real-time</p>
      </div>
    `;
    return;
  }

  container.innerHTML = displayOrders.map(o => {
    const meta = parseNotesMetadata(o.notes, o);
    const orderNum = formatDailyOrderNumber(o);
    const timeAgo = formatTimeAgo(o.created_at);
    const totalAmt = getEffectiveOrderTotal(o);

    let chanClass = 'pickup';
    let chanText = '🥡 Takeaway';
    if (meta.type === 'table' || o.order_type === 'table') {
      chanClass = 'table';
      chanText = `🍽️ T-${meta.tableNumber || o.table_number || '—'}`;
    } else if (meta.type === 'delivery' || o.order_type === 'delivery') {
      chanClass = 'delivery';
      chanText = '🛵 Delivery';
    }

    const custName = o.customer_name && o.customer_name !== 'Customer' ? o.customer_name : (meta.type === 'table' ? 'Table Guest' : 'Walk-in');

    // Items brief preview
    const items = getItemsForOrder(o.id);
    const itemsCount = items.reduce((s, it) => s + Number(it.quantity || 1), 0);
    const itemsNames = items.slice(0, 2).map(it => `${it.quantity}x ${it.item_name}`).join(', ');
    const itemsSummary = itemsCount > 0 ? `${itemsCount} item${itemsCount > 1 ? 's' : ''}${itemsNames ? ` (${itemsNames}${items.length > 2 ? '…' : ''})` : ''}` : 'Order logged';

    return `
      <div class="dash-live-order-item" data-order-id="${o.id}">
        <div class="dash-live-order-left">
          <div class="dash-live-order-head">
            <span class="dash-live-order-num">#${orderNum}</span>
            <span class="dash-order-chan-badge ${chanClass}">${chanText}</span>
            <span class="dash-live-order-time">${timeAgo}</span>
          </div>
          <div class="dash-live-order-cust">
            <strong>${escapeHtml(custName)}</strong> · <span>${escapeHtml(itemsSummary)}</span>
          </div>
        </div>
        <div class="dash-live-order-right">
          <strong class="dash-live-order-price">${fmtMoney(totalAmt)}</strong>
          ${statusPill(o.status, meta.type === 'table')}
        </div>
      </div>
    `;
  }).join('');

  // Bind Row Click to open Order Detail Drawer
  container.querySelectorAll('.dash-live-order-item').forEach(item => {
    item.addEventListener('click', () => {
      const orderId = item.dataset.orderId;
      if (orderId) openOrderDetail(orderId);
    });
  });
}
window.renderLiveOrdersStream = renderLiveOrdersStream;

function renderOverview() {
  updateDashboardHeader();
  renderStats();
  renderActionableTables();
  renderLiveOrdersStream();
  renderDonuts();
  renderCharts();
  renderDashboardDateFilter();
  try {
    initDashboardMap();
    renderDashboardMapMarkers();
  } catch (err) {
    console.warn('Dashboard map rendering failed:', err);
  }
}

function initDashboardMap() {
  const mapContainer = $('dashboard-deliveries-map');
  if (!mapContainer || dashboardMap) return;

  try {
    const limraCoords = [21.8603074, 87.4793798];
    dashboardMap = L.map('dashboard-deliveries-map', {
      zoomControl: true,
      scrollWheelZoom: true
    }).setView(limraCoords, 13);

    // Layer control
    const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(dashboardMap);

    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri'
    });

    L.control.layers({
      "Street Map": streetLayer,
      "Satellite": satelliteLayer
    }, null, { position: 'topright' }).addTo(dashboardMap);

    // Add restaurant marker (Gold)
    const restaurantIcon = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });
    L.marker(limraCoords, { icon: restaurantIcon }).addTo(dashboardMap).bindPopup('<b>LIMRA Restaurant (Kitchen)</b>');

    dashboardMarkersGroup = L.layerGroup().addTo(dashboardMap);
    
    // Expose window action for popup View Details buttons
    window.adminOpenOrder = (orderId) => {
      openOrderDetail(orderId);
    };

    // Attach filter button listeners
    const allBtn = $('map-filter-all');
    const pendingBtn = $('map-filter-pending');
    const prepBtn = $('map-filter-preparing');

    const setMapFilter = (filter) => {
      activeMapFilter = filter;
      [allBtn, pendingBtn, prepBtn].forEach(btn => {
        if (btn) {
          btn.classList.remove('active');
          btn.style.background = '#f5f7fa';
          btn.style.color = 'var(--adm-text)';
        }
      });
      const activeBtn = filter === 'all' ? allBtn : (filter === 'pending' ? pendingBtn : prepBtn);
      if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.background = 'var(--adm-green)';
        activeBtn.style.color = '#fff';
      }
      renderDashboardMapMarkers();
    };

    allBtn?.addEventListener('click', () => setMapFilter('all'));
    pendingBtn?.addEventListener('click', () => setMapFilter('pending'));
    prepBtn?.addEventListener('click', () => setMapFilter('preparing'));

  } catch (err) {
    console.error('Error initializing dashboard map:', err);
  }
}

function renderDashboardMapMarkers() {
  if (!dashboardMap || !dashboardMarkersGroup) return;

  dashboardMarkersGroup.clearLayers();

  const limraCoords = [21.8603074, 87.4793798];
  const bounds = [limraCoords];

  // Filter orders matching activeMapFilter & has coordinates
  const activeOrders = orders.filter(o => {
    const meta = parseNotesMetadata(o.notes, o);
    if (meta.type !== 'delivery') return false;
    if (o.latitude === null || o.longitude === null) return false;

    if (activeMapFilter === 'all') {
      return ['pending', 'confirmed', 'preparing', 'ready'].includes(o.status);
    } else if (activeMapFilter === 'pending') {
      return o.status === 'pending';
    } else if (activeMapFilter === 'preparing') {
      return ['confirmed', 'preparing', 'ready'].includes(o.status);
    }
    return false;
  });

  activeOrders.forEach(order => {
    const lat = parseFloat(order.latitude);
    const lng = parseFloat(order.longitude);
    const orderCoords = [lat, lng];
    bounds.push(orderCoords);

    const icon = getMarkerIconForStatus(order.status);
    const marker = L.marker(orderCoords, { icon });

    const popupContent = `
      <div style="font-family: 'Inter', sans-serif; font-size: 12px; line-height: 1.4; min-width: 160px; padding: 4px;">
        <h4 style="margin: 0 0 6px 0; font-weight: 700; color: var(--adm-text);">Order #${order.order_number}</h4>
        <p style="margin: 0 0 3px 0;"><b>Customer:</b> ${escapeHtml(order.customer_name)}</p>
        <p style="margin: 0 0 3px 0;"><b>Status:</b> ${statusPill(order.status)}</p>
        <p style="margin: 0 0 3px 0;"><b>Amount:</b> ${fmtMoney(order.total_amount)}</p>
        <p style="margin: 0 0 8px 0;"><b>Phone:</b> <a href="tel:${order.customer_phone}">${order.customer_phone}</a></p>
        <button class="adm-btn adm-btn-primary adm-btn-sm" style="width: 100%; font-size: 10px; padding: 4px 6px; border-radius: 6px; cursor: pointer; text-align: center; display: block;" onclick="window.adminOpenOrder('${order.id}')">View Details</button>
      </div>
    `;

    marker.bindPopup(popupContent);
    dashboardMarkersGroup.addLayer(marker);
  });

  // Fit bounds if we have delivery points
  if (bounds.length > 1) {
    try {
      dashboardMap.fitBounds(L.latLngBounds(bounds), { padding: [50, 50] });
    } catch (e) {
      console.warn('Map fitBounds failed:', e);
    }
  } else {
    dashboardMap.setView(limraCoords, 13);
  }
}

function getMarkerIconForStatus(status) {
  let color = 'blue';
  if (status === 'pending') color = 'orange';
  else if (status === 'confirmed') color = 'yellow';
  else if (status === 'preparing') color = 'blue';
  else if (status === 'ready') color = 'violet';
  else if (status === 'delivered') color = 'green';
  else if (status === 'cancelled') color = 'red';

  return L.icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });
}

// ── Orders table ────────────────────────────────────────

function getFilteredOrders() {
  const statusFilter = $('orders-status-filter')?.value || 'all';
  const paymentFilter = $('orders-payment-filter')?.value || 'all';
  const dateFilter = $('orders-date-filter')?.value || '';
  const search = ($('orders-search')?.value || getGlobalSearch()).toLowerCase().trim();
  
  // Unified Order List: displays all orders from Table System and Website (Delivery & Pickup)
  let filtered = [...orders];

  if (statusFilter !== 'all') {
    if (statusFilter === 'hold') {
      filtered = filtered.filter(o => o.status === 'hold' || o.status === 'merged');
    } else {
      filtered = filtered.filter(o => o.status === statusFilter);
    }
  }
  
  if (paymentFilter === 'paid') {
    filtered = filtered.filter(o => o.payment_status === 'paid');
  } else if (paymentFilter === 'unpaid') {
    filtered = filtered.filter(o => o.payment_status === 'unpaid' || !o.payment_status);
  } else if (paymentFilter === 'today_paid') {
    const todayStr = new Date().toDateString();
    filtered = filtered.filter(o => o.payment_status === 'paid' && new Date(o.created_at).toDateString() === todayStr);
  } else if (paymentFilter === 'today_unpaid') {
    const todayStr = new Date().toDateString();
    filtered = filtered.filter(o => (o.payment_status === 'unpaid' || !o.payment_status) && new Date(o.created_at).toDateString() === todayStr);
  }

  if (dateFilter) {
    filtered = filtered.filter(o => getLocalDateString(o.created_at) === dateFilter);
  }

  if (activeOrderTypeFilter === 'online') {
    filtered = filtered.filter(o => {
      const meta = parseNotesMetadata(o.notes, o);
      return meta.type === 'delivery' || (!meta.type && o.order_type !== 'table');
    });
  } else if (activeOrderTypeFilter === 'table') {
    filtered = filtered.filter(o => {
      const meta = parseNotesMetadata(o.notes, o);
      return meta.type === 'table' || o.order_type === 'table' || Boolean(meta.tableNumber || o.table_number);
    });
  } else if (activeOrderTypeFilter === 'pickup') {
    filtered = filtered.filter(o => {
      const meta = parseNotesMetadata(o.notes, o);
      return meta.type === 'pickup' || o.order_type === 'pickup';
    });
  }
  
  if (search) {
    filtered = filtered.filter(o => {
      const items = getItemsForOrder(o.id);
      const itemsText = items.map(i => i.item_name).join(' ').toLowerCase();
      const meta = parseNotesMetadata(o.notes, o);
      const tableStr = String(meta.tableNumber || o.table_number || '').toLowerCase();
      return (
        (o.customer_name && o.customer_name.toLowerCase().includes(search)) ||
        (o.customer_phone && o.customer_phone.includes(search)) ||
        String(o.order_number).includes(search) ||
        formatDailyOrderNumber(o).includes(search) ||
        tableStr.includes(search) ||
        itemsText.includes(search) ||
        getLocalDateString(o.created_at).includes(search) ||
        new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase().includes(search)
      );
    });
  }
  return filtered;
}

function renderOrdersTable() {
  // Update 4 KPI Stat Cards
  const totalReceived = orders.length;
  let onlineCount = 0;
  let tableCount = 0;
  let activeInKitchenCount = 0;

  orders.forEach(o => {
    const meta = parseNotesMetadata(o.notes, o);
    const isTable = meta.type === 'table' || o.order_type === 'table';
    if (isTable) {
      tableCount++;
    } else {
      onlineCount++;
    }

    if (['pending', 'confirmed', 'preparing', 'ready', 'hold'].includes(o.status)) {
      activeInKitchenCount++;
    }
  });

  if ($('orders-kpi-total')) $('orders-kpi-total').textContent = `${totalReceived} Orders`;
  if ($('orders-kpi-online')) $('orders-kpi-online').textContent = `${onlineCount} Deliveries`;
  if ($('orders-kpi-table')) $('orders-kpi-table').textContent = `${tableCount} Table Orders`;
  if ($('orders-kpi-active')) $('orders-kpi-active').textContent = `${activeInKitchenCount} In-Kitchen`;

  const filtered = getFilteredOrders();

  // Update Orders Summary Bar
  const summaryCountEl = $('orders-summary-count');
  const summaryAmountEl = $('orders-summary-amount');
  const activeDateBadge = $('orders-date-active-label');
  
  const totalAmount = filtered
    .filter(o => o.status !== 'cancelled')
    .reduce((s, o) => s + Number(o.total_amount || 0), 0);

  if (summaryCountEl) summaryCountEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'order' : 'orders'}`;
  if (summaryAmountEl) summaryAmountEl.textContent = fmtMoney(totalAmount);

  const dateVal = $('orders-date-filter')?.value || '';
  if (activeDateBadge) {
    if (dateVal) {
      const formattedDate = new Date(dateVal + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      activeDateBadge.textContent = `📅 ${formattedDate}`;
      show(activeDateBadge);
    } else {
      hide(activeDateBadge);
    }
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / ORDERS_PER_PAGE));
  if (ordersPage > totalPages) ordersPage = totalPages;
  const start = (ordersPage - 1) * ORDERS_PER_PAGE;
  const page = filtered.slice(start, start + ORDERS_PER_PAGE);

  // Lazily ensure order_items are loaded for visible page orders if any were not in the initial active scope
  const missingPageOrderIds = page
    .map(o => String(o.id))
    .filter(id => id && !loadedItemOrderIds.has(id) && !orderItems.some(i => String(i.order_id) === id));
  if (missingPageOrderIds.length > 0) {
    ensureOrderItemsLoaded(missingPageOrderIds).then((didLoad) => {
      if (didLoad && getActivePanelId() === 'orders') {
        renderOrdersTable();
      }
    });
  }

  const tbody = $('orders-table-body');
  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="adm-empty" style="text-align:center;padding:2.5rem;color:var(--adm-muted);">No orders match your filter criteria</td></tr>`;
  } else {
    tbody.innerHTML = page.map(order => {
      const parsedMeta = parseNotesMetadata(order.notes, order);
      const isTable = parsedMeta.type === 'table' || order.order_type === 'table';
      const roundInfo = getOrderRoundInfo(order);
      const items = getItemsForOrder(order.id);
      
      let typeBadge = '<span style="background:#e0f2fe;color:#0284c7;font-size:0.75rem;font-weight:700;padding:.15rem .45rem;border-radius:6px;">🚗 Online Delivery</span>';
      if (isTable) {
        typeBadge = `<span style="background:#fef3c7;color:#b45309;font-size:0.75rem;font-weight:700;padding:.15rem .45rem;border-radius:6px;">🪑 Table ${parsedMeta.tableNumber || order.table_number || '—'}</span>`;
      } else if (parsedMeta.type === 'pickup' || order.order_type === 'pickup') {
        typeBadge = '<span style="background:#f3e8ff;color:#7e22ce;font-size:0.75rem;font-weight:700;padding:.15rem .45rem;border-radius:6px;">🥡 Pickup</span>';
      }

      const itemsSummary = items.length > 0
        ? items.slice(0, 2).map(i => `${i.quantity}x ${i.item_name}`).join(', ') + (items.length > 2 ? ` +${items.length - 2} more` : '')
        : 'Dishes in order';

      return `
        <tr data-order-id="${order.id}">
          <td style="width:36px;padding-left:1rem;text-align:center;" onclick="event.stopPropagation();">
            <input type="checkbox" class="order-row-checkbox" data-order-id="${order.id}" style="cursor:pointer;width:16px;height:16px;accent-color:#ef4444;" />
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
              <strong style="font-size:.95rem;color:#1e293b;">#${formatDailyOrderNumber(order)}</strong>
              ${roundInfo.isTable && roundInfo.roundNumber ? `
                <span style="font-size:0.75rem;font-weight:800;padding:.12rem .45rem;border-radius:6px;background:${roundInfo.roundNumber > 1 ? '#ede9fe' : '#f1f5f9'};color:${roundInfo.roundNumber > 1 ? '#6d28d9' : '#475569'};border:1px solid ${roundInfo.roundNumber > 1 ? '#ddd6fe' : '#e2e8f0'};">
                  Round ${roundInfo.roundNumber}
                </span>
              ` : ''}
            </div>
            <div style="margin-top:2px;">${typeBadge}</div>
          </td>
          <td>
            <div style="font-weight:700;color:#1e293b;">${escapeHtml(order.customer_name || 'Customer')}</div>
            <a href="tel:${order.customer_phone}" style="color:var(--adm-muted);font-size:0.78rem;text-decoration:none;">${order.customer_phone || '—'}</a>
          </td>
          <td>
            <div style="font-size:0.8rem;color:#334155;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(items.map(i => `${i.quantity}x ${i.item_name}`).join(', '))}">
              🍽️ ${escapeHtml(itemsSummary)}
            </div>
            <div style="font-size:0.75rem;color:var(--adm-muted);">${items.length} item(s)</div>
          </td>
          <td>
            <strong style="font-size:1rem;color:#1e293b;">${fmtMoney(order.total_amount)}</strong>
          </td>
          <td>${statusPill(order.status, isTable)}</td>
          <td>${paymentStatusPill(order.payment_status || 'unpaid')}</td>
          <td style="font-size:0.8rem;color:var(--adm-muted);">${fmtDateShort(order.created_at)}</td>
          <td style="text-align:right;padding-right:1.25rem;">
            <div style="display:inline-flex;gap:0.35rem;align-items:center;justify-content:flex-end;flex-wrap:wrap;">
              <!-- ⏸️ / ▶️ MANUAL HOLD / RELEASE ACTION BUTTON -->
              ${order.status === 'hold' ? `
                <button type="button" class="adm-btn adm-btn-outline adm-btn-sm toggle-hold-order-btn" data-order-id="${order.id}" data-action="release" style="color:#d97706;border-color:#fde68a;background:#fffbeb;padding:.3rem .55rem;font-size:0.75rem;font-weight:700;" title="Release Hold and send to Kitchen">
                  ▶️ Release
                </button>
              ` : (!['delivered', 'cancelled'].includes(order.status) ? `
                <button type="button" class="adm-btn adm-btn-outline adm-btn-sm toggle-hold-order-btn" data-order-id="${order.id}" data-action="hold" style="color:#4b5563;border-color:#cbd5e1;background:#f8fafc;padding:.3rem .55rem;font-size:0.75rem;font-weight:600;" title="Put on Hold">
                  ⏸️ Hold
                </button>
              ` : '')}

              <!-- 🔔 REVIEW & ACCEPT ONLINE ORDER BUTTON -->
              ${order.status === 'pending' ? `
                <button type="button" class="adm-btn adm-btn-primary adm-btn-sm" onclick="triggerIncomingOrderPrompt(orders.find(o => o.id === '${order.id}'))" style="background:#10b981;border-color:#10b981;color:#fff;padding:.3rem .55rem;font-size:0.75rem;font-weight:700;" title="Review, Accept & Print KOT">
                  ✅ Review &amp; Accept
                </button>
              ` : ''}

              <!-- ✏️ EDIT CLOSED ORDER BUTTON -->
              ${(order.status === 'delivered' || order.status === 'completed' || order.status === 'closed' || order.status === 'cancelled' || order.payment_status === 'paid') ? `
                <button type="button" class="adm-btn adm-btn-outline adm-btn-sm" onclick="openClosedOrderEditModal('${order.id}')" style="padding:.3rem .55rem;font-size:0.75rem;color:#4f46e5;border-color:#c7d2fe;background:#eef2ff;font-weight:700;" title="Edit and correct this order">
                  ✏️ Edit
                </button>
              ` : ''}

              <!-- 🧾 CREATE BILL ACTION BUTTON -->
              <button type="button" class="adm-btn adm-btn-primary adm-btn-sm btn-create-bill-from-order" data-order-id="${order.id}" style="background:#6366f1;border-color:#6366f1;display:inline-flex;align-items:center;gap:3px;font-weight:700;padding:.3rem .6rem;font-size:0.75rem;" title="Load order items into POS Billing">
                🧾 Create Bill
              </button>
              <button type="button" class="adm-btn adm-btn-outline adm-btn-sm view-order-btn" data-order-id="${order.id}" style="padding:.3rem .55rem;font-size:0.75rem;">
                👁️ View
              </button>
              ${(order.payment_status || 'unpaid') === 'unpaid' ? `<button type="button" class="adm-btn adm-btn-outline adm-btn-sm inline-mark-paid-btn" data-order-id="${order.id}" style="padding:.3rem .55rem;font-size:0.75rem;border-color:var(--adm-green);color:var(--adm-green);" title="Mark as Paid">✓ Paid</button>` : ''}
              <!-- 🗑️ DELETE ORDER BUTTON -->
              <button type="button" class="adm-btn adm-btn-outline adm-btn-sm delete-order-btn" data-order-id="${order.id}" style="padding:.3rem .55rem;font-size:0.75rem;border-color:#fca5a5;color:#ef4444;background:#fef2f2;font-weight:700;" title="Permanently delete this order">
                🗑️ Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Checkbox & Bulk Delete Handler
  const selectAllCb = $('orders-select-all');
  const bulkDeleteBtn = $('orders-bulk-delete-btn');
  const selectedCountSpan = $('orders-selected-count');

  function updateBulkDeleteState() {
    const checkedCbs = tbody.querySelectorAll('.order-row-checkbox:checked');
    const count = checkedCbs.length;
    if (selectedCountSpan) selectedCountSpan.textContent = count;
    if (bulkDeleteBtn) {
      bulkDeleteBtn.style.display = count > 0 ? 'inline-flex' : 'none';
    }
    if (selectAllCb) {
      const totalCbs = tbody.querySelectorAll('.order-row-checkbox').length;
      selectAllCb.checked = totalCbs > 0 && count === totalCbs;
    }
  }

  if (selectAllCb) {
    selectAllCb.checked = false;
    selectAllCb.onchange = () => {
      const checkboxes = tbody.querySelectorAll('.order-row-checkbox');
      checkboxes.forEach(cb => { cb.checked = selectAllCb.checked; });
      updateBulkDeleteState();
    };
  }

  tbody.querySelectorAll('.order-row-checkbox').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation());
    cb.addEventListener('change', updateBulkDeleteState);
  });

  if (bulkDeleteBtn) {
    bulkDeleteBtn.onclick = async () => {
      const checkedCbs = Array.from(tbody.querySelectorAll('.order-row-checkbox:checked'));
      const ids = checkedCbs.map(cb => cb.dataset.orderId).filter(Boolean);
      if (!ids.length) return;

      const reasonPrompt = typeof prompt === 'function'
        ? prompt(`Enter mandatory financial audit reason to void ${ids.length} selected order(s) (minimum 3 characters):`)
        : '';
      if (reasonPrompt === null) return;
      const cleanReason = String(reasonPrompt || '').trim();
      if (cleanReason.length < 3) {
        showAdminToast('REASON_REQUIRED: A valid reason (minimum 3 characters) is required to void orders.', 'error');
        return;
      }

      try {
        bulkDeleteBtn.disabled = true;
        bulkDeleteBtn.innerHTML = '<span>⏳</span> Voiding...';

        let voidedCount = 0;
        for (const orderId of ids) {
          const res = await voidClosedOrder(orderId, cleanReason);
          if (res && res.ok) voidedCount++;
        }

        if (voidedCount > 0) {
          showAdminToast(`${voidedCount} order(s) voided and recorded in audit log 🚫`, 'success');
        }
        renderOrdersTable();
        renderOverview();
        renderBillingQuickCards();
        renderBillingTotalBills();
        renderClosedOrdersPanel();
        if (selectedOrderId && ids.includes(selectedOrderId)) {
          renderOrderDetail(selectedOrderId);
        }
      } catch (err) {
        console.error('[Bulk Void Orders Error]', err);
        showAdminToast('Failed to void selected orders: ' + err.message, 'error');
      } finally {
        if (bulkDeleteBtn) {
          bulkDeleteBtn.disabled = false;
          bulkDeleteBtn.innerHTML = `<span>🚫</span> Void Selected (<span id="orders-selected-count">0</span>)`;
        }
      }
    };
  }

  // 1. Wire up Hold / Release buttons
  tbody.querySelectorAll('.toggle-hold-order-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const orderId = btn.dataset.orderId;
      const action = btn.dataset.action;
      const newStatus = action === 'release' ? 'confirmed' : 'hold';
      await toggleOrderHoldStatus(orderId, newStatus);
    });
  });

  // 2. Wire up Create Bill buttons
  tbody.querySelectorAll('.btn-create-bill-from-order').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const orderId = btn.dataset.orderId;
      createBillForOrder(orderId);
    });
  });

  // 3. Wire up Mark Paid buttons
  tbody.querySelectorAll('.inline-mark-paid-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const orderId = btn.dataset.orderId;
      if (confirm('Are you sure you want to mark this order as paid?')) {
        updateOrderPaymentStatus(orderId, 'paid');
      }
    });
  });

  // 4. Wire up Delete Order buttons
  tbody.querySelectorAll('.delete-order-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const orderId = btn.dataset.orderId;
      if (orderId) deleteUniversalOrder(orderId);
    });
  });

  // 5. Wire up View Order buttons and row clicks
  tbody.querySelectorAll('.view-order-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.orderId;
      if (id) openOrderDetail(id);
    });
  });

  tbody.querySelectorAll('tr[data-order-id]').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.orderId;
      if (id) openOrderDetail(id);
    });
  });

  const pag = $('orders-pagination');
  if (pag) {
    pag.innerHTML = Array.from({ length: totalPages }, (_, i) =>
      `<button class="adm-page-btn ${i + 1 === ordersPage ? 'active' : ''}" data-page="${i + 1}">${i + 1}</button>`
    ).join('');
    pag.querySelectorAll('.adm-page-btn').forEach(btn => {
      btn.addEventListener('click', () => { ordersPage = Number(btn.dataset.page); renderOrdersTable(); });
    });
  }
}

async function toggleOrderHoldStatus(orderId, targetActionOrStatus) {
  const order = orders.find(o => String(o.id) === String(orderId));
  if (!order) {
    showAdminToast('Order not found.', 'error');
    return;
  }

  if (targetActionOrStatus === 'hold') {
    // 1. Immediately update local state in-memory
    order.status = 'hold';
    order.ticket_status = 'HOLD';
    order.updated_at = new Date().toISOString();

    // 2. Attempt cloud DB update safely
    try {
      let { error } = await insforge.database
        .from('orders')
        .update({ status: 'hold', ticket_status: 'HOLD', updated_at: order.updated_at })
        .eq('id', order.id);
      if (error && (error.message || '').includes('ticket_status')) {
        const retry = await insforge.database
          .from('orders')
          .update({ status: 'hold', updated_at: order.updated_at })
          .eq('id', order.id);
        error = retry.error;
      }
      if (error) console.warn('[Hold Order] Cloud update warning (saved locally):', error);
    } catch (err) {
      console.warn('[Hold Order] Offline/network hold update:', err);
    }

    persistOrdersCache();
    showAdminToast(`Order #${formatDailyOrderNumber(order)} put on Hold ⏸️`, 'success');
    renderAll();
  } else if (targetActionOrStatus === 'release' || targetActionOrStatus === 'confirmed') {
    // 1. Immediately update local state in-memory
    order.status = 'confirmed';
    order.ticket_status = 'OPEN';
    order.updated_at = new Date().toISOString();

    // 2. Attempt cloud DB update safely
    try {
      let { error } = await insforge.database
        .from('orders')
        .update({ status: 'confirmed', ticket_status: 'OPEN', updated_at: order.updated_at })
        .eq('id', order.id);
      if (error && (error.message || '').includes('ticket_status')) {
        const retry = await insforge.database
          .from('orders')
          .update({ status: 'confirmed', updated_at: order.updated_at })
          .eq('id', order.id);
        error = retry.error;
      }
      if (error) console.warn('[Release Order] Cloud update warning (saved locally):', error);
    } catch (err) {
      console.warn('[Release Order] Offline/network release update:', err);
    }

    persistOrdersCache();
    showAdminToast(`Order #${formatDailyOrderNumber(order)} released from Hold ▶️`, 'success');
    renderAll();
  }
}
window.toggleOrderHoldStatus = toggleOrderHoldStatus;

function loadOrderIntoPos(order) {
  if (!order) return;
  posEditingOrderId = order.id;

  // Switch to Billing panel
  switchPanel('order-detail');

  // Allow panel mount then open POS builder
  setTimeout(async () => {
    const posEl = $('billing-pos');
    const totalSection = $('billing-total-section');
    const picker = $('billing-order-picker');

    if (posEl) posEl.style.display = 'block';
    if (totalSection) totalSection.style.display = 'none';
    closeOrderDetailDrawer();
    if (picker) picker.value = '';

    const parsedMeta = parseNotesMetadata(order.notes, order);
    const isTable = parsedMeta.type === 'table' || order.order_type === 'table' || Boolean(parsedMeta.tableNumber || order.table_number);
    const orderType = isTable ? 'table' : (parsedMeta.type === 'delivery' ? 'delivery' : 'pickup');

    // Populate Customer info
    if ($('pos-customer-name')) $('pos-customer-name').value = order.customer_name || 'Walk-in';
    if ($('pos-customer-phone')) $('pos-customer-phone').value = order.customer_phone || '';

    // Set Order Type
    syncPosOrderTypeState(orderType);

    if (orderType === 'table' && $('pos-table-number')) {
      $('pos-table-number').value = parsedMeta.tableNumber || order.table_number || '';
    }
    if (orderType === 'delivery') {
      const rawAddr = parsedMeta.address || order.address || '';
      const matchedPlace = adminPlaces.find(p => p.name && rawAddr.toLowerCase().includes(p.name.toLowerCase()));
      if (matchedPlace) {
        selectPosPlace(matchedPlace);
      }
      if ($('pos-delivery-address')) {
        $('pos-delivery-address').value = rawAddr;
      }
      if ($('pos-delivery-fee')) {
        const feeVal = (parsedMeta.deliveryFee !== undefined && parsedMeta.deliveryFee !== null)
          ? parsedMeta.deliveryFee
          : (order.delivery_fee ?? 0);
        $('pos-delivery-fee').value = Number(feeVal) || 0;
      }
    }

    if ($('pos-notes')) {
      $('pos-notes').value = (parsedMeta.notes || '').replace(/\[Ref\s*#\d+\]/gi, '').trim();
    }

    // Load items into POS Cart (ensure loaded on-demand if historical order)
    await ensureOrderItemsLoaded([order.id]);
    const items = getItemsForOrder(order.id);
    const foodOnlyItems = (items || []).filter(isFoodDishItem);
    if (foodOnlyItems.length > 0) {
      posCart = foodOnlyItems.map(i => {
        const parsed = parseItemNameAndNotes(i.item_name || i.name);
        const unitP = Number(i.unit_price ?? i.price ?? (i.quantity > 0 ? (i.line_total / i.quantity) : 0) ?? 0);
        return {
          id: i.menu_item_id || null,
          name: parsed.name || i.item_name || i.name,
          price: unitP,
          qty: parseInt(i.quantity || i.qty || 1, 10),
          notes: i.notes || parsed.notes || ''
        };
      });
    } else {
      posCart = [{
        id: null,
        name: `Order #${formatDailyOrderNumber(order)} (${isTable ? 'Table Order' : 'Website Order'})`,
        price: parseFloat(order.total_amount || 0),
        qty: 1,
        notes: ''
      }];
    }

    // Restore applied coupon or manual discount percentage if present
    posAppliedCoupon = null;
    if (parsedMeta.couponCode) {
      const matchedCoupon = (adminCoupons || []).find(c => String(c.code || '').toUpperCase() === parsedMeta.couponCode);
      posAppliedCoupon = matchedCoupon || {
        id: null,
        code: parsedMeta.couponCode,
        discount_pct: parsedMeta.discountPct || 0,
        min_bill: 0
      };
      if ($('pos-coupon-code-input')) $('pos-coupon-code-input').value = parsedMeta.couponCode;
      if ($('pos-discount-pct')) $('pos-discount-pct').value = '0';
    } else if (parsedMeta.discountPct && $('pos-discount-pct')) {
      $('pos-discount-pct').value = parsedMeta.discountPct;
    } else if (parsedMeta.discountAmt && $('pos-discount-pct')) {
      const foodSubtotal = posCart.reduce((sum, i) => sum + i.price * i.qty, 0);
      if (foodSubtotal > 0) {
        $('pos-discount-pct').value = Math.round((parsedMeta.discountAmt / foodSubtotal) * 100);
      }
    } else if ($('pos-discount-pct')) {
      $('pos-discount-pct').value = '0';
    }
    renderPosCouponPicker();

    // Restore and preserve Payment Method in POS workstation
    const existingPay = (order.payment_method || parsedMeta.paymentMode || 'cash').toLowerCase().trim();
    const validPosPay = ['cash', 'upi', 'card', 'pay_later'].includes(existingPay) ? existingPay : 'cash';
    const paySel = $('pos-payment-mode');
    if (paySel) paySel.value = validPosPay;
    document.querySelectorAll('.pos-pay-mode-pill').forEach(b => {
      const isThis = b.dataset.pay === validPosPay;
      b.className = 'pos-pay-mode-pill adm-btn ' + (isThis ? 'adm-btn-primary' : 'adm-btn-outline');
    });

    const billBtnLabel = $('pos-bill-btn-label');
    const billBtnIcon = $('pos-bill-btn-icon');
    if (billBtnLabel) billBtnLabel.textContent = `Settle & Pay (${validPosPay.toUpperCase()})`;
    if (billBtnIcon) billBtnIcon.textContent = validPosPay === 'upi' ? '📱' : '💵';

    updatePosCartUI();
    renderCategoryPills();
    updateCatalogCatHeader();
    renderFoodGrid();
  }, 100);
}
window.loadOrderIntoPos = loadOrderIntoPos;

function createBillForOrder(orderId) {
  const order = orders.find(o => String(o.id) === String(orderId));
  if (!order) {
    showAdminToast('Order not found.', 'error');
    return;
  }
  loadOrderIntoPos(order);
}

function exportOrdersListCSV() {
  const filtered = getFilteredOrders();
  if (filtered.length === 0) {
    showAdminToast('No orders to export.', 'error');
    return;
  }

  const headers = ['Order #', 'Date & Time', 'Customer Name', 'Customer Phone', 'Channel / Type', 'Table #', 'Status', 'Payment Status', 'Items Ordered', 'Total Amount (INR)'];
  const rows = filtered.map(o => {
    const meta = parseNotesMetadata(o.notes, o);
    const items = getItemsForOrder(o.id);
    const itemsStr = items.map(i => `${i.quantity}x ${i.item_name}`).join('; ');
    const isTable = meta.type === 'table' || o.order_type === 'table';
    const channel = isTable ? 'Dine-In Table' : (meta.type === 'delivery' ? 'Online Delivery' : 'Pickup');

    return [
      `"${formatDailyOrderNumber(o)}"`,
      `"${new Date(o.created_at).toLocaleString('en-IN')}"`,
      `"${(o.customer_name || 'Walk-in').replace(/"/g, '""')}"`,
      `"${o.customer_phone || ''}"`,
      `"${channel}"`,
      `"${meta.tableNumber || o.table_number || ''}"`,
      `"${o.status}"`,
      `"${o.payment_status || 'unpaid'}"`,
      `"${itemsStr.replace(/"/g, '""')}"`,
      `"${Number(o.total_amount || 0).toFixed(2)}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.setAttribute('download', `LIMRA_Orders_List_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAdminToast('Orders exported to CSV! 📥', 'success');
}

function isOrderPaidOrClosed(ord) {
  if (!ord) return false;
  const status = String(ord.status || '').toLowerCase();
  const paymentStatus = String(ord.payment_status || '').toLowerCase();
  const ticketStatus = String(ord.ticket_status || '').toUpperCase();
  return (
    paymentStatus === 'paid' ||
    ticketStatus === 'CLOSED' ||
    status === 'delivered' ||
    status === 'completed' ||
    status === 'closed'
  );
}

async function cancelOrderRecord(ord) {
  if (!ord || !ord.id) {
    throw new Error('Invalid order for cancellation.');
  }
  const canonical = orders.find(o => String(o.id) === String(ord.id)) || ord;
  if (isOrderPaidOrClosed(canonical) || isOrderPaidOrClosed(ord)) {
    throw new Error(`Order #${canonical.order_number || canonical.id} is already paid or closed and cannot be cancelled.`);
  }

  const cancelPayload = {
    status: 'cancelled',
    ticket_status: 'CANCELLED',
    updated_at: new Date().toISOString()
  };

  const { error } = await insforge.database
    .from('orders')
    .update(cancelPayload)
    .eq('id', canonical.id)
    .neq('ticket_status', 'CLOSED')
    .neq('payment_status', 'paid');

  if (error) {
    throw new Error(error.message || 'Database error while cancelling order.');
  }

  ord.status = 'cancelled';
  ord.ticket_status = 'CANCELLED';
  ord.updated_at = cancelPayload.updated_at;
  if (canonical !== ord) {
    canonical.status = 'cancelled';
    canonical.ticket_status = 'CANCELLED';
    canonical.updated_at = cancelPayload.updated_at;
  }
  return canonical;
}

async function cancelTableOrders(tableNum, explicitOrders = null) {
  const numericTable = parseInt(String(tableNum || '').replace(/\D/g, ''), 10);
  const targetOrders = Array.isArray(explicitOrders) && explicitOrders.length > 0
    ? explicitOrders
    : (getActiveTableSessions().find(s => s.tableNumber === numericTable)?.orders || []);

  if (!targetOrders.length) {
    // Check if table only has paid or closed orders
    const closedOrPaidForTable = orders.filter(o => {
      const t = parseInt(String(o.table_number || '').replace(/\D/g, ''), 10);
      return t === numericTable && isOrderPaidOrClosed(o);
    });
    if (closedOrPaidForTable.length > 0) {
      showAdminToast(`Cannot cancel Table ${numericTable}: order is already paid or closed.`, 'error');
      return { success: false, reason: 'ORDER_PAID_OR_CLOSED' };
    }
    showAdminToast(`No active running orders found for Table ${numericTable}.`, 'error');
    return { success: false, reason: 'NO_ACTIVE_ORDERS' };
  }

  const paidOrClosedOrder = targetOrders.find(ord => {
    const canonical = orders.find(o => String(o.id) === String(ord.id)) || ord;
    return isOrderPaidOrClosed(ord) || isOrderPaidOrClosed(canonical);
  });
  if (paidOrClosedOrder) {
    showAdminToast(`Order #${paidOrClosedOrder.order_number || paidOrClosedOrder.id} is already paid or closed and cannot be cancelled.`, 'error');
    return { success: false, reason: 'ORDER_PAID_OR_CLOSED' };
  }

  for (const ord of targetOrders) {
    await cancelOrderRecord(ord);
    await markOrderNotificationsRead(ord.id);
  }
  persistOrdersCache();
  return { success: true, cancelledCount: targetOrders.length };
}

window.isOrderPaidOrClosed = isOrderPaidOrClosed;
window.cancelOrderRecord = cancelOrderRecord;
window.cancelTableOrders = cancelTableOrders;

async function updateOrderStatus(orderId, newStatus) {
  const existingOrder = orders.find(o => o.id === orderId);
  if (existingOrder) {
    if (newStatus === 'cancelled' && isOrderPaidOrClosed(existingOrder)) {
      showAdminToast('Paid or closed orders cannot be cancelled.', 'error');
      return false;
    }
    if (existingOrder.ticket_status === 'CLOSED' && newStatus !== 'delivered') {
      showAdminToast('Closed orders cannot be transitioned to another status.', 'error');
      return false;
    }
    if (existingOrder.ticket_status === 'CANCELLED' && newStatus !== 'cancelled') {
      showAdminToast('Cancelled orders cannot be reactivated.', 'error');
      return false;
    }
    if (!isValidFulfillmentTransition(existingOrder.status, newStatus)) {
      showAdminToast(`Cannot transition order fulfillment from '${existingOrder.status}' to '${newStatus}'.`, 'error');
      return false;
    }
  }

  const updates = { status: newStatus };
  if (newStatus === 'cancelled') {
    updates.ticket_status = 'CANCELLED';
  } else if (newStatus === 'hold') {
    updates.ticket_status = 'HOLD';
  } else if (newStatus === 'delivered' || newStatus === 'completed' || newStatus === 'closed') {
    if (existingOrder && existingOrder.payment_status === 'paid') {
      updates.ticket_status = 'CLOSED';
    } else {
      updates.ticket_status = 'BILLED';
    }
  }

  try {
    let query = insforge.database.from('orders').update(updates).eq('id', orderId);
    if (newStatus === 'cancelled') {
      query = query.neq('ticket_status', 'CLOSED').neq('payment_status', 'paid');
    }
    const res = await query;
    if (res.error) {
      console.error('[Update Order Status] Database update failed:', res.error);
      showAdminToast('Failed to update order status: ' + (res.error.message || 'Database error'), 'error');
      return false;
    }
  } catch (err) {
    console.error('[Update Order Status] Request failed:', err);
    showAdminToast('Failed to update order status: ' + (err.message || 'Network error'), 'error');
    return false;
  }

  const order = orders.find(o => o.id === orderId);
  if (order) {
    Object.assign(order, updates);
    
    // Auto-sync closed/delivered order to Google Sheets
    if ((newStatus === 'delivered' || newStatus === 'completed' || newStatus === 'closed') && isGoogleSheetAutoSyncEnabled()) {
      syncOrderToGoogleSheet(order).catch(e => console.warn('[Google Sheet] Auto-sync background error:', e));
    }
    
    // Send Email Notification on Confirmation or Cancellation
    const meta = parseNotesMetadata(order.notes, order);
    if (meta.email) {
      try {
        if (newStatus === 'confirmed') {
          const emailHtml = generateOrderConfirmedHtml(order);
          await sendEmailNotification(meta.email, `✅ Order #${order.order_number} Confirmed - LIMRA Restaurant`, emailHtml);
        } else if (newStatus === 'cancelled') {
          const emailHtml = generateOrderCancelledHtml(order);
          await sendEmailNotification(meta.email, `❌ Order #${order.order_number} Cancelled - LIMRA Restaurant`, emailHtml);
        }
      } catch (emailErr) {
        console.warn('[Admin] Background email status notification failed:', emailErr);
      }
    }

    // Broadcast real-time order status update to client channel
    try {
      const cleanPhone = String(order.customer_phone).replace(/\D/g, '').slice(-10);
      if (cleanPhone.length >= 10) {
        let title = 'Order Update';
        let message = `Your order #${order.order_number} status is now ${newStatus}.`;
        let notifType = `order_${newStatus}`;
        
        switch (newStatus) {
          case 'confirmed':
            title = 'Order Confirmed';
            message = `Your order #${order.order_number} has been confirmed and is now being prepared.`;
            notifType = 'order_confirmed';
            break;
          case 'preparing':
            title = 'Order Preparing';
            message = `Your order #${order.order_number} is being prepared in the kitchen.`;
            notifType = 'order_preparing';
            break;
          case 'ready':
            title = 'Out For Delivery';
            message = `Your order #${order.order_number} is ready and out for delivery.`;
            notifType = 'out_for_delivery';
            break;
          case 'delivered':
            title = 'Order Delivered';
            message = `Your order #${order.order_number} has been delivered. Enjoy your meal!`;
            notifType = 'delivered';
            break;
          case 'cancelled':
            title = 'Order Rejected';
            message = `Your order #${order.order_number} has been cancelled.`;
            notifType = 'order_rejected';
            break;
        }

        await insforge.realtime.publish(`customer-notifications:${cleanPhone}`, 'notification_created', {
          title,
          message,
          order_id: orderId,
          type: notifType,
          created_at: new Date().toISOString()
        });
        console.log(`[Admin] Realtime status update broadcasted to customer channel: customer-notifications:${cleanPhone}`);

        // Also publish to specific order tracking channel
        try {
          await insforge.realtime.publish(`order-updates:${orderId}`, 'order_status_updated', {
            order_id: orderId,
            status: newStatus
          });
          console.log(`[Admin] Realtime status update broadcasted to order channel: order-updates:${orderId}`);
        } catch (orderRtErr) {
          console.warn('[Admin] Realtime order channel broadcast failed:', orderRtErr);
        }
      }
    } catch (rtErr) {
      console.warn('[Admin] Realtime status update broadcast failed:', rtErr);
    }

    // Auto-mark notifications for this order as read when order is closed or updated
    if (newStatus === 'delivered' || newStatus === 'cancelled' || newStatus === 'paid') {
      await markOrderNotificationsRead(orderId);
    }
  }
  renderAll();
  if (selectedOrderId === orderId && getActivePanelId() === 'order-detail') renderOrderDetail(orderId);
  return true;
}

async function updateOrderPaymentStatus(orderId, newStatus) {
  try {
    const order = orders.find(o => o.id === orderId);
    if (order && !isValidPaymentTransition(order.payment_status, newStatus)) {
      showAdminToast(`Invalid payment transition: cannot change payment from '${order.payment_status}' to '${newStatus}'.`, 'error');
      return false;
    }

    const result = await PaymentService.updatePaymentStatus(orderId, newStatus);
    showAdminToast('Payment status updated successfully.', 'success');

    if (order) {
      order.payment_status = newStatus;
      if (newStatus === 'paid') {
        await markOrderNotificationsRead(orderId);
      }
      try {
        await PaymentService.sendPaymentNotification(order.customer_phone, order);
      } catch (err) {
        console.warn('[Admin] Realtime payment notification broadcast failed:', err);
      }
    }
    renderAll();
    if (selectedOrderId === orderId && getActivePanelId() === 'order-detail') renderOrderDetail(orderId);
    return true;
  } catch (err) {
    showAdminToast('Failed to update payment status: ' + err.message, 'error');
    return false;
  }
}

async function loadAndRenderPaymentHistory(orderId) {
  const container = document.getElementById('detail-payment-history-container');
  if (!container) return;
  try {
    const historyList = await PaymentService.getPaymentHistory(orderId);
    if (!historyList || historyList.length === 0) {
      container.innerHTML = '<p class="text-xs text-slate-400 italic">No payment history events recorded.</p>';
      return;
    }
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        ${historyList.map(h => `
          <div style="padding: 0.65rem; border-radius: 8px; border: 1px solid var(--adm-border); background: #fafbfc; font-size: 0.75rem;">
            <div style="display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 0.25rem;">
              <span style="color: ${h.new_status === 'paid' ? 'var(--adm-green)' : '#ff5b5b'}">
                ${h.previous_status.toUpperCase()} → ${h.new_status.toUpperCase()}
              </span>
              <span style="color: var(--adm-muted); font-weight: normal; font-size:0.75rem;">${fmtDate(h.created_at)}</span>
            </div>
            <p style="margin: 0 0 0.25rem 0; color: var(--adm-text); font-weight: 500;">${escapeHtml(h.notes || 'No description provided.')}</p>
            <div style="font-size:0.75rem; color: var(--adm-muted);">Operator: ${escapeHtml(h.changed_by)}</div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error('Failed to load payment history:', err);
    container.innerHTML = '<p class="text-xs text-red-500 italic">Failed to load payment logs.</p>';
  }
}

function isOrderDetailDrawerOpen() {
  const detailEl = $('billing-detail-view');
  return Boolean(detailEl && (detailEl.classList.contains('open') || detailEl.style.display === 'flex' || detailEl.style.display === 'block'));
}

function openOrderDetailDrawer(orderId) {
  const targetId = orderId || selectedOrderId || $('order-detail-picker')?.value || $('billing-order-picker')?.value;
  if (!targetId) return;
  selectedOrderId = targetId;

  // Prevent overlapping modals and popovers when opening the slide-over drawer
  if (typeof closeAllPosExtraPopovers === 'function') closeAllPosExtraPopovers();
  if (typeof closePosEditItemModal === 'function') closePosEditItemModal();
  document.querySelectorAll('.adm-modal.open, .adm-modal[style*="display: flex"], .adm-modal[style*="display: block"]').forEach(m => {
    m.classList.remove('open');
    m.style.display = 'none';
  });

  // Never hide or reset #billing-pos — keep active POS workstation live underneath
  const posEl = $('billing-pos');
  if (posEl && posEl.style.display === 'none') {
    posEl.style.display = 'block';
  }

  const detailEl = $('billing-detail-view');
  const backdropEl = $('billing-detail-drawer-backdrop');
  if (detailEl) {
    detailEl.style.display = 'flex';
    detailEl.classList.add('open');
    detailEl.setAttribute('aria-hidden', 'false');
  }
  if (backdropEl) {
    backdropEl.style.display = 'block';
    backdropEl.classList.add('open');
    backdropEl.setAttribute('aria-hidden', 'false');
  }

  if ($('billing-order-picker')) $('billing-order-picker').value = targetId;
  if ($('order-detail-picker')) $('order-detail-picker').value = targetId;
  show($('billing-print-btn'));
  show($('billing-print-kot-btn'));

  renderOrderDetail(targetId);
}

function closeOrderDetailDrawer() {
  const detailEl = $('billing-detail-view');
  const backdropEl = $('billing-detail-drawer-backdrop');
  if (detailEl) {
    detailEl.classList.remove('open');
    detailEl.style.display = 'none';
    detailEl.setAttribute('aria-hidden', 'true');
  }
  if (backdropEl) {
    backdropEl.classList.remove('open');
    backdropEl.style.display = 'none';
    backdropEl.setAttribute('aria-hidden', 'true');
  }
  if ($('billing-order-picker')) $('billing-order-picker').value = '';
  const posEl = $('billing-pos');
  if (posEl && posEl.style.display === 'none') {
    posEl.style.display = 'block';
  }
}

function openOrderDetail(orderId) {
  if (!orderId) return;
  selectedOrderId = orderId;
  renderOrderDetailPicker();
  if (getActivePanelId() !== 'order-detail') {
    switchPanel('order-detail');
  }
  openOrderDetailDrawer(orderId);
}

window.openOrderDetailDrawer = openOrderDetailDrawer;
window.closeOrderDetailDrawer = closeOrderDetailDrawer;
window.isOrderDetailDrawerOpen = isOrderDetailDrawerOpen;
window.openOrderDetail = openOrderDetail;

function renderOrderDetailPicker() {
  const picker = $('order-detail-picker');
  if (!picker) return;
  const current = selectedOrderId || picker.value;
  picker.innerHTML = [
    '<option value="">Select an order to view details…</option>',
    ...orders.map(o =>
      `<option value="${o.id}" ${o.id === current ? 'selected' : ''}>#${formatDailyOrderNumber(o)} — ${escapeHtml(o.customer_name)} — ${fmtMoney(o.total_amount)} — ${STATUS_LABEL[o.status] || o.status}</option>`
    ),
  ].join('');
}

async function renderOrderDetail(orderId) {
  const id = orderId || $('order-detail-picker')?.value;
  const order = orders.find(o => o.id === id);
  const content = $('order-detail-content');
  const statusSelect = $('order-detail-status');
  const picker = $('order-detail-picker');

  if (picker && id) picker.value = id;

  if (!order) {
    $('order-detail-title').textContent = 'Order Detail';
    $('order-detail-sub').textContent = orders.length
      ? `${orders.length} orders — pick one to view full details`
      : 'No orders yet';
    content.innerHTML = '<div class="adm-card adm-empty">Choose an order from the dropdown above or open one from Order List</div>';
    hide(statusSelect);
    return;
  }

  selectedOrderId = order.id;
  const roundInfo = getOrderRoundInfo(order);
  const roundText = roundInfo.isTable && roundInfo.roundNumber ? ` (Round ${roundInfo.roundNumber})` : '';
  $('order-detail-title').textContent = `Order #${formatDailyOrderNumber(order)}${roundText}`;
  $('order-detail-sub').textContent = `Placed ${fmtDate(order.created_at)}`;
  const isTable = order.order_type === 'table' || (order.notes && order.notes.includes('[TABLE:'));
  const DINEIN_STATUS_LABEL = {
    hold: '⏸️ On Hold',
    pending: 'Pending',
    confirmed: 'Confirmed',
    preparing: 'Preparing',
    ready: 'Served',
    delivered: 'Completed',
    cancelled: 'Cancelled'
  };
  const labelsToUse = isTable ? DINEIN_STATUS_LABEL : STATUS_LABEL;
  statusSelect.innerHTML = ORDER_STATUSES.map(s =>
    `<option value="${s}" ${s === order.status ? 'selected' : ''}>${labelsToUse[s] || s}</option>`
  ).join('');
  statusSelect.onchange = () => updateOrderStatus(order.id, statusSelect.value);

  await ensureOrderItemsLoaded([order.id]);
  const rawItems = getItemsForOrder(order.id);
  const items = consolidateOrderItems(rawItems);
  const itemsSubtotal = items.reduce((s, i) => s + Number(i.line_total), 0);
  const steps = [
    { label: 'Order Created', done: true, time: order.created_at },
    { label: 'Confirmed', done: ['confirmed', 'preparing', 'ready', 'delivered'].includes(order.status), time: null },
    { label: 'Preparing', done: ['preparing', 'ready', 'delivered'].includes(order.status), time: null },
    { label: 'Ready / Out for delivery', done: ['ready', 'delivered'].includes(order.status), time: null },
    { label: 'Delivered', done: order.status === 'delivered', time: order.status === 'delivered' ? order.updated_at : null },
    { label: 'Cancelled', done: order.status === 'cancelled', time: order.status === 'cancelled' ? order.updated_at : null },
  ].filter(s => s.label !== 'Cancelled' || order.status === 'cancelled');

  const itemsHtml = items.length === 0
    ? '<tr><td colspan="4" class="adm-empty">No line items recorded for this order</td></tr>'
    : items.map(i => `
        <tr style="cursor:default">
          <td>${escapeHtml(i.item_name)}${i.menu_item_id ? `<br><span class="adm-info-muted">Menu ID: ${i.menu_item_id}</span>` : ''}</td>
          <td>${i.quantity}</td>
          <td>${fmtMoney(i.unit_price)}</td>
          <td>${fmtMoney(i.line_total)}</td>
        </tr>
      `).join('');

  const parsedMeta = parseNotesMetadata(order.notes, order);

  let promoMsg = '';
  try {
    const { data: promoList } = await insforge.database
      .from('coupons')
      .select('*')
      .eq('active', true)
      .eq('is_auto_send', true)
      .limit(1);
      
    if (promoList && promoList.length > 0) {
      const promo = promoList[0];
      const expDate = new Date(promo.expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      promoMsg = ` Use Coupon code: ${promo.code} to get ${promo.discount_pct}% OFF on your next visit! Valid until ${expDate}.`;
    }
  } catch (err) {
    console.error('Failed to load auto-send promo coupon in admin:', err);
  }

  const digits = order.customer_phone.replace(/\D/g, '');
  const formattedPhone = digits.length === 10 ? '91' : '';
  const whatsappPhone = formattedPhone + digits;
  const statusText = STATUS_LABEL[order.status] || order.status;
  const promoSuffix = promoMsg || '';
  const whatsappMsg = `Hi ${order.customer_name}, your LIMRA order #${order.order_number} has been received! Current status: ${statusText}. We are preparing it with care and will contact you as soon as possible. Thank you for choosing LIMRA!${promoSuffix}`;
  const whatsappLink = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(whatsappMsg)}`;

  const emailSubject = `LIMRA Restaurant - Order #${order.order_number} Confirmation`;
  const emailBody = `Hi ${order.customer_name},\n\nThank you for your order! Your order #${order.order_number} for ${fmtMoney(order.total_amount)} has been successfully booked.\n\nWe will contact you as soon as possible to arrange delivery/pickup.\n\nWarm regards,\nLIMRA Restaurant Team`;
  const emailLink = parsedMeta.email ? `mailto:${parsedMeta.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}` : '#';

  content.innerHTML = `
    <div class="adm-detail-grid">
      <div class="adm-detail-col">
        <div class="adm-card">
          <div class="adm-customer-card">
            <div class="adm-customer-avatar">${initials(order.customer_name)}</div>
            <div>
              <p class="adm-customer-name">${escapeHtml(order.customer_name)}</p>
              <span class="adm-pill confirmed">${parsedMeta.type === 'delivery' ? '🚗 Delivery' : (parsedMeta.type === 'table' ? `🍽️ Table ${parsedMeta.tableNumber}` : '🥡 Pickup')}</span>
              <p class="adm-customer-phone"><a href="tel:${order.customer_phone}">${escapeHtml(order.customer_phone)}</a></p>
              ${parsedMeta.email ? `<span class="adm-email-badge">${escapeHtml(parsedMeta.email)}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="adm-card">
          <h3 class="adm-card-title">Order Information</h3>
          <div class="adm-info-grid">
            <div class="adm-info-item"><label>Order Number</label><p>#${order.order_number}</p></div>
            <div class="adm-info-item"><label>Status</label><p>${statusPill(order.status, parsedMeta.type === 'table')}</p></div>
            <div class="adm-info-item"><label>Total Amount</label><p style="color:var(--adm-green)">${fmtMoney(order.total_amount)}</p></div>
            <div class="adm-info-item"><label>Payment Method</label><p class="font-semibold text-slate-800">${parsedMeta.payment ? parsedMeta.payment.toUpperCase() : (parsedMeta.type === 'table' ? 'Pay at Restaurant' : 'COD')}</p></div>
            <div class="adm-info-item"><label>Payment Status</label><p>${paymentStatusPill(order.payment_status || 'unpaid')}</p></div>
            <div class="adm-info-item"><label>Items Count</label><p>${items.length} item(s) · ${items.reduce((s, i) => s + i.quantity, 0)} qty</p></div>
            <div class="adm-info-item"><label>Placed At</label><p>${fmtDate(order.created_at)}</p></div>
            <div class="adm-info-item"><label>Last Updated</label><p>${fmtDate(order.updated_at)}</p></div>
            <div class="adm-info-item" style="grid-column:1/-1"><label>Order ID</label><p class="adm-info-muted">${order.id}</p></div>
          </div>
          ${parsedMeta.customNote ? `
            <div class="adm-detail-section">
              <p class="adm-detail-section-title">Customer Instructions</p>
              <div class="adm-note-box">${escapeHtml(parsedMeta.customNote)}</div>
            </div>
          ` : ''}
        </div>

        ${parsedMeta.type === 'table' ? `
          <div class="adm-card" style="border: 2px solid var(--adm-green); background: rgba(0, 176, 116, 0.02);">
            <div class="flex items-center justify-between mb-3" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <h3 class="adm-card-title" style="margin:0; color:var(--adm-green)">🪑 Dine-in Table Info</h3>
              <span class="adm-pill confirmed">Table ${parsedMeta.tableNumber}</span>
            </div>
            <div class="adm-info-grid">
              <div class="adm-info-item"><label>Table Number</label><p class="text-sm font-bold">Table ${parsedMeta.tableNumber}</p></div>
              <div class="adm-info-item"><label>Zone / Section</label><p class="text-sm font-bold capitalize">${order.table_zone || 'Indoor'}</p></div>
              <div class="adm-info-item"><label>Order Type</label><p class="text-sm font-semibold">Dine-In Self-Order</p></div>
            </div>
          </div>
        ` : ''}

        ${parsedMeta.type === 'delivery' ? `
          <div class="adm-card">
            <div class="flex items-center justify-between mb-3" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <h3 class="adm-card-title" style="margin:0;">🚗 Delivery Location & Logistics</h3>
              <span id="detail-verified-badge" class="adm-pill ${order.location_verified ? 'delivered' : 'pending'}">
                ${order.location_verified ? '✓ Pin Verified' : '⚠️ Unverified Pin'}
              </span>
            </div>
            
            <div class="adm-info-grid" style="margin-bottom: 1rem;">
              <div class="adm-info-item" style="grid-column: 1/-1">
                <label>Delivery Address</label>
                <p class="text-sm font-semibold">${escapeHtml(parsedMeta.address || 'Not specified')}</p>
                ${parsedMeta.area ? `<p class="text-xs text-slate-500 mt-1">📍 Selected Area: <strong>${escapeHtml(parsedMeta.area)}</strong></p>` : ''}
              </div>
              <div class="adm-info-item" style="grid-column: 1/-1">
                <label>Landmark</label>
                <p id="detail-landmark">${escapeHtml(order.landmark || '—')}</p>
              </div>
              <div class="adm-info-item" style="grid-column: 1/-1">
                <label>Delivery Notes / Instructions</label>
                <p id="detail-notes" style="font-weight: normal; color: var(--adm-muted); background: #f8faf9; padding: 0.5rem; border-radius: 8px; font-size: 0.825rem; margin-top: 0.25rem;">
                  ${escapeHtml(order.delivery_notes || 'No delivery notes')}
                </p>
              </div>
              <div class="adm-info-item">
                <label>Calculated Distance</label>
                <p id="detail-distance">${escapeHtml(parsedMeta.distance || '—')}</p>
              </div>
              <div class="adm-info-item">
                <label>Delivery Charge</label>
                <p>${escapeHtml(parsedMeta.charge || '—')}</p>
              </div>
              <div class="adm-info-item">
                <label>Travel ETA</label>
                <p id="detail-eta">—</p>
              </div>
              <div class="adm-info-item" style="grid-column: 1/-1">
                <label>Coordinates</label>
                <p id="detail-coords" class="font-mono text-xs select-all" style="font-family: monospace; font-size: 0.75rem; color: var(--adm-muted);">
                  ${order.latitude !== null && order.longitude !== null ? `${order.latitude}, ${order.longitude}` : 'Calculating...'}
                </p>
              </div>
            </div>
            
            <div class="adm-detail-map-card">
              <div class="adm-detail-map-wrap" style="height: 250px;">
                <div id="order-detail-map" class="adm-detail-map"></div>
              </div>
            </div>

            <!-- Logistics Action Row -->
            <div style="margin-top: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem;">
              <a href="#" target="_blank" class="adm-btn adm-btn-primary text-center" id="detail-nav-btn" style="text-decoration: none; text-align: center; display: block; font-weight: 700; width: 100%;">
                🗺️ Start Navigation (Google Maps)
              </a>
              
              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem;">
                <button type="button" class="adm-comm-btn whatsapp" id="detail-share-wa-btn">
                  💬 Share WhatsApp
                </button>
                <button type="button" class="adm-comm-btn email" id="detail-share-sms-btn">
                  📱 Send SMS
                </button>
              </div>
              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem;">
                <button type="button" class="adm-comm-btn call" id="detail-copy-details-btn" style="background:#eef0f4; color:var(--adm-text);">
                  📋 Copy Address
                </button>
                <button type="button" class="adm-comm-btn call" id="detail-share-sys-btn" style="background:#eef0f4; color:var(--adm-text);">
                  🔗 Share Route
                </button>
              </div>
            </div>
          </div>
        ` : ''}

        <div class="adm-card">
          <h3 class="adm-card-title">Order Timeline</h3>
          <div class="adm-timeline">
            ${steps.map(s => `
              <div class="adm-timeline-item ${s.done ? 'done' : 'pending'}">
                <p class="adm-timeline-label">${s.label}</p>
                ${s.time ? `<p class="adm-timeline-time">${fmtDate(s.time)}</p>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="adm-detail-col">
        <div class="adm-card adm-table-wrap">
          <div class="adm-card-head">
            <h3 class="adm-card-title">Items Ordered (${items.length})</h3>
          </div>
          <table class="adm-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Line Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
              <tr style="cursor:default;background:#f8faf9">
                <td colspan="3" class="adm-table-total-label">Items Subtotal</td>
                <td><strong>${fmtMoney(itemsSubtotal)}</strong></td>
              </tr>
              ${(() => {
                const s = getBillSettings();
                const isDelivery = order.order_type === 'delivery' || parsedMeta.type === 'delivery';
                const delCharge = isDelivery ? Math.max(0, Number(order.delivery_fee ?? parsedMeta.deliveryFee ?? 0)) : 0;
                const discPct = parsedMeta.discountPct || 0;
                const discAmt = parsedMeta.discountAmt || 0;
                const cgstRate = parsedMeta.cgstRate ?? s.cgstRate;
                const sgstRate = parsedMeta.sgstRate ?? s.sgstRate;
                const billing = calculateOrderBilling({
                  items,
                  deliveryFee: delCharge,
                  discountPct,
                  discountAmt,
                  cgstRate,
                  sgstRate
                });
                const calcGrand = billing.grandTotal;
                const cgstAmt = billing.cgstAmount;
                const sgstAmt = billing.sgstAmount;
                const finalDiscAmt = billing.discountAmount;

                return `
                  ${finalDiscAmt > 0 ? `
                    <tr style="cursor:default;color:#ef4444;">
                      <td colspan="3" class="adm-table-total-label">Discount ${discPct > 0 ? `(${discPct}%)` : ''}</td>
                      <td><strong>-${fmtMoney(finalDiscAmt)}</strong></td>
                    </tr>
                  ` : ''}
                  <tr style="cursor:default;font-size:0.8rem;color:#64748b;">
                    <td colspan="3" class="adm-table-total-label">CGST (${cgstRate}%)</td>
                    <td><span>${fmtMoney(cgstAmt)}</span></td>
                  </tr>
                  <tr style="cursor:default;font-size:0.8rem;color:#64748b;">
                    <td colspan="3" class="adm-table-total-label">SGST (${sgstRate}%)</td>
                    <td><span>${fmtMoney(sgstAmt)}</span></td>
                  </tr>
                  ${delCharge > 0 ? `
                    <tr style="cursor:default;font-size:0.8rem;color:#64748b;">
                      <td colspan="3" class="adm-table-total-label">Delivery Charge</td>
                      <td><span>${fmtMoney(delCharge)}</span></td>
                    </tr>
                  ` : ''}
                  <tr style="cursor:default;background:#e6f7f1">
                    <td colspan="3" class="adm-table-total-label">Grand Total</td>
                    <td><strong class="adm-grand-total">${fmtMoney(calcGrand || order.total_amount)}</strong></td>
                  </tr>
                `;
              })()}
            </tbody>
          </table>
        </div>

        <div class="adm-card">
          <h3 class="adm-card-title">Quick Actions</h3>
          <div class="adm-action-row" style="flex-wrap:wrap;gap:.45rem;">
            <!-- 🧾 1-Click Load into POS Billing -->
            <button type="button" class="adm-btn adm-btn-primary adm-btn-sm btn-detail-create-pos-bill" style="background:#6366f1;border-color:#6366f1;font-weight:700;display:inline-flex;align-items:center;gap:.35rem;">
              <span>🧾</span> Load &amp; Create POS Bill
            </button>
            <!-- ✏️ Edit Closed / Settled Order -->
            ${(order.status === 'delivered' || order.status === 'completed' || order.status === 'closed' || order.status === 'cancelled' || order.payment_status === 'paid') ? `
              <button type="button" class="adm-btn adm-btn-outline adm-btn-sm" onclick="openClosedOrderEditModal('${order.id}')" style="background:#eef2ff;color:#4f46e5;border-color:#c7d2fe;font-weight:700;display:inline-flex;align-items:center;gap:.35rem;" title="Edit and correct dishes or bill for this closed order">
                <span>✏️</span> Edit Order / Items
              </button>
            ` : ''}
            ${parsedMeta.type === 'table' ? `
              ${(order.payment_status || 'unpaid') === 'unpaid' 
                ? `<button type="button" class="adm-btn adm-btn-success adm-btn-sm mark-paid-btn">💵 Mark As Paid</button>` 
                : `<button type="button" class="adm-btn adm-btn-outline adm-btn-sm mark-unpaid-btn" style="border-color:#ff5b5b; color:#ff5b5b; padding:0.4rem 0.8rem; font-weight:600; cursor:pointer;">↩ Mark Unpaid</button>`
              }
            ` : `
              ${order.status === 'pending' ? `
                <button type="button" class="adm-btn adm-btn-primary adm-btn-sm accept-order" style="background:#10b981;border-color:#10b981;font-weight:700;">✅ Accept &amp; Print KOT</button>
                <button type="button" class="adm-btn adm-btn-danger adm-btn-sm reject-order" style="background:#ef4444;border-color:#ef4444;font-weight:700;">✕ Reject</button>
              ` : ''}
              ${order.status === 'confirmed' ? `<button type="button" class="adm-btn adm-btn-primary adm-btn-sm prep-order">👨‍🍳 Start Preparing</button>` : ''}
              ${order.status === 'preparing' ? `<button type="button" class="adm-btn adm-btn-primary adm-btn-sm ready-order">✓ Mark Ready</button>` : ''}
              ${order.status === 'ready' ? `<button type="button" class="adm-btn adm-btn-primary adm-btn-sm deliver-order">✓ Mark Delivered</button>` : ''}
              ${order.status !== 'cancelled' && order.status !== 'delivered' && order.status !== 'pending' ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm cancel-order">✕ Cancel</button>` : ''}
              ${(order.payment_status || 'unpaid') === 'unpaid' ? `<button type="button" class="adm-btn adm-btn-success adm-btn-sm mark-paid-btn">💵 Mark As Paid</button>` : ''}
            `}
            <!-- 🗑️ PERMANENT DELETE BUTTON FOR ANY ORDER -->
            <button type="button" class="adm-btn adm-btn-outline adm-btn-sm detail-delete-order-btn" style="background:#fef2f2;color:#ef4444;border-color:#fca5a5;font-weight:700;display:inline-flex;align-items:center;gap:.35rem;" title="Permanently delete this order from database">
              <span>🗑️</span> Delete Order
            </button>
          </div>

          <h3 class="adm-card-title" style="margin-top: 1.5rem; margin-bottom: 0.75rem;">Customer Shortcuts</h3>
          <div class="adm-comm-grid">
            <a href="${whatsappLink}" target="_blank" class="adm-comm-btn whatsapp">
              💬 WhatsApp
            </a>
            <a href="${parsedMeta.email ? emailLink : '#'}" class="adm-comm-btn email ${!parsedMeta.email ? 'adm-comm-disabled' : ''}" id="comm-email-btn">
              ✉️ Email
            </a>
            <a href="tel:${order.customer_phone}" class="adm-comm-btn call">
              📞 Call
            </a>
          </div>
        </div>

        <div class="adm-card mt-6">
          <h3 class="adm-card-title">💳 Payment Audit Log</h3>
          <div id="detail-payment-history-container">
            <div class="adm-spinner adm-spinner-sm" style="margin: 1rem auto;" aria-hidden="true"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  content.querySelector('.btn-detail-create-pos-bill')?.addEventListener('click', () => createBillForOrder(order.id));
  content.querySelector('.detail-delete-order-btn')?.addEventListener('click', () => deleteUniversalOrder(order.id));
  content.querySelector('.accept-order')?.addEventListener('click', async () => {
    await updateOrderStatus(order.id, 'preparing');
    order.status = 'preparing';
    order.ticket_status = 'OPEN';
    let items = getItemsForOrder(order.id);
    try {
      await printKOT(order, items);
      showAdminToast(`Order #${formatDailyOrderNumber(order)} accepted! KOT printed for kitchen. 🍳`, 'success');
    } catch(e) {
      showAdminToast(`Order #${formatDailyOrderNumber(order)} accepted! Order placed on hold in preparation.`, 'success');
    }
    renderHoldOrdersPanel();
    renderOrdersTable();
    renderKitchenPanel();
    renderOverview();
    renderOrderDetail(order.id);
  });
  content.querySelector('.reject-order')?.addEventListener('click', async () => {
    if (confirm(`Reject and cancel Order #${formatDailyOrderNumber(order)}?`)) {
      await updateOrderStatus(order.id, 'cancelled');
      order.status = 'cancelled';
      order.ticket_status = 'CANCELLED';
      showAdminToast(`Order #${formatDailyOrderNumber(order)} rejected.`, 'info');
      renderHoldOrdersPanel();
      renderOrdersTable();
      renderOverview();
      renderOrderDetail(order.id);
    }
  });
  content.querySelector('.prep-order')?.addEventListener('click', () => updateOrderStatus(order.id, 'preparing'));
  content.querySelector('.ready-order')?.addEventListener('click', () => updateOrderStatus(order.id, 'ready'));
  content.querySelector('.deliver-order')?.addEventListener('click', () => updateOrderStatus(order.id, 'delivered'));
  content.querySelector('.cancel-order')?.addEventListener('click', () => {
    if (confirm('Cancel this order?')) updateOrderStatus(order.id, 'cancelled');
  });
  content.querySelector('.mark-paid-btn')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to mark this order as paid?')) {
      updateOrderPaymentStatus(order.id, 'paid');
    }
  });
  content.querySelector('.mark-unpaid-btn')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to mark this order as unpaid?')) {
      updateOrderPaymentStatus(order.id, 'unpaid');
    }
  });

  content.querySelector('#comm-email-btn')?.addEventListener('click', (e) => {
    if (!parsedMeta.email) {
      e.preventDefault();
      alert('No email address provided by this customer.');
    }
  });

  // Load payment history asynchronously
  loadAndRenderPaymentHistory(order.id);

  // Map cleanup and initialization
  if (window.orderDetailMap) {
    try {
      window.orderDetailMap.remove();
    } catch (e) {
      console.warn('Error removing map:', e);
    }
    window.orderDetailMap = null;
  }

  if (parsedMeta.type === 'delivery') {
    const mapContainer = document.getElementById('order-detail-map');
    if (mapContainer) {
      try {
        const limraCoords = [21.8603074, 87.4793798];
        const map = L.map('order-detail-map', {
          zoomControl: true,
          scrollWheelZoom: false
        }).setView(limraCoords, 14);
        window.orderDetailMap = map;
        
        const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri'
        });

        L.control.layers({
          "Street Map": streetLayer,
          "Satellite": satelliteLayer
        }, null, { position: 'topright' }).addTo(map);
        
        // Add restaurant marker (Gold)
        const restaurantIcon = L.icon({
          iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41]
        });
        L.marker(limraCoords, { icon: restaurantIcon }).addTo(map).bindPopup('<b>LIMRA Restaurant</b>');

        // Resolve coordinates
        const dbLat = order.latitude !== null ? parseFloat(order.latitude) : null;
        const dbLng = order.longitude !== null ? parseFloat(order.longitude) : null;

        const setupMapAndLogistics = (latVal, lngVal, isGeo = false) => {
          if (window.orderDetailMap !== map) return;

          const clientCoords = [latVal, lngVal];
          const clientIcon = L.icon({
            iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
          });

          const clientMarker = L.marker(clientCoords, { icon: clientIcon }).addTo(map);
          clientMarker.bindPopup(`<b>Delivery Location</b><br>${escapeHtml(parsedMeta.address)}`).openPopup();

          L.polyline([limraCoords, clientCoords], {
            color: '#00b074',
            dashArray: '5, 10',
            weight: 3,
            opacity: 0.8
          }).addTo(map);

          const bounds = L.latLngBounds([limraCoords, clientCoords]);
          map.fitBounds(bounds, { padding: [40, 40] });

          // Calculate logistics distance and ETA
          const dist = getHaversineDistance(limraCoords[0], limraCoords[1], latVal, lngVal);
          const eta = Math.ceil(dist * 2); // 30 km/h is 2 mins/km
          const etaText = dist < 0.5 ? 'Under 2 mins' : `${eta} mins`;

          // Update UI elements
          const distEl = document.getElementById('detail-distance');
          const etaEl = document.getElementById('detail-eta');
          const coordsEl = document.getElementById('detail-coords');
          const navBtn = document.getElementById('detail-nav-btn');

          if (distEl) distEl.textContent = `${dist.toFixed(2)} km`;
          if (etaEl) etaEl.textContent = etaText;
          if (coordsEl) coordsEl.textContent = `${latVal.toFixed(6)}, ${lngVal.toFixed(6)}`;
          if (navBtn) {
            navBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${latVal},${lngVal}`;
          }

          // Dynamic sharing text bindings
          const shareMsg = `*LIMRA Delivery Route Details*\n` +
            `*Order*: #${order.order_number}\n` +
            `*Customer*: ${order.customer_name}\n` +
            `*Phone*: ${order.customer_phone}\n` +
            `*Address*: ${parsedMeta.address}\n` +
            `*Landmark*: ${order.landmark || 'N/A'}\n` +
            `*Notes*: ${order.delivery_notes || 'None'}\n` +
            `*Location link*: https://maps.google.com/?q=${latVal},${lngVal}`;

          const shareSms = `LIMRA Order #${order.order_number} Delivery: ${parsedMeta.address}. Landmark: ${order.landmark || 'N/A'}. Location: https://maps.google.com/?q=${latVal},${lngVal}`;

          document.getElementById('detail-share-wa-btn')?.addEventListener('click', () => {
            window.open(`https://wa.me/?text=${encodeURIComponent(shareMsg)}`, '_blank');
          });

          document.getElementById('detail-share-sms-btn')?.addEventListener('click', () => {
            window.open(`sms:?body=${encodeURIComponent(shareSms)}`, '_blank');
          });

          document.getElementById('detail-copy-details-btn')?.addEventListener('click', () => {
            navigator.clipboard.writeText(shareMsg).then(() => {
              alert('Delivery address details copied to clipboard!');
            });
          });

          document.getElementById('detail-share-sys-btn')?.addEventListener('click', () => {
            if (navigator.share) {
              navigator.share({
                title: `LIMRA Delivery Route Details #${order.order_number}`,
                text: `Customer: ${order.customer_name}\nPhone: ${order.customer_phone}\nAddress: ${parsedMeta.address}`,
                url: `https://maps.google.com/?q=${latVal},${lngVal}`
              }).catch(e => console.warn('Share aborted:', e));
            } else {
              alert('Web Share API not supported on this device/browser.');
            }
          });
        };

        if (dbLat !== null && dbLng !== null) {
          setupMapAndLogistics(dbLat, dbLng);
        } else {
          // Fallback geocoding via Nominatim
          const addrStr = parsedMeta.address;
          if (addrStr) {
            fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addrStr)}`)
              .then(res => res.json())
              .then(data => {
                if (data && data.length > 0 && window.orderDetailMap === map) {
                  const lat = parseFloat(data[0].lat);
                  const lon = parseFloat(data[0].lon);
                  setupMapAndLogistics(lat, lon, true);
                } else {
                  console.warn('Nominatim returned no coordinates in admin detail fallback');
                  map.setView(limraCoords, 14);
                  const coordsEl = document.getElementById('detail-coords');
                  if (coordsEl) coordsEl.textContent = 'Coordinates not found';
                }
              })
              .catch(err => {
                console.warn('Nominatim geocode failed in admin detail fallback:', err);
                map.setView(limraCoords, 14);
              });
          } else {
            map.setView(limraCoords, 14);
          }
        }
      } catch (err) {
        console.warn('Map initialization failed in admin detail:', err);
      }
    }
  }
}

// ════════════════════════════════════════════════════════
// 👥 REGULAR CUSTOMERS & LOYALTY HUB
// ════════════════════════════════════════════════════════

let customerTierFilter = 'all';
let customerActivityFilter = 'all';
let customerSort = 'spend_desc';

function computeCustomerHubData() {
  const allCustomers = buildCustomerStats();
  const now = new Date().getTime();

  // KPI calculations across full database
  const totalGuests = allCustomers.length;
  const vipCount = allCustomers.filter(c => c.tier === 'vip').length;
  const totalLTV = allCustomers.reduce((s, c) => s + (c.totalSpent || 0), 0);
  const repeatGuests = allCustomers.filter(c => (c.orderCount + c.bookingCount) >= 2).length;
  const repeatRate = totalGuests > 0 ? ((repeatGuests / totalGuests) * 100).toFixed(1) : '0';

  let list = allCustomers.slice();

  // 1. Tier Filter
  if (customerTierFilter !== 'all') {
    list = list.filter(c => c.tier === customerTierFilter);
  }

  // 2. Activity Filter
  if (customerActivityFilter === 'month') {
    const monthAgo = now - (30 * 86400000);
    list = list.filter(c => c.lastActivity && new Date(c.lastActivity).getTime() >= monthAgo);
  } else if (customerActivityFilter === 'week') {
    const weekAgo = now - (7 * 86400000);
    list = list.filter(c => c.lastActivity && new Date(c.lastActivity).getTime() >= weekAgo);
  } else if (customerActivityFilter === 'inactive') {
    const monthAgo = now - (30 * 86400000);
    list = list.filter(c => !c.lastActivity || new Date(c.lastActivity).getTime() < monthAgo);
  }

  // 3. Search Query
  const search = ($('customers-search')?.value || '').toLowerCase().trim();
  if (search) {
    list = list.filter(c =>
      (c.name && c.name.toLowerCase().includes(search)) ||
      (c.phone && c.phone.includes(search))
    );
  }

  // 4. Sorting
  if (customerSort === 'spend_desc') {
    list.sort((a, b) => b.totalSpent - a.totalSpent);
  } else if (customerSort === 'visits_desc') {
    list.sort((a, b) => (b.orderCount + b.bookingCount) - (a.orderCount + a.bookingCount));
  } else if (customerSort === 'recent_desc') {
    list.sort((a, b) => {
      const aDate = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const bDate = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return bDate - aDate;
    });
  } else if (customerSort === 'name_asc') {
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  return {
    list,
    totalGuests,
    vipCount,
    totalLTV,
    repeatRate
  };
}

function renderCustomers() {
  const {
    list,
    totalGuests,
    vipCount,
    totalLTV,
    repeatRate
  } = computeCustomerHubData();

  // 1. Update KPI Cards
  if ($('cust-kpi-total-guests')) $('cust-kpi-total-guests').textContent = `${totalGuests}`;
  if ($('cust-kpi-vip-count')) $('cust-kpi-vip-count').textContent = `${vipCount}`;
  if ($('cust-kpi-total-ltv')) $('cust-kpi-total-ltv').textContent = `₹${totalLTV.toFixed(2)}`;
  if ($('cust-kpi-repeat-rate')) $('cust-kpi-repeat-rate').textContent = `${repeatRate}%`;

  // 2. Update Summary Bar
  const filteredSpend = list.reduce((s, c) => s + (c.totalSpent || 0), 0);
  if ($('customers-count-label')) $('customers-count-label').textContent = `${list.length} ${list.length === 1 ? 'guest' : 'guests'}`;
  if ($('customers-total-spend-label')) $('customers-total-spend-label').textContent = `₹${filteredSpend.toFixed(2)}`;

  // 3. Render Customer Cards Grid
  const el = $('customers-list');
  if (!el) return;

  if (list.length === 0) {
    el.innerHTML = '<div class="adm-card adm-empty" style="grid-column: 1 / -1;padding:2.5rem;text-align:center;">No customers match your selected tier or search filters.</div>';
    return;
  }

  el.innerHTML = list.map(c => {
    const topItems = Object.entries(c.items).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const tierBadge = c.tier === 'vip'
      ? '<span style="background:#fef3c7;color:#b45309;font-size:0.75rem;font-weight:800;padding:.15rem .5rem;border-radius:999px;border:1px solid #fde68a;">👑 VIP PATRON</span>'
      : (c.tier === 'frequent' ? '<span style="background:#e0e7ff;color:#4338ca;font-size:0.75rem;font-weight:700;padding:.15rem .5rem;border-radius:999px;border:1px solid #c7d2fe;">🥈 FREQUENT GUEST</span>' : '<span style="background:#f0fdf4;color:#166534;font-size:0.75rem;font-weight:600;padding:.15rem .5rem;border-radius:999px;border:1px solid #bbf7d0;">🌱 NEW GUEST</span>');

    const totalVisits = c.orderCount + c.bookingCount;
    const cleanPhone = (c.phone || '').replace(/\D/g, '');
    const waLink = cleanPhone ? `https://wa.me/91${cleanPhone.slice(-10)}` : '#';

    return `
      <div class="adm-card" style="display:flex;flex-direction:column;gap:.75rem;padding:1.15rem;border-radius:14px;border:1px solid var(--adm-border);background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.03);">
        
        <!-- Header: Avatar, Name, Tier -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">
          <div style="display:flex;align-items:center;gap:.75rem;">
            <div class="adm-customer-avatar" style="width:42px;height:42px;font-size:1.1rem;background:#eef2ff;color:#4f46e5;font-weight:800;">
              ${initials(c.name)}
            </div>
            <div>
              <div style="font-weight:800;color:#111827;font-size:.92rem;">${escapeHtml(c.name)}</div>
              <a href="tel:${c.phone}" style="font-size:.78rem;color:#6366f1;text-decoration:none;font-weight:600;">📱 ${escapeHtml(c.phone)}</a>
            </div>
          </div>
          <div>${tierBadge}</div>
        </div>

        <!-- Metrics Row -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;background:#f8fafc;padding:.6rem .8rem;border-radius:10px;border:1px solid #f1f5f9;font-size:.8rem;">
          <div>
            <span style="color:var(--adm-muted);display:block;font-size:0.75rem;">Lifetime Spend</span>
            <strong style="color:#059669;font-size:.92rem;">₹${Number(c.totalSpent || 0).toFixed(2)}</strong>
          </div>
          <div>
            <span style="color:var(--adm-muted);display:block;font-size:0.75rem;">Total Visits</span>
            <strong style="color:#111827;font-size:.92rem;">${totalVisits} visits</strong> (${c.orderCount} ord)
          </div>
        </div>

        <!-- Favorite Dishes Chips -->
        ${topItems.length > 0 ? `
          <div style="font-size:.75rem;">
            <span style="color:var(--adm-muted);font-weight:600;display:block;margin-bottom:3px;">Favorite Dishes:</span>
            <div style="display:flex;gap:.3rem;flex-wrap:wrap;">
              ${topItems.map(([name, qty]) => `
                <span style="background:#f1f5f9;color:#334155;padding:.15rem .45rem;border-radius:6px;font-size:0.75rem;font-weight:500;">
                  ${escapeHtml(name)} <strong style="color:#6366f1;">(${qty})</strong>
                </span>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Footer / Time & Actions -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:.5rem;border-top:1px solid var(--adm-border);font-size:.75rem;">
          <span style="color:var(--adm-muted);">
            ⏱️ ${c.lastActivity ? timeSince(c.lastActivity) : 'No activity'}
          </span>
          <div style="display:flex;gap:.35rem;align-items:center;">
            <button type="button" class="adm-btn adm-btn-outline adm-btn-sm cust-history-btn" data-phone="${c.phone}" style="font-size:0.75rem;padding:.2rem .5rem;" title="View complete order history">
              👁️ History
            </button>
            ${cleanPhone ? `
              <a href="${waLink}" target="_blank" class="adm-btn adm-btn-outline adm-btn-sm" style="font-size:0.75rem;padding:.2rem .45rem;color:#16a34a;border-color:#bbf7d0;" title="Send WhatsApp message">
                💬 WA
              </a>
              <a href="tel:${c.phone}" class="adm-btn adm-btn-outline adm-btn-sm" style="font-size:0.75rem;padding:.2rem .45rem;color:#4f46e5;border-color:#c7d2fe;" title="Call customer">
                📞
              </a>
            ` : ''}
          </div>
        </div>

      </div>
    `;
  }).join('');

  // Wire history button clicks
  el.querySelectorAll('.cust-history-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openCustomerHistoryModal(btn.dataset.phone);
    });
  });
}

function openCustomerHistoryModal(phone) {
  const allCustomers = buildCustomerStats();
  const c = allCustomers.find(x => x.phone === phone);
  if (!c) {
    showAdminToast('Customer profile not found.', 'error');
    return;
  }

  // Header & Avatar
  if ($('cust-modal-avatar')) $('cust-modal-avatar').textContent = initials(c.name);
  if ($('cust-modal-title-name')) $('cust-modal-title-name').textContent = c.name;
  if ($('cust-modal-phone-link')) {
    $('cust-modal-phone-link').textContent = c.phone;
    $('cust-modal-phone-link').href = `tel:${c.phone}`;
  }
  if ($('cust-modal-lifetime-spend')) $('cust-modal-lifetime-spend').textContent = `₹${Number(c.totalSpent || 0).toFixed(2)}`;
  if ($('cust-modal-total-visits')) $('cust-modal-total-visits').textContent = `${c.orderCount + c.bookingCount}`;

  // Tier Badge
  const tierBadge = $('cust-modal-tier-badge');
  if (tierBadge) {
    if (c.tier === 'vip') {
      tierBadge.textContent = '👑 VIP Patron';
      tierBadge.style.background = '#fef3c7';
      tierBadge.style.color = '#b45309';
    } else if (c.tier === 'frequent') {
      tierBadge.textContent = '🥈 Frequent Guest';
      tierBadge.style.background = '#e0e7ff';
      tierBadge.style.color = '#4338ca';
    } else {
      tierBadge.textContent = '🌱 New Guest';
      tierBadge.style.background = '#f0fdf4';
      tierBadge.style.color = '#166534';
    }
  }

  // Favorite Items
  const favWrap = $('cust-modal-fav-items');
  if (favWrap) {
    const topItems = Object.entries(c.items).sort((a, b) => b[1] - a[1]);
    if (topItems.length === 0) {
      favWrap.innerHTML = '<span style="color:var(--adm-muted);font-size:.8rem;">No dishes recorded yet.</span>';
    } else {
      favWrap.innerHTML = topItems.map(([name, qty]) => `
        <span style="background:#eef2ff;color:#3730a3;padding:.2rem .6rem;border-radius:6px;font-size:.78rem;font-weight:600;">
          ${escapeHtml(name)} <strong style="color:#6366f1;">(${qty} ordered)</strong>
        </span>
      `).join('');
    }
  }

  // Orders Ledger Table
  const tbody = $('cust-modal-orders-tbody');
  if (tbody) {
    if (!c.ordersHistory || c.ordersHistory.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--adm-muted);">No order transactions found for this customer.</td></tr>';
    } else {
      tbody.innerHTML = c.ordersHistory.map(o => {
        const items = getItemsForOrder(o.id);
        const parsed = parseNotesMetadata(o.notes, o);
        const tableNum = parsed.tableNumber || o.table_number || '';
        const typeStr = parsed.type === 'table' ? `🪑 Table ${tableNum || '—'}` : (parsed.type === 'delivery' ? '🚗 Delivery' : '🥡 Pickup');
        const itemsSummary = items.length
          ? items.map(i => `${i.quantity}× ${escapeHtml(i.item_name)}`).join(', ')
          : '—';
        const d = new Date(o.created_at);
        const dateStr = d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) + ', ' + d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
        const payStr = o.payment_status === 'paid' ? `<span style="color:#166534;font-weight:700;">Paid (${parsed.paymentMode || o.payment_mode || 'Cash'})</span>` : '<span style="color:#dc2626;">Unpaid</span>';

        return `
          <tr>
            <td><strong>#${o.order_number || o.id.slice(0, 8)}</strong></td>
            <td style="font-size:.8rem;color:var(--adm-muted);">${dateStr}</td>
            <td><span style="font-weight:600;font-size:.8rem;">${typeStr}</span></td>
            <td style="font-size:.8rem;max-width:260px;">${itemsSummary}</td>
            <td style="font-size:.78rem;">${payStr}</td>
            <td style="text-align:right;"><strong style="color:#059669;">₹${Number(o.total_amount || 0).toFixed(2)}</strong></td>
          </tr>
        `;
      }).join('');
    }
  }

  // Show Modal
  const modal = $('adm-customer-history-modal');
  if (modal) modal.style.display = 'flex';
}

function closeCustomerHistoryModal() {
  const modal = $('adm-customer-history-modal');
  if (modal) modal.style.display = 'none';
}

function exportCustomersCSV() {
  const { list } = computeCustomerHubData();
  if (!list.length) {
    showAdminToast('No customer records to export.', 'error');
    return;
  }

  const headers = ['Customer Name', 'Phone Number', 'Email', 'Loyalty Tier', 'Total Visits', 'Orders Count', 'Bookings Count', 'Total Lifetime Spend (INR)', 'Favorite Dishes', 'Last Activity Date'];
  const rows = list.map(c => {
    const topDishes = Object.entries(c.items).sort((a, b) => b[1] - a[1]).map(([n, q]) => `${n} (${q}x)`).join('; ');
    return [
      `"${(c.name || 'Customer').replace(/"/g, '""')}"`,
      `"${c.phone || ''}"`,
      `"${c.email || ''}"`,
      `"${c.tier.toUpperCase()}"`,
      `"${c.orderCount + c.bookingCount}"`,
      `"${c.orderCount}"`,
      `"${c.bookingCount}"`,
      `"${Number(c.totalSpent || 0).toFixed(2)}"`,
      `"${topDishes.replace(/"/g, '""')}"`,
      `"${c.lastActivity ? new Date(c.lastActivity).toLocaleString('en-IN') : ''}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `LIMRA_Customers_Loyalty_Report_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAdminToast('Customer loyalty report exported to CSV! 📥', 'success');
}

function initCustomersListeners() {
  // Tier pill buttons
  $('customers-tier-presets')?.querySelectorAll('.pos-cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      $('customers-tier-presets').querySelectorAll('.pos-cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      customerTierFilter = btn.dataset.tier;
      renderCustomers();
    });
  });

  // Dropdowns & Search
  $('customers-activity-filter')?.addEventListener('change', (e) => {
    customerActivityFilter = e.target.value;
    renderCustomers();
  });

  $('customers-sort-filter')?.addEventListener('change', (e) => {
    customerSort = e.target.value;
    renderCustomers();
  });

  $('customers-search')?.addEventListener('input', () => {
    renderCustomers();
  });

  $('customers-export-btn')?.addEventListener('click', exportCustomersCSV);

  // Modal close handlers
  $('cust-modal-close-btn')?.addEventListener('click', closeCustomerHistoryModal);
  $('adm-customer-history-modal')?.addEventListener('click', (e) => {
    if (e.target === $('adm-customer-history-modal')) closeCustomerHistoryModal();
  });
}

// ── Customer Analysis ────────────────────────────────────

// ── Hold Orders ──────────────────────────────────────────

// ── Hold Orders & Table Session Manager ──────────────────────────────────────────

function getHeldOrders() {
  return orders
    .filter(o => o.status === 'hold' || o.status === 'preparing')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // oldest first
}

function timeSince(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getActiveTableSessions() {
  const activeTableOrders = orders.filter(o => {
    if (o.ticket_status) {
      if (o.ticket_status === 'CLOSED' || o.ticket_status === 'CANCELLED' || o.ticket_status === 'BILLED') return false;
    } else {
      if (o.status === 'delivered' || o.status === 'cancelled' || o.status === 'billed') return false;
    }
    const meta = parseNotesMetadata(o.notes, o);
    return o.order_type === 'table' || meta.type === 'table' || meta.tableNumber || o.table_number;
  });

  const sessionMap = new Map();

  for (const order of activeTableOrders) {
    const meta = parseNotesMetadata(order.notes, order);
    const tNum = parseInt(String(meta.tableNumber || order.table_number || '').replace(/\D/g, ''), 10);
    if (!tNum) continue;

    if (!sessionMap.has(tNum)) {
      sessionMap.set(tNum, {
        tableNumber: tNum,
        orders: [],
        orderIds: [],
        kots: [],
        items: [],
        totalAmount: 0,
        earliestTime: order.created_at,
        customerName: order.customer_name || 'Dine-in Guest',
        customerPhone: order.customer_phone || ''
      });
    }

    const sess = sessionMap.get(tNum);
    sess.orders.push(order);
    sess.orderIds.push(order.id);
    sess.kots.push({
      id: order.id,
      orderNumber: formatDailyOrderNumber(order),
      amount: Number(order.total_amount || 0),
      createdAt: order.created_at
    });
    sess.totalAmount += Number(order.total_amount || 0);
    if (new Date(order.created_at) < new Date(sess.earliestTime)) {
      sess.earliestTime = order.created_at;
    }
    const oItems = getItemsForOrder(order.id);
    sess.items.push(...oItems);
  }

  return Array.from(sessionMap.values()).map(sess => {
    sess.consolidatedItems = consolidateOrderItems(sess.items);
    return sess;
  }).sort((a, b) => a.tableNumber - b.tableNumber);
}

let currentHoldSettleTarget = null;
let currentHoldSettleMethod = 'cash';
let isHoldSettling = false;

async function createFinalBillForTableSession(tableNum, paymentMethod = 'cash', txnRef = '', idempotencyKey = null, skipConfirm = false, autoPrintBill = true) {
  const sessions = getActiveTableSessions();
  const session = sessions.find(s => s.tableNumber === tableNum);
  if (!session || !session.orders.length) {
    showAdminToast('No active session found for Table ' + tableNum, 'error');
    return;
  }

  const primaryOrder = session.orders[0];
  if (!primaryOrder) {
    showAdminToast('No primary order found for Table ' + tableNum, 'error');
    return;
  }

  // If called directly without prior modal confirmation, open the Cash/UPI settlement modal
  if (!skipConfirm) {
    openHoldSettleModal({ type: 'table', tableNumber: tableNum, session });
    return;
  }

  const validMethod = ['cash', 'upi', 'card', 'pay_later'].includes(paymentMethod) ? paymentMethod : 'cash';
  const upiRefNote = (validMethod === 'upi' && txnRef) ? ` [UPI_REF: ${txnRef}]` : '';

  // 1. Consolidate all items across all KOTs in this session
  const consolidatedItems = session.consolidatedItems || consolidateOrderItems(session.items);
  const s = getBillSettings();
  const billing = calculateOrderBilling({
    items: consolidatedItems,
    deliveryFee: 0,
    cgstRate: s.cgstRate ?? 2.5,
    sgstRate: s.sgstRate ?? 2.5
  });
  const subtotal = billing.subtotal;
  const cgst = billing.cgstAmt;
  const sgst = billing.sgstAmt;
  let grandTotal = billing.grandTotal;
  if (grandTotal <= 0 && Number(session.totalAmount || 0) > 0) {
    grandTotal = Number(session.totalAmount);
  } else if (grandTotal <= 0 && Number(primaryOrder.total_amount || 0) > 0) {
    grandTotal = Number(primaryOrder.total_amount);
  }

  const kotNumbersText = session.kots.map(k => `#${k.orderNumber}`).join(' + ');
  const nowIso = new Date().toISOString();

  const finalBillOrder = {
    ...primaryOrder,
    total_amount: grandTotal,
    subtotal_amount: subtotal || 0,
    discount_pct: billing.discountPct || 0,
    discount_amount: billing.discountAmt || 0,
    taxable_amount: billing.taxableValue || 0,
    cgst_amount: cgst || 0,
    sgst_amount: sgst || 0,
    delivery_fee: 0,
    packaging_fee: 0,
    round_off_amount: billing.roundOff || 0,
    status: 'delivered',
    payment_status: 'paid',
    ticket_status: 'CLOSED',
    settled_at: nowIso,
    payment_method: validMethod,
    payment_mode: validMethod,
    notes: `[TABLE: ${tableNum}] [FINAL_BILL] [KOTS: ${kotNumbersText}] [CGST: ${billing.cgstRate}%] [SGST: ${billing.sgstRate}%] [PAYMENT: ${validMethod}]${upiRefNote}`
  };

  // 2. Concurrency Check: Check if table session was already closed
  if (primaryOrder.ticket_status === 'CLOSED' && primaryOrder.payment_status === 'paid') {
    showAdminToast(`Table ${tableNum} was already billed and closed by another cashier.`, 'error');
    await refreshDashboard(true);
    return;
  }

  const siblingOrders = session.orders.slice(1);
  const siblingOrderIds = siblingOrders.map(o => o.id);
  const settleIdempotencyKey = idempotencyKey || primaryOrder._settleIdempotencyKey || ((typeof crypto !== 'undefined' && crypto.randomUUID)
    ? `settle-table-${tableNum}-${crypto.randomUUID()}`
    : `settle-table-${tableNum}-${primaryOrder.id}`);
  primaryOrder._settleIdempotencyKey = settleIdempotencyKey;

  // 3. Atomically commit database settlement via settle_order_atomic RPC
  try {
    const primaryFinancials = {
      total_amount: grandTotal,
      subtotal_amount: subtotal || 0,
      discount_pct: billing.discountPct || 0,
      discount_amount: billing.discountAmt || 0,
      taxable_amount: billing.taxableValue || 0,
      cgst_amount: cgst || 0,
      sgst_amount: sgst || 0,
      delivery_fee: 0,
      packaging_fee: 0,
      round_off_amount: billing.roundOff || 0,
      settled_at: nowIso,
      updated_at: nowIso
    };

    if (siblingOrderIds.length > 0) {
      const { error: moveErr } = await insforge.database
        .from('order_items')
        .update({ order_id: primaryOrder.id })
        .in('order_id', siblingOrderIds);
      if (moveErr) throw moveErr;
    }

    let { error: totalErr } = await insforge.database
      .from('orders')
      .update(primaryFinancials)
      .eq('id', primaryOrder.id);
    if (totalErr && (totalErr.code === '42703' || (totalErr.message || '').includes('does not exist'))) {
      console.warn('[Table Settle] Extended financial columns missing in orders table (42703). Retrying with baseline total.');
      const baselineFinancials = {
        total_amount: grandTotal,
        updated_at: nowIso
      };
      const fallbackTotalRes = await insforge.database.from('orders').update(baselineFinancials).eq('id', primaryOrder.id);
      totalErr = fallbackTotalRes.error;
    }
    if (totalErr) throw totalErr;

    const { data: rpcResult, error: rpcError } = await insforge.database.rpc('settle_order_atomic', {
      p_order_id: primaryOrder.id,
      p_payment_method: validMethod,
      p_notes: finalBillOrder.notes,
      p_idempotency_key: settleIdempotencyKey
    });

    if (rpcError) {
      const msg = String(rpcError.message || '');
      if (msg.includes('ORDER_ALREADY_SETTLED')) {
        primaryOrder.ticket_status = 'CLOSED';
        primaryOrder.payment_status = 'paid';
        primaryOrder.status = 'delivered';
        primaryOrder._settlementPendingSync = false;
        persistOrdersCache();
        showAdminToast(`Table ${tableNum} is already settled & closed in cloud! ✓`, 'success');
        renderTablesPanel();
        renderHoldOrdersPanel();
        renderClosedOrdersPanel();
        return;
      }
      throw rpcError;
    }

    if (rpcResult && rpcResult.success === false) {
      throw new Error(rpcResult.error || 'Atomic settlement rejected by database.');
    }

    for (const ord of siblingOrders) {
      const { error: sErr } = await insforge.database
        .from('orders')
        .update({
          status: 'delivered',
          payment_status: 'paid',
          ticket_status: 'CLOSED',
          payment_method: validMethod,
          settled_at: nowIso,
          consolidated_into_order_id: primaryOrder.id
        })
        .eq('id', ord.id);
      if (sErr) throw sErr;
    }
  } catch (cloudErr) {
    const errType = typeof classifyError === 'function' ? classifyError(cloudErr) : 'NETWORK';
    if (errType === ERROR_TYPES.NETWORK || errType === ERROR_TYPES.SERVER_ERROR || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      primaryOrder._settlementPendingSync = true;
      primaryOrder._pendingPaymentMethod = validMethod;
      primaryOrder.ticket_status = 'BILLED';
      primaryOrder.payment_status = 'unpaid';

      if (typeof offlineSync !== 'undefined' && offlineSync.enqueuePosSettlement) {
        offlineSync.enqueuePosSettlement({
          orderId: primaryOrder.id,
          paymentMethod: validMethod,
          notes: finalBillOrder.notes,
          idempotencyKey: settleIdempotencyKey,
          tableNum
        });
        offlineSync.updateSyncIndicator();
      }

      persistOrdersCache();
      showAdminToast(`⚠️ Network Offline: Settlement queued! Table ${tableNum} remains UNPAID until cloud confirms payment.`, 'warning');
      renderTablesPanel();
      return;
    }

    console.error('[Table Session Settle] Atomic RPC error:', cloudErr);
    showAdminToast('Failed to settle table bill: ' + (cloudErr.message || 'Database transaction error'), 'error');
    return;
  }

  delete primaryOrder._settleIdempotencyKey;

  // 4. Update local in-memory state
  const localPrimary = orders.find(x => x.id === primaryOrder.id) || primaryOrder;
  localPrimary.total_amount = grandTotal;
  localPrimary.subtotal_amount = subtotal || 0;
  localPrimary.discount_pct = billing.discountPct || 0;
  localPrimary.discount_amount = billing.discountAmt || 0;
  localPrimary.taxable_amount = billing.taxableValue || 0;
  localPrimary.cgst_amount = cgst || 0;
  localPrimary.sgst_amount = sgst || 0;
  localPrimary.delivery_fee = 0;
  localPrimary.packaging_fee = 0;
  localPrimary.round_off_amount = billing.roundOff || 0;
  localPrimary.settled_at = nowIso;
  localPrimary.status = 'delivered';
  localPrimary.payment_status = 'paid';
  localPrimary.ticket_status = 'CLOSED';
  localPrimary.payment_method = validMethod;
  localPrimary.payment_mode = validMethod;
  localPrimary.notes = finalBillOrder.notes;
  localPrimary.idempotency_key = settleIdempotencyKey;

  siblingOrders.forEach(ord => {
    const local = orders.find(x => x.id === ord.id) || ord;
    local.status = 'delivered';
    local.payment_status = 'paid';
    local.ticket_status = 'CLOSED';
    local.payment_method = validMethod;
    local.payment_mode = validMethod;
    local.settled_at = nowIso;
    local.consolidated_into_order_id = primaryOrder.id;
  });

  if (siblingOrderIds.length > 0) {
    orderItems.forEach(item => {
      if (siblingOrderIds.includes(item.order_id)) {
        item.order_id = primaryOrder.id;
      }
    });
  }

  persistOrdersCache();

  session.orders.forEach(o => markOrderNotificationsRead(o.id));

  // 5. EXTERNAL SIDE EFFECT 1: Print Final Consolidated Bill with Tax & UPI QR (Decoupled, conditional on autoPrintBill)
  if (autoPrintBill) {
    try {
      await printOrderReceiptWithTax(finalBillOrder, consolidatedItems);
    } catch (printErr) {
      console.error('[Table Bill Print Error]:', printErr);
      showAdminToast(`Table ${tableNum} session closed in DB, but printing failed: ${printErr.message}. Use Reprint button.`, 'warning');
    }
  }

  showAdminToast(`Table ${tableNum} Final Bill generated (${validMethod.toUpperCase()}) & session closed! ✅`, 'success');

  // 6. EXTERNAL SIDE EFFECT 2: Google Sheets auto-sync (Decoupled)
  if (isGoogleSheetAutoSyncEnabled()) {
    syncOrderToGoogleSheet(localPrimary || finalBillOrder).catch(e => console.warn('[Google Sheet] Table bill auto-sync error:', e));
  }

  // Refresh all UI panels
  renderOverview();
  renderHoldOrdersPanel();
  renderClosedOrdersPanel();
  renderBillingQuickCards();
  renderBillingTotalBills();
  renderTablesPanel();
  renderKitchenPanel();
}

async function settleSingleHeldOrder(orderId, paymentMethod = 'cash', txnRef = '', idempotencyKey = null, autoPrintBill = false) {
  const order = orders.find(o => String(o.id) === String(orderId));
  if (!order) {
    showAdminToast('Held order not found.', 'error');
    return;
  }

  if (order.status === 'cancelled' || order.ticket_status === 'CANCELLED') {
    showAdminToast(`Order #${order.order_number} is cancelled and cannot be settled.`, 'error');
    return;
  }

  const validMethod = ['cash', 'upi', 'card', 'pay_later'].includes(paymentMethod) ? paymentMethod : 'cash';
  const settleIdempotencyKey = idempotencyKey || order._settleIdempotencyKey || ((typeof crypto !== 'undefined' && crypto.randomUUID)
    ? `settle-${orderId}-${crypto.randomUUID()}`
    : `settle-${orderId}`);
  order._settleIdempotencyKey = settleIdempotencyKey;

  const upiRefNote = (validMethod === 'upi' && txnRef) ? ` [UPI_REF: ${txnRef}]` : '';
  const currentNotes = (order.notes || '');
  let updatedNotes = currentNotes;
  if (/\[PAYMENT:[^\]]*\]/i.test(updatedNotes)) {
    updatedNotes = updatedNotes.replace(/\[PAYMENT:[^\]]*\]/i, `[PAYMENT: ${validMethod}]`);
  } else {
    updatedNotes = (updatedNotes ? updatedNotes + ' ' : '') + `[PAYMENT: ${validMethod}]`;
  }
  if (upiRefNote) {
    if (/\[UPI_REF:[^\]]*\]/i.test(updatedNotes)) {
      updatedNotes = updatedNotes.replace(/\[UPI_REF:[^\]]*\]/i, upiRefNote.trim());
    } else {
      updatedNotes = (updatedNotes ? updatedNotes + ' ' : '') + upiRefNote.trim();
    }
  }

  // 1. ATOMIC SETTLEMENT IN DATABASE FIRST VIA settle_order_atomic RPC
  try {
    const { data: rpcResult, error: rpcError } = await insforge.database.rpc('settle_order_atomic', {
      p_order_id: order.id,
      p_payment_method: validMethod,
      p_notes: updatedNotes,
      p_idempotency_key: settleIdempotencyKey
    });

    if (rpcError) {
      const errMsg = String(rpcError.message || '');
      if (errMsg.includes('ORDER_ALREADY_SETTLED')) {
        order.payment_status = 'paid';
        order.ticket_status = 'CLOSED';
        order.status = 'delivered';
        order._settlementPendingSync = false;
        persistOrdersCache();
        showAdminToast(`Order #${order.order_number} is already settled & closed in cloud! ✓`, 'success');
        renderTablesPanel();
        renderHoldOrdersPanel();
        renderClosedOrdersPanel();
        return;
      }
      if (errMsg.includes('ORDER_CANCELLED')) {
        showAdminToast(`Order #${order.order_number} is cancelled and cannot be settled.`, 'error');
        return;
      }
      console.error('[Hold Settle RPC Error]:', rpcError);
      showAdminToast('Failed to settle held order: ' + (errMsg || 'Database transaction error'), 'error');
      return;
    }

    if (rpcResult && rpcResult.success === false) {
      showAdminToast('Failed to settle held order: ' + (rpcResult.error || 'Settlement rejected'), 'error');
      return;
    }
  } catch (rpcEx) {
    console.error('[Hold Settle Exception]:', rpcEx);
    showAdminToast('Failed to settle held order: ' + (rpcEx.message || 'Network or database error'), 'error');
    return;
  }

  delete order._settleIdempotencyKey;

  // 2. Database committed! Now update local in-memory state
  order.status = 'delivered';
  order.payment_status = 'paid';
  order.ticket_status = 'CLOSED';
  order.payment_method = validMethod;
  order.payment_mode = validMethod;
  order.notes = updatedNotes;
  order.idempotency_key = settleIdempotencyKey;
  order.settled_at = rpcResult?.settled_at || new Date().toISOString();
  order.updated_at = new Date().toISOString();
  persistOrdersCache();

  // 3. Print final customer bill (only if explicitly requested; prevented by default for held order settlements to avoid duplicate printing)
  if (autoPrintBill) {
    const items = getItemsForOrder(order.id);
    try {
      await printOrderReceiptWithTax(order, items);
    } catch (printErr) {
      console.error('[Hold Settle] Print failed:', printErr);
      showAdminToast(`Bill settled in database, but printing encountered an issue: ${printErr.message}. Use Reprint button if needed.`, 'warning');
    }
  }

  // 4. Notifications & UI Refresh
  await markOrderNotificationsRead(orderId);
  showAdminToast(`Order #${order.order_number} billed, settled (${validMethod.toUpperCase()}) & closed! ✅`, 'success');

  // 5. Google Sheets Sync
  if (isGoogleSheetAutoSyncEnabled()) {
    syncOrderToGoogleSheet(order).catch(e => {
      console.warn('[Google Sheet] Hold bill auto-sync error:', e);
    });
  }

  renderOverview();
  renderHoldOrdersPanel();
  renderClosedOrdersPanel();
  renderBillingQuickCards();
  renderBillingTotalBills();
  renderTablesPanel();
  renderKitchenPanel();
}

function openHoldSettleModal(target) {
  if (!target) return;
  const modal = $('adm-hold-settle-modal');
  if (!modal) return;
  closeOrderDetailDrawer();

  currentHoldSettleTarget = target;
  let grandTotal = 0;
  let subtotal = 0;
  let cgst = 0;
  let sgst = 0;
  let itemsCount = 0;
  let orderTitle = '';
  let orderBadge = '';
  let customerName = 'Walk-in Guest';
  let initialPayMethod = 'cash';

  const s = getBillSettings();

  if (target.type === 'table') {
    const sessions = getActiveTableSessions();
    const session = target.session || sessions.find(sess => sess.tableNumber === target.tableNumber);
    if (!session || !session.orders.length) {
      showAdminToast(`No active session found for Table ${target.tableNumber}`, 'error');
      return;
    }
    target.session = session;
    const primaryOrder = session.orders[0];
    const consolidatedItems = session.consolidatedItems || consolidateOrderItems(session.items);
    itemsCount = consolidatedItems.length;

    const billing = calculateOrderBilling({
      items: consolidatedItems,
      deliveryFee: 0,
      cgstRate: s.cgstRate ?? 2.5,
      sgstRate: s.sgstRate ?? 2.5
    });

    subtotal = billing.subtotal;
    cgst = billing.cgstAmt;
    sgst = billing.sgstAmt;
    grandTotal = billing.grandTotal;
    if (grandTotal <= 0 && Number(session.totalAmount || 0) > 0) {
      grandTotal = Number(session.totalAmount);
    }

    orderTitle = `🪑 Table ${target.tableNumber < 10 ? '0' + target.tableNumber : target.tableNumber}`;
    orderBadge = `Dine-In (${session.kots.length} KOT${session.kots.length > 1 ? 's' : ''})`;
    customerName = session.customerName || 'Dine-in Guests';
    initialPayMethod = (primaryOrder?.payment_method || primaryOrder?.payment_mode || 'cash').toLowerCase();

  } else {
    // Single order
    const order = target.order || orders.find(o => String(o.id) === String(target.orderId));
    if (!order) {
      showAdminToast('Order not found.', 'error');
      return;
    }
    target.order = order;
    target.orderId = order.id;

    const items = getItemsForOrder(order.id);
    const parsedMeta = parseNotesMetadata(order.notes, order);
    itemsCount = items.length;

    const billing = calculateOrderBilling({
      items,
      deliveryFee: parsedMeta.deliveryFee || order.delivery_fee || 0,
      discountPct: parsedMeta.discountPct || 0,
      discountAmt: parsedMeta.discountAmt || 0,
      cgstRate: parsedMeta.cgstRate ?? (s.cgstRate ?? 2.5),
      sgstRate: parsedMeta.sgstRate ?? (s.sgstRate ?? 2.5)
    });

    subtotal = billing.subtotal;
    cgst = billing.cgstAmt;
    sgst = billing.sgstAmt;
    grandTotal = billing.grandTotal || Number(order.total_amount || 0);

    const typeLabel = parsedMeta.type === 'delivery' ? '🚗 Delivery' : (parsedMeta.type === 'pickup' ? '🥡 Pickup' : 'Order');
    orderTitle = `#${formatDailyOrderNumber(order)} · ${escapeHtml(order.customer_name || 'Walk-in')}`;
    orderBadge = typeLabel;
    customerName = order.customer_name || 'Walk-in Guest';
    initialPayMethod = (order.payment_method || order.payment_mode || parsedMeta.payment || parsedMeta.paymentMode || 'cash').toLowerCase();
  }

  // Populate Modal UI
  if ($('hold-settle-order-title')) $('hold-settle-order-title').textContent = orderTitle;
  if ($('hold-settle-order-badge')) $('hold-settle-order-badge').textContent = orderBadge;
  if ($('hold-settle-customer-name')) $('hold-settle-customer-name').textContent = customerName;
  if ($('hold-settle-items-count')) $('hold-settle-items-count').textContent = `${itemsCount} dish${itemsCount !== 1 ? 'es' : ''}`;

  if ($('hold-settle-payable-amount')) $('hold-settle-payable-amount').textContent = formatBillAmount(grandTotal);
  if ($('hold-settle-amount-breakdown')) {
    $('hold-settle-amount-breakdown').innerHTML = `
      <span>Subtotal: ${formatBillAmount(subtotal)}</span>
      <span>•</span>
      <span>GST (5%): ${formatBillAmount(cgst + sgst)}</span>
    `;
  }

  // Clear UPI ref input
  if ($('hold-settle-upi-ref')) $('hold-settle-upi-ref').value = '';

  // Select initial payment method (Cash vs UPI)
  selectHoldSettleMethod(initialPayMethod === 'upi' ? 'upi' : 'cash');

  // Reset button state
  const confirmBtn = $('hold-settle-confirm-btn');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '1';
  }

  modal.style.display = 'flex';
}

function selectHoldSettleMethod(method) {
  const valid = (method === 'upi') ? 'upi' : 'cash';
  currentHoldSettleMethod = valid;

  const cashBtn = $('hold-settle-method-cash');
  const upiBtn = $('hold-settle-method-upi');
  const refWrap = $('hold-settle-upi-ref-wrap');
  const confirmText = $('hold-settle-confirm-text');
  const confirmIcon = $('hold-settle-confirm-icon');

  if (cashBtn) {
    const isCash = valid === 'cash';
    cashBtn.classList.toggle('active', isCash);
    cashBtn.style.borderColor = isCash ? '#d97706' : '#cbd5e1';
    cashBtn.style.boxShadow = isCash ? '0 4px 12px rgba(217,119,6,0.15)' : 'none';
    const pill = cashBtn.querySelector('.hold-settle-check-pill');
    if (pill) pill.style.display = isCash ? 'inline-block' : 'none';
  }

  if (upiBtn) {
    const isUpi = valid === 'upi';
    upiBtn.classList.toggle('active', isUpi);
    upiBtn.style.borderColor = isUpi ? '#d97706' : '#cbd5e1';
    upiBtn.style.boxShadow = isUpi ? '0 4px 12px rgba(217,119,6,0.15)' : 'none';
    const pill = upiBtn.querySelector('.hold-settle-check-pill');
    if (pill) pill.style.display = isUpi ? 'inline-block' : 'none';
  }

  if (refWrap) {
    refWrap.style.display = (valid === 'upi') ? 'flex' : 'none';
  }

  if (confirmText) {
    confirmText.textContent = `Confirm ${valid.toUpperCase()} Payment & Settle`;
  }
  if (confirmIcon) {
    confirmIcon.textContent = valid === 'upi' ? '📱' : '💵';
  }
}

function closeHoldSettleModal() {
  currentHoldSettleTarget = null;
  const modal = $('adm-hold-settle-modal');
  if (modal) modal.style.display = 'none';
}

async function executeHoldSettlement() {
  if (isHoldSettling || !currentHoldSettleTarget) return;
  isHoldSettling = true;

  const confirmBtn = $('hold-settle-confirm-btn');
  const confirmText = $('hold-settle-confirm-text');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.6';
  }
  if (confirmText) {
    confirmText.textContent = 'Processing Settlement...';
  }

  const selectedMethod = currentHoldSettleMethod || 'cash';
  const txnRef = ($('hold-settle-upi-ref')?.value || '').trim();
  const idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `settle-${Date.now()}`;

  try {
    const target = currentHoldSettleTarget;
    const isHoldWorkflow = Boolean(
      target.isHoldSettlement ||
      (target.order && target.order.status === 'hold') ||
      (target.session && target.session.orders?.some(o => o.status === 'hold'))
    );

    if (target.type === 'table') {
      await createFinalBillForTableSession(target.tableNumber, selectedMethod, txnRef, idempotencyKey, true, !isHoldWorkflow);
    } else {
      await settleSingleHeldOrder(target.orderId, selectedMethod, txnRef, idempotencyKey, false);
    }
    closeHoldSettleModal();
  } catch (err) {
    console.error('[Hold Settle Execute Error]:', err);
    showAdminToast('Settlement failed: ' + (err.message || 'Unknown error'), 'error');
  } finally {
    isHoldSettling = false;
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
    }
    if (confirmText) {
      confirmText.textContent = `Confirm ${selectedMethod.toUpperCase()} Payment & Settle`;
    }
  }
}

function initHoldSettleModalListeners() {
  $('hold-settle-close-btn')?.addEventListener('click', closeHoldSettleModal);
  $('hold-settle-cancel-btn')?.addEventListener('click', closeHoldSettleModal);

  const modal = $('adm-hold-settle-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeHoldSettleModal();
    });
  }

  $('hold-settle-method-cash')?.addEventListener('click', () => selectHoldSettleMethod('cash'));
  $('hold-settle-method-upi')?.addEventListener('click', () => selectHoldSettleMethod('upi'));

  $('hold-settle-confirm-btn')?.addEventListener('click', executeHoldSettlement);
  initTableTransferModalListeners();
}

window.openHoldSettleModal = openHoldSettleModal;
window.selectHoldSettleMethod = selectHoldSettleMethod;
window.closeHoldSettleModal = closeHoldSettleModal;
window.executeHoldSettlement = executeHoldSettlement;
window.settleSingleHeldOrder = settleSingleHeldOrder;
window.createFinalBillForTableSession = createFinalBillForTableSession;
window.confirmHeldTableOrder = confirmHeldTableOrder;
window.confirmHeldOrder = confirmHeldOrder;
window.settleTableBill = settleTableBill;
window.settleBill = settleBill;
window.setTableBillPaymentMethod = setTableBillPaymentMethod;
window.getOutstandingTableBills = getOutstandingTableBills;
window.getOutstandingBills = getOutstandingBills;
window.getClosedTableBills = getClosedTableBills;
window.getClosedBills = getClosedBills;
window.renderTablesPanel = renderTablesPanel;
window.renderTablesBillSection = renderTablesBillSection;
window.renderTablesCloseSection = renderTablesCloseSection;
window.renderTablesHoldSection = renderTablesHoldSection;
window.getTotalTablesCount = getTotalTablesCount;
window.openTableTransferModal = openTableTransferModal;
window.closeTableTransferModal = closeTableTransferModal;
window.executeTableTransfer = executeTableTransfer;
window.executeTableSwap = executeTableSwap;
window.updateNotesTableNumber = updateNotesTableNumber;

function renderHoldOrdersPanel() {
  const search = ($('hold-orders-search')?.value || '').toLowerCase().trim();
  const tableSessions = getActiveTableSessions();
  const nonTableHoldOrders = orders.filter(o => {
    if (o.status !== 'hold' && o.status !== 'preparing') return false;
    const meta = parseNotesMetadata(o.notes, o);
    const isTable = meta.type === 'table' || o.order_type === 'table' || meta.tableNumber || o.table_number;
    return !isTable;
  });

  // Calculate totals
  const totalTableVal = tableSessions.reduce((s, t) => s + t.totalAmount, 0);
  const totalNonTableVal = nonTableHoldOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
  const totalValue = totalTableVal + totalNonTableVal;
  const totalCount = tableSessions.length + nonTableHoldOrders.length;

  $('hold-stat-count').textContent = totalCount;
  $('hold-stat-value').textContent = fmtMoney(totalValue);
  const oldestTime = tableSessions.length ? tableSessions[0].earliestTime : (nonTableHoldOrders.length ? nonTableHoldOrders[0].created_at : null);
  $('hold-stat-oldest').textContent = oldestTime ? timeSince(oldestTime) : '—';

  const container = $('hold-orders-container');
  if (!container) return;

  if (tableSessions.length === 0 && nonTableHoldOrders.length === 0) {
    container.innerHTML = `<div class="adm-card adm-empty">No active dining tables or held orders right now</div>`;
    return;
  }

  const s = getBillSettings();
  let cardsHtml = '';

  // 1. Render Grouped Active Table Sessions
  tableSessions.forEach(sess => {
    if (search && !String(sess.tableNumber).includes(search) && !sess.customerName.toLowerCase().includes(search) && !sess.customerPhone.includes(search)) {
      return;
    }

    const itemsHtml = sess.consolidatedItems.map(i => `
      <li style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed #f1f5f9;">
        <span style="font-weight:600;color:#1e293b;">${i.quantity}× ${escapeHtml(i.item_name)}</span>
        <span style="color:var(--adm-muted);font-size:.8rem;font-weight:700;">₹${Number(i.line_total).toFixed(2)}</span>
      </li>
    `).join('');

    const subtotal = sess.consolidatedItems.reduce((sum, i) => sum + Number(i.line_total), 0);
    const cgst = subtotal * s.cgstRate / 100;
    const sgst = subtotal * s.sgstRate / 100;
    const grandTotal = subtotal + cgst + sgst;

    const kotBadges = sess.orders.map((o, i) => {
      const rInfo = getOrderRoundInfo(o, orders);
      const rLabel = rInfo.roundNumber ? `Round ${rInfo.roundNumber}` : `Round ${i+1}`;
      const isHold = o.status === 'hold';
      return `
        <span style="background:${isHold ? '#fffbeb' : '#f0fdf4'};color:${isHold ? '#b45309' : '#15803d'};border:1px solid ${isHold ? '#fed7aa' : '#bbf7d0'};border-radius:6px;padding:.15rem .45rem;font-size:0.75rem;font-weight:700;display:inline-flex;align-items:center;gap:3px;">
          <span>🗒️ #${formatDailyOrderNumber(o)} · ${rLabel} (₹${Number(o.total_amount || 0).toFixed(0)}) ${isHold ? '⏸️ Hold' : '✓ Active'}</span>
          <button type="button" class="cancel-single-round-btn" data-order-id="${o.id}" data-round="${rLabel}" style="background:none;border:none;color:#dc2626;cursor:pointer;font-weight:900;font-size:0.75rem;padding:0 2px;margin-left:2px;border-radius:3px;" title="Cancel only this round">✕</button>
        </span>
      `;
    }).join('');

    cardsHtml += `
      <div class="adm-hold-card" data-table-number="${sess.tableNumber}" style="border-top:4px solid #6366f1;">
        <div class="adm-hold-card-head">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
              <span style="background:#eef2ff;color:#4f46e5;font-size:.85rem;font-weight:900;padding:.2rem .65rem;border-radius:999px;border:1px solid #c7d2fe;">
                🪑 Table ${sess.tableNumber}
              </span>
              <span style="background:#ecfdf5;color:#059669;font-size:0.75rem;font-weight:700;padding:.15rem .45rem;border-radius:999px;">
                ● Active Dining Session
              </span>
            </div>
            <div style="font-size:.75rem;color:var(--adm-muted);margin-top:4px;">
              ${escapeHtml(sess.customerName)} ${sess.customerPhone ? `· ${escapeHtml(sess.customerPhone)}` : ''}
            </div>
            <div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.4rem;">
              ${kotBadges}
            </div>
          </div>
          <span class="adm-hold-time">⏱ ${timeSince(sess.earliestTime)}</span>
        </div>

        <div style="font-size:.75rem;font-weight:700;color:var(--adm-muted);text-transform:uppercase;margin-top:.6rem;letter-spacing:.5px;">
          Combined Items (${sess.consolidatedItems.length} dishes):
        </div>
        <ul class="adm-hold-items" style="list-style:none;padding:0;margin:.4rem 0;max-height:160px;overflow-y:auto;">
          ${itemsHtml}
        </ul>

        <!-- Tax & Totals Summary -->
        <div style="border-top:1px dashed var(--adm-border);padding-top:.5rem;margin-top:.25rem;font-size:.78rem;color:var(--adm-muted);">
          <div style="display:flex;justify-content:space-between;"><span>Combined Subtotal</span><span>₹${subtotal.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span>Taxes (CGST ${s.cgstRate}% + SGST ${s.sgstRate}%)</span><span>₹${(cgst + sgst).toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:900;color:var(--adm-text);margin-top:.3rem;font-size:.92rem;">
            <span>Current Table Total</span>
            <span style="color:#6366f1;">₹${grandTotal.toFixed(2)}</span>
          </div>
        </div>

        <div class="adm-hold-card-footer" style="margin-top:.85rem;">
          <strong class="adm-hold-amount" style="font-size:1.1rem;color:#6366f1;">₹${grandTotal.toFixed(2)}</strong>
          <div class="adm-hold-actions" style="flex-wrap:wrap;gap:.4rem;">
            <button type="button" class="adm-btn adm-btn-outline adm-btn-sm table-edit-items-btn" data-table="${sess.tableNumber}" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0;font-weight:700;" title="Edit items, change quantities or cancel dishes from Table ${sess.tableNumber}">
              ✏️ Edit / Cancel Dishes
            </button>
            <button type="button" class="adm-btn adm-btn-outline adm-btn-sm table-add-kot-btn" data-table="${sess.tableNumber}" style="background:#eef2ff;color:#4f46e5;border-color:#c7d2fe;font-weight:700;" title="Add new dishes with KOT">
              ➕ Add Dishes (KOT)
            </button>
            <button type="button" class="adm-btn adm-btn-outline adm-btn-sm table-print-kot-btn" data-table="${sess.tableNumber}" style="background:#fff3e0;border-color:#f59e0b;color:#b45309;" title="Print consolidated kitchen ticket">
              🖨️ Repr. KOTs
            </button>
            <button type="button" class="adm-btn adm-btn-primary adm-btn-sm table-final-bill-btn" data-table="${sess.tableNumber}" style="background:#10b981;border-color:#10b981;font-weight:800;padding:.35rem .75rem;" title="Confirm held order, generate unpaid bill, and release Table ${sess.tableNumber}">
              ✔️ Confirm Bill
            </button>
            <button type="button" class="adm-btn adm-btn-outline adm-btn-sm table-cancel-btn" data-table="${sess.tableNumber}" style="border-color:#ff5b5b;color:#ff5b5b;font-weight:700;" title="Cancel all orders for Table ${sess.tableNumber}">
              ✕ Cancel Table
            </button>
          </div>
        </div>
      </div>
    `;
  });

  // 2. Render Non-Table Hold Orders (Delivery & Pickup)
  nonTableHoldOrders.forEach(order => {
    if (search && !order.customer_name.toLowerCase().includes(search) && !order.customer_phone.includes(search) && !String(order.order_number).includes(search)) {
      return;
    }
    const rawItems = getItemsForOrder(order.id);
    const items = consolidateOrderItems(rawItems);
    const parsedMeta = parseNotesMetadata(order.notes, order);
    const isPrep = order.status === 'preparing';
    const typeLabel = isPrep
      ? (parsedMeta.type === 'delivery' ? '🍳 Delivery (In Prep)' : '🍳 Pickup (In Prep)')
      : (parsedMeta.type === 'delivery' ? '🚗 Delivery Hold' : '🥡 Pickup Hold');

    const itemsHtml = items.map(i => `<li style="display:flex;justify-content:space-between;padding:2px 0;"><span>${i.quantity}× ${escapeHtml(i.item_name)}</span><span style="color:var(--adm-muted);font-size:.8rem;font-weight:600;">₹${Number(i.line_total).toFixed(2)}</span></li>`).join('');

    cardsHtml += `
      <div class="adm-hold-card" data-order-id="${order.id}">
        <div class="adm-hold-card-head">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
              <p class="adm-hold-card-title">#${formatDailyOrderNumber(order)} · ${escapeHtml(order.customer_name || 'Walk-in')}</p>
            </div>
            <div style="font-size:.75rem;color:var(--adm-muted);margin-top:2px;">${escapeHtml(order.customer_phone || '—')}</div>
            <span class="adm-pill" style="background:${isPrep ? '#ecfdf5' : '#fff3e6'};color:${isPrep ? '#059669' : '#f2994a'};border:1px solid ${isPrep ? '#a7f3d0' : '#fed7aa'};margin-top:.25rem;display:inline-block;font-weight:700;">${typeLabel}</span>
          </div>
          <span class="adm-hold-time">⏱ ${timeSince(order.created_at)}</span>
        </div>

        <ul class="adm-hold-items" style="list-style:none;padding:0;margin:.5rem 0;max-height:160px;overflow-y:auto;">${itemsHtml}</ul>

        <div class="adm-hold-card-footer" style="margin-top:.75rem;">
          <strong class="adm-hold-amount">₹${Number(order.total_amount).toFixed(2)}</strong>
          <div class="adm-hold-actions" style="flex-wrap:wrap;gap:.4rem;">
            <button type="button" class="adm-btn adm-btn-outline adm-btn-sm hold-edit-items-btn" data-order-id="${order.id}" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0;font-weight:700;" title="Edit items, change quantities or cancel dishes">✏️ Edit / Cancel Dishes</button>
            <button type="button" class="adm-btn adm-btn-outline adm-btn-sm hold-add-items-btn" data-order-id="${order.id}" style="background:#eef2ff;color:#4f46e5;border-color:#c7d2fe;font-weight:700;">➕ Add Dishes</button>
            <button type="button" class="adm-btn adm-btn-outline adm-btn-sm hold-resume-pos-btn" data-order-id="${order.id}" style="background:#fef3c7;border-color:#f59e0b;color:#92400e;font-weight:700;" title="Resume this order in POS billing">▶️ Resume in POS</button>
            <button type="button" class="adm-btn adm-btn-outline adm-btn-sm hold-print-kot-btn" data-order-id="${order.id}" style="background:#fff3e0;border-color:#f59e0b;color:#b45309;">🖨️ Repr. KOT</button>
            <button type="button" class="adm-btn adm-btn-primary adm-btn-sm hold-final-bill-btn" data-order-id="${order.id}" style="background:#10b981;border-color:#10b981;font-weight:700;" title="Confirm order, generate unpaid bill, and move to Bill section">✔️ Confirm Bill</button>
            <button type="button" class="adm-btn adm-btn-outline adm-btn-sm hold-cancel-btn" data-order-id="${order.id}" style="border-color:#cbd5e1;color:#64748b;font-weight:700;">✕ Cancel</button>
            <button type="button" class="adm-btn adm-btn-outline adm-btn-sm hold-delete-btn" data-order-id="${order.id}" style="border-color:#fca5a5;color:#ef4444;background:#fef2f2;font-weight:700;" title="Permanently delete this order from database">🗑️ Delete</button>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = cardsHtml || `<div class="adm-card adm-empty">No held orders match your search</div>`;

  // Wire up Table Session Buttons
  container.querySelectorAll('.table-edit-items-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tableNum = parseInt(btn.dataset.table, 10);
      if (tableNum) openHoldEditModal(tableNum, 'edit');
    });
  });

  container.querySelectorAll('.table-add-kot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tableNum = parseInt(btn.dataset.table, 10);
      if (tableNum) openHoldEditModal(tableNum, 'add');
    });
  });

  container.querySelectorAll('.table-final-bill-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tableNum = parseInt(btn.dataset.table, 10);
      if (tableNum) await confirmHeldTableOrder(tableNum);
    });
  });

  container.querySelectorAll('.table-print-kot-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tableNum = parseInt(btn.dataset.table, 10);
      const session = tableSessions.find(s => s.tableNumber === tableNum);
      if (!session) return;
      const primaryOrder = session.orders[0];
      await printKOT(primaryOrder, session.consolidatedItems, { isReprint: true });
    });
  });

  container.querySelectorAll('.table-cancel-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tableNum = parseInt(btn.dataset.table, 10);
      const session = tableSessions.find(s => s.tableNumber === tableNum);
      if (!session || !session.orders.length) return;
      if (session.orders.some(ord => isOrderPaidOrClosed(ord))) {
        showAdminToast(`Cannot cancel Table ${tableNum}: one or more orders are already paid or closed.`, 'error');
        return;
      }
      if (!confirm(`Cancel all active orders for Table ${tableNum}? This will remove Table ${tableNum} from active sessions.`)) return;

      try {
        const res = await cancelTableOrders(tableNum, session.orders);
        if (!res.success) return;
        showAdminToast(`All orders for Table ${tableNum} cancelled.`, 'success');
        renderOverview();
        renderHoldOrdersPanel();
        renderOrdersTable();
        renderClosedOrdersPanel();
        renderBillingQuickCards();
        renderBillingTotalBills();
      } catch (err) {
        showAdminToast('Failed to cancel table orders: ' + err.message, 'error');
      }
    });
  });

  container.querySelectorAll('.cancel-single-round-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const orderId = btn.dataset.orderId;
      const roundLabel = btn.dataset.round || 'Round';
      const targetOrd = orders.find(x => String(x.id) === String(orderId));
      if (!targetOrd) return;
      if (isOrderPaidOrClosed(targetOrd)) {
        showAdminToast(`Cannot cancel ${roundLabel}: order is already paid or closed.`, 'error');
        return;
      }
      if (!confirm(`Cancel ${roundLabel} (#${orderId}) for this table?`)) return;

      try {
        await cancelOrderRecord(targetOrd);
        await markOrderNotificationsRead(orderId);
        persistOrdersCache();
        showAdminToast(`${roundLabel} cancelled successfully.`, 'success');
        renderOverview();
        renderHoldOrdersPanel();
        renderOrdersTable();
        renderClosedOrdersPanel();
        renderBillingQuickCards();
        renderBillingTotalBills();
      } catch (err) {
        showAdminToast('Failed to cancel round: ' + err.message, 'error');
      }
    });
  });

  // Wire up Non-Table Hold Buttons
  container.querySelectorAll('.hold-edit-items-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openHoldEditModal(btn.dataset.orderId, 'edit');
    });
  });

  container.querySelectorAll('.hold-add-items-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openHoldEditModal(btn.dataset.orderId, 'add');
    });
  });

  container.querySelectorAll('.hold-print-kot-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const order = orders.find(o => o.id === btn.dataset.orderId);
      if (!order) return;
      const items = getItemsForOrder(order.id);
      await printKOT(order, items, { isReprint: true });
    });
  });

  container.querySelectorAll('.hold-resume-pos-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.orderId;
      const order = orders.find(o => String(o.id) === String(orderId));
      if (order) loadOrderIntoPos(order);
    });
  });

  container.querySelectorAll('.hold-final-bill-btn, .hold-confirm-bill-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.orderId;
      if (orderId) await confirmHeldOrder(orderId);
    });
  });

  container.querySelectorAll('.hold-cancel-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.orderId;
      const o = orders.find(x => String(x.id) === String(orderId));
      if (!o) return;
      if (isOrderPaidOrClosed(o)) {
        showAdminToast('Cannot cancel: order is already paid or closed.', 'error');
        return;
      }
      if (!confirm('Cancel this held order? This cannot be undone.')) return;
      try {
        await cancelOrderRecord(o);
        await markOrderNotificationsRead(orderId);
        persistOrdersCache();
        showAdminToast('Held order cancelled.', 'success');
        renderOverview();
        renderHoldOrdersPanel();
        renderOrdersTable();
        renderClosedOrdersPanel();
        renderBillingQuickCards();
        renderBillingTotalBills();
      } catch (err) {
        showAdminToast('Failed to cancel: ' + err.message, 'error');
      }
    });
  });

  container.querySelectorAll('.hold-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const orderId = btn.dataset.orderId;
      if (orderId) deleteUniversalOrder(orderId);
    });
  });
}

async function loadHoldOrderToPos(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) {
    showAdminToast('Held order not found.', 'error');
    return;
  }
  loadOrderIntoPos(order);
}

function renderPosHoldOrdersChips(containerEl) {
  if (!containerEl) return;
  const held = getHeldOrders();

  if (held.length === 0) {
    containerEl.innerHTML = '';
    return;
  }

  containerEl.innerHTML = held.map(o => `
    <button type="button" class="adm-hold-chip" data-order-id="${o.id}">
      🕒 #${o.order_number} <span class="adm-hold-chip-time">${timeSince(o.created_at)}</span>
    </button>
  `).join('');

  containerEl.querySelectorAll('.adm-hold-chip').forEach(chip => {
    chip.addEventListener('click', () => loadHoldOrderToPos(chip.dataset.orderId));
  });
}

// ═══════════════════════════════════════════════════════════════
// 🪑 TABLES FLOOR PLAN (1-19) & LIVE SESSION ENGINE
// ═══════════════════════════════════════════════════════════════

let tablesSubtab = 'all'; // 'all' | 'free' | 'occupied' | 'hold' | 'bill' | 'close'
let tablesFilter = 'all';
let billTypeFilter = 'all'; // 'all' | 'table' | 'pickup' | 'delivery'
let closeTypeFilter = 'all'; // 'all' | 'table' | 'pickup' | 'delivery'
const tableBillSelectedMethods = new Map(); // orderId -> 'cash' | 'online'
let isConfirmingTableBill = false;
let isSettlingTableBill = false;

function getOutstandingBills(typeFilter = 'all') {
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

function getOutstandingTableBills() {
  return getOutstandingBills('table');
}

function getClosedBills(typeFilter = 'all') {
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

function getClosedTableBills() {
  return getClosedBills('table');
}

function setTableBillPaymentMethod(billId, method) {
  tableBillSelectedMethods.set(billId, method);
}

async function confirmHeldOrder(orderId) {
  const order = orders.find(o => String(o.id) === String(orderId));
  if (!order) {
    showAdminToast('Order not found.', 'error');
    return;
  }

  // If order is a table order, route to confirmHeldTableOrder
  const meta = parseNotesMetadata(order.notes, order);
  const isTable = order.order_type === 'table' || meta.type === 'table' || meta.tableNumber || order.table_number;
  if (isTable) {
    const tableNum = parseInt(String(order.table_number || meta.tableNumber).replace(/\D/g, ''), 10);
    if (tableNum) return confirmHeldTableOrder(tableNum);
  }

  // Non-Table Order (Takeaway or Delivery)
  const rawItems = getItemsForOrder(order.id);
  const items = consolidateOrderItems(rawItems);
  const s = getBillSettings();
  const isDelivery = order.order_type === 'delivery' || meta.type === 'delivery';
  const deliveryFee = isDelivery ? (meta.deliveryFee ?? s.deliveryCharge ?? 0) : 0;

  const billing = calculateOrderBilling({
    items,
    deliveryFee,
    cgstRate: s.cgstRate ?? 2.5,
    sgstRate: s.sgstRate ?? 2.5
  });

  let grandTotal = billing.grandTotal;
  if (grandTotal <= 0 && Number(order.total_amount || 0) > 0) {
    grandTotal = Number(order.total_amount);
  }

  const typeTag = isDelivery ? '[DELIVERY]' : '[SELF PICKUP]';
  const billNotes = (order.notes || '') + ` ${typeTag} [FINAL_BILL] [BILLED_UNPAID] [CGST: ${billing.cgstRate}%] [SGST: ${billing.sgstRate}%]`;
  const updatedAt = new Date().toISOString();

  // 1. Cloud Database update
  const updatePayload = {
    total_amount: grandTotal,
    subtotal_amount: billing.subtotal || grandTotal,
    taxable_amount: billing.taxableAmount || grandTotal,
    cgst_amount: billing.cgstAmount || 0,
    sgst_amount: billing.sgstAmount || 0,
    status: 'confirmed',
    payment_status: 'unpaid',
    ticket_status: 'BILLED',
    notes: billNotes,
    updated_at: updatedAt
  };

  try {
    let uRes = await insforge.database
      .from('orders')
      .update(updatePayload)
      .eq('id', order.id);
    if (uRes && uRes.error && (uRes.error.message || '').includes('ticket_status')) {
      const fallbackPayload = { ...updatePayload };
      delete fallbackPayload.ticket_status;
      uRes = await insforge.database
        .from('orders')
        .update(fallbackPayload)
        .eq('id', order.id);
    }
    if (uRes && uRes.error) throw uRes.error;
  } catch (err) {
    console.warn('[Confirm Order] Cloud DB failed (queuing offline):', err);
    if (typeof offlineSync !== 'undefined' && offlineSync.enqueuePosConfirmBill) {
      offlineSync.enqueuePosConfirmBill({
        orderId: order.id,
        updatePayload,
        items,
        idempotencyKey: `confirm-held-${order.id}-${Date.now()}`
      });
      offlineSync.updateSyncIndicator();
    }
    showAdminToast(`Bill #${order.order_number} saved locally (Offline). Queued for sync. 🧾`, 'info');
  }

  // 2. In-memory update
  Object.assign(order, updatePayload);

  persistOrdersCache();
  if (typeof posState !== 'undefined' && typeof posState.setOrders === 'function') {
    posState.setOrders(orders);
  }
  await markOrderNotificationsRead(order.id);

  // 3. Print Customer Bill (Tax Bill with UNPAID status)
  try {
    await printOrderReceiptWithTax(order, items);
  } catch (printErr) {
    console.warn('[Confirm Bill Print Warning]:', printErr);
  }

  const typeName = isDelivery ? 'Delivery' : 'Takeaway';
  showAdminToast(`${typeName} Bill #${order.order_number} generated (${formatBillAmount(grandTotal)})! Moved to Bill section. 🧾`, 'success');

  // Switch to Bill view inside Tables panel
  tablesSubtab = 'bill';
  document.querySelectorAll('#tables-filter-pills button').forEach(p => {
    p.classList.toggle('active', (p.dataset.subtab || p.dataset.filter) === 'bill');
  });

  renderTablesPanel();
  renderHoldOrdersPanel();
  renderOverview();
  renderOrdersTable();
}

async function confirmHeldTableOrder(tableNum) {
  if (isConfirmingTableBill) return;
  isConfirmingTableBill = true;

  try {
    const sessions = getActiveTableSessions();
    const session = sessions.find(s => s.tableNumber === tableNum);
    if (!session || !session.orders.length) {
      showAdminToast(`No active orders found for Table ${tableNum}`, 'error');
      return;
    }

    const primaryOrder = session.orders[0];
    const siblingOrders = session.orders.slice(1);
    const siblingOrderIds = siblingOrders.map(o => o.id);

    const consolidatedItems = session.consolidatedItems || consolidateOrderItems(session.items);
    const s = getBillSettings();
    const billing = calculateOrderBilling({
      items: consolidatedItems,
      deliveryFee: 0,
      cgstRate: s.cgstRate ?? 2.5,
      sgstRate: s.sgstRate ?? 2.5
    });

    let grandTotal = billing.grandTotal;
    if (grandTotal <= 0 && Number(session.totalAmount || 0) > 0) {
      grandTotal = Number(session.totalAmount);
    } else if (grandTotal <= 0 && Number(primaryOrder.total_amount || 0) > 0) {
      grandTotal = Number(primaryOrder.total_amount);
    }

    const kotNumbersText = session.kots.map(k => `#${k.orderNumber}`).join(' + ');
    const billNotes = `[TABLE: ${tableNum}] [FINAL_BILL] [BILLED_UNPAID] [KOTS: ${kotNumbersText}] [CGST: ${billing.cgstRate}%] [SGST: ${billing.sgstRate}%]`;
    const updatedAt = new Date().toISOString();

    const pPayload = {
      order_type: 'table',
      table_number: tableNum,
      total_amount: grandTotal,
      subtotal_amount: billing.subtotal || grandTotal,
      taxable_amount: billing.taxableAmount || grandTotal,
      cgst_amount: billing.cgstAmount || 0,
      sgst_amount: billing.sgstAmount || 0,
      status: 'confirmed',
      payment_status: 'unpaid',
      ticket_status: 'BILLED',
      notes: billNotes,
      updated_at: updatedAt
    };

    // 1. Cloud Database update
    try {
      if (siblingOrderIds.length > 0) {
        await insforge.database
          .from('order_items')
          .update({ order_id: primaryOrder.id })
          .in('order_id', siblingOrderIds);

        for (const ord of siblingOrders) {
          const sPayload = {
            status: 'delivered',
            payment_status: 'paid',
            ticket_status: 'CLOSED',
            notes: (ord.notes || '') + ` [CONSOLIDATED_INTO: ${primaryOrder.id}]`
          };
          let sRes = await insforge.database
            .from('orders')
            .update(sPayload)
            .eq('id', ord.id);
          if (sRes && sRes.error && (sRes.error.message || '').includes('ticket_status')) {
            const sFallback = { ...sPayload };
            delete sFallback.ticket_status;
            await insforge.database
              .from('orders')
              .update(sFallback)
              .eq('id', ord.id);
          }
        }
      }

      let pRes = await insforge.database
        .from('orders')
        .update(pPayload)
        .eq('id', primaryOrder.id);
      if (pRes && pRes.error && (pRes.error.message || '').includes('ticket_status')) {
        const pFallback = { ...pPayload };
        delete pFallback.ticket_status;
        pRes = await insforge.database
          .from('orders')
          .update(pFallback)
          .eq('id', primaryOrder.id);
      }
      if (pRes && pRes.error) throw pRes.error;
    } catch (err) {
      console.warn('[Confirm Table Order] Cloud DB failed (queuing offline):', err);
      if (typeof offlineSync !== 'undefined' && offlineSync.enqueuePosConfirmBill) {
        offlineSync.enqueuePosConfirmBill({
          orderId: primaryOrder.id,
          isTable: true,
          tableNum,
          siblingOrderIds,
          updatePayload: pPayload,
          siblingPayload: { status: 'delivered', payment_status: 'paid', ticket_status: 'CLOSED' },
          items: consolidatedItems,
          idempotencyKey: `confirm-tbl-${tableNum}-${primaryOrder.id}-${Date.now()}`
        });
        offlineSync.updateSyncIndicator();
      }
      showAdminToast(`Table ${tableNum} Bill generated locally (Offline). Queued for sync. 🧾`, 'info');
    }

    // 2. In-memory state update
    const localPrimary = orders.find(x => String(x.id) === String(primaryOrder.id));
    if (localPrimary) {
      Object.assign(localPrimary, pPayload);
    } else {
      orders.unshift({ ...primaryOrder, ...pPayload });
    }

    siblingOrders.forEach(ord => {
      const local = orders.find(x => String(x.id) === String(ord.id));
      if (local) {
        local.status = 'delivered';
        local.payment_status = 'paid';
        local.ticket_status = 'CLOSED';
      }
    });

    if (siblingOrderIds.length > 0) {
      orderItems.forEach(item => {
        if (siblingOrderIds.some(sId => String(sId) === String(item.order_id))) {
          item.order_id = primaryOrder.id;
        }
      });
    }

    persistOrdersCache();
    if (typeof posState !== 'undefined' && typeof posState.setOrders === 'function') {
      posState.setOrders(orders);
    }
    session.orders.forEach(o => markOrderNotificationsRead(o.id));

    // 3. Print Customer Bill (Tax Bill with UNPAID status)
    try {
      await printOrderReceiptWithTax(localPrimary || primaryOrder, consolidatedItems);
    } catch (printErr) {
      console.warn('[Confirm Bill Print Warning]:', printErr);
    }

    showAdminToast(`Table ${tableNum} Bill #${(localPrimary || primaryOrder).order_number} generated (₹${grandTotal.toFixed(2)})! Table ${tableNum} is now Available. Bill moved to Tables → Bill. 🧾`, 'success');

    // Automatically switch to Tables -> Bill subsection
    tablesSubtab = 'bill';
    document.querySelectorAll('#tables-filter-pills button').forEach(p => {
      p.classList.toggle('active', (p.dataset.subtab || p.dataset.filter) === 'bill');
    });

    renderTablesPanel();
    renderHoldOrdersPanel();
    renderOverview();
    renderOrdersTable();
  } catch (ex) {
    console.error('[Confirm Table Order Error]:', ex);
    showAdminToast('Failed to confirm order: ' + (ex.message || 'Unknown error'), 'error');
  } finally {
    isConfirmingTableBill = false;
  }
}

async function settleBill(billId, paymentMethod = 'cash', txnRef = '', idempotencyKey = null, autoPrintBill = false) {
  if (isSettlingTableBill) return { success: false, error: 'SETTLEMENT_IN_PROGRESS' };
  isSettlingTableBill = true;

  try {
    const bill = orders.find(o => String(o.id) === String(billId));
    if (!bill) {
      showAdminToast('Bill not found.', 'error');
      return { success: false, error: 'BILL_NOT_FOUND' };
    }

    if (bill.status === 'cancelled' || bill.ticket_status === 'CANCELLED') {
      showAdminToast(`Bill #${bill.order_number} is cancelled and cannot be settled.`, 'error');
      return { success: false, error: 'ORDER_CANCELLED' };
    }

    if ((bill.payment_status === 'paid' || bill.ticket_status === 'CLOSED') && (!idempotencyKey || bill.idempotency_key !== idempotencyKey)) {
      showAdminToast(`Bill #${bill.order_number} was already paid.`, 'info');
      return { success: false, error: 'ORDER_ALREADY_SETTLED', alreadyPaid: true };
    }

    const validMethod = (paymentMethod === 'online' || paymentMethod === 'upi')
      ? 'upi'
      : (['card', 'pay_later'].includes(paymentMethod) ? paymentMethod : 'cash');
    const methodLabel = validMethod === 'upi' ? 'Online' : (validMethod === 'card' ? 'Card' : 'Cash');
    const upiRefNote = (validMethod === 'upi' && txnRef) ? ` [UPI_REF: ${txnRef}]` : '';
    const updatedAt = bill._settleAttemptAt || new Date().toISOString();
    bill._settleAttemptAt = updatedAt;

    const settleIdempotencyKey = idempotencyKey || bill._settleIdempotencyKey || ((typeof crypto !== 'undefined' && crypto.randomUUID)
      ? `settle-${bill.id}-${crypto.randomUUID()}`
      : `settle-${bill.id}`);
    bill._settleIdempotencyKey = settleIdempotencyKey;

    const baseNotes = String(bill.notes || '')
      .replace(/\s*\[PAYMENT:[^\]]*\]/gi, '')
      .replace(/\s*\[UPI_REF:[^\]]*\]/gi, '')
      .replace(/\s*\[SETTLED_AT:[^\]]*\]/gi, '')
      .trim();
    const updatedNotes = `${baseNotes} [PAYMENT: ${validMethod}]${upiRefNote} [SETTLED_AT: ${updatedAt}]`.trim();

    // 1. Atomic database settlement via settle_order_atomic RPC
    let rpcResult = null;
    let rpcError = null;
    let rpcResponse = null;

    try {
      const res = await insforge.database.rpc('settle_order_atomic', {
        p_order_id: bill.id,
        p_payment_method: validMethod,
        p_notes: updatedNotes,
        p_idempotency_key: settleIdempotencyKey
      });
      rpcResponse = res;
      rpcResult = res.data;
      rpcError = res.error;
    } catch (ex) {
      rpcError = ex;
    }

    if (rpcError) {
      const errMsg = String(rpcError.message || '');
      const errType = typeof classifyError === 'function' ? classifyError(rpcError, rpcResponse) : 'NETWORK';

      if (errMsg.includes('ORDER_ALREADY_SETTLED')) {
        bill.payment_status = 'paid';
        bill.ticket_status = 'CLOSED';
        bill.status = 'delivered';
        bill._settlementPendingSync = false;
        persistOrdersCache();
        showAdminToast(`Bill #${bill.order_number} is already settled & closed in cloud! ✓`, 'success');
        renderTablesPanel();
        renderHoldOrdersPanel();
        renderBillingQuickCards();
        renderBillingTotalBills();
        return { success: true, alreadySettled: true, bill };
      }
      if (errMsg.includes('ORDER_CANCELLED')) {
        showAdminToast(`Bill #${bill.order_number} is cancelled and cannot be settled.`, 'error');
        return { success: false, error: errMsg, code: 'ORDER_CANCELLED' };
      }

      // CRITICAL FINANCIAL RULE:
      // If network failure occurred (or offline):
      // Queue the settlement mutation in offlineSync!
      // DO NOT show the order as paid or move to Close view until cloud confirms!
      if (errType === ERROR_TYPES.NETWORK || errType === ERROR_TYPES.SERVER_ERROR || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        bill._settlementPendingSync = true;
        bill._pendingPaymentMethod = validMethod;
        bill.payment_method = validMethod;
        bill.notes = updatedNotes;

        if (typeof offlineSync !== 'undefined' && offlineSync.enqueuePosSettlement) {
          offlineSync.enqueuePosSettlement({
            orderId: bill.id,
            paymentMethod: validMethod,
            notes: updatedNotes,
            idempotencyKey: settleIdempotencyKey,
            tableNum: bill.table_number || null
          });
          offlineSync.updateSyncIndicator();
        }

        persistOrdersCache();

        showAdminToast(`⚠️ Network Offline: Settlement queued! Bill #${bill.order_number} remains UNPAID until cloud confirms payment.`, 'warning');

        renderTablesPanel();
        renderHoldOrdersPanel();
        renderBillingQuickCards();
        renderBillingTotalBills();

        return {
          success: false,
          error: 'SETTLEMENT_QUEUED_OFFLINE',
          isQueuedOffline: true,
          bill
        };
      }

      console.error('[Settle Bill RPC Error]:', rpcError);
      showAdminToast('Failed to settle bill: ' + (errMsg || 'Database transaction error'), 'error');
      return { success: false, error: errMsg || 'RPC_FAILED' };
    }

    if (rpcResult && rpcResult.success === false) {
      const errMsg = String(rpcResult.error || 'Atomic settlement rejected');
      console.error('[Settle Bill Rejected]:', rpcResult);
      showAdminToast('Failed to settle bill: ' + errMsg, 'error');
      return { success: false, error: errMsg };
    }

    // 2. In-memory state update (only after atomic DB commit succeeds)
    const settledRow = rpcResult?.order || {};
    const settlePayload = {
      payment_status: 'paid',
      ticket_status: 'CLOSED',
      status: 'delivered',
      payment_method: validMethod,
      payment_mode: validMethod,
      notes: settledRow.notes || updatedNotes,
      idempotency_key: settleIdempotencyKey,
      settled_at: rpcResult?.settled_at || settledRow.settled_at || updatedAt,
      updated_at: settledRow.updated_at || updatedAt
    };
    Object.assign(bill, settlePayload);
    delete bill._settleIdempotencyKey;
    delete bill._settleAttemptAt;

    persistOrdersCache();

    // 3. Thermal Receipt Printout (only when explicitly requested, prevented by default during payment recording)
    if (autoPrintBill) {
      try {
        const rawItems = getItemsForOrder(bill.id);
        const items = consolidateOrderItems(rawItems);
        await printOrderReceiptWithTax(bill, items);
      } catch (printErr) {
        console.warn('[Print Receipt Warning]:', printErr);
      }
    }

    // 4. Auto-sync to Google Sheet if enabled
    if (isGoogleSheetAutoSyncEnabled()) {
      syncOrderToGoogleSheet(bill).catch(e => console.warn('[Google Sheet] Bill auto-sync error:', e));
    }

    const meta = parseNotesMetadata(bill.notes, bill);
    const tNum = meta.tableNumber || bill.table_number || '';
    const isDelivery = bill.order_type === 'delivery' || meta.type === 'delivery';
    const isPickup = bill.order_type === 'pickup' || bill.order_type === 'takeaway' || meta.type === 'pickup' || meta.type === 'takeaway';
    const typeLabel = tNum ? `Table ${tNum}` : (isDelivery ? 'Delivery' : (isPickup ? 'Takeaway' : 'Order'));

    showAdminToast(`Bill #${bill.order_number} (${typeLabel}) paid via ${methodLabel}! Moved to Close. ✅`, 'success');

    // Clean up temporary selection state
    tableBillSelectedMethods.delete(bill.id);

    // Switch to Close subtab so cashier immediately sees the settled order in Close section
    tablesSubtab = 'close';
    document.querySelectorAll('#tables-filter-pills button').forEach(p => {
      p.classList.toggle('active', (p.dataset.subtab || p.dataset.filter) === 'close');
    });

    // Re-render views
    renderTablesPanel();
    renderClosedOrdersPanel();
    renderOverview();
    renderOrdersTable();
    renderHoldOrdersPanel();
    renderBillingQuickCards();
    renderBillingTotalBills();

    return {
      success: true,
      bill,
      idempotentReplay: Boolean(rpcResult?.idempotent_replay),
      inventoryDeducted: rpcResult?.inventory || null
    };
  } catch (ex) {
    console.error('[Settle Bill Error]:', ex);
    showAdminToast('Failed to record payment: ' + (ex.message || 'Unknown error'), 'error');
    return { success: false, error: ex.message || 'Unknown error' };
  } finally {
    isSettlingTableBill = false;
  }
}

async function settleTableBill(billId, paymentMethod = 'cash', txnRef = '', idempotencyKey = null, autoPrintBill = false) {
  return settleBill(billId, paymentMethod, txnRef, idempotencyKey, autoPrintBill);
}

function renderTablesBillSection(search = '') {
  const tbody = $('tables-bill-tbody');
  const gridContainer = $('tables-bill-grid-container');
  const emptyBox = $('tables-bill-empty');
  const countBadge = $('tables-bill-count-badge');
  if (!tbody && !gridContainer) return;

  // Bind type filter pills if available
  const billFilterWrap = $('tables-bill-type-pills');
  if (billFilterWrap) {
    billFilterWrap.querySelectorAll('.bill-type-pill').forEach(p => {
      p.classList.toggle('active', (p.dataset.type || 'all') === billTypeFilter);
    });
    billFilterWrap.querySelectorAll('.bill-type-pill').forEach(pill => {
      pill.onclick = () => {
        billFilterWrap.querySelectorAll('.bill-type-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        billTypeFilter = pill.dataset.type || 'all';
        renderTablesBillSection(search);
      };
    });
  }

  const allUnpaidBills = getOutstandingBills(billTypeFilter);
  const unpaidBills = allUnpaidBills.filter(b => {
    if (!search) return true;
    const meta = parseNotesMetadata(b.notes, b);
    const tNum = String(meta.tableNumber || b.table_number || '');
    const num = String(b.order_number || '');
    const id = String(b.id || '');
    const cust = (b.customer_name || '').toLowerCase();
    const phone = (b.customer_phone || '');
    const addr = (meta.address || '').toLowerCase();
    return tNum.includes(search) || num.includes(search) || id.includes(search) || cust.includes(search) || phone.includes(search) || addr.includes(search);
  });

  if (countBadge) countBadge.textContent = `${allUnpaidBills.length} Bill${allUnpaidBills.length === 1 ? '' : 's'}`;

  if (unpaidBills.length === 0) {
    if (tbody) tbody.innerHTML = '';
    if (gridContainer) gridContainer.innerHTML = '';
    if (emptyBox) emptyBox.style.display = 'block';
    return;
  }

  if (emptyBox) emptyBox.style.display = 'none';

  let cardsHtml = '';
  let rowsHtml = '';

  unpaidBills.forEach(b => {
    const meta = parseNotesMetadata(b.notes, b);
    const tNum = meta.tableNumber || b.table_number || '';
    const isDelivery = b.order_type === 'delivery' || meta.type === 'delivery';
    const isPickup = b.order_type === 'pickup' || b.order_type === 'takeaway' || meta.type === 'pickup' || meta.type === 'takeaway';
    const isTable = (!isDelivery && !isPickup) || b.order_type === 'table' || meta.type === 'table' || tNum;

    const rawItems = getItemsForOrder(b.id);
    const items = consolidateOrderItems(rawItems);
    const itemsSummary = items.length > 0
      ? items.map(i => `${i.quantity}× ${escapeHtml(i.item_name)}`).join(', ')
      : (b.items && Array.isArray(b.items) && b.items.length
          ? b.items.map(i => `${i.quantity || 1}× ${escapeHtml(i.name || i.item_name)}`).join(', ')
          : 'Dishes ordered');

    let orderTypeBadge = '';
    let refHtml = '';
    let typeChip = '';
    let locationText = '';

    if (isTable && tNum) {
      const tNumInt = parseInt(String(tNum).replace(/\D/g, ''), 10);
      let zone = 'Indoor AC (Hall)';
      if (tNumInt >= 9 && tNumInt <= 14) zone = 'Family Section';
      else if (tNumInt >= 15) zone = 'Garden Terrace';

      orderTypeBadge = `<span class="order-type-badge order-type-badge-table">🪑 Dine-In</span>`;
      refHtml = `
        <span class="table-bill-chip">🪑 Table ${tNum}</span>
        <div style="font-size:0.75rem;color:#64748b;margin-top:2px;">${escapeHtml(b.customer_name || 'Walk-in')}${b.customer_phone && b.customer_phone !== '9999999999' ? ` · ${b.customer_phone}` : ''}</div>
      `;
      typeChip = `<span class="table-number-chip"><span class="table-bill-chip">🪑 Table ${tNum < 10 ? '0' + tNum : tNum}</span></span>`;
      locationText = `<span>📍 ${zone}</span>`;
    } else if (isDelivery) {
      orderTypeBadge = `<span class="order-type-badge order-type-badge-delivery">🚗 Delivery</span>`;
      refHtml = `
        <strong style="color:#0f172a;font-size:0.85rem;">Order #${b.order_number}</strong>
        <div style="font-size:0.75rem;color:#64748b;margin-top:2px;">${escapeHtml(b.customer_name || 'Customer')} · ${escapeHtml(b.customer_phone || '—')}</div>
        ${meta.address ? `<div style="font-size:0.75rem;color:#0284c7;margin-top:2px;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(meta.address)}">📍 ${escapeHtml(meta.address)}</div>` : ''}
      `;
      typeChip = `<span class="table-number-chip"><span class="table-bill-chip" style="background:#e0f2fe;color:#0284c7;border-color:#bae6fd;">🚗 Delivery</span></span>`;
      locationText = meta.address ? `<span title="${escapeHtml(meta.address)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;">📍 ${escapeHtml(meta.address)}</span>` : `<span>📍 Delivery</span>`;
    } else {
      orderTypeBadge = `<span class="order-type-badge order-type-badge-pickup">🥡 Takeaway</span>`;
      refHtml = `
        <strong style="color:#0f172a;font-size:0.85rem;">Order #${b.order_number}</strong>
        <div style="font-size:0.75rem;color:#64748b;margin-top:2px;">${escapeHtml(b.customer_name || 'Walk-in Guest')}${b.customer_phone && b.customer_phone !== '9999999999' ? ` · ${b.customer_phone}` : ''}</div>
      `;
      typeChip = `<span class="table-number-chip"><span class="table-bill-chip" style="background:#fef3c7;color:#d97706;border-color:#fde68a;">🥡 Takeaway</span></span>`;
      locationText = `<span>📍 Counter Pickup</span>`;
    }

    const billNum = `BILL-${String(b.order_number || '').padStart(3, '0')}`;
    const dateStr = formatDateTime(b.updated_at || b.created_at);
    const currentMethod = tableBillSelectedMethods.get(b.id) || '';

    const isCash = currentMethod === 'cash';
    const isOnline = currentMethod === 'online' || currentMethod === 'upi';

    // 1. Modern Compact Card
    cardsHtml += `
      <div class="pos-table-card billed-card" data-order-id="${b.id}" style="border-top:3px solid #f59e0b;background:#ffffff;border:1.5px solid #fed7aa;border-radius:14px;padding:0.9rem;display:flex;flex-direction:column;justify-content:space-between;gap:0.6rem;box-shadow:0 1px 3px rgba(0,0,0,0.03);">
        <div class="table-card-head" style="display:flex;justify-content:space-between;align-items:center;">
          ${typeChip}
          <span class="table-status-pill" style="font-size:0.75rem;font-weight:800;background:#fffbeb;color:#b45309;border:1px solid #fed7aa;padding:2px 8px;border-radius:999px;">
            ⏳ Unpaid
          </span>
        </div>
        <div class="table-card-zone" style="display:flex;justify-content:space-between;align-items:center;font-size:0.75rem;color:#64748b;">
          ${locationText}
          <span>⏱️ ${timeSince(b.updated_at || b.created_at)}</span>
        </div>
        <div class="table-card-body" style="padding:0.25rem 0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">
            <span class="table-bill-num" style="font-size:0.82rem;">${billNum}</span>
            <strong style="color:#d97706;font-weight:900;font-size:1.08rem;font-family:'Fraunces',Georgia,serif;">
              ${formatBillAmount(b.total_amount)}
            </strong>
          </div>
          <div style="font-size:0.78rem;color:#475569;margin-bottom:0.3rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            👤 <strong>${escapeHtml(b.customer_name || (isTable ? 'Dine-in Guest' : 'Customer'))}</strong>${b.customer_phone && b.customer_phone !== '9999999999' ? ` · 📞 ${escapeHtml(b.customer_phone)}` : ''}
          </div>
          <div style="font-size:0.75rem;color:#64748b;line-height:1.35;max-height:38px;overflow:hidden;background:#f8fafc;padding:4px 8px;border-radius:6px;border:1px solid #f1f5f9;margin-bottom:0.4rem;" title="${escapeHtml(itemsSummary)}">
            🍽️ ${escapeHtml(itemsSummary)}
          </div>
          <div class="bill-method-selector" data-bill-id="${b.id}" style="display:flex;gap:0.35rem;width:100%;">
            <button type="button" class="bill-method-btn bill-method-cash ${isCash ? 'active' : ''}" data-method="cash" data-bill-id="${b.id}" style="flex:1;text-align:center;padding:0.35rem 0.5rem;font-size:0.78rem;font-weight:700;border-radius:6px;">
              💵 Cash
            </button>
            <button type="button" class="bill-method-btn bill-method-online ${isOnline ? 'active' : ''}" data-method="online" data-bill-id="${b.id}" style="flex:1;text-align:center;padding:0.35rem 0.5rem;font-size:0.78rem;font-weight:700;border-radius:6px;">
              📱 Online
            </button>
          </div>
        </div>
        <div class="table-card-actions" style="display:flex;gap:0.35rem;align-items:center;margin-top:0.25rem;">
          <button type="button" class="adm-btn adm-btn-primary table-card-btn table-bill-pay-btn" data-bill-id="${b.id}" style="background:#10b981;border-color:#10b981;font-weight:800;flex:1.2;padding:0.4rem 0.85rem;" title="Record payment as Paid and move to Close">
            ✓ Paid
          </button>
          <button type="button" class="adm-btn adm-btn-outline table-card-btn table-bill-print-btn" data-bill-id="${b.id}" style="padding:0.4rem 0.65rem;background:#fff;" title="Print Bill Slip">
            🖨️
          </button>
          <button type="button" class="adm-btn adm-btn-outline table-card-btn table-bill-view-btn" data-bill-id="${b.id}" style="padding:0.4rem 0.65rem;background:#fff;" title="View Items">
            👁️
          </button>
        </div>
      </div>
    `;

    // 2. Preserved HTML Table Row (for Test Suite backward compatibility)
    rowsHtml += `
      <tr data-order-id="${b.id}" style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:0.85rem 1rem;">
          <span class="table-bill-num">${billNum}</span>
          <div style="font-size:0.75rem;color:#64748b;margin-top:2px;">#${b.order_number}</div>
        </td>
        <td style="padding:0.85rem 1rem;">
          ${orderTypeBadge}
        </td>
        <td style="padding:0.85rem 1rem;">
          ${refHtml}
        </td>
        <td style="padding:0.85rem 1rem;font-size:0.82rem;color:#334155;">
          ${dateStr}
        </td>
        <td style="padding:0.85rem 1rem;text-align:right;">
          <strong style="font-size:1.05rem;color:#d97706;font-family:'Fraunces',Georgia,serif;">
            ${formatBillAmount(b.total_amount)}
          </strong>
        </td>
        <td style="padding:0.85rem 1rem;text-align:center;">
          <div class="bill-method-selector" data-bill-id="${b.id}">
            <button type="button" class="bill-method-btn bill-method-cash ${isCash ? 'active' : ''}" data-method="cash" data-bill-id="${b.id}">
              💵 Cash
            </button>
            <button type="button" class="bill-method-btn bill-method-online ${isOnline ? 'active' : ''}" data-method="online" data-bill-id="${b.id}">
              📱 Online
            </button>
          </div>
        </td>
        <td style="padding:0.85rem 1rem;text-align:center;">
          <span class="adm-pill" style="background:#fffbeb;color:#b45309;border:1px solid #fed7aa;font-weight:700;">
            ⏳ Unpaid
          </span>
        </td>
        <td style="padding:0.85rem 1rem;text-align:right;">
          <div style="display:inline-flex;gap:0.35rem;align-items:center;">
            <button type="button" class="adm-btn adm-btn-primary table-bill-pay-btn" data-bill-id="${b.id}" style="background:#10b981;border-color:#10b981;font-weight:800;padding:0.35rem 0.85rem;" title="Record payment as Paid and move to Close">
              ✓ Paid
            </button>
            <button type="button" class="adm-btn adm-btn-outline table-bill-print-btn" data-bill-id="${b.id}" style="padding:0.35rem 0.55rem;background:#fff;" title="Print Bill Slip">
              🖨️
            </button>
            <button type="button" class="adm-btn adm-btn-outline table-bill-view-btn" data-bill-id="${b.id}" style="padding:0.35rem 0.55rem;background:#fff;" title="View Items">
              👁️
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  if (gridContainer) gridContainer.innerHTML = cardsHtml;
  if (tbody) tbody.innerHTML = rowsHtml;

  // Wire event listeners on bill section (both cards and preserved rows)
  const billSection = $('tables-bill-view');
  if (billSection) {
    billSection.querySelectorAll('.bill-method-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const billId = btn.dataset.billId;
        const method = btn.dataset.method;
        setTableBillPaymentMethod(billId, method);
        renderTablesBillSection(search);
      };
    });

    billSection.querySelectorAll('.table-bill-pay-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const billId = btn.dataset.billId;
        const selected = tableBillSelectedMethods.get(billId);
        if (!selected) {
          showAdminToast('Please select Cash or Online before confirming payment.', 'warning');
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Settling...';
        try {
          await settleBill(billId, selected);
        } finally {
          btn.disabled = false;
          btn.textContent = '✓ Paid';
        }
      };
    });

    billSection.querySelectorAll('.table-bill-print-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const billId = btn.dataset.billId;
        const bill = orders.find(o => String(o.id) === String(billId));
        if (!bill) return;
        const rawItems = getItemsForOrder(bill.id);
        const items = consolidateOrderItems(rawItems);
        await printOrderReceiptWithTax(bill, items, { force: true, showDuplicateBanner: false });
        showAdminToast(`Bill #${bill.order_number} printed 🖨️`, 'info');
      };
    });

    billSection.querySelectorAll('.table-bill-view-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const billId = btn.dataset.billId;
        const bill = orders.find(o => String(o.id) === String(billId));
        if (!bill) return;
        if (typeof openOrderDetail === 'function') {
          openOrderDetail(bill.id);
        } else if (typeof openOrderModal === 'function') {
          openOrderModal(bill);
        } else {
          showAdminToast(`Bill #${bill.order_number}: ₹${Number(bill.total_amount).toFixed(2)} (${bill.customer_name || 'Guest'})`, 'info');
        }
      };
    });

    billSection.querySelectorAll('.pos-table-card.billed-card').forEach(card => {
      card.style.cursor = 'pointer';
      card.onclick = (e) => {
        if (e.target.closest('button')) return;
        const orderId = card.dataset.orderId;
        if (orderId && typeof openOrderDetail === 'function') {
          openOrderDetail(orderId);
        }
      };
    });
  }
}

function renderTablesCloseSection(search = '') {
  const tbody = $('tables-close-tbody');
  const gridContainer = $('tables-close-grid-container');
  const emptyBox = $('tables-close-empty');
  const countBadge = $('tables-close-count-badge');
  if (!tbody && !gridContainer) return;

  // Bind close type filter pills if available
  const closeFilterWrap = $('tables-close-type-pills');
  if (closeFilterWrap) {
    closeFilterWrap.querySelectorAll('.close-type-pill').forEach(p => {
      p.classList.toggle('active', (p.dataset.type || 'all') === closeTypeFilter);
    });
    closeFilterWrap.querySelectorAll('.close-type-pill').forEach(pill => {
      pill.onclick = () => {
        closeFilterWrap.querySelectorAll('.close-type-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        closeTypeFilter = pill.dataset.type || 'all';
        renderTablesCloseSection(search);
      };
    });
  }

  const allClosedBills = getClosedBills(closeTypeFilter);
  const closedBills = allClosedBills.filter(b => {
    if (!search) return true;
    const meta = parseNotesMetadata(b.notes, b);
    const tNum = String(meta.tableNumber || b.table_number || '');
    const num = String(b.order_number || '');
    const id = String(b.id || '');
    const cust = (b.customer_name || '').toLowerCase();
    const phone = (b.customer_phone || '');
    const addr = (meta.address || '').toLowerCase();
    return tNum.includes(search) || num.includes(search) || id.includes(search) || cust.includes(search) || phone.includes(search) || addr.includes(search);
  });

  if (countBadge) countBadge.textContent = `${allClosedBills.length} Paid Bill${allClosedBills.length === 1 ? '' : 's'}`;

  if (closedBills.length === 0) {
    if (tbody) tbody.innerHTML = '';
    if (gridContainer) gridContainer.innerHTML = '';
    if (emptyBox) emptyBox.style.display = 'block';
    return;
  }

  if (emptyBox) emptyBox.style.display = 'none';

  let cardsHtml = '';
  let rowsHtml = '';

  closedBills.forEach(b => {
    const meta = parseNotesMetadata(b.notes, b);
    const tNum = meta.tableNumber || b.table_number || '';
    const isDelivery = b.order_type === 'delivery' || meta.type === 'delivery';
    const isPickup = b.order_type === 'pickup' || b.order_type === 'takeaway' || meta.type === 'pickup' || meta.type === 'takeaway';
    const isTable = (!isDelivery && !isPickup) || b.order_type === 'table' || meta.type === 'table' || tNum;

    const rawItems = getItemsForOrder(b.id);
    const items = consolidateOrderItems(rawItems);
    const itemsSummary = items.length > 0
      ? items.map(i => `${i.quantity}× ${escapeHtml(i.item_name)}`).join(', ')
      : (b.items && Array.isArray(b.items) && b.items.length
          ? b.items.map(i => `${i.quantity || 1}× ${escapeHtml(i.name || i.item_name)}`).join(', ')
          : 'Dishes ordered');

    let orderTypeBadge = '';
    let refHtml = '';
    let typeChip = '';
    let locationText = '';

    if (isTable && tNum) {
      const tNumInt = parseInt(String(tNum).replace(/\D/g, ''), 10);
      let zone = 'Indoor AC (Hall)';
      if (tNumInt >= 9 && tNumInt <= 14) zone = 'Family Section';
      else if (tNumInt >= 15) zone = 'Garden Terrace';

      orderTypeBadge = `<span class="order-type-badge order-type-badge-table">🪑 Dine-In</span>`;
      refHtml = `
        <span class="table-bill-chip">🪑 Table ${tNum}</span>
        <div style="font-size:0.75rem;color:#64748b;margin-top:2px;">${escapeHtml(b.customer_name || 'Walk-in')}${b.customer_phone && b.customer_phone !== '9999999999' ? ` · ${b.customer_phone}` : ''}</div>
      `;
      typeChip = `<span class="table-number-chip"><span class="table-bill-chip">🪑 Table ${tNum < 10 ? '0' + tNum : tNum}</span></span>`;
      locationText = `<span>📍 ${zone}</span>`;
    } else if (isDelivery) {
      orderTypeBadge = `<span class="order-type-badge order-type-badge-delivery">🚗 Delivery</span>`;
      refHtml = `
        <strong style="color:#0f172a;font-size:0.85rem;">Order #${b.order_number}</strong>
        <div style="font-size:0.75rem;color:#64748b;margin-top:2px;">${escapeHtml(b.customer_name || 'Customer')} · ${escapeHtml(b.customer_phone || '—')}</div>
        ${meta.address ? `<div style="font-size:0.75rem;color:#0284c7;margin-top:2px;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(meta.address)}">📍 ${escapeHtml(meta.address)}</div>` : ''}
      `;
      typeChip = `<span class="table-number-chip"><span class="table-bill-chip" style="background:#e0f2fe;color:#0284c7;border-color:#bae6fd;">🚗 Delivery</span></span>`;
      locationText = meta.address ? `<span title="${escapeHtml(meta.address)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;">📍 ${escapeHtml(meta.address)}</span>` : `<span>📍 Delivery</span>`;
    } else {
      orderTypeBadge = `<span class="order-type-badge order-type-badge-pickup">🥡 Takeaway</span>`;
      refHtml = `
        <strong style="color:#0f172a;font-size:0.85rem;">Order #${b.order_number}</strong>
        <div style="font-size:0.75rem;color:#64748b;margin-top:2px;">${escapeHtml(b.customer_name || 'Walk-in Guest')}${b.customer_phone && b.customer_phone !== '9999999999' ? ` · ${b.customer_phone}` : ''}</div>
      `;
      typeChip = `<span class="table-number-chip"><span class="table-bill-chip" style="background:#fef3c7;color:#d97706;border-color:#fde68a;">🥡 Takeaway</span></span>`;
      locationText = `<span>📍 Counter Pickup</span>`;
    }

    const billNum = `BILL-${String(b.order_number || '').padStart(3, '0')}`;
    const dateStr = formatDateTime(b.settled_at || b.updated_at || b.created_at);
    const pm = (b.payment_method || b.payment_mode || 'cash').toLowerCase();
    const isOnline = pm === 'upi' || pm === 'online';

    // 1. Modern Compact Closed Card
    cardsHtml += `
      <div class="pos-table-card closed-card" data-order-id="${b.id}" style="border-top:3px solid #10b981;background:#ffffff;border:1.5px solid #a7f3d0;border-radius:14px;padding:0.9rem;display:flex;flex-direction:column;justify-content:space-between;gap:0.6rem;box-shadow:0 1px 3px rgba(0,0,0,0.03);">
        <div class="table-card-head" style="display:flex;justify-content:space-between;align-items:center;">
          ${typeChip}
          <span class="table-status-pill" style="font-size:0.75rem;font-weight:800;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;padding:2px 8px;border-radius:999px;">
            ✅ Paid
          </span>
        </div>
        <div class="table-card-zone" style="display:flex;justify-content:space-between;align-items:center;font-size:0.75rem;color:#64748b;">
          ${locationText}
          <span>⏱️ ${timeSince(b.settled_at || b.updated_at || b.created_at)}</span>
        </div>
        <div class="table-card-body" style="padding:0.25rem 0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">
            <span class="table-bill-num" style="font-size:0.82rem;">${billNum}</span>
            <strong style="color:#059669;font-weight:900;font-size:1.08rem;font-family:'Fraunces',Georgia,serif;">
              ${formatBillAmount(b.total_amount)}
            </strong>
          </div>
          <div style="font-size:0.78rem;color:#475569;margin-bottom:0.3rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            👤 <strong>${escapeHtml(b.customer_name || (isTable ? 'Dine-in Guest' : 'Customer'))}</strong>${b.customer_phone && b.customer_phone !== '9999999999' ? ` · 📞 ${escapeHtml(b.customer_phone)}` : ''}
          </div>
          <div style="font-size:0.75rem;color:#64748b;line-height:1.35;max-height:38px;overflow:hidden;background:#f8fafc;padding:4px 8px;border-radius:6px;border:1px solid #f1f5f9;margin-bottom:0.4rem;" title="${escapeHtml(itemsSummary)}">
            🍽️ ${escapeHtml(itemsSummary)}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;background:#f8fafc;padding:5px 8px;border-radius:6px;border:1px solid #e2e8f0;font-size:0.75rem;">
            <span style="color:#64748b;font-weight:600;">Paid Via:</span>
            <strong style="color:${isOnline ? '#2563eb' : '#166534'};">${isOnline ? '📱 Online / UPI' : '💵 Cash'}</strong>
          </div>
        </div>
        <div class="table-card-actions" style="display:flex;gap:0.35rem;align-items:center;margin-top:0.25rem;">
          <button type="button" class="adm-btn adm-btn-outline table-card-btn table-close-print-btn" data-bill-id="${b.id}" style="padding:0.4rem 0.65rem;background:#fff;flex:1;" title="Reprint Paid Receipt">
            🖨️ Receipt
          </button>
          <button type="button" class="adm-btn adm-btn-outline table-card-btn table-close-view-btn" data-bill-id="${b.id}" style="padding:0.4rem 0.65rem;background:#fff;flex:1;" title="View Details">
            👁️ View
          </button>
        </div>
      </div>
    `;

    // 2. Preserved HTML Table Row (for Test Suite backward compatibility)
    rowsHtml += `
      <tr data-order-id="${b.id}" style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:0.85rem 1rem;">
          <span class="table-bill-num">${billNum}</span>
          <div style="font-size:0.75rem;color:#64748b;margin-top:2px;">#${b.order_number}</div>
        </td>
        <td style="padding:0.85rem 1rem;">
          ${orderTypeBadge}
        </td>
        <td style="padding:0.85rem 1rem;">
          ${refHtml}
        </td>
        <td style="padding:0.85rem 1rem;font-size:0.82rem;color:#334155;">
          ${dateStr}
        </td>
        <td style="padding:0.85rem 1rem;text-align:right;">
          <strong style="font-size:1.05rem;color:#059669;font-family:'Fraunces',Georgia,serif;">
            ${formatBillAmount(b.total_amount)}
          </strong>
        </td>
        <td style="padding:0.85rem 1rem;text-align:center;">
          <span class="adm-pill" style="background:${isOnline ? '#eef2ff' : '#ecfdf5'};color:${isOnline ? '#4f46e5' : '#059669'};border:1px solid ${isOnline ? '#c7d2fe' : '#a7f3d0'};font-weight:700;">
            ${isOnline ? '📱 Online (UPI)' : '💵 Cash'}
          </span>
        </td>
        <td style="padding:0.85rem 1rem;text-align:center;">
          <span class="adm-pill" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;font-weight:800;">
            ✓ Paid
          </span>
        </td>
        <td style="padding:0.85rem 1rem;text-align:right;">
          <button type="button" class="adm-btn adm-btn-outline table-close-print-btn" data-bill-id="${b.id}" style="padding:0.35rem 0.65rem;background:#fff;" title="Reprint Paid Receipt">
            🖨️ Receipt
          </button>
        </td>
      </tr>
    `;
  });

  if (gridContainer) gridContainer.innerHTML = cardsHtml;
  if (tbody) tbody.innerHTML = rowsHtml;

  const closeSection = $('tables-close-view');
  if (closeSection) {
    closeSection.querySelectorAll('.table-close-print-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const billId = btn.dataset.billId;
        const bill = orders.find(o => String(o.id) === String(billId));
        if (!bill) return;
        const rawItems = getItemsForOrder(bill.id);
        const items = consolidateOrderItems(rawItems);
        await printOrderReceiptWithTax(bill, items, { force: true, showDuplicateBanner: false });
        showAdminToast(`Receipt for Bill #${bill.order_number} printed 🖨️`, 'info');
      };
    });

    closeSection.querySelectorAll('.table-close-view-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const billId = btn.dataset.billId;
        const bill = orders.find(o => String(o.id) === String(billId));
        if (!bill) return;
        if (typeof openOrderDetail === 'function') {
          openOrderDetail(bill.id);
        } else if (typeof openOrderModal === 'function') {
          openOrderModal(bill);
        } else {
          showAdminToast(`Invoice #${bill.order_number}: ₹${Number(bill.total_amount).toFixed(2)} (${bill.customer_name || 'Guest'})`, 'info');
        }
      };
    });

    closeSection.querySelectorAll('.pos-table-card.closed-card').forEach(card => {
      card.style.cursor = 'pointer';
      card.onclick = (e) => {
        if (e.target.closest('button')) return;
        const orderId = card.dataset.orderId;
        if (orderId && typeof openOrderDetail === 'function') {
          openOrderDetail(orderId);
        }
      };
    });
  }
}

function renderTablesHoldSection(search = '') {
  const container = $('tables-hold-container');
  if (!container) return;

  const tableSessions = getActiveTableSessions().filter(sess => {
    const isHold = sess.orders.some(o => o.status === 'hold' || o.ticket_status === 'HOLD');
    if (!isHold) return false;
    if (!search) return true;
    const tStr = String(sess.tableNumber);
    const cust = (sess.customerName || '').toLowerCase();
    const phone = sess.customerPhone || '';
    return tStr.includes(search) || cust.includes(search) || phone.includes(search);
  });

  if (tableSessions.length === 0) {
    container.innerHTML = `
      <div class="adm-card adm-empty" style="grid-column:1/-1;padding:2.5rem 1rem;text-align:center;">
        <p style="font-size:1.2rem;margin-bottom:0.25rem;">🟠</p>
        <p style="font-weight:700;color:var(--adm-text);margin:0;">No Tables on Hold</p>
        <p style="font-size:0.82rem;color:var(--adm-muted);margin:4px 0 0;">When dining tables are held from POS, they will appear here awaiting confirmation.</p>
      </div>
    `;
    return;
  }

  const s = getBillSettings();
  container.innerHTML = tableSessions.map(sess => {
    const itemsHtml = sess.consolidatedItems.map(i => `
      <li style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed #f1f5f9;">
        <span style="font-weight:600;color:#1e293b;">${i.quantity}× ${escapeHtml(i.item_name)}</span>
        <span style="color:var(--adm-muted);font-size:.8rem;font-weight:700;">₹${Number(i.line_total).toFixed(2)}</span>
      </li>
    `).join('');

    const subtotal = sess.consolidatedItems.reduce((sum, i) => sum + Number(i.line_total), 0);
    const cgst = subtotal * s.cgstRate / 100;
    const sgst = subtotal * s.sgstRate / 100;
    const grandTotal = subtotal + cgst + sgst;

    return `
      <div class="adm-hold-card" data-table-number="${sess.tableNumber}" style="border-top:4px solid #f97316;">
        <div class="adm-hold-card-head">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
              <span style="background:#fff7ed;color:#c2410c;font-size:.85rem;font-weight:900;padding:.2rem .65rem;border-radius:999px;border:1px solid #fed7aa;">
                🪑 Table ${sess.tableNumber}
              </span>
              <span class="adm-pill" style="background:#fff3e6;color:#f2994a;border:1px solid #fed7aa;font-weight:700;">
                🟠 On Hold
              </span>
            </div>
            <div style="font-size:.75rem;color:var(--adm-muted);margin-top:4px;">
              ${escapeHtml(sess.customerName)} ${sess.customerPhone ? `· ${escapeHtml(sess.customerPhone)}` : ''}
            </div>
          </div>
          <span class="adm-hold-time">⏱ ${timeSince(sess.earliestTime)}</span>
        </div>

        <ul class="adm-hold-items" style="list-style:none;padding:0;margin:.4rem 0;max-height:160px;overflow-y:auto;">
          ${itemsHtml}
        </ul>

        <div style="border-top:1px dashed var(--adm-border);padding-top:.5rem;margin-top:.25rem;font-size:.78rem;color:var(--adm-muted);">
          <div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>₹${subtotal.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span>GST (5%)</span><span>₹${(cgst + sgst).toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:900;color:var(--adm-text);margin-top:.3rem;font-size:.95rem;">
            <span>Grand Total</span>
            <span style="color:#d97706;">₹${grandTotal.toFixed(2)}</span>
          </div>
        </div>

        <div class="adm-hold-card-footer" style="margin-top:.85rem;">
          <div class="adm-hold-actions" style="flex-wrap:wrap;gap:.4rem;width:100%;justify-content:space-between;">
            <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
              <button type="button" class="adm-btn adm-btn-outline adm-btn-sm table-edit-items-btn" data-table="${sess.tableNumber}" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0;font-weight:700;">
                ✏️ Edit
              </button>
              <button type="button" class="adm-btn adm-btn-outline adm-btn-sm table-add-kot-btn" data-table="${sess.tableNumber}" style="background:#eef2ff;color:#4f46e5;border-color:#c7d2fe;font-weight:700;">
                ➕ Dishes
              </button>
              <button type="button" class="adm-btn adm-btn-outline adm-btn-sm table-print-kot-btn" data-table="${sess.tableNumber}">
                🖨️ KOT
              </button>
            </div>
            <div style="display:flex;gap:0.35rem;align-items:center;">
              <button type="button" class="adm-btn adm-btn-primary adm-btn-sm table-hold-confirm-btn" data-table="${sess.tableNumber}" style="background:#10b981;border-color:#10b981;font-weight:800;padding:.35rem .85rem;" title="Confirm held order, generate unpaid bill, and release Table ${sess.tableNumber}">
                ✔️ Confirm Bill
              </button>
              <button type="button" class="adm-btn adm-btn-outline adm-btn-sm table-cancel-btn" data-table="${sess.tableNumber}" style="border-color:#fca5a5;color:#ef4444;" title="Cancel Table">
                ✕
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Wire buttons in Tables -> Hold
  container.querySelectorAll('.table-hold-confirm-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tNum = parseInt(btn.dataset.table, 10);
      if (tNum) await confirmHeldTableOrder(tNum);
    });
  });

  container.querySelectorAll('.table-edit-items-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tableNum = parseInt(btn.dataset.table, 10);
      if (tableNum) openHoldEditModal(tableNum, 'edit');
    });
  });

  container.querySelectorAll('.table-add-kot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tableNum = parseInt(btn.dataset.table, 10);
      if (tableNum) openHoldEditModal(tableNum, 'add');
    });
  });

  container.querySelectorAll('.table-print-kot-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tableNum = parseInt(btn.dataset.table, 10);
      const session = getActiveTableSessions().find(s => s.tableNumber === tableNum);
      if (!session) return;
      await printKOT(session.orders[0], session.consolidatedItems, { isReprint: true });
    });
  });

  container.querySelectorAll('.table-cancel-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tableNum = parseInt(btn.dataset.table, 10);
      const session = getActiveTableSessions().find(s => s.tableNumber === tableNum);
      if (!session || !session.orders.length) return;
      if (session.orders.some(ord => isOrderPaidOrClosed(ord))) {
        showAdminToast(`Cannot cancel Table ${tableNum}: one or more orders are already paid or closed.`, 'error');
        return;
      }
      if (!confirm(`Cancel all active orders for Table ${tableNum}?`)) return;
      try {
        const res = await cancelTableOrders(tableNum, session.orders);
        if (!res.success) return;
        showAdminToast(`Orders for Table ${tableNum} cancelled.`, 'success');
        renderTablesPanel();
        renderHoldOrdersPanel();
      } catch (err) {
        showAdminToast('Failed to cancel table orders: ' + err.message, 'error');
      }
    });
  });
}

export function getTotalTablesCount() {
  const fromSettings = parseInt(printerSettings?.total_tables ?? localStorage.getItem('qz-total-tables'), 10);
  return (!isNaN(fromSettings) && fromSettings > 0) ? fromSettings : 19;
}

export function renderTablesPanel() {
  const container = $('tables-grid-container');
  if (!container) return;

  const totalTables = getTotalTablesCount();
  const titleEl = document.querySelector('#panel-tables .adm-page-title');
  if (titleEl) titleEl.textContent = `🪑 Tables 1–${totalTables} Live Floor Plan`;
  const allTabBtn = document.querySelector('#tables-filter-pills button[data-subtab="all"]');
  if (allTabBtn) allTabBtn.textContent = `All Tables (${totalTables})`;

  const search = ($('tables-search')?.value || '').toLowerCase().trim();
  const tableSessions = getActiveTableSessions();
  const unpaidBills = typeof getOutstandingBills === 'function' ? getOutstandingBills('all') : getOutstandingTableBills();
  const unpaidTableBills = typeof getOutstandingBills === 'function' ? getOutstandingBills('table') : getOutstandingTableBills();
  const closedBills = typeof getClosedBills === 'function' ? getClosedBills('all') : getClosedTableBills();

  let freeCount = 0;
  let occupiedCount = 0;
  let billedCount = 0;
  let holdCount = 0;

  const tableDataList = [];

  for (let tNum = 1; tNum <= totalTables; tNum++) {
    let zone = 'Indoor AC (Hall)';
    if (tNum >= 9 && tNum <= 14) zone = 'Family Section';
    else if (tNum >= 15) zone = 'Garden Terrace';

    const sess = tableSessions.find(s => s.tableNumber === tNum);
    const tableBill = unpaidTableBills.find(b => {
      const meta = parseNotesMetadata(b.notes, b);
      const bNum = parseInt(String(meta.tableNumber || b.table_number || '').replace(/\D/g, ''), 10);
      return bNum === tNum;
    });

    let state = 'free';

    if (sess && sess.orders.length > 0) {
      const isExplicitHold = sess.orders.every(o => o.status === 'hold');
      if (isExplicitHold) {
        state = 'hold';
        holdCount++;
      } else {
        state = 'occupied';
        occupiedCount++;
      }
    } else if (tableBill) {
      state = 'billed';
      billedCount++;
    } else {
      state = 'free';
      freeCount++;
    }

    tableDataList.push({
      tableNumber: tNum,
      zone,
      state,
      session: sess,
      bill: tableBill
    });
  }

  // Update Stats KPI badges
  if ($('tables-stat-free')) $('tables-stat-free').textContent = freeCount;
  if ($('tables-stat-occupied')) $('tables-stat-occupied').textContent = occupiedCount;
  if ($('tables-stat-billed')) $('tables-stat-billed').textContent = billedCount;
  if ($('tables-stat-hold')) $('tables-stat-hold').textContent = holdCount;

  // Update pill badges
  const bFree = $('tables-badge-free');
  if (bFree) {
    bFree.textContent = freeCount;
    bFree.style.display = freeCount > 0 ? 'inline-block' : 'none';
  }
  const bOcc = $('tables-badge-occupied');
  if (bOcc) {
    bOcc.textContent = occupiedCount;
    bOcc.style.display = occupiedCount > 0 ? 'inline-block' : 'none';
  }
  const bHold = $('tables-badge-hold');
  if (bHold) {
    bHold.textContent = holdCount;
    bHold.style.display = holdCount > 0 ? 'inline-block' : 'none';
  }
  const bBill = $('tables-badge-bill');
  if (bBill) {
    bBill.textContent = unpaidBills.length;
    bBill.style.display = unpaidBills.length > 0 ? 'inline-block' : 'none';
  }
  const bClose = $('tables-badge-close');
  if (bClose) {
    bClose.textContent = closedBills.length;
    bClose.style.display = closedBills.length > 0 ? 'inline-block' : 'none';
  }

  // Toggle Subsection Containers
  const gridView = $('tables-grid-view');
  const holdView = $('tables-hold-view');
  const billView = $('tables-bill-view');
  const closeView = $('tables-close-view');

  if (tablesSubtab === 'bill') {
    if (gridView) gridView.style.display = 'none';
    if (holdView) holdView.style.display = 'none';
    if (billView) billView.style.display = 'block';
    if (closeView) closeView.style.display = 'none';
    renderTablesBillSection(search);
    return;
  }

  if (tablesSubtab === 'close') {
    if (gridView) gridView.style.display = 'none';
    if (holdView) holdView.style.display = 'none';
    if (billView) billView.style.display = 'none';
    if (closeView) closeView.style.display = 'block';
    renderTablesCloseSection(search);
    return;
  }

  if (tablesSubtab === 'hold') {
    if (gridView) gridView.style.display = 'none';
    if (holdView) holdView.style.display = 'block';
    if (billView) billView.style.display = 'none';
    if (closeView) closeView.style.display = 'none';
    renderTablesHoldSection(search);
    return;
  }

  // 'all', 'free', or 'occupied'
  if (gridView) gridView.style.display = 'block';
  if (holdView) holdView.style.display = 'none';
  if (billView) billView.style.display = 'none';
  if (closeView) closeView.style.display = 'none';

  // Filter tables
  const filtered = tableDataList.filter(item => {
    if (tablesSubtab === 'free' && item.state !== 'free') return false;
    if (tablesSubtab === 'occupied' && item.state !== 'occupied' && item.state !== 'hold') return false;
    if (search) {
      const matchNum = String(item.tableNumber).includes(search);
      const sess = item.session;
      const matchCust = sess && (
        (sess.customerName || '').toLowerCase().includes(search) ||
        (sess.customerPhone || '').includes(search)
      );
      const matchOrderNum = sess && sess.orders.some(o => 
        String(o.order_number || '').includes(search) || 
        String(o.id || '').includes(search)
      );
      const matchItem = sess && sess.consolidatedItems.some(i => 
        (i.item_name || '').toLowerCase().includes(search)
      );
      const bill = item.bill;
      const matchBillCust = bill && (
        (bill.customer_name || '').toLowerCase().includes(search) ||
        (bill.customer_phone || '').includes(search)
      );
      const matchBillNum = bill && (
        String(bill.order_number || '').includes(search) ||
        String(bill.id || '').includes(search)
      );
      const matchZone = item.zone.toLowerCase().includes(search);
      return matchNum || matchCust || matchOrderNum || matchItem || matchBillCust || matchBillNum || matchZone;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="adm-card adm-empty" style="grid-column:1/-1;padding:2.5rem 1rem;text-align:center;">No dining tables match your filter/search.</div>';
    return;
  }

  container.innerHTML = filtered.map(t => {
    const tNum = t.tableNumber;
    const sess = t.session;

    if (t.state === 'free') {
      return `
        <div class="pos-table-card free" data-table="${tNum}">
          <div class="table-card-head">
            <span class="table-number-chip">🪑 Table ${tNum < 10 ? '0' + tNum : tNum}</span>
            <span class="table-status-pill free">🟢 Free</span>
          </div>
          <div class="table-card-zone">📍 ${t.zone}</div>
          <div class="table-card-body" style="min-height:48px;display:flex;align-items:center;justify-content:center;color:#64748b;font-weight:600;font-size:.82rem;">
            <span>Ready for guests</span>
          </div>
          <div class="table-card-actions">
            <button type="button" class="adm-btn adm-btn-primary table-card-btn table-open-pos-btn" data-table="${tNum}" style="background:#10b981;border-color:#10b981;width:100%;">
              <span>+</span> New Order
            </button>
          </div>
        </div>
      `;
    }

    if (t.state === 'occupied') {
      const primaryOrder = sess.orders[0];
      const activeOrderNum = primaryOrder ? formatDailyOrderNumber(primaryOrder) : '';
      const orderNumsText = sess.kots.length > 1
        ? sess.kots.map(k => `#${k.orderNumber}`).join(', ')
        : `#${activeOrderNum}`;
      
      const orderStatusBadge = primaryOrder?.status === 'preparing'
        ? `<span class="table-status-pill preparing" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;">🍳 In Kitchen</span>`
        : `<span class="table-status-pill occupied">🟡 Dining</span>`;

      const itemsSummary = sess.consolidatedItems.map(i => `${i.quantity}× ${escapeHtml(i.item_name)}`).join(', ');

      return `
        <div class="pos-table-card occupied" data-table="${tNum}" style="border-top:3px solid #eab308;">
          <div class="table-card-head">
            <span class="table-number-chip">🪑 Table ${tNum < 10 ? '0' + tNum : tNum}</span>
            ${orderStatusBadge}
          </div>
          <div class="table-card-zone" style="display:flex;justify-content:space-between;align-items:center;">
            <span>📍 ${t.zone}</span>
            <span style="font-size:0.75rem;color:#64748b;">⏱️ ${timeSince(sess.earliestTime)}</span>
          </div>
          <div class="table-card-body" style="padding:0.4rem 0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
              <span style="font-size:0.78rem;font-weight:800;color:#0f172a;" title="${orderNumsText}">Order ${orderNumsText}</span>
              <strong style="color:#d97706;font-weight:900;font-size:1.02rem;font-family:'Fraunces',Georgia,serif;">₹${sess.totalAmount.toFixed(2)}</strong>
            </div>
            <div style="font-size:0.75rem;color:#475569;margin-bottom:0.25rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              👤 <strong>${escapeHtml(sess.customerName || 'Dine-in Guest')}</strong>${sess.customerPhone && sess.customerPhone !== '9999999999' ? ` · 📞 ${escapeHtml(sess.customerPhone)}` : ''}
            </div>
            <div style="font-size:0.75rem;color:#64748b;line-height:1.35;max-height:42px;overflow:hidden;background:#f8fafc;padding:3px 6px;border-radius:6px;border:1px solid #f1f5f9;" title="${escapeHtml(itemsSummary)}">
              🍽️ ${escapeHtml(itemsSummary || 'Dishes ordered')}
            </div>
          </div>
          <div class="table-card-actions" style="flex-wrap:wrap;gap:0.35rem;margin-top:0.35rem;">
            <button type="button" class="adm-btn adm-btn-outline table-card-btn table-add-round-btn" data-table="${tNum}" style="background:#eef2ff;color:#4f46e5;border-color:#c7d2fe;flex:1;" title="Add new dishes (Round)">
              + Round
            </button>
            <button type="button" class="adm-btn adm-btn-outline table-card-btn table-transfer-btn" data-table="${tNum}" style="background:#f8fafc;color:#475569;border-color:#cbd5e1;flex:1;" title="Transfer or Swap Table ${tNum}">
              🔁 Transfer
            </button>
            <button type="button" class="adm-btn adm-btn-primary table-card-btn table-confirm-bill-btn" data-table="${tNum}" style="background:#10b981;border-color:#10b981;font-weight:800;flex:1.2;" title="Confirm order, generate unpaid bill, release Table ${tNum}, and move bill to Tables → Bill">
              🧾 Confirm Bill
            </button>
          </div>
        </div>
      `;
    }

    if (t.state === 'billed') {
      const bill = t.bill;
      return `
        <div class="pos-table-card billed" data-table="${tNum}" style="border-top:3px solid #3b82f6;">
          <div class="table-card-head">
            <span class="table-number-chip">🪑 Table ${tNum < 10 ? '0' + tNum : tNum}</span>
            <span class="table-status-pill billed">🔵 Billed (Unpaid)</span>
          </div>
          <div class="table-card-zone" style="display:flex;justify-content:space-between;align-items:center;">
            <span>📍 ${t.zone}</span>
            <span style="font-size:0.75rem;color:#64748b;">⏱️ ${timeSince(bill.updated_at || bill.created_at)}</span>
          </div>
          <div class="table-card-body" style="padding:0.4rem 0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
              <span style="font-size:0.78rem;font-weight:800;color:#0f172a;">Bill #${bill.order_number || bill.id}</span>
              <strong style="color:#2563eb;font-weight:900;font-size:1.02rem;font-family:'Fraunces',Georgia,serif;">₹${Number(bill.total_amount || 0).toFixed(2)}</strong>
            </div>
            <div style="font-size:0.75rem;color:#475569;margin-bottom:0.25rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              👤 <strong>${escapeHtml(bill.customer_name || 'Dine-in Guest')}</strong>${bill.customer_phone && bill.customer_phone !== '9999999999' ? ` · 📞 ${escapeHtml(bill.customer_phone)}` : ''}
            </div>
            ${bill._settlementPendingSync ? `
            <div style="font-size:0.75rem;color:#b45309;line-height:1.35;background:#fef3c7;padding:3px 6px;border-radius:6px;border:1px solid #fde68a;font-weight:700;">
              ⏳ Settlement Queued Offline (${(bill._pendingPaymentMethod || 'cash').toUpperCase()}) · Cloud confirmation pending
            </div>
            ` : `
            <div style="font-size:0.75rem;color:#1e40af;line-height:1.35;background:#eff6ff;padding:3px 6px;border-radius:6px;border:1px solid #bfdbfe;">
              ⏳ Bill generated · Awaiting settlement
            </div>
            `}
          </div>
          <div class="table-card-actions" style="flex-wrap:wrap;gap:0.35rem;margin-top:0.35rem;">
            <button type="button" class="adm-btn adm-btn-outline table-card-btn table-view-bill-btn" data-bill-id="${bill.id}" style="background:#eff6ff;color:#2563eb;border-color:#bfdbfe;flex:1;" title="View Bill details">
              👁️ View Bill
            </button>
            ${bill._settlementPendingSync ? `
            <button type="button" class="adm-btn adm-btn-outline table-card-btn" disabled style="background:#fef3c7;color:#92400e;border-color:#fde68a;font-weight:800;flex:1.2;cursor:not-allowed;" title="Settlement is queued offline and pending cloud confirmation">
              ⏳ Sync Pending
            </button>
            ` : `
            <button type="button" class="adm-btn adm-btn-primary table-card-btn table-settle-bill-btn" data-bill-id="${bill.id}" data-table="${tNum}" style="background:#2563eb;border-color:#2563eb;font-weight:800;flex:1.2;" title="Settle bill payment for Table ${tNum}">
              💳 Settle Pay
            </button>
            `}
          </div>
        </div>
      `;
    }

    // hold state
    return `
      <div class="pos-table-card hold" data-table="${tNum}">
        <div class="table-card-head">
          <span class="table-number-chip">🪑 Table ${tNum < 10 ? '0' + tNum : tNum}</span>
          <span class="table-status-pill hold">🟠 Hold</span>
        </div>
        <div class="table-card-zone">📍 ${t.zone} · ⏱️ ${timeSince(sess.earliestTime)}</div>
        <div class="table-card-body">
          <div style="font-weight:800;color:#0f172a;">${escapeHtml(sess.customerName)}</div>
          <div style="font-size:0.88rem;font-weight:900;color:#c2410c;">Held: ₹${sess.totalAmount.toFixed(0)}</div>
        </div>
        <div class="table-card-actions" style="flex-wrap:wrap;gap:0.35rem;">
          <button type="button" class="adm-btn adm-btn-outline table-card-btn table-resume-hold-btn" data-table="${tNum}" style="background:#fff7ed;color:#c2410c;border-color:#fed7aa;flex:1;">
            ▶️ Resume
          </button>
          <button type="button" class="adm-btn adm-btn-outline table-card-btn table-transfer-btn" data-table="${tNum}" style="background:#f8fafc;color:#475569;border-color:#cbd5e1;flex:1;" title="Transfer or Swap Table ${tNum}">
            🔁 Transfer
          </button>
          <button type="button" class="adm-btn adm-btn-primary table-card-btn table-confirm-bill-btn" data-table="${tNum}" style="background:#10b981;border-color:#10b981;font-weight:800;flex:1.2;" title="Confirm held order, generate unpaid bill, and release Table ${tNum}">
            ✔️ Confirm
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Wire table card click events
  container.querySelectorAll('.table-open-pos-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPosForTable(btn.dataset.table);
    });
  });

  container.querySelectorAll('.table-add-round-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tNum = parseInt(btn.dataset.table, 10);
      const sess = tableSessions.find(s => s.tableNumber === tNum);
      openPosForTable(tNum, sess ? sess.customerName : '', sess ? sess.customerPhone : '');
    });
  });

  container.querySelectorAll('.table-transfer-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tNum = parseInt(btn.dataset.table, 10);
      if (tNum) openTableTransferModal(tNum);
    });
  });

  container.querySelectorAll('.table-view-bill-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const bId = btn.dataset.billId;
      if (bId) openOrderDetailDrawer(bId);
    });
  });

  container.querySelectorAll('.table-settle-bill-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const bId = btn.dataset.billId;
      const bObj = orders.find(o => String(o.id) === String(bId));
      if (bObj) openHoldSettleModal({ type: 'order', orderId: bId, order: bObj });
    });
  });

  container.querySelectorAll('.table-confirm-bill-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tNum = parseInt(btn.dataset.table, 10);
      if (tNum) await confirmHeldTableOrder(tNum);
    });
  });

  container.querySelectorAll('.table-resume-hold-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      tablesSubtab = 'hold';
      document.querySelectorAll('#tables-filter-pills button').forEach(p => {
        p.classList.toggle('active', (p.dataset.subtab || p.dataset.filter) === 'hold');
      });
      renderTablesPanel();
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 🔁 TABLE TRANSFER & TABLE SWAP SYSTEM (TASK 2.3)
// ═══════════════════════════════════════════════════════════════

let currentTransferSourceTable = null;

export function openTableTransferModal(sourceTableNum) {
  const modal = $('adm-table-transfer-modal');
  if (!modal) return;

  const tableSessions = getActiveTableSessions();
  const sess = tableSessions.find(s => s.tableNumber === sourceTableNum);
  if (!sess || !sess.orders.length) {
    showAdminToast(`Table ${sourceTableNum} has no active session to transfer.`, 'warning');
    return;
  }

  currentTransferSourceTable = sourceTableNum;

  // Populate source table card
  if ($('transfer-source-table-badge')) {
    $('transfer-source-table-badge').textContent = `🪑 Source: Table ${sourceTableNum < 10 ? '0' + sourceTableNum : sourceTableNum}`;
  }
  if ($('transfer-source-amount')) {
    $('transfer-source-amount').textContent = `₹${sess.totalAmount.toFixed(2)}`;
  }
  if ($('transfer-source-customer')) {
    $('transfer-source-customer').innerHTML = `👤 Guest: <strong>${escapeHtml(sess.customerName || 'Dine-in Guest')}</strong>${sess.customerPhone && sess.customerPhone !== '9999999999' ? ` · 📞 ${escapeHtml(sess.customerPhone)}` : ''}`;
  }
  if ($('transfer-source-items')) {
    const totalItemsCount = (sess.consolidatedItems || []).reduce((acc, i) => acc + (i.quantity || 1), 0);
    $('transfer-source-items').textContent = `🍽️ Orders: ${sess.orders.length} Ticket${sess.orders.length > 1 ? 's' : ''} · ${totalItemsCount} Items`;
  }
  if ($('table-transfer-reason')) {
    $('table-transfer-reason').value = '';
  }

  // Populate target table select
  const select = $('table-transfer-target-select');
  if (select) {
    const totalTables = getTotalTablesCount();
    const unpaidTableBills = typeof getOutstandingBills === 'function' ? getOutstandingBills('table') : getOutstandingTableBills();
    
    let optionsHtml = '';
    for (let tNum = 1; tNum <= totalTables; tNum++) {
      if (tNum === sourceTableNum) continue;

      const targetSess = tableSessions.find(s => s.tableNumber === tNum);
      const targetBill = unpaidTableBills.find(b => {
        const meta = parseNotesMetadata(b.notes, b);
        const bNum = parseInt(String(meta.tableNumber || b.table_number || '').replace(/\D/g, ''), 10);
        return bNum === tNum;
      });

      const padNum = tNum < 10 ? '0' + tNum : tNum;

      if (targetSess && targetSess.orders.length > 0) {
        optionsHtml += `<option value="${tNum}" data-state="occupied">Table ${padNum} (🟡 Occupied — ₹${targetSess.totalAmount.toFixed(0)})</option>`;
      } else if (targetBill) {
        optionsHtml += `<option value="${tNum}" data-state="billed">Table ${padNum} (🔵 Billed Unpaid — ₹${Number(targetBill.total_amount || 0).toFixed(0)})</option>`;
      } else {
        optionsHtml += `<option value="${tNum}" data-state="free">Table ${padNum} (🟢 Free)</option>`;
      }
    }
    select.innerHTML = optionsHtml;
    updateTransferModalTargetState();
  }

  modal.style.display = 'flex';
}

export function closeTableTransferModal() {
  const modal = $('adm-table-transfer-modal');
  if (modal) modal.style.display = 'none';
  currentTransferSourceTable = null;
}

export function updateTransferModalTargetState() {
  const select = $('table-transfer-target-select');
  const notice = $('table-transfer-status-notice');
  const transferBtn = $('btn-do-table-transfer');
  const swapBtn = $('btn-do-table-swap');
  if (!select || !notice) return;

  const selectedOpt = select.selectedOptions[0];
  if (!selectedOpt) return;

  const targetState = selectedOpt.dataset.state;
  const targetNum = parseInt(select.value, 10);

  if (targetState === 'free') {
    notice.style.background = '#f0fdf4';
    notice.style.borderColor = '#bbf7d0';
    notice.style.color = '#166534';
    notice.innerHTML = `🟢 <strong>Table ${targetNum} is Free:</strong> Active orders, items, and KOT history will be transferred to Table ${targetNum}. Source Table ${currentTransferSourceTable} will become Available.`;
    if (transferBtn) {
      transferBtn.style.display = 'inline-flex';
      transferBtn.disabled = false;
    }
    if (swapBtn) {
      swapBtn.style.display = 'none';
    }
  } else if (targetState === 'occupied') {
    notice.style.background = '#fffbeb';
    notice.style.borderColor = '#fde68a';
    notice.style.color = '#92400e';
    notice.innerHTML = `🟡 <strong>Table ${targetNum} is currently Occupied:</strong> Direct transfer is prohibited. Click <strong>Confirm Table Swap</strong> to safely interchange Table ${currentTransferSourceTable} and Table ${targetNum} sessions.`;
    if (transferBtn) {
      transferBtn.style.display = 'none';
    }
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
    if (swapBtn) {
      swapBtn.style.display = 'none';
    }
  }
}

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

export async function executeTableTransfer(sourceTableNum = currentTransferSourceTable, targetTableNum = null, reason = '') {
  if (!sourceTableNum) {
    showAdminToast('Source table not specified', 'error');
    return false;
  }
  if (!targetTableNum) {
    const sel = $('table-transfer-target-select');
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

  const staffReason = reason || $('table-transfer-reason')?.value?.trim() || '';
  const currentStaff = currentAdminUser?.name || currentAdminUser?.email || 'Staff';

  const transferBtn = $('btn-do-table-transfer');
  if (transferBtn) {
    transferBtn.disabled = true;
    transferBtn.innerHTML = '<span>⏳</span> Transferring...';
  }

  try {
    // 1. Call atomic database RPC
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
        console.warn('[Table Transfer RPC Warning]:', rpcErr.message);
      } else if (rpcRes && rpcRes.success) {
        rpcSuccess = true;
      }
    } catch (rpcEx) {
      console.warn('[Table Transfer RPC Exception]:', rpcEx.message);
    }

    // 2. Direct database update fallback
    if (!rpcSuccess) {
      try {
        const updatePayload = {
          table_number: targetTableNum,
          updated_at: new Date().toISOString()
        };
        await insforge.database
          .from('orders')
          .update(updatePayload)
          .eq('table_number', sourceTableNum)
          .not('status', 'in', '("delivered","cancelled")')
          .not('ticket_status', 'in', '("CLOSED","CANCELLED")');
      } catch (dbErr) {
        console.warn('[Table Transfer Direct DB Warning]:', dbErr.message);
      }
    }

    // 3. In-memory update
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

    persistOrdersCache();

    showAdminToast(`Table ${sourceTableNum} successfully transferred to Table ${targetTableNum}! 🪑➡️🪑`, 'success');
    closeTableTransferModal();
    renderTablesPanel();
    renderOverview();
    return true;
  } catch (err) {
    showAdminToast('Failed to transfer table: ' + err.message, 'error');
    return false;
  } finally {
    if (transferBtn) {
      transferBtn.disabled = false;
      transferBtn.innerHTML = '<span>➡️</span> Transfer Table';
    }
  }
}

export async function executeTableSwap(tableA = currentTransferSourceTable, tableB = null, reason = '') {
  if (!tableA) {
    showAdminToast('Source table not specified', 'error');
    return false;
  }
  if (!tableB) {
    const sel = $('table-transfer-target-select');
    tableB = sel ? parseInt(sel.value, 10) : null;
  }
  if (!tableB || isNaN(tableB)) {
    showAdminToast('Please select a valid table to swap with', 'error');
    return false;
  }
  if (tableA === tableB) {
    showAdminToast('Cannot swap table with itself', 'error');
    return false;
  }

  const staffReason = reason || $('table-transfer-reason')?.value?.trim() || '';
  const currentStaff = currentAdminUser?.name || currentAdminUser?.email || 'Staff';

  const swapBtn = $('btn-do-table-swap');
  if (swapBtn) {
    swapBtn.disabled = true;
    swapBtn.innerHTML = '<span>⏳</span> Swapping...';
  }

  try {
    // 1. Call atomic database RPC
    let rpcSuccess = false;
    try {
      const { data: rpcRes, error: rpcErr } = await insforge.database.rpc('swap_table_sessions_atomic', {
        p_table_a: tableA,
        p_table_b: tableB,
        p_staff_name: currentStaff,
        p_reason: staffReason
      });

      if (rpcErr) {
        showAdminToast('Failed to swap tables: ' + rpcErr.message, 'error');
        return false;
      } else if (rpcRes && rpcRes.success) {
        rpcSuccess = true;
      }
    } catch (rpcEx) {
      console.warn('[Table Swap RPC Exception]:', rpcEx.message);
    }

    // 2. In-memory update
    const activeOrdersA = orders.filter(o => {
      if (o.status === 'delivered' || o.status === 'cancelled' || o.ticket_status === 'CLOSED' || o.ticket_status === 'CANCELLED') return false;
      const meta = parseNotesMetadata(o.notes, o);
      const tNum = parseInt(String(meta.tableNumber || o.table_number || '').replace(/\D/g, ''), 10);
      return tNum === tableA;
    });

    const activeOrdersB = orders.filter(o => {
      if (o.status === 'delivered' || o.status === 'cancelled' || o.ticket_status === 'CLOSED' || o.ticket_status === 'CANCELLED') return false;
      const meta = parseNotesMetadata(o.notes, o);
      const tNum = parseInt(String(meta.tableNumber || o.table_number || '').replace(/\D/g, ''), 10);
      return tNum === tableB;
    });

    activeOrdersA.forEach(ord => {
      ord.table_number = tableB;
      ord.notes = updateNotesTableNumber(ord.notes, tableB, tableA, currentStaff, true);
      ord.updated_at = new Date().toISOString();
    });

    activeOrdersB.forEach(ord => {
      ord.table_number = tableA;
      ord.notes = updateNotesTableNumber(ord.notes, tableA, tableB, currentStaff, true);
      ord.updated_at = new Date().toISOString();
    });

    persistOrdersCache();

    showAdminToast(`Table ${tableA} and Table ${tableB} successfully swapped! 🔄`, 'success');
    closeTableTransferModal();
    renderTablesPanel();
    renderOverview();
    return true;
  } catch (err) {
    showAdminToast('Failed to swap tables: ' + err.message, 'error');
    return false;
  } finally {
    if (swapBtn) {
      swapBtn.disabled = false;
      swapBtn.innerHTML = '<span>🔄</span> Confirm Table Swap';
    }
  }
}

export function initTableTransferModalListeners() {
  $('btn-close-table-transfer')?.addEventListener('click', closeTableTransferModal);
  $('btn-cancel-table-transfer')?.addEventListener('click', closeTableTransferModal);

  const modal = $('adm-table-transfer-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeTableTransferModal();
    });
  }

  $('table-transfer-target-select')?.addEventListener('change', updateTransferModalTargetState);
  $('btn-do-table-transfer')?.addEventListener('click', () => executeTableTransfer());
  $('btn-do-table-swap')?.addEventListener('click', () => executeTableSwap());
}

function openPosForTable(tableNum, customerName = '', customerPhone = '') {
  switchPanel('order-detail');
  setTimeout(() => {
    $('billing-new-btn')?.click();
    setTimeout(() => {
      const tblTypeBtn = document.querySelector('.pos-type-btn[data-type="table"]');
      if (tblTypeBtn) tblTypeBtn.click();

      const tInp = $('pos-table-number');
      if (tInp) {
        tInp.value = `Table ${tableNum}`;
        tInp.classList.remove('pos-input-invalid');
      }

      if (customerName && $('pos-customer-name')) $('pos-customer-name').value = customerName;
      if (customerPhone && $('pos-customer-phone')) $('pos-customer-phone').value = customerPhone;

      $('pos-customer-name')?.focus();
    }, 120);
  }, 100);
}

// ═══════════════════════════════════════════════════════════════
// 👨‍🍳 KITCHEN / KOT DISPLAY SYSTEM (KDS) & BUMP BAR
// ═══════════════════════════════════════════════════════════════

let kitchenFilter = 'all';
let kdsBumpHistory = [];
let kdsTallySearchTerm = '';

// Load bump history from sessionStorage
try {
  const savedBump = sessionStorage.getItem('limra_kds_bump_history');
  if (savedBump) kdsBumpHistory = JSON.parse(savedBump) || [];
} catch (e) {
  kdsBumpHistory = [];
}

// ═════════════════════════════════════════════════════════════════
// KDS CHECKOFF & PRODUCTION TALLY ENGINE
// ═════════════════════════════════════════════════════════════════

function getKitchenCheckedItems() {
  try {
    const raw = localStorage.getItem('limra_kds_checked_items');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveKitchenCheckedItems(data) {
  try {
    localStorage.setItem('limra_kds_checked_items', JSON.stringify(data));
  } catch (e) {
    console.warn('[KDS Storage Warn]:', e);
  }
}

function isKitchenItemChecked(orderId, itemIdx) {
  const store = getKitchenCheckedItems();
  return Boolean(store[orderId] && store[orderId][itemIdx]);
}

function toggleKitchenItemCheckoff(orderId, itemIdx, forceState) {
  const store = getKitchenCheckedItems();
  if (!store[orderId]) store[orderId] = {};
  if (typeof forceState === 'boolean') {
    store[orderId][itemIdx] = forceState;
  } else {
    store[orderId][itemIdx] = !store[orderId][itemIdx];
  }
  saveKitchenCheckedItems(store);
  renderKitchenProductionTally();
  return store[orderId][itemIdx];
}

function toggleAllKitchenItems(orderId, shouldCheck) {
  const order = orders.find(o => String(o.id) === String(orderId));
  if (!order) return;
  const items = consolidateOrderItems(getItemsForOrder(order.id));
  const store = getKitchenCheckedItems();
  if (!store[orderId]) store[orderId] = {};
  items.forEach((_, idx) => {
    store[orderId][idx] = shouldCheck;
  });
  saveKitchenCheckedItems(store);
  renderKitchenPanel();
}

function cleanKitchenCheckedItemsForClosedOrders() {
  const store = getKitchenCheckedItems();
  let modified = false;
  const activeIds = new Set(
    orders
      .filter(o => o.ticket_status !== 'CLOSED' && o.ticket_status !== 'CANCELLED' && o.status !== 'delivered' && o.status !== 'cancelled')
      .map(o => String(o.id))
  );
  Object.keys(store).forEach(id => {
    if (!activeIds.has(String(id))) {
      delete store[id];
      modified = true;
    }
  });
  if (modified) saveKitchenCheckedItems(store);
}

function renderKitchenProductionTally() {
  const listEl = $('kitchen-tally-list');
  const totalBadgeEl = $('kitchen-tally-total-qty');
  if (!listEl) return;

  // Active cooking/pending orders
  const activeOrders = orders.filter(o => {
    if (o.ticket_status === 'CLOSED' || o.ticket_status === 'CANCELLED') return false;
    if (o.status === 'delivered' || o.status === 'cancelled') return false;
    return ['pending', 'confirmed', 'preparing'].includes(o.status);
  });

  const dishTally = {};
  let grandTotalQty = 0;
  let grandRemainingQty = 0;

  activeOrders.forEach(order => {
    const rawItems = getItemsForOrder(order.id);
    const items = consolidateOrderItems(rawItems);
    items.forEach((item, idx) => {
      const name = item.item_name || 'Unnamed Dish';
      const qty = Number(item.quantity) || 1;
      const isChecked = isKitchenItemChecked(order.id, idx);
      if (!dishTally[name]) {
        dishTally[name] = { totalQty: 0, remainingQty: 0 };
      }
      dishTally[name].totalQty += qty;
      grandTotalQty += qty;
      if (!isChecked) {
        dishTally[name].remainingQty += qty;
        grandRemainingQty += qty;
      }
    });
  });

  if (totalBadgeEl) {
    totalBadgeEl.textContent = `${grandRemainingQty} left / ${grandTotalQty} total`;
    totalBadgeEl.style.background = grandRemainingQty > 15 ? '#fee2e2' : '#dbeafe';
    totalBadgeEl.style.color = grandRemainingQty > 15 ? '#b91c1c' : '#1e40af';
  }

  const entries = Object.entries(dishTally).sort((a, b) => b[1].remainingQty - a[1].remainingQty || b[1].totalQty - a[1].totalQty);
  const search = (kdsTallySearchTerm || '').trim().toLowerCase();
  const filtered = entries.filter(([name]) => !search || name.toLowerCase().includes(search));

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center;padding:1.5rem 0.5rem;color:var(--pos-text-muted,#64748b);font-size:0.8rem;">
        ${search ? 'No matching dishes' : 'No active items to cook'}
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(([name, data]) => {
    const isHighVolume = data.remainingQty >= 5;
    const isDone = data.remainingQty === 0;
    return `
      <div class="kitchen-tally-row ${isDone ? 'done' : ''}" style="${isDone ? 'opacity:0.45;' : ''}">
        <div class="kitchen-tally-row-left" style="display:flex;align-items:center;gap:0.4rem;min-width:0;">
          <span style="font-size:0.9rem;">${isDone ? '✅' : '🍲'}</span>
          <span class="kitchen-tally-dish-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:0.35rem;">
          ${data.totalQty !== data.remainingQty ? `<span style="font-size:0.75rem;color:var(--pos-text-muted,#64748b);font-weight:700;">${data.totalQty - data.remainingQty} done</span>` : ''}
          <span class="kitchen-tally-qty-badge ${isHighVolume ? 'high-volume' : ''}">
            ${data.remainingQty}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

// ═════════════════════════════════════════════════════════════════
// RECALL LAST BUMPED TICKET & KDS TOOL CONTROLS
// ═════════════════════════════════════════════════════════════════

async function recallLastBumpedKitchenOrder() {
  if (!Array.isArray(kdsBumpHistory) || kdsBumpHistory.length === 0) {
    showAdminToast('No recently bumped tickets to recall.', 'info');
    return;
  }

  const lastBump = kdsBumpHistory.pop();
  try {
    sessionStorage.setItem('limra_kds_bump_history', JSON.stringify(kdsBumpHistory));
  } catch (e) {}

  const order = orders.find(o => String(o.id) === String(lastBump.orderId));
  const targetStatus = lastBump.previousStatus || 'preparing';

  try {
    const { error } = await insforge.database
      .from('orders')
      .update({ status: targetStatus, updated_at: new Date().toISOString() })
      .eq('id', lastBump.orderId);
    if (error) throw error;

    if (order) {
      order.status = targetStatus;
    }

    const orderNum = order ? formatDailyOrderNumber(order) : lastBump.orderId;
    showAdminToast(`Order #${orderNum} recalled back to ${targetStatus.toUpperCase()}! ↩`, 'success');

    renderKitchenPanel();
    updateKitchenBadges();
    renderTablesPanel();
    renderOverview();
  } catch (err) {
    showAdminToast('Failed to recall ticket: ' + err.message, 'error');
  }
}

function toggleKitchenDarkMode(force) {
  const panel = $('panel-kitchen');
  if (!panel) return;
  const isDark = typeof force === 'boolean' ? force : !panel.classList.contains('dark-kds');
  panel.classList.toggle('dark-kds', isDark);

  const icon = $('kitchen-dark-icon');
  const label = $('kitchen-dark-label');
  if (icon) icon.textContent = isDark ? '☀️' : '🌙';
  if (label) label.textContent = isDark ? 'Light KDS' : 'Dark KDS';

  try {
    localStorage.setItem('limra_kds_dark_mode', isDark ? 'true' : 'false');
  } catch (e) {}
}

function toggleKitchenFullscreen() {
  const panel = $('panel-kitchen');
  if (!panel) return;
  if (!document.fullscreenElement) {
    if (panel.requestFullscreen) {
      panel.requestFullscreen().catch(err => {
        console.warn('Fullscreen failed:', err);
      });
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(err => {
        console.warn('Exit fullscreen failed:', err);
      });
    }
  }
}

function toggleKitchenTallyRail() {
  const rail = $('kitchen-production-tally-rail');
  if (rail) {
    rail.classList.toggle('collapsed');
  }
}

// ═════════════════════════════════════════════════════════════════
// MAIN KITCHEN PANEL RENDERER
// ═════════════════════════════════════════════════════════════════

function renderKitchenPanel() {
  const container = $('kitchen-kot-container');
  if (!container) return;

  const activeKitchenOrders = orders.filter(o => {
    if (o.ticket_status === 'CLOSED' || o.ticket_status === 'CANCELLED') return false;
    if (o.status === 'delivered' || o.status === 'cancelled') return false;
    return ['pending', 'confirmed', 'preparing', 'ready'].includes(o.status);
  });

  // Calculate Urgency Counts
  let urgentCount = 0;
  let warningCount = 0;
  let freshCount = 0;
  const now = Date.now();

  activeKitchenOrders.forEach(o => {
    const elapsed = Math.max(0, Math.floor((now - new Date(o.created_at).getTime()) / 60000));
    if (elapsed >= 20) urgentCount++;
    else if (elapsed >= 10) warningCount++;
    else freshCount++;
  });

  const urgentEl = $('kitchen-urgent-count');
  if (urgentEl) urgentEl.textContent = urgentCount;
  const warningEl = $('kitchen-warning-count');
  if (warningEl) warningEl.textContent = warningCount;
  const freshEl = $('kitchen-fresh-count');
  if (freshEl) freshEl.textContent = freshCount;

  // Update Recall button state
  const recallBtn = $('btn-kitchen-recall');
  if (recallBtn) {
    recallBtn.disabled = !Array.isArray(kdsBumpHistory) || kdsBumpHistory.length === 0;
    recallBtn.title = recallBtn.disabled ? 'No recently bumped tickets to recall' : `Recall last bumped ticket (${kdsBumpHistory.length} available)`;
  }

  // Update badge in kitchen header
  const badge = $('kitchen-active-badge');
  if (badge) {
    badge.textContent = `${activeKitchenOrders.length} Active KOT${activeKitchenOrders.length === 1 ? '' : 's'}`;
    badge.style.background = activeKitchenOrders.length > 0 ? '#fef3c7' : '#ecfdf5';
    badge.style.color = activeKitchenOrders.length > 0 ? '#b45309' : '#059669';
  }

  // Update sidebar badge
  updateKitchenBadges();

  // Filter orders
  const filtered = activeKitchenOrders.filter(o => {
    if (kitchenFilter === 'pending') return o.status === 'pending' || o.status === 'confirmed';
    if (kitchenFilter === 'preparing') return o.status === 'preparing';
    if (kitchenFilter === 'ready') return o.status === 'ready';
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="adm-card adm-empty kitchen-empty-state" style="grid-column:1/-1;padding:2.5rem 1rem;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:0.5rem;">👨‍🍳✨</div>
        <h3 style="font-size:1.1rem;font-weight:800;color:inherit;margin:0 0 .25rem 0;">Kitchen Queue is Clear!</h3>
        <p style="font-size:0.85rem;color:var(--pos-text-muted,#64748b);margin:0;">No active tickets waiting in kitchen. New orders will appear here automatically.</p>
      </div>
    `;
    renderKitchenProductionTally();
    return;
  }

  container.innerHTML = filtered.map(order => {
    const rawItems = getItemsForOrder(order.id);
    const items = consolidateOrderItems(rawItems);
    const parsedMeta = parseNotesMetadata(order.notes, order);
    const orderNum = formatDailyOrderNumber(order);

    const elapsedMins = Math.max(0, Math.floor((now - new Date(order.created_at).getTime()) / 60000));
    let timerClass = 'green';
    let timerText = `⏱️ ${elapsedMins}m ago`;
    if (elapsedMins >= 20) {
      timerClass = 'red';
      timerText = `🚨 ${elapsedMins}m (Urgent!)`;
    } else if (elapsedMins >= 10) {
      timerClass = 'amber';
      timerText = `⏳ ${elapsedMins}m ago`;
    }

    let typeBadge = '';
    const isTable = parsedMeta.type === 'table' || order.order_type === 'table' || parsedMeta.tableNumber || order.table_number;
    if (isTable) {
      const tNum = parsedMeta.tableNumber || order.table_number || '';
      typeBadge = `<span style="background:#eef2ff;color:#4f46e5;font-size:.78rem;font-weight:900;padding:.2rem .55rem;border-radius:6px;">🪑 Table ${tNum}</span>`;
    } else if (order.order_type === 'delivery' || parsedMeta.type === 'delivery') {
      typeBadge = `<span style="background:#ecfeff;color:#0891b2;font-size:.78rem;font-weight:800;padding:.2rem .55rem;border-radius:6px;">🚗 Delivery</span>`;
    } else {
      typeBadge = `<span style="background:#fef3c7;color:#b45309;font-size:.78rem;font-weight:800;padding:.2rem .55rem;border-radius:6px;">🥡 Pickup</span>`;
    }

    let cardStatusClass = 'pending';
    if (order.status === 'preparing') cardStatusClass = 'preparing';
    else if (order.status === 'ready') cardStatusClass = 'ready';

    let statusLabel = '⏳ NEW TICKET';
    if (order.status === 'preparing') statusLabel = '🔥 COOKING';
    else if (order.status === 'ready') statusLabel = '🍽️ READY';

    let checkedCount = 0;
    const itemsHtml = items.map((i, idx) => {
      const isChecked = isKitchenItemChecked(order.id, idx);
      if (isChecked) checkedCount++;
      return `
        <div class="kot-item-row ${isChecked ? 'kot-item-struck' : ''}" data-order-id="${order.id}" data-item-idx="${idx}" title="Tap to check off cooked dish">
          <button type="button" class="kot-item-checkbox ${isChecked ? 'checked' : ''}" aria-label="Toggle dish preparation status">
            ${isChecked ? '✓' : ''}
          </button>
          <span class="kot-qty-pill">${i.quantity}×</span>
          <div style="flex:1;">
            <div class="kot-item-name">${escapeHtml(i.item_name)}</div>
            ${i.notes ? `<div class="kot-item-note">📝 ${escapeHtml(i.notes)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    const allChecked = items.length > 0 && checkedCount === items.length;

    const kitchenNoteHtml = parsedMeta.cleanNotes ? `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:0.4rem 0.6rem;font-size:0.8rem;color:#b45309;font-weight:700;">
        ⚠️ Note: ${escapeHtml(parsedMeta.cleanNotes)}
      </div>
    ` : '';

    let bumpBtnHtml = '';
    if (order.status === 'pending' || order.status === 'confirmed') {
      bumpBtnHtml = `
        <button type="button" class="kitchen-bump-btn kitchen-bump-prep-btn" data-id="${order.id}" style="background:#3b82f6;color:#fff;">
          👨‍🍳 Start Cooking
        </button>
      `;
    } else if (order.status === 'preparing') {
      bumpBtnHtml = `
        <button type="button" class="kitchen-bump-btn kitchen-bump-ready-btn" data-id="${order.id}" style="background:#10b981;color:#fff;">
          🍽️ Mark Ready
        </button>
      `;
    } else if (order.status === 'ready') {
      bumpBtnHtml = `
        <button type="button" class="kitchen-bump-btn kitchen-bump-served-btn" data-id="${order.id}" style="background:#059669;color:#fff;">
          ✓ Mark Served
        </button>
      `;
    }

    return `
      <div class="kitchen-kot-card ${cardStatusClass}" data-id="${order.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.35rem;">
          <div style="display:flex;align-items:center;gap:.4rem;">
            <span class="kot-card-title" style="font-size:1.05rem;font-weight:900;color:inherit;">KOT #${orderNum}</span>
            ${typeBadge}
          </div>
          <div style="display:flex;align-items:center;gap:0.35rem;">
            <span class="kot-timer-badge ${timerClass}">${timerText}</span>
            <button type="button" class="adm-btn adm-btn-outline kitchen-toggle-all-items-btn" data-id="${order.id}" data-all-checked="${allChecked ? 'true' : 'false'}" style="min-height:30px;min-width:30px;padding:0.15rem 0.45rem;font-size:0.75rem;" title="${allChecked ? 'Unmark all items' : 'Mark all items complete'}">
              ${allChecked ? '✕ Clear' : '✓ All'}
            </button>
            <button type="button" class="adm-btn adm-btn-outline kitchen-reprint-kot-btn" data-id="${order.id}" style="min-height:30px;min-width:30px;padding:0.15rem 0.45rem;font-size:0.8rem;" title="Reprint thermal KOT ticket">
              🖨️
            </button>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.8rem;color:var(--pos-text-muted,#64748b);">
          <span>Guest: <strong style="color:inherit;">${escapeHtml(order.customer_name || 'Dine-in')}</strong></span>
          <span style="font-weight:800;color:${cardStatusClass === 'ready' ? '#10b981' : (cardStatusClass === 'preparing' ? '#3b82f6' : '#d97706')}">${statusLabel}</span>
        </div>

        ${kitchenNoteHtml}

        <div style="flex:1;min-height:80px;max-height:220px;overflow-y:auto;padding-right:2px;">
          ${itemsHtml}
        </div>

        <div style="margin-top:0.25rem;">
          ${bumpBtnHtml}
        </div>
      </div>
    `;
  }).join('');

  // Wire item row click listeners for tap-to-strike checkoff
  container.querySelectorAll('.kot-item-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't trigger if clicked on nested link if any
      const orderId = row.dataset.orderId;
      const itemIdx = Number(row.dataset.itemIdx);
      const isStruck = toggleKitchenItemCheckoff(orderId, itemIdx);
      
      row.classList.toggle('kot-item-struck', isStruck);
      const checkbox = row.querySelector('.kot-item-checkbox');
      if (checkbox) {
        checkbox.classList.toggle('checked', isStruck);
        checkbox.textContent = isStruck ? '✓' : '';
      }

      // Check card's toggle-all state
      const card = row.closest('.kitchen-kot-card');
      if (card) {
        const rows = Array.from(card.querySelectorAll('.kot-item-row'));
        const allChecked = rows.every(r => r.classList.contains('kot-item-struck'));
        const toggleAllBtn = card.querySelector('.kitchen-toggle-all-items-btn');
        if (toggleAllBtn) {
          toggleAllBtn.dataset.allChecked = allChecked ? 'true' : 'false';
          toggleAllBtn.textContent = allChecked ? '✕ Clear' : '✓ All';
        }
      }
    });
  });

  // Wire toggle-all button listeners
  container.querySelectorAll('.kitchen-toggle-all-items-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const orderId = btn.dataset.id;
      const allChecked = btn.dataset.allChecked === 'true';
      toggleAllKitchenItems(orderId, !allChecked);
    });
  });

  // Wire bump bar listeners
  container.querySelectorAll('.kitchen-bump-prep-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.id;
      await updateKitchenOrderStatus(orderId, 'preparing', '👨‍🍳 KOT is now Cooking!');
    });
  });

  container.querySelectorAll('.kitchen-bump-ready-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.id;
      await updateKitchenOrderStatus(orderId, 'ready', '🍽️ Food Ready to Serve!');
    });
  });

  container.querySelectorAll('.kitchen-bump-served-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.id;
      await updateKitchenOrderStatus(orderId, 'delivered', '✓ Order marked Served!');
    });
  });

  container.querySelectorAll('.kitchen-reprint-kot-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const order = orders.find(o => String(o.id) === String(btn.dataset.id));
      if (!order) return;
      const items = getItemsForOrder(order.id);
      await printKOT(order, items, { isReprint: true });
    });
  });

  // Render batch production summary rail and clean up closed items
  cleanKitchenCheckedItemsForClosedOrders();
  renderKitchenProductionTally();
}

async function updateKitchenOrderStatus(orderId, newStatus, toastMsg) {
  try {
    const o = orders.find(x => String(x.id) === String(orderId));
    const prevStatus = o ? o.status : 'pending';

    const { error } = await insforge.database
      .from('orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) throw error;

    if (o) o.status = newStatus;

    // Track in bump history for 1-click recall
    kdsBumpHistory.push({
      orderId,
      previousStatus: prevStatus,
      bumpedStatus: newStatus,
      timestamp: Date.now()
    });
    if (kdsBumpHistory.length > 10) kdsBumpHistory.shift();
    try {
      sessionStorage.setItem('limra_kds_bump_history', JSON.stringify(kdsBumpHistory));
    } catch (e) {}

    showAdminToast(toastMsg, 'success');
    renderKitchenPanel();
    updateKitchenBadges();
    renderTablesPanel();
    renderOverview();
  } catch (err) {
    showAdminToast('Failed to update kitchen status: ' + err.message, 'error');
  }
}

// Global window exposures for KDS
window.renderKitchenPanel = renderKitchenPanel;
window.renderKitchenProductionTally = renderKitchenProductionTally;
window.toggleKitchenItemCheckoff = toggleKitchenItemCheckoff;
window.toggleAllKitchenItems = toggleAllKitchenItems;
window.recallLastBumpedKitchenOrder = recallLastBumpedKitchenOrder;
window.toggleKitchenDarkMode = toggleKitchenDarkMode;
window.toggleKitchenFullscreen = toggleKitchenFullscreen;
window.toggleKitchenTallyRail = toggleKitchenTallyRail;
window.updateKitchenOrderStatus = updateKitchenOrderStatus;
window.kdsBumpHistory = kdsBumpHistory;

function updateKitchenBadges() {
  const activeKitchen = orders.filter(o => {
    if (o.ticket_status === 'CLOSED' || o.ticket_status === 'CANCELLED') return false;
    if (o.status === 'delivered' || o.status === 'cancelled') return false;
    return ['pending', 'confirmed', 'preparing', 'ready'].includes(o.status);
  });
  const badge = $('pending-kitchen-badge');
  if (badge) {
    if (activeKitchen.length > 0) {
      badge.textContent = activeKitchen.length;
      badge.classList.remove('adm-hidden');
    } else {
      badge.classList.add('adm-hidden');
    }
  }
}

function initTablesAndKitchenUI() {
  // Tables filter & subtab pills
  document.querySelectorAll('#tables-filter-pills button').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#tables-filter-pills button').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      tablesSubtab = pill.dataset.subtab || pill.dataset.filter || 'all';
      tablesFilter = pill.dataset.filter || 'all';
      renderTablesPanel();
    });
  });

  $('tables-search')?.addEventListener('input', renderTablesPanel);
  $('btn-tables-refresh')?.addEventListener('click', () => {
    renderTablesPanel();
  });
  $('btn-tables-new-order')?.addEventListener('click', () => {
    openPosForTable(1);
  });

  // Kitchen filter pills
  document.querySelectorAll('#kitchen-filter-pills button').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#kitchen-filter-pills button').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      kitchenFilter = pill.dataset.kitchenFilter || 'all';
      renderKitchenPanel();
    });
  });

  $('btn-kitchen-refresh')?.addEventListener('click', () => {
    renderKitchenPanel();
  });

  // Kitchen Toolbar Action Buttons
  $('btn-kitchen-recall')?.addEventListener('click', recallLastBumpedKitchenOrder);
  $('btn-kitchen-dark-mode')?.addEventListener('click', () => toggleKitchenDarkMode());
  $('btn-kitchen-fullscreen')?.addEventListener('click', toggleKitchenFullscreen);
  $('btn-kitchen-tally-toggle')?.addEventListener('click', toggleKitchenTallyRail);

  $('kitchen-tally-search')?.addEventListener('input', (e) => {
    kdsTallySearchTerm = e.target.value;
    renderKitchenProductionTally();
  });

  // Restore dark mode state
  try {
    if (localStorage.getItem('limra_kds_dark_mode') === 'true') {
      toggleKitchenDarkMode(true);
    }
  } catch (e) {}

  // POS 9-Hub Quick Tiles
  document.querySelectorAll('.pos-hub-tile[data-hub]').forEach(tile => {
    tile.addEventListener('click', () => {
      const hub = tile.dataset.hub;
      if (hub === 'new-order') {
        switchPanel('order-detail');
        setTimeout(() => $('billing-new-btn')?.click(), 100);
      } else if (hub === 'tables') {
        switchPanel('tables');
      } else if (hub === 'hold-orders') {
        switchPanel('hold-orders');
      } else if (hub === 'kitchen') {
        switchPanel('kitchen');
      } else if (hub === 'order-detail') {
        switchPanel('order-detail');
      } else if (hub === 'payments') {
        switchPanel('order-detail');
      } else if (hub === 'closed-orders') {
        switchPanel('closed-orders');
      } else if (hub === 'stock') {
        switchPanel('stock');
      } else if (hub === 'analytics') {
        switchPanel('customer-analysis');
      }
    });
  });
}

// ════════════════════════════════════════════════════════
// 📊 ITEMS REPORT & SALES PERFORMANCE ENGINE
// ════════════════════════════════════════════════════════
// 📊 ITEMS REPORT & SALES PERFORMANCE ENGINE
// ════════════════════════════════════════════════════════

let itemReportDateFilter = 'all';
let itemReportCustomStart = null;
let itemReportCustomEnd = null;
let itemReportCategoryFilter = 'all';
let itemReportScopeFilter = 'sold';
let itemReportTypeFilter = 'all';
let itemReportSort = 'revenue_desc';
let itemReportSearch = '';
let itemTopSellersChartInstance = null;
let itemCategorySplitChartInstance = null;

function computeItemSalesReport() {
  const now = new Date();
  const todayStr = getLocalDateString(now);
  const yDate = new Date(now);
  yDate.setDate(yDate.getDate() - 1);
  const yestStr = getLocalDateString(yDate);

  // Exclude cancelled and hold orders so only genuine sales are analyzed
  let eligibleOrders = orders.filter(o => o.status !== 'cancelled' && o.status !== 'hold');

  if (itemReportDateFilter === 'today') {
    eligibleOrders = eligibleOrders.filter(o => getLocalDateString(o.created_at) === todayStr);
  } else if (itemReportDateFilter === 'yesterday') {
    eligibleOrders = eligibleOrders.filter(o => getLocalDateString(o.created_at) === yestStr);
  } else if (itemReportDateFilter === 'week') {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    eligibleOrders = eligibleOrders.filter(o => new Date(o.created_at) >= weekStart);
  } else if (itemReportDateFilter === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    eligibleOrders = eligibleOrders.filter(o => new Date(o.created_at) >= monthStart);
  } else if (itemReportDateFilter === 'custom' && itemReportCustomStart) {
    const cStart = new Date(itemReportCustomStart + 'T00:00:00');
    const cEnd = itemReportCustomEnd ? new Date(itemReportCustomEnd + 'T23:59:59.999') : new Date(itemReportCustomStart + 'T23:59:59.999');
    eligibleOrders = eligibleOrders.filter(o => {
      const t = new Date(o.created_at);
      return t >= cStart && t <= cEnd;
    });
  }

  // Filter by Order Type (table, delivery, pickup)
  if (itemReportTypeFilter !== 'all') {
    eligibleOrders = eligibleOrders.filter(o => {
      const parsed = parseNotesMetadata(o.notes, o);
      const isTable = parsed.type === 'table' || o.order_type === 'table' || Boolean(parsed.tableNumber || o.table_number);
      if (itemReportTypeFilter === 'table') return isTable;
      if (itemReportTypeFilter === 'delivery') return parsed.type === 'delivery' || o.order_type === 'delivery';
      if (itemReportTypeFilter === 'pickup') return parsed.type === 'pickup' || o.order_type === 'pickup' || o.order_type === 'takeaway';
      return parsed.type === itemReportTypeFilter || o.order_type === itemReportTypeFilter;
    });
  }

  // Initialize catalog lookup from menuItems, combos, and custom dishes
  const itemMap = new Map();

  // Add menuItems
  menuItems.forEach(m => {
    const key = (m.name || '').toLowerCase().trim();
    itemMap.set(key, {
      id: m.id,
      name: m.name,
      category: m.category || 'other',
      price: Number(m.price || 0),
      image: m.image || categoryImages[m.category] || '/images/food_starters.png',
      qtySold: 0,
      totalRevenue: 0,
      orderIds: new Set(),
      orderCount: 0
    });
  });

  // Add Combos
  if (Array.isArray(adminCombos)) {
    adminCombos.forEach(c => {
      const key = (c.name || '').toLowerCase().trim();
      if (!itemMap.has(key)) {
        itemMap.set(key, {
          id: c.id,
          name: c.name,
          category: 'combo',
          price: Number(c.price || 0),
          image: c.image_url || categoryImages['combo'] || '/images/food_biryani.png',
          qtySold: 0,
          totalRevenue: 0,
          orderIds: new Set(),
          orderCount: 0
        });
      }
    });
  }

  // Add Custom Dishes
  if (Array.isArray(customCreatedFoods)) {
    customCreatedFoods.forEach(cd => {
      const key = (cd.name || '').toLowerCase().trim();
      if (!itemMap.has(key)) {
        itemMap.set(key, {
          id: cd.id,
          name: cd.name,
          category: cd.category || 'other',
          price: Number(cd.price || 0),
          image: cd.image || categoryImages[cd.category] || '/images/food_starters.png',
          qtySold: 0,
          totalRevenue: 0,
          orderIds: new Set(),
          orderCount: 0
        });
      }
    });
  }

  // Aggregate items from all eligible orders using getItemsForOrder
  eligibleOrders.forEach(order => {
    let items = getItemsForOrder(order.id);
    if ((!items || items.length === 0) && Array.isArray(order.items) && order.items.length > 0) {
      items = order.items.filter(isFoodDishItem);
    }
    if (!items || !items.length) return;

    items.forEach(oi => {
      if (!isFoodDishItem(oi)) return;
      const rawName = String(oi.item_name || oi.name || '').trim();
      if (!rawName) return;
      const key = rawName.toLowerCase();

      let entry = itemMap.get(key);
      if (!entry) {
        // Try to match by ID
        if (oi.menu_item_id || oi.id) {
          const matchId = Number(oi.menu_item_id || oi.id);
          entry = Array.from(itemMap.values()).find(x => x.id === matchId);
        }
      }

      if (!entry) {
        // Clean combo prefix if present
        const cleanName = rawName.replace(/^🍱\s*\[combo\]\s*/i, '').trim().toLowerCase();
        entry = itemMap.get(cleanName);
      }

      if (!entry) {
        // Match with category in menuItems
        const isCombo = /combo|platter/i.test(rawName);
        let category = isCombo ? 'combo' : 'other';
        let image = isCombo ? '/images/food_biryani.png' : '/images/food_starters.png';

        const foundMenu = menuItems.find(m => m.name.toLowerCase() === key || m.name.toLowerCase().includes(key) || key.includes(m.name.toLowerCase()));
        if (foundMenu) {
          category = foundMenu.category || category;
          image = foundMenu.image || categoryImages[category] || image;
        }

        entry = {
          id: oi.menu_item_id || oi.id || null,
          name: rawName,
          category,
          price: Number(oi.unit_price || oi.price || 0),
          image,
          qtySold: 0,
          totalRevenue: 0,
          orderIds: new Set(),
          orderCount: 0
        };
        itemMap.set(key, entry);
      }

      const qty = Math.max(1, Number(oi.quantity || oi.qty || 1));
      const unitPrice = Number(oi.unit_price || oi.price || (oi.line_total ? Number(oi.line_total) / qty : entry.price));
      const lineTot = Number(oi.line_total !== undefined && oi.line_total !== null ? oi.line_total : (unitPrice * qty));

      entry.qtySold += qty;
      entry.totalRevenue += lineTot;
      if (!entry.orderIds) entry.orderIds = new Set();
      entry.orderIds.add(String(order.id));
      entry.orderCount = entry.orderIds.size;
      if (unitPrice > 0 && entry.price <= 0) entry.price = unitPrice;
    });
  });

  const allItems = Array.from(itemMap.values());
  const soldItems = allItems.filter(i => i.qtySold > 0);
  const totalQtySold = soldItems.reduce((s, i) => s + i.qtySold, 0);
  const totalItemRev = soldItems.reduce((s, i) => s + i.totalRevenue, 0);
  const activeVarieties = soldItems.length;

  let bestSellingDish = null;
  if (soldItems.length > 0) {
    bestSellingDish = soldItems.slice().sort((a, b) => b.totalRevenue - a.totalRevenue || b.qtySold - a.qtySold)[0];
  }

  // Filter based on Scope (Sold Items Only vs All Menu Dishes)
  let displayedItems = itemReportScopeFilter === 'sold' ? soldItems : allItems;

  // Category filter
  if (itemReportCategoryFilter !== 'all') {
    const matchCats = categoryAliases[itemReportCategoryFilter] || [itemReportCategoryFilter];
    displayedItems = displayedItems.filter(i => matchCats.includes(i.category));
  }

  // Search filter
  if (itemReportSearch) {
    const q = itemReportSearch.toLowerCase().trim();
    displayedItems = displayedItems.filter(i =>
      i.name.toLowerCase().includes(q) ||
      (categoryLabels[i.category] || i.category).toLowerCase().includes(q)
    );
  }

  // Sorting
  if (itemReportSort === 'revenue_desc') {
    displayedItems.sort((a, b) => b.totalRevenue - a.totalRevenue || b.qtySold - a.qtySold);
  } else if (itemReportSort === 'qty_desc') {
    displayedItems.sort((a, b) => b.qtySold - a.qtySold || b.totalRevenue - a.totalRevenue);
  } else if (itemReportSort === 'qty_asc') {
    displayedItems.sort((a, b) => a.qtySold - b.qtySold || a.totalRevenue - b.totalRevenue);
  } else if (itemReportSort === 'price_desc') {
    displayedItems.sort((a, b) => b.price - a.price);
  } else if (itemReportSort === 'name_asc') {
    displayedItems.sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    allItems: displayedItems,
    allCatalogItems: allItems,
    soldItems,
    totalQtySold,
    totalItemRev,
    activeVarieties,
    bestSellingDish
  };
}

function populateItemReportCategories() {
  const sel = $('item-report-category-filter');
  if (!sel || sel.children.length > 1) return;
  const cats = categoryTabOrder.filter(c => categoryLabels[c]);
  sel.innerHTML = '<option value="all">🍽️ All Categories</option>' +
    cats.map(cat => {
      const emoji = categoryEmojis[cat] || '🍽️';
      const label = categoryLabels[cat] || cat;
      return `<option value="${cat}">${emoji} ${label}</option>`;
    }).join('');
}

function renderItemReportCharts(soldItems) {
  // Only render charts if the panel is currently active/visible in DOM
  const panel = $('panel-customer-analysis');
  if (!panel || !panel.classList.contains('active')) return;

  // Chart 1: Top 10 Best Sellers
  const canvasTop = $('chart-item-top-sellers');
  if (canvasTop) {
    const top10 = soldItems.slice().sort((a, b) => b.qtySold - a.qtySold || b.totalRevenue - a.totalRevenue).slice(0, 10);
    const labels = top10.map(i => i.name.length > 18 ? i.name.slice(0, 16) + '…' : i.name);
    const data = top10.map(i => i.qtySold);

    if (itemTopSellersChartInstance) {
      itemTopSellersChartInstance.destroy();
      itemTopSellersChartInstance = null;
    }

    itemTopSellersChartInstance = new Chart(canvasTop, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['No Sales In Period'],
        datasets: [{
          label: 'Units Sold',
          data: data.length ? data : [0],
          backgroundColor: '#6366f1',
          borderRadius: 6,
          maxBarThickness: 24
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.raw} units sold`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { stepSize: 1, font: { size: 10 } } }
        }
      }
    });
  }

  // Chart 2: Category Revenue Split
  const canvasCat = $('chart-item-category-split');
  if (canvasCat) {
    const catMap = new Map();
    soldItems.forEach(i => {
      const cat = i.category || 'other';
      const label = (categoryEmojis[cat] || '🍽️') + ' ' + (categoryLabels[cat] || cat);
      catMap.set(label, (catMap.get(label) || 0) + i.totalRevenue);
    });

    const labels = Array.from(catMap.keys());
    const data = Array.from(catMap.values());
    const colors = [
      '#6366f1', '#10b981', '#f59e0b', '#06b6d4', '#ec4899',
      '#8b5cf6', '#3b82f6', '#14b8a6', '#f97316', '#ef4444',
      '#84cc16', '#a855f7', '#0ea5e9', '#d946ef', '#f43f5e'
    ];

    if (itemCategorySplitChartInstance) {
      itemCategorySplitChartInstance.destroy();
      itemCategorySplitChartInstance = null;
    }

    itemCategorySplitChartInstance = new Chart(canvasCat, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['No Sales In Period'],
        datasets: [{
          data: data.length ? data : [1],
          backgroundColor: data.length ? colors.slice(0, labels.length) : ['#e2e8f0'],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => data.length ? ` ₹${Number(ctx.raw || 0).toFixed(0)}` : ' No sales in this period'
            }
          }
        },
        cutout: '65%'
      }
    });
  }
}

function renderItemsReport() {
  populateItemReportCategories();
  const { allItems, soldItems, totalQtySold, totalItemRev, activeVarieties, bestSellingDish } = computeItemSalesReport();

  // 1. KPI Cards
  if ($('item-kpi-total-qty')) $('item-kpi-total-qty').textContent = `${totalQtySold} qty`;
  if ($('item-kpi-total-rev')) $('item-kpi-total-rev').textContent = `₹${totalItemRev.toFixed(2)}`;
  
  if ($('item-kpi-top-dish')) {
    $('item-kpi-top-dish').textContent = bestSellingDish ? bestSellingDish.name : '—';
    $('item-kpi-top-dish').title = bestSellingDish ? bestSellingDish.name : '';
  }
  if ($('item-kpi-top-dish-meta')) {
    $('item-kpi-top-dish-meta').textContent = bestSellingDish
      ? `${bestSellingDish.qtySold} sold (₹${bestSellingDish.totalRevenue.toFixed(0)})`
      : '0 sold (₹0)';
  }

  if ($('item-kpi-varieties')) $('item-kpi-varieties').textContent = `${activeVarieties} Varieties`;

  // 2. Charts (only renders when visible)
  renderItemReportCharts(soldItems);

  // 3. Summary Bar
  if ($('item-report-count')) {
    if (itemReportScopeFilter === 'sold') {
      $('item-report-count').textContent = `${allItems.length} ${allItems.length === 1 ? 'dish sold' : 'dishes sold'}`;
    } else {
      $('item-report-count').textContent = `${soldItems.length} sold / ${allItems.length} dishes`;
    }
  }
  const totalUnitsFiltered = allItems.reduce((s, i) => s + i.qtySold, 0);
  const totalRevFiltered = allItems.reduce((s, i) => s + i.totalRevenue, 0);
  if ($('item-report-units')) $('item-report-units').textContent = `${totalUnitsFiltered} qty`;
  if ($('item-report-amount')) $('item-report-amount').textContent = `₹${totalRevFiltered.toFixed(2)}`;

  // 4. Data Table
  const tbody = $('item-report-table-body');
  if (!tbody) return;

  if (!allItems.length) {
    const emptyMsg = itemReportScopeFilter === 'sold'
      ? '🍽️ No dishes were sold matching your selected criteria in this period.'
      : 'No dishes match your selected filter criteria.';
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2.5rem;color:var(--adm-muted);font-weight:500;">${emptyMsg}</td></tr>`;
    return;
  }

  tbody.innerHTML = allItems.map(item => {
    const share = totalItemRev > 0 ? ((item.totalRevenue / totalItemRev) * 100) : 0;
    const catLabel = (categoryEmojis[item.category] || '🍽️') + ' ' + (categoryLabels[item.category] || item.category);

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:.75rem;">
            <img src="${item.image}" alt="${escapeHtml(item.name)}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;background:#f1f5f9;" onerror="this.src='/images/food_starters.png'" loading="lazy" />
            <div>
              <strong style="font-size:.88rem;color:#111827;">${escapeHtml(item.name)}</strong>
              <div style="font-size:0.75rem;color:var(--adm-muted);">${item.orderCount ? `Ordered in ${item.orderCount} ${item.orderCount === 1 ? 'bill' : 'bills'}` : 'Not ordered in this period'}</div>
            </div>
          </div>
        </td>
        <td>
          <span style="font-size:.75rem;font-weight:600;color:#4f46e5;background:#eef2ff;padding:.2rem .55rem;border-radius:999px;">${catLabel}</span>
        </td>
        <td style="text-align:right;font-weight:600;font-size:.85rem;">₹${item.price.toFixed(2)}</td>
        <td style="text-align:center;">
          <span style="font-size:.9rem;font-weight:800;color:${item.qtySold > 0 ? '#111827' : '#9ca3af'};">${item.qtySold}</span>
        </td>
        <td style="text-align:right;">
          <strong style="font-size:.9rem;color:${item.totalRevenue > 0 ? '#059669' : '#9ca3af'};">₹${item.totalRevenue.toFixed(2)}</strong>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:.5rem;">
            <div style="flex:1;height:7px;background:#e2e8f0;border-radius:999px;overflow:hidden;">
              <div style="width:${Math.min(100, Math.max(0, share))}%;height:100%;background:#10b981;border-radius:999px;"></div>
            </div>
            <span style="font-size:0.75rem;font-weight:700;color:#374151;min-width:38px;text-align:right;">${share.toFixed(1)}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Alias for backwards compatibility
function renderCustomerAnalysis() {
  renderItemsReport();
}

function exportItemsReportCSV() {
  const { allItems, totalItemRev } = computeItemSalesReport();
  if (!allItems.length) {
    showAdminToast('No item data to export.', 'error');
    return;
  }

  const headers = ['Dish Name', 'Category', 'Unit Price (INR)', 'Units Sold', 'Total Revenue (INR)', 'Revenue Contribution (%)', 'Bills Count'];
  const rows = allItems.map(i => {
    const share = totalItemRev > 0 ? ((i.totalRevenue / totalItemRev) * 100).toFixed(1) : '0.0';
    const catLabel = categoryLabels[i.category] || i.category;
    return [
      `"${i.name.replace(/"/g, '""')}"`,
      `"${catLabel.replace(/"/g, '""')}"`,
      `"${i.price.toFixed(2)}"`,
      `"${i.qtySold}"`,
      `"${i.totalRevenue.toFixed(2)}"`,
      `"${share}%"`,
      `"${i.orderCount || 0}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `LIMRA_Items_Sales_Report_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAdminToast('Items sales report exported to Excel CSV! 📥', 'success');
}

function initItemsReportListeners() {
  // Date Preset Buttons
  $('item-report-date-presets')?.querySelectorAll('.pos-cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      $('item-report-date-presets').querySelectorAll('.pos-cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      itemReportDateFilter = btn.dataset.range;
      const customWrap = $('item-report-custom-date-wrap');
      if (customWrap) customWrap.style.display = itemReportDateFilter === 'custom' ? 'flex' : 'none';
      if (itemReportDateFilter !== 'custom') renderItemsReport();
    });
  });

  // Custom Date Apply
  $('item-report-apply-custom-date')?.addEventListener('click', () => {
    itemReportCustomStart = $('item-report-start-date')?.value || null;
    itemReportCustomEnd = $('item-report-end-date')?.value || null;
    renderItemsReport();
  });

  // Scope Filter (Sold Only vs All Dishes)
  $('item-report-scope-filter')?.addEventListener('change', (e) => {
    itemReportScopeFilter = e.target.value;
    renderItemsReport();
  });

  // Filters & Search
  $('item-report-category-filter')?.addEventListener('change', (e) => {
    itemReportCategoryFilter = e.target.value;
    renderItemsReport();
  });

  $('item-report-type-filter')?.addEventListener('change', (e) => {
    itemReportTypeFilter = e.target.value;
    renderItemsReport();
  });

  $('item-report-sort-filter')?.addEventListener('change', (e) => {
    itemReportSort = e.target.value;
    renderItemsReport();
  });

  $('item-report-search')?.addEventListener('input', (e) => {
    itemReportSearch = e.target.value;
    renderItemsReport();
  });

  $('items-report-export-btn')?.addEventListener('click', exportItemsReportCSV);
}

// ── Bookings ────────────────────────────────────────────

function renderBookingCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  $('calendar-title').textContent = `${now.toLocaleString('en-IN', { month: 'long' })} ${year} — Schedule`;

  let html = DAYS.map(d => `<div class="adm-cal-head">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += '<div class="adm-cal-day"></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayBookings = bookings.filter(b => (b.booking_date || '').startsWith(dateStr));
    const isToday = day === now.getDate();
    html += `<div class="adm-cal-day${isToday ? ' today' : ''}">
      <div class="adm-cal-num">${day}</div>
      ${dayBookings.slice(0, 3).map(b => `
        <div class="adm-cal-event ${b.type}" title="${b.customer_name}">${b.customer_name.split(' ')[0]} · ${b.type}</div>
      `).join('')}
      ${dayBookings.length > 3 ? `<div class="adm-cal-event">+${dayBookings.length - 3} more</div>` : ''}
    </div>`;
  }

  $('booking-calendar').innerHTML = `<div class="adm-calendar">${html}</div>`;
}

function renderBookingsList() {
  const typeFilter = $('bookings-type-filter')?.value || 'all';
  const statusFilter = $('bookings-status-filter')?.value || 'all';
  let filtered = [...bookings];
  if (typeFilter !== 'all') filtered = filtered.filter(b => b.type === typeFilter);
  if (statusFilter !== 'all') filtered = filtered.filter(b => b.status === statusFilter);

  const el = $('bookings-list');
  if (filtered.length === 0) {
    el.innerHTML = '<div class="adm-card adm-empty">No bookings found</div>';
    return;
  }

  el.innerHTML = filtered.map(b => {
    const meta = parseNotesMetadata(b.notes || b.message);
    const statusOptions = BOOKING_STATUSES.map(s =>
      `<option value="${s}" ${s === b.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`
    ).join('');
    const typeLabel = { table: '🪑 Table', party: '🎉 Party', wedding: '💍 Wedding' }[b.type] || b.type;

    const digits = b.customer_phone.replace(/\D/g, '');
    const formattedPhone = digits.length === 10 ? '91' : '';
    const whatsappPhone = formattedPhone + digits;
    const bookingStatusText = STATUS_LABEL[b.status] || b.status;
    const whatsappMsg = `Hi ${b.customer_name}, your LIMRA booking #${b.booking_number} for ${typeLabel} is currently ${bookingStatusText}. We look forward to hosting you!`;
    const whatsappLink = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(whatsappMsg)}`;

    const emailSubject = `LIMRA Restaurant - Booking #${b.booking_number} Confirmation`;
    const emailBody = `Hi ${b.customer_name},\n\nThank you for booking with LIMRA! Your ${typeLabel} booking #${b.booking_number} is currently ${bookingStatusText}.\n\nDate: ${b.booking_date || '—'}\nTime: ${b.booking_time || '—'}\nGuests: ${b.guests || '—'}\n\nWe look forward to welcoming you!\n\nWarm regards,\nLIMRA Restaurant Team`;
    const emailLink = meta.email ? `mailto:${meta.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}` : '#';

    return `
      <div class="adm-card">
        <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <p class="font-bold">Booking #${b.booking_number} · ${typeLabel}</p>
            <p class="text-sm" style="color:var(--adm-muted)">${b.customer_name} · ${b.customer_phone}</p>
            ${meta.email ? `<span class="adm-email-badge" style="margin-bottom:0.35rem">${escapeHtml(meta.email)}</span>` : ''}
            <p class="text-sm">${b.booking_date || '—'} ${b.booking_time || ''} · ${b.guests || '?'} guests</p>
          </div>
          <div class="flex items-center gap-2">
            ${statusPill(b.status)}
            <select class="adm-select adm-btn-sm booking-status-select" data-booking-id="${b.id}">${statusOptions}</select>
          </div>
        </div>
        ${b.seat_label ? `<p class="text-sm">Seat: <strong>${b.seat_label}</strong> · ${b.preference || ''}</p>` : ''}
        ${b.message ? `<p class="text-sm mt-2 p-2 rounded-lg" style="background:#f8faf9">${b.message}</p>` : ''}
        
        <div class="adm-comm-grid" style="margin-top:0.75rem; max-width: 320px;">
          <a href="${whatsappLink}" target="_blank" class="adm-comm-btn whatsapp">
            💬 WhatsApp
          </a>
          <a href="${meta.email ? emailLink : '#'}" class="adm-comm-btn email ${!meta.email ? 'adm-comm-disabled' : ''}" id="booking-email-${b.id}">
            ✉️ Email
          </a>
          <a href="tel:${b.customer_phone}" class="adm-comm-btn call">
            📞 Call
          </a>
        </div>
      </div>
    `;
  }).join('');

  filtered.forEach(b => {
    const meta = parseNotesMetadata(b.notes || b.message);
    if (!meta.email) {
      el.querySelector(`#booking-email-${b.id}`)?.addEventListener('click', (e) => {
        e.preventDefault();
        alert('No email address provided by this customer.');
      });
    }
  });

  el.querySelectorAll('.booking-status-select').forEach(select => {
    select.addEventListener('change', async e => {
      const id = e.target.dataset.bookingId;
      const { error } = await insforge.database.from('bookings').update({ status: e.target.value }).eq('id', id);
      if (error) { alert('Failed: ' + error.message); return; }
      const b = bookings.find(x => x.id === id);
      if (b) b.status = e.target.value;
      renderOverview();
      renderBookingCalendar();
    });
  });
}

// ── Foods ───────────────────────────────────────────────

// ════════════════════════════════════════════════════════
// 🍽️ FOOD MENU MANAGEMENT ENGINE
// ════════════════════════════════════════════════════════

let activeMenuOverrides = [];
let foodMenuCategoryFilter = 'all';
let foodMenuAvailabilityFilter = 'all';
let foodMenuSort = 'default';
let foodMenuSearch = '';
let customCreatedFoods = [];

export function isComboActiveAndValid(c, now = new Date()) {
  if (!c || typeof c !== 'object') return false;
  if (c.available === false || c.active === false) return false;
  const price = parseFloat(c.price || 0);
  if (isNaN(price) || price <= 0) return false;
  const expRaw = c.expiry_date || c.valid_until || c.expires_at;
  if (expRaw) {
    const expDate = new Date(expRaw);
    if (!isNaN(expDate.getTime()) && expDate < now) return false;
  }
  return true;
}
window.isComboActiveAndValid = isComboActiveAndValid;

function getCombinedFoodItems() {
  const formattedCombos = (adminCombos || []).filter(c => isComboActiveAndValid(c)).map(c => {
    const comboItems = Array.isArray(c.items) ? c.items : [];
    const comboItemsSummary = comboItems.length > 0
      ? comboItems.map(i => `${i.qty || 1}× ${i.name}`).join(' + ')
      : '';
    return {
      id: `combo-${c.id}`,
      name: c.name,
      price: parseFloat(c.price || 0),
      mrp: parseFloat(c.mrp || 0),
      category: 'combo',
      emoji: '🍱',
      image: c.image_url || c.image || '/images/food_biryani.png',
      description: c.description || comboItemsSummary || 'Special Combo Deal',
      comboItems,
      comboItemsSummary,
      isCombo: true,
      is_combo: true,
      combo_id: c.id,
      available: true,
      gst_applicable: c.gst_applicable !== false
    };
  });

  let customList = customCreatedFoods;
  if (!customList || customList.length === 0) {
    try {
      customList = JSON.parse(localStorage.getItem('limra_custom_foods') || '[]');
      if (Array.isArray(customList) && customList.length > 0) {
        customCreatedFoods = customList;
      }
    } catch (e) {}
  }

  const combined = [...formattedCombos, ...menuItems, ...(customList || [])];
  const items = [];

  for (const item of combined) {
    const override = activeMenuOverrides.find(o => String(o.id) === String(item.id));
    
    // Check if soft-deleted / archived
    const isDeleted = (item.is_deleted === true) || (override && (override.is_deleted === true || (typeof override.description === 'string' && override.description.includes('[DELETED]'))));
    if (isDeleted) {
      continue; // Exclude deleted dishes from active menus
    }

    const isOverrideNoGst = override && typeof override.description === 'string' && override.description.includes('[NO_GST]');
    const gstApp = override && override.gst_applicable !== undefined
      ? override.gst_applicable
      : (isOverrideNoGst ? false : (item.gst_applicable !== false));

    if (override) {
      const isVeg = override.diet ? (override.diet === 'veg') : (item.is_veg !== false && (item.diet === 'veg' || (item.category && item.category.includes('veg'))));
      items.push({
        ...item,
        name: override.name || item.name,
        category: override.category || item.category,
        diet: override.diet || item.diet || (isVeg ? 'veg' : 'nonveg'),
        is_veg: isVeg,
        price: override.price !== null && override.price !== undefined ? parseFloat(override.price) : item.price,
        mrp: override.mrp !== null && override.mrp !== undefined ? parseFloat(override.mrp) : item.mrp,
        available: override.available !== undefined ? override.available : (item.available !== false),
        featured: override.featured !== undefined ? override.featured : (item.featured || false),
        image: override.image || item.image,
        description: override.description !== undefined ? override.description : (item.description || ''),
        gst_applicable: gstApp,
        is_deleted: false
      });
    } else {
      items.push({
        ...item,
        available: item.available !== false,
        featured: item.featured || false,
        description: item.description || '',
        gst_applicable: item.gst_applicable !== false,
        is_deleted: false
      });
    }
  }

  return items;
}

function initFoodsFilters() {
  const bar = $('foods-category-pills');
  if (!bar) return;

  const allItems = getCombinedFoodItems();
  const totalCount = allItems.length;

  const availableCats = new Set(allItems.map(f => f.category).filter(Boolean));
  const orderedCats = categoryTabOrder.filter(c => availableCats.has(c));

  const cats = [
    { key: 'all', label: '🍽️ All Dishes', count: totalCount },
    ...orderedCats.map(key => {
      const emoji = categoryEmojis[key] || '🍲';
      const label = categoryLabels[key] || key;
      const count = allItems.filter(m => m.category === key).length;
      return { key, label: `${emoji} ${label}`, count };
    })
  ];

  bar.innerHTML = cats.map(c => `
    <button type="button" class="pos-cat-pill ${foodMenuCategoryFilter === c.key ? 'active' : ''}" data-cat="${c.key}">
      ${c.label} (${c.count})
    </button>
  `).join('');

  bar.querySelectorAll('.pos-cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.pos-cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      foodMenuCategoryFilter = btn.dataset.cat;
      renderFoods();
    });
  });
}

async function loadAndRenderFoods() {
  try {
    const grid = $('foods-grid');
    if (grid && (!customCreatedFoods || customCreatedFoods.length === 0)) {
      grid.innerHTML = '<div class="adm-empty col-span-full" style="padding:2.5rem;text-align:center;">Loading menu items & database dishes...</div>';
    }
    const [overrides, dbCustomDishes] = await Promise.all([
      getMenuOverrides().catch(err => { console.warn("Failed overrides:", err); return []; }),
      getCustomDishes().catch(err => { console.warn("Failed custom dishes:", err); return []; })
    ]);
    
    if (Array.isArray(overrides)) activeMenuOverrides = overrides;
    if (Array.isArray(dbCustomDishes)) customCreatedFoods = dbCustomDishes;
  } catch (e) {
    console.error("Failed to load menu data:", e);
  }
  initFoodsFilters();
  renderFoods();
}

function renderFoods() {
  let allItems = getCombinedFoodItems();

  // 1. Executive KPI Metrics across full menu
  const totalDishes = allItems.length;
  const inStockCount = allItems.filter(i => i.available !== false).length;
  const outOfStockCount = allItems.filter(i => i.available === false).length;
  const featuredCount = allItems.filter(i => i.featured === true).length;
  const uniqueCategories = new Set(allItems.map(i => i.category)).size;

  if ($('food-kpi-total')) $('food-kpi-total').textContent = `${totalDishes}`;
  if ($('food-kpi-instock')) $('food-kpi-instock').textContent = `${inStockCount}`;
  if ($('food-kpi-outstock')) $('food-kpi-outstock').textContent = `${outOfStockCount}`;
  if ($('food-kpi-featured')) $('food-kpi-featured').textContent = `${featuredCount}`;
  if ($('food-kpi-categories')) $('food-kpi-categories').textContent = `${uniqueCategories}`;

  // 2. Filter by Category
  let items = allItems.slice();
  if (foodMenuCategoryFilter !== 'all') {
    const matchCats = categoryAliases[foodMenuCategoryFilter] || [foodMenuCategoryFilter];
    items = items.filter(m => matchCats.includes(m.category));
  }

  // 3. Filter by Availability
  if (foodMenuAvailabilityFilter === 'instock') {
    items = items.filter(m => m.available !== false);
  } else if (foodMenuAvailabilityFilter === 'outstock') {
    items = items.filter(m => m.available === false);
  } else if (foodMenuAvailabilityFilter === 'featured') {
    items = items.filter(m => m.featured === true);
  }

  // 4. Filter by Search
  const search = ($('foods-search')?.value || foodMenuSearch || '').toLowerCase().trim();
  if (search) {
    items = items.filter(m =>
      m.name.toLowerCase().includes(search) ||
      (categoryLabels[m.category] || m.category).toLowerCase().includes(search) ||
      (m.description && m.description.toLowerCase().includes(search))
    );
  }

  // 5. Sorting
  if (foodMenuSort === 'price_desc') {
    items.sort((a, b) => b.price - a.price);
  } else if (foodMenuSort === 'price_asc') {
    items.sort((a, b) => a.price - b.price);
  } else if (foodMenuSort === 'name_asc') {
    items.sort((a, b) => a.name.localeCompare(b.name));
  } else if (foodMenuSort === 'featured_first') {
    items.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  }

  // 6. Summary Bar
  if ($('foods-count-label')) $('foods-count-label').textContent = `${items.length} ${items.length === 1 ? 'dish' : 'dishes'}`;
  const catLabel = foodMenuCategoryFilter === 'all' ? 'All Categories' : (categoryLabels[foodMenuCategoryFilter] || foodMenuCategoryFilter);
  if ($('foods-active-cat-label')) $('foods-active-cat-label').textContent = catLabel;

  // 7. Render Food Grid Cards
  const grid = $('foods-grid');
  if (!grid) return;

  if (items.length === 0) {
    grid.innerHTML = '<div class="adm-card adm-empty" style="grid-column: 1 / -1;padding:2.5rem;text-align:center;">No menu dishes match your search or filter.</div>';
    return;
  }

  grid.innerHTML = items.map(item => {
    const isCustom = item.is_custom === true || String(item.id).startsWith('custom_');
    const img = item.image || (item.category ? categoryImages[item.category] : null);
    const isAvailable = item.available !== false;
    const isFeatured = item.featured === true;
    const catName = categoryLabels[item.category] || item.category || 'General';
    const dietIcon = item.is_veg || item.diet === 'veg' ? '🟢 Veg' : '🍗 Non-Veg';

    return `
      <div class="adm-card adm-food-card ${isAvailable ? '' : 'adm-food-card-disabled'}" data-item-id="${item.id}" style="display:flex;flex-direction:column;padding:0;overflow:hidden;border-radius:14px;border:1px solid var(--adm-border);background:#fff;transition:box-shadow .2s;box-shadow:0 1px 3px rgba(0,0,0,.04);">
        
        <!-- Image & Badges -->
        <div style="position:relative;width:100%;height:150px;background:#f1f5f9;overflow:hidden;">
          ${img
            ? `<img src="${img}" alt="${escapeHtml(item.name)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='/images/food_starters.png'" />`
            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:3.5rem;">${item.emoji || '🍽️'}</div>`}
          
          <div style="position:absolute;top:8px;left:8px;display:flex;gap:4px;flex-wrap:wrap;">
            <span style="background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);color:#fff;font-size:0.75rem;font-weight:700;padding:.15rem .45rem;border-radius:6px;">
              ${dietIcon}
            </span>
            ${item.gst_applicable === false ? '<span style="background:#0284c7;color:#fff;font-size:0.75rem;font-weight:800;padding:.15rem .45rem;border-radius:6px;">🧾 No GST</span>' : '<span style="background:rgba(16,185,129,0.85);color:#fff;font-size:0.75rem;font-weight:700;padding:.15rem .45rem;border-radius:6px;">🧾 5% GST</span>'}
            ${isFeatured ? '<span style="background:#f59e0b;color:#fff;font-size:0.75rem;font-weight:800;padding:.15rem .45rem;border-radius:6px;">⭐ Special</span>' : ''}
            ${isCustom ? '<span style="background:#6366f1;color:#fff;font-size:0.75rem;font-weight:800;padding:.15rem .45rem;border-radius:6px;">✨ Custom Dish</span>' : ''}
          </div>

          <div style="position:absolute;top:8px;right:8px;">
            <span style="background:${isAvailable ? '#10b981' : '#ef4444'};color:#fff;font-size:0.75rem;font-weight:800;padding:.15rem .5rem;border-radius:6px;">
              ${isAvailable ? 'In Stock' : 'Out of Stock'}
            </span>
          </div>
        </div>

        <!-- Info Body -->
        <div style="padding:1rem;display:flex;flex-direction:column;gap:.4rem;flex:1;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">
            <strong style="font-size:.95rem;color:#111827;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
              ${escapeHtml(item.name)}
            </strong>
          </div>
          
          <span style="font-size:.75rem;color:var(--adm-muted);font-weight:600;">
            ${escapeHtml(catName)}
          </span>

          <div style="display:flex;align-items:baseline;gap:.5rem;margin-top:2px;">
            <strong style="font-size:1.15rem;color:#059669;font-weight:800;">₹${Number(item.price).toFixed(2)}</strong>
            ${item.mrp ? `<span style="font-size:.82rem;color:#9ca3af;text-decoration:line-through;">₹${Number(item.mrp).toFixed(2)}</span>` : ''}
          </div>

          ${item.description ? `<p style="font-size:.78rem;color:#6b7280;margin:0;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(item.description)}</p>` : ''}
          
          <!-- Controls Footer -->
          <div style="margin-top:auto;padding-top:.75rem;border-top:1px solid #f1f5f9;display:flex;flex-direction:column;gap:.5rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <label class="adm-toggle-label" style="font-size:.75rem;">
                <input type="checkbox" class="adm-toggle-available" ${isAvailable ? 'checked' : ''} />
                <span class="adm-toggle-slider"></span>
                <span class="adm-toggle-text">${isAvailable ? 'In Stock' : 'Out of Stock'}</span>
              </label>

              <label class="adm-toggle-label" style="font-size:.75rem;">
                <input type="checkbox" class="adm-toggle-featured" ${isFeatured ? 'checked' : ''} />
                <span class="adm-toggle-slider"></span>
                <span class="adm-toggle-text">⭐ Special</span>
              </label>
            </div>

            <div style="display:flex;gap:.4rem;width:100%;">
              <button type="button" class="adm-btn adm-btn-outline adm-btn-sm adm-food-btn-edit" style="flex:1;font-size:.78rem;padding:.3rem;justify-content:center;" title="Edit dish details, price, name, and photo">
                ✏️ Edit Dish
              </button>
              <button type="button" class="adm-btn adm-btn-outline adm-btn-sm adm-food-btn-delete" style="color:#ef4444;border-color:#fecaca;padding:.3rem .55rem;font-size:.78rem;" title="Delete dish from menu">
                🗑️
              </button>
            </div>
          </div>

        </div>

      </div>
    `;
  }).join('');

  setupFoodControlListeners();
}

function setupFoodControlListeners() {
  const grid = $('foods-grid');
  if (!grid) return;

  // 1. Availability Toggle
  grid.querySelectorAll('.adm-toggle-available').forEach(cb => {
    cb.addEventListener('change', async () => {
      const card = cb.closest('.adm-food-card');
      const itemId = card.dataset.itemId;
      const isChecked = cb.checked;
      
      if (isChecked) card.classList.remove('adm-food-card-disabled');
      else card.classList.add('adm-food-card-disabled');

      try {
        const isCustomDish = String(itemId).startsWith('custom_');
        if (isCustomDish) {
          const customDish = customCreatedFoods.find(d => String(d.id) === String(itemId));
          if (customDish) {
            customDish.available = isChecked;
            await saveCustomDish(customDish);
            try { localStorage.setItem('limra_custom_foods', JSON.stringify(customCreatedFoods)); } catch {}
          }
        } else {
          let override = activeMenuOverrides.find(o => String(o.id) === String(itemId));
          if (!override) {
            const all = getCombinedFoodItems();
            const staticItem = all.find(m => String(m.id) === String(itemId));
            override = {
              id: itemId,
              name: staticItem ? staticItem.name : undefined,
              category: staticItem ? staticItem.category : undefined,
              diet: staticItem ? staticItem.diet : undefined,
              price: staticItem ? staticItem.price : 0,
              mrp: staticItem ? staticItem.mrp || null : null,
              available: isChecked,
              featured: staticItem ? staticItem.featured || false : false,
              description: staticItem ? staticItem.description || '' : ''
            };
            activeMenuOverrides.push(override);
          } else {
            override.available = isChecked;
          }
          await saveMenuOverride(override);
        }

        showAdminToast(`Item availability updated: ${isChecked ? 'In Stock ✅' : 'Out of Stock 🚫'}`, 'success');
        renderFoods();
        if (typeof isGoogleSheetAutoSyncEnabled === 'function' && isGoogleSheetAutoSyncEnabled()) {
          syncFoodMenuToGoogleSheet().catch(e => console.warn('[AutoSync] Menu sync err:', e));
        }
      } catch (err) {
        showAdminToast('Failed to update availability: ' + err.message, 'error');
        cb.checked = !isChecked;
      }
    });
  });

  // 2. Featured / Special Toggle
  grid.querySelectorAll('.adm-toggle-featured').forEach(cb => {
    cb.addEventListener('change', async () => {
      const card = cb.closest('.adm-food-card');
      const itemId = card.dataset.itemId;
      const isChecked = cb.checked;

      try {
        const isCustomDish = String(itemId).startsWith('custom_');
        if (isCustomDish) {
          const customDish = customCreatedFoods.find(d => String(d.id) === String(itemId));
          if (customDish) {
            customDish.featured = isChecked;
            await saveCustomDish(customDish);
            try { localStorage.setItem('limra_custom_foods', JSON.stringify(customCreatedFoods)); } catch {}
          }
        } else {
          let override = activeMenuOverrides.find(o => String(o.id) === String(itemId));
          if (!override) {
            const all = getCombinedFoodItems();
            const staticItem = all.find(m => String(m.id) === String(itemId));
            override = {
              id: itemId,
              name: staticItem ? staticItem.name : undefined,
              category: staticItem ? staticItem.category : undefined,
              diet: staticItem ? staticItem.diet : undefined,
              price: staticItem ? staticItem.price : 0,
              mrp: staticItem ? staticItem.mrp || null : null,
              available: staticItem ? staticItem.available !== false : true,
              featured: isChecked,
              description: staticItem ? staticItem.description || '' : ''
            };
            activeMenuOverrides.push(override);
          } else {
            override.featured = isChecked;
          }
          await saveMenuOverride(override);
        }

        showAdminToast(`Item featured status updated: ${isChecked ? '⭐ Special' : 'Standard'}`, 'success');
        renderFoods();
        if (typeof isGoogleSheetAutoSyncEnabled === 'function' && isGoogleSheetAutoSyncEnabled()) {
          syncFoodMenuToGoogleSheet().catch(e => console.warn('[AutoSync] Menu sync err:', e));
        }
      } catch (err) {
        showAdminToast('Failed to update featured status: ' + err.message, 'error');
        cb.checked = !isChecked;
      }
    });
  });

  // 3. Edit Button (Populate all editable attributes: Name, Price, Category, Diet, Photo, Description, Stock, GST)
  grid.querySelectorAll('.adm-food-btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.adm-food-card');
      const itemId = card.dataset.itemId;
      
      const all = getCombinedFoodItems();
      const item = all.find(m => String(m.id) === String(itemId));
      if (!item) return;

      if ($('edit-modal-item-id')) $('edit-modal-item-id').value = item.id;
      if ($('edit-modal-item-name')) $('edit-modal-item-name').textContent = `✏️ Edit Dish: ${item.name}`;
      if ($('edit-modal-item-name-input')) $('edit-modal-item-name-input').value = item.name || '';
      if ($('edit-modal-item-category')) $('edit-modal-item-category').value = item.category || 'biryani';
      if ($('edit-modal-item-diet')) $('edit-modal-item-diet').value = item.diet || (item.is_veg ? 'veg' : 'nonveg');
      if ($('edit-modal-item-price')) $('edit-modal-item-price').value = item.price;
      if ($('edit-modal-item-mrp')) $('edit-modal-item-mrp').value = item.mrp || '';
      if ($('edit-modal-item-desc')) $('edit-modal-item-desc').value = item.description || '';
      if ($('edit-modal-available')) $('edit-modal-available').checked = item.available !== false;
      if ($('edit-modal-featured')) $('edit-modal-featured').checked = item.featured === true;
      if ($('edit-modal-gst')) $('edit-modal-gst').checked = item.gst_applicable !== false;

      // Set existing image into photo upload component
      if (editPhotoUpload) {
        editPhotoUpload.setExistingImage(item.image || null);
      }

      $('adm-edit-modal').classList.add('active');
    });
  });

  // 4. Delete Dish Button (Available for ALL dishes: Custom & Base)
  grid.querySelectorAll('.adm-food-btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.adm-food-card');
      const itemId = card.dataset.itemId;
      const all = getCombinedFoodItems();
      const item = all.find(m => String(m.id) === String(itemId));
      if (!item) return;

      const confirmed = window.confirm(
        `Are you sure you want to delete "${item.name}" from the active menu?\n\n` +
        `This dish will be removed from POS billing, Table QR ordering, and customer storefront.\n` +
        `(Past invoices and historical sales reports remain safe and unchanged).`
      );
      if (!confirmed) return;

      try {
        btn.disabled = true;
        btn.textContent = '...';

        const isCustomDish = String(itemId).startsWith('custom_') || item.is_custom === true;
        if (isCustomDish) {
          await deleteCustomDish(item.db_id || item.id);
          customCreatedFoods = customCreatedFoods.filter(d => String(d.id) !== String(itemId) && String(d.db_id) !== String(item.db_id));
          try { localStorage.setItem('limra_custom_foods', JSON.stringify(customCreatedFoods)); } catch {}
        } else {
          // Soft-delete / archive base menu item via menu_overrides
          let override = activeMenuOverrides.find(o => String(o.id) === String(itemId));
          if (!override) {
            override = {
              id: itemId,
              name: item.name,
              category: item.category,
              diet: item.diet,
              price: item.price,
              mrp: item.mrp || null,
              available: false,
              featured: false,
              is_deleted: true,
              description: item.description || ''
            };
            activeMenuOverrides.push(override);
          } else {
            override.is_deleted = true;
            override.available = false;
          }
          await saveMenuOverride(override);
        }

        showAdminToast(`Dish "${item.name}" deleted from menu! 🗑️✅`, 'success');
        initFoodsFilters();
        renderFoods();
        if (typeof isGoogleSheetAutoSyncEnabled === 'function' && isGoogleSheetAutoSyncEnabled()) {
          syncFoodMenuToGoogleSheet().catch(e => console.warn('[AutoSync] Menu sync err:', e));
        }
      } catch (err) {
        showAdminToast('Failed to delete dish: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '🗑️';
      }
    });
  });
}

/**
 * Dish Photo Upload & Compression Component Controller
 */
function setupDishPhotoUploadUI({
  fileInputId,
  dropzoneId,
  previewWrapId,
  previewImgId,
  statusId,
  sizeBadgeId,
  replaceBtnId,
  removeBtnId,
  hiddenInputId,
  urlInputId
}) {
  const fileInput = $(fileInputId);
  const dropzone = $(dropzoneId);
  const previewWrap = $(previewWrapId);
  const previewImg = $(previewImgId);
  const statusEl = $(statusId);
  const sizeBadge = $(sizeBadgeId);
  const replaceBtn = $(replaceBtnId);
  const removeBtn = $(removeBtnId);
  const hiddenInput = $(hiddenInputId);
  const urlInput = $(urlInputId);

  let pendingFile = null;
  let pendingDataUrl = null;

  const showPreview = (src, sizeText, statusText) => {
    if (previewImg) previewImg.src = src;
    if (sizeBadge) sizeBadge.textContent = sizeText || 'Image selected';
    if (statusEl) statusEl.textContent = statusText || 'Ready';
    if (dropzone) dropzone.style.display = 'none';
    if (previewWrap) previewWrap.style.display = 'flex';
  };

  const clearPhoto = () => {
    pendingFile = null;
    pendingDataUrl = null;
    if (fileInput) fileInput.value = '';
    if (hiddenInput) hiddenInput.value = '';
    if (urlInput) urlInput.value = '';
    if (previewImg) previewImg.src = '';
    if (dropzone) dropzone.style.display = 'block';
    if (previewWrap) previewWrap.style.display = 'none';
  };

  const handleFile = async (rawFile) => {
    if (!rawFile) return;
    if (statusEl) statusEl.textContent = 'Compressing image... ⏳';
    if (previewWrap) previewWrap.style.display = 'flex';
    if (dropzone) dropzone.style.display = 'none';

    try {
      showAdminToast('Compressing dish photo (Target: 30–80 KB)... ⏳', 'info');
      const result = await compressDishImage(rawFile);
      pendingFile = result.file;
      pendingDataUrl = result.dataUrl;
      showPreview(
        result.dataUrl,
        `${result.sizeKB} KB (WebP • ${result.compressionRatio})`,
        `Optimized (${result.width}×${result.height})`
      );
      showAdminToast(`Photo compressed to ${result.sizeKB} KB (${result.compressionRatio}) ✅`, 'success');
      if (hiddenInput) hiddenInput.value = result.dataUrl;
    } catch (err) {
      clearPhoto();
      showAdminToast(err.message || 'Image compression failed', 'error');
    }
  };

  dropzone?.addEventListener('click', () => fileInput?.click());
  replaceBtn?.addEventListener('click', () => fileInput?.click());
  removeBtn?.addEventListener('click', clearPhoto);

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  });

  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  urlInput?.addEventListener('input', () => {
    const url = urlInput.value.trim();
    if (url) {
      pendingFile = null;
      pendingDataUrl = null;
      if (hiddenInput) hiddenInput.value = url;
      showPreview(url, 'External URL', 'Linked image');
    }
  });

  return {
    getPendingFile: () => pendingFile,
    getPendingDataUrl: () => pendingDataUrl,
    setExistingImage: (url) => {
      if (url) {
        pendingFile = null;
        pendingDataUrl = null;
        if (hiddenInput) hiddenInput.value = url;
        if (urlInput) urlInput.value = url;
        showPreview(url, 'Active photo', 'Ready');
      } else {
        clearPhoto();
      }
    },
    clear: clearPhoto
  };
}

let editPhotoUpload = null;
let addPhotoUpload = null;

function setupEditModalListeners() {
  const modal = $('adm-edit-modal');
  const form = $('adm-edit-form');
  const cancelBtn = $('edit-modal-cancel');
  const closeX = $('edit-modal-close-x');
  if (!modal || !form) return;

  editPhotoUpload = setupDishPhotoUploadUI({
    fileInputId: 'edit-modal-file-input',
    dropzoneId: 'edit-modal-dropzone',
    previewWrapId: 'edit-modal-preview-wrap',
    previewImgId: 'edit-modal-preview-img',
    statusId: 'edit-modal-preview-status',
    sizeBadgeId: 'edit-modal-preview-size',
    replaceBtnId: 'edit-modal-replace-btn',
    removeBtnId: 'edit-modal-remove-btn',
    hiddenInputId: 'edit-modal-item-image',
    urlInputId: 'edit-modal-item-image-url'
  });

  const closeModal = () => {
    modal.classList.remove('active');
  };

  cancelBtn?.addEventListener('click', closeModal);
  closeX?.addEventListener('click', closeModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = $('edit-modal-item-id').value;
    const newName = $('edit-modal-item-name-input').value.trim();
    const newCategory = $('edit-modal-item-category').value;
    const newDiet = $('edit-modal-item-diet').value;
    const newPrice = parseFloat($('edit-modal-item-price').value);
    const newMrpVal = $('edit-modal-item-mrp').value;
    const newMrp = newMrpVal ? parseFloat(newMrpVal) : null;
    const newDesc = $('edit-modal-item-desc').value.trim();
    const newAvail = $('edit-modal-available').checked;
    const newFeat = $('edit-modal-featured').checked;
    const newGst = $('edit-modal-gst') ? $('edit-modal-gst').checked : true;

    if (!newName) {
      showAdminToast('Please enter a dish name.', 'error');
      return;
    }
    if (isNaN(newPrice) || newPrice <= 0) {
      showAdminToast('Please enter a valid price.', 'error');
      return;
    }

    const saveBtn = form.querySelector('button[type="submit"]');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving to Database... ⏳';

    try {
      // 1. Resolve photo upload if a new file is pending
      let finalImageUrl = $('edit-modal-item-image').value.trim();
      const pendingFile = editPhotoUpload?.getPendingFile();
      const pendingDataUrl = editPhotoUpload?.getPendingDataUrl();

      if (pendingFile) {
        saveBtn.textContent = 'Uploading photo... ⏳';
        try {
          finalImageUrl = await uploadDishPhotoToStorage(pendingFile, `${newName.replace(/\s+/g, '_')}.webp`, pendingDataUrl);
        } catch (upErr) {
          console.warn('[EditModal] Upload fallback notice:', upErr.message);
          finalImageUrl = pendingDataUrl;
        }
      }

      const isCustomDish = String(itemId).startsWith('custom_');
      if (isCustomDish) {
        const existingCustom = customCreatedFoods.find(d => String(d.id) === String(itemId));
        const updatedCustom = {
          id: itemId,
          db_id: existingCustom?.db_id,
          name: newName,
          category: newCategory,
          diet: newDiet,
          is_veg: newDiet === 'veg',
          price: newPrice,
          mrp: newMrp,
          image: finalImageUrl || null,
          description: newDesc,
          available: newAvail,
          featured: newFeat,
          gst_applicable: newGst
        };
        const saved = await saveCustomDish(updatedCustom);
        const idx = customCreatedFoods.findIndex(d => String(d.id) === String(itemId));
        if (idx >= 0) customCreatedFoods[idx] = saved;
        else customCreatedFoods.push(saved);
        try { localStorage.setItem('limra_custom_foods', JSON.stringify(customCreatedFoods)); } catch {}
      } else {
        // Base dish override: updates name, category, diet, price, mrp, image, desc, stock, gst
        let override = activeMenuOverrides.find(o => String(o.id) === String(itemId));
        if (!override) {
          override = {
            id: itemId,
            name: newName,
            category: newCategory,
            diet: newDiet,
            price: newPrice,
            mrp: newMrp,
            image: finalImageUrl || null,
            description: newDesc,
            available: newAvail,
            featured: newFeat,
            gst_applicable: newGst
          };
          activeMenuOverrides.push(override);
        } else {
          override.name = newName;
          override.category = newCategory;
          override.diet = newDiet;
          override.price = newPrice;
          override.mrp = newMrp;
          override.image = finalImageUrl || null;
          override.description = newDesc;
          override.available = newAvail;
          override.featured = newFeat;
          override.gst_applicable = newGst;
        }

        await saveMenuOverride(override);
      }

      showAdminToast(`Dish "${newName}" updated permanently in database! ✅`, 'success');
      closeModal();
      initFoodsFilters();
      renderFoods();
      if (typeof isGoogleSheetAutoSyncEnabled === 'function' && isGoogleSheetAutoSyncEnabled()) {
        syncFoodMenuToGoogleSheet().catch(e => console.warn('[AutoSync] Menu sync err:', e));
      }
    } catch (err) {
      showAdminToast('Failed to save changes: ' + err.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });
}

function setupAddDishModalListeners() {
  const modal = $('adm-add-dish-modal');
  const form = $('adm-add-dish-form');
  const openBtn = $('foods-add-new-btn');
  const closeBtn = $('add-dish-close-btn');
  const cancelBtn = $('add-dish-cancel-btn');

  addPhotoUpload = setupDishPhotoUploadUI({
    fileInputId: 'add-dish-file-input',
    dropzoneId: 'add-dish-dropzone',
    previewWrapId: 'add-dish-preview-wrap',
    previewImgId: 'add-dish-preview-img',
    statusId: 'add-dish-preview-status',
    sizeBadgeId: 'add-dish-preview-size',
    replaceBtnId: 'add-dish-replace-btn',
    removeBtnId: 'add-dish-remove-btn',
    hiddenInputId: 'add-dish-image',
    urlInputId: 'add-dish-image-url'
  });

  openBtn?.addEventListener('click', () => {
    if (form) form.reset();
    if (addPhotoUpload) addPhotoUpload.clear();
    if (modal) modal.style.display = 'flex';
  });

  const closeModal = () => {
    if (modal) modal.style.display = 'none';
  };

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('add-dish-name').value.trim();
    const category = $('add-dish-category').value;
    const diet = $('add-dish-diet').value;
    const price = parseFloat($('add-dish-price').value);
    const mrpVal = $('add-dish-mrp').value;
    const mrp = mrpVal ? parseFloat(mrpVal) : null;
    const desc = $('add-dish-desc').value.trim();
    const gstApplicable = $('add-dish-gst') ? $('add-dish-gst').checked : true;

    if (!name || isNaN(price) || price <= 0) {
      showAdminToast('Please fill all required fields.', 'error');
      return;
    }

    const saveBtn = form.querySelector('button[type="submit"]');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving to Database... ⏳';
    }

    try {
      // 1. Resolve photo upload if a file is pending
      let finalImageUrl = $('add-dish-image').value.trim();
      const pendingFile = addPhotoUpload?.getPendingFile();
      const pendingDataUrl = addPhotoUpload?.getPendingDataUrl();

      if (pendingFile) {
        if (saveBtn) saveBtn.textContent = 'Uploading photo... ⏳';
        try {
          finalImageUrl = await uploadDishPhotoToStorage(pendingFile, `${name.replace(/\s+/g, '_')}.webp`, pendingDataUrl);
        } catch (upErr) {
          console.warn('[AddDishModal] Upload fallback notice:', upErr.message);
          finalImageUrl = pendingDataUrl;
        }
      }

      const newDish = {
        name,
        category,
        diet,
        is_veg: diet === 'veg',
        price,
        mrp,
        image: finalImageUrl || null,
        description: desc,
        available: true,
        featured: false,
        gst_applicable: gstApplicable
      };

      // Save permanently to Supabase Database
      const savedDish = await saveCustomDish(newDish);

      customCreatedFoods.unshift(savedDish);
      try {
        localStorage.setItem('limra_custom_foods', JSON.stringify(customCreatedFoods));
      } catch {}

      showAdminToast(`New dish "${name}" permanently saved in database! 🍽️🎉`, 'success');
      closeModal();
      initFoodsFilters();
      renderFoods();
      if (typeof isGoogleSheetAutoSyncEnabled === 'function' && isGoogleSheetAutoSyncEnabled()) {
        syncFoodMenuToGoogleSheet().catch(e => console.warn('[AutoSync] Menu sync err:', e));
      }
    } catch (err) {
      console.error('Failed to save dish to database:', err);
      showAdminToast('Failed to save dish to database: ' + err.message, 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '➕ Add Dish to Menu';
      }
    }
  });
}

function exportFoodsMenuCSV() {
  const all = getCombinedFoodItems();
  if (!all.length) {
    showAdminToast('No food dishes to export.', 'error');
    return;
  }

  const headers = ['Dish ID', 'Dish Name', 'Category', 'Diet Type', 'Selling Price (INR)', 'MRP (INR)', 'Stock Status', 'Chef Special / Featured', 'Description'];
  const rows = all.map(item => [
    `"${item.id}"`,
    `"${item.name.replace(/"/g, '""')}"`,
    `"${categoryLabels[item.category] || item.category}"`,
    `"${item.is_veg || item.diet === 'veg' ? 'Veg' : 'Non-Veg'}"`,
    `"${Number(item.price).toFixed(2)}"`,
    `"${item.mrp ? Number(item.mrp).toFixed(2) : ''}"`,
    `"${item.available !== false ? 'In Stock' : 'Out of Stock'}"`,
    `"${item.featured ? 'Yes' : 'No'}"`,
    `"${(item.description || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `LIMRA_Menu_Dishes_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAdminToast('Menu catalogue exported to CSV! 📥', 'success');
}

function initFoodsToolbarListeners() {
  $('foods-availability-filter')?.addEventListener('change', (e) => {
    foodMenuAvailabilityFilter = e.target.value;
    renderFoods();
  });

  $('foods-sort-filter')?.addEventListener('change', (e) => {
    foodMenuSort = e.target.value;
    renderFoods();
  });

  $('foods-search')?.addEventListener('input', (e) => {
    foodMenuSearch = e.target.value;
    renderFoods();
  });

  $('foods-export-btn')?.addEventListener('click', exportFoodsMenuCSV);
  setupAddDishModalListeners();
}

// ── Navigation ──────────────────────────────────────────

const PANEL_TITLES = {
  dashboard: 'Dashboard',
  orders: 'Order List',
  'hold-orders': 'Hold Orders',
  'order-detail': 'Order Detail',
  customers: 'Customer',
  'customer-analysis': 'Customer Analysis',
  analytics: 'Analytics',
  bookings: 'Bookings',
  foods: 'Foods',
  coupons: 'Coupons',
  combos: 'Combos',
  places: 'Places & Charges',
  stock: 'Stock',
};

let currentActivePanel = 'dashboard';
const dirtyPanels = new Set();
const ALL_RENDERABLE_PANELS = [
  'dashboard',
  'orders',
  'order-detail',
  'tables',
  'kitchen',
  'hold-orders',
  'closed-orders',
  'customers',
  'customer-analysis',
  'analytics',
  'bookings',
  'foods',
];

function getActivePanelId() {
  if (typeof document !== 'undefined') {
    const activeSection = document.querySelector('.adm-panel.active');
    if (activeSection && activeSection.id && activeSection.id.startsWith('panel-')) {
      const id = activeSection.id.replace(/^panel-/, '');
      currentActivePanel = id;
      return id;
    }
  }
  return currentActivePanel || 'dashboard';
}

function updateSidebarBadges() {
  const pendingOrdersCount = orders.filter(o => o.status === 'pending').length;
  const orderBadge = $('pending-orders-badge');
  if (orderBadge) {
    if (pendingOrdersCount > 0) {
      orderBadge.textContent = pendingOrdersCount;
      show(orderBadge);
    } else {
      hide(orderBadge);
    }
  }

  const pendingBookingsCount = bookings.filter(b => b.status === 'pending').length;
  const bookingBadge = $('pending-bookings-badge');
  if (bookingBadge) {
    if (pendingBookingsCount > 0) {
      bookingBadge.textContent = pendingBookingsCount;
      show(bookingBadge);
    } else {
      hide(bookingBadge);
    }
  }

  const holdBadge = $('pending-hold-badge');
  if (holdBadge && typeof getHeldOrders === 'function') {
    const heldCount = getHeldOrders().length;
    if (heldCount > 0) {
      holdBadge.textContent = heldCount;
      holdBadge.classList.remove('adm-hidden');
    } else {
      holdBadge.classList.add('adm-hidden');
    }
  }

  updateKitchenBadges();
}

export function switchPanel(panelId, pushHistory = true) {
  if (panelId === 'printer') {
    switchPanel('settings', pushHistory);
    switchSettingsSubtab('printer');
    return;
  }
  if (panelId === 'profile') {
    switchPanel('settings', pushHistory);
    switchSettingsSubtab('profile');
    return;
  }

  // 9 Consolidated Workspaces Parent Mapping
  const workspaceMap = {
    'dashboard': 'dashboard',
    'order-detail': 'order-detail',
    'orders': 'orders',
    'hold-orders': 'orders',
    'closed-orders': 'orders',
    'tables': 'tables',
    'kitchen': 'kitchen',
    'foods': 'foods',
    'combos': 'foods',
    'coupons': 'foods',
    'places': 'foods',
    'stock': 'stock',
    'daily-sales-report': 'daily-sales-report',
    'customer-analysis': 'daily-sales-report',
    'analytics': 'daily-sales-report',
    'settings': 'settings',
    'customers': 'settings',
    'bookings': 'settings',
    'printer': 'settings',
    'profile': 'settings'
  };
  const activeWorkspace = workspaceMap[panelId] || panelId;

  // RBAC Permission Check
  if (currentAdminUser && typeof hasStaffPermission === 'function' && !hasStaffPermission(activeWorkspace)) {
    showAdminToast(`Access Denied: Role "${currentAdminUser.role}" is not authorized to access "${activeWorkspace}".`, 'error');
    const userRole = normalizeStaffRole(currentAdminUser.role);
    const fallback = ROLE_WORKSPACE_PERMISSIONS[userRole]?.[0] || 'kitchen';
    if (fallback !== panelId) {
      switchPanel(fallback, pushHistory);
    }
    return;
  }

  currentActivePanel = panelId;
  dirtyPanels.delete(panelId);

  document.body.classList.toggle('pos-mode-active', panelId === 'order-detail');
  document.querySelectorAll('.adm-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`#panel-${panelId}`)?.classList.add('active');
  document.querySelectorAll('.adm-nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.adm-nav-item[data-panel="${activeWorkspace}"]`)?.classList.add('active');

  // Highlight active subnav tab across consolidated workspace bars
  document.querySelectorAll('.adm-workspace-subnav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-subnav-panel') === panelId);
  });

  if (pushHistory) {
    if (window.location.hash !== `#panel=${panelId}`) {
      history.pushState({ panel: panelId }, '', `#panel=${panelId}`);
    }
  }

  // Editor Zone submenu auto-expand
  const subPanels = ['coupons', 'combos', 'places'];
  const editorZoneTrigger = $('editor-zone-trigger');
  const editorZoneItems = $('editor-zone-items');
  if (subPanels.includes(panelId)) {
    if (editorZoneItems) editorZoneItems.style.display = 'flex';
    if (editorZoneTrigger) {
      editorZoneTrigger.classList.add('active');
      editorZoneTrigger.classList.add('expanded');
    }
  } else {
    if (editorZoneTrigger) {
      editorZoneTrigger.classList.remove('active');
    }
  }

  if (panelId === 'stock') initStockSummarySection();
  if (panelId === 'daily-sales-report') {
    initSalesReportHub();
    loadSalesReportData();
  }

  if (panelId === 'customers') renderCustomers();
  if (panelId === 'customer-analysis') renderCustomerAnalysis();
  if (panelId === 'analytics') renderAnalytics();
  if (panelId === 'foods') { initFoodsFilters(); loadAndRenderFoods(); }
  if (panelId === 'bookings') {
    renderBookingCalendar();
    renderBookingsList();
  }
  if (panelId === 'coupons') { loadAndRenderCoupons(); }
  if (panelId === 'combos') { loadAndRenderCombos(); }
  if (panelId === 'places') { loadAndRenderPlaces(); }
  if (panelId === 'tables') renderTablesPanel();
  if (panelId === 'kitchen') renderKitchenPanel();
  if (panelId === 'hold-orders') renderHoldOrdersPanel();
  if (panelId === 'closed-orders') renderClosedOrdersPanel();
  if (panelId === 'settings') initSettingsPanel();
  if (panelId === 'orders') {
    renderOrdersTable();
    renderBillingTotalBills();
  }
  if (panelId === 'order-detail') {
    const wasAlreadyMounted = posBillingMounted;
    renderOrderDetailPicker();
    renderBillingQuickCards();
    initBillingPanel();
    const posEl = $('billing-pos');
    if (posEl) posEl.style.display = 'block';
    // Only initialize blank state on very first mount if cart is empty and no inputs are filled
    if (!wasAlreadyMounted && !posEditingOrderId && (!posCart || posCart.length === 0)) {
      syncPosOrderTypeState(posOrderType || 'table');
    }
  } else {
    closeOrderDetailDrawer();
  }
  if (panelId === 'dashboard') {
    renderOverview();
    if (dashboardMap) {
      setTimeout(() => {
        dashboardMap.invalidateSize();
      }, 100);
    }
  }

  if (window.innerWidth < 1024) {
    $('sidebar').classList.remove('open');
    hide($('sidebar-overlay'));
  }
}
window.switchPanel = switchPanel;


// ── Closed Orders & Audit Panel ─────────────────────────────────────────────
let closedDateFilter = 'all';
let closedCustomStart = null;
let closedCustomEnd = null;
let closedEditingOrderId = null;
let closedEditingCart = [];
let closedEditingDeletedItemIds = [];
let closedOrdersPage = 1;
let closedOrdersPerPage = 25;
let isFetchingClosedOrders = false;
const closedLoadedRanges = new Set();

function getClosedDateRangeIso() {
  const now = new Date();
  const todayStr = getLocalDateString(now);
  const yDate = new Date(now);
  yDate.setDate(yDate.getDate() - 1);
  const yestStr = getLocalDateString(yDate);

  let startIso = null;
  let endIso = null;
  let rangeKey = '';

  if (closedDateFilter === 'today') {
    const [y, m, d] = todayStr.split('-').map(Number);
    startIso = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
    endIso = new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
    rangeKey = `closed_today_${todayStr}`;
  } else if (closedDateFilter === 'yesterday') {
    const [y, m, d] = yestStr.split('-').map(Number);
    startIso = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
    endIso = new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
    rangeKey = `closed_yesterday_${yestStr}`;
  } else if (closedDateFilter === 'week') {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    const startStr = getLocalDateString(weekStart);
    const [y, m, d] = startStr.split('-').map(Number);
    startIso = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
    endIso = now.toISOString();
    rangeKey = `closed_week_${startStr}`;
  } else if (closedDateFilter === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    startIso = monthStart.toISOString();
    endIso = now.toISOString();
    rangeKey = `closed_month_${now.getFullYear()}_${now.getMonth() + 1}`;
  } else if (closedDateFilter === 'custom' && closedCustomStart) {
    const [sY, sM, sD] = closedCustomStart.split('-').map(Number);
    const cStart = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
    const endStr = closedCustomEnd || closedCustomStart;
    const [eY, eM, eD] = endStr.split('-').map(Number);
    const cEnd = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
    startIso = cStart.toISOString();
    endIso = cEnd.toISOString();
    rangeKey = `closed_custom_${closedCustomStart}_${endStr}`;
  } else if (closedDateFilter === 'all') {
    rangeKey = 'closed_all_orders';
  }

  return { startIso, endIso, rangeKey, todayStr, yestStr };
}

async function ensureHistoricalClosedOrders(force = false) {
  if (isFetchingClosedOrders) return;

  const { startIso, endIso, rangeKey } = getClosedDateRangeIso();
  if (!rangeKey) return;

  if (!force && closedLoadedRanges.has(rangeKey)) return;

  // If today or yesterday, check if existing orders in memory already span before startIso
  if (!force && orders.length > 0 && startIso && (closedDateFilter === 'today' || closedDateFilter === 'yesterday')) {
    const oldest = new Date(orders[orders.length - 1].created_at || Date.now());
    if (oldest <= new Date(startIso)) {
      closedLoadedRanges.add(rangeKey);
      return;
    }
  }

  isFetchingClosedOrders = true;
  const countEl = $('closed-orders-count');
  if (countEl) countEl.innerHTML = '<span style="color:#6366f1;">Fetching history... ⏳</span>';

  try {
    const pageSize = 1000;
    let from = 0;
    let fetched = [];

    while (true) {
      let q = insforge.database
        .from('orders')
        .select('id, order_number, customer_name, customer_phone, total_amount, status, payment_status, payment_method, notes, latitude, longitude, landmark, delivery_notes, location_verified, order_type, table_number, table_zone, txn_ref, ticket_status, created_at, updated_at')
        .or('status.in.(delivered,completed,closed,cancelled),payment_status.eq.paid')
        .order('created_at', { ascending: false });

      if (startIso) q = q.gte('created_at', startIso);
      if (endIso) q = q.lte('created_at', endIso);

      q = q.range(from, from + pageSize - 1);

      const { data, error } = await q;
      if (error) {
        console.warn('[Closed Orders] Error loading historical batch:', error);
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
      orders.forEach(o => orderMap.set(String(o.id), o));
      fetched.forEach(o => orderMap.set(String(o.id), o));
      orders = Array.from(orderMap.values()).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      closedLoadedRanges.add(rangeKey);
      persistOrdersCache();
    } else {
      closedLoadedRanges.add(rangeKey);
    }
  } catch (err) {
    console.error('[Closed Orders] Failed to ensure historical orders:', err);
  } finally {
    isFetchingClosedOrders = false;
  }
}

function renderClosedPagination(totalCount, totalPages, currentPage) {
  const pag = $('closed-orders-pagination');
  const startNum = totalCount === 0 ? 0 : (currentPage - 1) * closedOrdersPerPage + 1;
  const endNum = Math.min(currentPage * closedOrdersPerPage, totalCount);

  if ($('closed-page-range')) $('closed-page-range').textContent = `${startNum}–${endNum}`;
  if ($('closed-total-count')) $('closed-total-count').textContent = totalCount;

  if (!pag) return;
  if (totalPages <= 1) {
    pag.innerHTML = '';
    return;
  }

  let html = '';
  // Prev button
  html += `<button type="button" class="adm-page-btn closed-page-nav-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} title="Previous Page">«</button>`;

  // Page numbers (sliding window of 7)
  const maxButtons = 7;
  let startP = Math.max(1, currentPage - 3);
  let endP = Math.min(totalPages, startP + maxButtons - 1);
  if (endP - startP + 1 < maxButtons) {
    startP = Math.max(1, endP - maxButtons + 1);
  }

  if (startP > 1) {
    html += `<button type="button" class="adm-page-btn closed-page-nav-btn" data-page="1">1</button>`;
    if (startP > 2) html += `<span style="padding:0 4px;color:#94a3b8;align-self:center;user-select:none;">…</span>`;
  }

  for (let p = startP; p <= endP; p++) {
    html += `<button type="button" class="adm-page-btn closed-page-nav-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }

  if (endP < totalPages) {
    if (endP < totalPages - 1) html += `<span style="padding:0 4px;color:#94a3b8;align-self:center;user-select:none;">…</span>`;
    html += `<button type="button" class="adm-page-btn closed-page-nav-btn" data-page="${totalPages}">${totalPages}</button>`;
  }

  // Next button
  html += `<button type="button" class="adm-page-btn closed-page-nav-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} title="Next Page">»</button>`;

  pag.innerHTML = html;
  pag.querySelectorAll('.closed-page-nav-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetPage = Number(btn.dataset.page);
      if (targetPage >= 1 && targetPage <= totalPages && targetPage !== closedOrdersPage) {
        closedOrdersPage = targetPage;
        renderClosedOrdersPanel();
        $('panel-closed-orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

const loadedItemOrderIds = new Set();
const inFlightOrderItemPromises = new Map();

async function ensureOrderItemsLoaded(orderIds, options = {}) {
  if (!Array.isArray(orderIds) || !orderIds.length) return false;
  const force = Boolean(options && options.force);

  // Sync known item order IDs from any existing orderItems in memory
  orderItems.forEach(i => {
    if (i && i.order_id) loadedItemOrderIds.add(String(i.order_id));
  });

  const uniqueIds = Array.from(new Set(orderIds.map(String).filter(Boolean)));
  const pendingPromises = [];
  const idsToFetch = [];

  for (const id of uniqueIds) {
    if (!force && loadedItemOrderIds.has(id)) continue;
    if (inFlightOrderItemPromises.has(id)) {
      pendingPromises.push(inFlightOrderItemPromises.get(id));
    } else {
      idsToFetch.push(id);
    }
  }

  if (idsToFetch.length === 0) {
    if (pendingPromises.length > 0) {
      await Promise.all(pendingPromises);
      return true;
    }
    return false;
  }

  const batchSize = 100;
  for (let i = 0; i < idsToFetch.length; i += batchSize) {
    const batch = idsToFetch.slice(i, i + batchSize);
    const batchPromise = (async () => {
      try {
        const { data: batchItems, error: itemErr } = await insforge.database
          .from('order_items')
          .select(ORDER_ITEM_SELECT_COLUMNS)
          .in('order_id', batch);
        if (!itemErr && Array.isArray(batchItems)) {
          const batchOrderSet = new Set(batch);
          const preservedItems = force
            ? orderItems.filter(item => !batchOrderSet.has(String(item.order_id)))
            : orderItems;
          const itemMap = new Map();
          preservedItems.forEach(item => itemMap.set(String(item.id), item));
          batchItems.forEach(item => itemMap.set(String(item.id), item));
          orderItems = Array.from(itemMap.values());
          batch.forEach(id => loadedItemOrderIds.add(id));
        }
      } catch (itemFetchErr) {
        console.warn('[Order Items] Scoped item fetch warning:', itemFetchErr);
      } finally {
        batch.forEach(id => inFlightOrderItemPromises.delete(id));
      }
    })();

    batch.forEach(id => inFlightOrderItemPromises.set(id, batchPromise));
    pendingPromises.push(batchPromise);
  }

  await Promise.all(pendingPromises);
  return true;
}

async function renderClosedOrdersPanel() {
  if (getActivePanelId() !== 'closed-orders') {
    dirtyPanels.add('closed-orders');
    return;
  }
  const tbody = $('closed-orders-table-body');
  if (!tbody) return;

  // 1. Ensure historical orders for active closedDateFilter are fetched
  await ensureHistoricalClosedOrders();

  // 2. Consolidate Closed Orders to ensure merged orders display only the compiled single record
  const allClosed = orders.filter(o =>
    o.status === 'delivered' ||
    o.status === 'completed' ||
    o.status === 'closed' ||
    o.status === 'cancelled' ||
    o.payment_status === 'paid' ||
    o.payment_status === 'refunded' ||
    o.ticket_status === 'CLOSED'
  );
  const consolidatedClosed = getConsolidatedClosedBills(allClosed);
  const deliveredOrders = consolidatedClosed.filter(
    o => (o.status === 'delivered' || o.status === 'completed' || o.status === 'closed' || o.payment_status === 'paid') && !isOrderVoided(o)
  );
  const cancelledOrders = consolidatedClosed.filter(o => o.status === 'cancelled' || isOrderVoided(o));

  const totalClosedRev = deliveredOrders.reduce((s, o) => s + getEffectiveOrderTotal(o), 0);
  const totalClosedCount = deliveredOrders.length;

  const now = new Date();
  const todayStr = getLocalDateString(now);
  const yDate = new Date(now);
  yDate.setDate(yDate.getDate() - 1);
  const yestStr = getLocalDateString(yDate);

  const todayOrders = deliveredOrders.filter(o => getLocalDateString(o.created_at) === todayStr);
  const todayClosedRev = todayOrders.reduce((s, o) => s + getEffectiveOrderTotal(o), 0);
  const todayClosedCount = todayOrders.length;

  const cancelledLoss = cancelledOrders.reduce((s, o) => s + getEffectiveOrderTotal(o), 0);
  const aov = totalClosedCount > 0 ? (totalClosedRev / totalClosedCount) : 0;

  if ($('closed-kpi-total-rev')) $('closed-kpi-total-rev').textContent = `₹${totalClosedRev.toFixed(2)}`;
  if ($('closed-kpi-total-count')) $('closed-kpi-total-count').textContent = `${totalClosedCount} Settled Bills`;
  if ($('closed-kpi-today-rev')) $('closed-kpi-today-rev').textContent = `₹${todayClosedRev.toFixed(2)}`;
  if ($('closed-kpi-today-count')) $('closed-kpi-today-count').textContent = `${todayClosedCount} Bills Today`;
  if ($('closed-kpi-delivered-ratio')) $('closed-kpi-delivered-ratio').textContent = `${deliveredOrders.length} / ${cancelledOrders.length}`;
  if ($('closed-kpi-cancel-loss')) $('closed-kpi-cancel-loss').textContent = `Cancelled: ₹${cancelledLoss.toFixed(2)}`;
  if ($('closed-kpi-aov')) $('closed-kpi-aov').textContent = `₹${aov.toFixed(2)}`;

  // 3. Filter Table List from the Consolidated Closed Orders
  let list = [...consolidatedClosed];

  // Date Filtering with timezone safety
  if (closedDateFilter === 'today') {
    list = list.filter(o => getLocalDateString(o.created_at) === todayStr);
  } else if (closedDateFilter === 'yesterday') {
    list = list.filter(o => getLocalDateString(o.created_at) === yestStr);
  } else if (closedDateFilter === 'week') {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    const [wY, wM, wD] = getLocalDateString(weekStart).split('-').map(Number);
    const wStartDate = new Date(wY, wM - 1, wD, 0, 0, 0, 0);
    list = list.filter(o => new Date(o.created_at) >= wStartDate);
  } else if (closedDateFilter === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    list = list.filter(o => new Date(o.created_at) >= monthStart);
  } else if (closedDateFilter === 'custom' && closedCustomStart) {
    const [sY, sM, sD] = closedCustomStart.split('-').map(Number);
    const cStart = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
    const endStr = closedCustomEnd || closedCustomStart;
    const [eY, eM, eD] = endStr.split('-').map(Number);
    const cEnd = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
    list = list.filter(o => {
      const t = new Date(o.created_at);
      return t >= cStart && t <= cEnd;
    });
  }

  // Type Filter
  const typeFilter = $('closed-orders-type-filter')?.value || 'all';
  if (typeFilter !== 'all') {
    list = list.filter(o => {
      const parsed = parseNotesMetadata(o.notes, o);
      return parsed.type === typeFilter || o.order_type === typeFilter;
    });
  }

  // Status Filter
  const statusFilter = $('closed-orders-status-filter')?.value || 'all';
  if (statusFilter !== 'all') {
    if (statusFilter === 'delivered') {
      list = list.filter(o => o.status === 'delivered' || o.payment_status === 'paid');
    } else {
      list = list.filter(o => o.status === statusFilter);
    }
  }

  // Search Filter
  const search = ($('closed-orders-search')?.value || '').toLowerCase().trim();
  if (search) {
    list = list.filter(o => {
      const parsed = parseNotesMetadata(o.notes, o);
      return (
        String(o.order_number || '').includes(search) ||
        (o.customer_name && o.customer_name.toLowerCase().includes(search)) ||
        (o.customer_phone && o.customer_phone.includes(search)) ||
        String(parsed.tableNumber || o.table_number || '').toLowerCase().includes(search)
      );
    });
  }

  // Sort newest first
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Update Summary Bar with standard Restaurant GST breakdown (excluding cancelled & voided bills)
  const activeDelivered = list.filter(o => o.status !== 'cancelled' && !isOrderVoided(o));
  let sumGrand = 0;
  let sumTaxable = 0;
  let sumCgst = 0;
  let sumSgst = 0;
  let sumTotalGst = 0;

  activeDelivered.forEach(o => {
    const td = computeOrderTaxDetails(o);
    sumGrand += td.grandTotal;
    sumTaxable += td.taxableValue;
    sumCgst += td.cgstAmt;
    sumSgst += td.sgstAmt;
    sumTotalGst += td.totalGst;
  });

  if ($('closed-orders-count')) $('closed-orders-count').textContent = `${list.length} ${list.length === 1 ? 'bill' : 'bills'}`;
  if ($('closed-orders-amount')) $('closed-orders-amount').textContent = `₹${sumGrand.toFixed(2)}`;
  if ($('closed-orders-tax-amt')) $('closed-orders-tax-amt').textContent = `₹${sumTotalGst.toFixed(2)} (CGST ₹${sumCgst.toFixed(2)} + SGST ₹${sumSgst.toFixed(2)})`;

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:2.5rem;color:var(--adm-muted);">No closed orders match your selected filters.</td></tr>';
    renderClosedPagination(0, 1, 1);
    return;
  }

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(list.length / closedOrdersPerPage));
  if (closedOrdersPage > totalPages) closedOrdersPage = totalPages;
  const startIndex = (closedOrdersPage - 1) * closedOrdersPerPage;
  const pageOrders = list.slice(startIndex, startIndex + closedOrdersPerPage);

  // Fetch items for current page orders if missing
  await ensureOrderItemsLoaded(pageOrders.map(o => o.id));

  tbody.innerHTML = pageOrders.map(o => {
    const rawItems = getItemsForOrder(o.id);
    const taxDetails = computeOrderTaxDetails(o, rawItems);
    const items = taxDetails.items;
    const parsed = parseNotesMetadata(o.notes, o);
    const tableNum = parsed.tableNumber || o.table_number || '';
    const isTable = parsed.type === 'table';
    const typeLabel = isTable
      ? `<span class="closed-type-badge table">🪑 Table ${tableNum || '—'}</span>`
      : (parsed.type === 'delivery'
          ? '<span class="closed-type-badge delivery">🚗 Delivery</span>'
          : '<span class="closed-type-badge pickup">🥡 Pickup</span>');

    const itemsSummary = items.length
      ? items.slice(0, 2).map(i => `${i.quantity || i.qty}× ${escapeHtml(i.item_name || i.name)}`).join(', ') + (items.length > 2 ? ` +${items.length - 2} more` : '')
      : '<span style="color:var(--adm-muted);">No items recorded</span>';

    const isPaid = o.payment_status === 'paid';
    const isVoided = isOrderVoided(o);
    const isCancelled = o.status === 'cancelled';
    const statusPill = isVoided
      ? '<span class="closed-status-badge cancelled"><span class="badge-dot red"></span>Voided</span>'
      : (isCancelled
          ? '<span class="closed-status-badge cancelled"><span class="badge-dot red"></span>Cancelled</span>'
          : '<span class="closed-status-badge settled"><span class="badge-dot green"></span>Settled</span>');

    const payPill = isVoided
      ? '<span class="closed-pay-mode unpaid">Voided / Refunded</span>'
      : (isPaid
          ? `<span class="closed-pay-mode">Paid · ${escapeHtml(parsed.paymentMode || o.payment_mode || 'Cash/UPI')}</span>`
          : '<span class="closed-pay-mode unpaid">Unpaid</span>');

    const d = new Date(o.created_at);
    const dateStr = d.toLocaleDateString('en-IN', { day:'2-digit', month:'short' }) + ', ' + d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });

    return `
      <tr>
        <td>
          <span class="closed-order-num">#${formatDailyOrderNumber(o)}</span>
        </td>
        <td>
          <div class="closed-cust-name">${escapeHtml(o.customer_name || 'Walk-in')}</div>
          <div class="closed-cust-phone">${escapeHtml(o.customer_phone || '—')}</div>
        </td>
        <td>${typeLabel}</td>
        <td>
          <div class="closed-items-cell" title="${items.map(i=>`${i.quantity || i.qty}x ${i.item_name || i.name}`).join(', ')}">
            ${itemsSummary}
          </div>
        </td>
        <td style="text-align:right;" class="closed-num-cell">₹${taxDetails.taxableValue.toFixed(2)}</td>
        <td style="text-align:right;" class="closed-num-cell closed-tax-muted">₹${taxDetails.cgstAmt.toFixed(2)}</td>
        <td style="text-align:right;" class="closed-num-cell closed-tax-muted">₹${taxDetails.sgstAmt.toFixed(2)}</td>
        <td style="text-align:right;" class="closed-num-cell closed-tax-highlight">₹${taxDetails.totalGst.toFixed(2)}</td>
        <td style="text-align:right;">
          <strong class="closed-total-cell ${(isCancelled || isVoided) ? 'cancelled' : ''}">${formatBillAmount(taxDetails.grandTotal)}</strong>
        </td>
        <td>
          <div class="closed-status-wrap">
            ${statusPill}
            ${payPill}
          </div>
        </td>
        <td style="font-size:.78rem;color:#64748b;white-space:nowrap;">${dateStr}</td>
        <td style="text-align:right;position:sticky;right:0;background:#ffffff;z-index:1;box-shadow:-4px 0 8px rgba(0,0,0,0.04);padding-right:.75rem;">
          <div class="closed-actions-wrap">
            <button type="button" class="closed-action-btn edit closed-edit-btn" data-id="${o.id}" onclick="openClosedOrderEditModal('${o.id}')" title="Edit and correct dishes or bill for this order">
              ✏️ Edit
            </button>
            <button type="button" class="closed-action-btn bill closed-bill-btn" data-id="${o.id}" title="Reprint final tax receipt">
              🧾 Bill
            </button>
            <button type="button" class="closed-action-btn kot closed-kot-btn" data-id="${o.id}" title="Reprint kitchen ticket">
              🗒️ KOT
            </button>
            <button type="button" class="closed-action-btn delete closed-delete-btn" data-id="${o.id}" title="Void this closed invoice with audit trail (Manager Required)">
              🚫
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Row Action Listeners
  tbody.querySelectorAll('.closed-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openClosedOrderEditModal(btn.dataset.id);
    });
  });

  tbody.querySelectorAll('.closed-bill-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const order = orders.find(o => String(o.id) === String(btn.dataset.id));
      if (!order) return;
      await printOrderReceiptWithTax(order, null, { isReprint: true });
    });
  });

  tbody.querySelectorAll('.closed-kot-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const order = orders.find(o => String(o.id) === String(btn.dataset.id));
      if (!order) return;
      const items = getItemsForOrder(order.id);
      await printKOT(order, items, { isReprint: true });
    });
  });

  tbody.querySelectorAll('.closed-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteClosedOrder(btn.dataset.id);
    });
  });
}

let closedEditAddTab = 'menu';

function switchClosedEditAddTab(tab) {
  closedEditAddTab = tab;
  const menuPane = $('closed-edit-add-menu-pane');
  const customPane = $('closed-edit-add-custom-pane');
  const menuBtn = $('closed-edit-tab-menu-btn');
  const customBtn = $('closed-edit-tab-custom-btn');

  if (tab === 'menu') {
    if (menuPane) menuPane.style.display = 'flex';
    if (customPane) customPane.style.display = 'none';
    if (menuBtn) {
      menuBtn.style.background = '#6366f1';
      menuBtn.style.color = '#fff';
    }
    if (customBtn) {
      customBtn.style.background = 'transparent';
      customBtn.style.color = '#64748b';
    }
  } else {
    if (menuPane) menuPane.style.display = 'none';
    if (customPane) customPane.style.display = 'flex';
    if (menuBtn) {
      menuBtn.style.background = 'transparent';
      menuBtn.style.color = '#64748b';
    }
    if (customBtn) {
      customBtn.style.background = '#10b981';
      customBtn.style.color = '#fff';
    }
  }
}
window.switchClosedEditAddTab = switchClosedEditAddTab;

let closedEditActiveCat = 'all';

function renderClosedEditCategories() {
  const pillBar = $('closed-edit-categories');
  if (!pillBar) return;
  const allItems = getCombinedFoodItems();
  const availableCats = new Set(allItems.map(f => f.category).filter(Boolean));
  const orderedCats = categoryTabOrder.filter(c => availableCats.has(c));
  const extraCats = Array.from(availableCats).filter(c => !categoryTabOrder.includes(c));
  const cats = ['all', ...orderedCats, ...extraCats];

  pillBar.innerHTML = cats.map(cat => {
    const lbl = cat === 'all' ? '🍽️ All Items' : ((categoryEmojis[cat] || '🍲') + ' ' + (categoryLabels[cat] || cat));
    const isAct = cat === closedEditActiveCat || (closedEditActiveCat !== 'all' && (categoryAliases[closedEditActiveCat] || []).includes(cat));
    const cls = isAct ? 'pos-cat-pill active' : 'pos-cat-pill';
    return `<button type="button" class="${cls}" data-cat="${cat}">${lbl}</button>`;
  }).join('');

  pillBar.querySelectorAll('.pos-cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      closedEditActiveCat = pill.dataset.cat;
      renderClosedEditCategories();
      renderClosedEditFoodGrid($('closed-edit-dish-search')?.value);
    });
  });
}

function renderClosedEditFoodGrid(filterText) {
  const grid = $('closed-edit-food-grid');
  if (!grid) return;
  const q = (filterText || '').toLowerCase().trim();
  const source = getCombinedFoodItems();
  const matchCats = categoryAliases[closedEditActiveCat] || [closedEditActiveCat];

  const filtered = source.filter(f => {
    const catLower = (f.category || '').toLowerCase();
    const activeLower = (closedEditActiveCat || '').toLowerCase();
    const matchesCat = (activeLower === 'all') ||
      matchCats.includes(f.category) ||
      matchCats.some(c => c && c.toLowerCase() === catLower) ||
      catLower === activeLower;

    const matchesQuery = !q ||
      (f.name && f.name.toLowerCase().includes(q)) ||
      (f.category && f.category.toLowerCase().includes(q)) ||
      (categoryLabels[f.category] && categoryLabels[f.category].toLowerCase().includes(q)) ||
      (f.description && f.description.toLowerCase().includes(q));

    return matchesCat && matchesQuery;
  });

  const countBadge = $('closed-edit-dishes-count');
  if (countBadge) countBadge.textContent = `${filtered.length} Dishes`;

  if (!filtered.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--adm-muted);font-size:.8rem;padding:1.5rem 0;">No dishes found matching search.</div>';
    return;
  }

  grid.innerHTML = filtered.map(f => {
    const imgUrl = f.image || categoryImages[f.category] || '/images/food_starters.png';
    const inOrder = closedEditingCart.find(i => (f.id && String(i.id) === String(f.id)) || (i.name && f.name && i.name.toLowerCase() === f.name.toLowerCase()));
    const inOrderQty = inOrder ? inOrder.qty : 0;

    return `
      <div role="button" tabindex="0" class="pos-food-tile-img" data-id="${f.id}" data-name="${escapeHtml(f.name)}" data-price="${f.price}">
        <div class="pos-tile-img-box">
          <img src="${imgUrl}" alt="${escapeHtml(f.name)}" onerror="this.src='/images/food_starters.png'" loading="lazy" />
          ${inOrderQty > 0 ? `<span class="pos-tile-badge">${inOrderQty} in bill</span>` : ''}
        </div>
        <div class="pos-tile-body">
          <span class="pos-tile-title" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
          <div class="pos-tile-foot">
            <span class="pos-tile-price-tag">₹${Number(f.price).toFixed(0)}</span>
            <span class="pos-tile-add-btn">+</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.pos-food-tile-img').forEach(tile => {
    tile.addEventListener('click', () => {
      const id = tile.dataset.id;
      const name = tile.dataset.name;
      const price = parseFloat(tile.dataset.price);
      const existing = closedEditingCart.find(i => (id && String(i.id) === String(id)) || (i.name && name && i.name.toLowerCase() === name.toLowerCase()));
      if (existing) {
        existing.qty++;
        existing.line_total = existing.price * existing.qty;
      } else {
        closedEditingCart.push({
          order_item_id: `temp-${Date.now()}-${Math.random()}`,
          id: id || null,
          name,
          price,
          qty: 1,
          line_total: price
        });
      }
      renderClosedEditItems();
      renderClosedEditFoodGrid($('closed-edit-dish-search')?.value);
    });
  });
}

function populateClosedEditAddSelect(filterQuery = '') {
  const sel = $('closed-edit-add-select');
  if (!sel) return;

  const q = (filterQuery || '').toLowerCase().trim();
  const allDishes = getCombinedFoodItems();
  const filtered = allDishes.filter(f => {
    if (!q) return true;
    return (f.name && f.name.toLowerCase().includes(q)) ||
      (f.category && f.category.toLowerCase().includes(q)) ||
      (categoryLabels[f.category] && categoryLabels[f.category].toLowerCase().includes(q)) ||
      (f.description && f.description.toLowerCase().includes(q));
  });

  sel.innerHTML = '<option value="">— Quick Select (' + filtered.length + ') —</option>' +
    filtered.map(f => {
      const emoji = f.isCombo ? '🍱 ' : (categoryEmojis[f.category] || '🍽️ ') + ' ';
      return `<option value="${f.id}" data-price="${f.price}" data-name="${escapeHtml(f.name)}">${emoji}${escapeHtml(f.name)} (₹${Number(f.price).toFixed(0)})</option>`;
    }).join('');

  sel.onchange = () => {
    const opt = sel.options[sel.selectedIndex];
    if (opt && opt.dataset.price && $('closed-edit-add-price')) {
      $('closed-edit-add-price').value = opt.dataset.price;
    }
  };
}
window.populateClosedEditAddSelect = populateClosedEditAddSelect;

async function openClosedOrderEditModal(orderId) {
  const order = orders.find(o => String(o.id) === String(orderId));
  if (!order) {
    showAdminToast('Order not found or no longer available.', 'error');
    return;
  }
  closeOrderDetailDrawer();
  closedEditingOrderId = orderId;
  closedEditingDeletedItemIds = [];

  // Ensure combos are fetched
  if (!adminCombos || adminCombos.length === 0) {
    try {
      adminCombos = await getCombos();
    } catch (e) {
      console.warn('[Closed Orders] Combos fetch failed:', e);
    }
  }

  const parsed = parseNotesMetadata(order.notes, order);
  const tableNum = parsed.tableNumber || order.table_number || '';
  const typeVal = parsed.type === 'table' ? 'table' : (parsed.type === 'delivery' ? 'delivery' : 'pickup');

  if ($('closed-edit-title')) $('closed-edit-title').innerHTML = `<span>✏️ Edit &amp; Correct Closed Order #${formatDailyOrderNumber(order)}</span>`;
  if ($('closed-edit-date')) $('closed-edit-date').textContent = new Date(order.created_at).toLocaleString('en-IN');
  if ($('closed-edit-cust-name-input')) $('closed-edit-cust-name-input').value = order.customer_name || '';
  if ($('closed-edit-cust-phone-input')) $('closed-edit-cust-phone-input').value = order.customer_phone || '';
  if ($('closed-edit-type-select')) $('closed-edit-type-select').value = typeVal;
  if ($('closed-edit-table-input')) $('closed-edit-table-input').value = tableNum;
  if ($('closed-edit-payment-status-select')) $('closed-edit-payment-status-select').value = order.payment_status || 'paid';
  if ($('closed-edit-order-status-select')) $('closed-edit-order-status-select').value = order.status || 'delivered';

  const tableWrap = $('closed-edit-table-wrap');
  if (tableWrap) tableWrap.style.display = (typeVal === 'table') ? 'block' : 'none';

  // Load existing items from cache or fetch from DB if missing
  let rawItems = getItemsForOrder(order.id);
  if (!rawItems || rawItems.length === 0) {
    try {
      const { data: dbItems } = await insforge.database.from('order_items').select('*').eq('order_id', order.id);
      if (dbItems && dbItems.length > 0) {
        rawItems = dbItems;
        for (const dbi of dbItems) {
          if (!orderItems.some(x => x.id === dbi.id)) orderItems.push(dbi);
        }
      }
    } catch (err) {
      console.warn('[Closed Edit] Failed to fetch items from DB:', err);
    }
  }

  const cleanItems = (rawItems || []).filter(i => i && !/delivery|discount|tax|fee/i.test(i.item_name || i.name || ''));
  closedEditingCart = cleanItems.map(i => ({
    order_item_id: i.id,
    id: i.menu_item_id || null,
    name: i.item_name || i.name,
    price: Number(i.unit_price || (i.quantity > 0 ? (i.line_total / i.quantity) : (i.price || 0))),
    qty: Number(i.quantity || i.qty || 1),
    line_total: Number(i.line_total || ((i.unit_price || i.price || 0) * (i.quantity || i.qty || 1)))
  }));

  // Reset inputs
  if ($('closed-edit-dish-search')) $('closed-edit-dish-search').value = '';
  if ($('closed-edit-items-search')) $('closed-edit-items-search').value = '';
  if ($('closed-edit-custom-name')) $('closed-edit-custom-name').value = '';
  if ($('closed-edit-custom-price')) $('closed-edit-custom-price').value = '';
  if ($('closed-edit-custom-qty')) $('closed-edit-custom-qty').value = '1';
  if ($('closed-edit-add-price')) $('closed-edit-add-price').value = '';
  if ($('closed-edit-add-qty')) $('closed-edit-add-qty').value = '1';
  if ($('closed-edit-reason-input')) $('closed-edit-reason-input').value = '';

  closedEditActiveCat = 'all';
  switchClosedEditAddTab('menu');
  populateClosedEditAddSelect();
  renderClosedEditCategories();
  renderClosedEditFoodGrid('');
  renderClosedEditItems();

  const modal = $('adm-closed-order-edit-modal');
  if (modal) {
    modal.classList.add('open');
    modal.style.display = 'flex';
  }
}

function closeClosedOrderEditModal() {
  const modal = $('adm-closed-order-edit-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }
  closedEditingOrderId = null;
  closedEditingCart = [];
  closedEditingDeletedItemIds = [];
}

window.openClosedOrderEditModal = openClosedOrderEditModal;
window.closeClosedOrderEditModal = closeClosedOrderEditModal;

function renderClosedEditItems(filterText) {
  const tbody = $('closed-edit-items-tbody');
  const countBadge = $('closed-edit-items-count-badge');
  if (!tbody) return;

  const q = (filterText || $('closed-edit-items-search')?.value || '').toLowerCase().trim();
  const totalCount = closedEditingCart.length;
  if (countBadge) countBadge.textContent = `${totalCount} Item${totalCount === 1 ? '' : 's'}`;

  if (!closedEditingCart.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--adm-muted);">No dishes in this order. Use the form above to add items.</td></tr>';
  } else {
    const filtered = closedEditingCart.map((item, idx) => ({ ...item, originalIndex: idx })).filter(item => {
      if (!q) return true;
      return (item.name || '').toLowerCase().includes(q);
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--adm-muted);font-size:.85rem;">No items match "${escapeHtml(q)}"</td></tr>`;
    } else {
      tbody.innerHTML = filtered.map(item => {
        const idx = item.originalIndex;
        return `
          <tr>
            <td>
              <strong style="color:#111827;font-size:.88rem;">${escapeHtml(item.name)}</strong>
            </td>
            <td style="text-align:center;color:#475569;font-weight:600;">₹${item.price.toFixed(2)}</td>
            <td style="text-align:center;">
              <div style="display:inline-flex;align-items:center;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;overflow:hidden;">
                <button type="button" onclick="closedEditChangeQty(${idx},-1)" style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;font-weight:900;font-size:.85rem;color:#334155;display:flex;align-items:center;justify-content:center;">−</button>
                <span style="min-width:24px;text-align:center;font-weight:800;font-size:.82rem;color:#0f172a;">${item.qty}</span>
                <button type="button" onclick="closedEditChangeQty(${idx},1)" style="width:26px;height:26px;border:none;background:transparent;cursor:pointer;font-weight:900;font-size:.85rem;color:#334155;display:flex;align-items:center;justify-content:center;">+</button>
              </div>
            </td>
            <td style="text-align:right;font-weight:800;color:#111827;font-size:.88rem;">₹${(item.price * item.qty).toFixed(2)}</td>
            <td style="text-align:center;">
              <button type="button" onclick="closedEditRemoveItem(${idx})" style="width:26px;height:26px;border:1px solid #fca5a5;border-radius:6px;background:#fef2f2;cursor:pointer;color:#ef4444;font-weight:bold;font-size:.8rem;display:inline-flex;align-items:center;justify-content:center;" title="Delete item">✕</button>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  // Recalculate Totals
  const s = getBillSettings();
  const order = orders.find(o => String(o.id) === String(closedEditingOrderId));
  const parsed = order ? parseNotesMetadata(order.notes, order) : {};
  const billingMeta = order ? parseNotesBillingMetadata(order.notes) : {};
  const currentType = $('closed-edit-type-select')?.value || order?.order_type || parsed.type || 'table';
  const isDelivery = currentType === 'delivery';
  const deliveryFee = isDelivery
    ? Math.max(0, Number(order?.delivery_fee ?? billingMeta.deliveryFee ?? parsed.deliveryFee ?? 0))
    : 0;

  const billing = calculateOrderBilling({
    items: closedEditingCart,
    deliveryFee,
    discountPct: billingMeta.discountPct || parsed.discountPct || 0,
    discountAmt: billingMeta.discountAmt || parsed.discountAmt || 0,
    cgstRate: billingMeta.cgstRate ?? parsed.cgstRate ?? (s.cgstRate ?? 2.5),
    sgstRate: billingMeta.sgstRate ?? parsed.sgstRate ?? (s.sgstRate ?? 2.5)
  });

  const subtotal = billing.subtotal;
  const tax = billing.totalGst;
  const grandTotal = billing.grandTotal;

  if ($('closed-edit-subtotal')) $('closed-edit-subtotal').textContent = `₹${subtotal.toFixed(2)}`;
  if ($('closed-edit-tax')) $('closed-edit-tax').textContent = `₹${tax.toFixed(2)}`;
  if ($('closed-edit-grand-total')) $('closed-edit-grand-total').textContent = formatBillAmount(grandTotal);
}

window.closedEditChangeQty = function(idx, delta) {
  closedEditingCart[idx].qty = Math.max(1, closedEditingCart[idx].qty + delta);
  closedEditingCart[idx].line_total = closedEditingCart[idx].price * closedEditingCart[idx].qty;
  renderClosedEditItems();
};

window.closedEditRemoveItem = function(idx) {
  const item = closedEditingCart[idx];
  if (item && item.order_item_id && !String(item.order_item_id).startsWith('temp-')) {
    closedEditingDeletedItemIds.push(item.order_item_id);
  }
  closedEditingCart.splice(idx, 1);
  renderClosedEditItems();
};

function isOrderVoided(order) {
  if (!order) return false;
  const payStatus = String(order.payment_status || '').toLowerCase().trim();
  const notes = String(order.notes || '');
  return payStatus === 'refunded' || notes.includes('[VOIDED]');
}

async function saveClosedOrderCorrections(orderId, shouldReprint = false, providedReason = null, providedIdempotencyKey = null) {
  const order = orders.find(o => String(o.id) === String(orderId));
  if (!order) return { ok: false, error: 'ORDER_NOT_FOUND' };

  if (isOrderVoided(order)) {
    showAdminToast(`Order #${formatDailyOrderNumber(order)} has already been voided and cannot be amended.`, 'error');
    return { ok: false, error: 'ORDER_ALREADY_VOIDED' };
  }

  if (!closedEditingCart.length) {
    showAdminToast('Order must contain at least one item. To cancel all items, use Void Invoice.', 'error');
    return { ok: false, error: 'ITEMS_REQUIRED' };
  }

  // Reason is optional for normal edits; default to standard audit note if left empty
  let cleanReason = String(providedReason ?? ($('closed-edit-reason-input')?.value || '')).trim();
  if (cleanReason.length < 3) {
    cleanReason = cleanReason ? `Order edited: ${cleanReason}` : 'Order edited by authorized staff';
  }

  try {
    // 1. Recalculate authoritative order total & gather updated fields
    const s = getBillSettings();
    const parsed = parseNotesMetadata(order.notes, order);
    const billingMeta = parseNotesBillingMetadata(order.notes);

    const custName = $('closed-edit-cust-name-input')?.value?.trim() || order.customer_name || 'Customer';
    const custPhone = $('closed-edit-cust-phone-input')?.value?.trim() || order.customer_phone || '';
    const newType = $('closed-edit-type-select')?.value || order.order_type || 'table';
    const newTableNum = $('closed-edit-table-input')?.value?.trim() || '';

    const isDelivery = newType === 'delivery';
    const deliveryFee = isDelivery
      ? Math.max(0, Number(order.delivery_fee ?? billingMeta.deliveryFee ?? parsed.deliveryFee ?? 0))
      : 0;

    const billing = calculateOrderBilling({
      items: closedEditingCart,
      deliveryFee,
      discountPct: billingMeta.discountPct || parsed.discountPct || 0,
      discountAmt: billingMeta.discountAmt || parsed.discountAmt || 0,
      cgstRate: billingMeta.cgstRate ?? parsed.cgstRate ?? (s.cgstRate ?? 2.5),
      sgstRate: billingMeta.sgstRate ?? parsed.sgstRate ?? (s.sgstRate ?? 2.5)
    });

    const newGrandTotal = billing.grandTotal;

    // Update notes string with new type/table tag and preserved delivery fee
    let updatedNotes = order.notes || '';
    updatedNotes = updatedNotes.replace(/\[TABLE:[^\]]*\]/gi, '').replace(/\[DELIVERY\]/gi, '').replace(/\[SELF PICKUP\]/gi, '').trim();
    if (newType === 'table') {
      updatedNotes = `[TABLE: ${newTableNum || '1'}] ${updatedNotes}`.trim();
    } else if (newType === 'delivery') {
      if (!updatedNotes.includes('[DELIVERY_FEE:')) {
        updatedNotes = `[DELIVERY] [DELIVERY_FEE: ${deliveryFee}] ${updatedNotes}`.trim();
      } else {
        updatedNotes = `[DELIVERY] ${updatedNotes}`.trim();
      }
    } else {
      updatedNotes = `[SELF PICKUP] ${updatedNotes}`.trim();
    }

    const updatedItemsPayload = closedEditingCart.map(item => ({
      menu_item_id: (item.id && !isNaN(Number(item.id)) && Number(item.id) < 9000) ? Number(item.id) : null,
      item_name: item.name,
      quantity: Math.max(1, Number(item.qty || 1)),
      unit_price: Math.max(0, Number(item.price || 0)),
      line_total: Number((Math.max(0, Number(item.price || 0)) * Math.max(1, Number(item.qty || 1))).toFixed(2))
    }));

    const updatedFieldsPayload = {
      customer_name: custName,
      customer_phone: custPhone,
      total_amount: newGrandTotal,
      subtotal_amount: billing.subtotal || newGrandTotal,
      taxable_amount: billing.taxableAmount || (billing.subtotal - (billing.discountAmt || 0)),
      cgst_amount: billing.cgstAmt || 0,
      sgst_amount: billing.sgstAmt || 0,
      discount_amount: billing.discountAmt || 0,
      discount_pct: billing.discountPct || 0,
      delivery_fee: deliveryFee || 0,
      round_off_amount: billing.roundOff || 0,
      order_type: newType,
      table_number: newType === 'table' ? (newTableNum || null) : null,
      notes: updatedNotes
    };

    const idempotencyKey =
      providedIdempotencyKey ||
      order._amendIdempotencyKey ||
      `amend-${orderId}-${Date.now()}`;
    order._amendIdempotencyKey = idempotencyKey;

    // 2. Execute server-side atomic closed-order amendment RPC (enforces transactional item replacement & audit log)
    const { data: rpcResult, error: rpcError } = await insforge.database.rpc('amend_closed_order_atomic', {
      p_order_id: orderId,
      p_updated_items: updatedItemsPayload,
      p_updated_fields: updatedFieldsPayload,
      p_reason: cleanReason,
      p_idempotency_key: idempotencyKey
    });

    if (rpcError) {
      throw rpcError;
    }

    // 3. Synchronize in-memory state from authoritative RPC result
    order.customer_name = rpcResult?.customer_name || custName;
    order.customer_phone = rpcResult?.customer_phone || custPhone;
    order.total_amount = rpcResult?.total_amount !== undefined ? Number(rpcResult.total_amount) : newGrandTotal;
    order.order_type = rpcResult?.order_type || newType;
    order.table_number = rpcResult?.table_number !== undefined ? rpcResult.table_number : updatedFieldsPayload.table_number;
    order.notes = rpcResult?.notes || updatedNotes;
    order._amendIdempotencyKey = null;

    const otherItems = orderItems.filter(i => String(i.order_id) !== String(orderId));
    const freshOrderItems = Array.isArray(rpcResult?.items) && rpcResult.items.length > 0
      ? rpcResult.items.map(i => ({
          id: i.id || `amend-item-${Date.now()}`,
          order_id: orderId,
          item_name: i.item_name || i.name,
          quantity: Number(i.quantity || i.qty || 1),
          unit_price: Number(i.unit_price || i.price || 0),
          line_total: Number(i.line_total || 0),
          menu_item_id: i.menu_item_id ?? null
        }))
      : closedEditingCart.map(i => ({
          id: i.order_item_id || `temp-edit-${Date.now()}`,
          order_id: orderId,
          item_name: i.name,
          quantity: i.qty,
          unit_price: i.price,
          line_total: i.price * i.qty,
          menu_item_id: (i.id && !isNaN(Number(i.id)) && Number(i.id) < 9000) ? Number(i.id) : null
        }));
    orderItems.length = 0;
    orderItems.push(...otherItems, ...freshOrderItems);

    showAdminToast(`Order #${formatDailyOrderNumber(order)} amended and recorded in audit log! ✅`, 'success');

    if (shouldReprint) {
      await printOrderReceiptWithTax(order, freshOrderItems, { isReprint: true });
    }

    closeClosedOrderEditModal();
    renderClosedOrdersPanel();
    renderOrdersTable();
    renderBillingQuickCards();
    renderBillingTotalBills();
    renderOverview();
    if (selectedOrderId) renderOrderDetail(selectedOrderId);
    return { ok: true, data: rpcResult };
  } catch (err) {
    console.error('[Closed Order Amendment Error]', err);
    showAdminToast('Failed to amend closed invoice: ' + (err.message || String(err)), 'error');
    return { ok: false, error: err.message || String(err) };
  }
}

async function voidClosedOrder(orderId, providedReason = null, providedIdempotencyKey = null) {
  const order = orders.find(o => String(o.id) === String(orderId));
  if (!order) {
    showAdminToast('Order not found.', 'error');
    return { ok: false, error: 'ORDER_NOT_FOUND' };
  }

  const orderNum = formatDailyOrderNumber(order);
  const amountStr = Number(order.total_amount || 0).toFixed(2);

  // Prevent duplicate void unless replaying an idempotent request
  if (isOrderVoided(order) && !providedIdempotencyKey) {
    showAdminToast(`ORDER_ALREADY_VOIDED: Order #${orderNum} has already been voided.`, 'error');
    return { ok: false, error: 'ORDER_ALREADY_VOIDED' };
  }

  // Confirmation step before voiding
  if (typeof confirm === 'function' && !providedReason && !providedIdempotencyKey) {
    const confirmed = confirm(
      `Are you sure you want to VOID and cancel Invoice #${orderNum} (₹${amountStr})?\n\nNote: Original invoice and payment history will be preserved for financial audit compliance.`
    );
    if (!confirmed) return { ok: false, cancelled: true };
  }

  let cleanReason = String(providedReason ?? ($('closed-edit-reason-input')?.value || '')).trim();
  if (cleanReason.length < 3) {
    cleanReason = cleanReason ? `Order voided: ${cleanReason}` : 'Order voided by authorized staff';
  }

  try {
    const idempotencyKey =
      providedIdempotencyKey ||
      order._voidIdempotencyKey ||
      `void-${orderId}-${Date.now()}`;
    order._voidIdempotencyKey = idempotencyKey;

    // Route through server-side atomic void RPC (enforces manager role, preserves invoice & payment_history, records audit trail)
    const { data: rpcResult, error: rpcError } = await insforge.database.rpc('void_closed_order_atomic', {
      p_order_id: orderId,
      p_reason: cleanReason,
      p_idempotency_key: idempotencyKey
    });

    if (rpcError) {
      throw rpcError;
    }

    // Preserve original invoice and its order_items in memory; mark as voided/refunded
    order.payment_status = rpcResult?.payment_status || 'refunded';
    order.ticket_status = rpcResult?.ticket_status || 'CLOSED';
    order.notes = rpcResult?.notes || `${order.notes || ''} [VOIDED] [VOID_REASON: ${cleanReason}]`.trim();

    if (String(closedEditingOrderId) === String(orderId)) {
      closeClosedOrderEditModal();
    }

    showAdminToast(`Invoice #${orderNum} voided and recorded in financial audit log 🚫`, 'success');

    renderClosedOrdersPanel();
    renderOrdersTable();
    renderBillingQuickCards();
    renderBillingTotalBills();
    renderOverview();
    if (selectedOrderId === orderId) {
      renderOrderDetail(orderId);
    }
    return { ok: true, data: rpcResult };
  } catch (err) {
    console.error('[Void Closed Order Error]', err);
    showAdminToast('Failed to void invoice: ' + (err.message || String(err)), 'error');
    return { ok: false, error: err.message || String(err) };
  }
}

async function deleteUniversalOrder(orderId, providedReason = null, providedIdempotencyKey = null) {
  return voidClosedOrder(orderId, providedReason, providedIdempotencyKey);
}

const deleteClosedOrder = voidClosedOrder;
window.voidClosedOrder = voidClosedOrder;
window.deleteUniversalOrder = deleteUniversalOrder;
window.deleteClosedOrder = deleteClosedOrder;
window.deleteOrder = deleteUniversalOrder;

window.saveClosedOrderCorrections = saveClosedOrderCorrections;

async function exportRestaurantGSTReportCSV() {
  await ensureHistoricalClosedOrders();
  const allClosed = orders.filter(o =>
    o.status === 'delivered' ||
    o.status === 'completed' ||
    o.status === 'closed' ||
    o.status === 'cancelled' ||
    o.payment_status === 'paid'
  );
  const consolidatedClosed = getConsolidatedClosedBills(allClosed);
  if (!consolidatedClosed.length) {
    showAdminToast('No closed bills available to export.', 'error');
    return;
  }

  // Filter based on active Closed Orders filters (date, type, status, search)
  const now = new Date();
  const todayStr = getLocalDateString(now);
  const yDate = new Date(now);
  yDate.setDate(yDate.getDate() - 1);
  const yestStr = getLocalDateString(yDate);
  let list = [...consolidatedClosed];

  if (closedDateFilter === 'today') {
    list = list.filter(o => getLocalDateString(o.created_at) === todayStr);
  } else if (closedDateFilter === 'yesterday') {
    list = list.filter(o => getLocalDateString(o.created_at) === yestStr);
  } else if (closedDateFilter === 'week') {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    const [wY, wM, wD] = getLocalDateString(weekStart).split('-').map(Number);
    const wStartDate = new Date(wY, wM - 1, wD, 0, 0, 0, 0);
    list = list.filter(o => new Date(o.created_at) >= wStartDate);
  } else if (closedDateFilter === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    list = list.filter(o => new Date(o.created_at) >= monthStart);
  } else if (closedDateFilter === 'custom' && closedCustomStart) {
    const [sY, sM, sD] = closedCustomStart.split('-').map(Number);
    const cStart = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
    const endStr = closedCustomEnd || closedCustomStart;
    const [eY, eM, eD] = endStr.split('-').map(Number);
    const cEnd = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
    list = list.filter(o => {
      const t = new Date(o.created_at);
      return t >= cStart && t <= cEnd;
    });
  }

  const typeFilter = $('closed-orders-type-filter')?.value || 'all';
  if (typeFilter !== 'all') {
    list = list.filter(o => {
      const parsed = parseNotesMetadata(o.notes, o);
      return parsed.type === typeFilter || o.order_type === typeFilter;
    });
  }

  const statusFilter = $('closed-orders-status-filter')?.value || 'all';
  if (statusFilter !== 'all') {
    if (statusFilter === 'delivered') {
      list = list.filter(o => o.status === 'delivered' || o.payment_status === 'paid');
    } else {
      list = list.filter(o => o.status === statusFilter);
    }
  }

  const search = ($('closed-orders-search')?.value || '').toLowerCase().trim();
  if (search) {
    list = list.filter(o => {
      const parsed = parseNotesMetadata(o.notes, o);
      return (
        String(o.order_number || '').includes(search) ||
        (o.customer_name && o.customer_name.toLowerCase().includes(search)) ||
        (o.customer_phone && o.customer_phone.includes(search)) ||
        String(parsed.tableNumber || o.table_number || '').toLowerCase().includes(search)
      );
    });
  }

  list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Ensure line items for export orders are loaded
  await ensureOrderItemsLoaded(list.map(o => o.id));

  const headers = [
    'Invoice / Bill No',
    'Invoice Date',
    'Invoice Time',
    'Customer Name',
    'Customer Phone',
    'Order Channel',
    'Table No',
    'Payment Mode',
    'Payment Status',
    'Consolidated Items',
    'Food Base Subtotal (INR)',
    'Discount (INR)',
    'Taxable Value (INR)',
    'CGST Rate (%)',
    'CGST Amount (INR)',
    'SGST Rate (%)',
    'SGST Amount (INR)',
    'Total GST (5%) (INR)',
    'Delivery Charges (INR)',
    'Invoice Grand Total (INR)',
    'Settlement Status'
  ];

  const rows = list.map(o => {
    const rawItems = getItemsForOrder(o.id);
    const td = computeOrderTaxDetails(o, rawItems);
    const parsed = parseNotesMetadata(o.notes, o);
    const d = new Date(o.created_at);
    const dateStr = d.toLocaleDateString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const itemsStr = td.items.map(i => `${i.quantity || i.qty}x ${i.item_name || i.name} @ ₹${(i.unit_price || i.price).toFixed(2)}`).join('; ');

    return [
      `"${formatDailyOrderNumber(o)}"`,
      `"${dateStr}"`,
      `"${timeStr}"`,
      `"${(o.customer_name || 'Walk-in').replace(/"/g, '""')}"`,
      `"${o.customer_phone || ''}"`,
      `"${parsed.type || o.order_type || 'table'}"`,
      `"${parsed.tableNumber || o.table_number || ''}"`,
      `"${parsed.paymentMode || o.payment_mode || 'Cash/UPI'}"`,
      `"${o.payment_status || 'paid'}"`,
      `"${itemsStr.replace(/"/g, '""')}"`,
      `"${td.subtotal.toFixed(2)}"`,
      `"${td.discountAmt.toFixed(2)}"`,
      `"${td.taxableValue.toFixed(2)}"`,
      `"${td.cgstRate}%"`,
      `"${td.cgstAmt.toFixed(2)}"`,
      `"${td.sgstRate}%"`,
      `"${td.sgstAmt.toFixed(2)}"`,
      `"${td.totalGst.toFixed(2)}"`,
      `"${td.deliveryFee.toFixed(2)}"`,
      `"${td.grandTotal.toFixed(2)}"`,
      `"${o.status}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `LIMRA_Restaurant_GST_Report_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAdminToast('Standard Restaurant GST Report exported successfully! 🧾📥', 'success');
}

async function exportClosedOrdersCSV() {
  await ensureHistoricalClosedOrders();
  const allClosed = orders.filter(o =>
    o.status === 'delivered' ||
    o.status === 'completed' ||
    o.status === 'closed' ||
    o.status === 'cancelled' ||
    o.payment_status === 'paid'
  );
  const consolidatedClosed = getConsolidatedClosedBills(allClosed);
  if (!consolidatedClosed.length) {
    showAdminToast('No closed orders available to export.', 'error');
    return;
  }

  const now = new Date();
  const todayStr = getLocalDateString(now);
  const yDate = new Date(now);
  yDate.setDate(yDate.getDate() - 1);
  const yestStr = getLocalDateString(yDate);
  let list = [...consolidatedClosed];

  if (closedDateFilter === 'today') {
    list = list.filter(o => getLocalDateString(o.created_at) === todayStr);
  } else if (closedDateFilter === 'yesterday') {
    list = list.filter(o => getLocalDateString(o.created_at) === yestStr);
  } else if (closedDateFilter === 'week') {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    const [wY, wM, wD] = getLocalDateString(weekStart).split('-').map(Number);
    const wStartDate = new Date(wY, wM - 1, wD, 0, 0, 0, 0);
    list = list.filter(o => new Date(o.created_at) >= wStartDate);
  } else if (closedDateFilter === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    list = list.filter(o => new Date(o.created_at) >= monthStart);
  } else if (closedDateFilter === 'custom' && closedCustomStart) {
    const [sY, sM, sD] = closedCustomStart.split('-').map(Number);
    const cStart = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
    const endStr = closedCustomEnd || closedCustomStart;
    const [eY, eM, eD] = endStr.split('-').map(Number);
    const cEnd = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
    list = list.filter(o => {
      const t = new Date(o.created_at);
      return t >= cStart && t <= cEnd;
    });
  }

  const typeFilter = $('closed-orders-type-filter')?.value || 'all';
  if (typeFilter !== 'all') {
    list = list.filter(o => {
      const parsed = parseNotesMetadata(o.notes, o);
      return parsed.type === typeFilter || o.order_type === typeFilter;
    });
  }

  const statusFilter = $('closed-orders-status-filter')?.value || 'all';
  if (statusFilter !== 'all') {
    if (statusFilter === 'delivered') {
      list = list.filter(o => o.status === 'delivered' || o.payment_status === 'paid');
    } else {
      list = list.filter(o => o.status === statusFilter);
    }
  }

  const search = ($('closed-orders-search')?.value || '').toLowerCase().trim();
  if (search) {
    list = list.filter(o => {
      const parsed = parseNotesMetadata(o.notes, o);
      return (
        String(o.order_number || '').includes(search) ||
        (o.customer_name && o.customer_name.toLowerCase().includes(search)) ||
        (o.customer_phone && o.customer_phone.includes(search)) ||
        String(parsed.tableNumber || o.table_number || '').toLowerCase().includes(search)
      );
    });
  }

  // Ensure line items for export orders are loaded
  await ensureOrderItemsLoaded(list.map(o => o.id));

  const headers = [
    'Order Number',
    'Date & Time',
    'Customer Name',
    'Phone',
    'Order Type',
    'Table',
    'Status',
    'Payment Status',
    'Payment Mode',
    'Consolidated Items',
    'Food Taxable (INR)',
    'CGST (INR)',
    'SGST (INR)',
    'Total GST (INR)',
    'Total Amount (INR)'
  ];

  const rows = list.map(o => {
    const rawItems = getItemsForOrder(o.id);
    const td = computeOrderTaxDetails(o, rawItems);
    const parsed = parseNotesMetadata(o.notes, o);
    const itemsStr = td.items.map(i => `${i.quantity || i.qty}x ${i.item_name || i.name}`).join('; ');
    return [
      `"${formatDailyOrderNumber(o)}"`,
      `"${new Date(o.created_at).toLocaleString('en-IN')}"`,
      `"${(o.customer_name || 'Walk-in').replace(/"/g, '""')}"`,
      `"${o.customer_phone || ''}"`,
      `"${parsed.type || o.order_type || 'table'}"`,
      `"${parsed.tableNumber || o.table_number || ''}"`,
      `"${o.status}"`,
      `"${o.payment_status}"`,
      `"${parsed.paymentMode || o.payment_mode || 'Cash/UPI'}"`,
      `"${itemsStr.replace(/"/g, '""')}"`,
      `"${td.taxableValue.toFixed(2)}"`,
      `"${td.cgstAmt.toFixed(2)}"`,
      `"${td.sgstAmt.toFixed(2)}"`,
      `"${td.totalGst.toFixed(2)}"`,
      `"${td.grandTotal.toFixed(2)}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `LIMRA_Closed_Orders_Audit_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAdminToast('Closed orders audit log exported to CSV! 📥', 'success');
}

function initClosedOrdersListeners() {
  // Date Preset Buttons
  $('closed-date-presets')?.querySelectorAll('.pos-cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      $('closed-date-presets').querySelectorAll('.pos-cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      closedDateFilter = btn.dataset.range;
      closedOrdersPage = 1;
      const customWrap = $('closed-custom-date-wrap');
      if (customWrap) customWrap.style.display = closedDateFilter === 'custom' ? 'flex' : 'none';
      if (closedDateFilter !== 'custom') renderClosedOrdersPanel();
    });
  });

  // Custom Date Apply
  $('closed-apply-custom-date')?.addEventListener('click', () => {
    closedCustomStart = $('closed-start-date')?.value || null;
    closedCustomEnd = $('closed-end-date')?.value || null;
    closedOrdersPage = 1;
    renderClosedOrdersPanel();
  });

  // Page Size Selector
  $('closed-page-size-select')?.addEventListener('change', function() {
    closedOrdersPerPage = parseInt(this.value, 10) || 25;
    closedOrdersPage = 1;
    renderClosedOrdersPanel();
  });

  // Type & Status Dropdowns & Search
  $('closed-orders-type-filter')?.addEventListener('change', () => {
    closedOrdersPage = 1;
    renderClosedOrdersPanel();
  });
  $('closed-orders-status-filter')?.addEventListener('change', () => {
    closedOrdersPage = 1;
    renderClosedOrdersPanel();
  });
  $('closed-orders-search')?.addEventListener('input', () => {
    closedOrdersPage = 1;
    renderClosedOrdersPanel();
  });
  $('closed-orders-new-bill-btn')?.addEventListener('click', () => {
    switchPanel('order-detail');
    $('billing-new-btn')?.click();
  });
  $('closed-orders-gst-export-btn')?.addEventListener('click', exportRestaurantGSTReportCSV);
  $('closed-orders-export-btn')?.addEventListener('click', exportClosedOrdersCSV);
  $('closed-orders-sheet-sync-btn')?.addEventListener('click', async () => {
    await ensureHistoricalClosedOrders();
    const allClosed = orders.filter(o =>
      o.status === 'delivered' ||
      o.status === 'completed' ||
      o.status === 'closed' ||
      o.status === 'cancelled' ||
      o.payment_status === 'paid'
    );
    bulkSyncClosedOrdersToGoogleSheet(allClosed);
  });

  // Closed Order Edit Modal Listeners
  const editModal = $('adm-closed-order-edit-modal');
  if (editModal) {
    editModal.addEventListener('click', (e) => {
      if (e.target === editModal) closeClosedOrderEditModal();
    });
  }
  $('closed-edit-close-btn')?.addEventListener('click', closeClosedOrderEditModal);
  $('closed-edit-discard-btn')?.addEventListener('click', closeClosedOrderEditModal);

  // Toggle Table wrap on Type change
  $('closed-edit-type-select')?.addEventListener('change', function() {
    const tableWrap = $('closed-edit-table-wrap');
    if (tableWrap) tableWrap.style.display = (this.value === 'table') ? 'block' : 'none';
  });

  // Tab Switching (Menu & Combos vs Custom Item)
  $('closed-edit-tab-menu-btn')?.addEventListener('click', () => switchClosedEditAddTab('menu'));
  $('closed-edit-tab-custom-btn')?.addEventListener('click', () => switchClosedEditAddTab('custom'));

  // Search in Menu & Combos selector and visual grid
  $('closed-edit-dish-search')?.addEventListener('input', function() {
    populateClosedEditAddSelect(this.value);
    renderClosedEditFoodGrid(this.value);
  });

  // Search filter within currently ordered items
  $('closed-edit-items-search')?.addEventListener('input', function() {
    renderClosedEditItems(this.value);
  });

  // Add Item from Menu & Combos
  $('closed-edit-add-btn')?.addEventListener('click', () => {
    const sel = $('closed-edit-add-select');
    const dishId = sel?.value;
    if (!dishId) {
      showAdminToast('Please select a dish or combo to add.', 'error');
      return;
    }
    const allDishes = getCombinedFoodItems();
    const dish = allDishes.find(m => String(m.id) === String(dishId));
    if (!dish) {
      showAdminToast('Selected dish not found in menu.', 'error');
      return;
    }
    const price = parseFloat($('closed-edit-add-price')?.value) || Number(dish.price || 0);
    const qty = Math.max(1, parseInt($('closed-edit-add-qty')?.value, 10) || 1);

    const existing = closedEditingCart.find(i => (dishId && String(i.id) === String(dishId)) || i.name.toLowerCase() === dish.name.toLowerCase());
    if (existing) {
      existing.qty += qty;
      existing.line_total = existing.price * existing.qty;
    } else {
      closedEditingCart.push({
        order_item_id: null,
        id: dish.id,
        name: dish.name,
        price,
        qty,
        line_total: price * qty
      });
    }

    if (sel) sel.value = '';
    if ($('closed-edit-add-price')) $('closed-edit-add-price').value = '';
    if ($('closed-edit-add-qty')) $('closed-edit-add-qty').value = '1';

    renderClosedEditItems();
  });

  // Add Custom / Manual Dish
  $('closed-edit-custom-add-btn')?.addEventListener('click', () => {
    const name = $('closed-edit-custom-name')?.value?.trim();
    const price = parseFloat($('closed-edit-custom-price')?.value);
    const qty = Math.max(1, parseInt($('closed-edit-custom-qty')?.value, 10) || 1);

    if (!name) {
      showAdminToast('Please enter a valid custom dish name.', 'error');
      $('closed-edit-custom-name')?.focus();
      return;
    }
    if (isNaN(price) || price < 0) {
      showAdminToast('Please enter a valid price for the custom dish.', 'error');
      $('closed-edit-custom-price')?.focus();
      return;
    }

    const existing = closedEditingCart.find(i => i.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.qty += qty;
      existing.line_total = existing.price * existing.qty;
    } else {
      closedEditingCart.push({
        order_item_id: null,
        id: null,
        name,
        price,
        qty,
        line_total: price * qty
      });
    }

    if ($('closed-edit-custom-name')) $('closed-edit-custom-name').value = '';
    if ($('closed-edit-custom-price')) $('closed-edit-custom-price').value = '';
    if ($('closed-edit-custom-qty')) $('closed-edit-custom-qty').value = '1';

    renderClosedEditItems();
  });

  // Save & Delete Buttons
  $('closed-edit-save-btn')?.addEventListener('click', async () => {
    if (!closedEditingOrderId) return;
    await saveClosedOrderCorrections(closedEditingOrderId, false);
  });

  $('closed-edit-reprint-btn')?.addEventListener('click', async () => {
    if (!closedEditingOrderId) return;
    await saveClosedOrderCorrections(closedEditingOrderId, true);
  });

  $('closed-edit-delete-btn')?.addEventListener('click', async () => {
    if (!closedEditingOrderId) return;
    await deleteClosedOrder(closedEditingOrderId);
  });
}

function renderActivePanel(activePanelId) {
  dirtyPanels.delete(activePanelId);
  switch (activePanelId) {
    case 'dashboard':
      renderOverview();
      break;
    case 'orders':
      renderOrdersTable();
      renderBillingTotalBills();
      break;
    case 'order-detail':
      renderOrderDetailPicker();
      renderBillingQuickCards();
      if (selectedOrderId) renderOrderDetail(selectedOrderId);
      break;
    case 'tables':
      renderTablesPanel();
      break;
    case 'kitchen':
      renderKitchenPanel();
      break;
    case 'hold-orders':
      renderHoldOrdersPanel();
      break;
    case 'closed-orders':
      renderClosedOrdersPanel();
      break;
    case 'customers':
      renderCustomers();
      break;
    case 'customer-analysis':
      renderCustomerAnalysis();
      break;
    case 'analytics':
      renderAnalytics();
      break;
    case 'bookings':
      renderBookingCalendar();
      renderBookingsList();
      break;
    case 'foods':
      initFoodsFilters();
      renderFoods();
      break;
    default:
      renderOverview();
      break;
  }
}

function renderAll() {
  updateSidebarBadges();

  const activePanelId = getActivePanelId();
  for (const panel of ALL_RENDERABLE_PANELS) {
    if (panel !== activePanelId) {
      dirtyPanels.add(panel);
    }
  }

  renderActivePanel(activePanelId);
}

let isDashboardSyncing = false;
let activeSyncPromise = null;
let pendingDeltaRefresh = false;
let pendingManualRefresh = false;
let resetAdminPollingTimer = null;

async function refreshDashboard(isManual = false) {
  if (!isManual && typeof document !== 'undefined' && document.hidden) return;

  if (isDashboardSyncing) {
    if (isManual) {
      pendingManualRefresh = true;
    } else {
      pendingDeltaRefresh = true;
    }
    return activeSyncPromise;
  }

  isDashboardSyncing = true;
  if (typeof offlineSync !== 'undefined' && offlineSync.updateSyncIndicator) {
    offlineSync.updateSyncIndicator();
  }

  activeSyncPromise = (async () => {
    try {
      if (typeof offlineSync !== 'undefined' && offlineSync.triggerSync && offlineSync.isOnline()) {
        await offlineSync.triggerSync();
      }
      await loadData(isManual);
    } catch (err) {
      console.error('Auto sync error:', err);
      if (isManual) {
        alert('Failed to load remote data. Rendering local/cached view.');
      }
    }

    try {
      renderAll();
    } catch (renderErr) {
      console.error('renderAll error:', renderErr);
    }

    if (typeof offlineSync !== 'undefined' && offlineSync.updateSyncIndicator) {
      offlineSync.updateSyncIndicator();
    }
  })();

  try {
    await activeSyncPromise;
  } finally {
    isDashboardSyncing = false;
    activeSyncPromise = null;
    if (typeof resetAdminPollingTimer === 'function') {
      resetAdminPollingTimer();
    }
  }

  if (pendingManualRefresh || pendingDeltaRefresh) {
    const runManual = pendingManualRefresh;
    pendingManualRefresh = false;
    pendingDeltaRefresh = false;
    return await refreshDashboard(runManual);
  }
}

// ── Auth flow ───────────────────────────────────────────

function cleanAuthParams() {
  try {
    const url = new URL(window.location.href);
    const paramsToRemove = ['code', 'error', 'error_code', 'error_description', 'insforge_code', 'insforge_status', 'insforge_type', 'insforge_error'];
    paramsToRemove.forEach(p => url.searchParams.delete(p));
    
    if (window.location.hash && (window.location.hash.includes('access_token') || window.location.hash.includes('error'))) {
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    } else {
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    }
  } catch (e) {
    console.warn('Failed to clean auth URL params:', e);
  }
}

async function initAuth() {
  const isLocalDev = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '0.0.0.0' ||
    (typeof import.meta !== 'undefined' && import.meta.env?.DEV === true)
  );
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isStrict = urlParams?.get('strict_auth') === 'true';

  let authUser = null;
  try {
    const { data } = await insforge.auth.getCurrentUser();
    authUser = data?.user;
  } catch (e) {
    console.warn('Current user check:', e);
  }
  cleanAuthParams();

  // 🚀 LOCAL DEV AUTO-LOGIN (npm run dev): Open admin panel directly without requiring login
  if (isLocalDev && !isStrict) {
    if (!authUser) {
      authUser = {
        id: 'dev-admin-local',
        email: 'arfatalis451@gmail.com',
        user_metadata: { name: 'Admin (Dev Mode)' }
      };
    }
  }

  if (!authUser) {
    redirectToLogin();
    return;
  }
  currentUser = authUser;
  await handleAuthenticated();
}

async function handleAuthenticated() {
  const email = currentUser?.email || 'arfatalis451@gmail.com';
  if ($('admin-email')) $('admin-email').textContent = email;
  const name = email.split('@')[0];
  if ($('admin-greeting')) $('admin-greeting').textContent = `Hello, ${name.charAt(0).toUpperCase() + name.slice(1)}`;
  if ($('admin-avatar')) $('admin-avatar').textContent = name.charAt(0).toUpperCase();

  const isAdmin = await checkAdminAccess();
  hide($('auth-loading'));
  if (!isAdmin) {
    show($('unauthorized-screen'));
    return;
  }

  show($('dashboard'));
  if (window.innerWidth >= 1024) {
    $('sidebar')?.classList.remove('open');
    if (localStorage.getItem('adm_sidebar_collapsed') === 'true') {
      $('dashboard')?.classList.add('sidebar-collapsed');
    }
  }
  await refreshDashboard();
}

let adminRealtimeSubscription = null;
let adminPollingTimer = null;

function cleanupAdminRealtime() {
  if (adminRealtimeSubscription) {
    try {
      const client = (typeof insforge !== 'undefined' && insforge.removeChannel) ? insforge : (typeof supabase !== 'undefined' ? supabase : null);
      if (client && typeof client.removeChannel === 'function') {
        client.removeChannel(adminRealtimeSubscription);
      }
    } catch (e) {}
    adminRealtimeSubscription = null;
  }
  if (adminPollingTimer) {
    clearTimeout(adminPollingTimer);
    adminPollingTimer = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    cleanupAdminRealtime();
  });
}

function initDashboardAuth() {
  const doLogout = async () => {
    cleanupAdminRealtime();
    try { localStorage.removeItem('limra_dev_admin'); } catch (e) {}
    try { localStorage.removeItem('limra_cached_orders'); } catch (e) {}
    try { localStorage.removeItem('limra_cached_order_items'); } catch (e) {}
    try { offlineSync.clearSensitiveUserData(); } catch (e) {}
    if (insforge.realtime && typeof insforge.realtime.teardownAll === 'function') {
      await insforge.realtime.teardownAll();
    }
    await insforge.auth.signOut();
    redirectToLogin();
  };

  $('logout-btn')?.addEventListener('click', doLogout);
  $('unauth-logout-btn')?.addEventListener('click', doLogout);
}

// ── Unified Sidebar Toggle (On / Off) ──────────────────────
export function toggleSidebar(forceState) {
  const dashboard = $('dashboard');
  const sidebar = $('sidebar');
  const overlay = $('sidebar-overlay');
  if (!dashboard || !sidebar) return;

  if (window.innerWidth >= 1024) {
    // Desktop: Collapse / Expand sidebar
    const isCurrentlyCollapsed = dashboard.classList.contains('sidebar-collapsed');
    const shouldCollapse = (typeof forceState === 'boolean') ? forceState : !isCurrentlyCollapsed;

    if (shouldCollapse) {
      dashboard.classList.add('sidebar-collapsed');
      localStorage.setItem('adm_sidebar_collapsed', 'true');
      $('sidebar-toggle')?.setAttribute('title', 'Turn on sidebar (Ctrl+B)');
      $('pos-sidebar-toggle-btn')?.setAttribute('title', 'Turn on sidebar (Ctrl+B)');
    } else {
      dashboard.classList.remove('sidebar-collapsed');
      localStorage.setItem('adm_sidebar_collapsed', 'false');
      $('sidebar-toggle')?.setAttribute('title', 'Turn off sidebar (Ctrl+B)');
      $('pos-sidebar-toggle-btn')?.setAttribute('title', 'Turn off sidebar (Ctrl+B)');
    }
  } else {
    // Mobile / Tablet: Open / Close sidebar drawer
    const shouldOpen = (typeof forceState === 'boolean') ? forceState : !sidebar.classList.contains('open');
    if (shouldOpen) {
      sidebar.classList.add('open');
      show(overlay);
    } else {
      sidebar.classList.remove('open');
      hide(overlay);
    }
  }
}
window.toggleSidebar = toggleSidebar;

function initDashboardUI() {
  document.querySelectorAll('.adm-nav-item[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
  });

  // Client-side panel routing with browser back/forward support (popstate)
  window.addEventListener('popstate', (e) => {
    const hash = window.location.hash;
    const match = hash.match(/#panel=([a-z0-9-]+)/);
    const panel = e.state?.panel || (match ? match[1] : 'dashboard');
    if (panel) {
      switchPanel(panel, false);
    }
  });

  // Restore active panel from URL hash on load
  const initialHashMatch = window.location.hash.match(/#panel=([a-z0-9-]+)/);
  if (initialHashMatch && initialHashMatch[1]) {
    switchPanel(initialHashMatch[1], false);
  }

  const editorZoneTrigger = $('editor-zone-trigger');
  const editorZoneItems = $('editor-zone-items');
  if (editorZoneTrigger && editorZoneItems) {
    editorZoneTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = editorZoneItems.style.display === 'flex';
      if (isExpanded) {
        editorZoneItems.style.display = 'none';
        editorZoneTrigger.classList.remove('expanded');
      } else {
        editorZoneItems.style.display = 'flex';
        editorZoneTrigger.classList.add('expanded');
      }
    });
  }

  $('refresh-btn').addEventListener('click', () => {
    warmUpAudio();
    refreshDashboard(true);
  });

  // Notification center click listeners
  const notifBtn = $('notification-btn');
  const notifDropdown = $('notification-dropdown');
  const clearNotifBtn = $('clear-notifications-btn');
  
  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = notifDropdown.classList.contains('adm-hidden');
      if (isHidden) {
        show(notifDropdown);
        renderNotifications(); // Refresh count when opening
      } else {
        hide(notifDropdown);
      }
    });
    
    document.addEventListener('click', (e) => {
      if (!notifDropdown.classList.contains('adm-hidden') &&
          !notifDropdown.contains(e.target) &&
          e.target !== notifBtn &&
          !notifBtn.contains(e.target)) {
        hide(notifDropdown);
      }
    });

    const voiceToggle = $('toggle-voice-announcements');
    if (voiceToggle) {
      voiceToggle.checked = isVoiceAnnouncementEnabled();
    }
  }
  
  if (clearNotifBtn) {
    clearNotifBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await insforge.database.from('notifications').update({ is_read: true }).eq('is_read', false);
        activeNotifications.forEach(n => n.is_read = true);
        renderNotifications();
        setTimeout(() => hide(notifDropdown), 300);
        refreshDashboard(false);
      } catch (err) {
        console.warn('Failed to clear notifications:', err);
      }
    });
  }

  // Warm up AudioContext on any user gesture so chime works
  document.addEventListener('click', warmUpAudio, { once: true });
  document.addEventListener('keydown', warmUpAudio, { once: true });

  // ── Order List Tabs (Live Orders vs Recent Bills) ─────────
  function switchOrdersViewTab(tab) {
    const liveBtn = $('tab-orders-live');
    const billsBtn = $('tab-orders-bills');
    const liveSec = $('orders-live-section');
    const billsSec = $('orders-bills-section');

    if (tab === 'bills') {
      liveBtn?.classList.remove('adm-btn-primary');
      liveBtn?.classList.add('adm-btn-outline');
      billsBtn?.classList.remove('adm-btn-outline');
      billsBtn?.classList.add('adm-btn-primary');
      if (liveSec) liveSec.style.display = 'none';
      if (billsSec) billsSec.style.display = 'block';
      renderBillingTotalBills();
    } else {
      billsBtn?.classList.remove('adm-btn-primary');
      billsBtn?.classList.add('adm-btn-outline');
      liveBtn?.classList.remove('adm-btn-outline');
      liveBtn?.classList.add('adm-btn-primary');
      if (liveSec) liveSec.style.display = 'block';
      if (billsSec) billsSec.style.display = 'none';
      renderOrdersTable();
    }
  }

  $('tab-orders-live')?.addEventListener('click', () => switchOrdersViewTab('live'));
  $('tab-orders-bills')?.addEventListener('click', () => switchOrdersViewTab('bills'));

  $('orders-status-filter')?.addEventListener('change', () => { ordersPage = 1; renderOrdersTable(); });
  $('orders-payment-filter')?.addEventListener('change', () => { ordersPage = 1; renderOrdersTable(); });
  $('orders-date-filter')?.addEventListener('change', () => { ordersPage = 1; renderOrdersTable(); });

  // Dashboard Date Search Listeners
  const dashPresets = document.querySelectorAll('#dash-date-presets .dash-preset-btn');
  dashPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      dashPresets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeDashDatePreset = btn.dataset.preset;
      const input = $('dash-date-input');
      if (input) input.value = '';
      renderDashboardDateFilter();
    });
  });

  $('dash-date-input')?.addEventListener('change', () => {
    dashPresets.forEach(b => b.classList.remove('active'));
    activeDashDatePreset = null;
    renderDashboardDateFilter();
  });

  $('dash-date-clear')?.addEventListener('click', () => {
    dashPresets.forEach(b => b.classList.remove('active'));
    const todayBtn = document.querySelector('#dash-date-presets .dash-preset-btn[data-preset="today"]');
    if (todayBtn) todayBtn.classList.add('active');
    activeDashDatePreset = 'today';
    const input = $('dash-date-input');
    if (input) input.value = '';
    renderDashboardDateFilter();
  });
  
  const typePills = document.querySelectorAll('#order-type-pills button');
  typePills.forEach(pill => {
    pill.addEventListener('click', () => {
      typePills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeOrderTypeFilter = pill.dataset.type;
      ordersPage = 1;
      renderOrdersTable();
    });
  });

  $('orders-export-csv-btn')?.addEventListener('click', exportOrdersListCSV);
  $('orders-search')?.addEventListener('input', () => { ordersPage = 1; renderOrdersTable(); });
  $('hold-orders-search')?.addEventListener('input', renderHoldOrdersPanel);
  $('customers-search')?.addEventListener('input', renderCustomers);
  $('analysis-search')?.addEventListener('input', renderCustomerAnalysis);
  $('analysis-date-filter')?.addEventListener('change', renderCustomerAnalysis);
  $('analysis-date-clear')?.addEventListener('click', () => {
    const input = $('analysis-date-filter');
    if (input) input.value = '';
    renderCustomerAnalysis();
  });
  $('export-customer-analysis-btn')?.addEventListener('click', exportCustomerAnalysisToExcel);
  $('bookings-type-filter')?.addEventListener('change', () => { renderBookingsList(); renderBookingCalendar(); });
  $('bookings-status-filter')?.addEventListener('change', renderBookingsList);
  $('foods-category-filter')?.addEventListener('change', renderFoods);
  $('foods-search')?.addEventListener('input', renderFoods);
  $('order-detail-back')?.addEventListener('click', () => switchPanel('orders'));
  $('order-detail-picker')?.addEventListener('change', e => {
    const id = e.target.value;
    if (id) {
      openOrderDetailDrawer(id);
    } else {
      selectedOrderId = null;
      closeOrderDetailDrawer();
    }
  });

  $('global-search')?.addEventListener('input', () => {
    const q = getGlobalSearch();
    if (q) switchPanel('orders');
    renderOrdersTable();
    renderCustomers();
    renderCustomerAnalysis();
  });

  // Restore saved desktop sidebar collapsed preference on load
  if (window.innerWidth >= 1024 && localStorage.getItem('adm_sidebar_collapsed') === 'true') {
    $('dashboard')?.classList.add('sidebar-collapsed');
    $('sidebar-toggle')?.setAttribute('title', 'Turn on sidebar (Ctrl+B)');
    $('pos-sidebar-toggle-btn')?.setAttribute('title', 'Turn on sidebar (Ctrl+B)');
  }

  $('sidebar-toggle')?.addEventListener('click', () => toggleSidebar());
  $('pos-sidebar-toggle-btn')?.addEventListener('click', () => toggleSidebar());

  $('sidebar-close-btn')?.addEventListener('click', () => {
    if (window.innerWidth >= 1024) {
      toggleSidebar(true);
    } else {
      toggleSidebar(false);
    }
  });

  $('sidebar-overlay')?.addEventListener('click', () => {
    toggleSidebar(false);
  });

  // Global Keyboard shortcut: Ctrl+B or Cmd+B to toggle sidebar On / Off
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag !== 'input' && activeTag !== 'textarea') {
        e.preventDefault();
        toggleSidebar();
      }
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) {
      $('sidebar')?.classList.remove('open');
      hide($('sidebar-overlay'));
      if (localStorage.getItem('adm_sidebar_collapsed') === 'true') {
        $('dashboard')?.classList.add('sidebar-collapsed');
      } else {
        $('dashboard')?.classList.remove('sidebar-collapsed');
      }
    } else {
      $('dashboard')?.classList.remove('sidebar-collapsed');
    }
  });

  // Printer status badge click listener
  $('printer-status')?.addEventListener('click', () => {
    selectQZPrinter();
  });

  // Manual Print button click listener
  $('print-receipt-btn')?.addEventListener('click', () => {
    const id = selectedOrderId || $('order-detail-picker')?.value;
    const order = orders.find(o => o.id === id);
    if (order) {
      printOrderReceipt(order);
    } else {
      showAdminToast('Please select an order to print.', 'error');
    }
  });

  // Connect to QZ Tray
  initQZTray();

  // ════════════════════════════════════════════════════════
  // 📡 REALTIME WEBSOCKET LISTENER & ADAPTIVE POLLING
  // Replaces aggressive 10s polling to drop Log Ingestion by >80%
  let lastUserActivityTime = Date.now();
  const NORMAL_POLL_INTERVAL = 35000; // 35 seconds (safety heartbeat)
  const IDLE_POLL_INTERVAL = 90000;   // 90 seconds when terminal is idle (> 5 min)
  const IDLE_THRESHOLD = 300000;      // 5 minutes

  function trackAdminActivity() {
    lastUserActivityTime = Date.now();
  }

  let realtimeDebounceTimer = null;
  let realtimeReconnectTimer = null;

  function scheduleRealtimeRefresh(delayMs = 120) {
    if (realtimeDebounceTimer) clearTimeout(realtimeDebounceTimer);
    realtimeDebounceTimer = setTimeout(() => {
      realtimeDebounceTimer = null;
      refreshDashboard(false);
    }, delayMs);
  }

  function initAdminRealtime() {
    if (adminRealtimeSubscription) {
      try {
        const client = (typeof insforge !== 'undefined' && insforge.removeChannel) ? insforge : (typeof supabase !== 'undefined' ? supabase : null);
        if (client && typeof client.removeChannel === 'function') {
          client.removeChannel(adminRealtimeSubscription);
        }
      } catch (e) {}
      adminRealtimeSubscription = null;
    }

    if (realtimeReconnectTimer) {
      clearTimeout(realtimeReconnectTimer);
      realtimeReconnectTimer = null;
    }

    try {
      const client = (typeof insforge !== 'undefined' && insforge.channel) ? insforge : (typeof supabase !== 'undefined' ? supabase : null);
      if (!client || typeof client.channel !== 'function') return;

      const channelName = `limra-admin-realtime-${Date.now()}`;
      adminRealtimeSubscription = client
        .channel(channelName)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
          console.log('[Realtime] Instant order event:', payload.eventType);
          scheduleRealtimeRefresh();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, (payload) => {
          console.log('[Realtime] Instant order_items event:', payload.eventType);
          scheduleRealtimeRefresh();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, (payload) => {
          console.log('[Realtime] Instant notification event:', payload.eventType);
          scheduleRealtimeRefresh();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, (payload) => {
          console.log('[Realtime] Instant booking event:', payload.eventType);
          scheduleRealtimeRefresh();
        })
        .subscribe((status, err) => {
          console.log('[Realtime] Admin live event stream status:', status, err || '');
          if (status === 'SUBSCRIBED') {
            // Reconcile committed database state upon initial connect or reconnect
            scheduleRealtimeRefresh(50);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.warn(`[Realtime] Subscription interrupted (${status}), scheduling reconnect in 5s...`);
            adminRealtimeSubscription = null;
            if (realtimeReconnectTimer) clearTimeout(realtimeReconnectTimer);
            realtimeReconnectTimer = setTimeout(() => {
              realtimeReconnectTimer = null;
              initAdminRealtime();
            }, 5000);
          }
        });
    } catch (err) {
      console.warn('[Realtime] Setup error, relying on adaptive heartbeat:', err);
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      console.log('[Network] Browser back online. Triggering immediate realtime reconnect, outbox sync, and dashboard refresh...');
      initAdminRealtime();
      refreshDashboard(true);
      if (typeof offlineSync !== 'undefined' && offlineSync && typeof offlineSync.triggerSync === 'function') {
        offlineSync.triggerSync();
      }
    });
  }

  function setupSmartPolling() {
    if (typeof window !== 'undefined') {
      ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
        window.addEventListener(evt, trackAdminActivity, { passive: true });
      });
    }

    function scheduleNextPoll() {
      if (adminPollingTimer) clearTimeout(adminPollingTimer);

      // If browser tab is hidden/minimized, completely pause HTTP polling to save log ingestion
      if (typeof document !== 'undefined' && document.hidden) {
        adminPollingTimer = setTimeout(scheduleNextPoll, 20000);
        return;
      }

      const isIdle = (Date.now() - lastUserActivityTime) > IDLE_THRESHOLD;
      const interval = isIdle ? IDLE_POLL_INTERVAL : NORMAL_POLL_INTERVAL;

      adminPollingTimer = setTimeout(async () => {
        if (typeof document !== 'undefined' && !document.hidden) {
          await refreshDashboard(false);
        }
        scheduleNextPoll();
      }, interval);
    }

    resetAdminPollingTimer = scheduleNextPoll;
    scheduleNextPoll();

    // Immediate delta sync when returning to tab from background
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          refreshDashboard(false);
          scheduleNextPoll();
        }
      });
    }
  }

  initAdminRealtime();
  setupSmartPolling();

  // Setup modal listeners for menu editor, coupon manager, and combo manager
  setupEditModalListeners();
  setupCouponModalListeners();
  setupComboModalListeners();
  setupPlaceModalListeners();
  setupCouponShareModalListeners();
  initHoldModalListeners();
  initHoldSettleModalListeners();
  initClosedOrdersListeners();
  initItemsReportListeners();
  initOrdersReportListeners();
  initCustomersListeners();
  initFoodsToolbarListeners();
  initCombosListeners();
  initCouponsListeners();
  initDashboardQuickListeners();
  initGSTSectionListeners();
  initQuickBillAdjusterListeners();
  initTablesAndKitchenUI();
  initPrintQueueUI();
  initOfflineSyncPOS();
  initSalesReportHub();
}

function initOfflineSyncPOS() {
  if (typeof offlineSync === 'undefined' || !offlineSync) return;

  offlineSync.initSyncIndicator('sync-indicator');

  offlineSync.subscribe((event) => {
    if (!event) return;

    if (event.type === 'pos_order_synced') {
      const { localId, serverOrder } = event;
      if (serverOrder && serverOrder.id) {
        const existingIdx = orders.findIndex(o => String(o.id) === String(localId));
        if (existingIdx !== -1) {
          const oldOrder = orders[existingIdx];
          orders[existingIdx] = { ...oldOrder, ...serverOrder, _isOfflineQueued: false };
          orderItems.forEach(i => {
            if (String(i.order_id) === String(localId)) {
              i.order_id = serverOrder.id;
            }
          });
          persistOrdersCache();
        }
        showAdminToast(`Order #${serverOrder.order_number || serverOrder.id} synced to cloud`, 'success');
        renderOrdersTable();
        renderHoldOrdersPanel();
        renderBillingQuickCards();
        renderBillingTotalBills();
        renderTablesPanel();
      }
    } else if (event.type === 'pos_settlement_confirmed') {
      const { orderId, serverResult, paymentMethod } = event;
      // Authoritative confirmation received! Mark order paid and closed in memory
      const targetOrder = orders.find(o => String(o.id) === String(orderId));
      if (targetOrder) {
        targetOrder.payment_status = 'paid';
        targetOrder.status = 'delivered';
        targetOrder.ticket_status = 'CLOSED';
        targetOrder._settlementPendingSync = false;
        targetOrder.payment_method = paymentMethod || targetOrder.payment_method;
        if (serverResult && serverResult.closed_at) {
          targetOrder.closed_at = serverResult.closed_at;
        }
        persistOrdersCache();
      }
      if (targetOrder && targetOrder.table_number) {
        const tableNum = String(targetOrder.table_number).trim();
        const tbl = diningTables.find(t => String(t.number) === tableNum);
        if (tbl && tbl.status === 'billed') {
          tbl.status = 'available';
          tbl.current_order_id = null;
        }
      }
      showAdminToast(`Settlement confirmed by cloud for Order #${targetOrder?.order_number || orderId}`, 'success');
      renderOrdersTable();
      renderClosedOrdersPanel();
      renderTablesPanel();
      renderBillingQuickCards();
      renderBillingTotalBills();
    } else if (event.type === 'pos_bill_confirmed') {
      const { orderId, serverOrder } = event;
      const targetOrder = orders.find(o => String(o.id) === String(orderId));
      if (targetOrder && serverOrder) {
        Object.assign(targetOrder, serverOrder);
        targetOrder._isOfflineQueued = false;
        persistOrdersCache();
      }
      showAdminToast(`Bill confirmed on cloud for Order #${serverOrder?.order_number || orderId}`, 'info');
      renderOrdersTable();
      renderTablesPanel();
      renderBillingTotalBills();
    } else if (event.type === 'pos_order_updated') {
      const { orderId, serverOrder } = event;
      const targetOrder = orders.find(o => String(o.id) === String(orderId));
      if (targetOrder && serverOrder) {
        Object.assign(targetOrder, serverOrder);
        targetOrder._isOfflineQueued = false;
        persistOrdersCache();
      }
      showAdminToast(`Order #${serverOrder?.order_number || orderId} update synced`, 'success');
      renderOrdersTable();
    } else if (event.type === 'admin_mutation_conflict') {
      showAdminToast(`Sync conflict on job ${event.jobId}: ${event.error}`, 'error');
    }
  });
}

// Ensure sales report hub is also initialized on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initSalesReportHub());
} else {
  initSalesReportHub();
}

// ════════════════════════════════════════════════════════
// 🗂️ PRINT QUEUE MODAL & ALERT BAR ENGINE (Phase 3)
// ════════════════════════════════════════════════════════

function initPrintQueueUI() {
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
    // 0. Auto-prune failed jobs for orders that are already settled/paid in cloud database
    if (orders && orders.length > 0) {
      const paidOrderIds = new Set(orders.filter(o => o.payment_status === 'paid' || o.ticket_status === 'CLOSED').map(o => String(o.id)));
      const paidOrderNums = new Set(orders.filter(o => o.payment_status === 'paid' || o.ticket_status === 'CLOSED').map(o => String(o.order_number)));
      if (typeof printQueue.clearStaleJobsForPaidOrders === 'function') {
        printQueue.clearStaleJobsForPaidOrders(paidOrderIds, paidOrderNums);
      }
    }

    const failedJobs = jobs.filter(j => j.status === 'failed');
    const failedCount = failedJobs.length;

    // 1. Badge in header
    if (badgeEl) {
      if (failedCount > 0) {
        badgeEl.textContent = failedCount;
        badgeEl.classList.remove('adm-hidden');
      } else {
        badgeEl.classList.add('adm-hidden');
      }
    }

    // 2. Alert bar under header
    if (alertBar && alertMsg) {
      if (failedCount > 0 && !alertDismissed) {
        const latest = failedJobs[0];
        alertMsg.textContent = `Print failed for ${latest.type} #${latest.orderNumber} (${latest.error || 'Printer Offline'}) — Check connection & retry.`;
        alertBar.classList.remove('adm-hidden');
      } else {
        alertBar.classList.add('adm-hidden');
      }
    }

    // 3. Modal KPIs
    if (kpiTotal) kpiTotal.textContent = `Total Jobs: ${jobs.length}`;
    if (kpiFailed) kpiFailed.textContent = `Failed: ${failedCount}`;

    // 4. Modal Table Body
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

      // Wire row actions
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

  // Subscribe to queue changes
  printQueue.subscribe(updateQueueUI);

  // Modal open / close
  btnOpenQueue?.addEventListener('click', () => {
    if (modal) modal.style.display = 'flex';
  });

  modalClose?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  // Retry all failed
  btnRetryAll?.addEventListener('click', async () => {
    showAdminToast('Retrying all failed print jobs…', 'info');
    await printQueue.retryAllFailed();
  });

  // Clear printed
  btnClearPrinted?.addEventListener('click', () => {
    printQueue.clearPrinted();
    showAdminToast('Cleared printed jobs from history.', 'info');
  });

  // Alert bar retry & dismiss
  alertRetryBtn?.addEventListener('click', async () => {
    alertRetryBtn.disabled = true;
    alertRetryBtn.textContent = '⏳ Retrying…';
    await printQueue.retryAllFailed();
    alertRetryBtn.disabled = false;
    alertRetryBtn.textContent = '🔄 Retry Print';
  });

  alertDismissBtn?.addEventListener('click', () => {
    alertDismissed = true;
    if (typeof printQueue.clearFailed === 'function') {
      printQueue.clearFailed();
    }
    alertBar?.classList.add('adm-hidden');
  });
}

try { initDashboardAuth(); } catch(e) { console.warn('initDashboardAuth error:', e); }
try { initDashboardUI(); } catch(e) { console.warn('initDashboardUI error:', e); }
try { initAuth(); } catch(e) { console.warn('initAuth error:', e); }
try { loadPrinterSettingsFromDB(); } catch(e) { console.warn('loadPrinterSettingsFromDB error:', e); }

// ═══════════════════════════════════════
// QZ TRAY PRINTING INTEGRATION
// ═══════════════════════════════════════
let qzConnected = false;
let activePrinter = null;

function updatePrinterStatusBadge(status, message) {
  const badge = $('printer-status');
  if (!badge) return;
  
  if (status === 'connected') {
    badge.textContent = `🖨️ Printer: ${message}`;
    badge.style.background = 'rgba(0, 176, 116, 0.12)';
    badge.style.color = 'var(--adm-green)';
  } else if (status === 'connecting') {
    badge.textContent = '🔄 Connecting...';
    badge.style.background = 'rgba(242, 153, 74, 0.12)';
    badge.style.color = '#f2994a';
  } else {
    badge.textContent = '🔌 Printer Off';
    badge.style.background = 'rgba(255, 91, 91, 0.12)';
    badge.style.color = '#ff5b5b';
  }
}

async function initQZTray() {
  if (typeof qz === 'undefined') {
    console.warn('[QZ] qz-tray SDK is not loaded.');
    updatePrinterStatusBadge('disconnected');
    return;
  }
  
  updatePrinterStatusBadge('connecting');
  
  try {
    // Check if already connected
    if (qz.websocket.isActive()) {
      qzConnected = true;
    } else {
      await qz.websocket.connect();
      qzConnected = true;
    }
    
    console.log('[QZ] Connected to QZ Tray local WebSocket.');
    
    // Retrieve default printer from localStorage or system
    let printerName = localStorage.getItem('qz-printer-name');
    if (!printerName) {
      try {
        const printers = await qz.printers.find();
        const tvsPrinter = printers?.find(p => /tvs/i.test(p) || /rp\s*3200/i.test(p) || /rp\s*3160/i.test(p) || /rp\s*3220/i.test(p));
        if (tvsPrinter) {
          printerName = tvsPrinter;
        } else {
          printerName = await qz.printers.getDefault();
        }
        if (printerName) {
          localStorage.setItem('qz-printer-name', printerName);
        }
      } catch (err) {
        console.warn('[QZ] Could not fetch default system printer:', err);
      }
    }
    
    if (printerName) {
      activePrinter = printerName;
      updatePrinterStatusBadge('connected', printerName);
    } else {
      updatePrinterStatusBadge('connected', 'TVS RP3200 Plus');
    }
  } catch (err) {
    console.warn('[QZ] Connection to QZ Tray failed:', err);
    qzConnected = false;
    updatePrinterStatusBadge('disconnected');
  }
}

async function selectQZPrinter() {
  if (typeof qz === 'undefined') {
    alert('QZ Tray SDK is not loaded. Make sure the dashboard script loaded properly.');
    return;
  }
  
  if (!qzConnected) {
    // Try to connect first
    await initQZTray();
    if (!qzConnected) {
      alert('Could not connect to QZ Tray. Please ensure that QZ Tray is running on your computer (typically at wss://localhost:8182).');
      return;
    }
  }
  
  try {
    const printers = await qz.printers.find();
    if (!printers || printers.length === 0) {
      alert('No printers found on your system.');
      return;
    }
    
    // Simple prompt for printer selection
    const savedPrinter = localStorage.getItem('qz-printer-name') || '';
    const printerPromptText = `Enter the exact name of your Thermal Receipt Printer from the list below:\n\n${printers.join('\n')}`;
    const selected = prompt(printerPromptText, savedPrinter);
    
    if (selected !== null) {
      const trimmed = selected.trim();
      if (trimmed) {
        localStorage.setItem('qz-printer-name', trimmed);
        activePrinter = trimmed;
        updatePrinterStatusBadge('connected', trimmed);
        showAdminToast(`Active printer set to: ${trimmed}`, 'success');
      } else {
        localStorage.removeItem('qz-printer-name');
        activePrinter = null;
        updatePrinterStatusBadge('connected', 'None Selected');
      }
    }
  } catch (err) {
    console.error('[QZ] Error listing printers:', err);
    alert('Failed to retrieve system printers: ' + err.message);
  }
}

function generateReceiptHtml(order) {
  const items = getItemsForOrder(order.id);
  const itemsSubtotal = items.reduce((s, i) => s + Number(i.line_total), 0);
  const parsedMeta = parseNotesMetadata(order.notes, order);
  
  // Format items rows
  const itemRowsHtml = items.map(item => {
    return `
      <tr>
        <td style="padding: 5px 0; font-family: monospace; font-size: 12px; color: #000; text-align: left; vertical-align: top;">
          ${escapeHtml(item.item_name)}
        </td>
        <td style="padding: 5px 0; font-family: monospace; font-size: 12px; color: #000; text-align: center; vertical-align: top;">
          ${item.quantity}
        </td>
        <td style="padding: 5px 0; font-family: monospace; font-size: 12px; color: #000; text-align: right; vertical-align: top;">
          ₹${Number(item.unit_price).toFixed(2)}
        </td>
        <td style="padding: 5px 0; font-family: monospace; font-size: 12px; color: #000; text-align: right; vertical-align: top;">
          ₹${Number(item.line_total).toFixed(2)}
        </td>
      </tr>
    `;
  }).join('');

  const formattedDate = new Date(order.created_at).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  
  const paymentMethod = parsedMeta.payment ? parsedMeta.payment.toUpperCase() : (parsedMeta.type === 'table' ? 'PAY AT RESTAURANT' : 'COD');
  const paymentStatus = (order.payment_status || 'unpaid').toUpperCase();
  
  let deliverySectionHtml = '';
  if (parsedMeta.type === 'delivery') {
    deliverySectionHtml = `
      <div style="border-top: 1px dashed #000; padding: 8px 0; font-family: monospace; font-size: 11px; line-height: 1.4; color: #000;">
        <div style="font-weight: bold; margin-bottom: 2px;">DELIVERY ADDRESS:</div>
        <div>${escapeHtml(parsedMeta.address || 'No address specified')}</div>
        ${parsedMeta.area ? `<div>Selected Area: ${escapeHtml(parsedMeta.area)}</div>` : ''}
        ${order.landmark ? `<div>Landmark: ${escapeHtml(order.landmark)}</div>` : ''}
        ${order.delivery_notes ? `<div style="margin-top: 3px; font-style: italic;">Note: ${escapeHtml(order.delivery_notes)}</div>` : ''}
      </div>
    `;
  } else if (parsedMeta.type === 'table') {
    deliverySectionHtml = `
      <div style="border-top: 1px dashed #000; padding: 8px 0; font-family: monospace; font-size: 12px; line-height: 1.4; color: #000; text-align: center; font-weight: bold;">
        🪑 DINE-IN TABLE: Table ${parsedMeta.tableNumber} (${order.table_zone || 'Indoor'})
      </div>
    `;
  }

  const customNoteSection = parsedMeta.customNote ? `
    <div style="border-top: 1px dashed #000; padding: 6px 0; font-family: monospace; font-size: 11px; line-height: 1.4; color: #000;">
      <span style="font-weight: bold;">Instructions:</span> ${escapeHtml(parsedMeta.customNote)}
    </div>
  ` : '';

  return `
    <div style="width: 100%; max-width: 100%; font-family: monospace; font-size: 12px; color: #000; background: #fff; padding: 0; margin: 0; box-sizing: border-box;">
      <!-- Header -->
      <div style="text-align: center; margin-bottom: 12px;">
        <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: 1px;">LIMRA RESTAURANT</h2>
        <div style="font-size: 11px; margin-top: 2px;">Vasant Kunj, New Delhi</div>
        <div style="font-size: 11px;">Phone: +91 99999 88888</div>
        <div style="font-size: 13px; font-weight: bold; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 5px 0; margin-top: 8px; text-transform: uppercase;">
          ${parsedMeta.type === 'delivery' ? '🚗 DELIVERY BILL' : (parsedMeta.type === 'table' ? '🍽️ DINE-IN BILL' : '🥡 PICKUP BILL')}
        </div>
      </div>
      
      <!-- Order details -->
      <div style="margin-bottom: 8px; font-family: monospace; font-size: 11px; line-height: 1.3; color: #000;">
        <div><strong>Order No:</strong> #${formatDailyOrderNumber(order)}</div>
        <div><strong>Date:</strong> ${formattedDate}</div>
        <div><strong>Customer:</strong> ${escapeHtml(order.customer_name)}</div>
        <div><strong>Phone:</strong> ${escapeHtml(order.customer_phone)}</div>
      </div>
      
      <!-- Items table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px; border-bottom: 1px dashed #000;">
        <thead>
          <tr style="border-bottom: 1px dashed #000;">
            <th style="padding-bottom: 5px; font-family: monospace; font-size: 11px; color: #000; text-align: left;">Item</th>
            <th style="padding-bottom: 5px; font-family: monospace; font-size: 11px; color: #000; text-align: center; width: 30px;">Qty</th>
            <th style="padding-bottom: 5px; font-family: monospace; font-size: 11px; color: #000; text-align: right; width: 60px;">Price</th>
            <th style="padding-bottom: 5px; font-family: monospace; font-size: 11px; color: #000; text-align: right; width: 65px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRowsHtml}
        </tbody>
      </table>
      
      <!-- Financial summary -->
      <div style="font-family: monospace; font-size: 12px; line-height: 1.4; color: #000; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between;">
          <span>Items Subtotal:</span>
          <span>₹${Number(itemsSubtotal).toFixed(2)}</span>
        </div>
        ${(() => {
          const isDel = parsedMeta.type === 'delivery' || order.order_type === 'delivery';
          const delFee = isDel ? Math.max(0, Number(order.delivery_fee ?? parsedMeta.deliveryFee ?? (parsedMeta.charge ? parsedMeta.charge.replace(/[^0-9.]/g, '') : 0))) : 0;
          return delFee > 0 ? `
          <div style="display: flex; justify-content: space-between;">
            <span>Delivery Charge:</span>
            <span>₹${Number(delFee).toFixed(2)}</span>
          </div>` : '';
        })()}
        <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 14px; border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px;">
          <span>NET AMOUNT:</span>
          <span>₹${Number(computeOrderTaxDetails(order).grandTotal || order.total_amount).toFixed(2)}</span>
        </div>
      </div>
      
      <!-- Payment status -->
      <div style="border-top: 1px dashed #000; padding: 6px 0; font-family: monospace; font-size: 11px; line-height: 1.3; color: #000;">
        <div><strong>Payment Mode:</strong> ${paymentMethod}</div>
        <div><strong>Payment Status:</strong> ${paymentStatus}</div>
      </div>
      
      <!-- Custom notes -->
      ${customNoteSection}
      
      <!-- Delivery logistics -->
      ${deliverySectionHtml}
      
      <!-- Footer -->
      <div style="text-align: center; border-top: 1px dashed #000; padding-top: 8px; margin-top: 12px; font-family: monospace; font-size: 11px; color: #000;">
        <div style="font-weight: bold;">THANK YOU FOR YOUR PATRONAGE!</div>
        <div style="margin-top: 3px;">LIMRA RESTAURANT</div>
        <div style="font-size: 9px; color: #555; margin-top: 5px;">Printed automatically via QZ Tray</div>
      </div>
    </div>
  `;
}

async function printOrderReceipt(order) {
  if (!order) {
    showAdminToast('No order selected to print.', 'error');
    return;
  }
  await printOrderReceiptWithTax(order, null, { isReprint: true });
}

// ── Coupons Management ──────────────────────────────────
// ════════════════════════════════════════════════════════
// 🏷️ COUPONS & PROMO CODES MANAGEMENT ENGINE
// ════════════════════════════════════════════════════════

let adminCoupons = [];
let couponStatusFilter = 'all';
let couponSort = 'default';
let couponSearch = '';
let editingCouponCode = null;

async function loadAndRenderCoupons() {
  try {
    const tbody = $('coupons-table-body');
    const grid = $('coupons-grid');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--adm-muted);">Loading promo codes...</td></tr>';
    if (grid) grid.innerHTML = '<div class="adm-card adm-empty" style="grid-column:1/-1;padding:2.5rem;text-align:center;">Loading promo codes...</div>';
    
    adminCoupons = await getCoupons();
    renderCouponsTable();
  } catch (err) {
    console.error('Failed to load coupons:', err);
    showAdminToast('Failed to load coupons: ' + err.message, 'error');
  }
}

function computeCouponsHubData() {
  const now = new Date();
  
  // Total active coupons
  const activeCoupons = adminCoupons.filter(c => c.active && new Date(c.expiry_date) >= now && (c.used_count || 0) < (c.max_uses || 999999)).length;
  
  // Total redemptions
  const totalRedemptions = adminCoupons.reduce((sum, c) => sum + (parseInt(c.used_count, 10) || 0), 0);
  
  // Estimate or calculate discount given from actual past orders where coupon was applied
  let discountGiven = 0;
  if (Array.isArray(orders)) {
    orders.forEach(o => {
      if (o.notes && o.notes.includes('COUPON:')) {
        const match = o.notes.match(/DISCOUNT:\s*₹?([0-9.]+)/i);
        if (match) discountGiven += parseFloat(match[1]);
      }
    });
  }
  // Fallback estimation if orders don't have discount lines
  if (discountGiven === 0 && totalRedemptions > 0) {
    discountGiven = adminCoupons.reduce((sum, c) => {
      const avgSaved = (c.min_bill || 200) * ((c.discount_pct || 10) / 100);
      return sum + ((c.used_count || 0) * avgSaved);
    }, 0);
  }

  // Top performing promo code
  let topCoupon = null;
  let maxUses = 0;
  adminCoupons.forEach(c => {
    const uses = parseInt(c.used_count, 10) || 0;
    if (uses > maxUses) {
      maxUses = uses;
      topCoupon = c.code;
    }
  });

  let list = adminCoupons.slice();

  // 1. Status Filter
  if (couponStatusFilter === 'active') {
    list = list.filter(c => c.active && new Date(c.expiry_date) >= now && (c.used_count || 0) < (c.max_uses || 999999));
  } else if (couponStatusFilter === 'expired') {
    list = list.filter(c => !c.active || new Date(c.expiry_date) < now || (c.used_count || 0) >= (c.max_uses || 999999));
  } else if (couponStatusFilter === 'autosend') {
    list = list.filter(c => c.is_auto_send);
  }

  // 2. Search Query
  const search = ($('coupons-search')?.value || couponSearch || '').toLowerCase().trim();
  if (search) {
    list = list.filter(c =>
      (c.code || '').toLowerCase().includes(search) ||
      String(c.discount_pct || '').includes(search) ||
      String(c.min_bill || '').includes(search)
    );
  }

  // 3. Sorting
  if (couponSort === 'pct_desc') {
    list.sort((a, b) => (b.discount_pct || 0) - (a.discount_pct || 0));
  } else if (couponSort === 'uses_desc') {
    list.sort((a, b) => (b.used_count || 0) - (a.used_count || 0));
  } else if (couponSort === 'min_desc') {
    list.sort((a, b) => (b.min_bill || 0) - (a.min_bill || 0));
  } else if (couponSort === 'expiry_asc') {
    list.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
  } else if (couponSort === 'code_asc') {
    list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  }

  return {
    list,
    activeCoupons,
    totalRedemptions,
    discountGiven,
    topPromoCode: topCoupon || (adminCoupons[0]?.code || '—')
  };
}

function renderCouponsTable() {
  const {
    list,
    activeCoupons,
    totalRedemptions,
    discountGiven,
    topPromoCode
  } = computeCouponsHubData();

  // 1. KPI Stat Cards
  if ($('coupon-kpi-active')) $('coupon-kpi-active').textContent = `${activeCoupons} Active`;
  if ($('coupon-kpi-redeemed')) $('coupon-kpi-redeemed').textContent = `${totalRedemptions} Uses`;
  if ($('coupon-kpi-discount-given')) $('coupon-kpi-discount-given').textContent = `₹${discountGiven.toFixed(2)}`;
  if ($('coupon-kpi-top-code')) $('coupon-kpi-top-code').textContent = topPromoCode;

  // 2. Summary Bar
  const totalPotentialUses = list.reduce((s, c) => s + (parseInt(c.max_uses, 10) || 0), 0);
  if ($('coupons-count-label')) $('coupons-count-label').textContent = `${list.length} ${list.length === 1 ? 'coupon' : 'coupons'}`;
  if ($('coupons-total-uses-label')) $('coupons-total-uses-label').textContent = `${totalPotentialUses} max uses`;

  const now = new Date();

  // 3. Render Cards Grid
  const grid = $('coupons-grid');
  if (grid) {
    if (list.length === 0) {
      grid.innerHTML = '<div class="adm-card adm-empty" style="grid-column: 1 / -1;padding:2.5rem;text-align:center;">No promo coupons match your search or filter.</div>';
    } else {
      grid.innerHTML = list.map(c => {
        const expDate = new Date(c.expiry_date);
        const isExpired = expDate < now;
        const isDepleted = (c.used_count || 0) >= (c.max_uses || 999999);
        const isLive = c.active && !isExpired && !isDepleted;
        
        // Days remaining
        const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
        const expiryLabel = isExpired ? 'Expired' : (diffDays <= 1 ? 'Expires today' : `Expires in ${diffDays} days`);
        const used = c.used_count || 0;
        const max = c.max_uses || 100;
        const usagePct = Math.min(100, Math.round((used / max) * 100));

        return `
          <div class="adm-card ${isLive ? '' : 'adm-food-card-disabled'}" data-code="${c.code}" style="display:flex;flex-direction:column;padding:1.1rem;border-radius:14px;border:1px solid var(--adm-border);background:#fff;position:relative;gap:.75rem;box-shadow:0 1px 3px rgba(0,0,0,.04);">
            
            <!-- Code Banner & Copy Button -->
            <div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem .75rem;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;">
              <div style="display:flex;align-items:center;gap:.5rem;">
                <span style="font-size:1.1rem;">🏷️</span>
                <strong style="font-family:monospace;font-size:1.15rem;letter-spacing:1px;color:#1e293b;">${c.code}</strong>
              </div>
              <button type="button" class="btn-copy-coupon-code" data-code="${c.code}" style="background:#e0e7ff;color:#4338ca;border:none;border-radius:6px;font-size:0.75rem;font-weight:700;padding:.25rem .55rem;cursor:pointer;" title="Copy Code">
                📋 Copy
              </button>
            </div>

            <!-- Discount & Status Badges -->
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="background:#dcfce7;color:#15803d;font-size:.9rem;font-weight:800;padding:.2rem .6rem;border-radius:6px;">
                ${c.discount_pct}% OFF
              </span>
              <span style="background:${isLive ? '#f0fdf4' : '#fee2e2'};color:${isLive ? '#166534' : '#b91c1c'};font-size:0.75rem;font-weight:700;padding:.15rem .45rem;border-radius:999px;">
                ${isLive ? '● Live' : (isExpired ? '✕ Expired' : '✕ Paused')}
              </span>
            </div>

            <!-- Requirements & Usage -->
            <div style="font-size:.8rem;color:#475569;display:flex;flex-direction:column;gap:.35rem;">
              <div style="display:flex;justify-content:space-between;">
                <span style="color:var(--adm-muted);">Min Order:</span>
                <strong>₹${Number(c.min_bill || 0).toFixed(2)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="color:var(--adm-muted);">Redemptions:</span>
                <strong>${used} / ${max} (${usagePct}%)</strong>
              </div>
              <div style="width:100%;height:5px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin-top:2px;">
                <div style="width:${usagePct}%;height:100%;background:${usagePct >= 90 ? '#ef4444' : '#6366f1'};"></div>
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:2px;">
                <span style="color:var(--adm-muted);">Validity:</span>
                <span style="color:${isExpired ? '#dc2626' : '#64748b'};font-weight:600;">${expiryLabel}</span>
              </div>
            </div>

            <!-- Controls & Action Buttons -->
            <div style="margin-top:auto;padding-top:.75rem;border-top:1px solid #f1f5f9;display:flex;flex-direction:column;gap:.55rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <label class="adm-toggle-label" style="font-size:.75rem;">
                  <input type="checkbox" class="coupon-toggle-active" data-code="${c.code}" ${c.active ? 'checked' : ''} />
                  <span class="adm-toggle-slider"></span>
                  <span class="adm-toggle-text">${c.active ? 'Active' : 'Inactive'}</span>
                </label>

                <label class="adm-toggle-label" style="font-size:.75rem;">
                  <input type="checkbox" class="coupon-toggle-auto-send" data-code="${c.code}" ${c.is_auto_send ? 'checked' : ''} />
                  <span class="adm-toggle-slider"></span>
                  <span class="adm-toggle-text">${c.is_auto_send ? '📢 Auto-Promo' : 'Auto-Off'}</span>
                </label>
              </div>

              <div style="display:flex;gap:.35rem;justify-content:flex-end;">
                <button type="button" class="adm-btn adm-btn-outline adm-btn-sm btn-share-coupon" data-code="${c.code}" data-pct="${c.discount_pct}" data-min="${c.min_bill}" data-expiry="${new Date(c.expiry_date).toLocaleDateString('en-IN')}" style="background:#f0fdf4;border-color:#bbf7d0;color:#15803d;font-size:.75rem;padding:.25rem .55rem;">
                  🔗 Share
                </button>
                <button type="button" class="adm-btn adm-btn-outline adm-btn-sm btn-edit-coupon" data-code="${c.code}" style="font-size:.75rem;padding:.25rem .55rem;">
                  ✏️ Edit
                </button>
                <button type="button" class="adm-btn adm-btn-outline adm-btn-sm btn-delete-coupon" data-code="${c.code}" style="font-size:.75rem;padding:.25rem .55rem;color:#ef4444;border-color:#fecaca;">
                  🗑️
                </button>
              </div>
            </div>

          </div>
        `;
      }).join('');
    }
  }

  // 4. Render Table View
  const tbody = $('coupons-table-body');
  if (tbody) {
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--adm-muted);">No coupons found. Click "+ Create Coupon" to add a new promo.</td></tr>';
    } else {
      tbody.innerHTML = list.map(c => {
        const expDate = new Date(c.expiry_date);
        const isExpired = expDate < now;
        const expiryStr = expDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const statusText = c.active && !isExpired ? 'Active' : (isExpired ? 'Expired' : 'Inactive');
        
        return `
          <tr>
            <td class="font-bold text-slate-900" style="padding:1rem;">
              <span style="font-family:monospace;background:#f1f5f9;padding:.2rem .5rem;border-radius:6px;font-size:.9rem;letter-spacing:1px;">${c.code}</span>
            </td>
            <td class="font-semibold text-emerald-600">${c.discount_pct}% OFF</td>
            <td>₹${parseFloat(c.min_bill || 0).toFixed(2)}</td>
            <td>${c.used_count || 0} / ${c.max_uses || 100} uses</td>
            <td class="${isExpired ? 'text-red-500 font-medium' : ''}">${expiryStr}</td>
            <td>
              <label class="adm-toggle-label">
                <input type="checkbox" class="coupon-toggle-auto-send" data-code="${c.code}" ${c.is_auto_send ? 'checked' : ''} />
                <span class="adm-toggle-slider"></span>
                <span class="adm-toggle-text text-xs" style="font-weight:bold;color:${c.is_auto_send ? 'var(--adm-green)' : 'var(--adm-muted)'}">
                  ${c.is_auto_send ? '★ Active Promo' : 'Off'}
                </span>
              </label>
            </td>
            <td>
              <span style="background:${c.active && !isExpired ? 'rgba(0,176,116,0.1)' : 'rgba(255,91,91,0.1)'};color:${c.active && !isExpired ? 'var(--adm-green)' : '#ff5b5b'};padding:4px 8px;border-radius:12px;font-size:0.75rem;font-weight:700;">
                ${statusText}
              </span>
            </td>
            <td style="text-align:right;">
              <div style="display:inline-flex;gap:0.35rem;">
                <button class="adm-btn adm-btn-outline adm-btn-sm btn-share-coupon" data-code="${c.code}" data-pct="${c.discount_pct}" data-min="${c.min_bill}" data-expiry="${expiryStr}" style="padding:0.25rem 0.5rem;font-size:0.75rem;background:rgba(0,176,116,0.08);color:var(--adm-green);border-color:rgba(0,176,116,0.2);">🔗 Share</button>
                <button class="adm-btn adm-btn-outline adm-btn-sm btn-edit-coupon" data-code="${c.code}" style="padding:0.25rem 0.5rem;font-size:0.75rem;">✏️ Edit</button>
                <button class="adm-btn adm-btn-outline adm-btn-sm btn-delete-coupon" data-code="${c.code}" style="padding:0.25rem 0.5rem;color:#ef4444;border-color:#fecaca;">🗑️</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  setupCouponEventListeners();
}

function setupCouponEventListeners() {
  // 1. Copy Coupon Code
  document.querySelectorAll('.btn-copy-coupon-code').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      navigator.clipboard.writeText(code);
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
      showAdminToast(`Coupon code ${code} copied to clipboard! 📋`, 'info');
    });
  });

  // 2. Active Toggle
  document.querySelectorAll('.coupon-toggle-active').forEach(cb => {
    cb.addEventListener('change', async () => {
      const code = cb.dataset.code;
      const isChecked = cb.checked;
      try {
        const coupon = adminCoupons.find(c => c.code === code);
        if (coupon) {
          coupon.active = isChecked;
          await saveCoupon(coupon);
          showAdminToast(`Coupon ${code} status updated: ${isChecked ? 'Active ✅' : 'Inactive 🚫'}`, 'success');
          loadAndRenderCoupons();
        }
      } catch (err) {
        showAdminToast('Failed to update coupon: ' + err.message, 'error');
        cb.checked = !isChecked;
      }
    });
  });

  // 3. Auto-send Toggle
  document.querySelectorAll('.coupon-toggle-auto-send').forEach(cb => {
    cb.addEventListener('change', async () => {
      const code = cb.dataset.code;
      const isChecked = cb.checked;
      try {
        const coupon = adminCoupons.find(c => c.code === code);
        if (coupon) {
          coupon.is_auto_send = isChecked;
          await saveCoupon(coupon);
          showAdminToast(`WhatsApp auto-promo ${isChecked ? 'enabled ★' : 'disabled'} for ${code}`, 'success');
          loadAndRenderCoupons();
        }
      } catch (err) {
        showAdminToast('Failed to set auto-send: ' + err.message, 'error');
        cb.checked = !isChecked;
      }
    });
  });

  // 4. Share Button
  document.querySelectorAll('.btn-share-coupon').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      const pct = btn.dataset.pct;
      const min = btn.dataset.min;
      const expiry = btn.dataset.expiry;
      
      $('share-coupon-code').value = code;
      $('share-coupon-pct').value = pct;
      $('share-coupon-min').value = min;
      $('share-coupon-expiry').value = expiry;
      $('share-customer-name').value = '';
      $('share-customer-phone').value = '';
      
      updateShareMessage();
      $('adm-coupon-share-modal').classList.add('active');
    });
  });

  // 5. Edit Button
  document.querySelectorAll('.btn-edit-coupon').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      const coupon = adminCoupons.find(c => c.code === code);
      if (coupon) {
        editingCouponCode = code;
        $('coupon-modal-title').textContent = `✏️ Edit Coupon: ${code}`;
        $('coupon-modal-code').value = coupon.code;
        $('coupon-modal-code').disabled = true;
        $('coupon-modal-pct').value = coupon.discount_pct;
        $('coupon-modal-min').value = coupon.min_bill;
        $('coupon-modal-max').value = coupon.max_uses;
        
        const expDate = new Date(coupon.expiry_date);
        const yyyy = expDate.getFullYear();
        const mm = String(expDate.getMonth() + 1).padStart(2, '0');
        const dd = String(expDate.getDate()).padStart(2, '0');
        $('coupon-modal-expiry').value = `${yyyy}-${mm}-${dd}`;
        $('coupon-modal-auto-send').checked = coupon.is_auto_send;
        
        $('adm-coupon-modal').classList.add('active');
      }
    });
  });

  // 6. Delete Button
  document.querySelectorAll('.btn-delete-coupon').forEach(btn => {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.code;
      if (!confirm(`Are you sure you want to delete coupon code "${code}"? This cannot be undone.`)) return;

      try {
        await deleteCoupon(code);
        showAdminToast(`Coupon ${code} deleted successfully.`, 'success');
        loadAndRenderCoupons();
      } catch (err) {
        showAdminToast('Failed to delete coupon: ' + err.message, 'error');
      }
    });
  });
}

function exportCouponsCSV() {
  const { list } = computeCouponsHubData();
  if (!list.length) {
    showAdminToast('No coupons to export.', 'error');
    return;
  }

  const headers = ['Coupon Code', 'Discount (%)', 'Min Bill (INR)', 'Used Count', 'Max Uses', 'Expiry Date', 'WhatsApp Auto-Send', 'Status'];
  const rows = list.map(c => [
    `"${c.code || ''}"`,
    `"${c.discount_pct || 0}"`,
    `"${Number(c.min_bill || 0).toFixed(2)}"`,
    `"${c.used_count || 0}"`,
    `"${c.max_uses || 100}"`,
    `"${new Date(c.expiry_date).toLocaleDateString('en-IN')}"`,
    `"${c.is_auto_send ? 'Yes' : 'No'}"`,
    `"${c.active ? 'Active' : 'Inactive'}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `LIMRA_Coupons_Promo_Codes_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAdminToast('Coupons exported to CSV! 📥', 'success');
}

function initCouponsListeners() {
  // Status pill buttons
  $('coupons-status-presets')?.querySelectorAll('.pos-cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      $('coupons-status-presets').querySelectorAll('.pos-cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      couponStatusFilter = btn.dataset.status;
      renderCouponsTable();
    });
  });

  // Sort & Search
  $('coupons-sort-filter')?.addEventListener('change', (e) => {
    couponSort = e.target.value;
    renderCouponsTable();
  });

  $('coupons-search')?.addEventListener('input', (e) => {
    couponSearch = e.target.value;
    renderCouponsTable();
  });

  $('coupons-export-btn')?.addEventListener('click', exportCouponsCSV);
}

function setupCouponModalListeners() {
  const modal = $('adm-coupon-modal');
  const form = $('adm-coupon-form');
  const cancelBtn = $('coupon-modal-cancel');
  const createBtn = $('btn-create-coupon');
  
  if (!modal || !form || !cancelBtn) return;
  
  createBtn?.addEventListener('click', () => {
    editingCouponCode = null;
    $('coupon-modal-title').textContent = 'Create Coupon';
    $('coupon-modal-code').value = '';
    $('coupon-modal-code').disabled = false;
    $('coupon-modal-pct').value = '10';
    $('coupon-modal-min').value = '0';
    $('coupon-modal-max').value = '100';
    $('coupon-modal-expiry').value = '';
    $('coupon-modal-auto-send').checked = false;
    
    modal.classList.add('active');
  });
  
  cancelBtn.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('coupon-modal-code').value.trim().toUpperCase();
    const pct = parseInt($('coupon-modal-pct').value, 10);
    const minBill = parseFloat($('coupon-modal-min').value) || 0;
    const maxUses = parseInt($('coupon-modal-max').value, 10) || 100;
    const expiry = $('coupon-modal-expiry').value;
    const autoSend = $('coupon-modal-auto-send').checked;
    
    if (!code) {
      alert('Please enter a coupon code');
      return;
    }
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      alert('Please enter a valid percentage (1-100)');
      return;
    }
    if (!expiry) {
      alert('Please select an expiry date');
      return;
    }
    
    const saveBtn = form.querySelector('button[type="submit"]');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    try {
      const coupon = {
        code,
        discount_pct: pct,
        min_bill: minBill,
        max_uses: maxUses,
        expiry_date: new Date(expiry).toISOString(),
        is_auto_send: autoSend,
        active: true
      };
      
      await saveCoupon(coupon);
      modal.classList.remove('active');
      loadAndRenderCoupons();
    } catch (err) {
      alert('Failed to save coupon: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Coupon';
    }
  });
}

// ── Combos Management ───────────────────────────────────
// ════════════════════════════════════════════════════════
// 🍿 COMBOS & MEAL DEALS MANAGEMENT ENGINE
// ════════════════════════════════════════════════════════

let adminCombos = [];
let comboStatusFilter = 'all';
let comboSort = 'default';
let comboSearch = '';

async function loadAndRenderCombos() {
  try {
    const tbody = $('combos-table-body');
    const grid = $('combos-grid');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--adm-muted);">Loading combo packages...</td></tr>';
    if (grid) grid.innerHTML = '<div class="adm-card adm-empty" style="grid-column:1/-1;padding:2.5rem;text-align:center;">Loading combo meal deals...</div>';
    
    adminCombos = await getCombos();
    renderCombosTable();
  } catch (err) {
    console.error('Failed to load combos:', err);
    showAdminToast('Failed to load combo packages: ' + err.message, 'error');
  }
}

function computeCombosHubData() {
  const totalCombos = adminCombos.length;
  const activeCombos = adminCombos.filter(c => c.available !== false).length;
  const avgPrice = totalCombos > 0 ? (adminCombos.reduce((s, c) => s + Number(c.price || 0), 0) / totalCombos) : 0;
  
  // Calculate average savings percentage
  let totalSavingsPct = 0;
  let savingsCount = 0;
  adminCombos.forEach(c => {
    const mrp = Number(c.mrp || 0);
    const price = Number(c.price || 0);
    if (mrp > price && mrp > 0) {
      totalSavingsPct += ((mrp - price) / mrp) * 100;
      savingsCount++;
    }
  });
  const avgSavings = savingsCount > 0 ? (totalSavingsPct / savingsCount).toFixed(0) : '0';

  let list = adminCombos.slice();

  // 1. Status Filter
  if (comboStatusFilter === 'active') {
    list = list.filter(c => c.available !== false);
  } else if (comboStatusFilter === 'inactive') {
    list = list.filter(c => c.available === false);
  }

  // 2. Search Query
  const search = ($('combos-search')?.value || comboSearch || '').toLowerCase().trim();
  if (search) {
    list = list.filter(c => {
      const name = (c.name || '').toLowerCase();
      const desc = (c.description || '').toLowerCase();
      const itemsStr = Array.isArray(c.items) ? c.items.map(i => i.name || '').join(' ').toLowerCase() : '';
      return name.includes(search) || desc.includes(search) || itemsStr.includes(search);
    });
  }

  // 3. Sorting
  if (comboSort === 'price_desc') {
    list.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  } else if (comboSort === 'price_asc') {
    list.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  } else if (comboSort === 'savings_desc') {
    list.sort((a, b) => {
      const savA = (Number(a.mrp || 0) > Number(a.price || 0)) ? ((Number(a.mrp) - Number(a.price)) / Number(a.mrp)) : 0;
      const savB = (Number(b.mrp || 0) > Number(b.price || 0)) ? ((Number(b.mrp) - Number(b.price)) / Number(b.mrp)) : 0;
      return savB - savA;
    });
  } else if (comboSort === 'name_asc') {
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  return {
    list,
    totalCombos,
    activeCombos,
    avgPrice,
    avgSavings
  };
}

function renderCombosTable() {
  const {
    list,
    totalCombos,
    activeCombos,
    avgPrice,
    avgSavings
  } = computeCombosHubData();

  // 1. KPI Stat Cards
  if ($('combo-kpi-total')) $('combo-kpi-total').textContent = `${totalCombos} Deals`;
  if ($('combo-kpi-active')) $('combo-kpi-active').textContent = `${activeCombos} Active`;
  if ($('combo-kpi-avg-price')) $('combo-kpi-avg-price').textContent = `₹${avgPrice.toFixed(2)}`;
  if ($('combo-kpi-avg-savings')) $('combo-kpi-avg-savings').textContent = `${avgSavings}% OFF`;

  // 2. Summary Bar
  const totalValue = list.reduce((s, c) => s + Number(c.price || 0), 0);
  if ($('combos-count-label')) $('combos-count-label').textContent = `${list.length} ${list.length === 1 ? 'package' : 'packages'}`;
  if ($('combos-total-val-label')) $('combos-total-val-label').textContent = `₹${totalValue.toFixed(2)}`;

  // 3. Render Cards Grid
  const grid = $('combos-grid');
  if (grid) {
    if (list.length === 0) {
      grid.innerHTML = '<div class="adm-card adm-empty" style="grid-column: 1 / -1;padding:2.5rem;text-align:center;">No combo packages match your search or filter.</div>';
    } else {
      grid.innerHTML = list.map(c => {
        const isAvailable = c.available !== false;
        const mrp = Number(c.mrp || 0);
        const price = Number(c.price || 0);
        const hasDiscount = mrp > price;
        const discountPct = hasDiscount ? Math.round(((mrp - price) / mrp) * 100) : 0;
        const items = Array.isArray(c.items) ? c.items : [];

        return `
          <div class="adm-card ${isAvailable ? '' : 'adm-food-card-disabled'}" data-combo-id="${c.id}" style="display:flex;flex-direction:column;padding:0;overflow:hidden;border-radius:14px;border:1px solid var(--adm-border);background:#fff;transition:box-shadow .2s;box-shadow:0 1px 3px rgba(0,0,0,.04);">
            
            <!-- Banner / Image Preview -->
            <div style="position:relative;width:100%;height:150px;background:#f1f5f9;overflow:hidden;">
              ${c.image_url
                ? `<img src="${c.image_url}" alt="${escapeHtml(c.name)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='/images/food_biryani.png'" />`
                : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:3.5rem;">🍿</div>`}
              
              <div style="position:absolute;top:8px;left:8px;display:flex;gap:4px;">
                ${hasDiscount ? `<span style="background:#dc2626;color:#fff;font-size:0.75rem;font-weight:800;padding:.15rem .5rem;border-radius:6px;">SAVE ${discountPct}% OFF</span>` : ''}
              </div>

              <div style="position:absolute;top:8px;right:8px;">
                <span style="background:${isAvailable ? '#10b981' : '#ef4444'};color:#fff;font-size:0.75rem;font-weight:800;padding:.15rem .5rem;border-radius:6px;">
                  ${isAvailable ? 'In Stock' : 'Paused'}
                </span>
              </div>
            </div>

            <!-- Body Info -->
            <div style="padding:1rem;display:flex;flex-direction:column;gap:.45rem;flex:1;">
              <strong style="font-size:1rem;color:#111827;line-height:1.3;">${escapeHtml(c.name)}</strong>
              ${c.description ? `<p style="font-size:.8rem;color:#6b7280;margin:0;line-height:1.4;">${escapeHtml(c.description)}</p>` : ''}
              
              <!-- Included Items Chips -->
              <div style="margin-top:2px;">
                <span style="font-size:0.75rem;color:var(--adm-muted);font-weight:600;display:block;margin-bottom:3px;">Included Dishes:</span>
                <div style="display:flex;gap:.3rem;flex-wrap:wrap;">
                  ${items.map(it => `
                    <span style="background:#f1f5f9;color:#334155;padding:.15rem .45rem;border-radius:6px;font-size:0.75rem;font-weight:600;">
                      ${it.qty > 1 ? `<strong style="color:#6366f1;">${it.qty}×</strong> ` : ''}${escapeHtml(it.name)}
                    </span>
                  `).join('')}
                </div>
              </div>

              <!-- Price & Savings -->
              <div style="display:flex;align-items:baseline;gap:.5rem;margin-top:auto;padding-top:.5rem;">
                <strong style="font-size:1.2rem;color:#059669;font-weight:800;">₹${price.toFixed(2)}</strong>
                ${hasDiscount ? `<span style="font-size:.85rem;color:#9ca3af;text-decoration:line-through;">₹${mrp.toFixed(2)}</span>` : ''}
              </div>

              <!-- Action Controls -->
              <div style="margin-top:6px;padding-top:.6rem;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:.5rem;">
                <label class="adm-toggle-label" style="font-size:.75rem;">
                  <input type="checkbox" class="combo-card-toggle-avail" data-id="${c.id}" ${isAvailable ? 'checked' : ''} />
                  <span class="adm-toggle-slider"></span>
                  <span class="adm-toggle-text">${isAvailable ? 'Available' : 'Paused'}</span>
                </label>

                <div style="display:flex;gap:.35rem;">
                  <button type="button" class="adm-btn adm-btn-outline adm-btn-sm btn-edit-combo" data-id="${c.id}" style="font-size:0.75rem;padding:.2rem .45rem;" title="Edit Combo">
                    ✏️ Edit
                  </button>
                  <button type="button" class="adm-btn adm-btn-outline adm-btn-sm btn-delete-combo" data-id="${c.id}" style="font-size:0.75rem;padding:.2rem .45rem;color:#ef4444;border-color:#fecaca;" title="Delete Combo">
                    🗑️
                  </button>
                </div>
              </div>

            </div>

          </div>
        `;
      }).join('');
    }
  }

  // 4. Render Table View
  const tbody = $('combos-table-body');
  if (tbody) {
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--adm-muted);">No combos found. Click "+ Create Combo Pack" to create your first meal bundle.</td></tr>';
    } else {
      tbody.innerHTML = list.map(c => {
        const itemsListStr = Array.isArray(c.items)
          ? c.items.map(it => `${it.qty || 1}× ${it.name}`).join(', ')
          : 'No items';
        const isAvailable = c.available !== false;
        const mrp = Number(c.mrp || 0);
        const price = Number(c.price || 0);
        const hasDiscount = mrp > price;
        const discountPct = hasDiscount ? Math.round(((mrp - price) / mrp) * 100) : 0;
        
        return `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:0.75rem;">
                ${c.image_url ? `<img src="${c.image_url}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;border:1px solid var(--adm-border);" onerror="this.src='/images/food_biryani.png'" />` : '<div style="width:40px;height:40px;border-radius:8px;background:#eef2ff;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🍿</div>'}
                <div>
                  <strong style="color:#111827;font-size:.88rem;">${escapeHtml(c.name)}</strong>
                </div>
              </div>
            </td>
            <td style="max-width:200px;font-size:.8rem;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHtml(c.description || '—')}
            </td>
            <td style="font-size:.8rem;color:#374151;max-width:240px;">
              ${escapeHtml(itemsListStr)}
            </td>
            <td>
              <strong style="color:#059669;font-size:.9rem;">₹${price.toFixed(2)}</strong>
              ${hasDiscount ? `<span style="text-decoration:line-through;color:#9ca3af;font-size:.78rem;margin-left:4px;">₹${mrp.toFixed(2)}</span> <span style="background:#fee2e2;color:#b91c1c;font-size:0.75rem;font-weight:700;padding:.1rem .35rem;border-radius:4px;">${discountPct}% off</span>` : ''}
            </td>
            <td>
              <span style="background:${isAvailable ? '#f0fdf4' : '#fee2e2'};color:${isAvailable ? '#166534' : '#b91c1c'};font-size:.75rem;font-weight:700;padding:.15rem .45rem;border-radius:999px;">
                ${isAvailable ? '✓ Active' : '✕ Paused'}
              </span>
            </td>
            <td style="text-align:right;">
              <div style="display:inline-flex;gap:4px;">
                <button type="button" class="adm-btn adm-btn-outline adm-btn-sm btn-edit-combo" data-id="${c.id}" style="font-size:.75rem;padding:.2rem .45rem;">
                  ✏️ Edit
                </button>
                <button type="button" class="adm-btn adm-btn-outline adm-btn-sm btn-delete-combo" data-id="${c.id}" style="font-size:.75rem;padding:.2rem .45rem;color:#ef4444;border-color:#fecaca;">
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  setupComboEventListeners();
}

function setupComboEventListeners() {
  // Toggle availability in card / table
  document.querySelectorAll('.combo-card-toggle-avail').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.id;
      const isChecked = cb.checked;
      try {
        const combo = adminCombos.find(c => String(c.id) === String(id));
        if (combo) {
          combo.available = isChecked;
          await saveCombo(combo);
          showAdminToast(`Combo availability updated: ${isChecked ? 'In Stock ✅' : 'Paused 🚫'}`, 'success');
          loadAndRenderCombos();
        }
      } catch (err) {
        showAdminToast('Failed to update combo: ' + err.message, 'error');
        cb.checked = !isChecked;
      }
    });
  });

  // Edit Button
  document.querySelectorAll('.btn-edit-combo').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const combo = adminCombos.find(c => String(c.id) === String(id));
      if (combo) {
        $('combo-modal-title').textContent = `✏️ Edit Combo: ${combo.name}`;
        $('combo-modal-id').value = combo.id;
        $('combo-modal-name').value = combo.name;
        $('combo-modal-desc').value = combo.description || '';
        $('combo-modal-price').value = combo.price;
        $('combo-modal-mrp').value = combo.mrp || '';
        
        $('combo-modal-img-url').value = combo.image_url || '';
        const preview = $('combo-modal-img-preview');
        const placeholder = $('combo-modal-img-placeholder');
        if (combo.image_url) {
          preview.src = combo.image_url;
          preview.style.display = 'block';
          placeholder.style.display = 'none';
        } else {
          preview.src = '';
          preview.style.display = 'none';
          placeholder.style.display = 'block';
        }
        $('combo-modal-file').value = '';
        $('combo-modal-upload-status').textContent = 'No file selected';
        
        populateComboItemsChecklist(combo.items);
        $('adm-combo-modal').classList.add('active');
      }
    });
  });

  // Delete Button
  document.querySelectorAll('.btn-delete-combo').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const combo = adminCombos.find(c => String(c.id) === String(id));
      if (!combo) return;
      if (!confirm(`Are you sure you want to delete combo "${combo.name}"? This cannot be undone.`)) return;

      try {
        await deleteCombo(id);
        showAdminToast('Combo deleted successfully.', 'success');
        loadAndRenderCombos();
      } catch (err) {
        showAdminToast('Failed to delete combo: ' + err.message, 'error');
      }
    });
  });
}

function exportCombosCSV() {
  const { list } = computeCombosHubData();
  if (!list.length) {
    showAdminToast('No combo deals to export.', 'error');
    return;
  }

  const headers = ['Combo ID', 'Combo Name', 'Description', 'Selling Price (INR)', 'MRP (INR)', 'Savings %', 'Included Dishes', 'Stock Status'];
  const rows = list.map(c => {
    const itemsStr = Array.isArray(c.items) ? c.items.map(i => `${i.qty || 1}x ${i.name}`).join('; ') : '';
    const mrp = Number(c.mrp || 0);
    const price = Number(c.price || 0);
    const savPct = (mrp > price && mrp > 0) ? Math.round(((mrp - price) / mrp) * 100) + '%' : '0%';

    return [
      `"${c.id || ''}"`,
      `"${(c.name || '').replace(/"/g, '""')}"`,
      `"${(c.description || '').replace(/"/g, '""')}"`,
      `"${price.toFixed(2)}"`,
      `"${mrp ? mrp.toFixed(2) : ''}"`,
      `"${savPct}"`,
      `"${itemsStr.replace(/"/g, '""')}"`,
      `"${c.available !== false ? 'In Stock' : 'Paused'}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `LIMRA_Combos_Deals_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAdminToast('Combos catalogue exported to CSV! 📥', 'success');
}

function initCombosListeners() {
  // Status pill buttons
  $('combos-status-presets')?.querySelectorAll('.pos-cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      $('combos-status-presets').querySelectorAll('.pos-cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      comboStatusFilter = btn.dataset.status;
      renderCombosTable();
    });
  });

  // Sort & Search
  $('combos-sort-filter')?.addEventListener('change', (e) => {
    comboSort = e.target.value;
    renderCombosTable();
  });

  $('combos-search')?.addEventListener('input', (e) => {
    comboSearch = e.target.value;
    renderCombosTable();
  });

  $('combos-export-btn')?.addEventListener('click', exportCombosCSV);
}

function populateComboItemsChecklist(selectedItems = []) {
  const container = $('combo-items-checklist');
  if (!container) return;
  
  const searchInput = $('combo-items-search');
  if (searchInput) searchInput.value = '';
  
  container.innerHTML = menuItems.map(item => {
    const matched = selectedItems.find(s => s.id === item.id);
    const isChecked = !!matched;
    const qty = matched ? (matched.qty || 1) : 1;
    
    return `
      <div class="combo-item-row" data-name="${item.name.toLowerCase()}" data-category="${item.category.toLowerCase()}" style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;padding:0.25rem 0;border-bottom:1px solid rgba(255,255,255,0.03)">
        <div style="display:flex;align-items:center;gap:0.5rem;flex:1">
          <input type="checkbox" class="combo-item-checkbox" id="chk-combo-item-${item.id}" data-id="${item.id}" data-name="${item.name}" ${isChecked ? 'checked' : ''} style="cursor:pointer;width:14px;height:14px" />
          <label for="chk-combo-item-${item.id}" style="cursor:pointer;font-size:0.8rem;color:var(--adm-text)" class="select-none">
            ${item.name} <span style="color:var(--adm-muted)">(${item.category})</span>
          </label>
        </div>
        <div style="display:flex;align-items:center;gap:0.35rem">
          <span style="font-size:0.75rem;color:var(--adm-muted)">Qty:</span>
          <input type="number" class="combo-item-qty" data-id="${item.id}" min="1" max="99" value="${qty}" style="width:45px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:4px;padding:2px 4px;font-size:0.75rem;text-align:center" />
        </div>
      </div>
    `;
  }).join('');
}

function setupComboModalListeners() {
  const modal = $('adm-combo-modal');
  const form = $('adm-combo-form');
  const cancelBtn = $('combo-modal-cancel');
  const createBtn = $('btn-create-combo');
  
  if (!modal || !form || !cancelBtn) return;
  
  // Search items filter
  const itemSearch = $('combo-items-search');
  if (itemSearch) {
    itemSearch.addEventListener('input', () => {
      const query = itemSearch.value.toLowerCase().trim();
      const container = $('combo-items-checklist');
      if (container) {
        container.querySelectorAll('.combo-item-row').forEach(row => {
          const name = row.dataset.name || '';
          const category = row.dataset.category || '';
          if (name.includes(query) || category.includes(query)) {
            row.style.display = 'flex';
          } else {
            row.style.display = 'none';
          }
        });
      }
    });
  }
  
  // 1. Image upload elements
  const fileInput = $('combo-modal-file');
  const uploadBtn = $('combo-modal-upload-btn');
  const statusSpan = $('combo-modal-upload-status');
  const urlInput = $('combo-modal-img-url');
  const previewImg = $('combo-modal-img-preview');
  const placeholderImg = $('combo-modal-img-placeholder');

  // Trigger file selection on click
  uploadBtn?.addEventListener('click', () => {
    fileInput?.click();
  });

  // Handle file upload to InsForge public combos storage bucket
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    statusSpan.textContent = 'Uploading...';
    if (uploadBtn) uploadBtn.disabled = true;

    try {
      const { data, error } = await insforge.storage.from('combos').uploadAuto(file);
      if (error) throw error;

      statusSpan.textContent = 'Uploaded successfully!';
      if (urlInput) {
        urlInput.value = data.url;
        // Trigger preview update
        if (previewImg && placeholderImg) {
          previewImg.src = data.url;
          previewImg.style.display = 'block';
          placeholderImg.style.display = 'none';
        }
      }
    } catch (err) {
      statusSpan.textContent = 'Upload failed!';
      alert('Failed to upload image: ' + err.message);
    } finally {
      if (uploadBtn) uploadBtn.disabled = false;
    }
  });

  // Handle manual URL changes for preview updates
  urlInput?.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    if (previewImg && placeholderImg) {
      if (url) {
        previewImg.src = url;
        previewImg.style.display = 'block';
        placeholderImg.style.display = 'none';
      } else {
        previewImg.src = '';
        previewImg.style.display = 'none';
        placeholderImg.style.display = 'block';
      }
    }
  });

  createBtn?.addEventListener('click', () => {
    $('combo-modal-title').textContent = 'Create Combo Pack';
    $('combo-modal-id').value = '';
    $('combo-modal-name').value = '';
    $('combo-modal-desc').value = '';
    $('combo-modal-price').value = '';
    $('combo-modal-mrp').value = '';
    
    if (urlInput) urlInput.value = '';
    if (previewImg && placeholderImg) {
      previewImg.src = '';
      previewImg.style.display = 'none';
      placeholderImg.style.display = 'block';
    }
    if (fileInput) fileInput.value = '';
    if (statusSpan) statusSpan.textContent = 'No file selected';

    populateComboItemsChecklist([]);
    modal.classList.add('active');
  });
  
  cancelBtn.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idVal = $('combo-modal-id').value;
    const id = idVal ? parseInt(idVal, 10) : null;
    const name = $('combo-modal-name').value.trim();
    const desc = $('combo-modal-desc').value.trim();
    const price = parseFloat($('combo-modal-price').value);
    const mrpVal = $('combo-modal-mrp').value ? parseFloat($('combo-modal-mrp').value) : null;
    const imageUrl = urlInput ? urlInput.value.trim() : '';
    
    if (!name) {
      alert('Please enter a combo name');
      return;
    }
    if (isNaN(price) || price <= 0) {
      alert('Please enter a valid price');
      return;
    }
    
    const selectedItems = [];
    const checkboxes = form.querySelectorAll('.combo-item-checkbox:checked');
    
    checkboxes.forEach(cb => {
      const itemId = parseInt(cb.dataset.id, 10);
      const itemName = cb.dataset.name;
      const qtyInput = form.querySelector(`.combo-item-qty[data-id="${itemId}"]`);
      const qty = qtyInput ? (parseInt(qtyInput.value, 10) || 1) : 1;
      
      selectedItems.push({
        id: itemId,
        name: itemName,
        qty: qty
      });
    });
    
    if (selectedItems.length === 0) {
      alert('Please select at least one menu item to build the combo');
      return;
    }
    
    const saveBtn = form.querySelector('button[type="submit"]');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    try {
      const combo = {
        name,
        description: desc,
        price,
        mrp: mrpVal,
        items: selectedItems,
        available: true,
        image_url: imageUrl || null
      };
      
      if (id) combo.id = id;
      
      await saveCombo(combo);
      modal.classList.remove('active');
      loadAndRenderCombos();
    } catch (err) {
      alert('Failed to save combo: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Combo';
    }
  });
}

// ── Places & Charges Management ───────────────────────────

async function loadAndRenderPlaces() {
  try {
    const res = await insforge.database.from('delivery_areas').select('*').order('name', { ascending: true });
    if (res.error) throw res.error;
    adminPlaces = (res.data || []).map(p => ({
      ...p,
      id: String(p.id),
      name: p.name || '',
      charge: Number(p.delivery_fee ?? p.charge ?? 0),
      delivery_fee: Number(p.delivery_fee ?? p.charge ?? 0)
    }));
    renderPlacesTable();
    if (typeof renderPosPlaceChips === 'function') renderPosPlaceChips();
  } catch (err) {
    console.error('Failed to load places:', err);
    showAdminToast('Failed to load delivery places: ' + (err.message || err), 'error');
  }
}

function renderPlacesTable() {
  const tbody = $('places-table-body');
  if (!tbody) return;
  
  const searchQuery = ($('places-search')?.value || '').toLowerCase().trim();
  const filtered = adminPlaces.filter(p => (p.name || '').toLowerCase().includes(searchQuery));
  
  const countSpan = $('places-count');
  if (countSpan) countSpan.textContent = adminPlaces.length;
  
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="adm-empty" style="text-align:center;padding:2rem;color:var(--adm-muted);">No places found</td></tr>`;
    return;
  }
  
  tbody.innerHTML = filtered.map(p => {
    const feeVal = Number(p.delivery_fee ?? p.charge ?? 0);
    return `
      <tr data-place-id="${p.id}">
        <td><strong style="color:var(--adm-text);font-size:.9rem;">📍 ${escapeHtml(p.name)}</strong></td>
        <td style="text-align:right; font-weight:700; font-size:.9rem; color:#059669;">₹${feeVal.toFixed(0)}</td>
        <td style="text-align:center;">
          <div style="display:flex; gap:0.5rem; justify-content:center; align-items:center;">
            <button type="button" class="adm-btn adm-btn-primary adm-btn-sm edit-place-btn" data-id="${p.id}" style="padding:.28rem .7rem;font-size:.78rem;font-weight:600;">Edit</button>
            <button type="button" class="adm-btn adm-btn-danger adm-btn-sm delete-place-btn" data-id="${p.id}" style="padding:.28rem .7rem;font-size:.78rem;font-weight:600;">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  
  // Bind actions
  tbody.querySelectorAll('.edit-place-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const place = adminPlaces.find(p => String(p.id) === String(id));
      if (place) {
        openPlaceModal(place);
      }
    });
  });
  
  tbody.querySelectorAll('.delete-place-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const place = adminPlaces.find(p => String(p.id) === String(id));
      if (place && confirm(`Are you sure you want to delete place "${place.name}"?`)) {
        try {
          const res = await insforge.database.from('delivery_areas').delete().eq('id', id);
          if (res.error) throw res.error;
          showAdminToast(`Place "${place.name}" deleted successfully.`, 'success');
          await loadAndRenderPlaces();
        } catch (err) {
          console.error('Failed to delete place:', err);
          alert('Failed to delete place: ' + (err.message || err));
        }
      }
    });
  });
}

function openPlaceModal(place = null) {
  const modal = $('adm-place-modal');
  const title = $('place-modal-title');
  const idInput = $('place-modal-id');
  const nameInput = $('place-modal-name');
  const chargeInput = $('place-modal-charge');
  
  if (!modal) return;
  
  if (place) {
    if (title) title.textContent = 'Edit Delivery Place';
    if (idInput) idInput.value = String(place.id);
    if (nameInput) nameInput.value = place.name;
    if (chargeInput) chargeInput.value = Number(place.delivery_fee ?? place.charge ?? 0);
  } else {
    if (title) title.textContent = 'Add New Delivery Place';
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (chargeInput) chargeInput.value = '';
  }
  
  modal.classList.add('active');
  nameInput?.focus();
}

function setupPlaceModalListeners() {
  const modal = $('adm-place-modal');
  const form = $('adm-place-form');
  const cancelBtn = $('place-modal-cancel');
  const searchInput = $('places-search');
  
  $('btn-create-place')?.addEventListener('click', () => openPlaceModal());
  
  cancelBtn?.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
  
  searchInput?.addEventListener('input', () => {
    renderPlacesTable();
  });
  
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idVal = ($('place-modal-id')?.value || '').trim();
    const id = idVal || null;
    const name = ($('place-modal-name')?.value || '').trim();
    const charge = parseFloat($('place-modal-charge')?.value);
    
    if (!name) {
      alert('Please enter a place name');
      return;
    }
    if (isNaN(charge) || charge < 0) {
      alert('Please enter a valid delivery fee');
      return;
    }
    
    const saveBtn = form.querySelector('button[type="submit"]');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }
    
    try {
      const payload = {
        name,
        delivery_fee: charge,
        active: true
      };
      let res;
      if (id) {
        res = await insforge.database.from('delivery_areas').update(payload).eq('id', id);
      } else {
        res = await insforge.database.from('delivery_areas').insert([payload]);
      }
      
      if (res.error) throw res.error;
      showAdminToast(`Place "${name}" saved successfully!`, 'success');
      modal.classList.remove('active');
      await loadAndRenderPlaces();
    } catch (err) {
      console.error('Failed to save place:', err);
      alert('Failed to save place: ' + (err.message || err));
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Place';
      }
    }
  });
}

// ── Coupon Share Composer Modal ─────────────────────────

function updateShareMessage() {
  const name = $('share-customer-name')?.value.trim() || 'Valued Customer';
  const code = $('share-coupon-code')?.value || '';
  const pct = $('share-coupon-pct')?.value || '';
  const min = $('share-coupon-min')?.value || '0';
  const expiry = $('share-coupon-expiry')?.value || '';
  
  const msg = `Hi *${name}*,\n\nHere is a special coupon for you: *${code}*\n\nGet ${pct}% OFF on your next order at Limra Restaurant! (Min bill: ₹${Number(min).toFixed(0)}, Exp: ${expiry}).\n\nOrder now: https://limraresturent.in/`;
  
  const desc = $('share-coupon-desc');
  if (desc) desc.value = msg;
}

function setupCouponShareModalListeners() {
  const modal = $('adm-coupon-share-modal');
  const cancelBtn = $('share-modal-cancel');
  const nameInput = $('share-customer-name');
  const whatsappBtn = $('btn-share-whatsapp');
  const copyBtn = $('btn-share-copy');
  
  if (!modal) return;
  
  cancelBtn?.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  
  nameInput?.addEventListener('input', updateShareMessage);
  
  copyBtn?.addEventListener('click', () => {
    const msg = $('share-coupon-desc')?.value || '';
    
    // Robust copy to clipboard helper supporting mobile in-app browsers
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(msg).then(() => {
        showAdminToast('Promo message copied to clipboard!', 'success');
      }).catch(err => {
        fallbackCopy(msg);
      });
    } else {
      fallbackCopy(msg);
    }
  });

  function fallbackCopy(text) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      textArea.remove();
      if (successful) {
        showAdminToast('Promo message copied to clipboard!', 'success');
      } else {
        alert('Could not copy text. Please select the text box contents manually.');
      }
    } catch (e) {
      alert('Failed to copy message: ' + e.message);
    }
  }
  
  whatsappBtn?.addEventListener('click', () => {
    const msg = $('share-coupon-desc')?.value || '';
    const rawPhone = $('share-customer-phone')?.value.trim() || '';
    
    let cleanPhone = rawPhone.replace(/\D/g, '');
    
    let waLink;
    if (cleanPhone) {
      waLink = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg)}`;
    } else {
      waLink = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    }
    
    window.open(waLink, '_blank');
  });
}

// ════════════════════════════════════════════════════════
// PRINTER & KOT STUDIO (TVS RP3200 Plus & ESC/POS Engine)
// ════════════════════════════════════════════════════════

let printerSettings = {
  id: 'default',
  printer_model: 'TVS RP3200 Plus',
  active_printer_name: localStorage.getItem('qz-printer-name') || 'RP3200 plus(U) 1',
  connection_mode: localStorage.getItem('printer-connection-mode') || 'driver',
  silent_print: true,
  
  // Sizing & Dimensions (mm)
  kot_paper_width: parseFloat(localStorage.getItem('qz-paper-size-kot') || '80'),
  kot_printable_width: 72,
  kot_side_gap: parseFloat(localStorage.getItem('qz-kot-side-gap') || '2'),
  kot_top_margin: 0,
  kot_bottom_feed: parseInt(localStorage.getItem('qz-kot-bottom-feed') || '3'),
  kot_font_size: 'large',
  kot_auto_cut: 'partial',
  kot_item_separator: 'dashed',
  
  bill_paper_width: parseFloat(localStorage.getItem('qz-paper-size-bill') || '80'),
  bill_printable_width: 72,
  bill_side_gap: parseFloat(localStorage.getItem('qz-bill-side-gap') || '2'),
  bill_top_margin: 0,
  bill_bottom_feed: parseInt(localStorage.getItem('qz-bill-bottom-feed') || '4'),
  bill_auto_cut: 'full',
  
  // High-Density Bill Typography & Darkness Defaults
  bill_font_size: parseFloat(localStorage.getItem('qz-bill-font-size') || '11.5'),
  bill_font_weight: localStorage.getItem('qz-bill-font-weight') || '800',
  bill_density: localStorage.getItem('qz-bill-density') || 'compact',
  bill_bold_items: localStorage.getItem('qz-bill-bold-items') !== 'false',
  bill_bold_headers: localStorage.getItem('qz-bill-bold-headers') !== 'false',
  bill_bold_totals: localStorage.getItem('qz-bill-bold-totals') !== 'false',
  bill_compact_header: localStorage.getItem('qz-bill-compact-header') === 'true',
  bill_qr_size: localStorage.getItem('qz-bill-qr-size') || 'medium',

  // Branding & Taxes
  bill_show_logo: localStorage.getItem('qz-bill-show-logo') !== 'false',
  bill_logo_url: localStorage.getItem('qz-bill-logo-url') || '/images/logo.png',
  bill_show_place: localStorage.getItem('qz-bill-show-place') !== 'false',
  bill_show_table: localStorage.getItem('qz-bill-show-table') !== 'false',
  restaurant_name: localStorage.getItem('qz-bill-restaurant-name') || 'LIMRA RESTAURANT',
  restaurant_address: localStorage.getItem('qz-bill-address') || 'Nimtala, Alanggiri, Egra, West Bengal 721429',
  restaurant_phone: localStorage.getItem('qz-bill-phone') || '9635545808',
  restaurant_gstin: localStorage.getItem('qz-bill-gstin') || '19BWHPA4482J1ZA',
  restaurant_fssai: localStorage.getItem('qz-bill-fssai') || '',
  cgst_rate: parseFloat(localStorage.getItem('qz-bill-cgst-rate') || '2.5'),
  sgst_rate: parseFloat(localStorage.getItem('qz-bill-sgst-rate') || '2.5'),
  total_tables: parseInt(localStorage.getItem('qz-total-tables') || '19', 10),
  bill_upi_id: localStorage.getItem('qz-bill-upi-id') || '7501299357@YBL',
  bill_upi_payee_name: localStorage.getItem('qz-bill-upi-payee-name') || 'LIMRA RESTAURANT',
  bill_footer_message: localStorage.getItem('qz-bill-footer-msg') || 'Thank you for dining with us! Please visit again.',

  // Review QR & Direct Print (Phase 3)
  bill_show_review_qr: localStorage.getItem('qz-bill-show-review-qr') !== 'false',
  bill_review_url: localStorage.getItem('qz-bill-review-url') || 'https://g.page/r/CcrqEfWap5zfEBE/review',
  bill_review_heading: localStorage.getItem('qz-bill-review-heading') || 'LOVE YOUR EXPERIENCE?',
  bill_review_subtext: localStorage.getItem('qz-bill-review-subtext') || 'Scan to leave us a Google Review',
  direct_print_enabled: localStorage.getItem('printer-direct-print-enabled') !== 'false',
  auto_print_on_settle: localStorage.getItem('printer-auto-settle') !== 'false',
  print_queue_retry_limit: parseInt(localStorage.getItem('printer-retry-limit') || '3'),
  
  // KOT Field Toggles
  kot_show_table: true,
  kot_show_order_type: true,
  kot_show_customer: true,
  kot_show_timestamp: true,
  kot_show_item_notes: true,
  kot_highlight_qty: true,
  kot_show_category: false,
};

let samplePreviewItems = [
  { id: '1', name: 'Chicken Biryani (Special)', qty: 2, price: 180, category: 'Biryani & Rice', notes: 'Extra spicy, with Raita' },
  { id: '2', name: 'Butter Tandoori Roti', qty: 4, price: 25, category: 'Tandoori Roti', notes: 'Hot & soft' },
  { id: '3', name: 'Campa White 500ml', qty: 2, price: 20, category: 'Cold Drinks', notes: 'Chilled' },
];

let activeStudioTab = 'kot'; // 'kot', 'bill', 'items'
let activePreviewMode = 'kot'; // 'kot' or 'bill'
let printerPanelMounted = false;

// QR Code Cache for instant preview renders
const _qrCache = new Map();
async function generateUpiQrDataUrl(upiId, payeeName, amount, billNo) {
  if (!upiId || !upiId.trim()) return '';
  const cleanUpi = upiId.trim();
  const cleanName = encodeURIComponent(payeeName || 'LIMRA RESTAURANT');
  const cleanAmount = Number(amount || 0).toFixed(2);
  const upiUrl = `upi://pay?pa=${cleanUpi}&pn=${cleanName}&am=${cleanAmount}&cu=INR&tn=Bill_${billNo || '101'}`;
  
  if (_qrCache.has(upiUrl)) return _qrCache.get(upiUrl);

  try {
    const dataUrl = await QRCode.toDataURL(upiUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 140,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    _qrCache.set(upiUrl, dataUrl);
    return dataUrl;
  } catch (err) {
    console.error('Failed to generate UPI QR code:', err);
    return '';
  }
}

async function generateReviewQrDataUrl(reviewUrl) {
  if (!reviewUrl || !reviewUrl.trim()) return '';
  const cleanUrl = reviewUrl.trim();
  if (_qrCache.has(cleanUrl)) return _qrCache.get(cleanUrl);

  try {
    const dataUrl = await QRCode.toDataURL(cleanUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 140,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    _qrCache.set(cleanUrl, dataUrl);
    return dataUrl;
  } catch (err) {
    console.error('Failed to generate Review QR code:', err);
    return '';
  }
}

let _nativePrintLock = Promise.resolve();

function printViaWebSocketBridge(payload, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (typeof WebSocket === 'undefined') return resolve(null);
    let ws = null;
    let timer = null;
    let settled = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try { ws.close(); } catch (e) {}
        ws = null;
      }
    };

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(null);
      }
    }, timeoutMs);

    try {
      ws = new WebSocket('ws://127.0.0.1:3000');
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({
            action: 'print',
            html: payload.html,
            escposText: payload.escposText,
            plainText: payload.plainText,
            printerName: payload.printerName || 'RP3200 plus(U) 1',
            paperWidth: payload.paperWidth || 80,
            jobId: payload.jobId || Date.now()
          }));
        } catch (sendErr) {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(null);
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && (data.action === 'print_result' || data.success)) {
            if (!settled) {
              settled = true;
              cleanup();
              resolve(data);
            }
          }
        } catch (parseErr) {}
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(null);
        }
      };

      ws.onclose = () => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(null);
        }
      };
    } catch (err) {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(null);
      }
    }
  });
}

function checkLocalPrintBridgeStatus(timeoutMs = 1200) {
  return new Promise((resolve) => {
    if (typeof WebSocket === 'undefined') return resolve(false);
    let ws = null;
    let timer = null;
    let settled = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try { ws.close(); } catch (e) {}
      }
    };

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(false);
      }
    }, timeoutMs);

    try {
      ws = new WebSocket('ws://127.0.0.1:3000');
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({ action: 'ping' }));
        } catch (e) {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(false);
          }
        }
      };
      ws.onmessage = (evt) => {
        try {
          const res = JSON.parse(evt.data);
          if (res && res.status === 'ok') {
            if (!settled) {
              settled = true;
              cleanup();
              resolve(true);
            }
          }
        } catch (e) {}
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(false);
        }
      };
      ws.onclose = () => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(false);
        }
      };
    } catch (err) {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(false);
      }
    }
  });
}

function printViaNativeDriver(receiptHtml, widthMm = 80, sideGapMm = 2, extraPayload = {}) {
  const pName = printerSettings.active_printer_name || 'RP3200 plus(U) 1';

  // 1. Electron Desktop POS — silent native IPC (Zero Dialog)
  if (typeof window !== 'undefined' && window.electronPOS?.isDesktop && typeof window.electronPOS.printReceipt === 'function') {
    return window.electronPOS.printReceipt({
      html: receiptHtml,
      escposText: extraPayload.escposText,
      printerName: pName,
      silent: printerSettings.silent_print !== false,
      paperWidth: widthMm || 80,
      sideGap: sideGapMm || 2
    }).then(res => {
      if (res && res.success) return true;
      console.warn('[printViaNativeDriver] Electron reported print issue:', res?.error);
      return false;
    }).catch(err => {
      console.warn('[printViaNativeDriver] Electron native print error:', err);
      return false;
    });
  }

  // 2. Direct Local Silent Print Service (/api/print-silent) — Zero Dialog, Direct Windows Spooler
  const printTask = async () => {
    // 2a. Try persistent local WebSocket bridge first
    const wsResult = await printViaWebSocketBridge({
      html: receiptHtml,
      escposText: extraPayload.escposText,
      printerName: pName,
      paperWidth: widthMm || 80
    }, 2000);

    if (wsResult && wsResult.success) {
      console.log(`[printViaNativeDriver] Direct Silent Print sent to ${wsResult.deviceName || pName} via WebSocket Bridge ✓ (Zero Dialog)`);
      return true;
    }

    // 2b. HTTP Loopback Endpoints with Private Network Access headers
    const endpoints = [];
    if (typeof window !== 'undefined') {
      endpoints.push('http://127.0.0.1:3000/api/print-silent');
      endpoints.push('http://localhost:3000/api/print-silent');
    }
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      endpoints.push('/api/print-silent');
    }

    for (const ep of endpoints) {
      try {
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const tid = controller ? setTimeout(() => controller.abort(), 2000) : null;
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller?.signal,
          body: JSON.stringify({
            html: receiptHtml,
            escposText: extraPayload.escposText,
            printerName: pName,
            paperWidth: widthMm || 80
          })
        });
        if (tid) clearTimeout(tid);
        if (res.ok) {
          const data = await res.json();
          if (data && data.success) {
            console.log(`[printViaNativeDriver] Direct Silent Print sent to ${data.deviceName || pName} via ${ep} ✓ (Zero Dialog)`);
            return true;
          }
        }
      } catch (err) {
        // Continue to next endpoint
      }
    }

    console.warn('[printViaNativeDriver] Thermal printer direct bridge unavailable on this client.');
    return false;
  };

  _nativePrintLock = _nativePrintLock.then(printTask, printTask);
  return _nativePrintLock;
}

function updatePrinterPanelStatus() {
  const badge = document.getElementById('printer-studio-status-badge');
  const msgEl = document.getElementById('printer-panel-status-msg');
  const qzWrap = document.getElementById('qz-controls-wrap');
  if (!badge) return;

  const mode = printerSettings.connection_mode || 'driver';
  if (qzWrap) qzWrap.style.display = mode === 'qz_tray' ? 'inline-flex' : 'none';

  if (mode === 'driver') {
    badge.textContent = `🟢 Native Driver Active (${printerSettings.printer_model || 'TVS RP3200 Plus'})`;
    badge.style.background = '#ecfdf5';
    badge.style.color = '#059669';
    badge.style.borderColor = '#a7f3d0';
    if (msgEl) msgEl.textContent = `Direct Windows Driver Spooler · ${printerSettings.printer_model || 'TVS RP3200 Plus'} (80mm Thermal Roll) · Vector Sharp Output`;
  } else {
    const isConn = (typeof qz !== 'undefined') && qz.websocket.isActive() && qzConnected;
    if (isConn) {
      badge.textContent = `🟢 QZ Tray Connected (${activePrinter || 'TVS RP3200 Plus'})`;
      badge.style.background = '#ecfdf5';
      badge.style.color = '#059669';
      badge.style.borderColor = '#a7f3d0';
      if (msgEl) msgEl.textContent = `Active Printer: ${activePrinter} · Connected via QZ Tray WebSocket`;
    } else {
      badge.textContent = '🔌 QZ Tray Disconnected';
      badge.style.background = '#fef2f2';
      badge.style.color = '#ef4444';
      badge.style.borderColor = '#fca5a5';
      if (msgEl) msgEl.textContent = 'QZ Tray not running on PC. Launch QZ Tray or switch to Native Driver.';
    }
  }
}

const PRINTER_SETTINGS_DB_COLUMNS = [
  'id',
  'printer_model',
  'active_printer_name',
  'connection_mode',
  'kot_paper_width',
  'kot_printable_width',
  'kot_side_gap',
  'kot_top_margin',
  'kot_bottom_feed',
  'kot_font_size',
  'kot_auto_cut',
  'kot_item_separator',
  'bill_paper_width',
  'bill_printable_width',
  'bill_side_gap',
  'bill_top_margin',
  'bill_bottom_feed',
  'bill_auto_cut',
  'bill_show_logo',
  'bill_logo_url',
  'bill_show_place',
  'bill_show_table',
  'bill_show_header',
  'bill_show_tax_summary',
  'bill_show_payment_mode',
  'bill_show_upi_qr',
  'restaurant_name',
  'restaurant_address',
  'restaurant_phone',
  'restaurant_gstin',
  'restaurant_fssai',
  'cgst_rate',
  'sgst_rate',
  'bill_upi_id',
  'bill_upi_payee_name',
  'bill_footer_message',
  'kot_show_table',
  'kot_show_order_type',
  'kot_show_customer',
  'kot_show_timestamp',
  'kot_show_item_notes',
  'kot_show_category',
  'kot_highlight_qty',
  'bill_font_size',
  'bill_font_weight',
  'bill_density',
  'bill_bold_items',
  'bill_bold_headers',
  'bill_bold_totals',
  'bill_compact_header',
  'bill_qr_size',
  'bill_show_review_qr',
  'bill_review_url',
  'bill_review_heading',
  'bill_review_subtext',
  'direct_print_enabled',
  'auto_print_on_settle',
  'print_queue_retry_limit',
  'updated_at'
];

function sanitizePrinterSettingsForDB(settings) {
  const sanitized = {};
  for (const col of PRINTER_SETTINGS_DB_COLUMNS) {
    if (settings[col] !== undefined) {
      sanitized[col] = settings[col];
    }
  }
  sanitized.id = 'default';
  sanitized.updated_at = new Date().toISOString();
  return sanitized;
}

async function loadPrinterSettingsFromDB() {
  try {
    const { data, error } = await insforge.database.from('printer_settings').select('*').eq('id', 'default').maybeSingle();
    if (data && !error) {
      printerSettings = { ...printerSettings, ...data };
      
      // Sync to localStorage as offline cache
      localStorage.setItem('printer-model', printerSettings.printer_model || 'TVS RP3200 Plus');
      localStorage.setItem('printer-connection-mode', printerSettings.connection_mode || 'driver');
      localStorage.setItem('qz-printer-name', printerSettings.active_printer_name || '');
      localStorage.setItem('qz-paper-size-kot', String(printerSettings.kot_paper_width || '80'));
      localStorage.setItem('qz-kot-side-gap', String(printerSettings.kot_side_gap ?? 2));
      localStorage.setItem('qz-kot-bottom-feed', String(printerSettings.kot_bottom_feed || 3));
      localStorage.setItem('qz-paper-size-bill', String(printerSettings.bill_paper_width || '80'));
      localStorage.setItem('qz-bill-side-gap', String(printerSettings.bill_side_gap ?? 2));
      localStorage.setItem('qz-bill-bottom-feed', String(printerSettings.bill_bottom_feed || 2));
      localStorage.setItem('qz-bill-show-logo', String(printerSettings.bill_show_logo));
      localStorage.setItem('qz-bill-logo-url', printerSettings.bill_logo_url || '/images/logo.png');
      localStorage.setItem('qz-bill-show-place', String(printerSettings.bill_show_place !== false));
      localStorage.setItem('qz-bill-show-table', String(printerSettings.bill_show_table !== false));
      localStorage.setItem('qz-bill-restaurant-name', printerSettings.restaurant_name || 'LIMRA RESTAURANT');
      localStorage.setItem('qz-bill-address', printerSettings.restaurant_address || 'Main Road, Near Bus Stand, Egra');
      localStorage.setItem('qz-bill-phone', printerSettings.restaurant_phone || '+91 99999 88888');
      localStorage.setItem('qz-bill-gstin', printerSettings.restaurant_gstin || '');
      localStorage.setItem('qz-bill-fssai', printerSettings.restaurant_fssai || '');
      localStorage.setItem('qz-bill-cgst-rate', String(printerSettings.cgst_rate ?? 2.5));
      localStorage.setItem('qz-bill-sgst-rate', String(printerSettings.sgst_rate ?? 2.5));
      localStorage.setItem('qz-bill-upi-id', printerSettings.bill_upi_id || '');
      localStorage.setItem('qz-bill-upi-payee-name', printerSettings.bill_upi_payee_name || 'LIMRA RESTAURANT');
      localStorage.setItem('qz-bill-footer-msg', printerSettings.bill_footer_message || 'Thank you for dining with us! Please visit again.');
      
      // Typography & Paper Saver Cache
      localStorage.setItem('qz-bill-font-size', String(printerSettings.bill_font_size ?? 10));
      localStorage.setItem('qz-bill-font-weight', String(printerSettings.bill_font_weight || '700'));
      localStorage.setItem('qz-bill-density', String(printerSettings.bill_density || 'compact'));
      localStorage.setItem('qz-bill-bold-items', String(printerSettings.bill_bold_items !== false));
      localStorage.setItem('qz-bill-bold-headers', String(printerSettings.bill_bold_headers !== false));
      localStorage.setItem('qz-bill-bold-totals', String(printerSettings.bill_bold_totals !== false));
      localStorage.setItem('qz-bill-compact-header', String(printerSettings.bill_compact_header === true));
      localStorage.setItem('qz-bill-qr-size', String(printerSettings.bill_qr_size || 'medium'));

      // Phase 3: Review QR & Direct Print Cache
      localStorage.setItem('qz-bill-show-review-qr', String(printerSettings.bill_show_review_qr !== false));
      localStorage.setItem('qz-bill-review-url', printerSettings.bill_review_url || 'https://g.page/r/CcrqEfWap5zfEBE/review');
      localStorage.setItem('qz-bill-review-heading', printerSettings.bill_review_heading || 'LOVE YOUR EXPERIENCE?');
      localStorage.setItem('qz-bill-review-subtext', printerSettings.bill_review_subtext || 'Scan to leave us a Google Review');
      localStorage.setItem('printer-direct-print-enabled', String(printerSettings.direct_print_enabled !== false));
      localStorage.setItem('printer-auto-settle', String(printerSettings.auto_print_on_settle !== false));
      localStorage.setItem('printer-retry-limit', String(printerSettings.print_queue_retry_limit || 3));

      syncPrinterSettingsToUI();
      await renderThermalLivePreview();
    }
  } catch (err) {
    console.warn('[Printer] Load from DB error (using cache):', err);
  } finally {
    await initDesktopHardwarePrinter();
    syncPrinterSettingsToUI();
    try { await renderThermalLivePreview(); } catch (e) {}
  }
}

async function initDesktopHardwarePrinter() {
  if (typeof window === 'undefined' || !window.electronPOS?.isDesktop) return;

  try {
    let printers = [];
    if (typeof window.electronPOS.getPrinters === 'function') {
      printers = await window.electronPOS.getPrinters();
    }
    console.log('[Limra POS Desktop] Installed Windows printers:', printers);

    if (Array.isArray(printers) && printers.length > 0) {
      // Find matching installed printer
      const current = (printerSettings.active_printer_name || '').trim().toLowerCase();
      let matched = current ? printers.find(p => p.name.toLowerCase() === current) : null;
      if (!matched && current) {
        const norm = current.replace(/[^a-z0-9]/g, '');
        matched = printers.find(p => {
          const pNorm = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          return pNorm.includes(norm) || norm.includes(pNorm);
        });
      }
      if (!matched) {
        matched = printers.find(p => /rp\s*3200|tvs|pos-?80|thermal|receipt/i.test(p.name));
      }
      if (!matched) {
        matched = printers.find(p => p.isDefault);
      }
      if (!matched) {
        matched = printers[0];
      }

      if (matched && matched.name) {
        printerSettings.active_printer_name = matched.name;
        printerSettings.direct_print_enabled = true;
        printerSettings.auto_print_on_settle = true;
        printerSettings.silent_print = true;
        try {
          localStorage.setItem('qz-printer-name', matched.name);
          localStorage.setItem('printer-direct-print-enabled', 'true');
          localStorage.setItem('printer-auto-settle', 'true');
        } catch (e) {}
        console.log(`[Limra POS Desktop] Calibrated active thermal printer: "${matched.name}" (Default: ${Boolean(matched.isDefault)})`);
      }

      updateDesktopPrinterSelectUI(printers, matched?.name || printerSettings.active_printer_name);
    }
  } catch (err) {
    console.warn('[Limra POS Desktop] Failed to calibrate desktop thermal printer:', err);
  }
}

function updateDesktopPrinterSelectUI(printers = [], activeName = '') {
  const sel = document.getElementById('desktop-printer-select') || document.getElementById('printer-list-select');
  if (!sel) return;

  sel.innerHTML = '';
  printers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    const isDef = p.isDefault ? ' (Default)' : '';
    opt.textContent = `🖨️ ${p.name}${isDef}`;
    if (activeName && p.name.toLowerCase() === activeName.toLowerCase()) {
      opt.selected = true;
    }
    sel.appendChild(opt);
  });

  const badge = document.getElementById('printer-studio-status-badge');
  if (badge) {
    badge.textContent = `🟢 TVS RP3200 Ready (${activeName || 'Auto-Detected'})`;
    badge.style.background = '#ecfdf5';
    badge.style.color = '#059669';
  }

  const msg = document.getElementById('printer-panel-status-msg');
  if (msg) {
    msg.textContent = `Direct Silent Driver Active (${activeName || 'TVS 3200'}) · Zero Dialog · 80mm Roll (72mm Printable)`;
  }
}

function syncPrinterSettingsToUI() {
  // Printer Model
  const modelSel = document.getElementById('printer-model-select');
  if (modelSel) modelSel.value = printerSettings.printer_model || 'TVS RP3200 Plus';

  // Connection Mode
  const modeSel = document.getElementById('printer-connection-mode');
  if (modeSel) modeSel.value = printerSettings.connection_mode || 'driver';

  // Sizing & Sizing inputs
  const kotCustom = document.getElementById('kot-custom-width');
  if (kotCustom) kotCustom.value = printerSettings.kot_paper_width || 80;
  const kotCut = document.getElementById('kot-auto-cut');
  if (kotCut) kotCut.value = printerSettings.kot_auto_cut || 'partial';
  const kotFeed = document.getElementById('kot-bottom-feed');
  if (kotFeed) kotFeed.value = printerSettings.kot_bottom_feed || 3;
  const kotFeedSlider = document.getElementById('kot-bottom-feed-slider');
  if (kotFeedSlider) kotFeedSlider.value = printerSettings.kot_bottom_feed || 3;
  const kotDownLabel = document.getElementById('kot-down-gap-label');
  if (kotDownLabel) kotDownLabel.textContent = `${printerSettings.kot_bottom_feed || 3} lines`;

  const kotSideGapInp = document.getElementById('kot-side-gap');
  if (kotSideGapInp) kotSideGapInp.value = printerSettings.kot_side_gap ?? 2;
  const kotSideGapSlider = document.getElementById('kot-side-gap-slider');
  if (kotSideGapSlider) kotSideGapSlider.value = printerSettings.kot_side_gap ?? 2;
  const kotSideLabel = document.getElementById('kot-side-gap-label');
  if (kotSideLabel) kotSideLabel.textContent = `${printerSettings.kot_side_gap ?? 2} mm`;

  const kotFont = document.getElementById('kot-font-size');
  if (kotFont) kotFont.value = printerSettings.kot_font_size || 'large';
  const kotSep = document.getElementById('kot-item-separator');
  if (kotSep) kotSep.value = printerSettings.kot_item_separator || 'dashed';

  // KOT Toggles
  const chkTable = document.getElementById('kot-toggle-table');
  if (chkTable) chkTable.checked = printerSettings.kot_show_table ?? true;
  const chkType = document.getElementById('kot-toggle-order-type');
  if (chkType) chkType.checked = printerSettings.kot_show_order_type ?? true;
  const chkCust = document.getElementById('kot-toggle-customer');
  if (chkCust) chkCust.checked = printerSettings.kot_show_customer ?? true;
  const chkTime = document.getElementById('kot-toggle-time');
  if (chkTime) chkTime.checked = printerSettings.kot_show_timestamp ?? true;
  const chkNotes = document.getElementById('kot-toggle-notes');
  if (chkNotes) chkNotes.checked = printerSettings.kot_show_item_notes ?? true;
  const chkQty = document.getElementById('kot-toggle-highlight-qty');
  if (chkQty) chkQty.checked = printerSettings.kot_highlight_qty ?? true;
  const chkCat = document.getElementById('kot-toggle-category');
  if (chkCat) chkCat.checked = printerSettings.kot_show_category ?? false;

  // Bill Sizing & Branding
  const billCustom = document.getElementById('bill-custom-width');
  if (billCustom) billCustom.value = printerSettings.bill_paper_width || 80;
  const billCut = document.getElementById('bill-auto-cut');
  if (billCut) billCut.value = printerSettings.bill_auto_cut || 'full';
  const billFeed = document.getElementById('bill-bottom-feed');
  if (billFeed) billFeed.value = printerSettings.bill_bottom_feed || 2;
  const billFeedSlider = document.getElementById('bill-bottom-feed-slider');
  if (billFeedSlider) billFeedSlider.value = printerSettings.bill_bottom_feed || 2;
  const billDownLabel = document.getElementById('bill-down-gap-label');
  if (billDownLabel) billDownLabel.textContent = `${printerSettings.bill_bottom_feed || 2} lines`;

  const billSideGapInp = document.getElementById('bill-side-gap');
  if (billSideGapInp) billSideGapInp.value = printerSettings.bill_side_gap ?? 2;
  const billSideGapSlider = document.getElementById('bill-side-gap-slider');
  if (billSideGapSlider) billSideGapSlider.value = printerSettings.bill_side_gap ?? 2;
  const billSideLabel = document.getElementById('bill-side-gap-label');
  if (billSideLabel) billSideLabel.textContent = `${printerSettings.bill_side_gap ?? 2} mm`;

  // Bill Typography, Boldness & Paper Saver Controls (Settings Tab)
  const bFontSize = parseFloat(printerSettings.bill_font_size ?? 10);
  const bFontSizeInp = document.getElementById('bill-font-size-input');
  if (bFontSizeInp) bFontSizeInp.value = bFontSize;
  const bFontSizeSld = document.getElementById('bill-font-size-slider');
  if (bFontSizeSld) bFontSizeSld.value = bFontSize;
  const bFontLabel = document.getElementById('bill-font-size-label');
  if (bFontLabel) bFontLabel.textContent = `${bFontSize.toFixed(1)} px`;

  const bWeightSel = document.getElementById('bill-font-weight-select');
  if (bWeightSel) bWeightSel.value = printerSettings.bill_font_weight || '700';

  const bDensitySel = document.getElementById('bill-density-select');
  if (bDensitySel) bDensitySel.value = printerSettings.bill_density || 'compact';

  const bQrSizeSel = document.getElementById('bill-qr-size-select');
  if (bQrSizeSel) bQrSizeSel.value = printerSettings.bill_qr_size || 'medium';

  const chkBoldItems = document.getElementById('bill-toggle-bold-items');
  if (chkBoldItems) chkBoldItems.checked = printerSettings.bill_bold_items !== false;
  const chkBoldHeaders = document.getElementById('bill-toggle-bold-headers');
  if (chkBoldHeaders) chkBoldHeaders.checked = printerSettings.bill_bold_headers !== false;
  const chkBoldTotals = document.getElementById('bill-toggle-bold-totals');
  if (chkBoldTotals) chkBoldTotals.checked = printerSettings.bill_bold_totals !== false;
  const chkCompactHdr = document.getElementById('bill-toggle-compact-header');
  if (chkCompactHdr) chkCompactHdr.checked = printerSettings.bill_compact_header === true;

  // Quick Modal Controls Sync
  const qbFontVal = document.getElementById('qb-font-size-val');
  if (qbFontVal) qbFontVal.textContent = `${bFontSize.toFixed(1)} px`;
  const qbFontInp = document.getElementById('qb-font-size-input');
  if (qbFontInp) qbFontInp.value = bFontSize;
  const qbFontSld = document.getElementById('qb-font-size-slider');
  if (qbFontSld) qbFontSld.value = bFontSize;
  const qbWeightSel = document.getElementById('qb-font-weight-select');
  if (qbWeightSel) qbWeightSel.value = printerSettings.bill_font_weight || '700';
  const qbDensitySel = document.getElementById('qb-density-select');
  if (qbDensitySel) qbDensitySel.value = printerSettings.bill_density || 'compact';
  const qbQrSizeSel = document.getElementById('qb-qr-size-select');
  if (qbQrSizeSel) qbQrSizeSel.value = printerSettings.bill_qr_size || 'medium';
  const qbFeedSel = document.getElementById('qb-bottom-feed-select');
  if (qbFeedSel) qbFeedSel.value = String(printerSettings.bill_bottom_feed || 2);
  const qbBoldItems = document.getElementById('qb-bold-items');
  if (qbBoldItems) qbBoldItems.checked = printerSettings.bill_bold_items !== false;
  const qbBoldHdrs = document.getElementById('qb-bold-headers');
  if (qbBoldHdrs) qbBoldHdrs.checked = printerSettings.bill_bold_headers !== false;
  const qbBoldTotals = document.getElementById('qb-bold-totals');
  if (qbBoldTotals) qbBoldTotals.checked = printerSettings.bill_bold_totals !== false;
  const qbCompactHdr = document.getElementById('qb-compact-header');
  if (qbCompactHdr) qbCompactHdr.checked = printerSettings.bill_compact_header === true;

  // Branding
  const chkLogo = document.getElementById('bill-show-logo');
  if (chkLogo) chkLogo.checked = printerSettings.bill_show_logo ?? true;
  const logoUrlInp = document.getElementById('bill-logo-url');
  if (logoUrlInp) logoUrlInp.value = printerSettings.bill_logo_url || '/images/logo.png';

  const chkPlace = document.getElementById('bill-toggle-show-place');
  if (chkPlace) chkPlace.checked = printerSettings.bill_show_place ?? true;
  const chkTableBill = document.getElementById('bill-toggle-show-table');
  if (chkTableBill) chkTableBill.checked = printerSettings.bill_show_table ?? true;

  const bName = document.getElementById('bill-restaurant-name');
  if (bName) bName.value = printerSettings.restaurant_name || 'LIMRA RESTAURANT';
  const bPhone = document.getElementById('bill-phone');
  if (bPhone) bPhone.value = printerSettings.restaurant_phone || '+91 99999 88888';
  const bAddr = document.getElementById('bill-address');
  if (bAddr) bAddr.value = printerSettings.restaurant_address || 'Main Road, Near Bus Stand, Egra';
  const bGstin = document.getElementById('bill-gstin');
  if (bGstin) bGstin.value = printerSettings.restaurant_gstin || '';
  const bFssai = document.getElementById('bill-fssai');
  if (bFssai) bFssai.value = printerSettings.restaurant_fssai || '';
  const bTotalTables = document.getElementById('bill-total-tables');
  if (bTotalTables) bTotalTables.value = printerSettings.total_tables || 19;
  const bCgst = document.getElementById('bill-cgst-rate');
  if (bCgst) bCgst.value = printerSettings.cgst_rate ?? 2.5;
  const bSgst = document.getElementById('bill-sgst-rate');
  if (bSgst) bSgst.value = printerSettings.sgst_rate ?? 2.5;
  const bUpi = document.getElementById('bill-upi-id');
  if (bUpi) bUpi.value = printerSettings.bill_upi_id || '';
  const bUpiName = document.getElementById('bill-upi-payee-name');
  if (bUpiName) bUpiName.value = printerSettings.bill_upi_payee_name || 'LIMRA RESTAURANT';
  const bFooter = document.getElementById('bill-footer-msg');
  if (bFooter) bFooter.value = printerSettings.bill_footer_message || 'Thank you for dining with us! Please visit again.';

  // Phase 3: Review QR & Direct Print Automation Sync
  const chkReview = document.getElementById('bill-toggle-review-qr');
  if (chkReview) chkReview.checked = printerSettings.bill_show_review_qr !== false;
  const revUrl = document.getElementById('bill-review-url');
  if (revUrl) revUrl.value = printerSettings.bill_review_url || 'https://g.page/r/CcrqEfWap5zfEBE/review';
  const revHead = document.getElementById('bill-review-heading');
  if (revHead) revHead.value = printerSettings.bill_review_heading || 'LOVE YOUR EXPERIENCE?';
  const revSub = document.getElementById('bill-review-subtext');
  if (revSub) revSub.value = printerSettings.bill_review_subtext || 'Scan to leave us a Google Review';
  const chkAutoSettle = document.getElementById('printer-auto-settle-toggle');
  if (chkAutoSettle) chkAutoSettle.checked = printerSettings.auto_print_on_settle !== false;
  const chkDirectPrint = document.getElementById('printer-direct-print-toggle');
  if (chkDirectPrint) chkDirectPrint.checked = printerSettings.direct_print_enabled !== false;

  const desktopPrinterSel = document.getElementById('desktop-printer-select');
  if (desktopPrinterSel && printerSettings.active_printer_name) {
    desktopPrinterSel.value = printerSettings.active_printer_name;
  }

  updatePresetButtonsUI();
  updatePrinterPanelStatus();
}

function readPrinterSettingsFromUI() {
  const desktopPrinterSel = document.getElementById('desktop-printer-select');
  if (desktopPrinterSel && desktopPrinterSel.value) {
    printerSettings.active_printer_name = desktopPrinterSel.value;
  }
  printerSettings.printer_model = document.getElementById('printer-model-select')?.value || 'TVS RP3200 Plus';
  printerSettings.connection_mode = document.getElementById('printer-connection-mode')?.value || 'driver';
  printerSettings.kot_paper_width = parseFloat(document.getElementById('kot-custom-width')?.value || '80');
  printerSettings.kot_auto_cut = document.getElementById('kot-auto-cut')?.value || 'partial';
  printerSettings.kot_bottom_feed = parseInt(document.getElementById('kot-bottom-feed')?.value || '3');
  printerSettings.kot_side_gap = parseFloat(document.getElementById('kot-side-gap')?.value || '2');
  printerSettings.kot_font_size = document.getElementById('kot-font-size')?.value || 'large';
  printerSettings.kot_item_separator = document.getElementById('kot-item-separator')?.value || 'dashed';

  printerSettings.kot_show_table = document.getElementById('kot-toggle-table')?.checked ?? true;
  printerSettings.kot_show_order_type = document.getElementById('kot-toggle-order-type')?.checked ?? true;
  printerSettings.kot_show_customer = document.getElementById('kot-toggle-customer')?.checked ?? true;
  printerSettings.kot_show_timestamp = document.getElementById('kot-toggle-time')?.checked ?? true;
  printerSettings.kot_show_item_notes = document.getElementById('kot-toggle-notes')?.checked ?? true;
  printerSettings.kot_highlight_qty = document.getElementById('kot-toggle-highlight-qty')?.checked ?? true;
  printerSettings.kot_show_category = document.getElementById('kot-toggle-category')?.checked ?? false;

  const billWVal = document.getElementById('bill-custom-width')?.value;
  printerSettings.bill_paper_width = billWVal === 'A4' ? 'A4' : parseFloat(billWVal || '80');
  printerSettings.bill_auto_cut = document.getElementById('bill-auto-cut')?.value || 'full';
  printerSettings.bill_bottom_feed = parseInt(document.getElementById('bill-bottom-feed')?.value || '2');
  printerSettings.bill_side_gap = parseFloat(document.getElementById('bill-side-gap')?.value || '2');

  // Typography, Boldness & Paper Reducer Read
  const fontInp = document.getElementById('bill-font-size-input')?.value || document.getElementById('qb-font-size-input')?.value;
  if (fontInp) printerSettings.bill_font_size = parseFloat(fontInp);
  const weightSel = document.getElementById('bill-font-weight-select')?.value || document.getElementById('qb-font-weight-select')?.value;
  if (weightSel) printerSettings.bill_font_weight = weightSel;
  const densitySel = document.getElementById('bill-density-select')?.value || document.getElementById('qb-density-select')?.value;
  if (densitySel) printerSettings.bill_density = densitySel;
  const qrSizeSel = document.getElementById('bill-qr-size-select')?.value || document.getElementById('qb-qr-size-select')?.value;
  if (qrSizeSel) printerSettings.bill_qr_size = qrSizeSel;

  if (document.getElementById('bill-toggle-bold-items')) {
    printerSettings.bill_bold_items = document.getElementById('bill-toggle-bold-items').checked;
  }
  if (document.getElementById('bill-toggle-bold-headers')) {
    printerSettings.bill_bold_headers = document.getElementById('bill-toggle-bold-headers').checked;
  }
  if (document.getElementById('bill-toggle-bold-totals')) {
    printerSettings.bill_bold_totals = document.getElementById('bill-toggle-bold-totals').checked;
  }
  if (document.getElementById('bill-toggle-compact-header')) {
    printerSettings.bill_compact_header = document.getElementById('bill-toggle-compact-header').checked;
  }

  printerSettings.bill_show_logo = document.getElementById('bill-show-logo')?.checked ?? true;
  printerSettings.bill_logo_url = document.getElementById('bill-logo-url')?.value?.trim() || '/images/logo.png';
  printerSettings.bill_show_place = document.getElementById('bill-toggle-show-place')?.checked ?? true;
  printerSettings.bill_show_table = document.getElementById('bill-toggle-show-table')?.checked ?? true;
  printerSettings.restaurant_name = document.getElementById('bill-restaurant-name')?.value?.trim() || 'LIMRA RESTAURANT';
  printerSettings.restaurant_phone = document.getElementById('bill-phone')?.value?.trim() || '';
  printerSettings.restaurant_address = document.getElementById('bill-address')?.value?.trim() || '';
  printerSettings.restaurant_gstin = document.getElementById('bill-gstin')?.value?.trim() || '';
  printerSettings.restaurant_fssai = document.getElementById('bill-fssai')?.value?.trim() || '';
  if (document.getElementById('bill-total-tables')) {
    const tVal = parseInt(document.getElementById('bill-total-tables').value, 10);
    printerSettings.total_tables = (!isNaN(tVal) && tVal > 0) ? tVal : 19;
  }
  printerSettings.cgst_rate = parseFloat(document.getElementById('bill-cgst-rate')?.value || '2.5');
  printerSettings.sgst_rate = parseFloat(document.getElementById('bill-sgst-rate')?.value || '2.5');
  printerSettings.bill_upi_id = document.getElementById('bill-upi-id')?.value?.trim() || '';
  printerSettings.bill_upi_payee_name = document.getElementById('bill-upi-payee-name')?.value?.trim() || 'LIMRA RESTAURANT';
  printerSettings.bill_footer_message = document.getElementById('bill-footer-msg')?.value?.trim() || 'Thank you for dining with us! Please visit again.';

  // Phase 3: Review QR & Direct Print Automation Read
  if (document.getElementById('bill-toggle-review-qr')) {
    printerSettings.bill_show_review_qr = document.getElementById('bill-toggle-review-qr').checked;
  }
  if (document.getElementById('bill-review-url')) {
    printerSettings.bill_review_url = document.getElementById('bill-review-url').value?.trim() || 'https://g.page/r/CcrqEfWap5zfEBE/review';
  }
  if (document.getElementById('bill-review-heading')) {
    printerSettings.bill_review_heading = document.getElementById('bill-review-heading').value?.trim() || 'LOVE YOUR EXPERIENCE?';
  }
  if (document.getElementById('bill-review-subtext')) {
    printerSettings.bill_review_subtext = document.getElementById('bill-review-subtext').value?.trim() || 'Scan to leave us a Google Review';
  }
  if (document.getElementById('printer-auto-settle-toggle')) {
    printerSettings.auto_print_on_settle = document.getElementById('printer-auto-settle-toggle').checked;
  }
  if (document.getElementById('printer-direct-print-toggle')) {
    printerSettings.direct_print_enabled = document.getElementById('printer-direct-print-toggle').checked;
  }
}

async function savePrinterSettingsToDB() {
  readPrinterSettingsFromUI();

  // Save to localStorage as offline fallback
  localStorage.setItem('printer-model', printerSettings.printer_model || 'TVS RP3200 Plus');
  localStorage.setItem('printer-connection-mode', printerSettings.connection_mode || 'driver');
  localStorage.setItem('qz-printer-name', printerSettings.active_printer_name || '');
  localStorage.setItem('qz-paper-size-kot', String(printerSettings.kot_paper_width || '80'));
  localStorage.setItem('qz-kot-side-gap', String(printerSettings.kot_side_gap ?? 2));
  localStorage.setItem('qz-kot-bottom-feed', String(printerSettings.kot_bottom_feed || 3));
  localStorage.setItem('qz-paper-size-bill', String(printerSettings.bill_paper_width || '80'));
  localStorage.setItem('qz-bill-side-gap', String(printerSettings.bill_side_gap ?? 2));
  localStorage.setItem('qz-bill-bottom-feed', String(printerSettings.bill_bottom_feed || 2));
  localStorage.setItem('qz-bill-show-logo', String(printerSettings.bill_show_logo));
  localStorage.setItem('qz-bill-logo-url', printerSettings.bill_logo_url || '/images/logo.png');
  localStorage.setItem('qz-bill-show-place', String(printerSettings.bill_show_place !== false));
  localStorage.setItem('qz-bill-show-table', String(printerSettings.bill_show_table !== false));
  localStorage.setItem('qz-bill-restaurant-name', printerSettings.restaurant_name || 'LIMRA RESTAURANT');
  localStorage.setItem('qz-bill-address', printerSettings.restaurant_address || 'Main Road, Near Bus Stand, Egra');
  localStorage.setItem('qz-bill-phone', printerSettings.restaurant_phone || '+91 99999 88888');
  localStorage.setItem('qz-bill-gstin', printerSettings.restaurant_gstin || '');
  localStorage.setItem('qz-bill-fssai', printerSettings.restaurant_fssai || '');
  localStorage.setItem('qz-total-tables', String(printerSettings.total_tables || 19));
  localStorage.setItem('qz-bill-cgst-rate', String(printerSettings.cgst_rate ?? 2.5));
  localStorage.setItem('qz-bill-sgst-rate', String(printerSettings.sgst_rate ?? 2.5));
  localStorage.setItem('qz-bill-upi-id', printerSettings.bill_upi_id || '');
  localStorage.setItem('qz-bill-upi-payee-name', printerSettings.bill_upi_payee_name || 'LIMRA RESTAURANT');
  localStorage.setItem('qz-bill-footer-msg', printerSettings.bill_footer_message || 'Thank you for dining with us! Please visit again.');

  // Typography & Paper Reducer Cache
  localStorage.setItem('qz-bill-font-size', String(printerSettings.bill_font_size ?? 10));
  localStorage.setItem('qz-bill-font-weight', String(printerSettings.bill_font_weight || '700'));
  localStorage.setItem('qz-bill-density', String(printerSettings.bill_density || 'compact'));
  localStorage.setItem('qz-bill-bold-items', String(printerSettings.bill_bold_items !== false));
  localStorage.setItem('qz-bill-bold-headers', String(printerSettings.bill_bold_headers !== false));
  localStorage.setItem('qz-bill-bold-totals', String(printerSettings.bill_bold_totals !== false));
  localStorage.setItem('qz-bill-compact-header', String(printerSettings.bill_compact_header === true));
  localStorage.setItem('qz-bill-qr-size', String(printerSettings.bill_qr_size || 'medium'));

  // Phase 3: Review QR & Direct Print Cache
  localStorage.setItem('qz-bill-show-review-qr', String(printerSettings.bill_show_review_qr !== false));
  localStorage.setItem('qz-bill-review-url', printerSettings.bill_review_url || 'https://g.page/r/CcrqEfWap5zfEBE/review');
  localStorage.setItem('qz-bill-review-heading', printerSettings.bill_review_heading || 'LOVE YOUR EXPERIENCE?');
  localStorage.setItem('qz-bill-review-subtext', printerSettings.bill_review_subtext || 'Scan to leave us a Google Review');
  localStorage.setItem('printer-direct-print-enabled', String(printerSettings.direct_print_enabled !== false));
  localStorage.setItem('printer-auto-settle', String(printerSettings.auto_print_on_settle !== false));
  localStorage.setItem('printer-retry-limit', String(printerSettings.print_queue_retry_limit || 3));

  syncPrinterSettingsToUI();
  await renderThermalLivePreview();

  try {
    const payload = sanitizePrinterSettingsForDB(printerSettings);
    let res = await insforge.database.from('printer_settings').upsert([payload]);
    
    // Self-healing: if older schema is missing any column, strip it and save the rest
    let attempts = 0;
    while (res.error && res.error.message && res.error.message.includes('Could not find the') && attempts < 20) {
      const match = res.error.message.match(/Could not find the '([^']+)' column/);
      if (match && match[1]) {
        delete payload[match[1]];
        res = await insforge.database.from('printer_settings').upsert([payload]);
      } else {
        break;
      }
      attempts++;
    }

    if (res.error) throw res.error;
    showAdminToast('Printer settings saved to database! 💾', 'success');
  } catch (err) {
    console.error('[Printer] Save to DB error:', err);
    showAdminToast('Settings saved locally! 💾', 'warning');
  }
}

function updatePresetButtonsUI() {
  document.querySelectorAll('.kot-w-preset').forEach(btn => {
    const isSel = String(btn.dataset.width) === String(printerSettings.kot_paper_width);
    btn.className = isSel ? 'kot-w-preset adm-btn adm-btn-primary adm-btn-sm' : 'kot-w-preset adm-btn adm-btn-outline adm-btn-sm';
  });

  document.querySelectorAll('.bill-w-preset, .qb-width-btn').forEach(btn => {
    const isSel = String(btn.dataset.width) === String(printerSettings.bill_paper_width);
    btn.className = isSel ? `${btn.classList.contains('qb-width-btn') ? 'qb-width-btn' : 'bill-w-preset'} adm-btn adm-btn-primary adm-btn-sm` : `${btn.classList.contains('qb-width-btn') ? 'qb-width-btn' : 'bill-w-preset'} adm-btn adm-btn-outline adm-btn-sm`;
  });

  const curSize = parseFloat(printerSettings.bill_font_size ?? 10);
  document.querySelectorAll('.bill-font-preset, .qb-font-preset').forEach(btn => {
    const isSel = Math.abs(parseFloat(btn.dataset.size) - curSize) < 0.1;
    btn.className = isSel ? `${btn.classList.contains('qb-font-preset') ? 'qb-font-preset' : 'bill-font-preset'} adm-btn adm-btn-primary adm-btn-sm` : `${btn.classList.contains('qb-font-preset') ? 'qb-font-preset' : 'bill-font-preset'} adm-btn adm-btn-outline adm-btn-sm`;
  });
}

function getSeparatorLineHtml(style) {
  if (style === 'solid') return '<div style="border-top:1px solid #000;margin:6px 0;"></div>';
  if (style === 'double') return '<div style="border-top:3px double #000;margin:6px 0;"></div>';
  if (style === 'stars') return '<div style="text-align:center;letter-spacing:3px;font-size:10px;margin:5px 0;">* * * * * * * * * *</div>';
  return '<div style="border-top:1px dashed #000;margin:6px 0;"></div>';
}

async function renderQuickBillAdjusterPreview() {
  const qbContent = document.getElementById('qb-live-preview-content');
  const qbBadge = document.getElementById('qb-preview-badge');
  if (!qbContent) return;

  const widthMm = printerSettings.bill_paper_width || 80;
  const isA4 = String(widthMm) === 'A4';
  const density = printerSettings.bill_density || 'compact';
  const fontSize = parseFloat(printerSettings.bill_font_size ?? 10) || 10;

  if (qbBadge) {
    qbBadge.textContent = `${isA4 ? 'A4' : widthMm + 'mm'} · ${fontSize}px · ${density}`;
  }

  const mockOrder = {
    order_number: 108,
    customer_name: 'Imran Khan',
    customer_phone: '+91 98765 43210',
    order_type: 'delivery',
    table_number: '04',
    created_at: new Date().toISOString(),
    payment_status: 'paid',
    notes: '[DELIVERY] Place: Contai Central (Bus Stand) | Address: Flat 204, Green Valley Apts | Delivery charge: ₹30 [PAYMENT: UPI] [DISCOUNT_PCT: 10%] [DISCOUNT_AMT: 50.00] Please serve hot',
    total_amount: 471.5
  };

  qbContent.innerHTML = await generateBillPreviewHtml(mockOrder, samplePreviewItems);
}

async function renderThermalLivePreview() {
  const canvas = document.getElementById('thermal-preview-canvas');
  const badge = document.getElementById('preview-dim-badge');
  
  if (canvas) {
    const isKot = activePreviewMode === 'kot';
    const widthMm = isKot ? (printerSettings.kot_paper_width || 80) : (printerSettings.bill_paper_width || 80);
    const isA4 = String(widthMm) === 'A4';
    const widthPx = isA4 ? 380 : Math.max(160, Math.min(380, Math.round(parseFloat(widthMm) * 3.54)));
    const sideGapMm = isKot ? (printerSettings.kot_side_gap ?? 2) : (printerSettings.bill_side_gap ?? 2);
    const sideGapPx = Math.round(sideGapMm * 3.54);

    canvas.style.width = `${widthPx}px`;
    canvas.style.paddingLeft = `${sideGapPx}px`;
    canvas.style.paddingRight = `${sideGapPx}px`;
    if (badge) badge.textContent = `${isA4 ? 'A4' : widthMm + 'mm'} · Side: ${sideGapMm}mm`;

    const mockOrder = {
      order_number: 108,
      customer_name: 'Imran Khan',
      customer_phone: '+91 98765 43210',
      order_type: 'delivery',
      table_number: '04',
      created_at: new Date().toISOString(),
      payment_status: 'paid',
      notes: '[DELIVERY] Place: Contai Central (Bus Stand) | Address: Flat 204, Green Valley Apts | Delivery charge: ₹30 [PAYMENT: UPI] [DISCOUNT_PCT: 10%] [DISCOUNT_AMT: 50.00] Please serve hot',
      total_amount: 471.5
    };

    if (isKot) {
      canvas.innerHTML = generateKOTPreviewHtml(mockOrder, samplePreviewItems);
    } else {
      canvas.innerHTML = await generateBillPreviewHtml(mockOrder, samplePreviewItems);
    }
  }

  // Also update the Quick Adjuster modal preview if it's open
  await renderQuickBillAdjusterPreview();
}

function generateKOTPreviewHtml(order, items) {
  const p = printerSettings;
  const sep = getSeparatorLineHtml(p.kot_item_separator);
  const fontSize = p.kot_font_size === 'xlarge' ? '16px' : (p.kot_font_size === 'medium' ? '12px' : '14px');
  const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  const itemsHtml = items.map(i => `
    <div style="padding:4px 0;border-bottom:1px dashed #e2e8f0;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <span style="font-weight:700;font-size:${fontSize};">${escapeHtml(i.name)}</span>
        <span style="font-weight:900;font-size:${fontSize};${p.kot_highlight_qty ? 'background:#000;color:#fff;padding:0 5px;border-radius:2px;' : ''}">x${i.qty}</span>
      </div>
      ${p.kot_show_item_notes && i.notes ? `<div style="font-size:10px;font-style:italic;color:#444;margin-top:2px;">↳ Note: ${escapeHtml(i.notes)}</div>` : ''}
    </div>
  `).join('');

  const feedSpaces = '<br/>'.repeat(Math.max(1, p.kot_bottom_feed || 3));

  return `
    <div style="text-align:center;padding-bottom:4px;">
      <div style="font-size:15px;font-weight:900;letter-spacing:1px;">** KOT - KITCHEN ORDER **</div>
      <div style="font-size:10px;margin-top:2px;">TVS RP3200 Plus ESC/POS Ticket</div>
    </div>
    ${sep}
    <div style="font-size:11px;line-height:1.5;">
      <div style="display:flex;justify-content:space-between;">
        <span><strong>Order #:</strong> ${formatDailyOrderNumber(order)}</span>
        ${p.kot_show_timestamp ? `<span><strong>Time:</strong> ${timeStr}</span>` : ''}
      </div>
      ${p.kot_show_table ? `<div style="margin-top:3px;font-size:13px;font-weight:900;background:#f1f5f9;padding:2px 4px;border:1px solid #cbd5e1;border-radius:3px;">🪑 TABLE: ${order.table_number || '01'}</div>` : ''}
      ${p.kot_show_order_type ? `<div><strong>Type:</strong> ${order.order_type.toUpperCase()}</div>` : ''}
      ${p.kot_show_customer ? `<div><strong>Customer:</strong> ${escapeHtml(order.customer_name)}</div>` : ''}
    </div>
    ${sep}
    <div>${itemsHtml}</div>
    ${sep}
    <div style="text-align:center;font-size:10px;font-weight:bold;margin-top:4px;">— CHEF COPY —</div>
    ${feedSpaces}
    <div style="border-top:1px dashed #94a3b8;margin-top:8px;padding-top:4px;font-size:9px;color:#64748b;text-align:center;">
      ✂ - - - - ${p.kot_auto_cut === 'full' ? 'Full Cut' : (p.kot_auto_cut === 'none' ? 'Manual Tear' : 'Partial Cut')} - - - - ✂
    </div>
  `;
}

async function generateBillPreviewHtml(order, items) {
  const p = printerSettings;
  const fontSizeNum = parseFloat(p.bill_font_size ?? 11.5) || 11.5;
  const fontSizePx = `${fontSizeNum}px`;
  const headerFontSize = `${Math.max(15, fontSizeNum + 3.5)}px`;
  const subFontSize = `${Math.max(9.5, fontSizeNum - 1.5)}px`;
  const totalFontSize = `${Math.max(14.5, fontSizeNum + 3)}px`;

  const fontWeight = p.bill_font_weight || '800';
  const boldItems = p.bill_bold_items !== false;
  const boldHeaders = p.bill_bold_headers !== false;
  const boldTotals = p.bill_bold_totals !== false;
  const compactHeader = p.bill_compact_header === true;

  const density = p.bill_density || 'compact';
  const isUltraCompact = density === 'ultra-compact';
  const isCompact = density === 'compact' || isUltraCompact;
  const lineSpacing = isUltraCompact ? '1.18' : (isCompact ? '1.25' : '1.35');
  const rowPadding = isUltraCompact ? '1.5px 0' : (isCompact ? '2.5px 0' : '3.5px 0');

  // Filter out any non-food items
  const foodItems = items.filter(i => !/delivery|discount|tax|fee/i.test(i.item_name || i.name || ''));
  const subtotal = foodItems.reduce((s, i) => s + (i.price * i.qty), 0);
  
  // Sample 10% discount for preview demonstration if items match mock
  const discountPct = 10;
  const discountAmt = subtotal * (discountPct / 100);
  const taxable = Math.max(0, subtotal - discountAmt);
  const cgst = taxable * (p.cgst_rate || 2.5) / 100;
  const sgst = taxable * (p.sgst_rate || 2.5) / 100;
  const unroundedTotal = taxable + cgst + sgst;
  const grandTotal = Math.floor(unroundedTotal);
  const roundOff = Math.round((grandTotal - unroundedTotal) * 100) / 100;
  const timeStr = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });

  const rows = foodItems.map(i => `
    <tr style="border-bottom:none;">
      <td style="padding:${rowPadding};font-size:${fontSizePx};font-weight:${boldItems ? '800' : '700'};color:#000;text-align:left;vertical-align:top;width:52%;">${escapeHtml(i.name || i.item_name)}</td>
      <td style="padding:${rowPadding};font-size:${fontSizePx};text-align:center;font-weight:900;color:#000;vertical-align:top;width:12%;">${i.qty || i.quantity}</td>
      <td style="padding:${rowPadding};font-size:${fontSizePx};text-align:right;padding-right:4px;font-weight:700;color:#000;vertical-align:top;width:16%;font-variant-numeric:tabular-nums;">₹${Number(i.price || i.unit_price).toFixed(0)}</td>
      <td style="padding:${rowPadding};font-size:${fontSizePx};text-align:right;font-weight:900;color:#000;vertical-align:top;width:20%;font-variant-numeric:tabular-nums;">₹${Number((i.price || i.unit_price)*(i.qty || i.quantity)).toFixed(2)}</td>
    </tr>
  `).join('');

  const feedLines = Math.max(1, p.bill_bottom_feed ? Math.min(3, p.bill_bottom_feed) : 2);
  const feedSpaces = '<br/>'.repeat(feedLines);

  const qrSize = p.bill_qr_size || 'medium';
  const qrDimension = qrSize === 'small' ? '70px' : (qrSize === 'large' ? '100px' : '85px');
  const showQr = qrSize !== 'none' && Boolean(p.bill_upi_id);
  const qrDataUrl = showQr ? await generateUpiQrDataUrl(p.bill_upi_id, p.bill_upi_payee_name || p.restaurant_name, grandTotal, formatDailyOrderNumber(order)) : '';

  const showReviewQr = p.bill_show_review_qr !== false && Boolean(p.bill_review_url);
  const reviewQrDataUrl = showReviewQr ? await generateReviewQrDataUrl(p.bill_review_url) : '';

  return `
    <div style="width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:${fontSizePx};font-weight:${fontWeight};color:#000;line-height:${lineSpacing};box-sizing:border-box;">
      ${p.bill_show_logo !== false ? `
        <div style="margin-bottom:3px;text-align:center;">
          <img src="${(p.bill_logo_url && !p.bill_logo_url.startsWith('/images/logo.png')) ? p.bill_logo_url : (LIMRA_LOGO_BASE64 || p.bill_logo_url || '/images/logo.png')}" alt="Logo" style="max-height:54px;max-width:160px;margin:0 auto;display:block;filter:grayscale(100%) contrast(200%);" />
        </div>
      ` : ''}
      <div style="font-size:${headerFontSize};font-weight:900;letter-spacing:.5px;text-transform:uppercase;color:#000;text-align:center;">${escapeHtml(p.restaurant_name)}</div>
      ${!compactHeader && p.restaurant_address ? `<div style="font-size:${subFontSize};font-weight:700;color:#000;text-align:center;margin-top:1px;">${escapeHtml(p.restaurant_address)}</div>` : ''}
      <div style="font-size:${subFontSize};font-weight:700;color:#000;text-align:center;margin-top:1px;">
        ${p.restaurant_phone ? `Tel: ${escapeHtml(p.restaurant_phone)} ` : ''}
        ${!compactHeader && p.restaurant_gstin ? `| GSTIN: ${escapeHtml(p.restaurant_gstin)} ` : ''}
        ${!compactHeader && p.restaurant_fssai ? `| FSSAI: ${escapeHtml(p.restaurant_fssai)}` : ''}
      </div>
      
      <!-- Table / Delivery Invoice Title -->
      <div style="font-size:${subFontSize};font-weight:900;margin-top:4px;padding:2.5px 0;border-top:1.5px solid #000;border-bottom:1.5px solid #000;letter-spacing:.3px;color:#000;text-align:center;">
        TAX INVOICE — TABLE 4
      </div>
      <div style="font-size:${subFontSize};font-weight:700;line-height:1.35;margin:4px 0;border-bottom:1px dashed #000;padding-bottom:3px;color:#000;">
        <div style="display:flex;justify-content:space-between;">
          <span><strong>Bill #:</strong> ${formatDailyOrderNumber(order)}</span>
          <span><strong>Date:</strong> ${timeStr}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span><strong>Cust:</strong> ${escapeHtml(order.customer_name)}</span>
          <span><strong>Phone:</strong> ${order.customer_phone}</span>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;table-layout:fixed;border-bottom:1.5px solid #000;margin-bottom:3px;color:#000;">
        <thead>
          <tr style="border-top:1.5px solid #000;border-bottom:1.5px solid #000;">
            <th style="text-align:left;font-size:${subFontSize};font-weight:${boldHeaders ? '900' : '700'};padding:${rowPadding};width:52%;color:#000;vertical-align:top;">Item</th>
            <th style="text-align:center;font-size:${subFontSize};font-weight:${boldHeaders ? '900' : '700'};padding:${rowPadding};width:12%;color:#000;vertical-align:top;">Qty</th>
            <th style="text-align:right;font-size:${subFontSize};font-weight:${boldHeaders ? '900' : '700'};padding:${rowPadding};width:16%;padding-right:4px;color:#000;vertical-align:top;">Rate</th>
            <th style="text-align:right;font-size:${subFontSize};font-weight:${boldHeaders ? '900' : '700'};padding:${rowPadding};width:20%;color:#000;vertical-align:top;">Amt</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="font-size:${fontSizePx};line-height:${lineSpacing};color:#000;">
        <div style="display:flex;justify-content:space-between;font-weight:700;"><span>Subtotal:</span><span>₹${subtotal.toFixed(2)}</span></div>
        ${discountAmt > 0 ? `
          <div style="display:flex;justify-content:space-between;font-weight:700;color:#000;"><span>Discount (${discountPct}%):</span><span>-₹${discountAmt.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:700;"><span>Net Taxable:</span><span>₹${taxable.toFixed(2)}</span></div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;font-weight:700;"><span>CGST @${p.cgst_rate}%:</span><span>₹${cgst.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;font-weight:700;"><span>SGST @${p.sgst_rate}%:</span><span>₹${sgst.toFixed(2)}</span></div>
        ${roundOff !== 0 ? `
          <div style="display:flex;justify-content:space-between;font-weight:700;color:#000;"><span>Round Off:</span><span>${roundOff < 0 ? '-' : '+'}₹${Math.abs(roundOff).toFixed(2)}</span></div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;font-weight:${boldTotals ? '900' : '800'};font-size:${totalFontSize};border-top:1.5px solid #000;border-bottom:3px double #000;margin-top:2px;padding:3.5px 0;color:#000;">
          <span>GRAND TOTAL:</span><span>${formatBillAmount(grandTotal)}</span>
        </div>
      </div>

      <div style="border-bottom:1px dashed #000;margin-bottom:3px;padding-bottom:2px;font-size:${subFontSize};font-weight:800;display:flex;justify-content:space-between;color:#000;">
        <span><strong>Pay:</strong> CASH</span>
        <span><strong>Status:</strong> PAID</span>
      </div>

      ${showQr && qrDataUrl ? `
        <div style="text-align:center;margin-top:4px;padding-top:2px;color:#000;">
          <div style="font-size:${subFontSize};font-weight:900;letter-spacing:.3px;">SCAN &amp; PAY VIA UPI</div>
          <img src="${qrDataUrl}" alt="UPI QR" style="width:${qrDimension};height:${qrDimension};margin:3px auto;display:block;image-rendering:pixelated;" />
          <div style="font-size:${subFontSize};font-weight:700;color:#000;margin-top:1px;">UPI: <strong>${escapeHtml(p.bill_upi_id)}</strong> (${formatBillAmount(grandTotal)})</div>
        </div>
      ` : ''}

      <!-- GOOGLE 5-STAR REVIEW QR -->
      ${showReviewQr && reviewQrDataUrl ? `
        <div style="text-align:center;margin-top:5px;padding-top:3px;border-top:1px dashed #000;color:#000;">
          <div style="font-size:${subFontSize};font-weight:900;letter-spacing:.3px;">${escapeHtml(p.bill_review_heading || 'LOVE YOUR EXPERIENCE?')}</div>
          <div style="font-size:13px;letter-spacing:2px;margin:1px 0;color:#000;">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <img src="${reviewQrDataUrl}" alt="Google Review QR" style="width:${qrDimension};height:${qrDimension};margin:3px auto;display:block;image-rendering:pixelated;" />
          <div style="font-size:${subFontSize};font-weight:700;color:#000;margin-top:1px;">${escapeHtml(p.bill_review_subtext || 'Scan to leave us a Google Review')}</div>
        </div>
      ` : ''}

      <div style="text-align:center;border-top:1px dashed #000;padding-top:3px;margin-top:3px;font-size:${subFontSize};line-height:1.3;color:#000;">
        <div style="font-weight:900;">${escapeHtml(p.bill_footer_message || 'Thank you for dining with us! Please visit again.')}</div>
        <div style="font-weight:700;margin-top:1px;">${escapeHtml(p.restaurant_name)}</div>
      </div>

      ${feedSpaces}
    </div>
  `;
}

function renderSampleItemsEditor() {
  const listEl = document.getElementById('sample-items-list');
  if (!listEl) return;

  listEl.innerHTML = samplePreviewItems.map((item, idx) => `
    <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem;background:#f8fafc;border:1px solid var(--adm-border);border-radius:8px;">
      <input type="text" class="adm-input" value="${escapeHtml(item.name)}" style="flex:2;font-size:.8rem;padding:.25rem .5rem;" onchange="samplePreviewItems[${idx}].name=this.value;renderThermalLivePreview();" />
      <input type="number" class="adm-input" value="${item.qty}" min="1" style="width:50px;font-size:.8rem;padding:.25rem .3rem;" onchange="samplePreviewItems[${idx}].qty=parseInt(this.value)||1;renderThermalLivePreview();" />
      <input type="number" class="adm-input" value="${item.price}" min="0" step="1" style="width:65px;font-size:.8rem;padding:.25rem .3rem;" onchange="samplePreviewItems[${idx}].price=parseFloat(this.value)||0;renderThermalLivePreview();" />
      <button onclick="samplePreviewItems.splice(${idx},1);renderSampleItemsEditor();renderThermalLivePreview();" style="color:#ef4444;background:none;border:none;cursor:pointer;font-size:1rem;">✕</button>
    </div>
  `).join('');
}

async function initPrinterPanel() {
  const container = document.getElementById('settings-subtab-printer');
  if (container && !container.querySelector('#printer-model-select') && !document.getElementById('panel-printer')) {
    const tpl = document.getElementById('panel-printer-content');
    if (tpl) {
      container.appendChild(tpl.content.cloneNode(true));
      const p = document.getElementById('panel-printer');
      if (p) p.classList.add('active');
    }
  } else if (!container && !document.getElementById('printer-model-select') && !document.getElementById('panel-printer')) {
    const admc = document.getElementById('adm-content');
    const tpl = document.getElementById('panel-printer-content');
    if (tpl && admc) admc.appendChild(tpl.content.cloneNode(true));
  }
  const prn = document.getElementById('panel-printer');
  if (prn) prn.classList.add('active');

  updatePrinterPanelStatus();
  await loadPrinterSettingsFromDB();
  syncPrinterSettingsToUI();
  renderSampleItemsEditor();
  await renderThermalLivePreview();

  if (printerPanelMounted) return;
  printerPanelMounted = true;

  // TVS Printer Model Selector
  document.getElementById('printer-model-select')?.addEventListener('change', (e) => {
    printerSettings.printer_model = e.target.value;
    if (printerSettings.connection_mode === 'driver' || !printerSettings.active_printer_name) {
      printerSettings.active_printer_name = e.target.value;
    }
    localStorage.setItem('printer-model', printerSettings.printer_model);
    localStorage.setItem('qz-printer-name', printerSettings.active_printer_name);
    updatePrinterPanelStatus();
    renderThermalLivePreview();
    showAdminToast(`Default printer model set to: ${printerSettings.printer_model} 🖨️`, 'info');
  });

  // Print Mode Switcher (Driver vs QZ Tray)
  document.getElementById('printer-connection-mode')?.addEventListener('change', (e) => {
    printerSettings.connection_mode = e.target.value;
    localStorage.setItem('printer-connection-mode', printerSettings.connection_mode);
    updatePrinterPanelStatus();
    showAdminToast(`Print mode switched to: ${printerSettings.connection_mode === 'driver' ? 'Windows TVS Driver (Direct)' : 'QZ Tray'}`, 'info');
  });

  // QZ Tray Connection Button
  document.getElementById('printer-connect-btn')?.addEventListener('click', async () => {
    showAdminToast('Connecting to QZ Tray…', 'info');
    await initQZTray();
    updatePrinterPanelStatus();
    if (qzConnected) {
      showAdminToast('QZ Tray connected! Detecting TVS RP3200 Plus… ✅', 'success');
      document.getElementById('printer-select-btn')?.click();
    } else {
      showAdminToast('Could not connect to QZ Tray. Please ensure QZ Tray is running.', 'error');
    }
  });

  // Printer Detection Dropdown
  document.getElementById('printer-select-btn')?.addEventListener('click', async () => {
    if (!qzConnected) {
      await initQZTray();
      if (!qzConnected) { showAdminToast('Please launch and connect QZ Tray first.', 'error'); return; }
    }
    try {
      const printers = await qz.printers.find();
      const listSel = document.getElementById('printer-list-select');
      if (!listSel) return;
      listSel.innerHTML = printers.map(p => `<option value="${p}" ${p === activePrinter || p.includes('TVS') || p.includes('3200') || p.includes('POS') ? 'selected' : ''}>${p}</option>`).join('');
      if (listSel.value) {
        activePrinter = listSel.value;
        printerSettings.active_printer_name = listSel.value;
        localStorage.setItem('qz-printer-name', activePrinter);
        updatePrinterStatusBadge('connected', activePrinter);
        updatePrinterPanelStatus();
      }
      showAdminToast(`Found ${printers.length} printer(s) ✅`, 'success');
    } catch(e) {
      showAdminToast('Failed to list printers: ' + e.message, 'error');
    }
  });

  document.getElementById('printer-list-select')?.addEventListener('change', (e) => {
    activePrinter = e.target.value;
    printerSettings.active_printer_name = activePrinter;
    localStorage.setItem('qz-printer-name', activePrinter);
    updatePrinterStatusBadge('connected', activePrinter);
    updatePrinterPanelStatus();
  });

  // Editor Tabs
  const tabKot = document.getElementById('tab-btn-kot');
  const tabBill = document.getElementById('tab-btn-bill');
  const tabItems = document.getElementById('tab-btn-items');
  const secKot = document.getElementById('editor-section-kot');
  const secBill = document.getElementById('editor-section-bill');
  const secItems = document.getElementById('editor-section-items');

  tabKot?.addEventListener('click', () => {
    activeStudioTab = 'kot';
    tabKot.className = 'adm-btn adm-btn-primary adm-btn-sm';
    tabBill.className = 'adm-btn adm-btn-outline adm-btn-sm';
    tabItems.className = 'adm-btn adm-btn-outline adm-btn-sm';
    secKot.style.display = 'block';
    secBill.style.display = 'none';
    secItems.style.display = 'none';
    document.getElementById('btn-preview-mode-kot')?.click();
  });

  tabBill?.addEventListener('click', () => {
    activeStudioTab = 'bill';
    tabBill.className = 'adm-btn adm-btn-primary adm-btn-sm';
    tabKot.className = 'adm-btn adm-btn-outline adm-btn-sm';
    tabItems.className = 'adm-btn adm-btn-outline adm-btn-sm';
    secBill.style.display = 'block';
    secKot.style.display = 'none';
    secItems.style.display = 'none';
    document.getElementById('btn-preview-mode-bill')?.click();
  });

  tabItems?.addEventListener('click', () => {
    activeStudioTab = 'items';
    tabItems.className = 'adm-btn adm-btn-primary adm-btn-sm';
    tabKot.className = 'adm-btn adm-btn-outline adm-btn-sm';
    tabBill.className = 'adm-btn adm-btn-outline adm-btn-sm';
    secItems.style.display = 'block';
    secKot.style.display = 'none';
    secBill.style.display = 'none';
  });

  // Preview Switcher
  const btnPrevKot = document.getElementById('btn-preview-mode-kot');
  const btnPrevBill = document.getElementById('btn-preview-mode-bill');

  btnPrevKot?.addEventListener('click', async () => {
    activePreviewMode = 'kot';
    btnPrevKot.className = 'adm-btn adm-btn-primary adm-btn-sm';
    btnPrevBill.className = 'adm-btn adm-btn-outline adm-btn-sm';
    await renderThermalLivePreview();
  });

  btnPrevBill?.addEventListener('click', async () => {
    activePreviewMode = 'bill';
    btnPrevBill.className = 'adm-btn adm-btn-primary adm-btn-sm';
    btnPrevKot.className = 'adm-btn adm-btn-outline adm-btn-sm';
    await renderThermalLivePreview();
  });

  // KOT Preset Buttons
  document.querySelectorAll('.kot-w-preset').forEach(btn => {
    btn.addEventListener('click', async () => {
      printerSettings.kot_paper_width = parseFloat(btn.dataset.width);
      const customInp = document.getElementById('kot-custom-width');
      if (customInp) customInp.value = btn.dataset.width;
      updatePresetButtonsUI();
      await renderThermalLivePreview();
    });
  });

  // Bill Preset Buttons
  document.querySelectorAll('.bill-w-preset').forEach(btn => {
    btn.addEventListener('click', async () => {
      printerSettings.bill_paper_width = btn.dataset.width === 'A4' ? 'A4' : parseFloat(btn.dataset.width);
      const customInp = document.getElementById('bill-custom-width');
      if (customInp) customInp.value = btn.dataset.width;
      updatePresetButtonsUI();
      await renderThermalLivePreview();
    });
  });

  // Live input change listeners for instant canvas update
  const bindLiveInput = (id, callback) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', async () => { callback(); await renderThermalLivePreview(); });
    el.addEventListener('change', async () => { callback(); await renderThermalLivePreview(); });
  };

  bindLiveInput('kot-custom-width', () => { printerSettings.kot_paper_width = parseFloat(document.getElementById('kot-custom-width').value || '80'); updatePresetButtonsUI(); });
  bindLiveInput('kot-auto-cut', () => { printerSettings.kot_auto_cut = document.getElementById('kot-auto-cut').value; });
  
  // KOT Down Gap / Bottom Feed Sync
  const syncKotFeed = (val) => {
    const num = Math.max(1, Math.min(10, parseInt(val || '3')));
    printerSettings.kot_bottom_feed = num;
    const inp = document.getElementById('kot-bottom-feed');
    const sld = document.getElementById('kot-bottom-feed-slider');
    const lbl = document.getElementById('kot-down-gap-label');
    if (inp && inp.value != num) inp.value = num;
    if (sld && sld.value != num) sld.value = num;
    if (lbl) lbl.textContent = `${num} lines`;
  };
  bindLiveInput('kot-bottom-feed', () => syncKotFeed(document.getElementById('kot-bottom-feed')?.value));
  bindLiveInput('kot-bottom-feed-slider', () => syncKotFeed(document.getElementById('kot-bottom-feed-slider')?.value));

  // KOT Side Gap Sync
  const syncKotSideGap = (val) => {
    const num = Math.max(0, Math.min(12, parseFloat(val || '2')));
    printerSettings.kot_side_gap = num;
    const inp = document.getElementById('kot-side-gap');
    const sld = document.getElementById('kot-side-gap-slider');
    const lbl = document.getElementById('kot-side-gap-label');
    if (inp && inp.value != num) inp.value = num;
    if (sld && sld.value != num) sld.value = num;
    if (lbl) lbl.textContent = `${num} mm`;
  };
  bindLiveInput('kot-side-gap', () => syncKotSideGap(document.getElementById('kot-side-gap')?.value));
  bindLiveInput('kot-side-gap-slider', () => syncKotSideGap(document.getElementById('kot-side-gap-slider')?.value));

  bindLiveInput('kot-font-size', () => { printerSettings.kot_font_size = document.getElementById('kot-font-size').value; });
  bindLiveInput('kot-item-separator', () => { printerSettings.kot_item_separator = document.getElementById('kot-item-separator').value; });

  bindLiveInput('kot-toggle-table', () => { printerSettings.kot_show_table = document.getElementById('kot-toggle-table').checked; });
  bindLiveInput('kot-toggle-order-type', () => { printerSettings.kot_show_order_type = document.getElementById('kot-toggle-order-type').checked; });
  bindLiveInput('kot-toggle-customer', () => { printerSettings.kot_show_customer = document.getElementById('kot-toggle-customer').checked; });
  bindLiveInput('kot-toggle-time', () => { printerSettings.kot_show_timestamp = document.getElementById('kot-toggle-time').checked; });
  bindLiveInput('kot-toggle-notes', () => { printerSettings.kot_show_item_notes = document.getElementById('kot-toggle-notes').checked; });
  bindLiveInput('kot-toggle-highlight-qty', () => { printerSettings.kot_highlight_qty = document.getElementById('kot-toggle-highlight-qty').checked; });
  bindLiveInput('kot-toggle-category', () => { printerSettings.kot_show_category = document.getElementById('kot-toggle-category').checked; });

  bindLiveInput('bill-custom-width', () => { printerSettings.bill_paper_width = document.getElementById('bill-custom-width').value; updatePresetButtonsUI(); });
  bindLiveInput('bill-auto-cut', () => { printerSettings.bill_auto_cut = document.getElementById('bill-auto-cut').value; });
  
  // Bill Down Gap / Bottom Feed Sync
  const syncBillFeed = (val) => {
    const num = Math.max(1, Math.min(10, parseInt(val || '4')));
    printerSettings.bill_bottom_feed = num;
    const inp = document.getElementById('bill-bottom-feed');
    const sld = document.getElementById('bill-bottom-feed-slider');
    const lbl = document.getElementById('bill-down-gap-label');
    if (inp && inp.value != num) inp.value = num;
    if (sld && sld.value != num) sld.value = num;
    if (lbl) lbl.textContent = `${num} lines`;
  };
  bindLiveInput('bill-bottom-feed', () => syncBillFeed(document.getElementById('bill-bottom-feed')?.value));
  bindLiveInput('bill-bottom-feed-slider', () => syncBillFeed(document.getElementById('bill-bottom-feed-slider')?.value));

  // Bill Side Gap Sync
  const syncBillSideGap = (val) => {
    const num = Math.max(0, Math.min(12, parseFloat(val || '2')));
    printerSettings.bill_side_gap = num;
    const inp = document.getElementById('bill-side-gap');
    const sld = document.getElementById('bill-side-gap-slider');
    const lbl = document.getElementById('bill-side-gap-label');
    if (inp && inp.value != num) inp.value = num;
    if (sld && sld.value != num) sld.value = num;
    if (lbl) lbl.textContent = `${num} mm`;
  };
  bindLiveInput('bill-side-gap', () => syncBillSideGap(document.getElementById('bill-side-gap')?.value));
  bindLiveInput('bill-side-gap-slider', () => syncBillSideGap(document.getElementById('bill-side-gap-slider')?.value));

  bindLiveInput('bill-show-logo', () => { printerSettings.bill_show_logo = document.getElementById('bill-show-logo').checked; });
  bindLiveInput('bill-logo-url', () => { printerSettings.bill_logo_url = document.getElementById('bill-logo-url').value; });
  bindLiveInput('bill-toggle-show-place', () => { printerSettings.bill_show_place = document.getElementById('bill-toggle-show-place').checked; });
  bindLiveInput('bill-toggle-show-table', () => { printerSettings.bill_show_table = document.getElementById('bill-toggle-show-table').checked; });
  bindLiveInput('bill-restaurant-name', () => { printerSettings.restaurant_name = document.getElementById('bill-restaurant-name').value; });
  bindLiveInput('bill-phone', () => { printerSettings.restaurant_phone = document.getElementById('bill-phone').value; });
  bindLiveInput('bill-address', () => { printerSettings.restaurant_address = document.getElementById('bill-address').value; });
  bindLiveInput('bill-gstin', () => { printerSettings.restaurant_gstin = document.getElementById('bill-gstin').value; });
  bindLiveInput('bill-fssai', () => { printerSettings.restaurant_fssai = document.getElementById('bill-fssai').value; });
  bindLiveInput('bill-total-tables', () => {
    const tVal = parseInt(document.getElementById('bill-total-tables').value, 10);
    printerSettings.total_tables = (!isNaN(tVal) && tVal > 0) ? tVal : 19;
    renderTablesPanel();
  });
  bindLiveInput('bill-cgst-rate', () => { printerSettings.cgst_rate = parseFloat(document.getElementById('bill-cgst-rate').value || '2.5'); });
  bindLiveInput('bill-sgst-rate', () => { printerSettings.sgst_rate = parseFloat(document.getElementById('bill-sgst-rate').value || '2.5'); });
  bindLiveInput('bill-upi-id', () => { printerSettings.bill_upi_id = document.getElementById('bill-upi-id').value; });
  bindLiveInput('bill-upi-payee-name', () => { printerSettings.bill_upi_payee_name = document.getElementById('bill-upi-payee-name').value; });
  bindLiveInput('bill-footer-msg', () => { printerSettings.bill_footer_message = document.getElementById('bill-footer-msg').value; });

  // Bill Typography, Boldness & Paper Reducer Live Listeners
  const syncBillFontSize = async (val) => {
    const num = Math.max(7.5, Math.min(16, parseFloat(val || '10')));
    printerSettings.bill_font_size = num;
    const inp = document.getElementById('bill-font-size-input');
    const sld = document.getElementById('bill-font-size-slider');
    const lbl = document.getElementById('bill-font-size-label');
    if (inp && inp.value != num) inp.value = num;
    if (sld && sld.value != num) sld.value = num;
    if (lbl) lbl.textContent = `${num.toFixed(1)} px`;
    updatePresetButtonsUI();
    await renderThermalLivePreview();
  };
  bindLiveInput('bill-font-size-slider', () => syncBillFontSize(document.getElementById('bill-font-size-slider')?.value));
  bindLiveInput('bill-font-size-input', () => syncBillFontSize(document.getElementById('bill-font-size-input')?.value));

  document.querySelectorAll('.bill-font-preset').forEach(btn => {
    btn.addEventListener('click', async () => {
      await syncBillFontSize(btn.dataset.size);
    });
  });

  bindLiveInput('bill-font-weight-select', () => { printerSettings.bill_font_weight = document.getElementById('bill-font-weight-select').value; });
  bindLiveInput('bill-density-select', () => { printerSettings.bill_density = document.getElementById('bill-density-select').value; });
  bindLiveInput('bill-qr-size-select', () => { printerSettings.bill_qr_size = document.getElementById('bill-qr-size-select').value; });
  bindLiveInput('bill-toggle-bold-items', () => { printerSettings.bill_bold_items = document.getElementById('bill-toggle-bold-items').checked; });
  bindLiveInput('bill-toggle-bold-headers', () => { printerSettings.bill_bold_headers = document.getElementById('bill-toggle-bold-headers').checked; });
  bindLiveInput('bill-toggle-bold-totals', () => { printerSettings.bill_bold_totals = document.getElementById('bill-toggle-bold-totals').checked; });
  bindLiveInput('bill-toggle-compact-header', () => { printerSettings.bill_compact_header = document.getElementById('bill-toggle-compact-header').checked; });
  bindLiveInput('bill-toggle-review-qr', () => { printerSettings.bill_show_review_qr = document.getElementById('bill-toggle-review-qr').checked; });
  bindLiveInput('bill-review-url', () => { printerSettings.bill_review_url = document.getElementById('bill-review-url').value; });
  bindLiveInput('bill-review-heading', () => { printerSettings.bill_review_heading = document.getElementById('bill-review-heading').value; });
  bindLiveInput('bill-review-subtext', () => { printerSettings.bill_review_subtext = document.getElementById('bill-review-subtext').value; });
  bindLiveInput('printer-auto-settle-toggle', () => { printerSettings.auto_print_on_settle = document.getElementById('printer-auto-settle-toggle').checked; });
  bindLiveInput('printer-direct-print-toggle', () => { printerSettings.direct_print_enabled = document.getElementById('printer-direct-print-toggle').checked; });

  // Add Sample Item Button
  document.getElementById('btn-add-sample-item')?.addEventListener('click', async () => {
    samplePreviewItems.push({
      id: String(Date.now()),
      name: 'New Menu Item',
      qty: 1,
      price: 100,
      category: 'Food',
      notes: ''
    });
    renderSampleItemsEditor();
    await renderThermalLivePreview();
  });

  // Save to Database Button
  document.getElementById('printer-save-db-btn')?.addEventListener('click', savePrinterSettingsToDB);

  // Desktop Target Printer Dropdown change
  document.getElementById('desktop-printer-select')?.addEventListener('change', (e) => {
    printerSettings.active_printer_name = e.target.value;
    try {
      localStorage.setItem('qz-printer-name', e.target.value);
    } catch (err) {}
    showAdminToast(`Target printer set to "${e.target.value}"`, 'info');
  });

  // Test Print Silent KOT Button
  document.getElementById('printer-test-kot-btn')?.addEventListener('click', async () => {
    const mockOrder = {
      id: 'test-kot-' + Date.now(),
      order_number: 'TEST-01',
      daily_order_number: 1,
      order_type: 'table',
      table_number: 5,
      notes: '[TEST TICKET] Zero Dialog Silent KOT',
      customer_name: 'Test Cashier'
    };
    const mockItems = [
      { name: 'Special Chicken Biryani', qty: 2, price: 180, notes: 'Spicy, Extra Raita' },
      { name: 'Mutton Kebab Roll', qty: 1, price: 120, notes: 'No Onion' }
    ];
    await printKOT(mockOrder, mockItems, { isReprint: true, roundNumber: 1 });
    showAdminToast('Test KOT sent silently to Kitchen Printer! 👨‍🍳', 'success');
  });

  // Test Print Silent Hardware Bill Button
  document.getElementById('printer-test-hardware-btn')?.addEventListener('click', async () => {
    const mockOrder = {
      id: 'test-bill-' + Date.now(),
      order_number: 'TEST-01',
      daily_order_number: 1,
      order_type: 'table',
      table_number: 5,
      payment_status: 'paid',
      ticket_status: 'CLOSED',
      payment_method: 'cash',
      total_amount: 480,
      subtotal_amount: 457.14,
      taxable_amount: 457.14,
      cgst_amount: 11.43,
      sgst_amount: 11.43,
      created_at: new Date().toISOString()
    };
    const mockItems = [
      { name: 'Special Chicken Biryani', qty: 2, unit_price: 180, price: 180, line_total: 360 },
      { name: 'Mutton Kebab Roll', qty: 1, unit_price: 120, price: 120, line_total: 120 }
    ];
    await printOrderReceiptWithTax(mockOrder, mockItems, { isReprint: true });
    showAdminToast('Test receipt sent to TVS RP3200 Plus! ✅', 'success');
  });

  // Print Active Sample (KOT or Bill)
  document.getElementById('btn-print-sample-active')?.addEventListener('click', async () => {
    const isKot = activePreviewMode === 'kot';
    const widthMm = isKot ? (printerSettings.kot_paper_width || 80) : (printerSettings.bill_paper_width || 80);
    const mockOrder = {
      id: 'sample-preview-' + Date.now(),
      order_number: 'SMPL-01',
      daily_order_number: 1,
      order_type: 'table',
      table_number: 3,
      payment_status: isKot ? 'unpaid' : 'paid',
      ticket_status: isKot ? 'OPEN' : 'CLOSED',
      payment_method: 'cash',
      total_amount: 480
    };
    if (isKot) {
      await printKOT(mockOrder, samplePreviewItems, { isReprint: true });
      showAdminToast('Sample KOT sent to TVS RP3200 Plus! 👨‍🍳', 'success');
    } else {
      await printOrderReceiptWithTax(mockOrder, samplePreviewItems, { isReprint: true });
      showAdminToast('Sample Bill sent to TVS RP3200 Plus! 🧾', 'success');
    }
  });

  // Copy Preview HTML
  document.getElementById('btn-copy-preview-html')?.addEventListener('click', () => {
    const canvas = document.getElementById('thermal-preview-canvas');
    if (canvas && navigator.clipboard) {
      navigator.clipboard.writeText(canvas.innerHTML);
      showAdminToast('Copied preview HTML to clipboard! 📋', 'success');
    }
  });

  initQuickBillAdjusterListeners();
}

// ════════════════════════════════════════════════════════
// 🎛️ QUICK BILL SIZE, BOLDNESS & PAPER REDUCER MODAL
// ════════════════════════════════════════════════════════

function openQuickBillAdjusterModal() {
  const modal = document.getElementById('modal-quick-bill-adjuster');
  if (!modal) return;
  syncPrinterSettingsToUI();
  modal.style.display = 'flex';
  renderQuickBillAdjusterPreview();
}
window.openQuickBillAdjusterModal = openQuickBillAdjusterModal;

function closeQuickBillAdjusterModal() {
  const modal = document.getElementById('modal-quick-bill-adjuster');
  if (modal) modal.style.display = 'none';
}
window.closeQuickBillAdjusterModal = closeQuickBillAdjusterModal;

function initQuickBillAdjusterListeners() {
  if (quickAdjusterInitialized) return;
  quickAdjusterInitialized = true;

  document.getElementById('btn-quick-bill-adjust')?.addEventListener('click', openQuickBillAdjusterModal);
  document.getElementById('quick-bill-adjuster-close-btn')?.addEventListener('click', closeQuickBillAdjusterModal);

  document.getElementById('modal-quick-bill-adjuster')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-quick-bill-adjuster')) closeQuickBillAdjusterModal();
  });

  // Modal Width buttons
  document.querySelectorAll('.qb-width-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      printerSettings.bill_paper_width = parseFloat(btn.dataset.width);
      const customInp = document.getElementById('bill-custom-width');
      if (customInp) customInp.value = btn.dataset.width;
      updatePresetButtonsUI();
      await renderThermalLivePreview();
      await renderQuickBillAdjusterPreview();
    });
  });

  // Modal Font Size
  const syncQbFontSize = async (val) => {
    const num = Math.max(7.5, Math.min(16, parseFloat(val || '10')));
    printerSettings.bill_font_size = num;
    const inp = document.getElementById('qb-font-size-input');
    const sld = document.getElementById('qb-font-size-slider');
    const valLbl = document.getElementById('qb-font-size-val');
    if (inp && inp.value != num) inp.value = num;
    if (sld && sld.value != num) sld.value = num;
    if (valLbl) valLbl.textContent = `${num.toFixed(1)} px`;

    // Also sync to settings tab inputs
    const bInp = document.getElementById('bill-font-size-input');
    const bSld = document.getElementById('bill-font-size-slider');
    const bLbl = document.getElementById('bill-font-size-label');
    if (bInp && bInp.value != num) bInp.value = num;
    if (bSld && bSld.value != num) bSld.value = num;
    if (bLbl) bLbl.textContent = `${num.toFixed(1)} px`;

    updatePresetButtonsUI();
    await renderThermalLivePreview();
    await renderQuickBillAdjusterPreview();
  };

  document.getElementById('qb-font-size-slider')?.addEventListener('input', (e) => syncQbFontSize(e.target.value));
  document.getElementById('qb-font-size-input')?.addEventListener('input', (e) => syncQbFontSize(e.target.value));

  document.querySelectorAll('.qb-font-preset').forEach(btn => {
    btn.addEventListener('click', () => syncQbFontSize(btn.dataset.size));
  });

  // Modal Selects & Toggles
  const bindQbEvent = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', async () => { fn(); syncPrinterSettingsToUI(); await renderThermalLivePreview(); await renderQuickBillAdjusterPreview(); });
    el.addEventListener('input', async () => { fn(); syncPrinterSettingsToUI(); await renderThermalLivePreview(); await renderQuickBillAdjusterPreview(); });
  };

  bindQbEvent('qb-font-weight-select', () => { printerSettings.bill_font_weight = document.getElementById('qb-font-weight-select').value; });
  bindQbEvent('qb-density-select', () => { printerSettings.bill_density = document.getElementById('qb-density-select').value; });
  bindQbEvent('qb-qr-size-select', () => { printerSettings.bill_qr_size = document.getElementById('qb-qr-size-select').value; });
  bindQbEvent('qb-bottom-feed-select', () => { printerSettings.bill_bottom_feed = parseInt(document.getElementById('qb-bottom-feed-select').value || '2'); });
  bindQbEvent('qb-bold-items', () => { printerSettings.bill_bold_items = document.getElementById('qb-bold-items').checked; });
  bindQbEvent('qb-bold-headers', () => { printerSettings.bill_bold_headers = document.getElementById('qb-bold-headers').checked; });
  bindQbEvent('qb-bold-totals', () => { printerSettings.bill_bold_totals = document.getElementById('qb-bold-totals').checked; });
  bindQbEvent('qb-compact-header', () => { printerSettings.bill_compact_header = document.getElementById('qb-compact-header').checked; });

  // Save All
  document.getElementById('qb-save-all-btn')?.addEventListener('click', async () => {
    await savePrinterSettingsToDB();
    closeQuickBillAdjusterModal();
    showAdminToast('Bill sizing & reduction settings applied! 💾', 'success');
  });

  // Reset to Defaults
  document.getElementById('qb-reset-default-btn')?.addEventListener('click', async () => {
    printerSettings.bill_font_size = 10;
    printerSettings.bill_font_weight = '700';
    printerSettings.bill_density = 'compact';
    printerSettings.bill_paper_width = 80;
    printerSettings.bill_bold_items = true;
    printerSettings.bill_bold_headers = true;
    printerSettings.bill_bold_totals = true;
    printerSettings.bill_compact_header = false;
    printerSettings.bill_qr_size = 'medium';
    printerSettings.bill_bottom_feed = 2;
    syncPrinterSettingsToUI();
    await renderThermalLivePreview();
    await renderQuickBillAdjusterPreview();
    showAdminToast('Reset to default bill settings.', 'info');
  });

  // Test Print
  document.getElementById('qb-test-print-btn')?.addEventListener('click', async () => {
    const mockOrder = {
      id: 'sample-test',
      order_number: 101,
      customer_name: 'Walk-in Customer',
      customer_phone: '+91 99999 88888',
      order_type: 'dine-in',
      table_number: '02',
      created_at: new Date().toISOString(),
      payment_status: 'paid',
      total_amount: 425
    };
    await printOrderReceiptWithTax(mockOrder, samplePreviewItems);
  });
}


// ════════════════════════════════════════════════════════
// GOOGLE PROFILE MANAGER PANEL
// ════════════════════════════════════════════════════════
let profilePanelMounted = false;

function getGoogleBusinessProfile() {
  try {
    const raw = localStorage.getItem('limra_google_business_profile');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    name: 'LIMRA RESTAURANT',
    category: 'Mughlai & Biryani Restaurant',
    reviewUrl: 'https://g.page/r/CcrqEfWap5zfEBE/review',
    mapsUrl: 'https://maps.google.com/?q=LIMRA+Restaurant',
    hours: '11:00 AM – 11:30 PM (Daily)',
    phone: '+91 99999 88888',
    address: 'Main Road, Near Bus Stand, Egra, West Bengal',
    rating: '4.8',
    reviewsCount: '348',
    viewsCount: '12.4k',
    status: 'Verified ✓'
  };
}

function renderGoogleBusinessProfileUI() {
  const profile = getGoogleBusinessProfile();
  
  if ($('gprofile-kpi-rating')) $('gprofile-kpi-rating').textContent = `${profile.rating} ⭐`;
  if ($('gprofile-kpi-reviews')) $('gprofile-kpi-reviews').textContent = `${profile.reviewsCount} Reviews`;
  if ($('gprofile-kpi-views')) $('gprofile-kpi-views').textContent = `${profile.viewsCount} Views/mo`;
  if ($('gprofile-kpi-status')) $('gprofile-kpi-status').textContent = profile.status || 'Verified ✓';

  if ($('gbiz-name')) $('gbiz-name').value = profile.name || 'LIMRA RESTAURANT';
  if ($('gbiz-category')) $('gbiz-category').value = profile.category || 'Mughlai & Biryani Restaurant';
  if ($('gbiz-review-url')) $('gbiz-review-url').value = profile.reviewUrl || 'https://g.page/r/CcrqEfWap5zfEBE/review';
  if ($('gbiz-maps-url')) $('gbiz-maps-url').value = profile.mapsUrl || 'https://maps.google.com/?q=LIMRA+Restaurant';
  if ($('gbiz-hours')) $('gbiz-hours').value = profile.hours || '11:00 AM – 11:30 PM (Daily)';
  if ($('gbiz-phone')) $('gbiz-phone').value = profile.phone || '+91 99999 88888';
  if ($('gbiz-address')) $('gbiz-address').value = profile.address || 'Main Road, Near Bus Stand, Egra, West Bengal';
}

function renderProfileInfo(user) {
  if (!user) return;
  const meta = user.user_metadata || {};
  const appMeta = user.app_metadata || {};
  const savedPhoto = localStorage.getItem('admin-profile-photo') || '';
  const photoUrl = savedPhoto || meta.avatar_url || meta.picture || meta.photo_url || '';
  const imgEl  = document.getElementById('profile-avatar-img');
  const initEl = document.getElementById('profile-avatar-initials');
  if (imgEl && initEl) {
    if (photoUrl) { imgEl.src = photoUrl; imgEl.style.display = 'block'; initEl.style.display = 'none'; }
    else { imgEl.style.display = 'none'; initEl.style.display = 'block'; initEl.textContent = (meta.full_name || user.email || 'A').charAt(0).toUpperCase(); }
  }
  const savedName = localStorage.getItem('admin-display-name') || '';
  const displayName = savedName || meta.full_name || meta.name || (user.email||'').split('@')[0] || 'Admin';
  ['profile-display-name'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = displayName; });
  const emailEl = document.getElementById('profile-email-display');
  if (emailEl) emailEl.textContent = user.email || '—';
  const nameInp = document.getElementById('profile-name-input'); if (nameInp) nameInp.value = displayName;
  const emailInp= document.getElementById('profile-email-input'); if (emailInp) emailInp.value = user.email || '';
  const photoInp= document.getElementById('profile-photo-input'); if (photoInp) photoInp.value = photoUrl;
  const provLabel = document.getElementById('profile-provider-label');
  const provList = appMeta.providers || (appMeta.provider ? [appMeta.provider] : ['email']);
  if (provLabel) provLabel.textContent = provList.includes('google') ? 'Google Authenticated' : provList.join(', ');
  const grid = document.getElementById('profile-info-grid');
  if (grid) {
    const row = (l,v) => `<div style="display:flex;justify-content:space-between;gap:1rem;"><span style="font-size:0.78rem;color:var(--adm-muted);font-weight:600;">${l}</span><span style="font-size:0.82rem;font-weight:700;word-break:break-all;">${v||'—'}</span></div><hr style="border:none;border-top:1px solid var(--adm-border);margin:.2rem 0;">`;
    grid.innerHTML = [
      row('User ID', (user.id||'').slice(0,18)+'…'),
      row('Email', user.email),
      row('Signed Up', user.created_at ? new Date(user.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'),
      row('Last Login', user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'),
      row('Auth Provider', provList.join(', ')),
      row('Role', user.role || 'authenticated'),
    ].join('');
  }
}

async function initProfilePanel() {
  const container = document.getElementById('settings-subtab-profile') || document.getElementById('settings-subtab-integrations');
  if (container && !container.querySelector('#gbiz-name') && !document.getElementById('gbiz-name') && !document.getElementById('panel-profile')) {
    const tpl = document.getElementById('panel-profile-content');
    if (tpl) {
      container.appendChild(tpl.content.cloneNode(true));
      const p = document.getElementById('panel-profile');
      if (p) p.classList.add('active');
    }
  } else if (!container && !document.getElementById('gbiz-name') && !document.getElementById('panel-profile')) {
    const admc = document.getElementById('adm-content');
    const tpl = document.getElementById('panel-profile-content');
    if (tpl && admc) admc.appendChild(tpl.content.cloneNode(true));
  }
  const prof = document.getElementById('panel-profile');
  if (prof) prof.classList.add('active');

  // Render Google Business Profile info
  renderGoogleBusinessProfileUI();

  try { const { data } = await insforge.auth.getCurrentUser(); if (data?.user) renderProfileInfo(data.user); } catch(e) {}
  if (profilePanelMounted) return;
  profilePanelMounted = true;

  // 1. Save Business Profile Listing
  document.getElementById('gprofile-save-biz-btn')?.addEventListener('click', () => {
    const updated = {
      name: document.getElementById('gbiz-name')?.value?.trim() || 'LIMRA RESTAURANT',
      category: document.getElementById('gbiz-category')?.value?.trim() || 'Mughlai & Biryani Restaurant',
      reviewUrl: document.getElementById('gbiz-review-url')?.value?.trim() || 'https://g.page/r/CcrqEfWap5zfEBE/review',
      mapsUrl: document.getElementById('gbiz-maps-url')?.value?.trim() || 'https://maps.google.com/?q=LIMRA+Restaurant',
      hours: document.getElementById('gbiz-hours')?.value?.trim() || '11:00 AM – 11:30 PM (Daily)',
      phone: document.getElementById('gbiz-phone')?.value?.trim() || '+91 99999 88888',
      address: document.getElementById('gbiz-address')?.value?.trim() || 'Main Road, Near Bus Stand, Egra, West Bengal',
      rating: '4.8',
      reviewsCount: '348',
      viewsCount: '12.4k',
      status: 'Verified ✓'
    };
    localStorage.setItem('limra_google_business_profile', JSON.stringify(updated));
    renderGoogleBusinessProfileUI();
    showAdminToast('Google Business Profile details saved! ✅', 'success');
  });

  // 2. Copy Review Link
  document.getElementById('gbiz-copy-review-link')?.addEventListener('click', () => {
    const url = document.getElementById('gbiz-review-url')?.value?.trim() || 'https://g.page/r/CcrqEfWap5zfEBE/review';
    navigator.clipboard.writeText(url);
    showAdminToast('Google Review link copied to clipboard! 📋', 'info');
  });

  // 3. View on Google Maps
  document.getElementById('gprofile-open-maps-btn')?.addEventListener('click', () => {
    const url = document.getElementById('gbiz-maps-url')?.value?.trim() || 'https://maps.google.com/?q=LIMRA+Restaurant';
    window.open(url, '_blank');
  });

  // 4. Boost Google Reviews via WhatsApp
  document.getElementById('gprofile-boost-reviews-btn')?.addEventListener('click', () => {
    const profile = getGoogleBusinessProfile();
    const message = encodeURIComponent(
      `Hello! Thank you for dining with us at ${profile.name}! 🍽️\n\nWe would truly appreciate 10 seconds of your time to share your experience with a 5-star rating on Google Maps:\n⭐ ${profile.reviewUrl}\n\nThank you for your support!`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  });

  // 5. Copy Smart AI Replies
  document.querySelectorAll('.btn-copy-review-reply').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name || 'Valued Guest';
      const profile = getGoogleBusinessProfile();
      const replyText = `Dear ${name}, thank you so much for the 5-star rating and kind feedback! We are thrilled that you had a wonderful dining experience at ${profile.name}. We look forward to welcoming you back soon! 🍽️✨`;
      navigator.clipboard.writeText(replyText);
      btn.textContent = '✓ Copied Reply!';
      setTimeout(() => { btn.textContent = '📋 Copy Smart Reply'; }, 2000);
      showAdminToast(`Smart reply for ${name} copied to clipboard! 📋`, 'info');
    });
  });

  // 6. Admin Profile Name Save
  document.getElementById('profile-name-save')?.addEventListener('click', () => {
    const v = document.getElementById('profile-name-input')?.value?.trim();
    if (!v) return;
    localStorage.setItem('admin-display-name', v);
    ['admin-greeting'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = `Hello, ${v}`; });
    showAdminToast('Display name saved locally! ✅', 'success');
  });

  // 7. Admin Profile Photo Save
  document.getElementById('profile-photo-save')?.addEventListener('click', () => {
    const v = document.getElementById('profile-photo-input')?.value?.trim();
    localStorage.setItem('admin-profile-photo', v);
    const imgEl = document.getElementById('profile-avatar-img');
    const initEl = document.getElementById('profile-avatar-initials');
    if (imgEl && initEl) {
      if (v) { imgEl.src = v; imgEl.style.display = 'block'; initEl.style.display = 'none'; }
      else { imgEl.style.display = 'none'; initEl.style.display = 'block'; }
    }
    showAdminToast('Profile photo updated! ✅', 'success');
  });

  // 8. Refresh Session
  document.getElementById('profile-refresh-btn')?.addEventListener('click', async () => {
    try {
      const { data } = await insforge.auth.getCurrentUser();
      if (data?.user) {
        renderProfileInfo(data.user);
        renderGoogleBusinessProfileUI();
      }
    } catch(e) {
      showAdminToast('Could not refresh: ' + e.message, 'error');
    }
  });
}
// ════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════
// POS BILLING PANEL & TOTAL BILLS OVERVIEW
// ════════════════════════════════════════════════════════

let posCart = []; // [{ id, name, price, qty }]
let posEditingOrderId = null;
let posOrderType = 'table';
let posBillingMounted = false;
let allFoodsCache = [];
let posActiveCat = "all";
let posSelectedPlace = null; // { id, name, charge }

function updatePosTableBadge() {
  const badgeText = $('pos-table-badge-text');
  const badgeIcon = $('pos-table-badge-icon');
  const cartBadge = $('pos-cart-type-badge');
  const badgeBtn = $('pos-top-table-badge');
  const tblInp = $('pos-table-number');

  let label = 'Select Table';
  let icon = '🪑';
  let title = 'Click to change Table';

  if (posOrderType === 'delivery') {
    label = 'Delivery';
    icon = '🚗';
    title = 'Delivery Order';
  } else if (posOrderType === 'pickup') {
    label = 'Takeaway';
    icon = '🥡';
    title = 'Takeaway Order';
  } else {
    const rawVal = tblInp ? tblInp.value.trim() : '';
    if (rawVal) {
      label = rawVal.toLowerCase().startsWith('table') ? rawVal : `Table ${rawVal}`;
    } else {
      label = 'Select Table';
    }
    icon = '🪑';
    title = 'Click to change Table';
  }

  if (badgeText) badgeText.textContent = label;
  if (badgeIcon) badgeIcon.textContent = icon;
  if (cartBadge) cartBadge.textContent = label;
  if (badgeBtn) badgeBtn.title = title;

  // Synchronize quick table button pills (.active class)
  const activeTblDigits = (tblInp && posOrderType === 'table') ? tblInp.value.replace(/\D/g, '') : '';
  document.querySelectorAll('.pos-quick-table-btn').forEach(btn => {
    if (activeTblDigits && btn.dataset.tbl === activeTblDigits) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function syncPosOrderTypeState(type) {
  posOrderType = type;
  document.querySelectorAll('.pos-type-btn').forEach(b => {
    const isSelected = b.dataset.type === type;
    b.className = 'pos-type-btn adm-btn ' + (isSelected ? 'adm-btn-primary' : 'adm-btn-outline');
  });

  if ($('pos-table-field')) $('pos-table-field').style.display = type === 'table' ? 'block' : 'none';
  if ($('pos-delivery-field')) $('pos-delivery-field').style.display = type === 'delivery' ? 'block' : 'none';

  // Requirement 4: For pickup or delivery, HIDE HOLD and KOT!
  const holdKotGroup = $('pos-hold-kot-group');
  if (holdKotGroup) {
    holdKotGroup.style.display = type === 'table' ? 'grid' : 'none';
  }

  // Requirement 1: Mandatory only for delivery, optional for table & pickup
  const nameStar = $('pos-name-req-star');
  const phoneStar = $('pos-phone-req-star');
  const custBadge = $('pos-cust-req-badge');
  const nameInp = $('pos-customer-name');
  const phoneInp = $('pos-customer-phone');
  const billBtnLabel = $('pos-bill-btn-label');
  const billBtnIcon = $('pos-bill-btn-icon');

  if (type === 'delivery') {
    if (nameStar) nameStar.style.display = 'inline';
    if (phoneStar) phoneStar.style.display = 'inline';
    if (custBadge) custBadge.innerHTML = '<span style="color:#ef4444;font-weight:700;">* Required for Delivery</span>';
    if (nameInp) nameInp.placeholder = 'Customer Name (Required for Delivery)';
    if (phoneInp) phoneInp.placeholder = '10-digit Mobile Number (Required)';
    if (billBtnLabel) billBtnLabel.textContent = 'Create Bill (Delivery)';
    if (billBtnIcon) billBtnIcon.textContent = '🚗';
  } else if (type === 'pickup') {
    if (nameStar) nameStar.style.display = 'none';
    if (phoneStar) phoneStar.style.display = 'none';
    if (custBadge) custBadge.innerHTML = '<span style="color:var(--adm-muted);">(Optional for Takeaway)</span>';
    if (nameInp) nameInp.placeholder = 'e.g. Salim Khan (Optional)';
    if (phoneInp) phoneInp.placeholder = 'e.g. 9876543210 (Optional)';
    if (billBtnLabel) billBtnLabel.textContent = 'Create Bill (Pickup)';
    if (billBtnIcon) billBtnIcon.textContent = '🗎';
    if (nameInp) nameInp.classList.remove('pos-input-invalid');
    if (phoneInp) phoneInp.classList.remove('pos-input-invalid');
  } else {
    // table
    if (nameStar) nameStar.style.display = 'none';
    if (phoneStar) phoneStar.style.display = 'none';
    if (custBadge) custBadge.innerHTML = '<span style="color:var(--adm-muted);">(Optional for Table)</span>';
    if (nameInp) nameInp.placeholder = 'e.g. Salim Khan (Optional)';
    if (phoneInp) phoneInp.placeholder = 'e.g. 9876543210 (Optional)';
    if (billBtnLabel) billBtnLabel.textContent = 'Create Bill';
    if (billBtnIcon) billBtnIcon.textContent = '🗎';
    if (nameInp) nameInp.classList.remove('pos-input-invalid');
    if (phoneInp) phoneInp.classList.remove('pos-input-invalid');
  }

  updatePosTableBadge();

  if (typeof updatePosCartUI === 'function') {
    updatePosCartUI();
  }
}

function renderPosPlaceChips() {
  const container = $('pos-quick-places-pills');
  if (!container) return;
  if (!adminPlaces || adminPlaces.length === 0) {
    container.innerHTML = '<span style="font-size:0.75rem;color:var(--adm-muted);">No saved places found in database</span>';
    return;
  }
  container.innerHTML = adminPlaces.slice(0, 12).map(p => {
    const charge = parseFloat(p.charge || p.delivery_charge || p.delivery_fee || 0);
    const isSelected = posSelectedPlace && posSelectedPlace.name.toLowerCase() === p.name.toLowerCase();
    return `
      <button type="button" class="adm-btn adm-btn-outline adm-btn-sm pos-place-chip-btn ${isSelected ? 'active' : ''}" data-name="${escapeHtml(p.name)}" data-charge="${charge}" style="font-size:.75rem;padding:.2rem .5rem;border-radius:999px;cursor:pointer;${isSelected ? 'background:#e0e7ff;border-color:#6366f1;color:#4338ca;font-weight:700;' : ''}">
        📍 ${escapeHtml(p.name)} <span style="color:${isSelected ? '#4338ca' : '#059669'};font-weight:700;">(₹${charge})</span>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.pos-place-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      const charge = parseFloat(btn.dataset.charge || '0');
      selectPosPlace({ name, charge });
    });
  });
}

function selectPosPlace(place) {
  if (!place) return;
  posSelectedPlace = place;
  const searchInp = $('pos-place-search');
  const chip = $('pos-selected-place-chip');
  const chipText = $('pos-selected-place-text');
  const feeInp = $('pos-delivery-fee');
  const suggs = $('pos-place-suggestions');

  if (searchInp) {
    searchInp.value = place.name;
    searchInp.classList.remove('pos-input-invalid');
  }
  if (chip && chipText) {
    chipText.innerHTML = `📍 <strong>${escapeHtml(place.name)}</strong> — Delivery Charge: <strong>₹${Number(place.charge).toFixed(0)}</strong>`;
    chip.style.display = 'flex';
  }
  if (feeInp) {
    feeInp.value = place.charge;
  }
  if (suggs) suggs.style.display = 'none';

  renderPosPlaceChips();
  updatePosCartUI();
}

function clearPosSelectedPlace() {
  posSelectedPlace = null;
  const searchInp = $('pos-place-search');
  const chip = $('pos-selected-place-chip');
  const feeInp = $('pos-delivery-fee');
  const suggs = $('pos-place-suggestions');

  if (searchInp) searchInp.value = '';
  if (chip) chip.style.display = 'none';
  if (feeInp) feeInp.value = '0';
  if (suggs) suggs.style.display = 'none';

  renderPosPlaceChips();
  updatePosCartUI();
}

function initPosPlaceSearch() {
  const searchInp = $('pos-place-search');
  const suggs = $('pos-place-suggestions');
  const clearBtn = $('pos-clear-place-btn');

  if (searchInp && suggs) {
    searchInp.addEventListener('input', () => {
      const q = searchInp.value.toLowerCase().trim();
      if (!q) {
        suggs.style.display = 'none';
        return;
      }
      const matches = adminPlaces.filter(p => p.name && p.name.toLowerCase().includes(q));
      if (!matches.length) {
        suggs.innerHTML = `
          <div style="padding:.6rem .75rem;font-size:.8rem;color:var(--adm-muted);">
            No registered place found matching "<strong>${escapeHtml(q)}</strong>".
            <div style="margin-top:4px;font-size:.75rem;color:#6366f1;">(You can still type custom landmark/address below)</div>
          </div>
        `;
        suggs.style.display = 'block';
        return;
      }

      suggs.innerHTML = matches.map(p => {
        const charge = parseFloat(p.charge || p.delivery_charge || p.delivery_fee || 0);
        return `
          <div class="pos-place-sugg-item" data-name="${escapeHtml(p.name)}" data-charge="${charge}" style="padding:.55rem .75rem;cursor:pointer;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;transition:background .15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
            <div>
              <span style="font-weight:700;font-size:.85rem;color:#1e293b;">📍 ${escapeHtml(p.name)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:.4rem;">
              <span style="font-size:.78rem;font-weight:700;color:#059669;background:#ecfdf5;padding:.1rem .4rem;border-radius:4px;">₹${charge} fee</span>
              <span style="font-size:.75rem;color:#6366f1;font-weight:600;">Select ➔</span>
            </div>
          </div>
        `;
      }).join('');
      suggs.style.display = 'block';

      suggs.querySelectorAll('.pos-place-sugg-item').forEach(item => {
        item.addEventListener('click', () => {
          const name = item.dataset.name;
          const charge = parseFloat(item.dataset.charge || '0');
          selectPosPlace({ name, charge });
        });
      });
    });

    // Close suggestions on outside click
    document.addEventListener('click', (e) => {
      if (!searchInp.contains(e.target) && !suggs.contains(e.target)) {
        suggs.style.display = 'none';
      }
    });
  }

  clearBtn?.addEventListener('click', clearPosSelectedPlace);
}

function getBillSettings() {
  const rawCgst = parseFloat(printerSettings.cgst_rate ?? localStorage.getItem('qz-bill-cgst-rate'));
  const rawSgst = parseFloat(printerSettings.sgst_rate ?? localStorage.getItem('qz-bill-sgst-rate'));
  return {
    restaurantName: printerSettings.restaurant_name || localStorage.getItem('qz-bill-restaurant-name') || 'LIMRA RESTAURANT',
    address: printerSettings.restaurant_address || localStorage.getItem('qz-bill-address') || 'Main Road, Near Bus Stand, Egra',
    phone: printerSettings.restaurant_phone || localStorage.getItem('qz-bill-phone') || '+91 99999 88888',
    gstin: printerSettings.restaurant_gstin || localStorage.getItem('qz-bill-gstin') || '',
    fssai: printerSettings.restaurant_fssai || localStorage.getItem('qz-bill-fssai') || '',
    cgstRate: isNaN(rawCgst) ? 2.5 : Math.max(0, rawCgst),
    sgstRate: isNaN(rawSgst) ? 2.5 : Math.max(0, rawSgst),
    billPaperSize: parseInt(printerSettings.bill_paper_width || localStorage.getItem('qz-paper-size-bill') || '80', 10),
    kotPaperSize: parseInt(printerSettings.kot_paper_width || localStorage.getItem('qz-paper-size-kot') || '80', 10),
    billSideGap: parseFloat(printerSettings.bill_side_gap ?? localStorage.getItem('qz-bill-side-gap') ?? 2),
    kotSideGap: parseFloat(printerSettings.kot_side_gap ?? localStorage.getItem('qz-kot-side-gap') ?? 2),
    billBottomFeed: parseInt(printerSettings.bill_bottom_feed ?? localStorage.getItem('qz-bill-bottom-feed') ?? 4, 10),
    kotBottomFeed: parseInt(printerSettings.kot_bottom_feed ?? localStorage.getItem('qz-kot-bottom-feed') ?? 3, 10),
    showLogo: printerSettings.bill_show_logo !== false,
    logoUrl: printerSettings.bill_logo_url || '/images/logo.png',
    upiId: printerSettings.bill_upi_id || '',
    upiPayeeName: printerSettings.bill_upi_payee_name || 'LIMRA RESTAURANT',
    footerMessage: printerSettings.bill_footer_message || 'Thank you for dining with us! Please visit again.'
  };
}

let posAppliedCoupon = null; // { id, code, discount_pct, min_bill, max_uses, used_count, expiry_date, description }
let posCustomerLookupTimer = null;

function parseCouponExpiryEndOfDay(expiryDateStr) {
  if (!expiryDateStr) return null;
  const str = String(expiryDateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return new Date(`${str}T23:59:59.999`);
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function isCouponActiveAndValid(c, now = new Date()) {
  if (!c || typeof c !== 'object') return false;
  const code = String(c.code || '').trim();
  if (!code) return false;
  if (c.active === false) return false;
  const pct = Number(c.discount_pct || 0);
  if (isNaN(pct) || pct <= 0 || pct > 100) return false;
  const expDate = parseCouponExpiryEndOfDay(c.expiry_date);
  if (expDate && expDate < now) return false;
  const maxUses = Number(c.max_uses || 0);
  const usedCount = Number(c.used_count || 0);
  if (maxUses > 0 && usedCount >= maxUses) return false;
  return true;
}

export function getValidPosCoupons(couponsList = adminCoupons, now = new Date()) {
  return (couponsList || []).filter(c => isCouponActiveAndValid(c, now));
}

export function validatePosCoupon(codeOrCoupon, subtotal = 0, customerPhone = '', options = {}) {
  const couponsList = options.coupons || adminCoupons || [];
  const currentApplied = options.appliedCoupon !== undefined ? options.appliedCoupon : posAppliedCoupon;
  const now = options.now ? new Date(options.now) : new Date();
  const rawCode = typeof codeOrCoupon === 'string'
    ? codeOrCoupon.trim().toUpperCase()
    : String(codeOrCoupon?.code || '').trim().toUpperCase();

  if (!rawCode) {
    return { valid: false, reason: 'EMPTY_CODE', message: 'Please enter a coupon code.' };
  }

  if (currentApplied && String(currentApplied.code || '').toUpperCase() === rawCode && !options.allowRevalidateCurrent) {
    return { valid: false, reason: 'ALREADY_APPLIED', message: `Coupon "${rawCode}" is already applied to this bill.` };
  }

  if (currentApplied && String(currentApplied.code || '').toUpperCase() !== rawCode && options.preventMultiple) {
    return {
      valid: false,
      reason: 'MULTIPLE_COUPON_ATTEMPT',
      message: `Coupon "${currentApplied.code}" is already applied. Remove it before applying another coupon.`
    };
  }

  const c = (typeof codeOrCoupon === 'object' && codeOrCoupon && codeOrCoupon.code)
    ? codeOrCoupon
    : couponsList.find(item => String(item?.code || '').trim().toUpperCase() === rawCode);

  if (!c) {
    return { valid: false, reason: 'NOT_FOUND', message: `Invalid coupon code "${rawCode}".` };
  }

  if (c.active === false) {
    return { valid: false, reason: 'INACTIVE', message: `Coupon "${rawCode}" is inactive.` };
  }

  const expDate = parseCouponExpiryEndOfDay(c.expiry_date);
  if (expDate && expDate < now) {
    return { valid: false, reason: 'EXPIRED', message: `Coupon "${rawCode}" has expired (${c.expiry_date}).` };
  }

  const maxUses = Number(c.max_uses || 0);
  const usedCount = Number(c.used_count || 0);
  if (maxUses > 0 && usedCount >= maxUses) {
    return { valid: false, reason: 'MAX_USES_REACHED', message: `Coupon "${rawCode}" has reached its maximum usage limit (${maxUses}).` };
  }

  const cleanPhone = String(customerPhone || '').replace(/\D/g, '');
  if (cleanPhone.length >= 10 && cleanPhone !== '9999999999' && cleanPhone !== '0000000000') {
    const ordersSource = options.orders || orders || [];
    const alreadyUsedByCustomer = ordersSource.some(o => {
      if (!o || o.status === 'cancelled' || String(o.id) === String(posEditingOrderId || '')) return false;
      const oPhone = String(o.customer_phone || '').replace(/\D/g, '');
      if (oPhone !== cleanPhone) return false;
      const oNotes = String(o.notes || '');
      const m = oNotes.match(/\[COUPON:\s*([^\]|]+)\]/i);
      return m && m[1].trim().toUpperCase() === rawCode;
    });
    if (alreadyUsedByCustomer) {
      return { valid: false, reason: 'CUSTOMER_ALREADY_USED', message: `Customer (${cleanPhone}) has already redeemed coupon "${rawCode}".` };
    }
  }

  const minBill = Number(c.min_bill || 0);
  const safeSubtotal = Number(subtotal || 0);
  if (safeSubtotal < minBill) {
    return {
      valid: false,
      reason: 'MIN_BILL_NOT_MET',
      message: `Minimum order of ₹${minBill.toFixed(0)} required for "${rawCode}" (Subtotal: ₹${safeSubtotal.toFixed(0)}).`
    };
  }

  const pct = Number(c.discount_pct || 0);
  if (isNaN(pct) || pct <= 0 || pct > 100) {
    return { valid: false, reason: 'INVALID_DISCOUNT', message: `Coupon "${rawCode}" has an invalid discount percentage.` };
  }

  return {
    valid: true,
    coupon: {
      id: c.id ?? null,
      code: rawCode,
      discount_pct: pct,
      min_bill: minBill,
      max_uses: maxUses,
      used_count: usedCount,
      expiry_date: c.expiry_date || null,
      description: c.description || ''
    },
    message: `Coupon "${rawCode}" (${pct}% OFF) applied!`
  };
}

function showPosCouponFeedback(message, type = 'error') {
  const fb = $('pos-coupon-feedback');
  if (!fb) return;
  if (!message) {
    fb.style.display = 'none';
    fb.textContent = '';
    fb.className = 'pos-coupon-feedback';
    return;
  }
  fb.textContent = message;
  fb.className = `pos-coupon-feedback ${type === 'success' ? 'success' : 'error'}`;
  fb.style.display = 'block';
}

export function applyPosCoupon(codeOrCoupon, options = {}) {
  const subtotal = posCart.reduce((sum, i) => sum + Number(i.price || 0) * Number(i.qty || 1), 0);
  const phone = $('pos-customer-phone')?.value?.trim() || '';
  const result = validatePosCoupon(codeOrCoupon, subtotal, phone, {
    ...options,
    preventMultiple: options.replace ? false : true
  });

  if (!result.valid) {
    showPosCouponFeedback(result.message, 'error');
    if (!options.silent) showAdminToast(result.message, 'error');
    renderPosCouponPicker();
    return result;
  }

  posAppliedCoupon = result.coupon;
  if ($('pos-discount-pct')) {
    $('pos-discount-pct').value = '0';
  }
  if ($('pos-coupon-code-input')) {
    $('pos-coupon-code-input').value = result.coupon.code;
  }
  showPosCouponFeedback(result.message, 'success');
  if (!options.silent) showAdminToast(result.message, 'success');
  updatePosCartUI(false);
  renderPosCouponPicker();
  return result;
}

export function removePosCoupon(options = {}) {
  const removedCode = posAppliedCoupon?.code || '';
  posAppliedCoupon = null;
  if ($('pos-coupon-code-input')) $('pos-coupon-code-input').value = '';
  showPosCouponFeedback('', 'error');
  updatePosCartUI(false);
  renderPosCouponPicker();
  if (removedCode && !options.silent) {
    showAdminToast(`Coupon "${removedCode}" removed.`, 'info');
  }
  return { removed: Boolean(removedCode), code: removedCode };
}

export function getPosAppliedCoupon() {
  return posAppliedCoupon;
}

function renderPosCouponPicker() {
  const listEl = $('pos-coupon-picker-list');
  const clearBtn = $('pos-coupon-clear-btn');
  const codeInp = $('pos-coupon-code-input');
  if (clearBtn) {
    clearBtn.style.display = posAppliedCoupon ? 'inline-block' : 'none';
  }
  if (codeInp && posAppliedCoupon && !codeInp.value) {
    codeInp.value = posAppliedCoupon.code;
  }
  if (!listEl) return;

  const validCoupons = getValidPosCoupons(adminCoupons);
  const subtotal = posCart.reduce((sum, i) => sum + Number(i.price || 0) * Number(i.qty || 1), 0);

  if (validCoupons.length === 0) {
    listEl.innerHTML = '<div style="font-size:0.75rem;color:#64748b;text-align:center;padding:0.45rem;">No active promo coupons available.</div>';
    return;
  }

  listEl.innerHTML = validCoupons.map(c => {
    const code = String(c.code || '').toUpperCase();
    const minBill = Number(c.min_bill || 0);
    const pct = Number(c.discount_pct || 0);
    const isApplied = posAppliedCoupon && String(posAppliedCoupon.code).toUpperCase() === code;
    const isEligible = subtotal >= minBill;
    const cls = `pos-coupon-option ${isApplied ? 'applied' : ''} ${!isEligible && !isApplied ? 'ineligible' : ''}`;
    const actionLabel = isApplied ? '✓ Applied' : (isEligible ? 'Apply' : `Need ₹${Math.ceil(minBill - subtotal)} more`);
    return `
      <button type="button" class="${cls}" data-coupon-code="${escapeHtml(code)}" role="option" aria-selected="${Boolean(isApplied)}">
        <div>
          <div class="pos-coupon-opt-code">${escapeHtml(code)} · ${pct}% OFF</div>
          <div class="pos-coupon-opt-meta">Min Bill: ₹${minBill.toFixed(0)}${c.expiry_date ? ` · Exp: ${escapeHtml(String(c.expiry_date).slice(0, 10))}` : ''}</div>
        </div>
        <span class="pos-coupon-opt-action">${escapeHtml(actionLabel)}</span>
      </button>
    `;
  }).join('');

  listEl.querySelectorAll('.pos-coupon-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = btn.dataset.couponCode;
      if (!code) return;
      if (posAppliedCoupon && String(posAppliedCoupon.code).toUpperCase() === code) {
        removePosCoupon();
      } else {
        applyPosCoupon(code);
      }
    });
  });
}

window.isCouponActiveAndValid = isCouponActiveAndValid;
window.getValidPosCoupons = getValidPosCoupons;
window.validatePosCoupon = validatePosCoupon;
window.applyPosCoupon = applyPosCoupon;
window.removePosCoupon = removePosCoupon;
window.getPosAppliedCoupon = getPosAppliedCoupon;
window.renderPosCouponPicker = renderPosCouponPicker;

// ── Customer Autocomplete (Phone & Name Lookup) ─────────────────
export function lookupPosCustomers(query, options = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const digits = q.replace(/\D/g, '');
  const qLower = q.toLowerCase();
  const limit = options.limit || 6;

  const stats = Array.isArray(options.customersList) ? options.customersList : buildCustomerStats();
  const filtered = stats.filter(c => {
    if (!c || !c.phone) return false;
    const cDigits = String(c.phone).replace(/\D/g, '');
    if (!cDigits || cDigits === '9999999999' || cDigits === '0000000000') return false;
    const cName = String(c.name || '').trim();
    const matchesPhone = digits.length >= 3 && cDigits.includes(digits);
    const matchesName = qLower.length >= 2 && cName && cName.toLowerCase().includes(qLower) && cName !== 'Customer' && cName !== 'Walk-in Guest';
    return matchesPhone || matchesName;
  });

  // Sort exact phone prefix matches first, then by order count / recent activity
  filtered.sort((a, b) => {
    const aDigits = String(a.phone).replace(/\D/g, '');
    const bDigits = String(b.phone).replace(/\D/g, '');
    if (digits.length >= 3) {
      const aStarts = aDigits.startsWith(digits) || aDigits.endsWith(digits) ? 1 : 0;
      const bStarts = bDigits.startsWith(digits) || bDigits.endsWith(digits) ? 1 : 0;
      if (bStarts !== aStarts) return bStarts - aStarts;
    }
    return (b.orderCount || 0) - (a.orderCount || 0);
  });

  // Expose ONLY minimal POS-relevant customer fields (no email, raw orders, payment refs, or totalSpent)
  return filtered.slice(0, limit).map(c => ({
    name: (c.name && c.name !== 'Customer' && c.name !== 'Walk-in Guest') ? c.name : '',
    phone: String(c.phone || '').trim(),
    tier: c.tier || 'new',
    orderCount: Number(c.orderCount || 0),
    savedAddress: String(c.lastAddress || '').trim(),
    savedPlace: String(c.lastPlace || '').trim()
  }));
}

export function selectPosCustomerSuggestion(cust, options = {}) {
  if (!cust || typeof cust !== 'object') return false;
  const phoneInp = $('pos-customer-phone');
  const nameInp = $('pos-customer-name');
  const addrInp = $('pos-delivery-address');
  const hintEl = $('pos-cust-hint');
  const suggBox = $('pos-customer-suggestions');

  if (phoneInp && cust.phone) {
    phoneInp.value = cust.phone;
    phoneInp.classList.remove('pos-input-invalid');
  }

  // Populate customer name if empty, previously auto-filled, or explicitly selected from dropdown
  if (nameInp && cust.name) {
    const canFillName = options.fromClick !== false || !nameInp.value.trim() || nameInp.dataset.autoFilled === 'true';
    if (canFillName) {
      nameInp.value = cust.name;
      nameInp.dataset.autoFilled = 'true';
      nameInp.classList.remove('pos-input-invalid');
    }
  }

  // Populate saved delivery place and delivery address if available
  const savedPlaceName = String(cust.savedPlace || '').trim();
  const savedAddr = String(cust.savedAddress || '').trim();
  if (savedPlaceName && Array.isArray(adminPlaces) && adminPlaces.length > 0) {
    const matchedPlace = adminPlaces.find(p => p.name && p.name.toLowerCase() === savedPlaceName.toLowerCase());
    if (matchedPlace && (!posSelectedPlace || options.fromClick !== false)) {
      selectPosPlace(matchedPlace);
    }
  } else if (savedAddr && Array.isArray(adminPlaces) && adminPlaces.length > 0 && !posSelectedPlace) {
    const matchedFromAddr = adminPlaces.find(p => p.name && savedAddr.toLowerCase().includes(p.name.toLowerCase()));
    if (matchedFromAddr) {
      selectPosPlace(matchedFromAddr);
    }
  }

  if (addrInp && savedAddr) {
    const canFillAddr = options.fromClick !== false || !addrInp.value.trim() || addrInp.dataset.autoFilled === 'true';
    if (canFillAddr) {
      // Strip leading "Place - " prefix if place is already selected separately
      let cleanSpecificAddr = savedAddr;
      if (savedPlaceName && cleanSpecificAddr.toLowerCase().startsWith(`${savedPlaceName.toLowerCase()} - `)) {
        cleanSpecificAddr = cleanSpecificAddr.slice(savedPlaceName.length + 3).trim();
      }
      addrInp.value = cleanSpecificAddr;
      addrInp.dataset.autoFilled = 'true';
      addrInp.classList.remove('pos-input-invalid');
    }
  }

  if (hintEl) {
    const tierBadge = cust.tier === 'vip' ? '⭐ VIP' : (cust.tier === 'frequent' ? '🔁 Frequent' : '👤 Returning');
    hintEl.textContent = `${tierBadge}: ${cust.name || cust.phone}`;
  }

  if (suggBox) {
    suggBox.style.display = 'none';
  }
  return true;
}

function renderPosCustomerSuggestions(matches, queryStr = '') {
  const suggBox = $('pos-customer-suggestions');
  const hintEl = $('pos-cust-hint');
  if (!suggBox) return;

  const digits = String(queryStr || '').replace(/\D/g, '');
  if (!Array.isArray(matches) || matches.length === 0) {
    suggBox.style.display = 'none';
    suggBox.innerHTML = '';
    if (hintEl && digits.length >= 10) {
      hintEl.textContent = '✨ New Customer';
    }
    return;
  }

  suggBox.innerHTML = matches.map((c, idx) => {
    const tierLabel = c.tier === 'vip' ? 'VIP' : (c.tier === 'frequent' ? 'Frequent' : 'Guest');
    const addrPreview = c.savedAddress || c.savedPlace || '';
    return `
      <button type="button" class="pos-cust-sugg-item" role="option" data-cust-idx="${idx}">
        <div class="pos-cust-sugg-main">
          <div class="pos-cust-sugg-name-row">
            <span>${escapeHtml(c.name || 'Saved Customer')}</span>
            <span class="pos-cust-sugg-phone">· 📱 ${escapeHtml(c.phone)}</span>
          </div>
          ${addrPreview ? `<div class="pos-cust-sugg-addr">📍 ${escapeHtml(addrPreview)}</div>` : ''}
        </div>
        <span class="pos-cust-sugg-tier ${escapeHtml(c.tier || 'new')}">${escapeHtml(tierLabel)}</span>
      </button>
    `;
  }).join('');

  suggBox.style.display = 'block';

  suggBox.querySelectorAll('.pos-cust-sugg-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.custIdx, 10);
      const selected = matches[idx];
      if (selected) {
        selectPosCustomerSuggestion(selected, { fromClick: true });
      }
    });
  });
}

window.lookupPosCustomers = lookupPosCustomers;
window.selectPosCustomerSuggestion = selectPosCustomerSuggestion;

function getPosCartTotals() {
  const s = getBillSettings();
  const rawDiscount = parseFloat($('pos-discount-pct')?.value || '0');
  const discountPct = (isNaN(rawDiscount) || rawDiscount < 0) ? 0 : Math.min(100, rawDiscount);
  const rawDelFee = parseFloat($('pos-delivery-fee')?.value || '0');
  const deliveryFee = posOrderType === 'delivery' ? ((isNaN(rawDelFee) || rawDelFee < 0) ? 0 : rawDelFee) : 0;

  const cartSubtotal = posCart.reduce((sum, i) => sum + Number(i.price || 0) * Number(i.qty || 1), 0);
  let effectiveCoupon = null;
  if (posAppliedCoupon) {
    const check = validatePosCoupon(posAppliedCoupon, cartSubtotal, $('pos-customer-phone')?.value?.trim() || '', {
      allowRevalidateCurrent: true
    });
    if (check.valid) {
      effectiveCoupon = check.coupon;
    } else if (cartSubtotal > 0 && check.reason === 'MIN_BILL_NOT_MET') {
      showPosCouponFeedback(check.message, 'error');
    }
  }

  const billing = calculateOrderBilling({
    items: posCart,
    deliveryFee,
    discountPct,
    coupon: effectiveCoupon,
    cgstRate: s.cgstRate ?? 2.5,
    sgstRate: s.sgstRate ?? 2.5
  });

  return { 
    subtotal: billing.subtotal, 
    taxableSubtotal: billing.taxableSubtotal,
    discountPct: billing.discountPct, 
    discountAmt: billing.discountAmt, 
    appliedCoupon: effectiveCoupon,
    taxable: billing.taxableValue, 
    cgst: billing.cgstAmt, 
    sgst: billing.sgstAmt, 
    deliveryFee: billing.deliveryFee, 
    grand: billing.grandTotal, 
    roundOff: billing.roundOff,
    cgstRate: billing.cgstRate, 
    sgstRate: billing.sgstRate 
  };
}

function syncPosExtraBadges(totals) {
  const t = totals || getPosCartTotals();
  const manualDiscPct = parseFloat($('pos-discount-pct')?.value || '0') || 0;
  const discBtn = $('pos-extra-discount-btn');
  const discBadge = $('pos-extra-discount-badge');
  if (discBadge) {
    discBadge.textContent = (!t.appliedCoupon && t.discountPct > 0) ? `-${t.discountPct}%` : (manualDiscPct > 0 ? `-${manualDiscPct}%` : '0%');
  }
  if (discBtn) {
    discBtn.classList.toggle('has-value', !t.appliedCoupon && t.discountPct > 0);
  }

  const couponBtn = $('pos-extra-coupon-btn');
  const couponBadge = $('pos-extra-coupon-badge');
  if (couponBadge) {
    couponBadge.textContent = t.appliedCoupon ? t.appliedCoupon.code : (posAppliedCoupon ? `${posAppliedCoupon.code}!` : 'Add');
  }
  if (couponBtn) {
    couponBtn.classList.toggle('has-value', Boolean(t.appliedCoupon || posAppliedCoupon));
  }

  const rawDelFee = parseFloat($('pos-delivery-fee')?.value || '0');
  const safeDelFee = (isNaN(rawDelFee) || rawDelFee < 0) ? 0 : rawDelFee;
  const delBtn = $('pos-extra-delivery-btn');
  const delBadge = $('pos-extra-delivery-badge');
  if (delBadge) {
    delBadge.textContent = `₹${(posOrderType === 'delivery' ? t.deliveryFee : safeDelFee).toFixed(0)}`;
  }
  if (delBtn) {
    delBtn.classList.toggle('has-value', posOrderType === 'delivery' && t.deliveryFee > 0);
  }

  const notesVal = $('pos-notes')?.value?.trim() || '';
  const notesBtn = $('pos-extra-notes-btn');
  const notesBadge = $('pos-extra-notes-badge');
  if (notesBadge) {
    notesBadge.textContent = notesVal ? 'Added' : 'Add';
  }
  if (notesBtn) {
    notesBtn.classList.toggle('has-value', Boolean(notesVal));
    notesBtn.title = notesVal ? `Note: ${notesVal}` : 'Add kitchen or order instructions';
  }
}

function closeAllPosExtraPopovers() {
  ['discount', 'coupon', 'delivery', 'notes'].forEach(name => {
    const pop = $(`pos-popover-${name}`);
    const btn = $(`pos-extra-${name}-btn`);
    if (pop) {
      pop.classList.remove('open');
      pop.style.display = 'none';
    }
    if (btn) {
      btn.classList.remove('active');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

function togglePosExtraPopover(name) {
  const pop = $(`pos-popover-${name}`);
  const btn = $(`pos-extra-${name}-btn`);
  if (!pop) return;
  const isCurrentlyOpen = pop.classList.contains('open') || pop.style.display === 'flex';
  closeAllPosExtraPopovers();
  if (!isCurrentlyOpen) {
    if (name === 'delivery' && $('pos-delivery-fee-wrap')) {
      $('pos-delivery-fee-wrap').style.display = 'flex';
    }
    if (name === 'coupon') {
      renderPosCouponPicker();
    }
    pop.classList.add('open');
    pop.style.display = 'flex';
    if (btn) {
      btn.classList.add('active');
      btn.setAttribute('aria-expanded', 'true');
    }
    if (name === 'discount') setTimeout(() => $('pos-discount-pct')?.focus(), 40);
    if (name === 'coupon') setTimeout(() => $('pos-coupon-code-input')?.focus(), 40);
    if (name === 'delivery') setTimeout(() => $('pos-delivery-fee')?.focus(), 40);
    if (name === 'notes') setTimeout(() => $('pos-notes')?.focus(), 40);
  }
}

window.togglePosExtraPopover = togglePosExtraPopover;
window.closeAllPosExtraPopovers = closeAllPosExtraPopovers;

function updatePosCartUI(shouldUpdateGrid = false) {
  const cartEl = $('pos-cart-items');
  if (!cartEl) return;

  const allItems = (typeof getCombinedFoodItems === 'function') ? getCombinedFoodItems() : [];

  if (posCart.length === 0) {
    cartEl.innerHTML = '<p style="color:var(--adm-muted);font-size:.82rem;text-align:center;padding:1.25rem 0.75rem;">🛒 No items added yet</p>';
  } else {
    cartEl.innerHTML = posCart.map((item, idx) => {
      const foodItem = allItems.find(f => (item.id && f.id === item.id) || (f.name && f.name.toLowerCase() === item.name.toLowerCase())) || item;
      const isCombo = Boolean(item.isCombo || item.is_combo || foodItem.isCombo || foodItem.is_combo || String(item.id || '').startsWith('combo-'));
      const comboSummary = item.comboItemsSummary || foodItem.comboItemsSummary || '';
      const isVeg = (typeof isFoodVeg === 'function') ? isFoodVeg(foodItem) : true;
      const dotColor = isVeg ? '#16a34a' : '#dc2626';
      const uPrice = Number(item.price || 0);
      const uPriceStr = (uPrice % 1 === 0) ? uPrice.toFixed(0) : uPrice.toFixed(2);
      const lTotal = uPrice * Number(item.qty || 1);
      const lTotalStr = (lTotal % 1 === 0) ? lTotal.toFixed(0) : lTotal.toFixed(2);

      return `
        <div class="pos-cart-row ${isCombo ? 'is-combo-cart-row' : ''}" data-cart-idx="${idx}" data-is-combo="${isCombo}">
          <div style="display:flex;align-items:center;gap:.38rem;flex:1;min-width:0;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;" title="${isVeg ? 'Vegetarian' : 'Non-Vegetarian'}"></span>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:baseline;gap:4px;min-width:0;">
                ${isCombo ? '<span class="pos-cart-combo-tag">🍱 Combo</span>' : ''}
                <span class="pos-cart-item-name" style="font-size:.8rem;font-weight:700;color:#1e293b;line-height:1.18;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                <span class="pos-cart-item-unit" style="font-size:0.75rem;color:#64748b;font-weight:600;flex-shrink:0;">₹${uPriceStr}</span>
              </div>
              ${comboSummary ? `<div style="font-size:0.75rem;color:#64748b;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(comboSummary)}">Includes: ${escapeHtml(comboSummary)}</div>` : ''}
              ${item.notes ? `<div style="font-size:0.75rem;color:#b45309;font-weight:600;font-style:italic;margin-top:1px;background:#fef3c7;display:inline-block;padding:0 4px;border-radius:3px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">↳ ${escapeHtml(item.notes)}</div>` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:.28rem;flex-shrink:0;">
            <button type="button" class="pos-cart-edit-btn" onclick="posEditItem(${idx})" style="padding:1px 4px;border:1px solid #e2e8f0;border-radius:5px;background:#fff;cursor:pointer;color:#64748b;font-size:0.75rem;line-height:1.2;" title="Edit dish or kitchen note">✏️</button>
            <div class="pos-cart-qty-stepper" style="display:inline-flex;align-items:center;border:1px solid #e2e8f0;border-radius:7px;background:#f8fafc;padding:1px;">
              <button type="button" class="pos-cart-qty-minus" onclick="posChangeQty(${idx},-1)" aria-label="Decrease quantity" style="width:22px;height:22px;border:none;background:transparent;cursor:pointer;font-size:.84rem;display:flex;align-items:center;justify-content:center;font-weight:bold;color:#475569;">−</button>
              <span class="pos-cart-item-qty" style="min-width:18px;text-align:center;font-weight:800;font-size:.78rem;color:#1e293b;">${item.qty}</span>
              <button type="button" class="pos-cart-qty-plus" onclick="posChangeQty(${idx},1)" aria-label="Increase quantity" style="width:22px;height:22px;border:none;background:transparent;cursor:pointer;font-size:.84rem;display:flex;align-items:center;justify-content:center;font-weight:bold;color:#475569;">+</button>
            </div>
            <span class="pos-cart-item-total" style="min-width:48px;text-align:right;font-weight:800;font-size:.82rem;color:#1e293b;">₹${lTotalStr}</span>
            <button type="button" class="pos-cart-item-remove" onclick="posRemoveItem(${idx})" aria-label="Remove item" style="width:22px;height:22px;border:none;background:transparent;cursor:pointer;color:#94a3b8;font-size:.82rem;display:flex;align-items:center;justify-content:center;transition:color .15s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#94a3b8'" title="Remove">✕</button>
          </div>
        </div>
      `;
    }).join('');
  }

  const t = getPosCartTotals();
  if ($('pos-subtotal')) $('pos-subtotal').textContent = `₹${t.subtotal.toFixed(2)}`;
  if ($('pos-discount-pct-label')) $('pos-discount-pct-label').textContent = t.discountPct;
  if ($('pos-discount-show')) $('pos-discount-show').textContent = `-₹${t.discountAmt.toFixed(2)}`;
  if ($('pos-discount-calc-preview')) $('pos-discount-calc-preview').textContent = t.discountPct > 0 ? `-₹${t.discountAmt.toFixed(2)} (${t.discountPct}%)` : '-₹0.00';

  const couponRow = $('pos-coupon-row');
  if (couponRow) {
    if (t.appliedCoupon && t.discountAmt > 0) {
      couponRow.style.display = 'flex';
      if ($('pos-applied-coupon-code')) $('pos-applied-coupon-code').textContent = t.appliedCoupon.code;
      if ($('pos-applied-coupon-pct')) $('pos-applied-coupon-pct').textContent = t.appliedCoupon.discount_pct;
      if ($('pos-applied-coupon-amt')) $('pos-applied-coupon-amt').textContent = `-₹${t.discountAmt.toFixed(2)}`;
    } else {
      couponRow.style.display = 'none';
    }
  }
  
  const discRow = $('pos-discount-row');
  if (discRow) discRow.style.display = (!t.appliedCoupon && t.discountAmt > 0) ? 'flex' : 'none';

  const taxRow = $('pos-taxable-row');
  if (taxRow) {
    taxRow.style.display = t.discountAmt > 0 ? 'flex' : 'none';
    if ($('pos-taxable-amt')) $('pos-taxable-amt').textContent = `₹${t.taxable.toFixed(2)}`;
  }

  if ($('pos-cgst-rate-label')) $('pos-cgst-rate-label').textContent = t.cgstRate;
  if ($('pos-sgst-rate-label')) $('pos-sgst-rate-label').textContent = t.sgstRate;
  if ($('pos-cgst-amt')) $('pos-cgst-amt').textContent = `₹${t.cgst.toFixed(2)}`;
  if ($('pos-sgst-amt')) $('pos-sgst-amt').textContent = `₹${t.sgst.toFixed(2)}`;
  if ($('pos-gst-total-val')) $('pos-gst-total-val').textContent = (t.cgst + t.sgst).toFixed(2);
  
  const delFeeWrap = $('pos-delivery-fee-wrap');
  if (delFeeWrap) delFeeWrap.style.display = 'flex';
  const delRow = $('pos-delivery-charge-row');
  if (delRow) {
    delRow.style.display = (posOrderType === 'delivery' && t.deliveryFee > 0) ? 'flex' : 'none';
    if ($('pos-delivery-charge-show')) $('pos-delivery-charge-show').textContent = `₹${t.deliveryFee.toFixed(2)}`;
  }

  const roundOffRow = $('pos-round-off-row');
  if (roundOffRow) {
    roundOffRow.style.display = t.roundOff !== 0 ? 'flex' : 'none';
    if ($('pos-round-off-amt')) $('pos-round-off-amt').textContent = `${t.roundOff < 0 ? '-' : '+'}₹${Math.abs(t.roundOff).toFixed(2)}`;
  }

  if ($('pos-grand-total')) $('pos-grand-total').textContent = formatBillAmount(t.grand);

  // Sync compact popover badges for Discount, Delivery Fee, and Kitchen Notes
  syncPosExtraBadges(t);

  // Update item count badge & context badge
  const totalItemCount = posCart.reduce((sum, item) => sum + (item.qty || 1), 0);
  if ($('pos-cart-count-badge')) $('pos-cart-count-badge').textContent = `${totalItemCount} item${totalItemCount === 1 ? '' : 's'}`;
  updatePosTableBadge();

  // Re-render food grid to update in-cart badges only when explicitly requested
  if (shouldUpdateGrid) {
    renderFoodGrid($('pos-food-search')?.value);
  }
}

window.posChangeQty = function(idx, delta) {
  if (typeof idx !== 'number' || !posCart[idx]) return;
  const newQty = Number(posCart[idx].qty || 1) + Number(delta);
  if (newQty <= 0) {
    posCart.splice(idx, 1);
  } else {
    posCart[idx].qty = Math.max(1, Math.floor(newQty));
  }
  updatePosCartUI(true);
};
window.posRemoveItem = function(idx) {
  if (typeof idx !== 'number' || !posCart[idx]) return;
  posCart.splice(idx, 1);
  updatePosCartUI(true);
};

window.posEditItem = function(idx) {
  const item = posCart[idx];
  if (!item) return;

  const modal = $('adm-pos-edit-item-modal');
  if (!modal) return;
  closeOrderDetailDrawer();
  closeAllPosExtraPopovers();

  $('pos-edit-item-index').value = idx;
  $('pos-edit-item-name').value = item.name || '';
  $('pos-edit-item-price').value = item.price || 0;
  $('pos-edit-item-qty').value = item.qty || 1;
  $('pos-edit-item-notes').value = item.notes || '';

  modal.classList.add('open');
  modal.style.display = 'flex';
  setTimeout(() => $('pos-edit-item-notes')?.focus(), 100);
};

window.closePosEditItemModal = function() {
  const modal = $('adm-pos-edit-item-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }
};

window.posApplyNotePreset = function(presetText) {
  const noteEl = $('pos-edit-item-notes');
  if (!noteEl) return;
  const current = noteEl.value.trim();
  if (!current) {
    noteEl.value = presetText;
  } else if (!current.toLowerCase().includes(presetText.toLowerCase())) {
    noteEl.value = `${current}, ${presetText}`;
  }
  noteEl.focus();
};

function initPosEditModalListeners() {
  $('pos-edit-item-close-btn')?.addEventListener('click', closePosEditItemModal);
  $('pos-edit-item-cancel-btn')?.addEventListener('click', closePosEditItemModal);

  const modal = $('adm-pos-edit-item-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closePosEditItemModal();
    });
  }

  $('pos-edit-item-save-btn')?.addEventListener('click', () => {
    const idx = parseInt($('pos-edit-item-index')?.value, 10);
    if (isNaN(idx) || idx < 0 || idx >= posCart.length) {
      closePosEditItemModal();
      return;
    }

    const name = $('pos-edit-item-name')?.value?.trim();
    const price = parseFloat($('pos-edit-item-price')?.value);
    const qty = parseInt($('pos-edit-item-qty')?.value, 10);
    const notes = $('pos-edit-item-notes')?.value?.trim() || '';

    if (!name) {
      showAdminToast('Dish name cannot be empty.', 'error');
      $('pos-edit-item-name')?.focus();
      return;
    }
    if (isNaN(price) || price < 0) {
      showAdminToast('Please enter a valid price.', 'error');
      $('pos-edit-item-price')?.focus();
      return;
    }
    if (isNaN(qty) || qty < 1) {
      showAdminToast('Quantity must be at least 1.', 'error');
      $('pos-edit-item-qty')?.focus();
      return;
    }

    posCart[idx].name = name;
    posCart[idx].price = price;
    posCart[idx].qty = qty;
    posCart[idx].notes = notes;

    closePosEditItemModal();
    updatePosCartUI(true);
  });

  $('pos-edit-item-form')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      $('pos-edit-item-save-btn')?.click();
    }
  });
}

function loadFoodsCache() {
  allFoodsCache = menuItems;
  return menuItems;
}

function addItemToPosCart(food, customNote = '') {
  if (!food || typeof food !== 'object') return false;
  if (food.available === false) {
    showAdminToast(`"${food.name || 'Item'}" is currently unavailable.`, 'error');
    return false;
  }
  const isComboFlag = Boolean(food.isCombo || food.is_combo || food.category === 'combo' || String(food.id || '').startsWith('combo-'));
  if (isComboFlag && !isComboActiveAndValid(food)) {
    showAdminToast(`Combo "${food.name || 'Combo'}" is unavailable or expired.`, 'error');
    return false;
  }

  let resolvedCombo = null;
  if (isComboFlag && (!food.comboItemsSummary || !Array.isArray(food.comboItems))) {
    const rawComboId = food.combo_id ?? String(food.id || '').replace(/^combo-/, '');
    resolvedCombo = (adminCombos || []).find(c => String(c.id) === String(rawComboId));
  }
  const comboItems = Array.isArray(food.comboItems)
    ? food.comboItems
    : (Array.isArray(resolvedCombo?.items) ? resolvedCombo.items : []);
  const comboItemsSummary = food.comboItemsSummary
    || (comboItems.length > 0 ? comboItems.map(i => `${i.qty || 1}× ${i.name}`).join(' + ') : '');

  const note = (customNote || food.notes || '').trim();
  const addQty = Math.max(1, parseInt(food.qty, 10) || 1);
  const existing = posCart.find(i =>
    ((food.id && i.id === food.id) || i.name.toLowerCase() === food.name.toLowerCase()) &&
    (i.notes || '').trim() === note
  );
  if (existing) {
    existing.qty += addQty;
  } else {
    posCart.push({
      id: food.id || null,
      name: food.name,
      price: Number(food.price || 0),
      mrp: Number(food.mrp ?? resolvedCombo?.mrp ?? 0),
      qty: addQty,
      notes: note,
      isCombo: isComboFlag,
      combo_id: isComboFlag ? (food.combo_id ?? resolvedCombo?.id ?? null) : null,
      comboItems,
      comboItemsSummary,
      gst_applicable: food.gst_applicable !== false
    });
  }
  updatePosCartUI(true);
  const cartEl = $('pos-cart-items');
  if (cartEl) {
    setTimeout(() => { cartEl.scrollTop = cartEl.scrollHeight; }, 20);
  }
  return true;
}

// ── Strict Validation & Order Saving ───────────────────────────
async function buildOrderFromPos(action) {
  if (posCart.length === 0) {
    showAdminToast('Please add at least one food item to the cart.', 'error');
    return null;
  }

  // 1. Customer Name Validation & Friendly Fallback (Mandatory for Delivery, Optional for Table & Pickup)
  const nameInp = $('pos-customer-name');
  let name = nameInp?.value?.trim() || '';
  if (!name) {
    if (posOrderType === 'delivery') {
      nameInp?.classList.add('pos-input-invalid');
      nameInp?.focus();
      showAdminToast('Customer name is required for Delivery orders.', 'error');
      return null;
    } else if (posOrderType === 'table') {
      name = `Table ${$('pos-table-number')?.value?.trim() || 'Dine-in'}`;
    } else {
      name = 'Walk-in Guest';
    }
  } else {
    nameInp?.classList.remove('pos-input-invalid');
  }

  // 2. Mobile Number Validation & Friendly Fallback (Mandatory for Delivery, Optional for Table & Pickup)
  const phoneInp = $('pos-customer-phone');
  let phone = phoneInp?.value?.trim() || '';
  const digitsOnly = phone.replace(/[^0-9]/g, '');
  if (!phone || digitsOnly.length < 10) {
    if (posOrderType === 'delivery') {
      phoneInp?.classList.add('pos-input-invalid');
      phoneInp?.focus();
      showAdminToast('A valid 10-digit mobile number is mandatory for Delivery orders.', 'error');
      return null;
    } else {
      phone = phone || '9999999999';
    }
  } else {
    phoneInp?.classList.remove('pos-input-invalid');
  }

  // 3. Conditional Mandatory Table Number for Dine-in
  const tableInp = $('pos-table-number');
  const tableNum = tableInp?.value?.trim() || '';
  if (posOrderType === 'table' && !tableNum) {
    tableInp?.classList.add('pos-input-invalid');
    tableInp?.focus();
    showAdminToast('Dining Table Number is mandatory for Dine-in orders.', 'error');
    return null;
  } else if (tableInp) {
    tableInp.classList.remove('pos-input-invalid');
  }

  // 4. Conditional Mandatory Place / Address for Delivery
  const placeSearchInp = $('pos-place-search');
  const addressInp = $('pos-delivery-address');
  const selectedPlaceName = posSelectedPlace ? posSelectedPlace.name : (placeSearchInp?.value?.trim() || '');
  const specificAddr = addressInp?.value?.trim() || '';
  const fullDeliveryAddress = selectedPlaceName && specificAddr ? `${selectedPlaceName} - ${specificAddr}` : (selectedPlaceName || specificAddr);

  if (posOrderType === 'delivery' && !fullDeliveryAddress) {
    if (placeSearchInp) placeSearchInp.classList.add('pos-input-invalid');
    if (addressInp) addressInp.classList.add('pos-input-invalid');
    placeSearchInp?.focus();
    showAdminToast('Please search & select a delivery place or enter delivery address.', 'error');
    return null;
  } else {
    placeSearchInp?.classList.remove('pos-input-invalid');
    addressInp?.classList.remove('pos-input-invalid');
  }

  const payMode = $('pos-payment-mode')?.value || 'cash';
  const notes = $('pos-notes')?.value?.trim() || '';
  const t = getPosCartTotals();

  let notesStr = '';
  if (posOrderType === 'table') notesStr = `[TABLE: ${tableNum}]`;
  else if (posOrderType === 'delivery') notesStr = `[DELIVERY] Place: ${selectedPlaceName || 'N/A'} | Address: ${fullDeliveryAddress} | Delivery charge: ₹${t.deliveryFee.toFixed(2)} [DELIVERY_FEE: ${t.deliveryFee}]`;
  else notesStr = '[SELF PICKUP]';

  if (action === 'bill') {
    notesStr += ` [FINAL_BILL] [BILLED_UNPAID]`;
  }

  if (t.appliedCoupon && t.appliedCoupon.code) {
    notesStr += ` [COUPON: ${t.appliedCoupon.code}]`;
  }
  if (t.discountPct > 0) {
    notesStr += ` [DISCOUNT_PCT: ${t.discountPct}%] [DISCOUNT_AMT: ${t.discountAmt.toFixed(2)}]`;
  }
  notesStr += ` [PAYMENT: ${payMode}] [CGST: ${t.cgstRate}%] [SGST: ${t.sgstRate}%]`;
  if (notes) notesStr += ` ${notes}`;

  if (posEditingOrderId) {
    cashierCreatedOrderIds.add(String(posEditingOrderId));
    notifiedBusinessOrderIds.add(String(posEditingOrderId));
    const existingOrder = orders.find(o => String(o.id) === String(posEditingOrderId));
    if (existingOrder) {
      const updateData = {
        customer_name: name,
        customer_phone: phone,
        order_type: posOrderType,
        table_number: posOrderType === 'table' ? (parseInt(String(tableNum).replace(/\D/g, ''), 10) || null) : null,
        total_amount: t.grand,
        subtotal_amount: t.subtotal || 0,
        discount_pct: t.discountPct || 0,
        discount_amount: t.discountAmt || 0,
        taxable_amount: t.taxable || 0,
        cgst_amount: t.cgst || 0,
        sgst_amount: t.sgst || 0,
        delivery_fee: t.deliveryFee || 0,
        packaging_fee: 0,
        round_off_amount: t.roundOff || 0,
        payment_method: payMode,
        status: action === 'hold' ? 'hold' : (action === 'bill' ? 'confirmed' : (action === 'kot' ? 'pending' : 'confirmed')),
        payment_status: action === 'bill' ? 'unpaid' : (action === 'hold' || action === 'kot' ? 'unpaid' : (payMode === 'pay_later' ? 'unpaid' : (existingOrder.payment_status === 'paid' ? 'paid' : 'unpaid'))),
        ticket_status: action === 'hold' ? 'HOLD' : (action === 'bill' ? 'BILLED' : 'OPEN'),
        notes: notesStr,
        updated_at: new Date().toISOString()
      };

      let updatedOrder = null;
      let cloudUpdateFailed = false;
      try {
        let updateRes = await insforge.database
          .from('orders')
          .update(updateData)
          .eq('id', posEditingOrderId)
          .select()
          .single();
        if (updateRes.error && (updateRes.error.message || '').includes('ticket_status')) {
          const fallbackData = { ...updateData };
          delete fallbackData.ticket_status;
          updateRes = await insforge.database
            .from('orders')
            .update(fallbackData)
            .eq('id', posEditingOrderId)
            .select()
            .single();
        }
        if (updateRes.error) {
          throw updateRes.error;
        }
        if (updateRes.data) updatedOrder = updateRes.data;
      } catch (err) {
        console.warn('[POS Update] Cloud update warning (saved locally):', err);
        cloudUpdateFailed = true;
      }

      // Update in-memory order object immediately
      Object.assign(existingOrder, updatedOrder || updateData);

      const itemRows = posCart.map(i => ({
        order_id: posEditingOrderId,
        item_name: i.notes ? `${i.name} [Note: ${i.notes}]` : i.name,
        quantity: i.qty,
        unit_price: i.price,
        line_total: i.price * i.qty,
        menu_item_id: (i.id && !isNaN(Number(i.id)) && Number(i.id) < 9000) ? Number(i.id) : null,
      }));

      try {
        if (!cloudUpdateFailed) {
          await insforge.database.from('order_items').delete().eq('order_id', posEditingOrderId);
          const { data: insItems, error: insErr } = await insforge.database.from('order_items').insert(itemRows).select();
          if (insErr) throw insErr;
          orderItems = orderItems.filter(i => String(i.order_id) !== String(posEditingOrderId));
          if (insItems && insItems.length > 0) {
            orderItems.push(...insItems);
          } else {
            orderItems.push(...itemRows.map((r, idx) => ({ ...r, id: `temp-${Date.now()}-${idx}` })));
          }
        } else {
          throw new Error('Cloud update failed previously');
        }
      } catch (itemsErr) {
        console.warn('[POS Items Update] Cloud items update warning:', itemsErr);
        cloudUpdateFailed = true;
        orderItems = orderItems.filter(i => String(i.order_id) !== String(posEditingOrderId));
        orderItems.push(...itemRows.map((r, idx) => ({ ...r, id: `temp-${Date.now()}-${idx}` })));
      }

      if (cloudUpdateFailed) {
        try {
          const updateIdempotencyKey = `pos_update_${posEditingOrderId}_${Date.now()}`;
          offlineSync.enqueuePosOrderUpdate({
            orderId: posEditingOrderId,
            orderData: updateData,
            itemRows,
            idempotencyKey: updateIdempotencyKey
          });
          existingOrder._isOfflineQueued = true;
          showAdminToast('Order updated locally. Cloud sync queued.', 'warning');
        } catch (queueErr) {
          console.warn('[POS Update] Failed to enqueue POS order update:', queueErr);
        }
      }

      posEditingOrderId = null;

      // Refresh UI
      renderBillingQuickCards();
      renderBillingTotalBills();
      renderHoldOrdersPanel();
      renderOverview();
      renderOrdersTable();
      renderClosedOrdersPanel();
      renderTablesPanel();
      renderKitchenPanel();

      if (existingOrder.status === 'delivered' && isGoogleSheetAutoSyncEnabled()) {
        syncOrderToGoogleSheet(existingOrder).catch(e => console.warn('[Google Sheet] POS bill auto-sync error:', e));
      }

      return {
        order: existingOrder,
        items: posCart.map(i => ({
          item_name: i.name,
          name: i.name,
          quantity: i.qty,
          qty: i.qty,
          unit_price: i.price,
          price: i.price,
          line_total: i.price * i.qty,
          notes: i.notes || ''
        }))
      };
    }
  }

  const nextDailyNum = getTodayDailyOrderNumber();
  const orderData = {
    order_number: nextDailyNum,
    customer_name: name,
    customer_phone: phone,
    order_type: posOrderType,
    table_number: posOrderType === 'table' ? (parseInt(String(tableNum).replace(/\D/g, ''), 10) || null) : null,
    total_amount: t.grand,
    subtotal_amount: t.subtotal || 0,
    discount_pct: t.discountPct || 0,
    discount_amount: t.discountAmt || 0,
    taxable_amount: t.taxable || 0,
    cgst_amount: t.cgst || 0,
    sgst_amount: t.sgst || 0,
    delivery_fee: t.deliveryFee || 0,
    packaging_fee: 0,
    round_off_amount: t.roundOff || 0,
    payment_method: payMode,
    status: action === 'hold' ? 'hold' : (action === 'bill' ? 'confirmed' : (action === 'kot' ? 'pending' : 'confirmed')),
    payment_status: 'unpaid',
    ticket_status: action === 'hold' ? 'HOLD' : (action === 'bill' ? 'BILLED' : 'OPEN'),
    notes: notesStr,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  let newOrder = null;
  let insertedItems = null;
  let cloudInsertFailed = false;

  try {
    let insertRes = await insforge.database.from('orders').insert([orderData]).select().single();
    if (insertRes.error && (insertRes.error.message || '').includes('ticket_status')) {
      const fallbackData = { ...orderData };
      delete fallbackData.ticket_status;
      insertRes = await insforge.database.from('orders').insert([fallbackData]).select().single();
    }
    if (insertRes.error && (insertRes.error.code === '42703' || (insertRes.error.message || '').includes('does not exist'))) {
      console.warn('[POS Insert] Extended columns missing in DB (42703). Retrying with baseline schema payload.');
      const baselineData = {
        order_number: orderData.order_number,
        customer_name: orderData.customer_name,
        customer_phone: orderData.customer_phone,
        order_type: orderData.order_type,
        table_number: orderData.table_number,
        total_amount: orderData.total_amount,
        payment_method: orderData.payment_method,
        status: orderData.status,
        payment_status: orderData.payment_status,
        ticket_status: orderData.ticket_status,
        notes: orderData.notes,
        created_at: orderData.created_at,
        updated_at: orderData.updated_at
      };
      insertRes = await insforge.database.from('orders').insert([baselineData]).select().single();
    }
    if (insertRes.error) {
      throw insertRes.error;
    }
    if (insertRes.data) {
      newOrder = insertRes.data;
    }
  } catch (err) {
    console.error('[POS Insert Failure]', {
      operation: 'POS_ORDER_CREATE',
      table: 'orders',
      code: err?.code || 'UNKNOWN',
      message: err?.message || String(err),
      correlationId: `pos_${orderData.order_number}_${Date.now()}`
    });
    cloudInsertFailed = true;
  }

  if (!newOrder) {
    // Local-first fallback order creation
    const localId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `offline-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    newOrder = {
      ...orderData,
      id: localId,
      idempotency_key: `pos_create_${localId}`,
      _isOfflineQueued: true
    };
    cloudInsertFailed = true;
  }

  // Register internal cashier-created order to strictly suppress POS self-notifications
  cashierCreatedOrderIds.add(String(newOrder.id));
  notifiedBusinessOrderIds.add(String(newOrder.id));
  if (newOrder.order_number) {
    cashierCreatedOrderIds.add(String(newOrder.order_number));
    notifiedBusinessOrderIds.add(String(newOrder.order_number));
  }

  // Save food items to DB if online
  const itemRows = posCart.map(i => ({
    order_id: newOrder.id,
    item_name: i.notes ? `${i.name} [Note: ${i.notes}]` : i.name,
    quantity: i.qty,
    unit_price: i.price,
    line_total: i.price * i.qty,
    menu_item_id: (i.id && !isNaN(Number(i.id)) && Number(i.id) < 9000) ? Number(i.id) : null,
  }));

  if (!cloudInsertFailed) {
    try {
      const res = await insforge.database.from('order_items').insert(itemRows).select();
      if (res.error) throw res.error;
      if (res.data) insertedItems = res.data;
    } catch(err) {
      console.warn('[POS Items] Cloud items insert warning (saved locally):', err);
      cloudInsertFailed = true;
    }
  }

  if (cloudInsertFailed) {
    try {
      offlineSync.enqueuePosOrderCreate({
        orderData: newOrder,
        itemRows,
        idempotencyKey: newOrder.idempotency_key || `pos_create_${newOrder.id}`
      });
      showAdminToast(`⚠️ Offline Queue: Order #${newOrder.order_number} saved locally. Will sync to cloud once connected.`, 'warning');
    } catch (queueErr) {
      console.warn('[POS Insert] Failed to enqueue POS order create:', queueErr);
    }
  }

  orders.unshift(newOrder);
  if (insertedItems && insertedItems.length > 0) {
    orderItems.push(...insertedItems);
  } else {
    orderItems.push(...itemRows.map((r, idx) => ({ ...r, id: `temp-${Date.now()}-${idx}` })));
  }

  persistOrdersCache();

  // Record coupon redemption in memory & database if a coupon was applied
  if (t.appliedCoupon && t.appliedCoupon.code) {
    const redeemedCode = String(t.appliedCoupon.code).toUpperCase();
    const matchedCoupon = (adminCoupons || []).find(c => String(c.code || '').toUpperCase() === redeemedCode);
    if (matchedCoupon) {
      matchedCoupon.used_count = Number(matchedCoupon.used_count || 0) + 1;
    }
    redeemCoupon(redeemedCode, phone, newOrder.id).catch(e => {
      console.warn('[POS Coupon] Non-blocking coupon usage record warning:', e);
    });
  }

  // Refresh UI
  renderBillingQuickCards();
  renderBillingTotalBills();
  renderHoldOrdersPanel();
  renderOverview();
  renderOrdersTable();
  renderClosedOrdersPanel();
  renderTablesPanel();
  renderKitchenPanel();

  // Auto-sync billed / closed POS order to Google Sheets
  if (newOrder.status === 'delivered' && isGoogleSheetAutoSyncEnabled()) {
    syncOrderToGoogleSheet(newOrder).catch(e => console.warn('[Google Sheet] POS bill auto-sync error:', e));
  }

  return { 
    order: newOrder, 
    items: posCart.map(i => ({ 
      item_name: i.name, 
      name: i.name, 
      quantity: i.qty, 
      qty: i.qty, 
      unit_price: i.price, 
      price: i.price, 
      line_total: i.price * i.qty, 
      notes: i.notes || '' 
    })) 
  };
}

async function generateKOTHtml(order = {}, items = [], options = false) {
  if (!order) order = {};
  const isNewItemsOnly = Boolean(typeof options === 'boolean' ? options : options?.isNewOnly);
  const isReprint = Boolean(typeof options === 'object' && options?.isReprint);
  const roundNumber = Number((typeof options === 'object' && options?.roundNumber) || (isNewItemsOnly ? (order.current_round || 2) : 1));

  const p = printerSettings;
  const kotWidth = p.kot_paper_width || 80;
  const wPx = kotWidth === 'A4' ? 595 : Math.round(parseFloat(kotWidth || 80) * 2.835);
  const sideGapPx = Math.round((p.kot_side_gap ?? 2) * 2.835);
  const parsedMeta = parseNotesMetadata(order.notes, order);
  const tableInfo = parsedMeta.tableNumber || order.table_number || '';
  const formattedTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const fontSize = p.kot_font_size === 'xlarge' ? '16px' : (p.kot_font_size === 'medium' ? '12px' : '14px');
  const sep = getSeparatorLineHtml(p.kot_item_separator);

  const rawItemList = (items && items.length > 0) ? items : (order.id ? getItemsForOrder(order.id) : []);
  const displayItems = isNewItemsOnly ? rawItemList : consolidateOrderItems(rawItemList);
  const itemsHtml = displayItems.map(i => {
    const rawName = i.item_name || i.name;
    const parsed = parseItemNameAndNotes(rawName);
    const displayName = parsed.name || rawName;
    const itemNote = (i.notes || parsed.notes || '').trim();

    return `
      <div style="padding:3px 0;border-bottom:1px dashed #000;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <span style="font-weight:800;font-size:${fontSize};line-height:1.2;">${escapeHtml(displayName)}</span>
          <span style="font-weight:900;font-size:${fontSize};${p.kot_highlight_qty ? 'border:1px solid #000;padding:0 4px;' : ''}">x${i.quantity || i.qty}</span>
        </div>
        ${itemNote ? `<div style="font-size:10.5px;font-weight:900;color:#000;margin-top:2px;padding:1px 3px;border-left:3px solid #000;background:#eee;">↳ NOTE: ${escapeHtml(itemNote)}</div>` : (p.kot_show_item_notes && parsedMeta.notes ? `<div style="font-size:9.5px;font-style:italic;margin-top:2px;">↳ Note: ${escapeHtml(parsedMeta.notes)}</div>` : '')}
      </div>
    `;
  }).join('');

  const feedLines = Math.max(3, parseInt(p.kot_bottom_feed || 3, 10));
  const feedSpaces = '<br/>'.repeat(feedLines);

  return `<div style="width:100%;max-width:100%;font-family:monospace,sans-serif;font-size:11px;color:#000;padding:${sideGapPx ? `0 ${sideGapPx}px` : '0'};margin:0;line-height:1.3;box-sizing:border-box;">
    ${isReprint ? `
      <div style="background:#000;color:#fff;font-size:12px;font-weight:900;text-align:center;padding:3px;margin-bottom:4px;letter-spacing:1px;border-radius:2px;">
        *** REPRINT - DUPLICATE KOT ***<br/><span style="font-size:10px;font-weight:bold;">DO NOT RE-COOK</span>
      </div>
    ` : ''}
    <div style="text-align:center;border-bottom:2px solid #000;padding-bottom:4px;margin-bottom:6px;">
      <div style="font-size:14px;font-weight:900;letter-spacing:1px;">** KOT - KITCHEN ORDER **</div>
      <div style="font-size:10px;font-weight:bold;">${isNewItemsOnly ? `(ROUND #${roundNumber} - NEW ITEMS ONLY)` : 'TVS RP3200 PLUS ESC/POS'}</div>
    </div>
    ${(isNewItemsOnly || roundNumber > 1) ? `
      <div style="font-size:11px;font-weight:900;border:1px solid #000;padding:2px 4px;text-align:center;margin:3px 0;background:#eee;">
        &gt;&gt;&gt; ROUND #${roundNumber} (NEW ITEMS ONLY) &lt;&lt;&lt;
      </div>
    ` : ''}
    <div style="font-size:10px;line-height:1.3;margin-bottom:4px;">
      <div style="display:flex;justify-content:space-between;">
        <span><strong>Order #:</strong> ${formatDailyOrderNumber(order)}${roundNumber > 1 ? ` (R${roundNumber})` : ''}</span>
        ${p.kot_show_timestamp ? `<span><strong>Time:</strong> ${formattedTime}</span>` : ''}
      </div>
      ${p.kot_show_table && tableInfo ? `<div style="margin-top:2px;font-size:12px;font-weight:900;border:1px solid #000;padding:1px 3px;text-align:center;">🪑 TABLE: ${tableInfo}</div>` : ''}
      ${p.kot_show_order_type ? `<div><strong>Type:</strong> ${parsedMeta.type === 'table' ? (tableInfo ? `Table ${tableInfo}` : 'Dine-in') : (parsedMeta.type === 'delivery' ? 'DELIVERY' : 'PICKUP')}</div>` : ''}
      ${p.kot_show_customer ? `<div><strong>Customer:</strong> ${escapeHtml(order.customer_name || 'Walk-in')}</div>` : ''}
    </div>
    ${sep}
    <div>${itemsHtml}</div>
    ${sep}
    <div style="text-align:center;font-size:10px;font-weight:bold;margin-top:4px;">${isReprint ? '— REPRINT COPY (DO NOT RE-COOK) —' : '— KITCHEN COPY —'}</div>
    ${feedSpaces}
  </div>`;
}

// ── Admin Print Deduplication & Idempotency Store ──────────────
const ADMIN_PRINT_TOKENS_KEY = 'limra_admin_print_tokens';

function getAdminPrintedTokens() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(ADMIN_PRINT_TOKENS_KEY);
      if (raw) return new Set(JSON.parse(raw));
    }
  } catch (e) {}
  return new Set();
}

function saveAdminPrintedTokens(set) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const arr = Array.from(set).slice(-150);
      sessionStorage.setItem(ADMIN_PRINT_TOKENS_KEY, JSON.stringify(arr));
    }
  } catch (e) {}
}

const adminPrintedTokens = getAdminPrintedTokens();
const inFlightPrintJobs = new Set();

function hasAdminJobBeenPrinted(token) {
  return adminPrintedTokens.has(token);
}

function markAdminJobAsPrinted(token) {
  adminPrintedTokens.add(token);
  saveAdminPrintedTokens(adminPrintedTokens);
}

function clearAdminPrintedJobTokens() {
  adminPrintedTokens.clear();
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(ADMIN_PRINT_TOKENS_KEY);
    }
  } catch (e) {}
}

async function printKOT(order, itemsList, options = false) {
  if (!order || !order.id) {
    showAdminToast('No order found to print KOT.', 'error');
    return;
  }
  const kotOpts = typeof options === 'boolean'
    ? { isNewOnly: options, isReprint: false, roundNumber: options ? 2 : 1 }
    : { isNewOnly: Boolean(options?.isNewOnly), isReprint: Boolean(options?.isReprint), roundNumber: Number(options?.roundNumber || 1) };

  const dedupeKey = `kot:${order.id}:${kotOpts.roundNumber || 1}`;

  // If this is an automatic print (not manual reprint) and has already been printed or is currently in flight, skip to prevent duplicates
  if (!kotOpts.isReprint && (hasAdminJobBeenPrinted(dedupeKey) || inFlightPrintJobs.has(dedupeKey))) {
    console.log(`[Silent Print] KOT for order ${order.id} round ${kotOpts.roundNumber} already printed or in flight. Skipping duplicate.`);
    return { status: 'printed', alreadyPrinted: true, orderNumber: formatDailyOrderNumber(order) };
  }
  if (!kotOpts.isReprint) {
    inFlightPrintJobs.add(dedupeKey);
  }

  try {
    let items = itemsList;
    if (!items || items.length === 0) {
      items = getItemsForOrder(order.id);
    }
    if ((!items || items.length === 0) && order.id) {
      try {
        const { data: dbItems } = await insforge.database.from('order_items').select('*').eq('order_id', order.id);
        if (dbItems && dbItems.length > 0) {
          items = dbItems;
          orderItems.push(...dbItems);
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

    // Enqueue job into resilient queue with immediate execution
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
      markAdminJobAsPrinted(dedupeKey);
      const reprintTag = kotOpts.isReprint ? ' (Reprint)' : '';
      showAdminToast(`Printed ✓ KOT #${job.orderNumber}${reprintTag}`, 'success');
    } else {
      showAdminToast(`⚠️ Print failed for KOT #${job?.orderNumber || 'Order'} (Saved to Queue)`, 'error');
    }
    return job;
  } finally {
    if (!kotOpts.isReprint) {
      inFlightPrintJobs.delete(dedupeKey);
    }
  }
}

// In-memory cache for static Review QR code to save generation cycles
let _cachedReviewQrUrl = null;
let _cachedReviewQrDataUrl = null;
async function getCachedReviewQr(url) {
  if (!url) return '';
  if (_cachedReviewQrUrl === url && _cachedReviewQrDataUrl) {
    return _cachedReviewQrDataUrl;
  }
  _cachedReviewQrUrl = url;
  _cachedReviewQrDataUrl = await generateReviewQrDataUrl(url);
  return _cachedReviewQrDataUrl;
}

async function generateBillWithTaxHtml(order = {}, itemsList = [], options = {}) {
  if (!order) order = {};
  const isReprint = Boolean(options && options.isReprint);
  const showDuplicateBanner = Boolean(options && (options.showDuplicateBanner === true || (isReprint && options.showDuplicateBanner !== false)));
  const p = printerSettings;
  const fontSizeNum = parseFloat(p.bill_font_size ?? 11.5) || 11.5;
  const fontSizePx = `${fontSizeNum}px`;
  const headerFontSize = `${Math.max(13, fontSizeNum + 3.5)}px`;
  const subFontSize = `${Math.max(9.5, fontSizeNum - 1)}px`;
  const totalFontSize = `${Math.max(13, fontSizeNum + 2.5)}px`;

  const fontWeight = p.bill_font_weight || '800';
  const boldItems = p.bill_bold_items !== false;
  const boldHeaders = p.bill_bold_headers !== false;
  const boldTotals = p.bill_bold_totals !== false;
  const compactHeader = p.bill_compact_header === true;

  const density = p.bill_density || 'compact';
  const isUltraCompact = density === 'ultra-compact';
  const isCompact = density === 'compact' || isUltraCompact;
  const lineSpacing = isUltraCompact ? '1.15' : (isCompact ? '1.25' : '1.35');
  const rowPadding = isUltraCompact ? '1px 1px' : (isCompact ? '2px 1px' : '3px 2px');
  const sepMargin = isUltraCompact ? '2px 0' : (isCompact ? '3px 0' : '4px 0');

  // Exact full width calibration for TVS RP3200 Plus (80mm roll, 71.95mm physical thermal head = 576 dots = 272 CSS px @ 96 DPI)
  const paperWidthVal = p.bill_paper_width || 80;
  const isA4 = paperWidthVal === 'A4';
  const is58 = String(paperWidthVal) === '58';
  const wPx = isA4 ? 595 : (is58 ? 220 : 272);
  const sideGapPx = 2; // Precise 2px edge buffer to start directly at thermal printable boundary

  const parsedMeta = parseNotesMetadata(order.notes, order);
  const allItems = (itemsList && itemsList.length > 0) ? itemsList : (order.id ? getItemsForOrder(order.id) : []);
  
  // Strictly filter items to food & drinks only, then consolidate duplicate rounds
  const rawItems = (allItems || []).filter(i => i && !/delivery|discount|tax|fee/i.test(i.item_name || i.name || ''));
  const items = consolidateOrderItems(rawItems);
  const subtotal = items.reduce((sum, i) => sum + Number(i.line_total || (i.price * i.qty) || 0), 0);
  
  // Parse order type, discount, taxes, and delivery charges
  const orderTypeRaw = (order.order_type || parsedMeta.type || '').toLowerCase();
  const isDelivery = orderTypeRaw === 'delivery' || parsedMeta.type === 'delivery';
  const isPickup = orderTypeRaw === 'pickup' || orderTypeRaw === 'takeaway' || parsedMeta.type === 'pickup' || parsedMeta.type === 'takeaway';
  const deliveryFee = isDelivery ? Math.max(0, Number(order.delivery_fee ?? parsedMeta.deliveryFee ?? 0)) : 0;
  const discountPct = parsedMeta.discountPct || 0;
  const discountAmt = parsedMeta.discountAmt || 0;
  const cgstRate = parsedMeta.cgstRate ?? (p.cgst_rate || 2.5);
  const sgstRate = parsedMeta.sgstRate ?? (p.sgst_rate || 2.5);

  const billing = calculateOrderBilling({
    items,
    deliveryFee,
    discountPct,
    discountAmt,
    cgstRate,
    sgstRate
  });

  const taxableSubtotal = items.reduce((sum, i) => {
    if (i.gst_applicable === false || (typeof i.notes === 'string' && i.notes.includes('[NO_GST]'))) return sum;
    return sum + Number(i.line_total || (i.price * i.qty) || 0);
  }, 0);
  const taxable = billing.taxableAmount;
  const nonTaxableSubtotal = billing.nonTaxableAmount;
  const cgst = billing.cgstAmount;
  const sgst = billing.sgstAmount;
  const grandTotal = billing.grandTotal;
  
  const formattedDate = new Date(order.created_at || Date.now()).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true
  });
  const payMode = (order.payment_method || order.payment_mode || parsedMeta.payment || parsedMeta.paymentMode || 'cash').toUpperCase();
  const tableNum = parsedMeta.tableNumber || order.table_number || (typeof order.notes === 'string' ? order.notes.match(/Table\s*#?(\d+)/i)?.[1] : '') || '';
  
  let orderTypeLabel = 'DINE-IN';
  if (isDelivery) {
    orderTypeLabel = 'HOME DELIVERY';
  } else if (tableNum && p.bill_show_table !== false) {
    orderTypeLabel = `TABLE ${tableNum}`;
  } else if (isPickup) {
    orderTypeLabel = 'TAKEAWAY';
  } else {
    orderTypeLabel = 'DINE-IN';
  }
  const invoiceBadge = `${showDuplicateBanner ? 'DUPLICATE TAX INVOICE' : 'TAX INVOICE'} — ${orderTypeLabel}`;

  const itemRowsHtml = items.map(i => {
    const itemNote = (i.notes || (parsedMeta.itemsNotes && parsedMeta.itemsNotes[i.item_name || i.name]) || '').trim();
    return `
      <tr style="border-bottom:1px dashed #000;">
        <td style="padding:${rowPadding};font-size:${fontSizePx};font-weight:${boldItems ? '800' : '700'};line-height:1.2;color:#000;word-break:break-word;vertical-align:top;">
          ${escapeHtml(i.item_name || i.name)}
          ${itemNote ? `<div style="font-size:${subFontSize};font-style:italic;font-weight:700;color:#000;margin-top:1px;">↳ Note: ${escapeHtml(itemNote)}</div>` : ''}
        </td>
        <td style="padding:${rowPadding};font-size:${fontSizePx};text-align:center;font-weight:900;color:#000;vertical-align:top;">${i.quantity || i.qty}</td>
        <td style="padding:${rowPadding};font-size:${fontSizePx};text-align:right;padding-right:4px;font-weight:700;color:#000;vertical-align:top;font-variant-numeric:tabular-nums;">₹${Number(i.unit_price || i.price || 0).toFixed(0)}</td>
        <td style="padding:${rowPadding};font-size:${fontSizePx};text-align:right;font-weight:900;color:#000;vertical-align:top;font-variant-numeric:tabular-nums;">₹${Number(i.line_total || ((i.price || i.unit_price) * (i.qty || i.quantity)) || 0).toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  // Controlled bottom feed: 2-3 lines to prevent wasteful paper roll usage
  const feedLines = Math.max(2, parseInt(p.bill_bottom_feed || 2, 10));
  const feedSpaces = '<br/>'.repeat(Math.min(feedLines, 3));

  const qrSize = p.bill_qr_size || 'medium';
  const qrDimension = qrSize === 'small' ? '70px' : (qrSize === 'large' ? '96px' : '82px');
  const showQr = qrSize !== 'none' && Boolean(p.bill_upi_id);
  const qrDataUrl = showQr ? await generateUpiQrDataUrl(p.bill_upi_id, p.bill_upi_payee_name || p.restaurant_name, grandTotal, formatDailyOrderNumber(order)) : '';

  const showReviewQr = p.bill_show_review_qr !== false && Boolean(p.bill_review_url);
  const reviewQrDataUrl = showReviewQr ? await getCachedReviewQr(p.bill_review_url) : '';

  const showLogo = p.bill_show_logo !== false;
  const logoSrc = (p.bill_logo_url && !p.bill_logo_url.startsWith('/images/logo.png'))
    ? p.bill_logo_url
    : (LIMRA_LOGO_BASE64 || p.bill_logo_url || '/images/logo.png');

  return `
    <div style="width:${wPx}px;max-width:${wPx}px;font-family:'Courier New',Courier,monospace,sans-serif;font-size:${fontSizePx};font-weight:${fontWeight};color:#000;padding:0 ${sideGapPx}px;margin:0;box-sizing:border-box;line-height:${lineSpacing};-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;">
      <!-- RESTAURANT HEADER -->
      <div style="text-align:center;margin-bottom:3px;color:#000;">
        ${showDuplicateBanner ? `
          <div style="border:2px solid #000;background:#000;color:#fff;font-size:11px;font-weight:900;text-align:center;padding:2px 0;margin-bottom:4px;letter-spacing:1px;border-radius:2px;">
            *** DUPLICATE / REPRINT INVOICE ***<br/><span style="font-size:9px;font-weight:normal;color:#fff;">(ORIGINAL BILL ALREADY ISSUED)</span>
          </div>
        ` : ''}
        ${showLogo && logoSrc ? `
          <div style="margin-bottom:2px;text-align:center;">
            <img src="${logoSrc}" alt="Logo" style="max-height:38px;max-width:120px;margin:0 auto;display:block;filter:grayscale(100%) contrast(200%);image-rendering:-webkit-optimize-contrast;" />
          </div>
        ` : ''}
        <div style="font-size:${headerFontSize};font-weight:900;letter-spacing:0.5px;text-transform:uppercase;color:#000;">${escapeHtml(p.restaurant_name || 'LIMRA RESTAURANT')}</div>
        ${!compactHeader && p.restaurant_address ? `<div style="font-size:${subFontSize};font-weight:700;color:#000;margin-top:1px;">${escapeHtml(p.restaurant_address)}</div>` : ''}
        <div style="font-size:${subFontSize};font-weight:700;color:#000;margin-top:1px;">
          ${p.restaurant_phone ? `Tel: ${escapeHtml(p.restaurant_phone)} ` : ''}
          ${!compactHeader && p.restaurant_gstin ? `| GSTIN: ${escapeHtml(p.restaurant_gstin)} ` : ''}
          ${!compactHeader && p.restaurant_fssai ? `| FSSAI: ${escapeHtml(p.restaurant_fssai)}` : ''}
        </div>
        
        <!-- Table / Delivery Invoice Title -->
        <div style="font-size:${subFontSize};font-weight:900;border-top:1.5px solid #000;border-bottom:1.5px solid #000;padding:2px 0;margin-top:3px;letter-spacing:.3px;color:#000;">
          ${invoiceBadge}
        </div>
      </div>

      <!-- Place & Delivery Area Makeup Block -->
      ${p.bill_show_place && (isDelivery || parsedMeta.area || parsedMeta.address) ? `
        <div style="margin:2px 0;padding:2px 4px;border:1px solid #000;border-radius:2px;font-size:${subFontSize};font-weight:700;text-align:left;line-height:1.2;color:#000;">
          <div><strong>Area:</strong> ${escapeHtml(parsedMeta.area || 'Standard Area')}${parsedMeta.address ? ` · ${escapeHtml(parsedMeta.address)}` : ''}</div>
        </div>
      ` : ''}
      
      <!-- COMPACT ORDER METADATA -->
      <div style="font-size:${subFontSize};font-weight:700;line-height:1.3;margin-bottom:3px;border-bottom:1px dashed #000;padding-bottom:2px;color:#000;">
        <div style="display:flex;justify-content:space-between;">
          <span><strong>Bill #:</strong> ${formatDailyOrderNumber(order)}</span>
          <span><strong>Date:</strong> ${formattedDate}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span><strong>Cust:</strong> ${escapeHtml(order.customer_name || 'Walk-in')}</span>
          <span>${order.customer_phone ? `<strong>Phone:</strong> ${escapeHtml(order.customer_phone)}` : ''}</span>
        </div>
      </div>
      
      <!-- ITEMS TABLE: Exact Monospace Calibration for 272px Physical Viewport -->
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;border-bottom:1.5px solid #000;margin-bottom:3px;color:#000;">
        <thead>
          <tr style="border-top:1.5px solid #000;border-bottom:1.5px solid #000;">
            <th style="font-size:${subFontSize};font-weight:${boldHeaders ? '900' : '700'};padding:${rowPadding};text-align:left;width:136px;color:#000;vertical-align:top;">Item</th>
            <th style="font-size:${subFontSize};font-weight:${boldHeaders ? '900' : '700'};padding:${rowPadding};text-align:center;width:28px;color:#000;vertical-align:top;">Qty</th>
            <th style="font-size:${subFontSize};font-weight:${boldHeaders ? '900' : '700'};padding:${rowPadding};text-align:right;width:44px;padding-right:4px;color:#000;vertical-align:top;">Rate</th>
            <th style="font-size:${subFontSize};font-weight:${boldHeaders ? '900' : '700'};padding:${rowPadding};text-align:right;width:60px;color:#000;vertical-align:top;">Amt</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
      </table>
      
      <!-- COMPACT TOTALS & TAX BREAKDOWN -->
      <div style="font-size:${fontSizePx};line-height:${lineSpacing};color:#000;">
        <div style="display:flex;justify-content:space-between;font-weight:700;"><span>Subtotal:</span><span>₹${subtotal.toFixed(2)}</span></div>
        ${discountAmt > 0 ? `
          <div style="display:flex;justify-content:space-between;font-weight:700;"><span>Discount (${discountPct}%):</span><span>-₹${discountAmt.toFixed(2)}</span></div>
        ` : ''}
        ${taxableSubtotal < subtotal ? `
          <div style="display:flex;justify-content:space-between;font-weight:700;"><span>Taxable (5%):</span><span>₹${taxable.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:700;font-size:${subFontSize};"><span>GST Exempt (0%):</span><span>₹${nonTaxableSubtotal.toFixed(2)}</span></div>
        ` : (discountAmt > 0 ? `<div style="display:flex;justify-content:space-between;font-weight:700;"><span>Net Taxable:</span><span>₹${taxable.toFixed(2)}</span></div>` : '')}
        <div style="display:flex;justify-content:space-between;font-weight:700;"><span>CGST @${cgstRate}%:</span><span>₹${cgst.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;font-weight:700;"><span>SGST @${sgstRate}%:</span><span>₹${sgst.toFixed(2)}</span></div>
        ${deliveryFee > 0 ? `
          <div style="display:flex;justify-content:space-between;font-weight:700;"><span>Delivery Fee:</span><span>₹${deliveryFee.toFixed(2)}</span></div>
        ` : ''}
        ${billing.roundOff !== 0 ? `
          <div style="display:flex;justify-content:space-between;font-weight:700;color:#000;"><span>Round Off:</span><span>${billing.roundOff < 0 ? '-' : '+'}₹${Math.abs(billing.roundOff).toFixed(2)}</span></div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;font-weight:${boldTotals ? '900' : '800'};font-size:${totalFontSize};border-top:1.5px solid #000;border-bottom:1.5px solid #000;margin-top:2px;padding:3px 0;color:#000;">
          <span>GRAND TOTAL:</span><span>${formatBillAmount(grandTotal)}</span>
        </div>
      </div>
      
      <div style="border-bottom:1px dashed #000;margin-bottom:3px;padding-bottom:2px;font-size:${subFontSize};font-weight:800;display:flex;justify-content:space-between;color:#000;">
        <span><strong>Pay:</strong> ${payMode}</span>
        <span><strong>Status:</strong> ${(order.payment_status || 'unpaid').toUpperCase()}</span>
      </div>
      
      <!-- DYNAMIC UPI QR (Auto-Scaled or Hidden to save paper) -->
      ${showQr && qrDataUrl ? `
        <div style="margin-top:3px;padding-top:2px;text-align:center;color:#000;">
          <div style="font-size:${subFontSize};font-weight:900;letter-spacing:0.3px;">SCAN &amp; PAY VIA UPI</div>
          <img src="${qrDataUrl}" alt="UPI QR" style="width:${qrDimension};height:${qrDimension};margin:2px auto;display:block;image-rendering:pixelated;" />
          <div style="font-size:${subFontSize};font-weight:700;color:#000;margin-top:1px;">UPI: <strong>${escapeHtml(p.bill_upi_id)}</strong> (${formatBillAmount(grandTotal)})</div>
        </div>
      ` : ''}

      <!-- GOOGLE 5-STAR REVIEW QR -->
      ${showReviewQr && reviewQrDataUrl ? `
        <div style="margin-top:3px;padding-top:3px;border-top:1px dashed #000;text-align:center;color:#000;">
          <div style="font-size:${subFontSize};font-weight:900;letter-spacing:0.3px;">${escapeHtml(p.bill_review_heading || 'LOVE YOUR EXPERIENCE?')}</div>
          <div style="font-size:12px;letter-spacing:2px;margin:1px 0;color:#000;">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <img src="${reviewQrDataUrl}" alt="Google Review QR" style="width:${qrDimension};height:${qrDimension};margin:2px auto;display:block;image-rendering:pixelated;" />
          <div style="font-size:${subFontSize};font-weight:700;color:#000;margin-top:1px;">${escapeHtml(p.bill_review_subtext || 'Scan to leave us a Google Review')}</div>
        </div>
      ` : ''}
      
      <!-- COMPACT FOOTER -->
      <div style="text-align:center;border-top:1px dashed #000;padding-top:3px;margin-top:3px;font-size:${subFontSize};color:#000;">
        <div style="font-weight:900;">${escapeHtml(p.bill_footer_message || 'Thank You! Visit Again.')}</div>
        <div style="margin-top:1px;font-weight:700;">${escapeHtml(p.restaurant_name || 'LIMRA RESTAURANT')}</div>
      </div>
      ${feedSpaces}
    </div>
  `;
}

async function printOrderReceiptWithTax(order, itemsList, options = {}) {
  if (!order || !order.id) {
    showAdminToast('No order found to print Bill.', 'error');
    return;
  }
  const isReprint = Boolean(options && options.isReprint);
  const showDuplicateBanner = Boolean(options && (options.showDuplicateBanner === true || (isReprint && options.showDuplicateBanner !== false)));
  const forcePrint = Boolean(options && (options.force || isReprint));
  const isPaid = order.payment_status === 'paid' || order.ticket_status === 'CLOSED';
  const dedupeKey = isPaid ? `bill_paid:${order.id}` : `bill_unpaid:${order.id}`;

  // If this is an automatic print (not manual user click) and has already been printed or is currently in flight, skip to prevent duplicates
  if (!forcePrint && (hasAdminJobBeenPrinted(dedupeKey) || inFlightPrintJobs.has(dedupeKey))) {
    console.log(`[Silent Print] Bill for order ${order.id} (${isPaid ? 'PAID' : 'UNPAID'}) already printed or in flight. Skipping duplicate.`);
    return { status: 'printed', alreadyPrinted: true, orderNumber: formatDailyOrderNumber(order) };
  }
  if (!forcePrint) {
    inFlightPrintJobs.add(dedupeKey);
  }

  try {
    let items = itemsList;
    if (!items || items.length === 0) {
      items = getItemsForOrder(order.id);
    }
    if ((!items || items.length === 0) && order.id) {
      try {
        const { data: dbItems } = await insforge.database.from('order_items').select('*').eq('order_id', order.id);
        if (dbItems && dbItems.length > 0) {
          items = dbItems;
          orderItems.push(...dbItems);
        }
      } catch (e) {
        console.warn('Could not fetch items from DB for Bill:', e);
      }
    }

    const p = printerSettings;
    const html = await generateBillWithTaxHtml(order, items, options);
    let escposText = '';
    try {
      escposText = buildEscPosBill(order, items, p, options);
    } catch (e) {
      console.warn('[ESC/POS] Error building Bill command stream:', e);
    }

    // Enqueue job into resilient queue with immediate execution
    const job = await printQueue.enqueue({
      orderId: order.id,
      orderNumber: formatDailyOrderNumber(order),
      type: 'BILL',
      paperWidth: p.bill_paper_width || 80,
      isReprint: isReprint,
      payload: { html, escposText, order, items }
    });

    const isSuccess = job && (job.status === 'printed' || job.status === 'hardware_confirmed' || job.status === 'spooled');
    if (isSuccess) {
      markAdminJobAsPrinted(dedupeKey);
      const reprintTag = showDuplicateBanner ? ' (Reprint)' : '';
      showAdminToast(`Printed ✓ Bill #${job.orderNumber}${reprintTag}`, 'success');
    } else {
      showAdminToast(`⚠️ Print failed for Bill #${job?.orderNumber || 'Order'} (Saved to Queue)`, 'error');
    }
    return job;
  } finally {
    if (!forcePrint) {
      inFlightPrintJobs.delete(dedupeKey);
    }
  }
}

async function printCombinedKOTAndBill(order, itemsList, options = {}) {
  if (!order) {
    showAdminToast('No order found to print KOT & Bill.', 'error');
    return;
  }
  let items = itemsList;
  if (!items || items.length === 0) {
    items = getItemsForOrder(order.id);
  }
  if ((!items || items.length === 0) && order.id) {
    try {
      const { data: dbItems } = await insforge.database.from('order_items').select('*').eq('order_id', order.id);
      if (dbItems && dbItems.length > 0) {
        items = dbItems;
        orderItems.push(...dbItems);
      }
    } catch (e) {
      console.warn('Could not fetch items from DB for KOT+Bill:', e);
    }
  }

  try {
    // 1. First print Kitchen Order Ticket (KOT) as dedicated job.
    // The printer hardware driver triggers a clean auto-cut upon finishing KOT.
    await printKOT(order, items, options);

    // 2. Cooldown delay so printer physical blade cycle finishes and driver spooler clears
    await new Promise(r => setTimeout(r, 450));

    // 3. Next print Final Customer Bill as dedicated job with its own auto-cut.
    await printOrderReceiptWithTax(order, items, options);
  } catch (err) {
    console.error('[Combined KOT & Bill Print Error]:', err);
    showAdminToast('Print error: ' + (err.message || 'Printer issue'), 'error');
  }
}

// ════════════════════════════════════════════════════════
// THERMAL PRINT EXECUTOR & DISPATCH ENGINE (Phase 3)
// ════════════════════════════════════════════════════════

async function executePrintJob(job) {
  const p = printerSettings;
  const isKot = job.type === 'KOT';
  const paperWidth = job.paperWidth || (isKot ? (p.kot_paper_width || 80) : (p.bill_paper_width || 80));
  const sideGap = isKot ? (p.kot_side_gap ?? 2) : (p.bill_side_gap ?? 2);
  const printerName = isKot ? (p.kot_printer_name || p.active_printer_name) : (p.bill_printer_name || p.active_printer_name);

  // 1. Electron Desktop Native Hardware Printing (Isolated, Silent & Direct — Zero Dialog)
  if (typeof window !== 'undefined' && window.electronPOS?.isDesktop && typeof window.electronPOS.printReceipt === 'function') {
    try {
      const res = await window.electronPOS.printReceipt({
        html: job.payload?.html,
        escposText: job.payload?.escposText,
        printerName: printerName || 'RP3200 plus(U) 1',
        silent: p.silent_print !== false,
        paperWidth: paperWidth,
        sideGap: sideGap
      });
      if (res && res.success) {
        return { success: true, hardware_confirmed: Boolean(res.hardware_confirmed), deviceName: res.deviceName };
      }
      if (res && res.error) {
        throw new Error(res.error);
      }
    } catch (electronErr) {
      console.warn('[PrintQueue] Electron native print error, failing job for retry:', electronErr);
      throw electronErr;
    }
  }

  // 2. QZ Tray ESC/POS or Pixel Print (if configured)
  if (p.connection_mode === 'qz_tray' && typeof qz !== 'undefined' && qzConnected && activePrinter) {
    try {
      const config = qz.configs.create(activePrinter);
      if (job.payload?.escposText) {
        await qz.print(config, [{
          type: 'raw',
          format: 'plain',
          data: job.payload.escposText
        }]);
        return { success: true, hardware_confirmed: true };
      } else if (job.payload?.html) {
        await qz.print(config, [{
          type: 'pixel',
          format: 'html',
          flavor: 'plain',
          data: job.payload.html
        }]);
        return { success: true, hardware_confirmed: true };
      }
    } catch (qzErr) {
      console.warn('[PrintQueue] QZ Tray print error, falling back to Local Silent Spooler:', qzErr);
    }
  }

  // 2b. Local Thermal Print Bridge via WebSocket (Zero-preflight, bi-directional loopback on ws://127.0.0.1:3000)
  try {
    const wsResult = await printViaWebSocketBridge({
      html: job.payload?.html,
      escposText: job.payload?.escposText,
      printerName: printerName || 'RP3200 plus(U) 1',
      paperWidth: paperWidth,
      jobId: job.orderNumber || job.id
    }, 2500);

    if (wsResult && wsResult.success) {
      return {
        success: true,
        hardware_confirmed: Boolean(wsResult.hardware_confirmed),
        deviceName: wsResult.deviceName || printerName,
        method: 'websocket_bridge'
      };
    }
  } catch (wsErr) {
    console.warn('[PrintQueue] WebSocket bridge probe notice:', wsErr.message);
  }

  // 3. Local Backend Direct Silent Print (/api/print-silent) — Zero Dialog, Direct Windows Spooler
  const isLocalHost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const silentEndpoint = isLocalHost ? '/api/print-silent' : 'http://127.0.0.1:3000/api/print-silent';
  const probeTimeoutMs = 6000;
  try {
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const tid = controller ? setTimeout(() => controller.abort(), probeTimeoutMs) : null;
    const res = await fetch(silentEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller?.signal,
      body: JSON.stringify({
        html: job.payload?.html,
        escposText: job.payload?.escposText,
        printerName: printerName || 'RP3200 plus(U) 1',
        paperWidth: paperWidth,
        jobId: job.orderNumber || job.id
      })
    });
    if (tid) clearTimeout(tid);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        return {
          success: true,
          hardware_confirmed: Boolean(data.hardware_confirmed),
          deviceName: data.deviceName || printerName,
          method: 'http_pna_bridge'
        };
      }
    }
  } catch (apiErr) {
    console.warn('[PrintQueue] Local silent print endpoint notice:', apiErr?.message);
  }

  // 4. Clean Browser Thermal Print Fallback for Pure Web Sessions:
  // When running in a standard web browser on the live domain (https://www.limraresturent.in)
  // and NO desktop Electron app or local Node.js spooler is running on localhost:3000:
  // Render the exact 72mm monospace thermal invoice in an offscreen iframe and trigger print.
  // This ensures the customer bill ALWAYS prints on the TVS RP3200 Plus printer and NEVER fails!
  if (typeof window !== 'undefined' && job.payload?.html) {
    try {
      const printedViaIframe = await printReceiptViaBrowserIframe(job.payload.html);
      if (printedViaIframe) {
        return { success: true, browser_print: true, hardware_confirmed: false };
      }
    } catch (browserPrintErr) {
      console.warn('[PrintQueue] Browser iframe print fallback error:', browserPrintErr);
    }
  }

  // 5. Strict Fallback Warning
  throw new Error('Direct thermal printer bridge unavailable (Connect Electron POS Desktop or Local Server on localhost:3000)');
}

function printReceiptViaBrowserIframe(html) {
  return new Promise((resolve) => {
    try {
      if (typeof document === 'undefined') {
        resolve(false);
        return;
      }
      let iframe = document.getElementById('limra-thermal-print-frame');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'limra-thermal-print-frame';
        // Offscreen positioning instead of visibility:hidden or 0x0 size so Chromium print engine executes correctly
        iframe.setAttribute('style', 'position:fixed;top:-9999px;left:-9999px;width:300px;height:400px;border:none;opacity:0;pointer-events:none;');
        document.body.appendChild(iframe);
      }

      const frameDoc = iframe.contentWindow?.document || iframe.contentDocument;
      if (!frameDoc) {
        resolve(false);
        return;
      }

      frameDoc.open();
      frameDoc.write(html);
      frameDoc.close();

      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          resolve(true);
        } catch (e) {
          console.warn('[printReceiptViaBrowserIframe] Print trigger warning:', e);
          try {
            const printWindow = window.open('', '_blank', 'width=350,height=600');
            if (printWindow) {
              printWindow.document.write(html);
              printWindow.document.close();
              printWindow.focus();
              printWindow.print();
              setTimeout(() => { try { printWindow.close(); } catch(e){} }, 1000);
              resolve(true);
              return;
            }
          } catch (wErr) {
            console.warn('[printReceiptViaBrowserIframe] Popup fallback warning:', wErr);
          }
          resolve(false);
        }
      }, 350);
    } catch (err) {
      console.warn('[printReceiptViaBrowserIframe] Error:', err);
      resolve(false);
    }
  });
}

printQueue.setExecutor(executePrintJob);


// ════════════════════════════════════════════════════════
// HOLD ORDERS & TABLE SESSIONS VISUAL ITEM EDIT & ADD ENGINE
// ════════════════════════════════════════════════════════

let holdModalContext = {
  mode: 'order', // 'order' or 'table'
  orderId: null,
  tableNumber: null,
  activeTab: 'edit', // 'edit' or 'add'
  ordersInSession: [],
  existingItems: [], // [{ id, order_id, name, price, qty, originalQty, isCancelled, notes }]
  newItemsCart: [],  // [{ id, name, price, qty, notes }]
  activeCat: 'all'
};

async function openHoldEditModal(idOrTableNum, initialTab = 'edit') {
  closeOrderDetailDrawer();
  const tableSessions = getActiveTableSessions();
  const directOrder = orders.find(o => String(o.id) === String(idOrTableNum));
  let foundSession = null;

  if (directOrder) {
    const meta = parseNotesMetadata(directOrder.notes, directOrder);
    const tNum = parseInt(String(meta.tableNumber || directOrder.table_number || '').replace(/\D/g, ''), 10);
    if (tNum) {
      foundSession = tableSessions.find(s => s.tableNumber === tNum);
    }
  } else if (typeof idOrTableNum === 'number' || (!isNaN(parseInt(idOrTableNum, 10)) && tableSessions.some(s => s.tableNumber === parseInt(idOrTableNum, 10)))) {
    foundSession = tableSessions.find(s => s.tableNumber === parseInt(idOrTableNum, 10));
  }

  holdModalContext = {
    mode: foundSession ? 'table' : 'order',
    orderId: foundSession ? (foundSession.orders[0]?.id || null) : (directOrder ? directOrder.id : String(idOrTableNum)),
    tableNumber: foundSession ? foundSession.tableNumber : null,
    activeTab: initialTab || 'edit',
    ordersInSession: foundSession ? foundSession.orders : (directOrder ? [directOrder] : orders.filter(o => String(o.id) === String(idOrTableNum))),
    existingItems: [],
    newItemsCart: [],
    activeCat: 'all'
  };

  const primaryOrder = holdModalContext.ordersInSession[0];
  if (!primaryOrder && !foundSession) {
    showAdminToast('Could not find order/table session.', 'error');
    return;
  }

  // Load existing items from cache or fetch from DB if empty
  const sessionOrderIds = holdModalContext.ordersInSession.map(o => o.id);
  let rawItems = [];
  for (const ord of holdModalContext.ordersInSession) {
    const itms = getItemsForOrder(ord.id);
    if (itms && itms.length > 0) {
      rawItems.push(...itms);
    }
  }

  if (rawItems.length === 0 && sessionOrderIds.length > 0) {
    try {
      const { data: dbItems } = await insforge.database.from('order_items').select('*').in('order_id', sessionOrderIds);
      if (dbItems && dbItems.length > 0) {
        rawItems = dbItems;
        // Merge into orderItems memory cache
        for (const dbi of dbItems) {
          if (!orderItems.some(x => x.id === dbi.id)) orderItems.push(dbi);
        }
      }
    } catch(err) { console.warn('[Hold Modal] Error fetching items:', err); }
  }

  // Filter food items and map to editable existing items
  const cleanItems = (rawItems || []).filter(i => i && !/delivery|discount|tax|fee/i.test(i.item_name || i.name || ''));
  holdModalContext.existingItems = cleanItems.map(it => {
    const unitP = Number(it.unit_price ?? it.price ?? (it.quantity > 0 ? (it.line_total / it.quantity) : 0) ?? 0);
    const q = Number(it.quantity ?? it.qty ?? 1);
    return {
      id: it.id,
      order_id: it.order_id,
      name: it.item_name || it.name,
      price: unitP,
      qty: q,
      originalQty: q,
      isCancelled: false,
      notes: it.notes || ''
    };
  });

  // Update Modal Title & Subtitle
  const titleEl = $('hold-modal-title');
  const subEl = $('hold-modal-sub');
  const tNum = holdModalContext.tableNumber;
  const ordNo = primaryOrder ? formatDailyOrderNumber(primaryOrder) : '—';
  const custName = primaryOrder?.customer_name || 'Walk-in Guest';
  const custPhone = primaryOrder?.customer_phone || '';

  if (titleEl) {
    titleEl.innerHTML = `<span>🍽️ Manage &amp; Edit Dishes — ${tNum ? `Table ${tNum}` : `Order #${ordNo}`}</span>`;
  }
  if (subEl) {
    subEl.textContent = `Customer: ${custName} ${custPhone ? `(${custPhone})` : ''} · ${holdModalContext.existingItems.length} Dishes Currently Ordered`;
  }

  if ($('hold-modal-edit-search')) $('hold-modal-edit-search').value = '';
  if ($('hold-modal-search')) $('hold-modal-search').value = '';

  switchHoldModalTab(holdModalContext.activeTab);
  renderHoldModalExistingItems();
  renderHoldModalCategories();
  renderHoldModalFoodGrid();
  updateHoldModalCartUI();

  const modal = $('adm-hold-add-modal');
  if (modal) {
    modal.classList.add('open');
    modal.style.display = 'flex';
  }
}
window.openHoldEditModal = openHoldEditModal;
window.openHoldAddItemsModal = (orderId) => openHoldEditModal(orderId, 'add');

function closeHoldAddItemsModal() {
  const modal = $('adm-hold-add-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }
  holdModalContext = {
    mode: 'order',
    orderId: null,
    tableNumber: null,
    activeTab: 'edit',
    ordersInSession: [],
    existingItems: [],
    newItemsCart: [],
    activeCat: 'all'
  };
}
window.closeHoldAddItemsModal = closeHoldAddItemsModal;

function switchHoldModalTab(tab) {
  holdModalContext.activeTab = tab;
  const editView = $('hold-modal-view-edit');
  const addView = $('hold-modal-view-add');
  const editBtn = $('hold-modal-tab-btn-edit');
  const addBtn = $('hold-modal-tab-btn-add');

  if (tab === 'edit') {
    if (editView) editView.style.display = 'flex';
    if (addView) addView.style.display = 'none';
    if (editBtn) {
      editBtn.style.background = '#6366f1';
      editBtn.style.color = '#fff';
    }
    if (addBtn) {
      addBtn.style.background = 'transparent';
      addBtn.style.color = '#cbd5e1';
    }
  } else {
    if (editView) editView.style.display = 'none';
    if (addView) addView.style.display = 'flex';
    if (editBtn) {
      editBtn.style.background = 'transparent';
      editBtn.style.color = '#cbd5e1';
    }
    if (addBtn) {
      addBtn.style.background = '#6366f1';
      addBtn.style.color = '#fff';
    }
    holdModalContext.activeCat = 'all';
    if ($('hold-modal-search')) $('hold-modal-search').value = '';
    renderHoldModalCategories();
    renderHoldModalFoodGrid('');
  }
}

function renderHoldModalExistingItems(filterText) {
  const container = $('hold-modal-existing-items-list');
  const countBadge = $('hold-modal-edit-badge');
  const tab1Count = $('hold-modal-tab1-count');
  if (!container) return;

  const q = (filterText || '').toLowerCase().trim();
  const items = holdModalContext.existingItems;
  const activeCount = items.filter(i => !i.isCancelled).length;

  if (countBadge) countBadge.textContent = `${activeCount} Dishes Active`;
  if (tab1Count) tab1Count.textContent = activeCount;

  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:2rem;background:#fff;border:1px dashed var(--adm-border);border-radius:10px;color:var(--adm-muted);">
        <p style="margin:0 0 .5rem 0;font-weight:700;">No existing items found for this order.</p>
        <button type="button" class="adm-btn adm-btn-primary adm-btn-sm" onclick="switchHoldModalTab('add')">➕ Add New Dishes Now</button>
      </div>
    `;
    return;
  }

  const filtered = items.map((item, idx) => ({ ...item, originalIndex: idx })).filter(item => {
    if (!q) return true;
    return item.name.toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--adm-muted);font-size:.85rem;">No dishes match "${escapeHtml(q)}"</div>`;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const idx = item.originalIndex;
    const isCancelled = item.isCancelled;
    const isQtyModified = !isCancelled && item.qty !== item.originalQty;
    const lineTotal = isCancelled ? 0 : (item.price * item.qty);

    if (isCancelled) {
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .85rem;background:#fef2f2;border:1px dashed #f87171;border-radius:10px;gap:.5rem;">
          <div style="flex:1;">
            <div style="font-size:.88rem;font-weight:800;color:#991b1b;text-decoration:line-through;">
              ${escapeHtml(item.name)}
            </div>
            <div style="font-size:0.75rem;color:#dc2626;font-weight:700;margin-top:2px;">
              ❌ Marked for Kitchen Cancellation (${item.originalQty}× ₹${item.price.toFixed(0)})
            </div>
          </div>
          <button type="button" onclick="holdModalExistingToggleCancel(${idx})" class="adm-btn adm-btn-sm" style="background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;font-weight:800;font-size:.75rem;padding:.25rem .6rem;border-radius:6px;" title="Undo cancellation">
            ↩️ Restore Item
          </button>
        </div>
      `;
    }

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.65rem .85rem;background:#fff;border:1px solid var(--adm-border);border-radius:10px;gap:.5rem;box-shadow:0 1px 3px rgba(0,0,0,0.03);">
        <div style="flex:1;">
          <div style="font-size:.88rem;font-weight:800;color:#111827;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;">
            <span>${escapeHtml(item.name)}</span>
            ${isQtyModified ? `<span style="font-size:0.75rem;padding:1px 5px;border-radius:4px;background:#fef3c7;color:#b45309;font-weight:700;">was ${item.originalQty}</span>` : ''}
          </div>
          <div style="font-size:0.75rem;color:var(--adm-muted);margin-top:2px;">
            ₹${item.price.toFixed(2)} each · <strong style="color:#111827;">Line: ₹${lineTotal.toFixed(2)}</strong>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:.4rem;">
          <!-- Quantity Stepper -->
          <div style="display:flex;align-items:center;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;overflow:hidden;">
            <button type="button" onclick="holdModalExistingChangeQty(${idx}, -1)" style="width:28px;height:28px;border:none;background:transparent;cursor:pointer;font-weight:900;font-size:.9rem;display:flex;align-items:center;justify-content:center;color:#334155;" title="Decrease quantity">
              −
            </button>
            <span style="min-width:26px;text-align:center;font-weight:900;font-size:.85rem;color:#0f172a;">
              ${item.qty}
            </span>
            <button type="button" onclick="holdModalExistingChangeQty(${idx}, 1)" style="width:28px;height:28px;border:none;background:transparent;cursor:pointer;font-weight:900;font-size:.9rem;display:flex;align-items:center;justify-content:center;color:#334155;" title="Increase quantity">
              +
            </button>
          </div>

          <!-- Cancel Dish Button -->
          <button type="button" onclick="holdModalExistingToggleCancel(${idx})" class="adm-btn adm-btn-sm" style="background:#fff;border:1px solid #fca5a5;color:#dc2626;font-weight:700;font-size:0.75rem;padding:.3rem .55rem;border-radius:6px;" title="Cancel this dish from order">
            🗑️ Cancel
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.holdModalExistingChangeQty = function(idx, delta) {
  const item = holdModalContext.existingItems[idx];
  if (!item || item.isCancelled) return;
  const nextQty = item.qty + delta;
  if (nextQty <= 0) {
    if (confirm(`Cancel "${item.name}" completely from this order?`)) {
      item.isCancelled = true;
    }
  } else {
    item.qty = nextQty;
  }
  renderHoldModalExistingItems($('hold-modal-edit-search')?.value);
  updateHoldModalCartUI();
};

window.holdModalExistingToggleCancel = function(idx) {
  const item = holdModalContext.existingItems[idx];
  if (!item) return;
  item.isCancelled = !item.isCancelled;
  if (!item.isCancelled && item.qty <= 0) {
    item.qty = item.originalQty || 1;
  }
  renderHoldModalExistingItems($('hold-modal-edit-search')?.value);
  updateHoldModalCartUI();
};

function renderHoldModalCategories() {
  const pillBar = $('hold-modal-categories');
  if (!pillBar) return;
  const allItems = getCombinedFoodItems();
  const availableCats = new Set(allItems.map(f => f.category).filter(Boolean));
  const orderedCats = categoryTabOrder.filter(c => availableCats.has(c));
  const extraCats = Array.from(availableCats).filter(c => !categoryTabOrder.includes(c));
  const cats = ['all', ...orderedCats, ...extraCats];
  pillBar.innerHTML = cats.map(cat => {
    const lbl = cat === 'all' ? '🍽️ All Items' : ((categoryEmojis[cat] || '🍲') + ' ' + (categoryLabels[cat] || cat));
    const isAct = cat === holdModalContext.activeCat || (holdModalContext.activeCat !== 'all' && (categoryAliases[holdModalContext.activeCat] || []).includes(cat));
    const cls = isAct ? 'pos-cat-pill active' : 'pos-cat-pill';
    return `<button type="button" class="${cls}" data-cat="${cat}">${lbl}</button>`;
  }).join('');

  pillBar.querySelectorAll('.pos-cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      holdModalContext.activeCat = pill.dataset.cat;
      renderHoldModalCategories();
      renderHoldModalFoodGrid($('hold-modal-search')?.value);
    });
  });
}

function updateHoldModalFoodGridBadges() {
  const grid = $('hold-modal-food-grid');
  if (!grid) return;
  const newItems = holdModalContext.newItemsCart;
  grid.querySelectorAll('.hold-dish-card').forEach(card => {
    const id = card.dataset.id;
    const name = (card.dataset.name || '').toLowerCase();
    const cartItem = newItems.find(i => (id && String(i.id) === String(id)) || (i.name && i.name.toLowerCase() === name));
    const qty = cartItem ? cartItem.qty : 0;
    
    let badge = card.querySelector('.hold-dish-cart-badge');
    const addBtn = card.querySelector('.hold-dish-add-btn');
    if (qty > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'hold-dish-cart-badge';
        card.querySelector('.hold-dish-img-box')?.appendChild(badge);
      }
      badge.textContent = `${qty} in cart`;
      badge.style.display = 'inline-block';
      card.classList.add('in-cart');
      if (addBtn) {
        addBtn.textContent = `✓ ${qty} Added`;
        addBtn.style.background = '#4f46e5';
        addBtn.style.color = '#ffffff';
        addBtn.style.borderColor = '#4f46e5';
      }
    } else {
      if (badge) badge.remove();
      card.classList.remove('in-cart');
      if (addBtn) {
        addBtn.textContent = '+ Add';
        addBtn.style.background = '';
        addBtn.style.color = '';
        addBtn.style.borderColor = '';
      }
    }
  });
}

function renderHoldModalFoodGrid(filterText) {
  const grid = $('hold-modal-food-grid');
  if (!grid) return;
  const q = (filterText || '').toLowerCase().trim();
  const source = getCombinedFoodItems();
  const matchCats = categoryAliases[holdModalContext.activeCat] || [holdModalContext.activeCat];

  const filtered = source.filter(f => {
    const catLower = (f.category || '').toLowerCase();
    const activeLower = (holdModalContext.activeCat || '').toLowerCase();
    const matchesCat = (activeLower === 'all') ||
      matchCats.includes(f.category) ||
      matchCats.some(c => c && c.toLowerCase() === catLower) ||
      catLower === activeLower;

    const matchesQuery = !q ||
      (f.name && f.name.toLowerCase().includes(q)) ||
      (f.category && f.category.toLowerCase().includes(q)) ||
      (categoryLabels[f.category] && categoryLabels[f.category].toLowerCase().includes(q)) ||
      (f.description && f.description.toLowerCase().includes(q));

    return matchesCat && matchesQuery;
  });

  const countEl = $('hold-modal-items-count');
  if (countEl) countEl.textContent = `${filtered.length} Dishes`;

  if (!filtered.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--adm-muted);font-size:.85rem;padding:3rem 1rem;">No dishes found matching your search.</div>';
    return;
  }

  grid.innerHTML = filtered.map(f => {
    const imgUrl = f.image || categoryImages[f.category] || '/images/food_starters.png';
    const cartItem = holdModalContext.newItemsCart.find(i => (f.id && String(i.id) === String(f.id)) || (i.name && f.name && i.name.toLowerCase() === f.name.toLowerCase()));
    const cartQty = cartItem ? cartItem.qty : 0;
    const isVeg = isFoodVeg(f);
    const catLabel = categoryLabels[f.category] || f.category || '';
    const catEmoji = f.isCombo ? '🍱' : (categoryEmojis[f.category] || '🍽️');

    return `
      <div class="hold-dish-card ${cartQty > 0 ? 'in-cart' : ''}" data-id="${f.id}" data-name="${escapeHtml(f.name)}" data-price="${f.price}">
        <div class="hold-dish-img-box">
          <img src="${imgUrl}" alt="${escapeHtml(f.name)}" onerror="this.onerror=null;this.src='/images/food_starters.png';" />
          <span class="hold-dish-veg-badge pos-veg-badge ${isVeg ? 'veg' : 'nonveg'}" title="${isVeg ? 'Vegetarian' : 'Non-Vegetarian'}">
            <span class="pos-veg-dot"></span>
          </span>
          ${cartQty > 0 ? `<span class="hold-dish-cart-badge">${cartQty} in cart</span>` : ''}
        </div>
        <div class="hold-dish-body">
          <div class="hold-dish-category-tag">${catEmoji} ${escapeHtml(catLabel)}</div>
          <div class="hold-dish-title" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
          <div class="hold-dish-footer">
            <span class="hold-dish-price">₹${Number(f.price).toFixed(0)}</span>
            <button type="button" class="hold-dish-add-btn" title="Add ${escapeHtml(f.name)}" style="${cartQty > 0 ? 'background:#4f46e5;color:#ffffff;border-color:#4f46e5;' : ''}">${cartQty > 0 ? `✓ ${cartQty} Added` : '+ Add'}</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.hold-dish-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const name = card.dataset.name;
      const price = parseFloat(card.dataset.price);
      const existing = holdModalContext.newItemsCart.find(i => (id && String(i.id) === String(id)) || (i.name && name && i.name.toLowerCase() === name.toLowerCase()));
      if (existing) {
        existing.qty++;
      } else {
        holdModalContext.newItemsCart.push({ id: id || null, name, price, qty: 1 });
      }
      updateHoldModalCartUI();
    });
  });
}

function updateHoldModalCartUI() {
  const cartEl = $('hold-modal-cart-items');
  const newBadge = $('hold-modal-new-badge');
  const cancSummary = $('hold-modal-cancellations-summary');
  const cancList = $('hold-modal-cancellations-list');
  const rowCancelled = $('hold-modal-row-cancelled');
  const rowAdded = $('hold-modal-row-added');

  const newItems = holdModalContext.newItemsCart;
  const existing = holdModalContext.existingItems;

  if (newBadge) newBadge.textContent = newItems.reduce((s, i) => s + i.qty, 0);

  if (cartEl) {
    if (newItems.length === 0) {
      cartEl.innerHTML = '<p style="color:var(--adm-muted);font-size:.8rem;text-align:center;padding:1rem 0;">No extra dishes added yet.<br/><span style="font-size:0.75rem;">Switch to "Add New Dishes" tab to pick items.</span></p>';
    } else {
      cartEl.innerHTML = newItems.map((item, idx) => `
        <div style="display:flex;align-items:center;gap:.4rem;padding:.35rem 0;border-bottom:1px solid var(--adm-border);">
          <div style="flex:1;">
            <div style="font-size:.82rem;font-weight:700;color:#111827;line-height:1.2;">${escapeHtml(item.name)}</div>
            <div style="font-size:0.75rem;color:var(--adm-muted);margin-top:1px;">₹${item.price.toFixed(2)} each</div>
          </div>
          <div style="display:flex;align-items:center;gap:.2rem;">
            <button type="button" onclick="holdModalNewChangeQty(${idx},-1)" style="width:22px;height:22px;border:1px solid var(--adm-border);border-radius:4px;background:#f9fafb;cursor:pointer;font-size:.8rem;display:flex;align-items:center;justify-content:center;font-weight:bold;">−</button>
            <span style="min-width:18px;text-align:center;font-weight:800;font-size:.82rem;">${item.qty}</span>
            <button type="button" onclick="holdModalNewChangeQty(${idx},1)" style="width:22px;height:22px;border:1px solid var(--adm-border);border-radius:4px;background:#f9fafb;cursor:pointer;font-size:.8rem;display:flex;align-items:center;justify-content:center;font-weight:bold;">+</button>
            <button type="button" onclick="holdModalNewRemoveItem(${idx})" style="width:22px;height:22px;border:1px solid #fca5a5;border-radius:4px;background:#fef2f2;cursor:pointer;color:#ef4444;font-size:.75rem;display:flex;align-items:center;justify-content:center;" title="Remove">✕</button>
          </div>
          <span style="min-width:48px;text-align:right;font-weight:800;font-size:.82rem;color:#111827;">₹${(item.price*item.qty).toFixed(2)}</span>
        </div>
      `).join('');
    }
  }

  // Calculate numbers
  const origSubtotal = existing.reduce((s, i) => s + (i.price * i.originalQty), 0);
  const activeExistingSubtotal = existing.filter(i => !i.isCancelled).reduce((s, i) => s + (i.price * i.qty), 0);
  const cancelledDeductions = origSubtotal - activeExistingSubtotal;
  const addedSubtotal = newItems.reduce((s, i) => s + (i.price * i.qty), 0);
  const netSubtotal = activeExistingSubtotal + addedSubtotal;

  const s = getBillSettings();
  const tax = netSubtotal * (s.cgstRate + s.sgstRate) / 100;
  const grandTotal = Math.floor(netSubtotal + tax);

  if ($('hold-modal-orig-subtotal')) $('hold-modal-orig-subtotal').textContent = `₹${origSubtotal.toFixed(2)}`;
  if ($('hold-modal-tax-amt')) $('hold-modal-tax-amt').textContent = `₹${tax.toFixed(2)}`;
  if ($('hold-modal-updated-total')) $('hold-modal-updated-total').textContent = formatBillAmount(grandTotal);

  if (rowCancelled) {
    rowCancelled.style.display = cancelledDeductions > 0 ? 'flex' : 'none';
    if ($('hold-modal-cancelled-amt')) $('hold-modal-cancelled-amt').textContent = `-₹${cancelledDeductions.toFixed(2)}`;
  }
  if (rowAdded) {
    rowAdded.style.display = addedSubtotal > 0 ? 'flex' : 'none';
    if ($('hold-modal-new-subtotal')) $('hold-modal-new-subtotal').textContent = `+₹${addedSubtotal.toFixed(2)}`;
  }

  const cancelledItems = existing.filter(i => i.isCancelled);
  if (cancSummary && cancList) {
    if (cancelledItems.length > 0) {
      cancSummary.style.display = 'block';
      cancList.innerHTML = cancelledItems.map(i => `<div>• ${escapeHtml(i.name)} (${i.originalQty}×)</div>`).join('');
    } else {
      cancSummary.style.display = 'none';
    }
  }

  updateHoldModalFoodGridBadges();
}

window.holdModalNewChangeQty = function(idx, delta) {
  holdModalContext.newItemsCart[idx].qty = Math.max(1, holdModalContext.newItemsCart[idx].qty + delta);
  updateHoldModalCartUI();
};
window.holdModalNewRemoveItem = function(idx) {
  holdModalContext.newItemsCart.splice(idx, 1);
  updateHoldModalCartUI();
};

function generateKitchenCancellationSlipHtml(order, cancelledItems = [], modifiedItems = [], tableNum = '') {
  const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const p = printerSettings;
  const wPx = p.kot_paper_width === 'A4' ? 595 : Math.round(parseFloat(p.kot_paper_width || 80) * 2.835);
  const sideGapPx = Math.round((p.kot_side_gap ?? 2) * 2.835);

  const cancelledRowsHtml = cancelledItems.map(i => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1.5px dashed #000;font-size:13px;font-weight:900;color:#000;">
      <span>❌ CANCEL: ${escapeHtml(i.name)}</span>
      <span style="background:#000;color:#fff;padding:1px 6px;border-radius:3px;font-size:14px;">-${i.originalQty || i.qty}</span>
    </div>
  `).join('');

  const modifiedRowsHtml = modifiedItems.map(i => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px dashed #000;font-size:12px;font-weight:800;color:#000;">
      <span>⚠️ QTY CHANGED: ${escapeHtml(i.name)}</span>
      <span>${i.originalQty} ➔ ${i.qty}</span>
    </div>
  `).join('');

  return `
    <div style="width:100%;max-width:100%;font-family:'Courier New',Courier,monospace;font-size:12px;font-weight:800;color:#000;padding:0;margin:0;line-height:1.3;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div style="text-align:center;padding-bottom:4px;border-bottom:2px solid #000;">
        <div style="font-size:15px;font-weight:900;letter-spacing:1px;background:#000;color:#fff;padding:2px 4px;">*** KITCHEN CANCELLATION ***</div>
        <div style="font-size:11px;font-weight:900;margin-top:2px;">DO NOT PREPARE CANCELLED ITEMS</div>
      </div>
      
      <div style="font-size:12px;font-weight:900;padding:4px 0;border-bottom:1.5px solid #000;">
        <div style="display:flex;justify-content:space-between;">
          <span><strong>Order #:</strong> ${formatDailyOrderNumber(order)}</span>
          <span><strong>Time:</strong> ${timeStr}</span>
        </div>
        ${tableNum ? `<div style="font-size:14px;font-weight:900;border:1.5px solid #000;padding:2px 4px;margin-top:3px;text-align:center;">🪑 TABLE: ${tableNum}</div>` : ''}
      </div>

      <div style="padding:4px 0;">
        ${cancelledRowsHtml}
        ${modifiedRowsHtml}
      </div>

      <div style="text-align:center;border-top:2px solid #000;margin-top:6px;padding-top:4px;font-size:11px;font-weight:900;">
        — CHEF / KITCHEN ALERT —
      </div>
      <br/><br/>
      <div style="border-top:1px dashed #000;text-align:center;font-size:9px;color:#000;font-weight:700;">✂ - - - - Tear Here - - - - ✂</div>
    </div>
  `;
}

async function saveHoldOrderCorrections(shouldPrintKitchenSlip = false) {
  const { mode, tableNumber, ordersInSession, existingItems, newItemsCart } = holdModalContext;
  if (!ordersInSession.length) return;

  const cancelledItems = existingItems.filter(i => i.isCancelled);
  const modifiedItems = existingItems.filter(i => !i.isCancelled && i.qty !== i.originalQty);
  const activeExistingItems = existingItems.filter(i => !i.isCancelled);
  const newItems = [...newItemsCart];

  if (activeExistingItems.length === 0 && newItems.length === 0) {
    if (ordersInSession.some(ord => isOrderPaidOrClosed(ord))) {
      showAdminToast('Cannot cancel order: one or more orders are already paid or closed.', 'error');
      return;
    }
    if (!confirm('All items in this order are cancelled. Do you want to cancel the entire order / table session?')) {
      return;
    }
    // Cancel the orders in this session
    try {
      for (const ord of ordersInSession) {
        await cancelOrderRecord(ord);
        await markOrderNotificationsRead(ord.id);
      }
      persistOrdersCache();
      showAdminToast('All orders cancelled. ✅', 'success');
      closeHoldAddItemsModal();
      renderOverview();
      renderHoldOrdersPanel();
      renderOrdersTable();
      renderClosedOrdersPanel();
      renderBillingQuickCards();
      renderBillingTotalBills();
      return;
    } catch(err) {
      showAdminToast('Failed to cancel order: ' + err.message, 'error');
      return;
    }
  }

  const primaryOrder = ordersInSession[0];

  try {
    // 1. Delete cancelled items from DB & local cache
    for (const item of cancelledItems) {
      if (item.id && !String(item.id).startsWith('temp-')) {
        await insforge.database.from('order_items').delete().eq('id', item.id);
      }
      const memIdx = orderItems.findIndex(x => String(x.id) === String(item.id));
      if (memIdx !== -1) orderItems.splice(memIdx, 1);
    }

    // 2. Update modified items in DB & local cache
    for (const item of modifiedItems) {
      if (item.id && !String(item.id).startsWith('temp-')) {
        await insforge.database.from('order_items').update({
          quantity: item.qty,
          line_total: item.price * item.qty
        }).eq('id', item.id);
      }
      const memItem = orderItems.find(x => String(x.id) === String(item.id));
      if (memItem) {
        memItem.quantity = item.qty;
        memItem.line_total = item.price * item.qty;
      }
    }

    // 3. Insert newly added items to primaryOrder
    if (newItems.length > 0) {
      const rows = newItems.map(i => ({
        order_id: primaryOrder.id,
        item_name: i.name,
        quantity: i.qty,
        unit_price: i.price,
        line_total: i.price * i.qty,
        menu_item_id: (i.id && !isNaN(Number(i.id)) && Number(i.id) < 9000) ? Number(i.id) : null
      }));
      const { data: inserted, error: insErr } = await insforge.database.from('order_items').insert(rows).select();
      if (insErr) throw insErr;
      if (inserted && inserted.length > 0) {
        orderItems.push(...inserted);
      } else {
        orderItems.push(...rows.map((r, idx) => ({ ...r, id: `temp-hold-${Date.now()}-${idx}` })));
      }
    }

    // 4. Recalculate order totals for each order in session
    const s = getBillSettings();
    for (const ord of ordersInSession) {
      const curOrdItems = orderItems.filter(i => String(i.order_id) === String(ord.id) && isFoodDishItem(i));
      const parsed = parseNotesMetadata(ord.notes, ord);
      const billingMeta = parseNotesBillingMetadata(ord.notes);
      const isDelivery = parsed.type === 'delivery' || ord.order_type === 'delivery';
      const deliveryFee = isDelivery
        ? Math.max(0, Number(ord.delivery_fee ?? billingMeta.deliveryFee ?? parsed.deliveryFee ?? 0))
        : 0;

      const billing = calculateOrderBilling({
        items: curOrdItems,
        deliveryFee,
        discountPct: billingMeta.discountPct || parsed.discountPct || 0,
        discountAmt: billingMeta.discountAmt || parsed.discountAmt || 0,
        cgstRate: billingMeta.cgstRate ?? parsed.cgstRate ?? (s.cgstRate ?? 2.5),
        sgstRate: billingMeta.sgstRate ?? parsed.sgstRate ?? (s.sgstRate ?? 2.5)
      });

      let newTotal = billing.grandTotal;
      if (newTotal <= 0 && curOrdItems.length === 0 && Number(ord.total_amount || 0) > 0) {
        newTotal = Number(ord.total_amount);
      }

      await insforge.database.from('orders').update({ total_amount: newTotal }).eq('id', ord.id);
      ord.total_amount = newTotal;
    }

    persistOrdersCache();

    // 5. Kitchen Print handling if requested
    if (shouldPrintKitchenSlip) {
      if (cancelledItems.length > 0 || modifiedItems.length > 0) {
        const cancelHtml = generateKitchenCancellationSlipHtml(primaryOrder, cancelledItems, modifiedItems, tableNumber);
        await printViaNativeDriver(cancelHtml, printerSettings.kot_paper_width || 80, printerSettings.kot_side_gap ?? 2);
      }
      if (newItems.length > 0) {
        await printKOT(primaryOrder, newItems, true);
      }
    }

    showAdminToast('Hold order & items updated successfully! ✅', 'success');
    closeHoldAddItemsModal();
    renderOverview();
    renderHoldOrdersPanel();
    renderOrdersTable();
    renderClosedOrdersPanel();
    renderBillingQuickCards();
    renderBillingTotalBills();
  } catch(err) {
    console.error('[Hold Modal Save Error]', err);
    showAdminToast('Failed to save changes: ' + err.message, 'error');
  }
}

function initHoldModalListeners() {
  const modal = $('adm-hold-add-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeHoldAddItemsModal();
    });
  }

  $('hold-modal-close-btn')?.addEventListener('click', closeHoldAddItemsModal);
  $('hold-modal-discard-btn')?.addEventListener('click', closeHoldAddItemsModal);

  // Tab Switchers
  $('hold-modal-tab-btn-edit')?.addEventListener('click', () => switchHoldModalTab('edit'));
  $('hold-modal-tab-btn-add')?.addEventListener('click', () => switchHoldModalTab('add'));

  $('hold-modal-clear-cart-btn')?.addEventListener('click', () => {
    if (!holdModalContext.newItemsCart.length) return;
    holdModalContext.newItemsCart = [];
    updateHoldModalCartUI();
  });

  $('hold-modal-edit-search')?.addEventListener('input', function() {
    renderHoldModalExistingItems(this.value);
  });

  $('hold-modal-search')?.addEventListener('input', function() {
    renderHoldModalFoodGrid(this.value);
  });

  // Save changes without kitchen slip
  $('hold-modal-save-btn')?.addEventListener('click', () => {
    saveHoldOrderCorrections(false);
  });

  // Save and print kitchen slip (KOT / Cancellation Slip)
  $('hold-modal-kot-btn')?.addEventListener('click', () => {
    saveHoldOrderCorrections(true);
  });

  // Incoming Online Order (Accept / Reject) Modal Listeners
  const incomingModal = $('adm-incoming-order-modal');
  if (incomingModal) {
    incomingModal.addEventListener('click', (e) => {
      if (e.target === incomingModal) closeIncomingOrderModal();
    });
  }
  $('incoming-order-close-btn')?.addEventListener('click', closeIncomingOrderModal);
  $('incoming-order-accept-btn')?.addEventListener('click', acceptIncomingOnlineOrder);
  $('incoming-order-reject-btn')?.addEventListener('click', rejectIncomingOnlineOrder);

  // Hold Order Payment & Settlement Modal Listeners
  initHoldSettleModalListeners();
}

// ── Quick Cards & Total Bills Table Renderers ────────────────────
function renderBillingQuickCards() {
  const held = getHeldOrders();
  const holdCount = held.length;
  const holdTotal = held.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

  const closed = orders.filter(o => o.status === 'delivered' || o.payment_status === 'paid');
  const closedCount = closed.length;
  const closedTotal = closed.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

  if ($('billing-hold-count')) $('billing-hold-count').textContent = `${holdCount} ${holdCount === 1 ? 'Order' : 'Orders'}`;
  if ($('billing-hold-total')) $('billing-hold-total').textContent = `(₹${holdTotal.toFixed(2)})`;

  if ($('billing-close-count')) $('billing-close-count').textContent = `${closedCount} ${closedCount === 1 ? 'Bill' : 'Bills'}`;
  if ($('billing-close-total')) $('billing-close-total').textContent = `(₹${closedTotal.toFixed(2)})`;

  // Update metrics
  const totalBills = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const dineInCount = orders.filter(o => o.order_type === 'table' || (o.notes && o.notes.includes('[TABLE:'))).length;
  const deliveryCount = orders.filter(o => o.order_type === 'delivery' || (o.notes && o.notes.includes('[DELIVERY]'))).length;

  if ($('billing-metric-total-count')) $('billing-metric-total-count').textContent = totalBills;
  if ($('billing-metric-total-revenue')) $('billing-metric-total-revenue').textContent = `₹${totalRevenue.toFixed(2)}`;
  if ($('billing-metric-dinein-count')) $('billing-metric-dinein-count').textContent = dineInCount;
  if ($('billing-metric-delivery-count')) $('billing-metric-delivery-count').textContent = deliveryCount;
}

function renderBillingTotalBills() {
  const countBadge = $('orders-bills-count-badge');
  if (countBadge) countBadge.textContent = orders.length;

  const tbody = $('billing-bills-tbody');
  if (!tbody) return;

  const search = ($('billing-table-search')?.value || '').toLowerCase().trim();
  const typeFilter = $('billing-table-type-filter')?.value || 'all';

  let list = orders.slice();

  if (typeFilter !== 'all') {
    list = list.filter(o => {
      const parsedMeta = parseNotesMetadata(o.notes, o);
      return parsedMeta.type === typeFilter || o.order_type === typeFilter;
    });
  }

  if (search) {
    list = list.filter(o =>
      String(o.order_number).includes(search) ||
      (o.customer_name && o.customer_name.toLowerCase().includes(search)) ||
      (o.customer_phone && o.customer_phone.includes(search)) ||
      String(o.table_number || '').toLowerCase().includes(search)
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--adm-muted);">No bills found matching your criteria.</td></tr>';
    return;
  }

  tbody.innerHTML = list.slice(0, 50).map(o => {
    const parsedMeta = parseNotesMetadata(o.notes, o);
    const tableInfo = parsedMeta.tableNumber || o.table_number || '';
    const typeLabel = parsedMeta.type === 'table' ? (tableInfo ? `🪑 Table ${tableInfo}` : '🪑 Dine-in') : (parsedMeta.type === 'delivery' ? '🚗 Delivery' : '🥡 Pickup');
    const timeStr = o.created_at ? new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
    const isPaid = o.payment_status === 'paid';
    const isHold = o.status === 'hold';

    const statusBadge = isHold
      ? '<span style="background:#fef3c7;color:#b45309;font-size:0.75rem;font-weight:700;padding:.2rem .55rem;border-radius:999px;">⏳ On Hold</span>'
      : (isPaid
        ? '<span style="background:#ecfdf5;color:#059669;font-size:0.75rem;font-weight:700;padding:.2rem .55rem;border-radius:999px;">✓ Settled</span>'
        : '<span style="background:#fef2f2;color:#ef4444;font-size:0.75rem;font-weight:700;padding:.2rem .55rem;border-radius:999px;">Pending</span>');

    const actionsHtml = isHold
      ? `
        <button type="button" class="adm-btn adm-btn-outline adm-btn-sm billing-row-edit-hold-btn" data-id="${o.id}" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0;font-weight:700;" title="Edit / Cancel Dishes">✏️ Edit</button>
        <button type="button" class="adm-btn adm-btn-outline adm-btn-sm billing-row-pos-btn" data-id="${o.id}" style="background:#eef2ff;color:#4f46e5;border-color:#c7d2fe;font-weight:700;" title="Resume in POS Cart">🛒 POS</button>
        <button type="button" class="adm-btn adm-btn-primary adm-btn-sm billing-row-settle-btn" data-id="${o.id}" style="background:#10b981;border-color:#10b981;font-weight:700;" title="Print Final Bill & Settle / Close">🧾 Final Bill</button>
        <button type="button" class="adm-btn adm-btn-outline adm-btn-sm billing-row-kot-btn" data-id="${o.id}" style="background:#fff3e0;border-color:#f59e0b;color:#b45309;" title="Reprint KOT">🗒️ KOT</button>
      `
      : `
        <button type="button" class="adm-btn adm-btn-primary adm-btn-sm" onclick="openClosedOrderEditModal('${o.id}')" style="background:#4f46e5;color:#fff;border-color:#4f46e5;font-weight:700;padding:.25rem .55rem;font-size:0.75rem;" title="Edit and correct this bill">✏️ Edit</button>
        <button type="button" class="adm-btn adm-btn-outline adm-btn-sm billing-row-view-btn" data-id="${o.id}" title="View Order Details">👁️ View</button>
        <button type="button" class="adm-btn adm-btn-outline adm-btn-sm billing-row-print-btn" data-id="${o.id}" title="Reprint Bill">🖨️ Bill</button>
        <button type="button" class="adm-btn adm-btn-outline adm-btn-sm billing-row-kot-btn" data-id="${o.id}" style="background:#fff3e0;border-color:#f59e0b;color:#b45309;" title="Reprint KOT">🗒️ KOT</button>
      `;

    return `
      <tr style="border-bottom:1px solid var(--adm-border);transition:background .15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
        <td style="padding:.75rem;font-weight:800;color:#111827;">#${formatDailyOrderNumber(o)}</td>
        <td style="padding:.75rem;font-size:.8rem;color:var(--adm-muted);">${timeStr}</td>
        <td style="padding:.75rem;">
          <div style="font-weight:700;font-size:.85rem;color:#111827;">${escapeHtml(o.customer_name || 'Walk-in')}</div>
          <div style="font-size:.75rem;color:var(--adm-muted);">${escapeHtml(o.customer_phone || '—')}</div>
        </td>
        <td style="padding:.75rem;">
          <span style="background:#f1f5f9;color:#334155;font-size:.75rem;font-weight:700;padding:.15rem .5rem;border-radius:6px;">${typeLabel}</span>
        </td>
        <td style="padding:.75rem;text-align:right;font-weight:800;color:#059669;font-size:.9rem;">₹${Number(o.total_amount || 0).toFixed(2)}</td>
        <td style="padding:.75rem;text-align:center;">${statusBadge}</td>
        <td style="padding:.75rem;text-align:right;">
          <div style="display:flex;gap:.35rem;justify-content:flex-end;flex-wrap:wrap;">
            ${actionsHtml}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Wire row actions
  tbody.querySelectorAll('.billing-row-edit-hold-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.id;
      if (orderId) openHoldEditModal(orderId, 'edit');
    });
  });

  tbody.querySelectorAll('.billing-row-pos-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.id;
      const order = orders.find(o => String(o.id) === String(orderId));
      if (order) loadOrderIntoPos(order);
    });
  });

  tbody.querySelectorAll('.billing-row-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.id;
      if (!orderId) return;
      openOrderDetailDrawer(orderId);
    });
  });

  tbody.querySelectorAll('.billing-row-settle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.id;
      const order = orders.find(o => String(o.id) === String(orderId));
      if (order) openHoldSettleModal({ type: 'order', orderId, order, isHoldSettlement: true });
    });
  });

  tbody.querySelectorAll('.billing-row-print-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const order = orders.find(o => String(o.id) === String(btn.dataset.id));
      if (!order) return;
      await printOrderReceiptWithTax(order, null, { isReprint: true });
    });
  });

  tbody.querySelectorAll('.billing-row-kot-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const order = orders.find(o => String(o.id) === String(btn.dataset.id));
      if (!order) return;
      const items = getItemsForOrder(order.id);
      await printKOT(order, items, { isReprint: true });
    });
  });
}

// ── Food Veg / Non-Veg Helper ───────────────────────────────────
function isFoodVeg(f) {
  if (!f || typeof f !== 'object') return true;
  if (typeof f.isVeg === 'boolean') return f.isVeg;
  if (typeof f.is_veg === 'boolean') return f.is_veg;
  const cat = (f.category || '').toLowerCase();
  const name = (f.name || '').toLowerCase();
  if (cat.includes('nonveg') || cat.includes('kabab') || cat.includes('chicken') || cat.includes('mutton') || cat.includes('fish') || cat.includes('prawn') || cat.includes('egg')) return false;
  if (name.includes('chicken') || name.includes('mutton') || name.includes('egg') || name.includes('fish') || name.includes('prawn') || name.includes('keema') || name.includes('kabab') || name.includes('kebab')) return false;
  return true;
}

let posVegOnlyFilter = false;
let posTileMode = (() => {
  try {
    return localStorage.getItem('limra_pos_tile_mode') === 'compact' ? 'compact' : 'normal';
  } catch {
    return 'normal';
  }
})();

function syncPosTileModeUI() {
  const grid = $('pos-food-grid');
  const btn = $('pos-tile-mode-btn');
  const iconEl = $('pos-tile-mode-icon');
  const labelEl = $('pos-tile-mode-label');
  const isCompact = posTileMode === 'compact';

  if (grid) {
    grid.classList.toggle('compact-tiles', isCompact);
    grid.dataset.tileMode = posTileMode;
  }
  if (btn) {
    btn.classList.toggle('active', isCompact);
    btn.dataset.tileMode = posTileMode;
  }
  if (iconEl) iconEl.textContent = isCompact ? '▦' : '⊞';
  if (labelEl) labelEl.textContent = isCompact ? 'Compact ON' : 'Compact';
}

function setPosTileMode(mode) {
  posTileMode = mode === 'compact' ? 'compact' : 'normal';
  try {
    localStorage.setItem('limra_pos_tile_mode', posTileMode);
  } catch {}
  syncPosTileModeUI();
  renderFoodGrid($('pos-food-search')?.value);
  return posTileMode;
}

function getPosTileMode() {
  return posTileMode;
}

window.setPosTileMode = setPosTileMode;
window.getPosTileMode = getPosTileMode;

function updateCatalogCatHeader() {
  const nameEl = $('pos-catalog-cat-name');
  const countEl = $('pos-catalog-cat-count');
  if (!nameEl) return;
  const allItems = getCombinedFoodItems();
  const activeCat = (posActiveCat || 'all').toLowerCase().trim();
  const isAll = activeCat === 'all' || activeCat === 'all-dishes' || activeCat === 'all-items';
  const icon = isAll ? '🍽️' : (categoryEmojis[posActiveCat] || categoryEmojis[activeCat] || '🥘');
  const label = isAll ? 'All Dishes' : (categoryLabels[posActiveCat] || categoryLabels[activeCat] || posActiveCat);
  const matchCats = categoryAliases[posActiveCat] || categoryAliases[activeCat] || [posActiveCat, activeCat];
  const count = isAll 
    ? allItems.length 
    : allItems.filter(f => matchCats.includes(f.category)).length;
  nameEl.innerHTML = `${icon} ${escapeHtml(label)}`;
  if (countEl) countEl.textContent = `${count} dish${count === 1 ? '' : 'es'}`;
}

// ── Visual Food Grid with Pictures ──────────────────────────────
function renderFoodGrid(filterText) {
  const grid = $('pos-food-grid');
  if (!grid) return;
  syncPosTileModeUI();

  const searchEl = $('pos-food-search');
  const rawQ = (typeof filterText === 'string') ? filterText : (searchEl?.value || '');
  const q = rawQ.toLowerCase().trim();
  const source = getCombinedFoodItems();

  const activeCat = (posActiveCat || 'all').toLowerCase().trim();
  const isAll = activeCat === 'all' || activeCat === 'all-dishes' || activeCat === 'all-items';
  const matchCats = categoryAliases[posActiveCat] || categoryAliases[activeCat] || [posActiveCat, activeCat];

  // Update clear button visibility
  const clearBtn = $('pos-food-search-clear');
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

  const filtered = source.filter(f => {
    if (!f) return false;
    const catLower = (f.category || '').toLowerCase().trim();
    const matchesCat = isAll ||
      matchCats.includes(f.category) ||
      matchCats.some(c => c && c.toLowerCase() === catLower) ||
      catLower === activeCat;
    const matchesVeg = !posVegOnlyFilter || isFoodVeg(f);
    const matchesQuery = !q ||
      (f.name || '').toLowerCase().includes(q) ||
      (f.category || '').toLowerCase().includes(q) ||
      (categoryLabels[f.category] || '').toLowerCase().includes(q) ||
      (f.description && String(f.description).toLowerCase().includes(q));
    return matchesCat && matchesVeg && matchesQuery;
  });

  // Update catalog counter pill
  const countPill = $('pos-catalog-cat-count');
  if (countPill) countPill.textContent = `${filtered.length} dish${filtered.length === 1 ? '' : 'es'}`;

  if (!filtered.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--adm-muted);font-size:.82rem;padding:3rem 0;">No dishes found matching your criteria.</div>';
    return;
  }

  function buildDishCardHtml(f) {
    const fId = f.id != null ? String(f.id) : '';
    const fName = String(f.name || '');
    const imgUrl = f.image || categoryImages[f.category] || '/images/food_starters.png';
    const cartItem = (posCart || []).find(i => (f.id && i.id === f.id) || (i.name && fName && String(i.name).toLowerCase() === fName.toLowerCase()));
    const cartQty = cartItem ? cartItem.qty : 0;
    const isVeg = isFoodVeg(f);
    const vegBadge = `<span class="pos-veg-badge ${isVeg ? 'veg' : 'nonveg'}" title="${isVeg ? 'Vegetarian' : 'Non-Vegetarian'}"><span class="pos-veg-dot"></span></span>`;
    const isAvailable = f.available !== false;
    const isCombo = Boolean(f.isCombo || f.is_combo || f.category === 'combo' || fId.startsWith('combo-'));
    const priceNum = Number(f.price || 0);
    const mrpNum = Number(f.mrp || 0);
    const savings = (isCombo && mrpNum > priceNum) ? Math.round(mrpNum - priceNum) : 0;
    const comboSummary = isCombo
      ? (f.comboItemsSummary || (Array.isArray(f.comboItems) && f.comboItems.length ? f.comboItems.map(i => `${i.qty || 1}× ${i.name}`).join(' + ') : (f.description || '')))
      : '';

    return `
      <div role="button" tabindex="0" class="pos-food-tile-img ${isCombo ? 'is-combo-tile' : ''} ${isAvailable ? '' : 'is-out-of-stock'} ${cartQty > 0 ? 'in-cart' : ''}" data-id="${escapeHtml(fId)}" data-name="${escapeHtml(fName)}" data-price="${priceNum}" data-mrp="${mrpNum}" data-is-combo="${isCombo}" data-combo-summary="${escapeHtml(comboSummary)}" data-available="${isAvailable}" data-tile-mode="${posTileMode}">
        <div class="pos-tile-img-box">
          <img src="${imgUrl}" alt="${escapeHtml(fName)}" onerror="this.src='/images/food_starters.png'" loading="lazy" />
          ${isCombo ? `<span class="pos-combo-badge">🍱 COMBO</span>` : ''}
          ${cartQty > 0 ? `<span class="pos-tile-badge">${cartQty} in cart</span>` : ''}
          ${!isAvailable ? `<span style="position:absolute;bottom:4px;left:4px;right:4px;background:rgba(220,38,38,0.9);color:#fff;font-size:0.75rem;font-weight:800;padding:2px 4px;border-radius:4px;text-align:center;">Out of Stock</span>` : ''}
        </div>
        <div class="pos-tile-body">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:4px;">
            <span class="pos-tile-title" title="${escapeHtml(fName)}">${isCombo && posTileMode === 'compact' ? '<span class="pos-combo-inline-tag">🍱</span> ' : ''}${escapeHtml(fName)}</span>
            ${vegBadge}
          </div>
          ${isCombo && comboSummary ? `<div class="pos-combo-items-sub" title="${escapeHtml(comboSummary)}">${escapeHtml(comboSummary)}</div>` : ''}
          <div class="pos-tile-foot">
            <div class="pos-combo-price-wrap">
              <span class="pos-tile-price-tag">₹${priceNum.toFixed(0)}</span>
              ${savings > 0 ? `<span class="pos-combo-mrp">₹${mrpNum.toFixed(0)}</span><span class="pos-combo-save-badge">Save ₹${savings}</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:4px;">
              ${cartQty > 0 ? `<span class="pos-tile-compact-qty">${cartQty}×</span>` : ''}
              <span class="pos-tile-add-btn" title="Add to cart">+</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (isAll && !q) {
    const availableCats = new Set(filtered.map(f => f.category).filter(Boolean));
    const orderedCats = categoryTabOrder.filter(c => availableCats.has(c));
    const extraCats = Array.from(availableCats).filter(c => !categoryTabOrder.includes(c));
    const groups = [...orderedCats, ...extraCats];

    let html = '';
    groups.forEach(catKey => {
      const itemsInCat = filtered.filter(f => f.category === catKey);
      if (!itemsInCat.length) return;
      const catLabel = categoryLabels[catKey] || catKey;
      const catEmoji = categoryEmojis[catKey] || '🍲';
      html += `
        <div class="pos-category-row-header" style="grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.85rem; margin-top: 0.65rem; margin-bottom: 0.15rem; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; border-left: 4px solid #d0a047;">
          <div style="display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 0.92rem; color: #0f172a;">
            <span>${catEmoji}</span>
            <span>${escapeHtml(catLabel)}</span>
          </div>
          <span style="font-size: 0.75rem; font-weight: 700; color: #64748b; background: #ffffff; padding: 2px 8px; border-radius: 999px; border: 1px solid #e2e8f0;">
            ${itemsInCat.length} dish${itemsInCat.length === 1 ? '' : 'es'}
          </span>
        </div>
      `;
      html += itemsInCat.map(buildDishCardHtml).join('');
    });

    const uncategorized = filtered.filter(f => !f.category);
    if (uncategorized.length) {
      html += `
        <div class="pos-category-row-header" style="grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.85rem; margin-top: 0.65rem; margin-bottom: 0.15rem; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; border-left: 4px solid #d0a047;">
          <span style="font-weight: 800; font-size: 0.92rem; color: #0f172a;">🍽️ Other Dishes</span>
          <span style="font-size: 0.75rem; font-weight: 700; color: #64748b; background: #fff; padding: 2px 8px; border-radius: 999px; border: 1px solid #e2e8f0;">${uncategorized.length}</span>
        </div>
      `;
      html += uncategorized.map(buildDishCardHtml).join('');
    }
    grid.innerHTML = html;
  } else {
    grid.innerHTML = filtered.map(buildDishCardHtml).join('');
  }

  grid.querySelectorAll('.pos-food-tile-img').forEach(tile => {
    const handleSelect = () => {
      if (tile.dataset.available === 'false') {
        showAdminToast('This dish is currently marked Out of Stock.', 'error');
        return;
      }
      const matchedSourceItem = source.find(item => String(item.id) === String(tile.dataset.id));
      if (matchedSourceItem) {
        addItemToPosCart(matchedSourceItem);
      } else {
        addItemToPosCart({
          id: tile.dataset.id,
          name: tile.dataset.name,
          price: parseFloat(tile.dataset.price),
          mrp: parseFloat(tile.dataset.mrp || '0'),
          isCombo: tile.dataset.isCombo === 'true',
          comboItemsSummary: tile.dataset.comboSummary || ''
        });
      }
    };

    tile.addEventListener('click', handleSelect);
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSelect();
      }
    });
  });
}

function renderCategoryPills() {
  const pillBar = $('pos-category-pills');
  if (!pillBar) return;

  const allItems = getCombinedFoodItems();
  const availableCats = new Set(allItems.map(f => f.category).filter(Boolean));
  const orderedCats = categoryTabOrder.filter(c => availableCats.has(c));
  const extraCats = Array.from(availableCats).filter(c => !categoryTabOrder.includes(c));

  const totalCatsBadge = $('pos-total-cats-badge');
  if (totalCatsBadge) totalCatsBadge.textContent = `${availableCats.size} Cats`;

  const cats = ['all', ...orderedCats, ...extraCats];
  const activeCat = (posActiveCat || 'all').toLowerCase().trim();
  const isAll = activeCat === 'all' || activeCat === 'all-dishes' || activeCat === 'all-items';

  pillBar.innerHTML = cats.map(cat => {
    const isAct = (cat === 'all' && isAll) || (!isAll && (cat === posActiveCat || (categoryAliases[posActiveCat] || []).includes(cat)));
    const cls = isAct ? 'pos-cat-menu-item active' : 'pos-cat-menu-item';
    const icon = cat === 'all' ? '🍽️' : (categoryEmojis[cat] || '🥘');
    const label = cat === 'all' ? 'All Dishes' : (categoryLabels[cat] || cat);
    const matchCats = categoryAliases[cat] || [cat];
    const count = cat === 'all' 
      ? allItems.length 
      : allItems.filter(f => matchCats.includes(f.category)).length;

    return `
      <button type="button" class="${cls}" data-cat="${cat}">
        <span class="pos-cat-label-wrap">
          <span class="pos-cat-icon">${icon}</span>
          <span class="pos-cat-text">${escapeHtml(label)}</span>
        </span>
        <span class="pos-cat-count-badge">${count}</span>
      </button>
    `;
  }).join('');

  pillBar.querySelectorAll('.pos-cat-menu-item').forEach(pill => {
    pill.addEventListener('click', () => {
      posActiveCat = pill.dataset.cat;
      renderCategoryPills();
      updateCatalogCatHeader();
      renderFoodGrid($('pos-food-search')?.value);
    });
  });
}

// ── Panel Initialization ─────────────────────────────────────────
function initBillingPanel() {
  loadFoodsCache();

  // Populate existing order picker
  const picker = $('billing-order-picker');
  if (picker) {
    picker.innerHTML = '<option value="">— View existing order —</option>' +
      orders.slice(0, 50).map(o => `<option value="${o.id}">#${formatDailyOrderNumber(o)} ${escapeHtml(o.customer_name)} ${fmtMoney(o.total_amount)}</option>`).join('');
  }

  // 1. Render immediate static food data (0ms instant render)
  renderBillingQuickCards();
  renderBillingTotalBills();
  renderPosPlaceChips();
  initPosPlaceSearch();
  renderCategoryPills();
  updateCatalogCatHeader();
  renderFoodGrid();

  // 2. Fetch combos and coupons asynchronously in the background without blocking UI
  if (!adminCombos || adminCombos.length === 0) {
    getCombos().then(combos => {
      if (Array.isArray(combos)) {
        adminCombos = combos;
        renderCategoryPills();
        updateCatalogCatHeader();
        renderFoodGrid($('pos-food-search')?.value);
      }
    }).catch(e => {
      console.warn('[Billing] Non-blocking combos fetch failed:', e);
    });
  }

  if (!adminCoupons || adminCoupons.length === 0) {
    getCoupons().then(coupons => {
      if (Array.isArray(coupons)) {
        adminCoupons = coupons;
        renderPosCouponPicker();
      }
    }).catch(e => {
      console.warn('[Billing] Non-blocking coupons fetch failed:', e);
    });
  } else {
    renderPosCouponPicker();
  }

  if (posBillingMounted) return;
  posBillingMounted = true;

  // 0. Header Quick Action Buttons
  $('pos-quick-held-btn')?.addEventListener('click', () => {
    switchPanel('hold-orders');
  });
  $('pos-quick-history-btn')?.addEventListener('click', () => {
    switchPanel('orders');
  });
  $('pos-quick-refresh-btn')?.addEventListener('click', () => {
    loadFoodsCache();
    Promise.allSettled([getCombos(true), getCoupons(true)]).then(([combosRes, couponsRes]) => {
      if (combosRes.status === 'fulfilled' && Array.isArray(combosRes.value)) {
        adminCombos = combosRes.value;
      }
      if (couponsRes.status === 'fulfilled' && Array.isArray(couponsRes.value)) {
        adminCoupons = couponsRes.value;
        renderPosCouponPicker();
      }
      renderCategoryPills();
      updateCatalogCatHeader();
      renderFoodGrid($('pos-food-search')?.value);
    });
    renderCategoryPills();
    updateCatalogCatHeader();
    renderFoodGrid($('pos-food-search')?.value);
  });

  // Veg Only Toggle Button
  $('pos-veg-filter-btn')?.addEventListener('click', function() {
    posVegOnlyFilter = !posVegOnlyFilter;
    this.classList.toggle('active', posVegOnlyFilter);
    this.dataset.vegOnly = String(posVegOnlyFilter);
    renderFoodGrid($('pos-food-search')?.value);
  });

  // Compact / Normal Dish Tile Mode Toggle Button
  $('pos-tile-mode-btn')?.addEventListener('click', () => {
    setPosTileMode(posTileMode === 'compact' ? 'normal' : 'compact');
  });

  // Compact Extra Popover Triggers (Discount, Coupon, Delivery Fee, Kitchen Notes)
  ['discount', 'coupon', 'delivery', 'notes'].forEach(name => {
    $(`pos-extra-${name}-btn`)?.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePosExtraPopover(name);
    });
  });

  document.querySelectorAll('.pos-extra-popover-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllPosExtraPopovers();
    });
  });

  document.querySelectorAll('[data-disc-preset]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const inp = $('pos-discount-pct');
      if (inp) {
        const val = parseFloat(chip.dataset.discPreset || '0') || 0;
        if (val > 0 && posAppliedCoupon) {
          posAppliedCoupon = null;
          if ($('pos-coupon-code-input')) $('pos-coupon-code-input').value = '';
          showPosCouponFeedback('', 'error');
        }
        inp.value = chip.dataset.discPreset;
        updatePosCartUI(false);
        renderPosCouponPicker();
      }
    });
  });

  // Promo Coupon Picker Controls
  $('pos-coupon-apply-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const code = $('pos-coupon-code-input')?.value?.trim() || '';
    applyPosCoupon(code);
  });

  $('pos-coupon-code-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      applyPosCoupon(e.target.value);
    }
  });

  $('pos-coupon-clear-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    removePosCoupon();
  });

  $('pos-remove-coupon-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    removePosCoupon();
  });

  // Debounced Customer Phone & Name Autocomplete Lookup
  const triggerDebouncedCustomerLookup = (rawQuery, sourceField = 'phone') => {
    if (posCustomerLookupTimer) clearTimeout(posCustomerLookupTimer);
    const val = String(rawQuery || '').trim();
    const digits = val.replace(/\D/g, '');
    if ((sourceField === 'phone' && digits.length < 3) || (sourceField === 'name' && val.length < 2)) {
      const suggBox = $('pos-customer-suggestions');
      if (suggBox) suggBox.style.display = 'none';
      return;
    }

    posCustomerLookupTimer = setTimeout(async () => {
      let matches = lookupPosCustomers(val);
      // If exact 10-digit phone has no local cache match, attempt non-blocking scoped lookup
      if (sourceField === 'phone' && matches.length === 0 && digits.length >= 10) {
        try {
          const remoteOrders = await getCustomerOrders(digits);
          if (Array.isArray(remoteOrders) && remoteOrders.length > 0) {
            remoteOrders.forEach(ro => {
              if (ro && ro.id && !orders.some(o => String(o.id) === String(ro.id))) {
                orders.push(ro);
              }
            });
            matches = lookupPosCustomers(digits);
          }
        } catch {
          // Graceful handling for offline/unknown numbers without throwing
        }
      }

      // If exact 10-digit phone match is found, auto-fill name & address if not manually edited
      if (sourceField === 'phone' && digits.length >= 10 && matches.length > 0) {
        const exactMatch = matches.find(m => String(m.phone).replace(/\D/g, '').endsWith(digits.slice(-10)));
        if (exactMatch) {
          selectPosCustomerSuggestion(exactMatch, { fromClick: false });
        }
      }

      renderPosCustomerSuggestions(matches, val);
    }, 180);
  };

  $('pos-customer-phone')?.addEventListener('input', (e) => {
    triggerDebouncedCustomerLookup(e.target.value, 'phone');
  });

  $('pos-customer-name')?.addEventListener('input', (e) => {
    e.target.dataset.autoFilled = 'false';
    triggerDebouncedCustomerLookup(e.target.value, 'name');
  });

  $('pos-delivery-address')?.addEventListener('input', (e) => {
    e.target.dataset.autoFilled = 'false';
  });

  document.addEventListener('click', (e) => {
    const strip = $('pos-customer-strip');
    const suggBox = $('pos-customer-suggestions');
    if (suggBox && strip && !strip.contains(e.target)) {
      suggBox.style.display = 'none';
    }
  });

  document.querySelectorAll('[data-fee-preset]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const inp = $('pos-delivery-fee');
      if (inp) {
        inp.value = chip.dataset.feePreset;
        updatePosCartUI(false);
      }
    });
  });

  document.querySelectorAll('[data-note-preset]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const noteEl = $('pos-notes');
      if (!noteEl) return;
      const preset = chip.dataset.notePreset || '';
      const current = noteEl.value.trim();
      if (!current) {
        noteEl.value = preset;
      } else if (!current.toLowerCase().includes(preset.toLowerCase())) {
        noteEl.value = `${current}, ${preset}`;
      }
      syncPosExtraBadges();
    });
  });

  $('pos-notes')?.addEventListener('input', () => syncPosExtraBadges());

  document.addEventListener('click', (e) => {
    const bar = $('pos-extra-controls-bar');
    if (bar && !bar.contains(e.target)) {
      closeAllPosExtraPopovers();
    }
  });

  // Clear Search Button
  $('pos-food-search-clear')?.addEventListener('click', () => {
    const s = $('pos-food-search');
    if (s) {
      s.value = '';
      s.focus();
    }
    renderFoodGrid('');
  });

  // 1. TOP QUICK NAVIGATION CARDS
  $('billing-hold-card')?.addEventListener('click', () => {
    switchPanel('hold-orders');
  });

  $('billing-close-card')?.addEventListener('click', () => {
    switchPanel('closed-orders');
  });

  // 2. New Bill & Close POS Buttons
  const posEl = $('billing-pos');
  const totalSection = $('billing-total-section');
  const detailEl = $('billing-detail-view');
  const newBtn = $('billing-new-btn');
  const closePosBtn = $('pos-close-btn');

  newBtn?.addEventListener('click', () => {
    posEditingOrderId = null;
    posCart = [];
    posAppliedCoupon = null;
    posActiveCat = 'all';
    posVegOnlyFilter = false;
    $('pos-veg-filter-btn')?.classList.remove('active');
    clearPosSelectedPlace();
    showPosCouponFeedback('', 'error');
    if (posEl) posEl.style.display = 'block';
    if (totalSection) totalSection.style.display = 'none';
    closeOrderDetailDrawer();
    closeAllPosExtraPopovers();
    if ($('pos-customer-suggestions')) $('pos-customer-suggestions').style.display = 'none';
    if (picker) picker.value = '';

    // Clear inputs and remove any invalid red highlights
    ['pos-customer-name','pos-customer-phone','pos-table-number','pos-notes','pos-discount-pct','pos-delivery-fee','pos-food-search','pos-place-search','pos-coupon-code-input'].forEach(id => {
      const el = $(id);
      if (el) {
        el.value = '';
        el.classList.remove('pos-input-invalid');
        delete el.dataset.autoFilled;
      }
    });
    if ($('pos-delivery-address')) {
      $('pos-delivery-address').value = '';
      $('pos-delivery-address').classList.remove('pos-input-invalid');
      delete $('pos-delivery-address').dataset.autoFilled;
    }

    renderPosPlaceChips();
    updatePosCartUI();
    renderPosCouponPicker();
    renderCategoryPills();
    updateCatalogCatHeader();
    renderFoodGrid('');

    // Sync order type state & auto-focus food search for rapid billing
    syncPosOrderTypeState(posOrderType || 'table');
    setTimeout(() => { $('pos-food-search')?.focus(); }, 100);

    // Background combo & coupon check if not already loaded
    if (!adminCombos || adminCombos.length === 0) {
      getCombos().then(combos => {
        if (Array.isArray(combos)) {
          adminCombos = combos;
          renderCategoryPills();
          updateCatalogCatHeader();
          renderFoodGrid($('pos-food-search')?.value);
        }
      }).catch(() => {});
    }
    if (!adminCoupons || adminCoupons.length === 0) {
      getCoupons().then(coupons => {
        if (Array.isArray(coupons)) {
          adminCoupons = coupons;
          renderPosCouponPicker();
        }
      }).catch(() => {});
    }
  });

  closePosBtn?.addEventListener('click', () => {
    posEditingOrderId = null;
    posCart = [];
    switchPanel('orders');
  });

  // 3. Detail View Drawer Close / Back Button & Orders Button
  $('billing-detail-back-btn')?.addEventListener('click', () => {
    closeOrderDetailDrawer();
  });

  $('billing-detail-close-btn')?.addEventListener('click', () => {
    closeOrderDetailDrawer();
  });

  $('billing-detail-drawer-backdrop')?.addEventListener('click', () => {
    closeOrderDetailDrawer();
  });

  $('billing-detail-orders-btn')?.addEventListener('click', () => {
    closeOrderDetailDrawer();
    switchPanel('orders');
  });

  // 4. Order Picker Dropdown Change (opens slide-over drawer without hiding POS workstation)
  picker?.addEventListener('change', () => {
    const id = picker.value;
    if (id) {
      openOrderDetailDrawer(id);
    } else {
      closeOrderDetailDrawer();
    }
  });

  // 5. Quick Table Selection Buttons
  document.querySelectorAll('.pos-quick-table-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tInp = $('pos-table-number');
      if (tInp) {
        tInp.value = `Table ${btn.dataset.tbl}`;
        tInp.classList.remove('pos-input-invalid');
      }
      updatePosTableBadge();
    });
  });

  $('pos-table-number')?.addEventListener('input', updatePosTableBadge);
  $('pos-top-table-badge')?.addEventListener('click', () => {
    if (posOrderType !== 'table') {
      syncPosOrderTypeState('table');
    }
    const tInp = $('pos-table-number');
    if (tInp) {
      tInp.focus();
      tInp.select?.();
    }
  });

  // 6. Bind Order Type Buttons
  document.querySelectorAll('.pos-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      syncPosOrderTypeState(btn.dataset.type);
    });
  });

  // Bind Quick Payment Mode Pills
  document.querySelectorAll('.pos-pay-mode-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.pay;
      const sel = $('pos-payment-mode');
      if (sel) sel.value = mode;
      document.querySelectorAll('.pos-pay-mode-pill').forEach(b => {
        b.className = 'pos-pay-mode-pill adm-btn ' + (b === btn ? 'adm-btn-primary' : 'adm-btn-outline');
      });
      updatePosCartUI();
    });
  });

  // 7. Cart Clear Button
  $('pos-cart-clear-btn')?.addEventListener('click', () => {
    if (posCart.length === 0) return;
    if (confirm('Clear all items from current cart?')) {
      posCart = [];
      posAppliedCoupon = null;
      if ($('pos-coupon-code-input')) $('pos-coupon-code-input').value = '';
      showPosCouponFeedback('', 'error');
      updatePosCartUI(true);
      renderPosCouponPicker();
    }
  });

  // 8. Custom Food Manual Add
  $('pos-food-manual-btn')?.addEventListener('click', () => {
    const r = $('pos-manual-row');
    if (r) {
      const isOpening = r.style.display === 'none';
      r.style.display = isOpening ? 'block' : 'none';
      if (isOpening) {
        setTimeout(() => $('pos-manual-name')?.focus(), 50);
      }
    }
  });

  $('pos-manual-row')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('pos-manual-add')?.click();
    }
  });

  // Initialize POS Item Edit modal listeners
  initPosEditModalListeners();

  $('pos-manual-add')?.addEventListener('click', () => {
    const name = $('pos-manual-name')?.value?.trim();
    const price = parseFloat($('pos-manual-price')?.value || '0');
    const qty = parseInt($('pos-manual-qty')?.value || '1', 10);
    const notes = $('pos-manual-notes')?.value?.trim() || '';

    if (!name || isNaN(price) || price < 0) {
      showAdminToast('Please enter a valid item name and price.', 'error');
      return;
    }

    addItemToPosCart({ name, price, qty: Math.max(1, qty), notes });
    if ($('pos-manual-name')) $('pos-manual-name').value = '';
    if ($('pos-manual-price')) $('pos-manual-price').value = '';
    if ($('pos-manual-qty')) $('pos-manual-qty').value = '1';
    if ($('pos-manual-notes')) $('pos-manual-notes').value = '';
    if ($('pos-manual-row')) $('pos-manual-row').style.display = 'none';
  });

  // 9. Live Search in Menu Grid & Total Bills Table
  $('pos-food-search')?.addEventListener('input', function() { renderFoodGrid(this.value); });
  $('billing-table-search')?.addEventListener('input', renderBillingTotalBills);
  $('billing-table-type-filter')?.addEventListener('change', renderBillingTotalBills);
  $('billing-table-refresh-btn')?.addEventListener('click', () => {
    renderBillingQuickCards();
    renderBillingTotalBills();
  });

  // 10. Discount & Delivery fee input listeners
  $('pos-discount-pct')?.addEventListener('input', (e) => {
    const manualVal = parseFloat(e.target.value || '0') || 0;
    if (manualVal > 0 && posAppliedCoupon) {
      posAppliedCoupon = null;
      if ($('pos-coupon-code-input')) $('pos-coupon-code-input').value = '';
      showPosCouponFeedback('', 'error');
      renderPosCouponPicker();
    }
    updatePosCartUI(false);
  });
  $('pos-delivery-fee')?.addEventListener('input', () => updatePosCartUI(false));

  // 11. POS Action Handlers
  function resetPosWorkstation() {
    posEditingOrderId = null;
    posCart = [];
    posAppliedCoupon = null;
    posActiveCat = 'all';
    posVegOnlyFilter = false;
    $('pos-veg-filter-btn')?.classList.remove('active');
    clearPosSelectedPlace();
    showPosCouponFeedback('', 'error');
    if ($('pos-customer-suggestions')) $('pos-customer-suggestions').style.display = 'none';
    ['pos-customer-name','pos-customer-phone','pos-table-number','pos-notes','pos-discount-pct','pos-delivery-fee','pos-food-search','pos-place-search','pos-coupon-code-input'].forEach(id => {
      const el = $(id);
      if (el) {
        el.value = '';
        el.classList.remove('pos-input-invalid');
        delete el.dataset.autoFilled;
      }
    });
    if ($('pos-delivery-address')) {
      $('pos-delivery-address').value = '';
      $('pos-delivery-address').classList.remove('pos-input-invalid');
      delete $('pos-delivery-address').dataset.autoFilled;
    }

    // Comprehensive reset of order type and payment modes
    syncPosOrderTypeState('table');
    const paySel = $('pos-payment-mode');
    if (paySel) paySel.value = 'upi';
    document.querySelectorAll('.pos-pay-mode-pill').forEach(b => {
      const isUpi = b.dataset.pay === 'upi';
      b.className = 'pos-pay-mode-pill adm-btn ' + (isUpi ? 'adm-btn-primary' : 'adm-btn-outline');
    });
    document.querySelectorAll('.pos-quick-table-btn').forEach(b => b.classList.remove('active'));

    const billBtnLabel = $('pos-bill-btn-label');
    const billBtnIcon = $('pos-bill-btn-icon');
    if (billBtnLabel) billBtnLabel.textContent = 'Create Bill & Settle';
    if (billBtnIcon) billBtnIcon.textContent = '🗎';

    updatePosCartUI(true);
    renderPosCouponPicker();
    renderCategoryPills();
    updateCatalogCatHeader();
    renderFoodGrid('');
    const posEl = $('billing-pos');
    if (posEl) posEl.style.display = 'block';
    closeOrderDetailDrawer();
    closeAllPosExtraPopovers();
    renderBillingQuickCards();
    renderBillingTotalBills();
    renderOrdersTable();
    renderHoldOrdersPanel();
    renderTablesPanel();
    renderKitchenPanel();
    setTimeout(() => { $('pos-food-search')?.focus(); }, 150);
  }

  $('pos-kot-hold-btn')?.addEventListener('click', async () => {
    const btn = $('pos-kot-hold-btn');
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    try {
      const result = await buildOrderFromPos('hold');
      if (!result) return;
      await printKOT(result.order, result.items);
      showAdminToast(`Order #${result.order.order_number} held & KOT printed! 🖨️`, 'success');
      resetPosWorkstation();
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('pos-kot-only-btn')?.addEventListener('click', async () => {
    const btn = $('pos-kot-only-btn');
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    try {
      const result = await buildOrderFromPos('kot');
      if (!result) return;
      await printKOT(result.order, result.items);
      showAdminToast(`Order #${result.order.order_number} sent to Kitchen & KOT printed! 👨‍🍳`, 'success');
      resetPosWorkstation();
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('pos-kot-bill-btn')?.addEventListener('click', async () => {
    const btn = $('pos-kot-bill-btn');
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    try {
      const result = await buildOrderFromPos('bill');
      if (!result) return;
      // For Delivery and Takeaway/Pickup, print Customer Bill only (avoids redundant KOT prints)
      if (posOrderType === 'delivery' || posOrderType === 'pickup') {
        await printOrderReceiptWithTax(result.order, result.items);
      } else {
        await printCombinedKOTAndBill(result.order, result.items);
      }
      showAdminToast(`Order #${result.order.order_number} bill generated (${formatBillAmount(result.order.total_amount)})! Moved to Bill section. 🧾`, 'success');
      resetPosWorkstation();
      // Switch to Tables -> Bill section so cashier immediately sees the unpaid bill in Bill section
      tablesSubtab = 'bill';
      document.querySelectorAll('#tables-filter-pills button').forEach(p => {
        p.classList.toggle('active', (p.dataset.subtab || p.dataset.filter) === 'bill');
      });
      renderTablesPanel();
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Fast Billing Keyboard Shortcuts (F1: KOT Hold, F2 / Ctrl+Enter: KOT & Bill, Escape: Close Drawer / Popover)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isOrderDetailDrawerOpen()) {
        e.preventDefault();
        closeOrderDetailDrawer();
        return;
      }
      closeAllPosExtraPopovers();
    }
    const posBox = $('billing-pos');
    if (!posBox || posBox.style.display === 'none') return;
    if (e.key === 'F2' || (e.ctrlKey && e.key === 'Enter')) {
      e.preventDefault();
      e.stopPropagation();
      $('pos-kot-bill-btn')?.click();
    } else if (e.key === 'F1') {
      e.preventDefault();
      e.stopPropagation();
      $('pos-kot-hold-btn')?.click();
    }
  });

  // Quick Enter in food search: adds first filtered dish
  $('pos-food-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const firstDishBtn = document.querySelector('#pos-food-grid .pos-food-tile-img, #pos-food-grid .pos-food-card');
      if (firstDishBtn) {
        e.preventDefault();
        firstDishBtn.click();
      }
    }
  });

  $('pos-save-only-btn')?.addEventListener('click', async () => {
    const result = await buildOrderFromPos('save');
    if (!result) return;
    showAdminToast(`Order #${result.order.order_number} saved! ✅`, 'success');
    posCart = [];
    if (posEl) posEl.style.display = 'none';
    if (totalSection) totalSection.style.display = 'block';
    renderBillingQuickCards();
    renderBillingTotalBills();
    renderHoldOrdersPanel();
    renderTablesPanel();
    renderKitchenPanel();
  });

  // Print buttons in detail view
  $('billing-print-btn')?.addEventListener('click', async () => {
    const order = orders.find(o => o.id === selectedOrderId);
    if (!order) return;
    await printOrderReceiptWithTax(order, null, { isReprint: true });
  });

  $('billing-print-kot-btn')?.addEventListener('click', async () => {
    const order = orders.find(o => o.id === selectedOrderId);
    if (!order) return;
    const items = getItemsForOrder(order.id);
    await printKOT(order, items, { isReprint: true });
  });
}

function updatePosTotals() { updatePosCartUI(); }

// ════════════════════════════════════════════════════════
// SETTINGS HUB, STAFF MANAGER & WHATSAPP MANAGER
// ════════════════════════════════════════════════════════

let settingsSubtab = 'restaurant';
let settingsMounted = false;
let staffEditingId = null;
let isSettingsDirty = false;

function setSettingsDirtyState(dirty) {
  isSettingsDirty = dirty;
  const badges = [document.getElementById('stg-dirty-badge'), document.getElementById('stg-bottom-dirty-badge')];
  const texts = [document.getElementById('stg-dirty-text'), document.getElementById('stg-bottom-dirty-text')];

  badges.forEach(b => {
    if (!b) return;
    b.className = dirty ? 'stg-dirty-badge dirty' : 'stg-dirty-badge saved';
  });

  texts.forEach(t => {
    if (!t) return;
    t.textContent = dirty ? 'Unsaved changes' : 'All changes saved';
  });
}

function setupSettingsDirtyTracking() {
  const panel = document.getElementById('panel-settings');
  if (!panel) return;

  panel.addEventListener('input', (e) => {
    if (e.target.id === 'staff-search') return;
    setSettingsDirtyState(true);
  });

  panel.addEventListener('change', (e) => {
    if (e.target.id === 'staff-role-filter' || e.target.id === 'staff-status-filter') return;
    setSettingsDirtyState(true);
  });

  window.addEventListener('beforeunload', (e) => {
    if (isSettingsDirty) {
      e.preventDefault();
      e.returnValue = 'You have unsaved changes in Settings. Are you sure you want to leave?';
      return e.returnValue;
    }
  });
}

async function saveAllRestaurantSettings() {
  const saveBtns = [document.getElementById('stg-save-btn'), document.getElementById('stg-top-save-btn')];
  saveBtns.forEach(btn => {
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Saving...';
  });

  try {
    // 1. Save Printer, Restaurant Identity, GST, Billing & KOT Settings to DB
    await savePrinterSettingsToDB();

    // 2. Save Google Business Profile settings if present
    const gbizName = document.getElementById('gbiz-name');
    if (gbizName) {
      const updatedGbiz = {
        name: document.getElementById('gbiz-name')?.value?.trim() || 'LIMRA RESTAURANT',
        category: document.getElementById('gbiz-category')?.value?.trim() || 'Mughlai & Biryani Restaurant',
        reviewUrl: document.getElementById('gbiz-review-url')?.value?.trim() || 'https://g.page/r/CcrqEfWap5zfEBE/review',
        mapsUrl: document.getElementById('gbiz-maps-url')?.value?.trim() || 'https://maps.google.com/?q=LIMRA+Restaurant',
        hours: document.getElementById('gbiz-hours')?.value?.trim() || '11:00 AM – 11:30 PM (Daily)',
        phone: document.getElementById('gbiz-phone')?.value?.trim() || '+91 99999 88888',
        address: document.getElementById('gbiz-address')?.value?.trim() || 'Main Road, Near Bus Stand, Egra, West Bengal',
        rating: '4.8',
        reviewsCount: '348',
        viewsCount: '12.4k',
        status: 'Verified ✓'
      };
      localStorage.setItem('limra_google_business_profile', JSON.stringify(updatedGbiz));
      renderGoogleBusinessProfileUI();
    }

    // 3. Save WhatsApp automated triggers if present
    const waBizPhone = document.getElementById('wa-biz-phone');
    if (waBizPhone) {
      const updatedWa = {
        businessPhone: $('wa-biz-phone')?.value?.trim() || '+91 99999 88888',
        businessName: $('wa-biz-name')?.value?.trim() || 'LIMRA RESTAURANT',
        autoOrderConfirm: $('wa-auto-confirm')?.checked ?? true,
        autoOutForDelivery: $('wa-auto-delivery')?.checked ?? true,
        autoTableBill: $('wa-auto-table')?.checked ?? true,
        autoReviewBooster: $('wa-auto-review')?.checked ?? true,
        autoPromoCoupons: $('wa-auto-promo')?.checked ?? true
      };
      localStorage.setItem('limra_whatsapp_settings', JSON.stringify(updatedWa));
    }

    setSettingsDirtyState(false);
    showAdminToast('All restaurant settings successfully saved and synced! ⚙️✨', 'success');
  } catch (err) {
    console.error('[Settings] Error saving settings:', err);
    showAdminToast('Error saving settings: ' + (err.message || err), 'error');
  } finally {
    saveBtns.forEach(btn => {
      if (!btn) return;
      btn.disabled = false;
      btn.innerHTML = btn.id === 'stg-top-save-btn' ? '<span>💾</span> Save Settings' : '<span>💾</span> Save All Settings';
    });
  }
}

async function resetAllRestaurantSettings() {
  const resetBtn = document.getElementById('stg-reset-btn');
  if (resetBtn) {
    resetBtn.disabled = true;
    resetBtn.innerHTML = '<span>⏳</span> Reverting...';
  }

  try {
    await loadPrinterSettingsFromDB();
    syncPrinterSettingsToUI();
    if (typeof renderThermalLivePreview === 'function') {
      await renderThermalLivePreview();
    }
    if (settingsSubtab === 'staff') {
      renderStaffList();
    } else if (settingsSubtab === 'whatsapp') {
      renderWhatsAppManagerUI();
    } else if (settingsSubtab === 'integrations') {
      renderGoogleBusinessProfileUI();
      renderGoogleSheetsSettingsUI();
    }
    setSettingsDirtyState(false);
    showAdminToast('Settings reverted to saved values. ↺', 'info');
  } catch (err) {
    console.error('[Settings] Revert error:', err);
    showAdminToast('Could not revert settings: ' + (err.message || err), 'error');
  } finally {
    if (resetBtn) {
      resetBtn.disabled = false;
      resetBtn.innerHTML = '<span>↺</span> Discard Changes';
    }
  }
}

function setupSettingsGlobalActionListeners() {
  document.getElementById('stg-save-btn')?.addEventListener('click', saveAllRestaurantSettings);
  document.getElementById('stg-top-save-btn')?.addEventListener('click', saveAllRestaurantSettings);
  document.getElementById('stg-reset-btn')?.addEventListener('click', resetAllRestaurantSettings);
}

function setupSettingsNavListeners() {
  document.querySelectorAll('#settings-nav-tabs .settings-nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetSubtab = btn.dataset.subtab;
      switchSettingsSubtab(targetSubtab);
    });
  });
}

function switchSettingsSubtab(tabName) {
  let targetTab = tabName;
  if (targetTab === 'profile' || targetTab === 'sheets') {
    targetTab = 'integrations';
  }
  if (!targetTab) targetTab = 'restaurant';
  settingsSubtab = targetTab;

  document.querySelectorAll('#settings-nav-tabs .settings-nav-tab').forEach(btn => {
    const isActive = btn.dataset.subtab === targetTab;
    btn.classList.toggle('active', isActive);
  });

  document.querySelectorAll('#panel-settings .stg-pane').forEach(pane => {
    pane.style.display = pane.id === `settings-subtab-${targetTab}` ? 'block' : 'none';
  });

  if (targetTab === 'restaurant' || targetTab === 'billing' || targetTab === 'payments' || targetTab === 'kitchen') {
    syncPrinterSettingsToUI();
  }
  if (targetTab === 'printer') {
    initPrinterPanel();
  }
  if (targetTab === 'staff') {
    renderStaffList();
  }
  if (targetTab === 'whatsapp') {
    renderWhatsAppManagerUI();
  }
  if (targetTab === 'integrations') {
    initProfilePanel();
    renderGoogleSheetsSettingsUI();
  }
}

function initSettingsPanel() {
  if (!settingsMounted) {
    settingsMounted = true;
    setupSettingsNavListeners();
    setupStaffManagerListeners();
    setupWhatsAppManagerListeners();
    setupSettingsGlobalActionListeners();
    setupSettingsDirtyTracking();
  }

  loadPrinterSettingsFromDB().then(() => {
    syncPrinterSettingsToUI();
    if (typeof renderThermalLivePreview === 'function') {
      renderThermalLivePreview();
    }
  });

  switchSettingsSubtab(settingsSubtab || 'restaurant');
}

// ────────────────────────────────────────────────────────
// 👥 STAFF MANAGER & DATABASE RBAC ENGINE (public.admin_users)
// ────────────────────────────────────────────────────────
const DEFAULT_STAFF_MEMBERS = [
  { id: 'st-1', name: 'Salim Khan', role: 'Store Manager', phone: '+91 99887 76655', email: 'salim@limra.com', shift: '10:00 AM - 08:00 PM', status: 'on_duty', is_active: true, notes: 'Master admin & operations' },
  { id: 'st-2', name: 'Rahul Sharma', role: 'Head Chef / Kitchen', phone: '+91 98765 43210', email: 'rahul@limra.com', shift: '11:00 AM - 11:00 PM', status: 'on_duty', is_active: true, notes: 'Main kitchen & Tandoor in-charge' },
  { id: 'st-3', name: 'Imran Ansari', role: 'Service Captain', phone: '+91 98123 45678', email: 'imran@limra.com', shift: '12:00 PM - 11:30 PM', status: 'on_duty', is_active: true, notes: 'Dining hall & QR tables manager' },
  { id: 'st-4', name: 'Danish Ali', role: 'Delivery Rider', phone: '+91 97234 56789', email: 'danish@limra.com', shift: '01:00 PM - 11:00 PM', status: 'on_duty', is_active: true, notes: 'Vehicle DL-3S-8821' },
  { id: 'st-5', name: 'Afzal Qureshi', role: 'POS Cashier', phone: '+91 96345 67890', email: 'afzal@limra.com', shift: '10:00 AM - 07:00 PM', status: 'off_duty', is_active: false, notes: 'Counter billing & settlements' }
];

let dbStaffMembers = [];

async function loadStaffMembersFromDB() {
  try {
    const { data, error } = await insforge.database
      .from('admin_users')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (Array.isArray(data) && data.length > 0) {
      dbStaffMembers = data.map(s => ({
        id: s.id,
        user_id: s.user_id,
        name: s.name || (s.email ? s.email.split('@')[0] : 'Staff'),
        role: s.role || 'cashier',
        status: s.status || (s.is_active ? 'on_duty' : 'off_duty'),
        is_active: typeof s.is_active === 'boolean' ? s.is_active : s.status === 'on_duty',
        phone: s.phone || '',
        email: s.email || '',
        shift: s.shift || '10:00 AM - 08:00 PM',
        notes: s.notes || ''
      }));
      try {
        localStorage.setItem('limra_staff_members_cache', JSON.stringify(dbStaffMembers));
      } catch (e) {}
    }
  } catch (err) {
    console.warn('[Staff DB Load Notice]:', err.message);
    try {
      const cached = localStorage.getItem('limra_staff_members_cache');
      if (cached) dbStaffMembers = JSON.parse(cached);
    } catch (e) {}
  }
  if (!dbStaffMembers || dbStaffMembers.length === 0) {
    dbStaffMembers = [...DEFAULT_STAFF_MEMBERS];
  }
  return dbStaffMembers;
}

function getStaffList() {
  return (Array.isArray(dbStaffMembers) && dbStaffMembers.length > 0) ? dbStaffMembers : DEFAULT_STAFF_MEMBERS;
}

async function saveStaffMemberToDB(staffData) {
  const { id, name, role, status, phone, email, shift, notes } = staffData;
  const normalizedRole = normalizeStaffRole(role);
  const isActive = status === 'on_duty';

  if (id && !String(id).startsWith('st-')) {
    // Existing DB record
    const { error } = await insforge.database
      .from('admin_users')
      .update({
        name,
        role: normalizedRole,
        status,
        is_active: isActive,
        phone,
        email: email || undefined,
        shift,
        notes,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);
    if (error) throw error;
  } else {
    // New DB record
    const cleanEmail = email || `${name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'staff' + Date.now()}@limra.pos`;
    const { error } = await insforge.database
      .from('admin_users')
      .insert([{
        name,
        role: normalizedRole,
        status,
        is_active: isActive,
        phone,
        email: cleanEmail,
        shift: shift || '10:00 AM - 08:00 PM',
        notes
      }]);
    if (error) throw error;
  }
  await loadStaffMembersFromDB();
  renderStaffList();
}

async function deleteStaffMemberFromDB(staffId) {
  if (!staffId) return;
  if (!String(staffId).startsWith('st-')) {
    const { error } = await insforge.database
      .from('admin_users')
      .delete()
      .eq('id', staffId);
    if (error) throw error;
  }
  dbStaffMembers = dbStaffMembers.filter(s => String(s.id) !== String(staffId));
  try {
    localStorage.setItem('limra_staff_members_cache', JSON.stringify(dbStaffMembers));
  } catch (e) {}
  await loadStaffMembersFromDB();
  renderStaffList();
}

async function toggleStaffStatusInDB(staffId, newStatus) {
  const isActive = newStatus === 'on_duty';
  if (staffId && !String(staffId).startsWith('st-')) {
    const { error } = await insforge.database
      .from('admin_users')
      .update({
        status: newStatus,
        is_active: isActive,
        updated_at: new Date().toISOString()
      })
      .eq('id', staffId);
    if (error) throw error;
  }
  const target = dbStaffMembers.find(s => String(s.id) === String(staffId));
  if (target) {
    target.status = newStatus;
    target.is_active = isActive;
  }
  try {
    localStorage.setItem('limra_staff_members_cache', JSON.stringify(dbStaffMembers));
  } catch (e) {}
  renderStaffList();
}

function renderStaffList() {
  const staff = getStaffList();
  const roleFilter = $('staff-role-filter')?.value || 'all';
  const statusFilter = $('staff-status-filter')?.value || 'all';
  const search = ($('staff-search')?.value || '').toLowerCase().trim();

  // 1. Calculate KPIs
  const totalCount = staff.length;
  const onDutyCount = staff.filter(s => s.status === 'on_duty').length;
  const kitchenCount = staff.filter(s => s.role.toLowerCase().includes('chef') || s.role.toLowerCase().includes('kitchen')).length;
  const riderCount = staff.filter(s => s.role.toLowerCase().includes('rider') || s.role.toLowerCase().includes('delivery')).length;

  if ($('staff-kpi-total')) $('staff-kpi-total').textContent = `${totalCount} Staff`;
  if ($('staff-kpi-onduty')) $('staff-kpi-onduty').textContent = `${onDutyCount} Active`;
  if ($('staff-kpi-kitchen')) $('staff-kpi-kitchen').textContent = `${kitchenCount} Chef${kitchenCount === 1 ? '' : 's'}`;
  if ($('staff-kpi-riders')) $('staff-kpi-riders').textContent = `${riderCount} Rider${riderCount === 1 ? '' : 's'}`;
  if ($('stg-nav-staff-count')) $('stg-nav-staff-count').textContent = `${totalCount} Team`;

  // 2. Filter Staff
  let filtered = staff;
  if (roleFilter !== 'all') {
    filtered = filtered.filter(s => s.role === roleFilter);
  }
  if (statusFilter !== 'all') {
    filtered = filtered.filter(s => s.status === statusFilter);
  }
  if (search) {
    filtered = filtered.filter(s =>
      s.name.toLowerCase().includes(search) ||
      s.phone.includes(search) ||
      s.role.toLowerCase().includes(search) ||
      (s.email && s.email.toLowerCase().includes(search))
    );
  }

  // 3. Render Cards Grid
  const cardsGrid = $('staff-cards-grid');
  if (cardsGrid) {
    if (filtered.length === 0) {
      cardsGrid.innerHTML = `<div class="adm-card adm-empty" style="grid-column:1/-1;text-align:center;padding:2.5rem;">No staff members match the selected filter.</div>`;
    } else {
      cardsGrid.innerHTML = filtered.map(s => {
        const isOnDuty = s.status === 'on_duty';
        const digits = s.phone.replace(/\D/g, '');
        const waLink = `https://wa.me/${digits.length === 10 ? '91' + digits : digits}`;
        
        let roleBg = '#eef2ff';
        let roleColor = '#6366f1';
        if (s.role.includes('Manager')) { roleBg = '#fef3c7'; roleColor = '#b45309'; }
        if (s.role.includes('Chef') || s.role.includes('Kitchen')) { roleBg = '#ffedd5'; roleColor = '#c2410c'; }
        if (s.role.includes('Rider')) { roleBg = '#ecfeff'; roleColor = '#0891b2'; }

        return `
          <div class="adm-card" style="border:1px solid var(--adm-border);box-shadow:0 1px 3px rgba(0,0,0,.04);padding:1.25rem;display:flex;flex-direction:column;justify-content:space-between;gap:1rem;">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">
                <div style="display:flex;align-items:center;gap:.75rem;">
                  <div style="width:46px;height:46px;border-radius:12px;background:${roleBg};color:${roleColor};font-weight:800;font-size:1.1rem;display:flex;align-items:center;justify-content:center;">
                    ${initials(s.name)}
                  </div>
                  <div>
                    <h3 style="margin:0;font-size:1rem;font-weight:800;color:#1e293b;">${escapeHtml(s.name)}</h3>
                    <span style="background:${roleBg};color:${roleColor};font-size:0.75rem;font-weight:700;padding:.15rem .5rem;border-radius:6px;display:inline-block;margin-top:.2rem;">
                      ${escapeHtml(s.role)}
                    </span>
                  </div>
                </div>
                <div>
                  <button type="button" class="btn-toggle-staff-status adm-btn adm-btn-sm" data-id="${s.id}" style="background:${isOnDuty ? '#ecfdf5' : '#f1f5f9'};color:${isOnDuty ? '#059669' : '#64748b'};border:1px solid ${isOnDuty ? '#a7f3d0' : '#cbd5e1'};font-size:0.75rem;font-weight:700;padding:.2rem .55rem;border-radius:999px;cursor:pointer;">
                    ${isOnDuty ? '🟢 On-Duty' : '⚪ Off-Duty'}
                  </button>
                </div>
              </div>

              <div style="margin-top:1rem;display:flex;flex-direction:column;gap:.35rem;font-size:.82rem;color:var(--adm-muted);">
                <div style="display:flex;align-items:center;gap:.4rem;">
                  <span>📞</span> <a href="tel:${s.phone}" style="color:#1e293b;font-weight:600;text-decoration:none;">${s.phone}</a>
                </div>
                ${s.email ? `<div style="display:flex;align-items:center;gap:.4rem;"><span>✉️</span> <span>${escapeHtml(s.email)}</span></div>` : ''}
                <div style="display:flex;align-items:center;gap:.4rem;">
                  <span>⏱️</span> <span>Shift: <strong>${escapeHtml(s.shift || 'Flexible')}</strong></span>
                </div>
                ${s.notes ? `<div style="display:flex;align-items:center;gap:.4rem;font-size:.75rem;color:#64748b;margin-top:.2rem;"><span>📝</span> <span>${escapeHtml(s.notes)}</span></div>` : ''}
              </div>
            </div>

            <!-- Card Actions -->
            <div style="display:flex;gap:.4rem;border-top:1px dashed var(--adm-border);padding-top:.85rem;align-items:center;">
              <a href="tel:${s.phone}" class="adm-btn adm-btn-outline adm-btn-sm" style="flex:1;text-align:center;text-decoration:none;font-weight:600;font-size:.75rem;padding:.35rem .4rem;">
                📞 Call
              </a>
              <a href="${waLink}" target="_blank" class="adm-btn adm-btn-outline adm-btn-sm" style="flex:1;text-align:center;text-decoration:none;font-weight:600;font-size:.75rem;padding:.35rem .4rem;color:#15803d;border-color:#bbf7d0;background:#f0fdf4;">
                💬 WhatsApp
              </a>
              <button type="button" class="btn-edit-staff adm-btn adm-btn-outline adm-btn-sm" data-id="${s.id}" style="padding:.35rem .55rem;" title="Edit Staff Member">
                ✏️
              </button>
              <button type="button" class="btn-delete-staff adm-btn adm-btn-outline adm-btn-sm" data-id="${s.id}" style="padding:.35rem .55rem;color:#ef4444;border-color:#fecaca;" title="Delete Staff Member">
                🗑️
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 4. Render Table
  const tbody = $('staff-table-body');
  if (tbody) {
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="adm-empty" style="text-align:center;padding:2rem;color:var(--adm-muted);">No staff members found.</td></tr>`;
    } else {
      tbody.innerHTML = filtered.map(s => {
        const isOnDuty = s.status === 'on_duty';
        const digits = s.phone.replace(/\D/g, '');
        const waLink = `https://wa.me/${digits.length === 10 ? '91' + digits : digits}`;

        return `
          <tr>
            <td style="padding-left:1.25rem;">
              <div style="display:flex;align-items:center;gap:.65rem;">
                <div style="width:36px;height:36px;border-radius:10px;background:#eef2ff;color:#6366f1;font-weight:800;font-size:.9rem;display:flex;align-items:center;justify-content:center;">
                  ${initials(s.name)}
                </div>
                <div>
                  <strong style="color:#1e293b;">${escapeHtml(s.name)}</strong>
                  ${s.email ? `<div style="font-size:0.75rem;color:var(--adm-muted);">${escapeHtml(s.email)}</div>` : ''}
                </div>
              </div>
            </td>
            <td><span style="font-weight:600;font-size:.85rem;color:#334155;">${escapeHtml(s.role)}</span></td>
            <td><a href="tel:${s.phone}" style="color:var(--adm-green);font-weight:600;text-decoration:none;">${s.phone}</a></td>
            <td style="font-size:.8rem;color:var(--adm-muted);">${escapeHtml(s.shift || 'Flexible')}</td>
            <td>
              <button type="button" class="btn-toggle-staff-status adm-btn adm-btn-sm" data-id="${s.id}" style="background:${isOnDuty ? '#ecfdf5' : '#f1f5f9'};color:${isOnDuty ? '#059669' : '#64748b'};border:1px solid ${isOnDuty ? '#a7f3d0' : '#cbd5e1'};font-size:0.75rem;font-weight:700;padding:.2rem .55rem;border-radius:999px;">
                ${isOnDuty ? '🟢 On-Duty' : '⚪ Off-Duty'}
              </button>
            </td>
            <td style="text-align:right;padding-right:1.25rem;">
              <div style="display:inline-flex;gap:.35rem;align-items:center;justify-content:flex-end;">
                <a href="${waLink}" target="_blank" class="adm-btn adm-btn-outline adm-btn-sm" style="padding:.25rem .5rem;color:#15803d;border-color:#bbf7d0;background:#f0fdf4;" title="Chat on WhatsApp">💬</a>
                <button type="button" class="btn-edit-staff adm-btn adm-btn-outline adm-btn-sm" data-id="${s.id}" style="padding:.25rem .5rem;" title="Edit Staff">✏️</button>
                <button type="button" class="btn-delete-staff adm-btn adm-btn-outline adm-btn-sm" data-id="${s.id}" style="padding:.25rem .5rem;color:#ef4444;border-color:#fecaca;" title="Delete Staff">🗑️</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  // 5. Attach Action Listeners
  document.querySelectorAll('.btn-toggle-staff-status').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const all = getStaffList();
      const target = all.find(x => String(x.id) === String(id));
      if (target) {
        const nextStatus = target.status === 'on_duty' ? 'off_duty' : 'on_duty';
        try {
          await toggleStaffStatusInDB(id, nextStatus);
          showAdminToast(`${target.name} status updated to ${nextStatus === 'on_duty' ? 'On-Duty' : 'Off-Duty'}!`, 'info');
        } catch (err) {
          showAdminToast(`Status updated locally: ${err.message}`, 'info');
        }
      }
    });
  });

  document.querySelectorAll('.btn-edit-staff').forEach(btn => {
    btn.addEventListener('click', () => {
      openStaffModal(btn.dataset.id);
    });
  });

  document.querySelectorAll('.btn-delete-staff').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const all = getStaffList();
      const target = all.find(x => String(x.id) === String(id));
      if (target && confirm(`Delete staff member "${target.name}"?`)) {
        try {
          await deleteStaffMemberFromDB(id);
          showAdminToast(`Staff member "${target.name}" deleted.`, 'success');
        } catch (err) {
          showAdminToast(`Failed to delete staff: ${err.message}`, 'error');
        }
      }
    });
  });
}

function openStaffModal(id = null) {
  staffEditingId = id;
  const modal = $('adm-staff-modal');
  if (!modal) return;

  const title = $('staff-modal-title');
  const nameInput = $('staff-modal-name');
  const roleSelect = $('staff-modal-role');
  const statusSelect = $('staff-modal-status');
  const phoneInput = $('staff-modal-phone');
  const emailInput = $('staff-modal-email');
  const shiftInput = $('staff-modal-shift');
  const notesInput = $('staff-modal-notes');

  if (id) {
    const all = getStaffList();
    const s = all.find(x => String(x.id) === String(id));
    if (s) {
      if (title) title.textContent = '✏️ Edit Staff Member';
      if (nameInput) nameInput.value = s.name || '';
      if (roleSelect) roleSelect.value = s.role || 'Store Manager';
      if (statusSelect) statusSelect.value = s.status || 'on_duty';
      if (phoneInput) phoneInput.value = s.phone || '';
      if (emailInput) emailInput.value = s.email || '';
      if (shiftInput) shiftInput.value = s.shift || '';
      if (notesInput) notesInput.value = s.notes || '';
    }
  } else {
    if (title) title.textContent = '➕ Add Staff Member';
    if (nameInput) nameInput.value = '';
    if (roleSelect) roleSelect.value = 'Store Manager';
    if (statusSelect) statusSelect.value = 'on_duty';
    if (phoneInput) phoneInput.value = '';
    if (emailInput) emailInput.value = '';
    if (shiftInput) shiftInput.value = '10:00 AM - 08:00 PM';
    if (notesInput) notesInput.value = '';
  }

  modal.classList.add('active');
}

function closeStaffModal() {
  const modal = $('adm-staff-modal');
  if (modal) modal.classList.remove('active');
  staffEditingId = null;
}

function setupStaffManagerListeners() {
  $('staff-role-filter')?.addEventListener('change', renderStaffList);
  $('staff-status-filter')?.addEventListener('change', renderStaffList);
  $('staff-search')?.addEventListener('input', renderStaffList);
  $('staff-add-btn')?.addEventListener('click', () => openStaffModal());
  $('staff-modal-close')?.addEventListener('click', closeStaffModal);
  $('staff-modal-cancel')?.addEventListener('click', closeStaffModal);

  $('adm-staff-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('staff-modal-name')?.value?.trim();
    const role = $('staff-modal-role')?.value || 'Store Manager';
    const status = $('staff-modal-status')?.value || 'on_duty';
    const phone = $('staff-modal-phone')?.value?.trim();
    const email = $('staff-modal-email')?.value?.trim();
    const shift = $('staff-modal-shift')?.value?.trim();
    const notes = $('staff-modal-notes')?.value?.trim();

    if (!name || !phone) {
      showAdminToast('Please provide both Staff Name and Phone Number.', 'error');
      return;
    }

    try {
      await saveStaffMemberToDB({
        id: staffEditingId,
        name,
        role,
        status,
        phone,
        email,
        shift,
        notes
      });
      showAdminToast(`Staff member "${name}" saved successfully! ✅`, 'success');
      closeStaffModal();
    } catch (err) {
      console.warn('[Staff Save DB Warning]:', err.message);
      // Fallback local update
      const all = getStaffList();
      if (staffEditingId) {
        const idx = all.findIndex(x => String(x.id) === String(staffEditingId));
        if (idx !== -1) {
          all[idx] = { ...all[idx], name, role, status, phone, email, shift, notes };
        }
      } else {
        all.push({ id: 'st-' + Date.now(), name, role, status, phone, email, shift, notes });
      }
      try {
        localStorage.setItem('limra_staff_members_cache', JSON.stringify(all));
      } catch (ex) {}
      renderStaffList();
      closeStaffModal();
      showAdminToast(`Staff member "${name}" saved locally: ${err.message}`, 'info');
    }
  });

  $('staff-export-csv-btn')?.addEventListener('click', exportStaffListCSV);
}

// Window exposures for Staff Manager
window.loadStaffMembersFromDB = loadStaffMembersFromDB;
window.saveStaffMemberToDB = saveStaffMemberToDB;
window.deleteStaffMemberFromDB = deleteStaffMemberFromDB;
window.toggleStaffStatusInDB = toggleStaffStatusInDB;
window.getStaffList = getStaffList;
window.renderStaffList = renderStaffList;

function exportStaffListCSV() {
  const staff = getStaffList();
  if (staff.length === 0) {
    showAdminToast('No staff members to export.', 'error');
    return;
  }

  const headers = ['Staff ID', 'Full Name', 'Role / Designation', 'Status', 'Phone Number', 'Email', 'Shift Hours', 'Operational Notes'];
  const rows = staff.map(s => [
    `"${s.id}"`,
    `"${s.name.replace(/"/g, '""')}"`,
    `"${s.role}"`,
    `"${s.status === 'on_duty' ? 'On-Duty' : 'Off-Duty'}"`,
    `"${s.phone}"`,
    `"${s.email || ''}"`,
    `"${s.shift || ''}"`,
    `"${(s.notes || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `LIMRA_Staff_Directory_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAdminToast('Staff list exported to CSV! 📥', 'success');
}

// ────────────────────────────────────────────────────────
// 💬 WHATSAPP MANAGER ENGINE
// ────────────────────────────────────────────────────────
const WA_TEMPLATES = {
  confirm: 'Hi {customer_name}! Your order #{order_number} at LIMRA Restaurant has been confirmed and is being freshly prepared with care. Total: {amount}. Thank you for choosing us!',
  delivery: 'Hi {customer_name}! Great news! Your order #{order_number} is out for delivery. Our rider is on the way. Expected ETA: 15-20 mins. Enjoy your meal!',
  review: 'Hi {customer_name}! Thank you for dining with LIMRA Restaurant! If you loved our food and service, please share a quick 5-star Google Review here: https://g.page/r/CcrqEfWap5zfEBE/review. We appreciate your support!',
  coupon: 'Special treat for you! Use promo code WELCOME10 at LIMRA Restaurant to get 10% OFF on your next order. Order live at https://limra.restaurant. See you soon!',
  table: 'Hi {customer_name}! Your table reservation at LIMRA Restaurant has been confirmed. We look forward to hosting you! Table info: Table {table_number}.',
  custom: 'Hi {customer_name}! Greetings from LIMRA Restaurant. How may we assist you today?'
};

function getWhatsAppSettings() {
  try {
    const raw = localStorage.getItem('limra_whatsapp_settings');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    businessPhone: '+91 99999 88888',
    businessName: 'LIMRA RESTAURANT',
    autoOrderConfirm: true,
    autoOutForDelivery: true,
    autoTableBill: true,
    autoReviewBooster: true,
    autoPromoCoupons: true
  };
}

function renderWhatsAppManagerUI() {
  const s = getWhatsAppSettings();
  if ($('wa-biz-phone')) $('wa-biz-phone').value = s.businessPhone || '+91 99999 88888';
  if ($('wa-biz-name')) $('wa-biz-name').value = s.businessName || 'LIMRA RESTAURANT';
  if ($('wa-auto-confirm')) $('wa-auto-confirm').checked = s.autoOrderConfirm !== false;
  if ($('wa-auto-delivery')) $('wa-auto-delivery').checked = s.autoOutForDelivery !== false;
  if ($('wa-auto-table')) $('wa-auto-table').checked = s.autoTableBill !== false;
  if ($('wa-auto-review')) $('wa-auto-review').checked = s.autoReviewBooster !== false;
  if ($('wa-auto-promo')) $('wa-auto-promo').checked = s.autoPromoCoupons !== false;

  updateWhatsAppTemplatePreview();
}

function updateWhatsAppTemplatePreview() {
  const picker = $('wa-direct-template-select');
  const textarea = $('wa-direct-msg');
  if (!picker || !textarea) return;

  const key = picker.value || 'confirm';
  let tpl = WA_TEMPLATES[key] || WA_TEMPLATES.confirm;
  tpl = tpl
    .replace('{customer_name}', 'Valued Guest')
    .replace('{order_number}', '101')
    .replace('{amount}', '₹650.00')
    .replace('{table_number}', '5');

  textarea.value = tpl;
}

function setupWhatsAppManagerListeners() {
  $('wa-direct-template-select')?.addEventListener('change', updateWhatsAppTemplatePreview);

  $('wa-save-settings-btn')?.addEventListener('click', () => {
    const updated = {
      businessPhone: $('wa-biz-phone')?.value?.trim() || '+91 99999 88888',
      businessName: $('wa-biz-name')?.value?.trim() || 'LIMRA RESTAURANT',
      autoOrderConfirm: $('wa-auto-confirm')?.checked ?? true,
      autoOutForDelivery: $('wa-auto-delivery')?.checked ?? true,
      autoTableBill: $('wa-auto-table')?.checked ?? true,
      autoReviewBooster: $('wa-auto-review')?.checked ?? true,
      autoPromoCoupons: $('wa-auto-promo')?.checked ?? true
    };
    localStorage.setItem('limra_whatsapp_settings', JSON.stringify(updated));
    showAdminToast('WhatsApp Business automation settings saved! 💬', 'success');
  });

  $('wa-send-direct-btn')?.addEventListener('click', () => {
    const phone = ($('wa-direct-phone')?.value || '').trim();
    const msg = ($('wa-direct-msg')?.value || '').trim();

    if (!phone) {
      showAdminToast('Please enter a customer phone number.', 'error');
      return;
    }
    if (!msg) {
      showAdminToast('Message cannot be empty.', 'error');
      return;
    }

    const clean = phone.replace(/\D/g, '');
    const finalPhone = clean.length === 10 ? '91' + clean : clean;
    const url = `https://wa.me/${finalPhone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
    showAdminToast('Opening WhatsApp Chat... 💬', 'info');
  });

  $('wa-copy-direct-btn')?.addEventListener('click', () => {
    const msg = ($('wa-direct-msg')?.value || '').trim();
    if (msg) {
      navigator.clipboard.writeText(msg);
      showAdminToast('Message copied to clipboard! 📋', 'success');
    }
  });
}

// ────────────────────────────────────────────────────────
// 📊 GOOGLE SHEETS SYNC ENGINE
// ────────────────────────────────────────────────────────
const DEFAULT_GOOGLE_SHEET_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyGV5EmfydSULN6aOwj-H4XslL5rMc7U1TDHOCbWyubG5H4ykc56c6BjnkR0c1YQ0wW/exec';

function getGoogleSheetWebhookUrl() {
  return (localStorage.getItem('limra_google_sheet_webhook') || DEFAULT_GOOGLE_SHEET_WEBHOOK_URL).trim();
}

function isGoogleSheetAutoSyncEnabled() {
  const val = localStorage.getItem('limra_google_sheet_autosync');
  return val === null ? true : val === 'true';
}

function setGoogleSheetWebhookUrl(url) {
  localStorage.setItem('limra_google_sheet_webhook', (url || '').trim());
}

function setGoogleSheetAutoSyncEnabled(enabled) {
  localStorage.setItem('limra_google_sheet_autosync', enabled ? 'true' : 'false');
}

function formatOrderForGoogleSheet(order) {
  const td = computeOrderTaxDetails(order);
  const parsed = parseNotesMetadata(order.notes, order);
  const rawItems = (td.items && td.items.length > 0) ? td.items : getItemsForOrder(order.id);
  const consolidated = consolidateOrderItems(rawItems);

  const formattedItems = consolidated.length > 0 ? consolidated.map(i => {
    const parsedName = parseItemNameAndNotes(i.item_name || i.name);
    const dishName = parsedName.name || i.item_name || i.name || 'Dish Item';
    const dishNotes = i.notes || parsedName.notes || '';
    return {
      name: dishNotes ? `${dishName} (${dishNotes})` : dishName,
      quantity: Number(i.quantity || i.qty || 1),
      price: Number(i.unit_price || i.price || 0),
      line_total: Number(i.line_total || (Number(i.quantity || i.qty || 1) * Number(i.unit_price || i.price || 0)))
    };
  }) : [{
    name: 'Consolidated Order',
    quantity: 1,
    price: Number(td.grandTotal || order.total_amount || 0),
    line_total: Number(td.grandTotal || order.total_amount || 0)
  }];

  return {
    id: order.id,
    order_number: formatDailyOrderNumber(order),
    created_at: order.created_at || new Date().toISOString(),
    customer_name: order.customer_name || 'Walk-in',
    customer_phone: order.customer_phone || '',
    order_type: parsed.type || order.order_type || 'table',
    table_number: parsed.tableNumber || order.table_number || '',
    subtotal: td.taxableValue || td.subtotal || 0,
    cgst: td.cgstAmt || 0,
    sgst: td.sgstAmt || 0,
    grand_total: td.grandTotal || Number(order.total_amount || 0),
    payment_mode: parsed.paymentMode || order.payment_mode || 'Cash/UPI',
    status: order.status || 'delivered',
    items: formattedItems
  };
}

async function syncOrderToGoogleSheet(order, showToast = false) {
  const webhookUrl = getGoogleSheetWebhookUrl();
  if (!webhookUrl) {
    if (showToast) showAdminToast('Google Sheets Webhook URL is not configured.', 'error');
    return false;
  }

  try {
    const payload = formatOrderForGoogleSheet(order);
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    // Update local stats
    const count = parseInt(localStorage.getItem('limra_sheet_sync_count') || '0', 10) + 1;
    localStorage.setItem('limra_sheet_sync_count', String(count));
    localStorage.setItem('limra_sheet_last_sync_time', new Date().toISOString());

    console.log(`[Google Sheet] Synced order #${payload.order_number} to Google Sheets ✅`);
    if (showToast) {
      showAdminToast(`Order #${payload.order_number} synced to Google Sheet! 📊✅`, 'success');
    }
    return true;
  } catch (err) {
    console.error('[Google Sheet] Sync error:', err);
    if (showToast) {
      showAdminToast('Google Sheet sync failed: ' + err.message, 'error');
    }
    return false;
  }
}

async function bulkSyncClosedOrdersToGoogleSheet(ordersList = null) {
  const webhookUrl = getGoogleSheetWebhookUrl();
  if (!webhookUrl) {
    showAdminToast('Please configure your Google Sheets Webhook URL in Settings first.', 'error');
    return;
  }

  const allClosed = (ordersList && ordersList.length > 0)
    ? ordersList
    : orders.filter(o => o.status === 'delivered' || o.status === 'cancelled' || o.payment_status === 'paid');
  const consolidated = getConsolidatedClosedBills(allClosed);

  if (!consolidated.length) {
    showAdminToast('No closed orders found to sync.', 'error');
    return;
  }

  showAdminToast(`Syncing ${consolidated.length} closed order(s) to Google Sheets... ⏳`, 'info');

  const payloadList = consolidated.map(formatOrderForGoogleSheet);

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payloadList)
    });

    const totalItems = payloadList.reduce((sum, o) => sum + (o.items ? o.items.length : 0), 0);
    const count = parseInt(localStorage.getItem('limra_sheet_sync_count') || '0', 10) + consolidated.length;
    localStorage.setItem('limra_sheet_sync_count', String(count));
    localStorage.setItem('limra_sheet_last_sync_time', new Date().toISOString());

    showAdminToast(`Successfully synced ${consolidated.length} orders (${totalItems} items) to Google Sheets! 📊✅`, 'success');
    if (typeof settingsSubtab !== 'undefined' && (settingsSubtab === 'sheets' || settingsSubtab === 'integrations')) renderGoogleSheetsSettingsUI();
  } catch (err) {
    console.error('[Google Sheet] Bulk sync error:', err);
    showAdminToast('Bulk Google Sheet sync failed: ' + err.message, 'error');
  }
}

async function testGoogleSheetConnection() {
  const webhookUrl = getGoogleSheetWebhookUrl();
  if (!webhookUrl) {
    showAdminToast('Please enter a valid Google Sheets Webhook URL.', 'error');
    return;
  }

  showAdminToast('Sending sample test order row to Google Sheet... 🧪', 'info');

  const testPayload = {
    id: 'test-sync-' + Date.now(),
    order_number: 'TEST-101',
    created_at: new Date().toISOString(),
    customer_name: 'Test Customer (Salim)',
    customer_phone: '+91 9988776655',
    order_type: 'dine_in',
    table_number: 'T-01',
    subtotal: 350.00,
    cgst: 8.75,
    sgst: 8.75,
    grand_total: 367.50,
    payment_mode: 'UPI (GPay)',
    status: 'closed',
    items: [
      { name: 'Mutton Biryani (Special)', quantity: 1, price: 250.00, line_total: 250.00 },
      { name: 'Butter Naan', quantity: 2, price: 50.00, line_total: 100.00 }
    ]
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(testPayload)
    });

    localStorage.setItem('limra_sheet_last_sync_time', new Date().toISOString());
    showAdminToast('Connection test sent! Please check your Google Sheet for the test row. 📊🎉', 'success');
    if (typeof settingsSubtab !== 'undefined' && (settingsSubtab === 'sheets' || settingsSubtab === 'integrations')) renderGoogleSheetsSettingsUI();
  } catch (err) {
    console.error('[Google Sheet] Test error:', err);
    showAdminToast('Connection test failed: ' + err.message, 'error');
  }
}

function renderGoogleSheetsSettingsUI() {
  const container = document.getElementById('settings-subtab-sheets');
  if (!container) return;

  const currentUrl = getGoogleSheetWebhookUrl();
  const isAutoSync = isGoogleSheetAutoSyncEnabled();
  const syncCount = localStorage.getItem('limra_sheet_sync_count') || '0';
  const lastSyncTime = localStorage.getItem('limra_sheet_last_sync_time');
  const formattedLastSync = lastSyncTime ? new Date(lastSyncTime).toLocaleString('en-IN') : 'Never';

  container.innerHTML = `
    <!-- Top KPI Cards -->
    <div class="adm-stats" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));margin-bottom:1.25rem;">
      <div class="adm-stat" style="border-left:4px solid #0284c7;">
        <div>
          <p class="adm-stat-label">Integration Status</p>
          <p class="adm-stat-value" style="color:#0284c7;font-size:1.25rem;">🟢 Active</p>
          <p style="font-size:0.75rem;color:var(--adm-muted);margin-top:2px;">Google Apps Script Webhook</p>
        </div>
        <div class="adm-stat-icon blue" style="background:#e0f2fe;color:#0284c7;">
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        </div>
      </div>

      <div class="adm-stat" style="border-left:4px solid #10b981;">
        <div>
          <p class="adm-stat-label">Auto-Sync Mode</p>
          <p class="adm-stat-value" style="color:#059669;font-size:1.25rem;">${isAutoSync ? '⚡ Real-Time' : '⏸️ Manual Only'}</p>
          <p style="font-size:0.75rem;color:var(--adm-muted);margin-top:2px;">Triggered on Bill Settlement</p>
        </div>
        <div class="adm-stat-icon green">
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        </div>
      </div>

      <div class="adm-stat" style="border-left:4px solid #6366f1;">
        <div>
          <p class="adm-stat-label">Total Orders Synced</p>
          <p class="adm-stat-value" style="color:#4f46e5;font-size:1.25rem;">${syncCount} Orders</p>
          <p style="font-size:0.75rem;color:var(--adm-muted);margin-top:2px;">Item-by-item logged</p>
        </div>
        <div class="adm-stat-icon indigo" style="background:#eef2ff;color:#6366f1;">
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3zm0 4h16M9 4v16"/></svg>
        </div>
      </div>

      <div class="adm-stat" style="border-left:4px solid #f59e0b;">
        <div>
          <p class="adm-stat-label">Last Sync</p>
          <p class="adm-stat-value" style="color:#d97706;font-size:1.05rem;line-height:1.4;">${formattedLastSync}</p>
          <p style="font-size:0.75rem;color:var(--adm-muted);margin-top:2px;">Cloud timestamp</p>
        </div>
        <div class="adm-stat-icon orange">
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
      </div>
    </div>

    <!-- Main Config Card -->
    <div style="background:#fff;border:1px solid var(--adm-border);border-radius:12px;padding:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.04);margin-bottom:1.5rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-bottom:1.25rem;border-bottom:1px solid var(--adm-border);padding-bottom:1rem;">
        <div>
          <h3 style="margin:0;font-size:1.1rem;font-weight:800;color:var(--adm-text);display:flex;align-items:center;gap:.5rem;">
            <span>📊</span> Google Sheets Real-Time Sync Configuration
          </h3>
          <p style="margin:4px 0 0 0;font-size:.82rem;color:var(--adm-muted);">
            Connect your Google Sheet Web App to automatically store closed tables, settled bills, and each item sold.
          </p>
        </div>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
          <button type="button" id="gsheets-test-btn" class="adm-btn adm-btn-outline" style="font-weight:700;display:inline-flex;align-items:center;gap:.35rem;">
            🧪 Test Connection
          </button>
          <button type="button" id="gsheets-menu-sync-btn" class="adm-btn adm-btn-outline" style="background:#fefce8;border-color:#facc15;color:#ca8a04;font-weight:700;display:inline-flex;align-items:center;gap:.35rem;" title="Sync food menu dishes, categories and pricing">
            🍽️ Sync Food Menu
          </button>
          <button type="button" id="gsheets-cust-sync-btn" class="adm-btn adm-btn-outline" style="background:#fdf2f8;border-color:#f472b6;color:#db2777;font-weight:700;display:inline-flex;align-items:center;gap:.35rem;" title="Sync customer spending habits & loyalty rankings">
            👥 Sync Customer Analysis
          </button>
          <button type="button" id="gsheets-bulk-sync-btn" class="adm-btn adm-btn-primary" style="background:#0284c7;border-color:#0284c7;font-weight:700;display:inline-flex;align-items:center;gap:.35rem;">
            📥 Sync All Closed Orders Now
          </button>
        </div>
      </div>

      <form id="gsheets-config-form" style="display:flex;flex-direction:column;gap:1.25rem;">
        <div>
          <label style="display:block;font-weight:700;font-size:.85rem;margin-bottom:.4rem;color:#1e293b;">
            Google Apps Script Web App URL <span style="color:#ef4444;">*</span>
          </label>
          <div style="display:flex;gap:.5rem;">
            <input 
              type="url" 
              id="gsheets-webhook-url" 
              class="adm-input" 
              value="${escapeHtml(currentUrl)}" 
              placeholder="https://script.google.com/macros/s/.../exec" 
              style="flex:1;font-family:monospace;font-size:.82rem;" 
              required 
            />
            <button type="button" id="gsheets-reset-url-btn" class="adm-btn adm-btn-outline" title="Reset to default URL" style="font-size:.8rem;white-space:nowrap;">
              ↺ Default
            </button>
          </div>
          <p style="font-size:.75rem;color:var(--adm-muted);margin-top:4px;">
            Webhook receiver deployed from Google Sheets ➔ Extensions ➔ Apps Script (Execute as: Me, Access: Anyone).
          </p>
        </div>

        <div style="display:flex;align-items:center;gap:.75rem;background:#f8fafc;padding:.85rem 1rem;border-radius:8px;border:1px solid #e2e8f0;">
          <input 
            type="checkbox" 
            id="gsheets-autosync-toggle" 
            style="width:18px;height:18px;accent-color:#0284c7;cursor:pointer;" 
            ${isAutoSync ? 'checked' : ''} 
          />
          <div>
            <label for="gsheets-autosync-toggle" style="font-weight:700;font-size:.85rem;color:#1e293b;cursor:pointer;display:block;">
              ⚡ Enable Real-Time Auto-Sync on Bill Settlement
            </label>
            <p style="margin:2px 0 0 0;font-size:.75rem;color:var(--adm-muted);">
              When enabled, every closed table, settled POS bill, or delivered order will immediately write its item-by-item data to Google Sheets.
            </p>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:.75rem;">
          <button type="submit" class="adm-btn adm-btn-primary" style="background:#10b981;border-color:#10b981;font-weight:700;">
            💾 Save Google Sheets Settings
          </button>
        </div>
      </form>
    </div>

    <!-- Information & Column Schema Box -->
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:1.25rem;color:#0369a1;font-size:.85rem;">
      <h4 style="margin:0 0 .5rem 0;font-weight:800;display:flex;align-items:center;gap:.4rem;">
        ℹ️ 4-in-1 Google Spreadsheet Architecture
      </h4>
      <p style="margin:0 0 .75rem 0;font-size:.8rem;color:#0284c7;">
        Your Google Spreadsheet contains 4 dedicated tabs automatically created and populated:
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:.65rem;font-size:.78rem;">
        <div style="background:#fff;padding:.75rem;border-radius:8px;border:1px solid #e0f2fe;">
          <strong style="color:#0369a1;display:block;margin-bottom:3px;">🧾 Tab 1: Closed Orders</strong>
          Real-time log of every closed bill, tax breakdown, and dish sold.
        </div>
        <div style="background:#fff;padding:.75rem;border-radius:8px;border:1px solid #e0f2fe;">
          <strong style="color:#059669;display:block;margin-bottom:3px;">📦 Tab 2: Stock</strong>
          138 warehouse items, balance stock quantities, alerts, and valuation.
        </div>
        <div style="background:#fff;padding:.75rem;border-radius:8px;border:1px solid #e0f2fe;">
          <strong style="color:#db2777;display:block;margin-bottom:3px;">👥 Tab 3: Customer Analysis</strong>
          Customer spending (LTV), order frequency, top dishes, and VIP tiers.
        </div>
        <div style="background:#fff;padding:.75rem;border-radius:8px;border:1px solid #e0f2fe;">
          <strong style="color:#ca8a04;display:block;margin-bottom:3px;">🍽️ Tab 4: Food Menu & Pricing</strong>
          202+ food dishes, combos, categories, active pricing, and diet types.
        </div>
      </div>
    </div>
  `;

  // Attach event listeners inside the sheets pane
  $('gsheets-config-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('gsheets-webhook-url')?.value;
    const auto = $('gsheets-autosync-toggle')?.checked;
    setGoogleSheetWebhookUrl(url);
    setGoogleSheetAutoSyncEnabled(auto);
    showAdminToast('Google Sheets settings saved successfully! 💾✅', 'success');
    renderGoogleSheetsSettingsUI();
  });

  $('gsheets-reset-url-btn')?.addEventListener('click', () => {
    if ($('gsheets-webhook-url')) $('gsheets-webhook-url').value = DEFAULT_GOOGLE_SHEET_WEBHOOK_URL;
  });

  $('gsheets-test-btn')?.addEventListener('click', testGoogleSheetConnection);
  $('gsheets-menu-sync-btn')?.addEventListener('click', () => syncFoodMenuToGoogleSheet());
  $('gsheets-cust-sync-btn')?.addEventListener('click', () => syncCustomerAnalysisToGoogleSheet());
  $('gsheets-bulk-sync-btn')?.addEventListener('click', () => bulkSyncClosedOrdersToGoogleSheet());
}

async function syncFoodMenuToGoogleSheet() {
  const webhookUrl = getGoogleSheetWebhookUrl();
  if (!webhookUrl) {
    showAdminToast('Please configure your Google Sheets Webhook URL first.', 'error');
    return;
  }

  showAdminToast('Gathering 202+ food menu dishes & pricing... ⏳', 'info');

  try {
    const allItems = (typeof getCombinedFoodItems === 'function') ? getCombinedFoodItems() : menuItems;

    const formattedList = allItems.map(item => {
      const isVeg = item.is_veg || item.diet === 'veg' || (item.category?.includes('veg') && !item.category?.includes('nonveg'));
      const catLabel = categoryLabels[item.category] || (item.isCombo ? 'Combos & Deals' : item.category) || 'General';

      return {
        id: item.id,
        name: item.name,
        category: item.category,
        categoryName: catLabel,
        price: Number(item.price || 0),
        mrp: item.mrp ? Number(item.mrp) : Number(item.price || 0),
        isVeg: Boolean(isVeg),
        available: item.available !== false,
        featured: item.featured === true,
        description: item.description || ''
      };
    });

    const payload = {
      type: 'food_menu',
      action: 'food_menu',
      items: formattedList
    };

    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    showAdminToast(`Successfully synced ${formattedList.length} menu items to "Food Menu & Pricing" tab! 🍽️📊✅`, 'success');
  } catch (err) {
    console.error('[Google Sheet] Food menu sync error:', err);
    showAdminToast('Failed to sync food menu: ' + err.message, 'error');
  }
}

async function syncCustomerAnalysisToGoogleSheet() {
  const webhookUrl = getGoogleSheetWebhookUrl();
  if (!webhookUrl) {
    showAdminToast('Please configure your Google Sheets Webhook URL first.', 'error');
    return;
  }

  showAdminToast('Analyzing customer order histories & metrics... ⏳', 'info');

  try {
    const customerMap = new Map();

    orders.forEach(o => {
      const phone = String(o.customer_phone || '').replace(/\D/g, '').slice(-10);
      const name = (o.customer_name || '').trim();
      if (!phone && !name) return;
      const key = phone || name.toLowerCase();

      if (!customerMap.has(key)) {
        customerMap.set(key, {
          phone: phone ? '+91 ' + phone : 'N/A',
          name: (name && name !== 'Walk-in') ? name : 'Walk-in Guest',
          totalOrders: 0,
          totalSpend: 0,
          firstOrderDate: o.created_at,
          lastOrderDate: o.created_at,
          orderTypes: {},
          itemCounts: {}
        });
      }

      const c = customerMap.get(key);
      if (name && name !== 'Walk-in' && (!c.name || c.name === 'Walk-in Guest')) {
        c.name = name;
      }
      const amt = Number(o.total_amount || 0);
      const isCompleted = o.status === 'delivered' || o.payment_status === 'paid' || o.status === 'confirmed';

      c.totalOrders++;
      if (isCompleted) {
        c.totalSpend += amt;
      }

      const oDate = new Date(o.created_at || Date.now());
      if (new Date(c.firstOrderDate) > oDate) c.firstOrderDate = o.created_at;
      if (new Date(c.lastOrderDate) < oDate) c.lastOrderDate = o.created_at;

      const type = o.order_type || 'table';
      c.orderTypes[type] = (c.orderTypes[type] || 0) + 1;

      const oItems = getItemsForOrder(o.id) || [];
      oItems.forEach(it => {
        const iName = (it.item_name || it.name || '').replace(/\[Note:.*?\]/g, '').trim();
        if (iName) {
          c.itemCounts[iName] = (c.itemCounts[iName] || 0) + Number(it.quantity || it.qty || 1);
        }
      });
    });

    const customerList = Array.from(customerMap.values()).map(c => {
      const aov = c.totalOrders > 0 ? (c.totalSpend / c.totalOrders) : 0;
      const topItems = Object.entries(c.itemCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, qty]) => `${name} (${qty})`)
        .join(', ');

      const prefChannel = Object.entries(c.orderTypes)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'dine_in';

      const daysSinceLast = Math.max(0, Math.floor((Date.now() - new Date(c.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24)));
      let segment = 'New Customer 🌟';
      if (c.totalOrders >= 5 || c.totalSpend >= 2000) segment = 'VIP Customer 👑';
      else if (c.totalOrders >= 2) segment = 'Regular Customer 💎';
      else if (daysSinceLast > 30) segment = 'At-Risk ⚠️';

      return {
        name: c.name,
        phone: c.phone,
        totalOrders: c.totalOrders,
        totalSpend: c.totalSpend,
        aov: aov,
        topItems: topItems || 'Assorted Dishes',
        prefChannel: prefChannel === 'table' ? 'Dine-In' : (prefChannel === 'delivery' ? 'Delivery' : 'Takeaway'),
        segment,
        firstOrderDate: c.firstOrderDate,
        lastOrderDate: c.lastOrderDate,
        daysSinceLast,
        status: daysSinceLast <= 30 ? 'Active' : 'Dormant'
      };
    });

    // Sort by highest spend first
    customerList.sort((a, b) => Number(b.totalSpend) - Number(a.totalSpend));

    const payload = {
      type: 'customer_analysis',
      action: 'customer_analysis',
      customers: customerList
    };

    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    showAdminToast(`Successfully synced ${customerList.length} customer profiles to "Customer Analysis" tab! 👥📊✅`, 'success');
  } catch (err) {
    console.error('[Google Sheet] Customer analysis sync error:', err);
    showAdminToast('Failed to sync Customer Analysis: ' + err.message, 'error');
  }
}

// ── Domain Re-exports (Extracted ES Modules) ─────────────────────────
export {
  notifiedBusinessOrderIds,
  cashierCreatedOrderIds,
  warmUpAudio,
  playNotificationChime,
  playTableRoundChime,
  showAdminToast,
  showBusinessNotification,
  showDashboardToast,
  posState,
  posEvents,
  posDomainKds,
  posDomainReportsGst,
  posDomainPrinter,
  posDomainCatalogCrm,
  posDomainSettingsStaff,
  posDomainWorkstation,
  posDomainTablesBilling,
  posUtils
};

if (typeof window !== 'undefined') {
  window.posState = posState;
  window.posEvents = posEvents;
  window.posDomain = {
    state: posState,
    events: posEvents,
    utils: posUtils,
    audioAlerts: {
      notifiedBusinessOrderIds,
      cashierCreatedOrderIds,
      warmUpAudio,
      playNotificationChime,
      playTableRoundChime,
      showAdminToast,
      showBusinessNotification,
      showDashboardToast
    },
    kds: posDomainKds,
    reportsGst: posDomainReportsGst,
    printer: posDomainPrinter,
    catalogCrm: posDomainCatalogCrm,
    settingsStaff: posDomainSettingsStaff,
    workstation: posDomainWorkstation,
    tablesBilling: posDomainTablesBilling
  };
}




