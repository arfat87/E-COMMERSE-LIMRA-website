import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import {
  isProductionEnvironment,
  isProductionDatabaseUrl,
  createTestDatabaseSandbox
} from "./test-guard.js";

const isTestEnv = process.env.NODE_ENV === "test" || process.env.LIMRA_TEST_ENV === "true";

// Dedicated Development / Testing Supabase project support
const devSupabaseUrl = process.env.SUPABASE_TEST_URL || process.env.DEV_SUPABASE_URL;
const devSupabaseAnonKey = process.env.SUPABASE_TEST_ANON_KEY || process.env.DEV_SUPABASE_ANON_KEY;
const devSupabaseServiceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY || process.env.DEV_SUPABASE_SERVICE_ROLE_KEY;

export const IS_TEST_MODE = isTestEnv;
export const USING_SEPARATE_DEV_DB = Boolean(isTestEnv && devSupabaseUrl && !isProductionDatabaseUrl(devSupabaseUrl));

let activeSupabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
let activeAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
let activeServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;

// When in test mode with a dedicated development database configured:
if (isTestEnv && devSupabaseUrl && !isProductionDatabaseUrl(devSupabaseUrl)) {
  activeSupabaseUrl = devSupabaseUrl;
  activeAnonKey = devSupabaseAnonKey || activeAnonKey;
  activeServiceKey = devSupabaseServiceKey || activeServiceKey;
}

export const SUPABASE_URL = activeSupabaseUrl;

if (!SUPABASE_URL && !isTestEnv) {
  console.error("❌ CRITICAL: SUPABASE_URL is not set in .env file!");
}

export const SUPABASE_ANON_KEY = activeAnonKey;

if (!SUPABASE_ANON_KEY && !isTestEnv) {
  console.error("❌ CRITICAL: SUPABASE_ANON_KEY is not set in .env file!");
}

export const SUPABASE_SERVICE_KEY = activeServiceKey;

if (!SUPABASE_SERVICE_KEY && !isTestEnv) {
  console.warn("⚠️ WARNING: SUPABASE_SERVICE_ROLE_KEY is not set — falling back to anon key. RLS may block backend operations.");
}

// -----------------------------------------------------------------------------
// DATABASE ISOLATION & CLIENT INITIALIZATION
// -----------------------------------------------------------------------------
let clientInstance;
let isSandboxActive = false;

// If we are in test mode and NOT connected to a dedicated non-production dev database,
// activate the isolated in-memory test database sandbox to ensure NO production data is touched!
if (isTestEnv && (!devSupabaseUrl || isProductionDatabaseUrl(activeSupabaseUrl))) {
  clientInstance = createTestDatabaseSandbox();
  isSandboxActive = true;
} else {
  // Production or live dev client:
  const targetUrl = SUPABASE_URL || "https://ynrtlcasbndkrqeotgzt.supabase.co";
  const targetKey = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY || "dummy_key_for_offline";
  clientInstance = createClient(targetUrl, targetKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export const IS_DATABASE_SANDBOX_ACTIVE = isSandboxActive;
export const supabase = clientInstance;

// Alias for backward compatibility
export const insforge = supabase;

/**
 * Ping Supabase database and return latency metrics
 */
export async function pingDatabase() {
  const start = Date.now();
  if (!SUPABASE_URL || SUPABASE_URL.includes("your-project.supabase.co")) {
    return {
      status: "pending_credentials",
      message: "Please configure your live Supabase credentials in .env",
      url: SUPABASE_URL,
      latencyMs: 0,
      serverTime: new Date().toISOString()
    };
  }

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Database ping timeout (3s)")), 3000)
    );
    const pingPromise = supabase.from("printer_settings").select("id").limit(1);

    const { data, error } = await Promise.race([pingPromise, timeoutPromise]);
    const latencyMs = Date.now() - start;

    if (error && error.code !== "PGRST116") {
      return {
        status: "notice",
        message: error.message,
        url: SUPABASE_URL,
        latencyMs,
        serverTime: new Date().toISOString()
      };
    }
    return {
      status: "connected",
      database: "Supabase PostgreSQL",
      url: SUPABASE_URL,
      latencyMs,
      serverTime: new Date().toISOString()
    };
  } catch (err) {
    return {
      status: "notice",
      url: SUPABASE_URL,
      latencyMs: Date.now() - start,
      message: err.message
    };
  }
}

/**
 * Helper to query Supabase tables or run RPC
 */
export async function querySupabase(tableName, options = {}) {
  let query = supabase.from(tableName).select(options.select || "*");
  if (options.limit) query = query.limit(options.limit);
  if (options.order) query = query.order(options.order.column, { ascending: options.order.ascending });
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export default supabase;
