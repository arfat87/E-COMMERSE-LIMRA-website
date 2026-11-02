/**
 * LIMRA RESTAURANT — NOTIFICATION SYSTEM OPTIMIZATION TEST SUITE (SUITE 18)
 * 
 * Verifies:
 * 1. Routine Workstation Silence:
 *    - Cart operations (add item, edit item, change qty, remove item) happen silently.
 *    - Routine navigation (category select, food grid filter, table select) produce NO toasts.
 *    - Routine synchronization (sync button, refresh button, background poll) produce NO toasts.
 * 2. ONLY TWO Proactive Business Notification Types:
 *    - Type 1: NEW WEBSITE ORDER RECEIVED
 *      - Source: Website (Delivery / Takeaway)
 *      - Order Number (#ORD-xxxx), Customer Name, Order Type, Total Amount (₹xxx)
 *      - Clearly identifiable with click-to-open order action
 *      - Strictly deduplicated
 *    - Type 2: NEW TABLE QR ORDER RECEIVED
 *      - Source: Table QR
 *      - Table Number (Table xx), Order Number (#ORD-xxxx), Items Count, Total Amount (₹xxx)
 *      - Clearly identifiable with click-to-open table/order action
 *      - Strictly deduplicated
 * 3. Cashier-Created POS Order Suppression:
 *    - Internal orders punched at the POS workstation are tagged in cashierCreatedOrderIds.
 *    - Cashier NEVER receives self-notifications for their own punched orders.
 * 4. Order Updates & Sync Event Suppression:
 *    - Status changes, payment updates, and sync heartbeats NEVER fire new-order notifications.
 * 5. Startup & Reconnect Deduplication Protection:
 *    - First load / page refresh loads existing orders silently with ZERO notification popups.
 *    - Realtime reconnect or polling heartbeat produces zero duplicate notifications.
 * 6. Critical Error & Validation Alert Preservation:
 *    - Genuine validation errors and operational warnings continue to display reliably.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertTestEnvironment } from './test-env-guard.mjs';

// MANDATORY STEP 0: Verify testing security
assertTestEnvironment({ runnerName: 'Notification System Test Suite' });

/**
 * Headless Simulation Environment for Admin POS Notification System
 */
class HeadlessPosNotificationEngine {
  constructor() {
    this.toasts = [];
    this.businessNotifs = [];
    this.audioEvents = [];
    this.modalPrompts = [];
    this.navigationEvents = [];

    this.knownNotificationIds = new Set();
    this.knownOrderIds = new Set();
    this.notifiedBusinessOrderIds = new Set();
    this.cashierCreatedOrderIds = new Set();

    this.orders = [];
    this.orderItems = [];
    this.posCart = [];
  }

  showAdminToast(message, type = 'error') {
    // STRICT POS POLICY: Routine operations happen silently.
    if (type !== 'error' && type !== 'warning' && type !== 'critical' && type !== 'danger') {
      return null;
    }
    const toast = { id: `toast-${Date.now()}-${Math.random()}`, message, type };
    this.toasts.push(toast);
    return toast;
  }

  showBusinessNotification(payload) {
    if (!payload || !payload.type) return null;
    const notif = {
      id: `notif-${Date.now()}-${Math.random()}`,
      ...payload,
      created_at: new Date().toISOString()
    };
    this.businessNotifs.push(notif);
    return notif;
  }

  playChime(type, details = {}) {
    this.audioEvents.push({ type, details, timestamp: Date.now() });
  }

  triggerIncomingOrderPrompt(order) {
    this.modalPrompts.push(order);
  }

  formatDailyOrderNumber(order) {
    if (!order) return '0000';
    if (order.order_number) return String(order.order_number).padStart(4, '0');
    return String(order.id || '0000').slice(-4);
  }

  parseNotesMetadata(notes, order = null) {
    const str = String(notes || '');
    const isTable = str.includes('[TABLE:') || (order && (order.order_type === 'table' || order.table_number));
    const isDelivery = str.includes('[DELIVERY]') || (order && order.order_type === 'delivery');
    const isPickup = str.includes('[SELF PICKUP]') || (order && order.order_type === 'pickup');

    let tableNum = null;
    if (order && order.table_number) {
      tableNum = String(order.table_number);
    } else {
      const match = str.match(/\[TABLE:\s*([^\]]+)\]/i);
      if (match) tableNum = match[1].trim();
    }

