/**
 * Worker Process Entry Point
 * Run this separately from the main API server for horizontal scaling.
 *
 * Usage:
 *   NODE_ENV=production WORKER_MODE=separate node src/worker.js
 */

import dotenv from 'dotenv';
import logger from './infra/logger.js';
import { initRedis, closeRedis } from './infra/redis.js';
import { initQueue, startWorker, stopQueue, getQueueStats } from './jobs/queue.js';
import db from './db/connection.js';

dotenv.config();

async function start() {
  try {
    logger.info('Worker process starting...');

    // Check database connection (workers need DB access)
    logger.info('Checking database connection...');
    const dbHealthy = await db.healthCheck();
    if (!dbHealthy.healthy) {
      throw new Error('Database connection failed');
    }
    logger.info('Database connected');

    // Initialize Redis (required for worker)
    logger.info('Initializing Redis...');
    await initRedis();

    // Initialize and start queue worker
    logger.info('Initializing job queue...');
    const queueInitialized = await initQueue();

    if (!queueInitialized) {
      throw new Error('Job queue initialization failed - Redis is required for worker mode');
    }

    await startWorker();

    logger.info('Worker process started successfully', {
      pid: process.pid,
      concurrency: process.env.QUEUE_CONCURRENCY || 5,
    });

    // Periodic stats logging
    setInterval(async () => {
      const stats = await getQueueStats();
      logger.info('Queue stats', stats);
    }, 60000); // Every minute

  } catch (error) {
    logger.error('Worker startup failed', { error });
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info(`Worker received ${signal}, shutting down...`);

  try {
    await stopQueue();
    await closeRedis();
    await db.close();

    logger.info('Worker shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Worker shutdown error', { error });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

start();
