import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@insforge/sdk";

export const INSFORGE_URL =
  process.env.VITE_INSFORGE_URL ||
  process.env.API_BASE_URL ||
  process.env.INSFORGE_URL ||
  "https://vb9ucr22.us-east.insforge.app";

export const INSFORGE_ANON_KEY =
  process.env.VITE_INSFORGE_ANON_KEY ||
  process.env.INSFORGE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNzQ3MjZ9.CORVtgdxoKKq0AhdUN0RY8s1h3jHMUF3ZOB0CpmnoYk";

export const INSFORGE_ADMIN_KEY =
  process.env.INSFORGE_ADMIN_KEY ||
  process.env.API_KEY ||
  "ik_799af068e8f4fb05944d04497229fe7d";

// InsForge SDK Client instance
export const insforge = createClient({
  baseUrl: INSFORGE_URL,
  anonKey: INSFORGE_ANON_KEY
});

/**
 * Execute raw SQL query directly on InsForge PostgreSQL BaaS
 */
export async function queryInsforge(sql) {
  try {
    const res = await fetch(`${INSFORGE_URL}/api/database/advance/rawsql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": INSFORGE_ADMIN_KEY
      },
      body: JSON.stringify({ query: sql })
    });

    if (!res.ok) {
      const errText = await res.text();
      let parsed;
      try { parsed = JSON.parse(errText); } catch (e) { parsed = { message: errText }; }
      throw new Error(parsed.message || `InsForge Error (HTTP ${res.status})`);
    }

    const json = await res.json();
    return json.rows || json.data || (Array.isArray(json) ? json : []);
  } catch (err) {
    console.error("[InsForge Query Error]:", err.message);
    throw err;
  }
}

/**
 * Ping InsForge database and return latency metrics
 */
export async function pingDatabase() {
  const start = Date.now();
  const rows = await queryInsforge("SELECT 1 as ping, NOW() as server_time;");
  const latencyMs = Date.now() - start;
  return {
    status: "connected",
    url: INSFORGE_URL,
    latencyMs,
    serverTime: rows[0]?.server_time || new Date().toISOString()
  };
}

export default insforge;
