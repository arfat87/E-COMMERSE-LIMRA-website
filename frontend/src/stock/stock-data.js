// ═════════════════════════════════════════════════════════════════════
// STOCK DATA LAYER — Supabase / InsForge persistence with local cache
// ═════════════════════════════════════════════════════════════════════

import { insforge } from '../lib/insforge.js';
import { INITIAL_STOCK_ITEMS } from '../stock-manager/data/initialStockData.js';
import { safeNum } from './stock-engine.js';

const STORAGE_KEY_ITEMS = 'limra_stock_items_v3';
const STORAGE_KEY_IN = 'limra_stock_in_entries_v3';
const STORAGE_KEY_OUT = 'limra_stock_out_entries_v3';
const STORAGE_KEY_LOGS = 'limra_stock_logs_v3';

class StockStore {
  constructor() {
    this.items = [];
    this.ins = [];
    this.outs = [];
    this.logs = [];
    this.listeners = new Set();
    this.isSyncing = false;
    this.dbStatus = 'offline'; // 'offline' | 'syncing' | 'connected'
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.saveCache();
    this.listeners.forEach(fn => {
      try { fn(this.getData()); } catch (e) { console.error('[StockStore] listener error:', e); }
    });
  }

  getData() {
    return {
      items: this.items,
      ins: this.ins,
      outs: this.outs,
      logs: this.logs,
      dbStatus: this.dbStatus,
      isSyncing: this.isSyncing
    };
  }

  loadCache() {
    try {
      const rawItems = localStorage.getItem(STORAGE_KEY_ITEMS);
      this.items = rawItems ? JSON.parse(rawItems) : JSON.parse(JSON.stringify(INITIAL_STOCK_ITEMS));
    } catch {
      this.items = JSON.parse(JSON.stringify(INITIAL_STOCK_ITEMS));
    }

    try {
      const rawIn = localStorage.getItem(STORAGE_KEY_IN);
      this.ins = rawIn ? JSON.parse(rawIn) : [];
    } catch {
      this.ins = [];
    }

    try {
      const rawOut = localStorage.getItem(STORAGE_KEY_OUT);
      this.outs = rawOut ? JSON.parse(rawOut) : [];
    } catch {
      this.outs = [];
    }

    try {
      const rawLogs = localStorage.getItem(STORAGE_KEY_LOGS);
      this.logs = rawLogs ? JSON.parse(rawLogs) : [];
    } catch {
      this.logs = [];
    }

    // Standardize item model
    this.items = this.items.map(i => ({
      id: i.id || `stk_${i.sku}`,
      sku: i.sku || '',
      name: i.name || '',
      category: i.category || 'Bhusimal & Spices',
      unit: i.unit || 'pcs',
      min: safeNum(i.min_qty ?? i.min, 5),
      cost: safeNum(i.cost_price ?? i.cost, 0),
      salePrice: safeNum(i.sale_price ?? i.salePrice, 0),
      supplier: i.supplier || '',
      storedQty: safeNum(i.qty, 0),
      isAvailable: i.is_available ?? i.isAvailable ?? true
    }));
  }

