import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "https://your-project.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_anon_key";

export const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ADMIN_KEY ||
  SUPABASE_ANON_KEY;

// Create Supabase Admin client for backend operations
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

// Alias for backward compatibility
export const insforge = supabase;
export const mongodb = supabase;

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
