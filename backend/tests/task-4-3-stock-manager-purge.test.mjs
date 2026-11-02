/**
 * =============================================================================
 * TASK 4.3 VERIFICATION TEST SUITE: LEGACY DUPLICATE STOCK MANAGER PURGE
 * =============================================================================
 * 
 * Verifies:
 * 1. Complete safe removal of legacy dead code directory `frontend/src/stock-manager/`
 * 2. Self-contained migration of fallback seed catalog to `frontend/src/stock/initial-stock-data.js`
 * 3. Active Stock store (`stock-data.js`) binds to `stock_items`, `stock_in`, `stock_out`, `stock_logs`
 * 4. Database schema clarifies active operational tables vs archival tables without data destruction
 * 5. Clean integration in `frontend/src/admin-stock.js` mounting `initStockUI()`
 * 6. Elimination of dead server URL logs in `backend/server.js`
 * 7. Integrity of active FIFO inventory engine (`stock-engine.js`)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { INITIAL_STOCK_ITEMS } from '../../frontend/src/stock/initial-stock-data.js';
import {
  computePeriod,
  getItemLots,
  getWeekInfo,
  previewOut,
  safeNum
} from '../../frontend/src/stock/stock-engine.js';

const LEGACY_DIR_PATH = path.resolve('frontend/src/stock-manager');
const ACTIVE_SEED_PATH = path.resolve('frontend/src/stock/initial-stock-data.js');
const STOCK_DATA_PATH = path.resolve('frontend/src/stock/stock-data.js');
const ADMIN_STOCK_PATH = path.resolve('frontend/src/admin-stock.js');
const SCHEMA_PATH = path.resolve('database/schema.sql');
const SERVER_PATH = path.resolve('backend/server.js');

describe('TASK 4.3: Safe Removal of Legacy Duplicate Stock Manager', () => {
  it('1. Legacy frontend/src/stock-manager directory has been completely removed', () => {
    assert.strictEqual(
      fs.existsSync(LEGACY_DIR_PATH),
      false,
      'Legacy directory frontend/src/stock-manager must not exist'
    );
  });

  it('2. Active stock seed catalog exists in frontend/src/stock/initial-stock-data.js', () => {
    assert.ok(fs.existsSync(ACTIVE_SEED_PATH), 'Missing frontend/src/stock/initial-stock-data.js');
    assert.ok(Array.isArray(INITIAL_STOCK_ITEMS), 'INITIAL_STOCK_ITEMS must be an array');
    assert.ok(INITIAL_STOCK_ITEMS.length > 50, `Expected >50 seed items, found ${INITIAL_STOCK_ITEMS.length}`);
    
    const thumsUp = INITIAL_STOCK_ITEMS.find(i => i.sku === 'J136');
    assert.ok(thumsUp, 'Expected Thums Up J136 in stock seed items');
    assert.strictEqual(thumsUp.name, 'THUMSUP 1L');
    assert.strictEqual(thumsUp.unit, 'pcs');
  });

  it('3. Active Stock store imports seed data from local initial-stock-data.js', () => {
    const stockDataContent = fs.readFileSync(STOCK_DATA_PATH, 'utf8');
    assert.match(
      stockDataContent,
      /import\s*{\s*INITIAL_STOCK_ITEMS\s*}\s*from\s*['"]\.\/initial-stock-data\.js['"]/,
      'stock-data.js must import INITIAL_STOCK_ITEMS locally from ./initial-stock-data.js'
    );
    assert.doesNotMatch(
      stockDataContent,
      /stock-manager/,
      'stock-data.js must not contain references to stock-manager'
    );
  });

  it('4. Active Stock store binds to canonical tables (stock_items, stock_in, stock_out, stock_logs)', () => {
    const stockDataContent = fs.readFileSync(STOCK_DATA_PATH, 'utf8');
    assert.match(stockDataContent, /from\(['"]stock_items['"]\)/, 'Must query stock_items');
    assert.match(stockDataContent, /from\(['"]stock_in['"]\)/, 'Must query stock_in');
    assert.match(stockDataContent, /from\(['"]stock_out['"]\)/, 'Must query stock_out');
    assert.match(stockDataContent, /from\(['"]stock_logs['"]\)/, 'Must query stock_logs');
    assert.match(stockDataContent, /rpc\(['"]record_stock_in['"]/, 'Must call record_stock_in RPC');
    assert.match(stockDataContent, /rpc\(['"]record_stock_out['"]/, 'Must call record_stock_out RPC');
  });

  it('5. Database schema documents active operational tables vs archival batch tables without data loss', () => {
    const schemaContent = fs.readFileSync(SCHEMA_PATH, 'utf8');
    assert.match(schemaContent, /CREATE TABLE IF NOT EXISTS public\.stock_items/, 'Must preserve stock_items');
    assert.match(schemaContent, /CREATE TABLE IF NOT EXISTS public\.stock_in\s*\(/, 'Must preserve stock_in');
    assert.match(schemaContent, /CREATE TABLE IF NOT EXISTS public\.stock_out\s*\(/, 'Must preserve stock_out');
    assert.match(schemaContent, /CREATE TABLE IF NOT EXISTS public\.stock_logs/, 'Must preserve stock_logs');
    assert.match(schemaContent, /CREATE TABLE IF NOT EXISTS public\.stock_in_entries/, 'Must preserve stock_in_entries');
    assert.match(schemaContent, /CREATE TABLE IF NOT EXISTS public\.stock_out_entries/, 'Must preserve stock_out_entries');
    assert.match(schemaContent, /ARCHIVAL \/ BATCH COMPATIBILITY/, 'Must document archival compatibility');
  });

  it('6. admin-stock.js cleanly mounts modern stock UI without legacy dependencies', () => {
    const adminStockContent = fs.readFileSync(ADMIN_STOCK_PATH, 'utf8');
    assert.match(adminStockContent, /import\s*['"]\.\/stock\/stock\.css['"]/, 'Must import tokenized stock.css');
    assert.match(adminStockContent, /import\s*{\s*initStockUI\s*}\s*from\s*['"]\.\/stock\/stock-ui\.js['"]/, 'Must import initStockUI');
    assert.doesNotMatch(adminStockContent, /stock-manager/, 'admin-stock.js must not reference stock-manager');
  });

  it('7. backend/server.js references active POS panel route rather than dead stock-manager URL', () => {
    const serverContent = fs.readFileSync(SERVER_PATH, 'utf8');
    assert.doesNotMatch(serverContent, /stock-manager\/index\.html/, 'Dead stock-manager URL must be removed');
    assert.match(serverContent, /panel-stock/, 'Server startup log should direct to active stock panel');
  });
});

describe('TASK 4.3: Stock Engine & FIFO Math Preservation Verification', () => {
  it('8. Current stock calculation and FIFO lot extraction operate with zero regression', () => {
    const onion = { id: 'i1', sku: 'ON', name: 'Onion', category: 'Fresh Vegetables', unit: 'kg', min: 5, cost: 30, storedQty: 15 };
    const d = {
      items: [onion],
      ins: [
        { id: 'b1', sku: 'ON', date: '2026-10-01', qty: 10, costPrice: 20, createdAt: '2026-10-01T10:00:00Z' },
        { id: 'b2', sku: 'ON', date: '2026-10-03', qty: 10, costPrice: 30, createdAt: '2026-10-03T10:00:00Z' }
      ],
      outs: [
        { id: 'o1', sku: 'ON', date: '2026-10-04', qty: 5, createdAt: '2026-10-04T12:00:00Z' }
      ]
    };

    const lotsInfo = getItemLots(d, 'ON');
    assert.ok(lotsInfo, 'Lots info must not be null');
    assert.ok(Array.isArray(lotsInfo.activeLots), 'activeLots must be an array');
    assert.strictEqual(lotsInfo.activeLots.length, 2, 'Should have 2 remaining active lots');
    assert.strictEqual(lotsInfo.activeLots[0].qty, 5, 'Oldest lot b1 should have 5 remaining');
    assert.strictEqual(lotsInfo.activeLots[0].cost, 20, 'Oldest lot b1 rate should be 20');
    assert.strictEqual(lotsInfo.activeLots[1].qty, 10, 'Second lot b2 should have 10 remaining');
    assert.strictEqual(lotsInfo.activeLots[1].cost, 30, 'Second lot b2 rate should be 30');
    assert.strictEqual(lotsInfo.totalQty, 15, 'Total remaining units across lots must be 15');
    assert.strictEqual(lotsInfo.totalValue, 400, 'Total lot value should be 5*20 + 10*30 = 400');
  });

  it('9. previewOut calculates FIFO cost correctly against active lots', () => {
    const today = new Date();
    const ds = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const onion = { id: 'i1', sku: 'ON', name: 'Onion', category: 'Fresh Vegetables', unit: 'kg', min: 5, cost: 30, storedQty: 20 };
    const d = {
      items: [onion],
      ins: [
        { id: 'a', sku: 'ON', date: ds(new Date(today.getTime() - 3 * 864e5)), qty: 10, costPrice: 20, createdAt: new Date(today.getTime() - 3 * 864e5).toISOString() },
        { id: 'b', sku: 'ON', date: ds(new Date(today.getTime() - 864e5)), qty: 10, costPrice: 30, createdAt: new Date(today.getTime() - 864e5).toISOString() }
      ],
      outs: []
    };

    // Planned OUT 12 kg: 10 @ 20 + 2 @ 30 = 200 + 60 = 260
    const pv = previewOut(d, 'ON', 12);
    assert.ok(pv, 'Preview OUT result must not be null');
    assert.strictEqual(pv.cost, 260, 'FIFO preview total cost must equal 260');
    assert.strictEqual(pv.available, 20, 'Available quantity must equal 20');
  });

  it('10. Period computation generates consistent weekly/daily balance summaries', () => {
    const onion = { id: 'i1', sku: 'ON', name: 'Onion', category: 'Fresh Vegetables', unit: 'kg', min: 5, cost: 30, storedQty: 5 };
    const d = {
      items: [onion],
      ins: [
        { id: 'a', sku: 'ON', date: '2026-10-01', qty: 10, costPrice: 20, createdAt: '2026-10-01T05:00:00Z' },
        { id: 'b', sku: 'ON', date: '2026-10-03', qty: 10, costPrice: 30, createdAt: '2026-10-03T05:00:00Z' }
      ],
      outs: [
        { id: 'c', sku: 'ON', date: '2026-10-02', qty: 4, createdAt: '2026-10-02T05:00:00Z' },
        { id: 'd', sku: 'ON', date: '2026-10-04', qty: 8, createdAt: '2026-10-04T05:00:00Z' }
      ]
    };

    const week1 = getWeekInfo(new Date(2026, 9, 1));
    const period = computePeriod(d, week1.start, week1.end);
    assert.ok(period, 'Period calculation returned null/undefined');
    assert.ok(Array.isArray(period.rows) && period.rows.length === 1, 'Expected 1 item row in period summary');
    
    const row = period.rows[0];
    assert.strictEqual(row.inQty, 20, 'In qty must match 20');
    assert.strictEqual(row.outQty, 12, 'Out qty must match 12');
    assert.strictEqual(row.closeQty, 8, 'Closing qty must match 8');
    assert.strictEqual(period.balanced, true, 'Period accounting must be fully balanced');
  });
});
