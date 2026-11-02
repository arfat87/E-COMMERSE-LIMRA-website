/**
 * =============================================================================
 * LIMRA RESTAURANT POS — CENTRAL DOMAIN STATE & EVENT BUS (pos/state.js)
 * =============================================================================
 * 
 * Provides:
 * 1. Normalized Orders & OrderItems indexes (O(1) Map lookups by ID/order_id).
 * 2. Shared application state store with accessor getters & setters.
 * 3. Type-safe Event Bus (posEvents) for decoupling domain events.
 * 4. Local cache persistence & sensitive data isolation on logout.
 */

// ── Event Bus ────────────────────────────────────────────────────────
class PosEventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (typeof handler !== 'function') return () => {};
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this._listeners.delete(event);
      }
    }
  }

  emit(event, data) {
    const handlers = this._listeners.get(event);
    if (!handlers) return;
    for (const handler of Array.from(handlers)) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[PosEventBus] Error in listener for event "${event}":`, err);
      }
    }
  }

  clear() {
    this._listeners.clear();
  }
}

export const posEvents = new PosEventBus();

// ── Shared Application State ──────────────────────────────────────────
class PosStateStore {
  constructor() {
    this._orders = [];
    this._orderItems = [];
    this._bookings = [];
    this._adminPlaces = [];
    this._diningTables = [];
    this._adminCoupons = [];
    this._adminCombos = [];
    this._currentUser = null;
    this._selectedOrderId = null;
    this._ordersPage = 1;
    this._activeOrderTypeFilter = 'all';
    this._posCart = [];
    this._posOrderType = 'table';
    this._posEditingOrderId = null;
    this._posSelectedPlace = null;
    this._activePanelId = 'dashboard';

    // Normalized Indexes for O(1) lookups
    this._ordersById = new Map();
    this._orderItemsByOrderId = new Map();
  }

  // ── Orders ──────────────────────────────────────────────────────────
  getOrders() {
    return this._orders;
  }

  setOrders(newOrders) {
    this._orders = Array.isArray(newOrders) ? newOrders : [];
    this._rebuildOrdersIndex();
    posEvents.emit('orders:updated', this._orders);
    return this._orders;
  }

  getOrderById(id) {
    if (!id) return null;
    return this._ordersById.get(String(id)) || null;
  }

  updateOrder(id, patch) {
    const existing = this.getOrderById(id);
    if (!existing) return null;
    Object.assign(existing, patch);
    this._ordersById.set(String(id), existing);
    posEvents.emit('order:updated', { id, order: existing });
    return existing;
  }

  addOrder(order) {
    if (!order || !order.id) return null;
    this._orders.unshift(order);
    this._ordersById.set(String(order.id), order);
    posEvents.emit('order:added', order);
    return order;
  }

  _rebuildOrdersIndex() {
    this._ordersById.clear();
    for (const o of this._orders) {
      if (o && o.id) {
        this._ordersById.set(String(o.id), o);
      }
    }
  }

  // ── Order Items ─────────────────────────────────────────────────────
  getOrderItems() {
    return this._orderItems;
  }

  setOrderItems(newItems) {
    this._orderItems = Array.isArray(newItems) ? newItems : [];
    this._rebuildOrderItemsIndex();
    posEvents.emit('order_items:updated', this._orderItems);
    return this._orderItems;
  }

  getOrderItemsByOrderId(orderId) {
    if (!orderId) return [];
    return this._orderItemsByOrderId.get(String(orderId)) || [];
  }

  addOrderItems(items) {
    if (!Array.isArray(items)) return;
    this._orderItems.push(...items);
    this._rebuildOrderItemsIndex();
    posEvents.emit('order_items:updated', this._orderItems);
  }

  replaceOrderItemsForOrder(orderId, newItems) {
    const strOrderId = String(orderId);
    this._orderItems = this._orderItems.filter(i => String(i.order_id) !== strOrderId);
    if (Array.isArray(newItems) && newItems.length > 0) {
      this._orderItems.push(...newItems);
    }
    this._rebuildOrderItemsIndex();
    posEvents.emit('order_items:updated', this._orderItems);
  }

  _rebuildOrderItemsIndex() {
    this._orderItemsByOrderId.clear();
    for (const item of this._orderItems) {
      if (!item || !item.order_id) continue;
      const key = String(item.order_id);
      if (!this._orderItemsByOrderId.has(key)) {
        this._orderItemsByOrderId.set(key, []);
      }
      this._orderItemsByOrderId.get(key).push(item);
    }
  }

  // ── Dining Tables ───────────────────────────────────────────────────
  getDiningTables() {
    return this._diningTables;
  }

  setDiningTables(tables) {
    this._diningTables = Array.isArray(tables) ? tables : [];
    posEvents.emit('tables:updated', this._diningTables);
    return this._diningTables;
  }

  getDiningTableByNumber(tableNumber) {
    if (!tableNumber) return null;
    const cleanNum = String(tableNumber).trim();
    return this._diningTables.find(t => String(t.number).trim() === cleanNum) || null;
  }

  // ── Workstation Cart ────────────────────────────────────────────────
  getPosCart() {
    return this._posCart;
  }

  setPosCart(cart) {
    this._posCart = Array.isArray(cart) ? cart : [];
    posEvents.emit('cart:updated', this._posCart);
    return this._posCart;
  }

  clearPosCart() {
    this._posCart = [];
    posEvents.emit('cart:cleared');
    return this._posCart;
  }

  // ── Session Context & UI State ──────────────────────────────────────
  getCurrentUser() {
    return this._currentUser;
  }

  setCurrentUser(user) {
    this._currentUser = user;
    posEvents.emit('user:changed', user);
  }

  getSelectedOrderId() {
    return this._selectedOrderId;
  }

  setSelectedOrderId(orderId) {
    this._selectedOrderId = orderId;
    posEvents.emit('order:selected', orderId);
  }

  getPosOrderType() {
    return this._posOrderType;
  }

  setPosOrderType(orderType) {
    this._posOrderType = orderType;
    posEvents.emit('ordertype:changed', orderType);
  }

  getPosEditingOrderId() {
    return this._posEditingOrderId;
  }

  setPosEditingOrderId(orderId) {
    this._posEditingOrderId = orderId;
  }

  getPosSelectedPlace() {
    return this._posSelectedPlace;
  }

  setPosSelectedPlace(place) {
    this._posSelectedPlace = place;
  }

  getBookings() {
    return this._bookings;
  }

  setBookings(bookings) {
    this._bookings = Array.isArray(bookings) ? bookings : [];
    posEvents.emit('bookings:updated', this._bookings);
  }

  getAdminPlaces() {
    return this._adminPlaces;
  }

  setAdminPlaces(places) {
    this._adminPlaces = Array.isArray(places) ? places : [];
    posEvents.emit('places:updated', this._adminPlaces);
  }

  getAdminCoupons() {
    return this._adminCoupons;
  }

  setAdminCoupons(coupons) {
    this._adminCoupons = Array.isArray(coupons) ? coupons : [];
    posEvents.emit('coupons:updated', this._adminCoupons);
  }

  getAdminCombos() {
    return this._adminCombos;
  }

  setAdminCombos(combos) {
    this._adminCombos = Array.isArray(combos) ? combos : [];
    posEvents.emit('combos:updated', this._adminCombos);
  }

  getActivePanelId() {
    return this._activePanelId;
  }

  setActivePanelId(panelId) {
    this._activePanelId = panelId;
    posEvents.emit('panel:switched', panelId);
  }

  // ── Cache Persistence ───────────────────────────────────────────────
  persistOrdersCache() {
    try {
      if (typeof localStorage === 'undefined') return;
      if (Array.isArray(this._orders)) {
        localStorage.setItem('limra_cached_orders', JSON.stringify(this._orders.slice(0, 150)));
      }
      if (Array.isArray(this._orderItems)) {
        localStorage.setItem('limra_cached_order_items', JSON.stringify(this._orderItems.slice(0, 500)));
      }
    } catch (e) {
      console.warn('[PosState Cache Warn]:', e);
    }
  }

  loadCachedOrders() {
    try {
      if (typeof localStorage === 'undefined') return { orders: [], orderItems: [] };
      const rawOrders = localStorage.getItem('limra_cached_orders');
      const rawItems = localStorage.getItem('limra_cached_order_items');
      const cachedOrders = rawOrders ? JSON.parse(rawOrders) : [];
      const cachedItems = rawItems ? JSON.parse(rawItems) : [];
      if (Array.isArray(cachedOrders) && cachedOrders.length > 0) {
        this.setOrders(cachedOrders);
      }
      if (Array.isArray(cachedItems) && cachedItems.length > 0) {
        this.setOrderItems(cachedItems);
      }
      return {
        orders: Array.isArray(cachedOrders) ? cachedOrders : [],
        orderItems: Array.isArray(cachedItems) ? cachedItems : []
      };
    } catch (e) {
      console.warn('[PosState LoadCache Warn]:', e);
      return { orders: [], orderItems: [] };
    }
  }

  clearSensitiveUserData() {
    try {
      if (typeof localStorage === 'undefined') return;
      const keys = [
        'limra-customer-details',
        'limra_cached_orders',
        'limra_cached_order_items',
        'limra-cart',
        'limra_user_profile',
        'limra_dev_admin'
      ];
      keys.forEach(k => {
        try { localStorage.removeItem(k); } catch (e) {}
      });
      this._orders = [];
      this._orderItems = [];
      this._posCart = [];
      this._ordersById.clear();
      this._orderItemsByOrderId.clear();
      posEvents.emit('state:cleared');
    } catch (e) {
      console.warn('[PosState ClearCache Warn]:', e);
    }
  }
}

export const posState = new PosStateStore();
