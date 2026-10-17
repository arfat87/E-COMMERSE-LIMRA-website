/**
 * In-Memory Sliding Window Rate Limiter for LIMRA API Endpoints
 * Protects sensitive endpoints against brute force and denial of service.
 */

const rateLimitStore = new Map();

// Periodic cleanup of stale IP buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now - record.resetTime > 60000) {
      rateLimitStore.delete(key);
    }
  }
}, 300000).unref();

/**
 * Check if a client request exceeds rate limits.
 * 
 * @param {object} req - HTTP request object
 * @param {object} options - Configuration { windowMs, maxRequests, keyPrefix }
 * @returns {{ allowed: boolean, remaining: number, resetInSeconds: number }}
 */
export function checkRateLimit(req, options = {}) {
  const windowMs = options.windowMs || 60000; // 1 minute default
  const maxRequests = options.maxRequests || 60; // 60 requests/min default
  const prefix = options.keyPrefix || "api";

  const clientIp =
    req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers?.["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "127.0.0.1";

  const key = `${prefix}:${clientIp}`;
  const now = Date.now();

  let record = rateLimitStore.get(key);

  if (!record || now > record.resetTime) {
    record = {
      count: 1,
      resetTime: now + windowMs
    };
    rateLimitStore.set(key, record);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetInSeconds: Math.ceil(windowMs / 1000)
    };
  }

  record.count += 1;
  const remaining = Math.max(0, maxRequests - record.count);
  const resetInSeconds = Math.ceil((record.resetTime - now) / 1000);

  if (record.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetInSeconds
    };
  }

  return {
    allowed: true,
    remaining,
    resetInSeconds
  };
}
