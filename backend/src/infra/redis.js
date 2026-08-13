/**
 * Redis Connection (Optional)
 * Used for caching and job queues when REDIS_URL is configured.
 * Falls back gracefully when Redis is not available.
 */

import logger from './logger.js';

let redisClient = null;
let redisAvailable = false;

/**
 * Initialize Redis connection if REDIS_URL is set
 */
export async function initRedis() {
  if (!process.env.REDIS_URL) {
    logger.info('Redis not configured (REDIS_URL not set) - caching and queues disabled');
    return null;
  }

  try {
    // Dynamic import to avoid requiring ioredis when not needed
    const { default: Redis } = await import('ioredis');

    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.error('Redis connection failed after 3 retries');
          return null; // Stop retrying
        }
        return Math.min(times * 100, 3000);
      },
      lazyConnect: true,
    });

    redisClient.on('connect', () => {
      redisAvailable = true;
      logger.info('Redis connected');
    });

    redisClient.on('error', (err) => {
      redisAvailable = false;
      logger.error('Redis error', { error: err });
    });

    redisClient.on('close', () => {
      redisAvailable = false;
      logger.warn('Redis connection closed');
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    logger.warn('Redis initialization failed - continuing without Redis', { error: error.message });
    return null;
  }
}

/**
 * Get Redis client (may be null if not configured/available)
 */
export function getRedis() {
  return redisClient;
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable() {
  return redisAvailable && redisClient !== null;
}

/**
 * Close Redis connection
 */
export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    redisAvailable = false;
    logger.info('Redis connection closed');
  }
}

/**
 * Cache wrapper with fallback
 * If Redis is unavailable, functions execute without caching
 */
export const cache = {
  async get(key) {
    if (!isRedisAvailable()) return null;
    try {
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.warn('Cache get failed', { key, error: error.message });
      return null;
    }
  },

  async set(key, value, ttlSeconds = 3600) {
    if (!isRedisAvailable()) return false;
    try {
      await redisClient.setex(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.warn('Cache set failed', { key, error: error.message });
      return false;
    }
  },

  async del(key) {
    if (!isRedisAvailable()) return false;
    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      logger.warn('Cache del failed', { key, error: error.message });
      return false;
    }
  },

  async invalidatePattern(pattern) {
    if (!isRedisAvailable()) return false;
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
      return true;
    } catch (error) {
      logger.warn('Cache invalidate failed', { pattern, error: error.message });
      return false;
    }
  },
};

// Export for backwards compatibility
export const redis = {
  get client() {
    return redisClient;
  },
  get available() {
    return redisAvailable;
  },
  ping: async () => {
    if (!isRedisAvailable()) return null;
    return redisClient.ping();
  },
};

export default {
  initRedis,
  getRedis,
  isRedisAvailable,
  closeRedis,
  cache,
  redis,
};
