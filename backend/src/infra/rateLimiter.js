/**
 * Multi-tenant Rate Limiter
 * Per-location and per-company rate limiting with Redis backend.
 * Falls back to in-memory limiting when Redis is unavailable.
 */

import { isRedisAvailable, getRedis } from './redis.js';
import logger from './logger.js';
import { metrics, METRIC_NAMES } from './metrics.js';

// In-memory fallback store
const memoryStore = new Map();

// Default limits
const LIMITS = {
  // Per location limits (for API calls)
  LOCATION_REQUESTS_PER_MINUTE: parseInt(process.env.LOCATION_RPM || '100', 10),
  LOCATION_REQUESTS_PER_HOUR: parseInt(process.env.LOCATION_RPH || '2000', 10),

  // Per company limits (aggregate across all locations)
  COMPANY_REQUESTS_PER_MINUTE: parseInt(process.env.COMPANY_RPM || '500', 10),
  COMPANY_REQUESTS_PER_HOUR: parseInt(process.env.COMPANY_RPH || '10000', 10),

  // LLM-specific limits (expensive operations)
  LOCATION_LLM_CALLS_PER_HOUR: parseInt(process.env.LOCATION_LLM_PER_HOUR || '100', 10),
  COMPANY_LLM_CALLS_PER_HOUR: parseInt(process.env.COMPANY_LLM_PER_HOUR || '500', 10),

  // Test run limits
  LOCATION_TESTS_PER_HOUR: parseInt(process.env.LOCATION_TESTS_PER_HOUR || '20', 10),
};

/**
 * Check if request is rate limited
 * @param {string} key - Rate limit key
 * @param {number} limit - Max requests allowed
 * @param {number} windowSeconds - Time window in seconds
 * @returns {Promise<{limited: boolean, remaining: number, resetIn: number}>}
 */
async function checkLimit(key, limit, windowSeconds) {
  if (isRedisAvailable()) {
    return checkLimitRedis(key, limit, windowSeconds);
  }
  return checkLimitMemory(key, limit, windowSeconds);
}

/**
 * Redis-based rate limit check
 */
async function checkLimitRedis(key, limit, windowSeconds) {
  const redis = getRedis();
  const now = Date.now();
  const windowStart = now - (windowSeconds * 1000);

  const multi = redis.multi();

  // Remove old entries
  multi.zremrangebyscore(key, 0, windowStart);

  // Count current entries
  multi.zcard(key);

  // Add current request
  multi.zadd(key, now, `${now}-${Math.random()}`);

  // Set expiry
  multi.expire(key, windowSeconds);

  const results = await multi.exec();
  const count = results[1][1];

  const limited = count >= limit;
  const remaining = Math.max(0, limit - count - 1);

  // Calculate reset time
  const oldestResult = await redis.zrange(key, 0, 0, 'WITHSCORES');
  const resetIn = oldestResult.length >= 2
    ? Math.ceil((parseInt(oldestResult[1]) + (windowSeconds * 1000) - now) / 1000)
    : windowSeconds;

  return { limited, remaining, resetIn, count };
}

/**
 * In-memory rate limit check (fallback)
 */
function checkLimitMemory(key, limit, windowSeconds) {
  const now = Date.now();
  const windowStart = now - (windowSeconds * 1000);

  // Get or create bucket
  let bucket = memoryStore.get(key);
  if (!bucket) {
    bucket = { requests: [] };
    memoryStore.set(key, bucket);
  }

  // Remove old entries
  bucket.requests = bucket.requests.filter(ts => ts > windowStart);

  const count = bucket.requests.length;
  const limited = count >= limit;
  const remaining = Math.max(0, limit - count - 1);

  if (!limited) {
    bucket.requests.push(now);
  }

  const resetIn = bucket.requests.length > 0
    ? Math.ceil((bucket.requests[0] + (windowSeconds * 1000) - now) / 1000)
    : windowSeconds;

  return { limited, remaining, resetIn, count };
}

/**
 * Create rate limit middleware for location-based limiting
 */
export function locationRateLimiter(options = {}) {
  const {
    windowSeconds = 60,
    maxRequests = LIMITS.LOCATION_REQUESTS_PER_MINUTE,
    keyPrefix = 'ratelimit:location:',
  } = options;

  return async (req, res, next) => {
    const locationId = req.tenantContext?.locationId
      || req.params?.locationId
      || req.body?.locationId
      || req.query?.locationId;

    if (!locationId) {
      // No location context, skip rate limiting
      return next();
    }

    const key = `${keyPrefix}${locationId}`;
    const result = await checkLimit(key, maxRequests, windowSeconds);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + result.resetIn);

    if (result.limited) {
      metrics.inc(METRIC_NAMES.RATE_LIMIT_HIT, {
        type: 'location',
        locationId,
        path: req.path,
      });

      logger.warn('Rate limit exceeded', {
        type: 'location',
        locationId,
        path: req.path,
        count: result.count,
        limit: maxRequests,
      });

      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${result.resetIn} seconds.`,
        retryAfter: result.resetIn,
      });
    }

    next();
  };
}

/**
 * Create rate limit middleware for company-based limiting
 */
export function companyRateLimiter(options = {}) {
  const {
    windowSeconds = 60,
    maxRequests = LIMITS.COMPANY_REQUESTS_PER_MINUTE,
    keyPrefix = 'ratelimit:company:',
  } = options;

  return async (req, res, next) => {
    const companyId = req.tenantContext?.companyId
      || req.params?.companyId
      || req.body?.companyId
      || req.query?.companyId;

    if (!companyId) {
      // No company context, skip rate limiting
      return next();
    }

    const key = `${keyPrefix}${companyId}`;
    const result = await checkLimit(key, maxRequests, windowSeconds);

    if (result.limited) {
      metrics.inc(METRIC_NAMES.RATE_LIMIT_HIT, {
        type: 'company',
        companyId,
        path: req.path,
      });

      logger.warn('Rate limit exceeded', {
        type: 'company',
        companyId,
        path: req.path,
        count: result.count,
        limit: maxRequests,
      });

      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Company rate limit exceeded. Try again in ${result.resetIn} seconds.`,
        retryAfter: result.resetIn,
      });
    }

    next();
  };
}

/**
 * LLM operation rate limiter (more restrictive)
 */
export function llmRateLimiter(options = {}) {
  const {
    windowSeconds = 3600, // 1 hour
    maxRequests = LIMITS.LOCATION_LLM_CALLS_PER_HOUR,
  } = options;

  return locationRateLimiter({
    windowSeconds,
    maxRequests,
    keyPrefix: 'ratelimit:llm:location:',
  });
}

/**
 * Test run rate limiter
 */
export function testRateLimiter(options = {}) {
  const {
    windowSeconds = 3600, // 1 hour
    maxRequests = LIMITS.LOCATION_TESTS_PER_HOUR,
  } = options;

  return locationRateLimiter({
    windowSeconds,
    maxRequests,
    keyPrefix: 'ratelimit:tests:location:',
  });
}

/**
 * Clean up in-memory store periodically
 */
setInterval(() => {
  const now = Date.now();
  const maxAge = 3600 * 1000; // 1 hour

  for (const [key, bucket] of memoryStore.entries()) {
    bucket.requests = bucket.requests.filter(ts => ts > now - maxAge);
    if (bucket.requests.length === 0) {
      memoryStore.delete(key);
    }
  }
}, 60000); // Every minute

export default {
  locationRateLimiter,
  companyRateLimiter,
  llmRateLimiter,
  testRateLimiter,
  LIMITS,
};
