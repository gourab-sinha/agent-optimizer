/**
 * Request Context Middleware
 * Adds request ID, timing, and context tracking for observability.
 * Non-breaking: works alongside existing middleware.
 */

import { randomUUID } from 'crypto';
import { metrics, METRIC_NAMES } from './metrics.js';
import logger from './logger.js';

/**
 * Middleware to add request context and timing
 */
export function requestContextMiddleware(req, res, next) {
  // Generate or use existing request ID
  req.id = req.headers['x-request-id'] || randomUUID();
  req.startTime = process.hrtime.bigint();

  // Add request ID to response headers
  res.setHeader('X-Request-ID', req.id);

  // Extract tenant context
  req.tenantContext = {
    locationId: req.params?.locationId || req.body?.locationId || req.query?.locationId || null,
    companyId: req.params?.companyId || req.body?.companyId || req.query?.companyId || null,
    agentId: req.params?.agentId || req.body?.agentId || req.query?.agentId || null,
  };

  // Track request completion
  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - req.startTime) / 1_000_000;

    const labels = {
      method: req.method,
      path: getRoutePath(req),
      status: res.statusCode.toString(),
    };

    // Record metrics
    metrics.observe(METRIC_NAMES.HTTP_REQUEST_DURATION, labels, durationMs);
    metrics.inc(METRIC_NAMES.HTTP_REQUEST_TOTAL, labels);

    if (res.statusCode >= 400) {
      metrics.inc(METRIC_NAMES.HTTP_REQUEST_ERRORS, labels);
    }

    // Log slow requests
    if (durationMs > 1000) {
      logger.warn('Slow request', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        durationMs,
        statusCode: res.statusCode,
        ...req.tenantContext,
      });
    }
  });

  next();
}

/**
 * Get normalized route path for metrics (avoid high cardinality)
 */
function getRoutePath(req) {
  // Use the matched route pattern if available (Express 5)
  if (req.route?.path) {
    return req.baseUrl + req.route.path;
  }

  // Fallback: normalize dynamic segments
  return req.path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/[a-zA-Z0-9]{20,}/g, ':id')
    .replace(/\/\d+\//g, '/:id/')
    .replace(/\/\d+$/g, '/:id');
}

/**
 * Metrics endpoint handler
 */
export function metricsHandler(req, res) {
  res.json(metrics.getMetrics());
}

/**
 * Health check with detailed status
 */
export async function healthHandler(req, res) {
  try {
    const db = (await import('../db/connection.js')).default;
    const dbHealth = await db.healthCheck();

    const health = {
      status: dbHealth.healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbHealth,
      memory: process.memoryUsage(),
    };

    // Add Redis health if available
    try {
      const { redis } = await import('./redis.js');
      if (redis) {
        const ping = await redis.ping();
        health.redis = { healthy: ping === 'PONG' };
      }
    } catch {
      // Redis not configured, skip
    }

    // Add queue stats if available
    try {
      const { getQueueStats } = await import('../jobs/queue.js');
      health.queue = await getQueueStats();
    } catch {
      // Queue not configured, skip
    }

    res.status(dbHealth.healthy ? 200 : 503).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
}

export default {
  requestContextMiddleware,
  metricsHandler,
  healthHandler,
};
