/**
 * LIMRA RESTAURANT — REFERENCE DATA CACHING & DEDUPLICATION LAYER
 * 
 * Provides high-efficiency, multi-tiered (In-Memory + LocalStorage) caching
 * with strict TTL enforcement, in-flight request coalescing (singleflight),
 * schema versioning, and mutation-driven invalidation.
 */

const CACHE_VERSION = 'v1';
const KEY_PREFIX = `limra_ref_${CACHE_VERSION}_`;

export const DEFAULT_TTLS = {
  menu_overrides: 5 * 60 * 1000,    // 5 minutes
  combos: 5 * 60 * 1000,            // 5 minutes
  custom_dishes: 5 * 60 * 1000,     // 5 minutes
  delivery_areas: 15 * 60 * 1000,   // 15 minutes
  coupons: 2 * 60 * 1000            // 2 minutes
};

// Tier 1: In-Memory cache map
const memoryStore = new Map();

// In-Flight Promise coalescing map
const inFlightFetches = new Map();

// Telemetry & metrics for performance auditing
export const cacheStats = {
  hits: 0,
  misses: 0,
  deduped: 0,
  invalidations: 0
};

/**
 * Initialize cache and evict legacy or mismatched cache schemas
 */
function evictOutdatedCacheSchemas() {
  if (typeof localStorage === 'undefined') return;
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('limra_ref_') && !k.startsWith(KEY_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    // Ignore storage quota or access errors
  }
}

// Run schema eviction once on module load
evictOutdatedCacheSchemas();

/**
 * Read from Tier 1 (Memory) or Tier 2 (LocalStorage) if valid
 */
export function getCachedRef(key) {
  const now = Date.now();

  // 1. Check L1 In-Memory cache
  const memEntry = memoryStore.get(key);
  if (memEntry) {
    if (memEntry.expiresAt > now) {
      cacheStats.hits++;
      return memEntry.data;
    }
    memoryStore.delete(key);
  }

  // 2. Check L2 LocalStorage cache
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(`${KEY_PREFIX}${key}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.expiresAt > now && parsed.version === CACHE_VERSION) {
          // Promote back into L1 memory cache
          memoryStore.set(key, { data: parsed.data, expiresAt: parsed.expiresAt });
          cacheStats.hits++;
          return parsed.data;
        }
        localStorage.removeItem(`${KEY_PREFIX}${key}`);
      }
    } catch (e) {
      // Ignore JSON parse or storage read errors
    }
  }

  cacheStats.misses++;
  return null;
}

/**
 * Write to Tier 1 and Tier 2 cache with expiration
 */
export function setRefCache(key, data, customTtlMs = null) {
  const ttl = customTtlMs ?? (DEFAULT_TTLS[key] || 5 * 60 * 1000);
  const expiresAt = Date.now() + ttl;

  // L1 write
  memoryStore.set(key, { data, expiresAt });

  // L2 write
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(`${KEY_PREFIX}${key}`, JSON.stringify({
        data,
        expiresAt,
        version: CACHE_VERSION
      }));
    } catch (e) {
      // Storage quota reached or restricted
    }
  }
}

/**
 * Invalidate a specific reference cache entry (e.g. after an admin edit)
 */
export function invalidateRefCache(key) {
  memoryStore.delete(key);
  cacheStats.invalidations++;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(`${KEY_PREFIX}${key}`);
    } catch (e) {}
  }
}

/**
 * Invalidate all reference caches (e.g. on full reset or schema change)
 */
export function invalidateAllRefCaches() {
  memoryStore.clear();
  cacheStats.invalidations++;
  if (typeof localStorage !== 'undefined') {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(KEY_PREFIX)) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }
}

/**
 * Get or fetch reference data with singleflight deduplication and TTL caching
 * 
 * @param {string} key - Cache identifier (e.g. 'menu_overrides', 'combos')
 * @param {Function} fetcher - Async function to retrieve authoritative data from Supabase/API
 * @param {boolean} forceRefresh - If true, bypass cache and fetch fresh data
 * @param {number} [ttlMs] - Optional custom TTL in milliseconds
 * @returns {Promise<any>}
 */
export async function getOrFetchRef(key, fetcher, forceRefresh = false, ttlMs = null) {
  // If not forcing refresh, check cache first
  if (!forceRefresh) {
    const cached = getCachedRef(key);
    if (cached !== null) {
      return cached;
    }
  }

  // Deduplicate in-flight concurrent requests (Singleflight)
  if (inFlightFetches.has(key)) {
    cacheStats.deduped++;
    return await inFlightFetches.get(key);
  }

  // Dispatch fetcher and share promise with concurrent callers
  const fetchPromise = (async () => {
    try {
      const freshData = await fetcher();
      if (freshData !== undefined && freshData !== null) {
        setRefCache(key, freshData, ttlMs);
      }
      return freshData;
    } catch (err) {
      // Graceful degradation: if network fails, check if we have expired cache to return
      const expiredEntry = memoryStore.get(key);
      if (expiredEntry) {
        console.warn(`[ReferenceCache] Fetch failed for ${key}, falling back to expired memory cache:`, err);
        return expiredEntry.data;
      }
      throw err;
    } finally {
      inFlightFetches.delete(key);
    }
  })();

  inFlightFetches.set(key, fetchPromise);
  return await fetchPromise;
}

/**
 * Return current telemetry stats
 */
export function getCacheStats() {
  return {
    ...cacheStats,
    inMemoryKeys: Array.from(memoryStore.keys()),
    inFlightCount: inFlightFetches.size
  };
}
