/**
 * Job Queue Infrastructure
 * BullMQ-based background job processing for heavy operations.
 * Gracefully degrades when Redis is not available.
 */

import { isRedisAvailable, getRedis } from '../infra/redis.js';
import logger from '../infra/logger.js';
import { metrics, METRIC_NAMES } from '../infra/metrics.js';

let Queue, Worker, QueueEvents;
let optimizeQueue = null;
let optimizeWorker = null;
let queueEvents = null;
let isQueueInitialized = false;

// Job names
export const JOB_NAMES = {
  OPTIMIZE_STEP: 'optimize_step',
  SYNC_CALLS: 'sync_calls',
  EVALUATE_CALLS: 'evaluate_calls',
  RUN_TESTS: 'run_tests',
  GENERATE_RECOMMENDATIONS: 'generate_recommendations',
};

/**
 * Initialize the job queue (call after Redis is initialized)
 */
export async function initQueue() {
  if (!isRedisAvailable()) {
    logger.info('Job queue disabled (Redis not available) - using synchronous processing');
    return false;
  }

  try {
    // Dynamic import to avoid errors when Redis is not available
    const bullmq = await import('bullmq');
    Queue = bullmq.Queue;
    Worker = bullmq.Worker;
    QueueEvents = bullmq.QueueEvents;

    const redis = getRedis();
    const connection = {
      host: redis.options.host,
      port: redis.options.port,
      password: redis.options.password,
    };

    // Create optimize queue
    optimizeQueue = new Queue('optimize', {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 1000,
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours
        },
      },
    });

    // Queue events for monitoring
    queueEvents = new QueueEvents('optimize', { connection });

    queueEvents.on('completed', ({ jobId, returnvalue }) => {
      metrics.inc(METRIC_NAMES.QUEUE_JOBS_COMPLETED);
      logger.debug('Job completed', { jobId });
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      metrics.inc(METRIC_NAMES.QUEUE_JOBS_FAILED);
      logger.error('Job failed', { jobId, reason: failedReason });
    });

    isQueueInitialized = true;
    logger.info('Job queue initialized');
    return true;
  } catch (error) {
    logger.error('Failed to initialize job queue', { error: error.message });
    return false;
  }
}

/**
 * Start the worker process
 * Call this in worker mode or when running in single-process mode
 */
export async function startWorker() {
  if (!isQueueInitialized || !optimizeQueue) {
    logger.warn('Cannot start worker - queue not initialized');
    return false;
  }

  try {
    const redis = getRedis();
    const connection = {
      host: redis.options.host,
      port: redis.options.port,
      password: redis.options.password,
    };

    optimizeWorker = new Worker(
      'optimize',
      async (job) => {
        const timer = metrics.timer(METRIC_NAMES.QUEUE_JOB_DURATION, { name: job.name });

        try {
          logger.info('Processing job', {
            jobId: job.id,
            name: job.name,
            data: job.data,
          });

          // Import handler dynamically to avoid circular dependencies
          const result = await processJob(job);

          timer();
          return result;
        } catch (error) {
          timer();
          throw error;
        }
      },
      {
        connection,
        concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
        limiter: {
          max: parseInt(process.env.QUEUE_RATE_LIMIT || '10', 10),
          duration: 1000,
        },
      }
    );

    optimizeWorker.on('error', (error) => {
      logger.error('Worker error', { error: error.message });
    });

    logger.info('Worker started', {
      concurrency: process.env.QUEUE_CONCURRENCY || 5,
      rateLimit: process.env.QUEUE_RATE_LIMIT || 10,
    });

    return true;
  } catch (error) {
    logger.error('Failed to start worker', { error: error.message });
    return false;
  }
}

/**
 * Process a job based on its name
 */
