import express from 'express';
import testGenerationService from '../services/testGenerationService.js';

const router = express.Router();

/**
 * Test Case Routes
 * Endpoints for generating and managing test cases
 */

/**
 * @route   POST /api/tests/generate
 * @desc    Generate test cases for an agent
 * @body    { agentId, happyPathCount?, edgeCaseCount? }
 */
router.post('/generate', async (req, res) => {
  try {
    const { agentId, happyPathCount, edgeCaseCount } = req.body;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'agentId is required'
      });
    }

    const result = await testGenerationService.generateTestCases(agentId, {
      happyPathCount,
      edgeCaseCount
    });

    res.json(result);
  } catch (error) {
    console.error('Test generation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/tests/agent/:agentId
 * @desc    Get all test cases for an agent
 * @query   kind=happy_path|edge_case, includeArchived=true|false
 */
router.get('/agent/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { kind, includeArchived } = req.query;

    const testCases = await testGenerationService.getTestCases(agentId, {
      kind,
      includeArchived: includeArchived === 'true'
    });

    res.json({
      success: true,
      agentId,
      testCases,
      count: testCases.length
    });
  } catch (error) {
    console.error('Get test cases error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/tests/:testCaseId
 * @desc    Get test case details
 */
router.get('/:testCaseId', async (req, res) => {
  try {
    const { testCaseId } = req.params;
    const testCase = await testGenerationService.getTestCaseDetails(testCaseId);

    res.json({
      success: true,
      testCase
    });
  } catch (error) {
    console.error('Get test case error:', error);
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/tests/:testCaseId/archive
 * @desc    Archive or unarchive a test case
 * @body    { archived: true|false }
 */
router.put('/:testCaseId/archive', async (req, res) => {
  try {
    const { testCaseId } = req.params;
    const { archived = true } = req.body;

    const result = await testGenerationService.archiveTestCase(testCaseId, archived);

    res.json({
      success: true,
      testCaseId: result.id,
      archived
    });
  } catch (error) {
    console.error('Archive test case error:', error);
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
