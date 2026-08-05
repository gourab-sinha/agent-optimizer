import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import db from './db/connection.js';
import apiRoutes from './routes/index.js';

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

// Security headers
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.LOG_FORMAT || 'combined'));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', limiter);

// ============================================================================
// Routes
// ============================================================================

// Root health check (outside /api for monitoring)
app.get('/health', async (req, res) => {
  try {
    const dbHealthy = await db.healthCheck();

    const health = {
      status: dbHealthy.healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbHealthy,
      environment: process.env.NODE_ENV || 'development'
    };

    const statusCode = dbHealthy.healthy ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Mount API routes under /api prefix
app.use('/api', apiRoutes);

// Serve frontend (if built)
if (process.env.FRONTEND_BUILD_PATH) {
  app.use(express.static(process.env.FRONTEND_BUILD_PATH));

  app.get('*', (req, res) => {
    res.sendFile('index.html', { root: process.env.FRONTEND_BUILD_PATH });
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
  console.error('Unhandled error:', err);

  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal Server Error'
    : err.message;

  res.status(statusCode).json({
    error: err.name || 'Error',
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// ============================================================================
// Startup
// ============================================================================

async function start() {
  try {
    console.log('🚀 Voice AI Agent Optimizer');
    console.log('================================');
    console.log('');

    // Check database connection
    console.log('Checking database connection...');
    const dbHealthy = await db.healthCheck();

    if (!dbHealthy) {
      throw new Error('Database connection failed');
    }

    // Start server
    app.listen(PORT, HOST, () => {
      console.log('');
      console.log('✓ Server started successfully');
      console.log(`  - Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`  - URL: http://${HOST}:${PORT}`);
      console.log(`  - Health: http://${HOST}:${PORT}/health`);
      console.log(`  - API: http://${HOST}:${PORT}/api`);
      console.log('');
      console.log('Press Ctrl+C to stop');
    });

  } catch (error) {
    console.error('');
    console.error('✗ Startup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(signal) {
  console.log('');
  console.log(`Received ${signal}, shutting down gracefully...`);

  try {
    // Stop accepting new connections
    // (Express doesn't have a built-in close method, would need http.Server)

    // Stop job queue
    const { stopQueue } = await import('./jobs/queue.js');
    await stopQueue();

    // Close database connections
    await db.closePool();

    console.log('✓ Shutdown complete');
    process.exit(0);

  } catch (error) {
    console.error('✗ Shutdown error:', error.message);
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

export default app;
