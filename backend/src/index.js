import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import db from './db/connection.js';
import apiRoutes from './routes/index.js';
import { requestContextMiddleware, metricsHandler, healthHandler } from './infra/requestContext.js';
import { initRedis, closeRedis } from './infra/redis.js';
import logger from './infra/logger.js';
import { metrics, METRIC_NAMES } from './infra/metrics.js';
import { initQueue, startWorker, getQueueStats } from './jobs/queue.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Voice AI Agent Optimizer
 * Main application entry point
 */

// ============================================================================
// Middleware
// ============================================================================

// Trust proxy (required for ngrok and other reverse proxies)
app.set('trust proxy', 1);

// Request context and metrics (observability - non-breaking)
app.use(requestContextMiddleware);

// Security headers.
// Allow HighLevel to iframe the UI (Custom JS Optimize tab / Custom Pages).
// Disable X-Frame-Options so CSP frame-ancestors is the sole embed policy.
app.use(helmet({
  frameguard: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      frameAncestors: [
        "'self'",
        'https://*.gohighlevel.com',
        'https://*.leadconnectorhq.com',
        'https://*.msgsndr.com',
      ],
    },
  },
}));

// CORS — Custom JS on app.gohighlevel.com calls /api/embed/resolve
const ghlCorsOrigin = function ghlCorsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  const allowed = (
    origin === '*'
    || /\.gohighlevel\.com$/i.test(origin)
    || /\.leadconnectorhq\.com$/i.test(origin)
    || /\.msgsndr\.com$/i.test(origin)
    || /\.ngrok-free\.app$/i.test(origin)
    || /\.ngrok\.io$/i.test(origin)
    || origin === 'http://localhost:5173'
    || origin === 'http://localhost:3000'
  );
  callback(null, allowed ? origin : false);
};

app.use(cors({
  origin: process.env.CORS_ORIGIN === '*' || !process.env.CORS_ORIGIN ? '*' : ghlCorsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Version'],
  maxAge: 86400,
}));

app.use((req, res, next) => {
  if (req.method !== 'OPTIONS') return next();
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Version');
  res.header('Access-Control-Max-Age', '86400');
  return res.sendStatus(204);
});

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.LOG_FORMAT || 'combined'));
}

// Rate limiting. Dev/embed reload bursts easily (iframe remounts).
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max: parseInt(
    process.env.RATE_LIMIT_MAX_REQUESTS
      || (process.env.NODE_ENV === 'production' ? '300' : '2000'),
    10
  ),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || process.env.NODE_ENV === 'test',
  message: { success: false, error: 'Too many requests' },
  handler: (req, res, next, options) => {
    // Track rate limit hits for observability
    metrics.inc(METRIC_NAMES.RATE_LIMIT_HIT, {
      path: req.path,
      locationId: req.tenantContext?.locationId || 'unknown',
    });
    res.status(options.statusCode).json(options.message);
  },
});

app.use('/api/', limiter);

// ============================================================================
// Routes
// ============================================================================

// Root health check (outside /api for monitoring)
app.get('/health', healthHandler);

// Metrics endpoint for observability (protected in production)
app.get('/metrics', (req, res, next) => {
  // In production, require a secret token
  if (process.env.NODE_ENV === 'production') {
    const token = req.headers['x-metrics-token'] || req.query.token;
    if (token !== process.env.METRICS_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  metricsHandler(req, res);
});

// Mount API routes under /api prefix
app.use('/api', apiRoutes);

// Host Custom JS for the HighLevel loader (Agency Custom JS field is size-limited)
const ghlEmbedDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../ghl-embed');
app.use('/ghl-embed', express.static(ghlEmbedDir, {
  setHeaders: function setEmbedHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
  },
}));

// Serve frontend (if built)
if (process.env.FRONTEND_BUILD_PATH) {
  app.use(express.static(process.env.FRONTEND_BUILD_PATH));

  app.get('*', (req, res) => {
    res.sendFile('index.html', { root: process.env.FRONTEND_BUILD_PATH });
  });
}

// Test-only hook to exercise error middleware
if (process.env.NODE_ENV === 'test') {
  app.get('/__test_error__', (req, res, next) => {
    const err = new Error('forced test error');
    err.statusCode = 418;
    err.name = 'TestError';
    next(err);
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err,
    requestId: req.id,
    path: req.path,
    method: req.method,
    ...req.tenantContext,
  });

  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal Server Error'
    : err.message;

  res.status(statusCode).json({
    error: err.name || 'Error',
    message,
    requestId: req.id,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// ============================================================================
// Startup
// ============================================================================

async function start() {
  try {
    logger.info('Voice AI Agent Optimizer starting...');

    // Check database connection
    logger.info('Checking database connection...');
    const dbHealthy = await db.healthCheck();

    if (!dbHealthy.healthy) {
      throw new Error('Database connection failed');
    }
    logger.info('Database connected', { poolSize: dbHealthy.poolSize });

    // Initialize Redis (optional - graceful fallback if not configured)
    logger.info('Initializing Redis...');
    await initRedis();

    // Initialize job queue (requires Redis)
    logger.info('Initializing job queue...');
    const queueInitialized = await initQueue();
    if (queueInitialized) {
      // Start worker in same process (for single-process mode)
      // In production with multiple workers, run worker separately
      if (process.env.WORKER_MODE !== 'separate') {
        await startWorker();
      }
    }

    // Update DB pool metrics periodically
    setInterval(() => {
      const poolStats = db.pool;
      if (poolStats) {
        metrics.set(METRIC_NAMES.DB_POOL_SIZE, {}, poolStats.totalCount || 0);
        metrics.set(METRIC_NAMES.DB_POOL_IDLE, {}, poolStats.idleCount || 0);
        metrics.set(METRIC_NAMES.DB_POOL_WAITING, {}, poolStats.waitingCount || 0);
      }
    }, 10000);

    // Start server
    app.listen(PORT, HOST, () => {
      logger.info('Server started successfully', {
        environment: process.env.NODE_ENV || 'development',
        host: HOST,
        port: PORT,
        healthUrl: `http://${HOST}:${PORT}/health`,
        metricsUrl: `http://${HOST}:${PORT}/metrics`,
      });
    });

  } catch (error) {
    logger.error('Startup failed', { error });
    process.exit(1);
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    // Stop job queue
    const { stopQueue } = await import('./jobs/queue.js');
    await stopQueue();

    // Close Redis connection
    await closeRedis();

    // Close database connections
    if (typeof db.closePool === 'function') {
      await db.closePool();
    } else if (typeof db.close === 'function') {
      await db.close();
    }

    logger.info('Shutdown complete');
    process.exit(0);

  } catch (error) {
    logger.error('Shutdown error', { error });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // In production, might want to exit: process.exit(1);
});

// Start the application
if (process.env.NODE_ENV !== 'test') {
  start();
}

export { start, shutdown };
export default app;
