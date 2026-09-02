import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_KEY,
  pingDatabase
} from "./supabase.js";

export const INSFORGE_URL = SUPABASE_URL;
export const INSFORGE_ANON_KEY = SUPABASE_ANON_KEY;
export const INSFORGE_ADMIN_KEY = SUPABASE_SERVICE_KEY;

export const insforge = supabase;
export { pingDatabase, supabase };

/**
 * Raw query compatibility helper: maps SQL queries or table queries to Supabase
 */
export async function queryInsforge(sqlOrTable) {
  // If a simple SELECT COUNT(*) or table query was passed, handle appropriately
  if (typeof sqlOrTable === "string") {
    const countMatch = sqlOrTable.match(/SELECT\s+COUNT\(\*\)\s+as\s+count\s+FROM\s+(?:public\.)?(\w+)/i);
    if (countMatch) {
      const tbl = countMatch[1];
      const { count, error } = await supabase.from(tbl).select("*", { count: "exact", head: true });
      if (!error) {
        return [{ count: count || 0 }];
      }
    }

    const selectAllMatch = sqlOrTable.match(/SELECT\s+\*\s+FROM\s+(?:public\.)?(\w+)(?:\s+ORDER\s+BY\s+(\w+)\s+(ASC|DESC))?/i);
    if (selectAllMatch) {
      const tbl = selectAllMatch[1];
      const col = selectAllMatch[2];
      const dir = selectAllMatch[3];
      let q = supabase.from(tbl).select("*");
      if (col) q = q.order(col, { ascending: dir ? dir.toUpperCase() === "ASC" : true });
      const { data, error } = await q;
      if (!error && data) return data;
    }
  }

  return [];
}

export default supabase;
