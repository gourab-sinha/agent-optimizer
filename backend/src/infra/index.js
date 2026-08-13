/**
 * Infrastructure Module
 * Central export for all observability and scaling infrastructure.
 */

export { logger } from './logger.js';
export { metrics, METRIC_NAMES } from './metrics.js';
export { requestContextMiddleware, metricsHandler, healthHandler } from './requestContext.js';
export { initRedis, getRedis, isRedisAvailable, closeRedis, cache, redis } from './redis.js';

export default {
  logger: (await import('./logger.js')).default,
  metrics: (await import('./metrics.js')).default,
};
