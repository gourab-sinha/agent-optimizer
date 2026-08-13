import express from 'express';
import { runOptimizeStep, listOptimizeSteps, getOptimizeStatus } from '../services/optimizePipelineService.js';

const router = express.Router();

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
 */
router.post('/step', async (req, res) => {
  try {
    const { agentId, locationId, companyId, step, testCaseIds } = req.body || {};
    const result = await runOptimizeStep({
      agentId,
      locationId,
      companyId,
      step,
      testCaseIds,
    });
    const status = result.blocked && result.reason === 'no_calls' ? 200 : 200;
    res.status(status).json({ success: true, ...result });
  } catch (error) {
    console.error('Optimize step failed:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
