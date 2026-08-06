import express from 'express';
import patternDetectionService from '../services/patternDetectionService.js';

const router = express.Router();

/**
 * Pattern Detection Routes
 * Endpoints for identifying and viewing recurring issues
 */

/**
 * @route   POST /api/patterns/detect
 * @desc    Detect patterns from rubric findings
 * @body    { rubricId, minFailCount?, minImpactScore? }
 */
router.post('/detect', async (req, res) => {
  try {
    const { rubricId, minFailCount, minImpactScore } = req.body;

    if (!rubricId) {
      return res.status(400).json({
        success: false,
        error: 'rubricId is required'
      });
    }

    const result = await patternDetectionService.detectPatterns(rubricId, {
      minFailCount,
      minImpactScore
    });

    res.json(result);
  } catch (error) {
    console.error('Pattern detection error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/patterns/agent/:agentId
 * @desc    Get patterns for agent (latest version)
 */
router.get('/agent/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const patterns = await patternDetectionService.getPatternsForAgent(agentId);

    res.json({
      success: true,
      agentId,
      patterns,
      count: patterns.length
    });
  } catch (error) {
    console.error('Get patterns error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/patterns/version/:versionId
 * @desc    Get patterns for specific agent version
 */
router.get('/version/:versionId', async (req, res) => {
  try {
    const { versionId } = req.params;
    const patterns = await patternDetectionService.getPatternsForAgentVersion(versionId);

    res.json({
      success: true,
      agentVersionId: versionId,
      patterns,
      count: patterns.length
    });
  } catch (error) {
    console.error('Get patterns error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/patterns/:patternId
 * @desc    Get pattern details with sample findings
 */
router.get('/:patternId', async (req, res) => {
  try {
    const { patternId } = req.params;
    const pattern = await patternDetectionService.getPatternDetails(patternId);

    res.json({
      success: true,
      pattern
    });
  } catch (error) {
    console.error('Get pattern details error:', error);
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