    return {
      type: isTable ? 'table' : (isDelivery ? 'delivery' : (isPickup ? 'pickup' : 'takeaway')),
      tableNumber: tableNum,
      isTable
    };
  }

  processNotificationsAndAlerts(incomingNotifs, currentAllOrders, newlyArrivedOrders, isFirstLoad) {
    // 1. Initial Load Protection
    if (isFirstLoad) {
      (currentAllOrders || []).forEach(o => {
        if (o && o.id) {
          this.knownOrderIds.add(String(o.id));
          this.notifiedBusinessOrderIds.add(String(o.id));
        }
        if (o && o.order_number) {
          this.notifiedBusinessOrderIds.add(String(o.order_number));
        }
      });
      (incomingNotifs || []).forEach(n => {
        if (n && n.id) this.knownNotificationIds.add(String(n.id));
      });
      return;
    }

    // 2. Mark incoming notification IDs
    (incomingNotifs || []).forEach(n => {
      if (n && n.id) this.knownNotificationIds.add(String(n.id));
    });

    // 3. Collect new candidate orders
    const candidates = [];
    const candidateIds = new Set();

    const addCandidate = (order) => {
      if (!order || !order.id) return;
      const strId = String(order.id);
      if (candidateIds.has(strId)) return;
      if (this.cashierCreatedOrderIds.has(strId)) return; // Cashier order -> SUPPRESS
      if (this.notifiedBusinessOrderIds.has(strId)) return; // Already notified -> SUPPRESS

      if (
        order.status === 'delivered' ||
        order.status === 'completed' ||
        order.status === 'closed' ||
        order.status === 'cancelled'
      ) {
        this.notifiedBusinessOrderIds.add(strId);
        return;
      }

      candidateIds.add(strId);
      candidates.push(order);
    };

    (incomingNotifs || []).forEach(n => {
      if (!n.is_read && n.type === 'order') {
        const targetOrderId = n.item_id || n.order_id;
        if (targetOrderId) {
          const order = (currentAllOrders || []).find(o => String(o.id) === String(targetOrderId));
          if (order) addCandidate(order);
        }
      }
    });

    (newlyArrivedOrders || []).forEach(order => {
      addCandidate(order);
    });

    if (candidates.length === 0) return;

    candidates.forEach(order => {
      const strId = String(order.id);
      if (this.notifiedBusinessOrderIds.has(strId)) return;
      this.notifiedBusinessOrderIds.add(strId);
      this.knownOrderIds.add(strId);

      const meta = this.parseNotesMetadata(order.notes, order);
      const isTable = order.order_type === 'table' || meta.type === 'table' || Boolean(order.table_number || meta.tableNumber);
      const tableNum = order.table_number || meta.tableNumber || '—';

      if (isTable) {
        // TYPE 2: TABLE QR
        const itemsList = this.orderItems.filter(i => String(i.order_id) === strId);
        const itemsCount = itemsList.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0) || 1;
        const orderNum = `#ORD-${this.formatDailyOrderNumber(order)}`;

        this.showBusinessNotification({
          type: 'table_qr',
          orderId: order.id,
          orderNumber: orderNum,
          tableNumber: `Table ${tableNum}`,
          itemCount: itemsCount,
          amount: Number(order.total_amount || 0),
          order
        });
        this.playChime('table_qr', { tableNum });
      } else {
        // TYPE 1: WEBSITE ORDER
        const orderNum = `#ORD-${this.formatDailyOrderNumber(order)}`;
        const customerName = order.customer_name || 'Online Customer';
        const orderTypeStr = (meta.type === 'delivery' || order.order_type === 'delivery') ? 'Delivery' : 'Takeaway';

        this.showBusinessNotification({
          type: 'website',
          orderId: order.id,
          orderNumber: orderNum,
          customerName: customerName,
          orderType: orderTypeStr,
          amount: Number(order.total_amount || 0),
          order
        });
        this.playChime('website', { customerName, orderType: orderTypeStr });

        if (order.status === 'pending') {
          this.triggerIncomingOrderPrompt(order);
        }
      }
    });
  }

  // Cashier POS Actions
  addItemToPosCart(food) {
    const existing = this.posCart.find(i => i.name === food.name);
    if (existing) {
      existing.qty += (food.qty || 1);
    } else {
      this.posCart.push({ name: food.name, price: food.price, qty: food.qty || 1 });
    }
    // SILENT: No showAdminToast call
  }

  posChangeQty(index, delta) {
    if (!this.posCart[index]) return;
    this.posCart[index].qty += delta;
    if (this.posCart[index].qty <= 0) {
      this.posCart.splice(index, 1);
    }
    // SILENT: No showAdminToast call
  }

  posRemoveItem(index) {
    if (!this.posCart[index]) return;
    this.posCart.splice(index, 1);
    // SILENT: No showAdminToast call
  }

  cashierCreateOrder(orderData) {
    const id = `pos-ord-${Date.now()}`;
    const newOrder = {
      id,
      ...orderData,
      status: 'confirmed',
      payment_status: 'unpaid'
    };
    // Mark as created by cashier sitting at POS
    this.cashierCreatedOrderIds.add(String(newOrder.id));
    this.notifiedBusinessOrderIds.add(String(newOrder.id));
    this.orders.unshift(newOrder);
    return newOrder;
  }
}