async function processJob(job) {
  switch (job.name) {
    case JOB_NAMES.OPTIMIZE_STEP: {
      const { runOptimizeStep } = await import('../services/optimizePipelineService.js');
      return await runOptimizeStep(job.data);
    }

    case JOB_NAMES.SYNC_CALLS: {
      const { syncAgentCalls } = await import('../services/callSyncService.js');
      return await syncAgentCalls(job.data.locationId, job.data.agentId);
    }

    case JOB_NAMES.EVALUATE_CALLS: {
      const { evaluateCallsBatch } = await import('../services/rubricEvaluationService.js');
      return await evaluateCallsBatch(job.data.callIds, job.data.rubricId);
    }

    case JOB_NAMES.RUN_TESTS: {
      const { runTests } = await import('../services/testRunnerService.js');
      return await runTests(job.data.agentId, job.data.options);
    }

    case JOB_NAMES.GENERATE_RECOMMENDATIONS: {
      const { generateRecommendations } = await import('../recommend/index.js');
      return await generateRecommendations(job.data.versionId, job.data.options);
    }

    default:
      throw new Error(`Unknown job name: ${job.name}`);
  }
}

/**
 * Add a job to the queue
 * Falls back to synchronous execution if queue is not available
 */
export async function addJob(name, data, options = {}) {
  metrics.inc(METRIC_NAMES.QUEUE_JOBS_TOTAL, { name });

  if (!isQueueInitialized || !optimizeQueue) {
    // Fallback: execute synchronously
    logger.debug('Queue not available, executing job synchronously', { name });
    return await processJob({ name, data });
  }

  const job = await optimizeQueue.add(name, data, {
    priority: options.priority,
    delay: options.delay,
    jobId: options.jobId,
  });

  logger.debug('Job added to queue', { jobId: job.id, name });

  return {
    jobId: job.id,
    queued: true,
  };
}

/**
 * Add job and wait for result
 * Useful for API endpoints that need to return the result
 */
export async function addJobAndWait(name, data, options = {}) {
  if (!isQueueInitialized || !optimizeQueue) {
    // Fallback: execute synchronously
    return await processJob({ name, data });
  }

  const timeout = options.timeout || 300000; // 5 minutes default

  const job = await optimizeQueue.add(name, data, {
    priority: options.priority,
  });

  try {
    const result = await job.waitUntilFinished(queueEvents, timeout);
    return result;
  } catch (error) {
    if (error.message.includes('timeout')) {
      throw new Error(`Job ${job.id} timed out after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Get job status
 */
export async function getJobStatus(jobId) {
  if (!isQueueInitialized || !optimizeQueue) {
    return { status: 'unavailable' };
  }

  const job = await optimizeQueue.getJob(jobId);
  if (!job) {
    return { status: 'not_found' };
  }

  const state = await job.getState();
  const progress = job.progress || 0;

  return {
    status: state,
    progress,
    data: job.data,
    returnValue: job.returnvalue,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
  };
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  if (!isQueueInitialized || !optimizeQueue) {
    return { available: false };
  }

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    optimizeQueue.getWaitingCount(),
    optimizeQueue.getActiveCount(),
    optimizeQueue.getCompletedCount(),
    optimizeQueue.getFailedCount(),
    optimizeQueue.getDelayedCount(),
  ]);

  // Update gauge metrics
  metrics.set(METRIC_NAMES.QUEUE_DEPTH, { state: 'waiting' }, waiting);
  metrics.set(METRIC_NAMES.QUEUE_DEPTH, { state: 'active' }, active);
  metrics.set(METRIC_NAMES.QUEUE_DEPTH, { state: 'delayed' }, delayed);

  return {
    available: true,
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed,
  };
}

/**
 * Stop the queue and worker gracefully
 */
export async function stopQueue() {
  const promises = [];

  if (optimizeWorker) {
    promises.push(optimizeWorker.close());
    optimizeWorker = null;
  }

  if (queueEvents) {
    promises.push(queueEvents.close());
    queueEvents = null;
  }

  if (optimizeQueue) {
    promises.push(optimizeQueue.close());
    optimizeQueue = null;
  }

  await Promise.all(promises);
  isQueueInitialized = false;
  logger.info('Job queue stopped');
  return true;
}

/**
 * Check if queue is available
 */
export function isQueueAvailable() {
  return isQueueInitialized && optimizeQueue !== null;
}

export default {
  initQueue,
  startWorker,
  addJob,
  addJobAndWait,
  getJobStatus,
  getQueueStats,
  stopQueue,
  isQueueAvailable,
  JOB_NAMES,
};
