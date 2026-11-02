/**
 * LIMRA RESTAURANT — TESTING SECURITY & DATABASE ISOLATION GUARD
 * 
 * Mandates:
 * 1. AUTOMATED TESTS RUN ONLY IN LOCAL DEVELOPMENT OR TEST ENVIRONMENTS.
 * 2. AUTOMATED TESTS ARE STRICTLY BLOCKED IN PRODUCTION (NODE_ENV=production, VERCEL_ENV=production, etc.).
 * 3. DATABASE ISOLATION: Production Supabase database must NEVER be touched by automated tests.
 *    - Uses separate development Supabase project (DEV_SUPABASE_URL / SUPABASE_TEST_URL) when configured.
 *    - Uses an in-memory isolated sandbox when running local offline tests.
 *    - Real customer data, bills, payments, and dining tables are 100% immune from test mutations.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../../");

export const PRODUCTION_SUPABASE_REF = "ynrtlcasbndkrqeotgzt";
export const PRODUCTION_SUPABASE_HOST = "ynrtlcasbndkrqeotgzt.supabase.co";

/**
 * Checks if the current environment is flagged as Production
 * across any cloud host or Node runtime standard.
 */
export function isProductionEnvironment(env = process.env) {
  if (!env) return false;
  const nodeEnv = (env.NODE_ENV || "").toLowerCase().trim();
  const vercelEnv = (env.VERCEL_ENV || "").toLowerCase().trim();
  const appEnv = (env.APP_ENV || "").toLowerCase().trim();
  const environment = (env.ENVIRONMENT || "").toLowerCase().trim();
  const isProdFlag = (env.IS_PRODUCTION || "").toLowerCase().trim() === "true";
  const cfPagesBranch = (env.CF_PAGES_BRANCH || "").toLowerCase().trim();

  return (
    nodeEnv === "production" ||
    nodeEnv === "prod" ||
    vercelEnv === "production" ||
    appEnv === "production" ||
    environment === "production" ||
    isProdFlag ||
    cfPagesBranch === "main"
  );
}

/**
 * Checks if the given URL points to the live production Supabase instance.
 */
export function isProductionDatabaseUrl(url) {
  if (!url || typeof url !== "string") return false;
  const clean = url.toLowerCase().trim();
  return clean.includes(PRODUCTION_SUPABASE_REF) || clean.includes("limra-prod");
}

/**
 * Enforces that automated tests run ONLY in development or test environments.
 * If production is detected, immediately terminates execution with an unmissable error.
 */
export function assertTestEnvironment(options = {}) {
  const env = options.env || process.env;
  const runnerName = options.runnerName || "Automated Test Suite";

  if (isProductionEnvironment(env)) {
    const errorBanner = `
╔══════════════════════════════════════════════════════════════════════════════════╗
║  🚨 CRITICAL SECURITY ERROR: AUTOMATED TESTS BLOCKED ON PRODUCTION ENVIRONMENT!  ║
╚══════════════════════════════════════════════════════════════════════════════════╝

[SECURITY GUARD]: Automated tests are strictly prohibited from executing in production!
• Trigger Detected: Production environment indicator active
  - NODE_ENV: "${env.NODE_ENV || 'undefined'}"
  - VERCEL_ENV: "${env.VERCEL_ENV || 'undefined'}"
  - Runner Target: ${runnerName}
• Target Protection: REAL CUSTOMER DATA, BILLS, PAYMENTS, AND TABLES ARE PROTECTED.
• Action Taken: Test process terminated immediately with exit code 1.

Guidance:
  Automated tests must run only on your local development machine or isolated test runner:
    $ export NODE_ENV=test
    $ npm test
`;
    console.error(errorBanner);

    if (options.throwOnly) {
      throw new Error(`CRITICAL SECURITY ERROR: Automated tests are blocked on production environment! (Detected NODE_ENV="${env.NODE_ENV}")`);
    }
    if (typeof process !== "undefined" && process.exit) {
      process.exit(1);
    }
    return false;
  }

  // Ensure test environment indicators are set for downstream processes
  if (!process.env.NODE_ENV || process.env.NODE_ENV === "development") {
    process.env.NODE_ENV = "test";
  }
  process.env.LIMRA_TEST_ENV = "true";

  return true;
}

