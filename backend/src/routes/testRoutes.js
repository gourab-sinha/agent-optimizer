import express from 'express';
import testGenerationService from '../services/testGenerationService.js';
import testRunnerService from '../services/testRunnerService.js';

const router = express.Router();

/**
 * Test Case Routes
 * Endpoints for generating and managing test cases
 */

/**
 * @route   POST /api/tests/generate
 * @desc    Generate test cases for an agent
 * @body    { agentId, maxTotalCases?, minHappyPath?, edgeCasePerPattern? }
 *          (Also supports legacy: happyPathCount, edgeCaseCount)
 */
router.post('/generate', async (req, res) => {
  try {
    const {
      agentId,
      maxTotalCases,
      minHappyPath,
      edgeCasePerPattern,
      // Legacy parameter support
      happyPathCount,
      edgeCaseCount
    } = req.body;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'agentId is required'
      });
    }

    // Build options object with new or legacy parameters
    const options = {};

    // New parameters (preferred)
    if (maxTotalCases !== undefined) options.maxTotalCases = maxTotalCases;
    if (minHappyPath !== undefined) options.minHappyPath = minHappyPath;
    if (edgeCasePerPattern !== undefined) options.edgeCasePerPattern = edgeCasePerPattern;

    // Legacy parameters (backward compatibility)
    // If old params provided and new ones aren't, convert them
    if (happyPathCount !== undefined && minHappyPath === undefined) {
      options.minHappyPath = happyPathCount;
    }
    if (edgeCaseCount !== undefined && edgeCasePerPattern === undefined) {
      options.edgeCasePerPattern = edgeCaseCount;
    }

    const result = await testGenerationService.generateTestCases(agentId, options);

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

/**
 * @route   POST /api/tests/run
 * @desc    Run test cases for an agent
 * @body    { agentId, testCaseIds?, runsPerCase?, trigger? }
 */
router.post('/run', async (req, res) => {
  try {
    const { agentId, testCaseIds, runsPerCase, trigger } = req.body;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'agentId is required'
      });
    }

    const result = await testRunnerService.runTests(agentId, {
      testCaseIds,
      runsPerCase,
      trigger
    });

    res.json(result);
  } catch (error) {
    console.error('Test run error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/tests/runs/:testRunId
 * @desc    Get test run details
 */
router.get('/runs/:testRunId', async (req, res) => {
  try {
    const { testRunId } = req.params;
    const testRun = await testRunnerService.getTestRun(testRunId);

    res.json({
      success: true,
      testRun
    });
  } catch (error) {
    console.error('Get test run error:', error);
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/tests/runs/:testRunId/results
 * @desc    Get test results for a test run
 */
router.get('/runs/:testRunId/results', async (req, res) => {
  try {
    const { testRunId } = req.params;
    const results = await testRunnerService.getTestResults(testRunId);

    res.json({
      success: true,
      testRunId,
      results,
      count: results.length
    });
  } catch (error) {
    console.error('Get test results error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/tests/agent/:agentId/runs
 * @desc    Get test runs for an agent
 * @query   limit=10
 */
router.get('/agent/:agentId/runs', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { limit } = req.query;

    const runs = await testRunnerService.getTestRunsForAgent(agentId, {
      limit: limit ? parseInt(limit) : 10
    });

    res.json({
      success: true,
      agentId,
      runs,
      count: runs.length
    });
  } catch (error) {
    console.error('Get test runs error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