describe('SUITE 18: LIMRA POS Notification System Optimization & Strict Event Filtering', () => {
  let engine;

  beforeEach(() => {
    engine = new HeadlessPosNotificationEngine();
  });

  describe('Section 1: Silent Routine Operations & Suppressed Workstation Noise', () => {
    it('1.1 Adding an item to the POS cart happens silently without toast or notification', () => {
      engine.addItemToPosCart({ name: 'Chicken Biryani', price: 280, qty: 1 });
      assert.equal(engine.posCart.length, 1);
      assert.equal(engine.toasts.length, 0, 'No toast should appear on cart add');
      assert.equal(engine.businessNotifs.length, 0, 'No business notification should appear');
    });

    it('1.2 Changing item quantity or editing an item happens silently', () => {
      engine.addItemToPosCart({ name: 'Mutton Kebab', price: 340, qty: 1 });
      engine.posChangeQty(0, 1);
      assert.equal(engine.posCart[0].qty, 2);
      assert.equal(engine.toasts.length, 0, 'No toast should appear on qty increase');

      engine.posChangeQty(0, -1);
      assert.equal(engine.posCart[0].qty, 1);
      assert.equal(engine.toasts.length, 0, 'No toast should appear on qty decrease');
    });

    it('1.3 Removing an item from cart happens silently', () => {
      engine.addItemToPosCart({ name: 'Butter Naan', price: 60, qty: 2 });
      engine.posRemoveItem(0);
      assert.equal(engine.posCart.length, 0);
      assert.equal(engine.toasts.length, 0, 'No toast should appear on item removal');
    });

    it('1.4 Routine data refresh, category selection, and sync events produce NO toasts', () => {
      const res1 = engine.showAdminToast('Menu & Categories refreshed! 🔄', 'info');
      const res2 = engine.showAdminToast('Tables refreshed 🔄', 'info');
      const res3 = engine.showAdminToast('Bills refreshed ✅', 'info');
      const res4 = engine.showAdminToast('Data refreshed and synchronized! 🔄', 'success');

      assert.equal(res1, null);
      assert.equal(res2, null);
      assert.equal(res3, null);
      assert.equal(res4, null);
      assert.equal(engine.toasts.length, 0, 'Routine success/info toasts must be strictly filtered');
    });
  });

  describe('Section 2: Proactive Business Notification — TYPE 1: NEW WEBSITE ORDER RECEIVED', () => {
    it('2.1 Triggers exactly ONE notification when an online website delivery order arrives', () => {
      const websiteOrder = {
        id: 'ord-web-101',
        order_number: 101,
        customer_name: 'Rahul Sharma',
        customer_phone: '9876543210',
        order_type: 'delivery',
        total_amount: 850,
        status: 'pending',
        payment_status: 'unpaid',
        notes: '[DELIVERY] Place: Limra Circle | Address: Flat 402'
      };

      engine.processNotificationsAndAlerts([], [websiteOrder], [websiteOrder], false);

      assert.equal(engine.businessNotifs.length, 1, 'Exactly one notification should trigger');
      const notif = engine.businessNotifs[0];
      assert.equal(notif.type, 'website');
      assert.equal(notif.orderNumber, '#ORD-0101');
      assert.equal(notif.customerName, 'Rahul Sharma');
      assert.equal(notif.orderType, 'Delivery');
      assert.equal(notif.amount, 850);
      assert.equal(engine.audioEvents.length, 1);
      assert.equal(engine.audioEvents[0].type, 'website');
      assert.equal(engine.modalPrompts.length, 1, 'Incoming order modal prompt triggered for pending website order');
    });

    it('2.2 Triggers exactly ONE notification when an online takeaway/pickup order arrives', () => {
      const websitePickupOrder = {
        id: 'ord-web-102',
        order_number: 102,
        customer_name: 'Fatima Khan',
        customer_phone: '9876500000',
        order_type: 'pickup',
        total_amount: 520,
        status: 'pending',
        payment_status: 'paid',
        notes: '[SELF PICKUP]'
      };

      engine.processNotificationsAndAlerts([], [websitePickupOrder], [websitePickupOrder], false);

      assert.equal(engine.businessNotifs.length, 1);
      const notif = engine.businessNotifs[0];
      assert.equal(notif.type, 'website');
      assert.equal(notif.customerName, 'Fatima Khan');
      assert.equal(notif.orderType, 'Takeaway');
      assert.equal(notif.amount, 520);
    });

    it('2.3 Reconnect, polling heartbeat, or sync does NOT duplicate the website notification', () => {
      const websiteOrder = {
        id: 'ord-web-103',
        order_number: 103,
        customer_name: 'Amit Patel',
        order_type: 'delivery',
        total_amount: 1100,
        status: 'pending'
      };

      // First arrival
      engine.processNotificationsAndAlerts([], [websiteOrder], [websiteOrder], false);
      assert.equal(engine.businessNotifs.length, 1);

      // Subsequent polling heartbeat (simulated delta sync)
      engine.processNotificationsAndAlerts([], [websiteOrder], [websiteOrder], false);
      assert.equal(engine.businessNotifs.length, 1, 'Duplicate delta sync must NOT fire second notification');

      // Subsequent realtime reconnect event
      engine.processNotificationsAndAlerts(
        [{ id: 'notif-1', is_read: false, type: 'order', order_id: 'ord-web-103' }],
        [websiteOrder],
        [],
        false
      );
      assert.equal(engine.businessNotifs.length, 1, 'Notification table event must NOT duplicate already notified order');
    });
  });

  describe('Section 3: Proactive Business Notification — TYPE 2: NEW TABLE QR ORDER RECEIVED', () => {
    it('3.1 Triggers exactly ONE notification when a diner places a Table QR order', () => {
      const tableOrder = {
        id: 'ord-table-201',
        order_number: 201,
        table_number: 5,
        order_type: 'table',
        total_amount: 640,
        status: 'pending',
        payment_status: 'unpaid',
        notes: '[TABLE: 5]'
      };

      engine.orderItems = [
        { order_id: 'ord-table-201', item_name: 'Chicken Roll', quantity: 2 },
        { order_id: 'ord-table-201', item_name: 'Cold Coffee', quantity: 1 }
      ];

      engine.processNotificationsAndAlerts([], [tableOrder], [tableOrder], false);

      assert.equal(engine.businessNotifs.length, 1);
      const notif = engine.businessNotifs[0];
      assert.equal(notif.type, 'table_qr');
      assert.equal(notif.tableNumber, 'Table 5');
      assert.equal(notif.orderNumber, '#ORD-0201');
      assert.equal(notif.itemCount, 3, 'Items count should be sum of quantities: 2 + 1 = 3');
      assert.equal(notif.amount, 640);
      assert.equal(engine.audioEvents.length, 1);
      assert.equal(engine.audioEvents[0].type, 'table_qr');
    });

    it('3.2 Reconnect, polling heartbeat, or sync does NOT duplicate the table notification', () => {
      const tableOrder = {
        id: 'ord-table-202',
        order_number: 202,
        table_number: 12,
        order_type: 'table',
        total_amount: 450,
        status: 'pending'
      };

      engine.orderItems = [{ order_id: 'ord-table-202', item_name: 'Biryani', quantity: 1 }];

      // Arrival
      engine.processNotificationsAndAlerts([], [tableOrder], [tableOrder], false);
      assert.equal(engine.businessNotifs.length, 1);

      // Reconnect
      engine.processNotificationsAndAlerts([], [tableOrder], [tableOrder], false);
      assert.equal(engine.businessNotifs.length, 1, 'Must strictly deduplicate on reconnect');
    });
  });

  describe('Section 4: Cashier-Created POS Order Suppression', () => {
    it('4.1 Orders entered by the cashier sitting at the POS workstation NEVER generate self-notifications', () => {
      const cashierOrder = engine.cashierCreateOrder({
        customer_name: 'Counter Walk-in',
        order_type: 'pickup',
        total_amount: 320
      });

      // Delta sync or Realtime fires with this order
      engine.processNotificationsAndAlerts([], [cashierOrder], [cashierOrder], false);

      assert.equal(engine.businessNotifs.length, 0, 'Cashier created orders must NOT notify');
      assert.equal(engine.audioEvents.length, 0, 'Cashier created orders must NOT trigger audio chimes');
    });

    it('4.2 Dine-in table orders placed by cashier at the POS do NOT trigger Table QR notifications', () => {
      const cashierTableOrder = engine.cashierCreateOrder({
        table_number: 8,
        order_type: 'table',
        total_amount: 980,
        notes: '[TABLE: 8]'
      });

      engine.processNotificationsAndAlerts([], [cashierTableOrder], [cashierTableOrder], false);

      assert.equal(engine.businessNotifs.length, 0, 'Cashier table order must NOT trigger Table QR notification');
    });
  });

  describe('Section 5: Order Updates, Payment Settlements & Sync Event Suppression', () => {
    it('5.1 Order status changes (pending -> confirmed -> delivered) do NOT trigger new-order notifications', () => {
      const order = {
        id: 'ord-lifecycle-301',
        order_number: 301,
        customer_name: 'Test Customer',
        order_type: 'delivery',
        total_amount: 700,
        status: 'pending'
      };

      // Initial arrival
      engine.processNotificationsAndAlerts([], [order], [order], false);
      assert.equal(engine.businessNotifs.length, 1);

      // Order status updated to confirmed
      order.status = 'confirmed';
      order.updated_at = new Date().toISOString();
      engine.processNotificationsAndAlerts([], [order], [order], false);
      assert.equal(engine.businessNotifs.length, 1, 'Status update to confirmed must NOT notify');

      // Order status updated to delivered
      order.status = 'delivered';
      order.payment_status = 'paid';
      engine.processNotificationsAndAlerts([], [order], [order], false);
      assert.equal(engine.businessNotifs.length, 1, 'Status update to delivered must NOT notify');
    });

    it('5.2 Booking notifications and status change notifications do NOT trigger popups', () => {
      const mockNotifs = [
        { id: 'bkg-1', type: 'booking', title: 'New Booking Enquiry', message: 'Table for 4', is_read: false },
        { id: 'stat-1', type: 'order_status', title: 'Order Status Changed', message: 'Kitchen started', is_read: false }
      ];

      engine.processNotificationsAndAlerts(mockNotifs, [], [], false);

      assert.equal(engine.businessNotifs.length, 0, 'Booking & order_status must NOT generate popup notifications');
    });
  });

  describe('Section 6: Startup & Refresh Protection (Zero Historical Notifications)', () => {
    it('6.1 When POS starts or refreshes (isFirstLoad = true), historical orders produce ZERO notifications', () => {
      const existingOrders = [
        { id: 'ord-hist-1', order_number: 1, customer_name: 'Old Cust 1', status: 'pending', total_amount: 400 },
        { id: 'ord-hist-2', order_number: 2, customer_name: 'Old Cust 2', status: 'confirmed', total_amount: 550 },
        { id: 'ord-hist-3', order_number: 3, table_number: 4, order_type: 'table', status: 'pending', total_amount: 720 }
      ];

      const existingNotifs = [
        { id: 'notif-old-1', type: 'order', is_read: false, item_id: 'ord-hist-1' },
        { id: 'notif-old-2', type: 'order', is_read: false, item_id: 'ord-hist-3' }
      ];

      // Boot / First Load
      engine.processNotificationsAndAlerts(existingNotifs, existingOrders, existingOrders, true);

      assert.equal(engine.businessNotifs.length, 0, 'Startup/First load must NEVER fire notifications for old orders');
      assert.equal(engine.audioEvents.length, 0, 'Startup/First load must NOT play audio chimes');
      assert.equal(engine.notifiedBusinessOrderIds.has('ord-hist-1'), true);
      assert.equal(engine.notifiedBusinessOrderIds.has('ord-hist-3'), true);
    });
  });

  describe('Section 7: Preservation of Critical Operational Errors & Validation Alerts', () => {
    it('7.1 Mandatory validation errors for delivery orders continue to display via showAdminToast', () => {
      const errToast = engine.showAdminToast('A valid 10-digit mobile number is mandatory for Delivery orders.', 'error');
      assert.notEqual(errToast, null);
      assert.equal(errToast.type, 'error');
      assert.equal(engine.toasts.length, 1);
      assert.match(engine.toasts[0].message, /10-digit mobile number/);
    });

    it('7.2 Critical operational warnings and payment settlement failures display clearly', () => {
      const warnToast = engine.showAdminToast('Dining Table Number is mandatory for Dine-in orders.', 'warning');
      assert.notEqual(warnToast, null);
      assert.equal(warnToast.type, 'warning');

      const failToast = engine.showAdminToast('Failed to settle payment: Network connection lost.', 'error');
      assert.notEqual(failToast, null);
      assert.equal(failToast.type, 'error');

      assert.equal(engine.toasts.length, 2, 'Both critical warning and error alerts must be displayed');
    });
  });
});
