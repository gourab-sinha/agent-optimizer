import express from 'express';
import agentService from '../services/agentService.js';

const router = express.Router();

/**
 * Agent Routes
 * HTTP endpoints for agent management
 */

/**
 * @route   POST /api/agents
 * @desc    Create a new agent
 * @access  Private
 */
router.post('/', async (req, res) => {
  try {
    const agent = await agentService.createAgent(req.body);
    res.status(201).json({
      success: true,
      data: agent
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/agents
 * @desc    List all agents
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0, location_id, includeDeleted = false } = req.query;

    const agents = await agentService.listAgents({
      limit: parseInt(limit),
      offset: parseInt(offset),
      location_id,
      includeDeleted: includeDeleted === 'true'
    });

    res.json({
      success: true,
      data: agents,
      count: agents.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/agents/:id
 * @desc    Get agent by ID
 * @access  Private
 */
router.get('/:id', async (req, res) => {
  try {
    const agent = await agentService.getAgentById(req.params.id);
    res.json({
      success: true,
      data: agent
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/agents/:id/with-location
 * @desc    Get agent with location details
 * @access  Private
 */
router.get('/:id/with-location', async (req, res) => {
  try {
    const agent = await agentService.getAgentWithLocation(req.params.id);
    res.json({
      success: true,
      data: agent
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/agents/:id
 * @desc    Update agent
 * @access  Private
 */
router.put('/:id', async (req, res) => {
  try {
    const agent = await agentService.updateAgent(req.params.id, req.body);
    res.json({
      success: true,
      data: agent
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/agents/:id/sync-cursor
 * @desc    Update agent sync cursor
 * @access  Private
 */
router.put('/:id/sync-cursor', async (req, res) => {
  try {
    const { syncCursor } = req.body;
    const agent = await agentService.updateSyncCursor(req.params.id, syncCursor);
    res.json({
      success: true,
      data: agent
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/agents/:id
 * @desc    Soft delete agent
 * @access  Private
 */
router.delete('/:id', async (req, res) => {
  try {
    const agent = await agentService.deleteAgent(req.params.id);
    res.json({
      success: true,
      data: agent,
      message: 'Agent deleted successfully'
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