/**
 * Creates an in-memory isolated database sandbox that mimics Supabase's PostgREST query builder.
 * Any operations performed in the sandbox remain strictly in memory and NEVER touch production.
 */
export function createTestDatabaseSandbox(initialData = {}) {
  const store = {
    orders: [],
    order_items: [],
    verified_payments: [],
    notifications: [],
    payment_history: [],
    sync_queue: [],
    printer_settings: [{ id: "default", printer_type: "thermal_80mm" }],
    ...initialData
  };

  function getTableCollection(tableName) {
    if (!store[tableName]) store[tableName] = [];
    return store[tableName];
  }

  function createQueryBuilder(tableName) {
    const table = getTableCollection(tableName);
    let selectFields = "*";
    let filters = [];
    let pendingInsert = null;
    let pendingUpdate = null;
    let pendingUpsert = null;
    let isDelete = false;
    let limitCount = null;
    let offsetIndex = 0;
    let orderConfig = null;
    let isSingle = false;
    let isMaybeSingle = false;

    const builder = {
      select(fields = "*", options = {}) {
        selectFields = fields;
        return builder;
      },
      insert(records) {
        pendingInsert = Array.isArray(records) ? records : [records];
        return builder;
      },
      update(values) {
        pendingUpdate = values;
        return builder;
      },
      upsert(records, options = {}) {
        pendingUpsert = Array.isArray(records) ? records : [records];
        return builder;
      },
      delete() {
        isDelete = true;
        return builder;
      },
      eq(col, val) {
        filters.push(row => row[col] === val || String(row[col]) === String(val));
        return builder;
      },
      neq(col, val) {
        filters.push(row => row[col] !== val && String(row[col]) !== String(val));
        return builder;
      },
      in(col, vals) {
        filters.push(row => (Array.isArray(vals) ? vals : []).map(String).includes(String(row[col])));
        return builder;
      },
      gte(col, val) {
        filters.push(row => new Date(row[col]) >= new Date(val) || row[col] >= val);
        return builder;
      },
      lte(col, val) {
        filters.push(row => new Date(row[col]) <= new Date(val) || row[col] <= val);
        return builder;
      },
      ilike(col, pattern) {
        const cleanPat = String(pattern).replace(/%/g, "").toLowerCase();
        filters.push(row => String(row[col] || "").toLowerCase().includes(cleanPat));
        return builder;
      },
      order(col, { ascending = true } = {}) {
        orderConfig = { col, ascending };
        return builder;
      },
      limit(n) {
        limitCount = n;
        return builder;
      },
      range(from, to) {
        offsetIndex = from;
        limitCount = to - from + 1;
        return builder;
      },
      single() {
        isSingle = true;
        return builder;
      },
      maybeSingle() {
        isMaybeSingle = true;
        return builder;
      },
      async then(resolve, reject) {
        try {
          // 1. Process Insert
          if (pendingInsert) {
            const inserted = pendingInsert.map(item => {
              const record = {
                id: item.id || crypto.randomUUID(),
                created_at: item.created_at || new Date().toISOString(),
                ...item
              };
              table.push(record);
              return { ...record };
            });
            return resolve({ data: inserted, error: null });
          }

          // 2. Process Upsert
          if (pendingUpsert) {
            const upserted = pendingUpsert.map(item => {
              const matchIdx = table.findIndex(r => (item.id && r.id === item.id) || (item.utr && r.utr === item.utr));
              if (matchIdx !== -1) {
                table[matchIdx] = { ...table[matchIdx], ...item, updated_at: new Date().toISOString() };
                return { ...table[matchIdx] };
              } else {
                const record = {
                  id: item.id || crypto.randomUUID(),
                  created_at: item.created_at || new Date().toISOString(),
                  ...item
                };
                table.push(record);
                return { ...record };
              }
            });
            return resolve({ data: upserted, error: null });
          }

          // 3. Process Delete
          if (isDelete) {
            const toDelete = table.filter(row => filters.every(f => f(row)));
            for (const item of toDelete) {
              const idx = table.indexOf(item);
              if (idx !== -1) table.splice(idx, 1);
            }
            return resolve({ data: toDelete, error: null });
          }

          // 4. Process Update
          if (pendingUpdate) {
            const matched = table.filter(row => filters.every(f => f(row)));
            for (const row of matched) {
              Object.assign(row, pendingUpdate, { updated_at: new Date().toISOString() });
            }
            return resolve({ data: matched, error: null });
          }

          // 5. Process Select
          let result = table.filter(row => filters.every(f => f(row)));

          if (orderConfig) {
            result.sort((a, b) => {
              const valA = a[orderConfig.col];
              const valB = b[orderConfig.col];
              if (valA < valB) return orderConfig.ascending ? -1 : 1;
              if (valA > valB) return orderConfig.ascending ? 1 : -1;
              return 0;
            });
          }

          if (offsetIndex > 0 || limitCount !== null) {
            const start = offsetIndex;
            const end = limitCount !== null ? start + limitCount : result.length;
            result = result.slice(start, end);
          }

          if (isSingle) {
            if (result.length === 0) {
              return resolve({ data: null, error: { message: "Row not found", code: "PGRST116" } });
            }
            return resolve({ data: { ...result[0] }, error: null });
          }

          if (isMaybeSingle) {
            return resolve({ data: result.length > 0 ? { ...result[0] } : null, error: null });
          }

          return resolve({ data: result.map(r => ({ ...r })), error: null, count: result.length });
        } catch (err) {
          return reject(err);
        }
      }
    };

    return builder;
  }

  // Safe mock RPC router for testing
  async function rpc(fnName, params = {}) {
    if (fnName === "deduct_order_inventory_atomic") {
      return {
        data: {
          success: true,
          processed_items: params.p_items || [],
          idempotency_key: params.p_idempotency_key
        },
        error: null
      };
    }
    if (fnName === "settle_order_atomic") {
      const orderId = params.p_order_id;
      const order = (store.orders || []).find(o => o.id === orderId);
      if (order) {
        order.payment_status = "paid";
        order.status = "delivered";
        order.payment_method = params.p_payment_method || "cash";
      }
      return {
        data: {
          success: true,
          order_id: orderId,
          payment_method: params.p_payment_method
        },
        error: null
      };
    }
    if (fnName === "place_table_round") {
      return {
        data: {
          success: true,
          session_id: crypto.randomUUID(),
          table_number: params.p_table_number,
          order_id: crypto.randomUUID(),
          order_number: 9999
        },
        error: null
      };
    }
    if (fnName === "request_table_service") {
      return {
        data: {
          success: true,
          table_number: params.p_table_number,
          service_type: params.p_service_type
        },
        error: null
      };
    }
    if (fnName === "transfer_table_session_atomic") {
      const src = parseInt(params.p_source_table, 10);
      const tgt = parseInt(params.p_target_table, 10);
      if (!src || !tgt || src <= 0 || tgt <= 0) {
        return { data: null, error: new Error("INVALID_TABLE: Invalid source or target table") };
      }
      if (src === tgt) {
        return { data: null, error: new Error("SAME_TABLE: Source and target tables cannot be the same") };
      }
      const activeSrc = (store.orders || []).filter(o => 
        (o.table_number === src || String(o.notes || '').includes(`[TABLE: ${src}]`)) &&
        o.status !== "delivered" && o.status !== "cancelled" && o.status !== "billed" &&
        o.ticket_status !== "CLOSED" && o.ticket_status !== "CANCELLED" && o.ticket_status !== "BILLED"
      );
      if (activeSrc.length === 0) {
        return { data: null, error: new Error(`SOURCE_TABLE_EMPTY: Table ${src} has no active session`) };
      }
      const activeTgt = (store.orders || []).filter(o => 
        (o.table_number === tgt || String(o.notes || '').includes(`[TABLE: ${tgt}]`)) &&
        o.status !== "delivered" && o.status !== "cancelled" &&
        o.ticket_status !== "CLOSED" && o.ticket_status !== "CANCELLED"
      );
      if (activeTgt.length > 0) {
        return { data: null, error: new Error(`TARGET_TABLE_OCCUPIED: Table ${tgt} is currently occupied`) };
      }
      activeSrc.forEach(ord => {
        ord.table_number = tgt;
        ord.notes = (ord.notes || '').replace(new RegExp(`\\[TABLE:\\s*${src}\\]`, 'gi'), `[TABLE: ${tgt}]`);
      });
      return {
        data: {
          success: true,
          source_table: src,
          target_table: tgt,
          transferred_orders_count: activeSrc.length,
          order_ids: activeSrc.map(o => o.id),
          staff_name: params.p_staff_name || "Staff",
          message: `Table ${src} successfully transferred to Table ${tgt}`
        },
        error: null
      };
    }
    if (fnName === "swap_table_sessions_atomic") {
      const a = parseInt(params.p_table_a, 10);
      const b = parseInt(params.p_table_b, 10);
      if (!a || !b || a <= 0 || b <= 0) {
        return { data: null, error: new Error("INVALID_TABLE: Invalid table numbers for swap") };
      }
      if (a === b) {
        return { data: null, error: new Error("SAME_TABLE: Cannot swap table with itself") };
      }
      const ordersA = (store.orders || []).filter(o => 
        (o.table_number === a || String(o.notes || '').includes(`[TABLE: ${a}]`)) &&
        o.status !== "delivered" && o.status !== "cancelled" && o.status !== "billed" &&
        o.ticket_status !== "CLOSED" && o.ticket_status !== "CANCELLED" && o.ticket_status !== "BILLED"
      );
      const ordersB = (store.orders || []).filter(o => 
        (o.table_number === b || String(o.notes || '').includes(`[TABLE: ${b}]`)) &&
        o.status !== "delivered" && o.status !== "cancelled" && o.status !== "billed" &&
        o.ticket_status !== "CLOSED" && o.ticket_status !== "CANCELLED" && o.ticket_status !== "BILLED"
      );
      if (ordersA.length === 0) {
        return { data: null, error: new Error(`TABLE_A_EMPTY: Table ${a} has no active session to swap`) };
      }
      if (ordersB.length === 0) {
        return { data: null, error: new Error(`TABLE_B_EMPTY: Table ${b} has no active session to swap`) };
      }
      ordersA.forEach(ord => {
        ord.table_number = b;
        ord.notes = (ord.notes || '').replace(new RegExp(`\\[TABLE:\\s*${a}\\]`, 'gi'), `[TABLE: ${b}]`);
      });
      ordersB.forEach(ord => {
        ord.table_number = a;
        ord.notes = (ord.notes || '').replace(new RegExp(`\\[TABLE:\\s*${b}\\]`, 'gi'), `[TABLE: ${a}]`);
      });
      return {
        data: {
          success: true,
          table_a: a,
          table_b: b,
          table_a_orders_count: ordersA.length,
          table_b_orders_count: ordersB.length,
          staff_name: params.p_staff_name || "Staff",
          message: `Table ${a} and Table ${b} successfully swapped`
        },
        error: null
      };
    }
    return { data: null, error: new Error(`Unknown mock RPC: ${fnName}`) };
  }

  return {
    from: createQueryBuilder,
    rpc,
    _sandboxStore: store
  };
}
