import express from 'express';
import callService from '../services/callService.js';
import {
  syncAgentCalls,
  getAgentCalls,
  getAgentCallStats,
  getLocationCalls
} from '../services/callSyncService.js';

const router = express.Router();

/**
 * Call Routes
 * HTTP endpoints for call management
 */

/**
 * @route   POST /api/calls/sync-agent/:agentId
 * @desc    Sync call logs for a specific agent from HighLevel
 * @access  Private
 */
router.post('/sync-agent/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { locationId } = req.body;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing locationId'
      });
    }

    const calls = await syncAgentCalls(locationId, agentId);

    res.json({
      success: true,
      data: calls,
      count: calls.length
    });

  } catch (error) {
    console.error('Failed to sync agent calls:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync agent calls',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/calls/agent/:agentId
 * @desc    Get call logs for a specific agent from database
 * @access  Private
 */
router.get('/agent/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { limit, offset, kind } = req.query;

    const calls = await getAgentCalls(agentId, {
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      kind
    });

    res.json({
      success: true,
      data: calls,
      count: calls.length
    });

  } catch (error) {
    console.error('Failed to get agent calls:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent calls',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/calls/agent/:agentId/stats
 * @desc    Get call statistics for an agent
 * @access  Private
 */
router.get('/agent/:agentId/stats', async (req, res) => {
  try {
    const { agentId } = req.params;

    const stats = await getAgentCallStats(agentId);

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Failed to get agent call stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent call stats',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/calls/location/:locationId
 * @desc    Get call logs for a location
 * @access  Private
 */
router.get('/location/:locationId', async (req, res) => {
  try {
    const { locationId } = req.params;
    const { limit, offset, agentId, kind } = req.query;

    const calls = await getLocationCalls(locationId, {
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      agentId,
      kind
    });

    res.json({
      success: true,
      data: calls,
      count: calls.length
    });

  } catch (error) {
    console.error('Failed to get location calls:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get location calls',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/calls
 * @desc    Create a new call
 * @access  Private
 */
router.post('/', async (req, res) => {
  try {
    const call = await callService.createCall(req.body);
    res.status(201).json({
      success: true,
      data: call
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/calls
 * @desc    List all calls
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0, agent_id, kind, includeDeleted = false } = req.query;

    const calls = await callService.listCalls({
      limit: parseInt(limit),
      offset: parseInt(offset),
      agent_id,
      kind,
      includeDeleted: includeDeleted === 'true'
    });

    res.json({
      success: true,
      data: calls,
      count: calls.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/calls/real
 * @desc    List real calls
 * @access  Private
 */
router.get('/real', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const calls = await callService.listRealCalls({
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      data: calls,
      count: calls.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/calls/simulated
 * @desc    List simulated calls
 * @access  Private
 */
router.get('/simulated', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const calls = await callService.listSimulatedCalls({
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      data: calls,
      count: calls.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/calls/:id
 * @desc    Get call by ID
 * @access  Private
 */
router.get('/:id', async (req, res) => {
  try {
    const call = await callService.getCallById(req.params.id);
    res.json({
      success: true,
      data: call
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/calls/:id/with-agent
 * @desc    Get call with agent details
 * @access  Private
 */
router.get('/:id/with-agent', async (req, res) => {
  try {
    const call = await callService.getCallWithAgent(req.params.id);
    res.json({
      success: true,
      data: call
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/calls/:id
 * @desc    Soft delete call
 * @access  Private
 */
router.delete('/:id', async (req, res) => {
  try {
    const call = await callService.deleteCall(req.params.id);
    res.json({
      success: true,
      data: call,
      message: 'Call deleted successfully'
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