  saveCache() {
    try {
      localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(this.items));
      localStorage.setItem(STORAGE_KEY_IN, JSON.stringify(this.ins));
      localStorage.setItem(STORAGE_KEY_OUT, JSON.stringify(this.outs));
      localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(this.logs));
    } catch (e) {
      console.warn('[StockStore] Failed to save local cache:', e);
    }
  }

  async syncDB() {
    this.isSyncing = true;
    this.dbStatus = 'syncing';
    this.notify();

    try {
      const [itemsRes, inRes, outRes, logsRes] = await Promise.all([
        insforge.database.from('stock_items').select('*').order('sku', { ascending: true }),
        insforge.database.from('stock_in').select('*').order('created_at', { ascending: false }),
        insforge.database.from('stock_out').select('*').order('created_at', { ascending: false }),
        insforge.database.from('stock_logs').select('*').order('created_at', { ascending: false }).limit(100)
      ]);

      if (itemsRes.data && itemsRes.data.length > 0) {
        this.items = itemsRes.data.map(item => ({
          id: item.id,
          sku: item.sku,
          name: item.name,
          category: item.category || 'Bhusimal & Spices',
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

      if (inRes.data && inRes.data.length > 0) {
        this.ins = inRes.data.map(entry => ({
          id: entry.id,
          date: entry.date || new Date(entry.created_at || Date.now()).toISOString().slice(0, 10),
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

      if (outRes.data && outRes.data.length > 0) {
        this.outs = outRes.data.map(entry => ({
          id: entry.id,
          date: entry.date || new Date(entry.created_at || Date.now()).toISOString().slice(0, 10),
          sku: entry.item_sku || entry.sku || '',
          description: entry.item_name || entry.description || 'Stock OUT',
          unit: entry.unit || 'pcs',
          qty: safeNum(entry.qty, 0),
          usedBy: entry.used_by || 'Kitchen Prep',
          notes: entry.notes || '',
          createdAt: entry.created_at
        }));
      }

      if (logsRes.data && logsRes.data.length > 0) {
        this.logs = logsRes.data.map(log => ({
          id: log.id,
          date: new Date(log.created_at).toLocaleDateString('en-GB') + ' ' + new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
          itemName: log.action ? log.action.split('(')[0].trim() : 'Stock Action',
          type: log.action || 'Movement',
          qtyText: log.details ? (log.details.split('|')[0] || '').trim() : '',
          notes: log.details || '',
          createdAt: log.created_at
        }));
      }

      this.dbStatus = 'connected';
    } catch (err) {
      console.warn('[StockStore] DB fetch fallback to cache:', err);
      this.dbStatus = 'offline';
    } finally {
      this.isSyncing = false;
      this.notify();
    }
  }

  async recordIn({ sku, date, qty, costPrice, supplier, notes, updateMasterCost }) {
    const item = this.items.find(i => i.sku === sku);
    if (!item) throw new Error(`Item with SKU "${sku}" not found`);
    const q = safeNum(qty);
    const cost = safeNum(costPrice, item.cost);
    if (q <= 0) throw new Error('Quantity must be greater than 0');
    if (cost <= 0) throw new Error('Purchase rate / cost price per unit is required and must be greater than 0.');

    const entryId = 'in_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const nowIso = new Date().toISOString();
    const entryDate = date || nowIso.slice(0, 10);

    const entry = {
      id: entryId,
      date: entryDate,
      sku: item.sku,
      description: item.name,
      unit: item.unit,
      qty: q,
      costPrice: cost,
      supplier: supplier || item.supplier || '',
      notes: notes || '',
      createdAt: nowIso
    };

    // Optimistic local add
    this.ins.unshift(entry);
    item.storedQty = safeNum(item.storedQty, 0) + q;
    if (cost > 0) {
      item.cost = cost;
    }
    this.saveCache();
    this.notify();

    // Call RPC or DB insert
    try {
      const { error: rpcErr } = await insforge.rpc('record_stock_in', {
        p_item_id: item.id,
        p_qty: q,
        p_cost_price: cost || null,
        p_supplier: supplier || item.supplier || null,
        p_notes: notes || null
      });

      if (rpcErr) {
        console.warn('[StockStore] record_stock_in RPC fallback:', rpcErr);
        await insforge.database.from('stock_in').insert([{
          id: entryId,
          date: entryDate,
          item_id: item.id,
          item_sku: item.sku,
          item_name: item.name,
          qty: q,
          unit: item.unit,
          cost_price: cost,
          supplier: supplier || item.supplier || '',
          notes: notes || '',
          created_at: nowIso
        }]);

        if (updateMasterCost && cost > 0) {
          await insforge.database.from('stock_items').update({
            cost_price: cost,
            updated_at: nowIso
          }).eq('id', item.id);
        }
      }
    } catch (e) {
      console.error('[StockStore] sync IN error:', e);
    }

    return entry;
  }

  async recordOut({ sku, date, qty, reason, notes, allowNegative }) {
    const item = this.items.find(i => i.sku === sku);
    if (!item) throw new Error(`Item with SKU "${sku}" not found`);
    const q = safeNum(qty);
    if (q <= 0) throw new Error('Quantity must be greater than 0');

    const entryId = 'out_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const nowIso = new Date().toISOString();
    const entryDate = date || nowIso.slice(0, 10);

    const entry = {
      id: entryId,
      date: entryDate,
      sku: item.sku,
      description: item.name,
      unit: item.unit,
      qty: q,
      usedBy: reason || 'Kitchen Prep',
      notes: notes || '',
      createdAt: nowIso
    };

    // Optimistic local add
    this.outs.unshift(entry);
    item.storedQty = Math.max(0, safeNum(item.storedQty, 0) - q);
    this.saveCache();
    this.notify();

    // Call RPC or DB insert
    try {
      const { error: rpcErr } = await insforge.rpc('record_stock_out', {
        p_item_id: item.id,
        p_qty: q,
        p_reason: reason || 'Kitchen Prep',
        p_used_by: 'Kitchen Staff',
        p_notes: notes || null,
        p_allow_negative: allowNegative || false
      });

      if (rpcErr) {
        console.warn('[StockStore] record_stock_out RPC fallback:', rpcErr);
        await insforge.database.from('stock_out').insert([{
          id: entryId,
          date: entryDate,
          item_id: item.id,
          item_sku: item.sku,
          item_name: item.name,
          qty: q,
          unit: item.unit,
          used_by: reason || 'Kitchen Prep',
          notes: notes || '',
          created_at: nowIso
        }]);
      }
    } catch (e) {
      console.error('[StockStore] sync OUT error:', e);
    }

    return entry;
  }

  async deleteEntry(type, entryId) {
    if (type === 'IN') {
      const idx = this.ins.findIndex(e => e.id === entryId);
      if (idx !== -1) {
        const removed = this.ins.splice(idx, 1)[0];
        const item = this.items.find(i => i.sku === removed.sku);
        if (item) {
          item.storedQty = Math.max(0, safeNum(item.storedQty, 0) - safeNum(removed.qty, 0));
        }
        this.saveCache();
        this.notify();
        try {
          await insforge.database.from('stock_in').delete().eq('id', entryId);
        } catch (e) {
          console.error('[StockStore] delete stock_in failed:', e);
        }
      }
    } else {
      const idx = this.outs.findIndex(e => e.id === entryId);
      if (idx !== -1) {
        const removed = this.outs.splice(idx, 1)[0];
        const item = this.items.find(i => i.sku === removed.sku);
        if (item) {
          item.storedQty = safeNum(item.storedQty, 0) + safeNum(removed.qty, 0);
        }
        this.saveCache();
        this.notify();
        try {
          await insforge.database.from('stock_out').delete().eq('id', entryId);
        } catch (e) {
          console.error('[StockStore] delete stock_out failed:', e);
        }
      }
    }
  }

  async saveItem(itemData) {
    const isNew = !itemData.id;
    const nowIso = new Date().toISOString();
    const id = itemData.id || `stk_${Date.now()}`;
    const sku = itemData.sku || `J${String(this.items.length + 1).padStart(3, '0')}`;
    const initialQty = safeNum(itemData.storedQty, 0);
    const cost = safeNum(itemData.cost, 0);

    if (isNew && initialQty > 0 && cost <= 0) {
      throw new Error('Please enter purchase rate (price) for initial stock.');
    }

    const formatted = {
      id,
      sku,
      name: itemData.name.trim(),
      category: itemData.category || 'Bhusimal & Spices',
      unit: itemData.unit || 'pcs',
      min: safeNum(itemData.min, 5),
      cost: cost,
      salePrice: safeNum(itemData.salePrice, 0),
      supplier: itemData.supplier || '',
      storedQty: isNew ? 0 : safeNum(itemData.storedQty, 0),
      isAvailable: itemData.isAvailable ?? true
    };

    if (isNew) {
      this.items.unshift(formatted);
      this.saveCache();
      this.notify();
      // If initial quantity is given, create an initial IN entry (which adds storedQty)
      if (initialQty > 0) {
        await this.recordIn({
          sku: formatted.sku,
          qty: initialQty,
          costPrice: formatted.cost,
          supplier: formatted.supplier,
          notes: 'Initial opening stock balance'
        });
      }
    } else {
      const idx = this.items.findIndex(i => i.id === id);
      if (idx !== -1) {
        this.items[idx] = { ...this.items[idx], ...formatted };
      }
      this.saveCache();
      this.notify();
    }

    // Async DB update
    try {
      const dbPayload = {
        id: formatted.id,
        sku: formatted.sku,
        name: formatted.name,
        category: formatted.category,
        unit: formatted.unit,
        min_qty: formatted.min,
        cost_price: formatted.cost,
        sale_price: formatted.salePrice,
        supplier: formatted.supplier,
        is_available: formatted.isAvailable,
        updated_at: nowIso
      };

      if (isNew) {
        await insforge.database.from('stock_items').insert([{ ...dbPayload, qty: initialQty }]);
      } else {
        await insforge.database.from('stock_items').update(dbPayload).eq('id', formatted.id);
      }
    } catch (e) {
      console.error('[StockStore] save item DB error:', e);
    }
  }
}

export const stockStore = new StockStore();
