import express from 'express';
import {
  generateRubric,
  getRubric,
  evaluateCalls,
  getFindings,
} from '../controllers/analysisController.js';

const router = express.Router();

/**
 * Analysis Routes
 *
 * POST   /api/analysis/rubric/generate       - Generate rubric for agent version
 * GET    /api/analysis/rubric/:agentVersionId - Get rubric for agent version
 * POST   /api/analysis/evaluate              - Evaluate calls against rubric
 * GET    /api/analysis/findings/:callId      - Get findings for a call
 */

// Generate rubric for an agent version
router.post('/rubric/generate', generateRubric);

// Get rubric for an agent version
router.get('/rubric/:agentVersionId', getRubric);

// Evaluate calls against a rubric
router.post('/evaluate', evaluateCalls);

// Get findings for a call
router.get('/findings/:callId', getFindings);

export default router;
