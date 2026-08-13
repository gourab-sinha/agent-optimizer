import express from 'express';
import { runOptimizeStep, listOptimizeSteps, getOptimizeStatus } from '../services/optimizePipelineService.js';
import { addJobAndWait, isQueueAvailable, JOB_NAMES } from '../jobs/queue.js';
import logger from '../infra/logger.js';

const router = express.Router();

// Steps that should be processed via job queue (CPU/LLM intensive)
const HEAVY_STEPS = ['rubric', 'evaluate', 'patterns', 'tests', 'run', 'recs'];

router.get('/steps', (_req, res) => {
  res.json({ success: true, steps: listOptimizeSteps() });
});

router.get('/status/:agentId', async (req, res) => {
  try {
    const status = await getOptimizeStatus(req.params.agentId);
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/optimize/step
 * Run one stage of the Optimize pipeline.
 * Body: { agentId, locationId?, companyId?, step, testCaseIds? }
 *
 * Heavy steps (rubric, evaluate, patterns, tests, run, recs) are processed
 * via the job queue when Redis is available, enabling horizontal scaling.
 */
router.post('/step', async (req, res) => {
  try {
    const { agentId, locationId, companyId, step, testCaseIds } = req.body || {};

    let result;

    // Use job queue for heavy operations when available
    if (HEAVY_STEPS.includes(step) && isQueueAvailable()) {
      logger.info('Queueing optimize step', { agentId, step });
      result = await addJobAndWait(JOB_NAMES.OPTIMIZE_STEP, {
        agentId,
        locationId,
        companyId,
        step,
        testCaseIds,
      }, { timeout: 300000 }); // 5 minute timeout for LLM operations
    } else {
      // Run directly for light operations or when queue not available
      result = await runOptimizeStep({
        agentId,
        locationId,
        companyId,
        step,
        testCaseIds,
      });
    }

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Optimize step failed', { error: error.message, step: req.body?.step });
    res.status(error.status || 500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
