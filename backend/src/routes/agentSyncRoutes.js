import express from 'express';
import {
  syncAgent,
  syncAllAgents,
  getAgentConfig,
  getLocationAgents,
  getAgentActions,
  getAgentPrompt
} from '../services/agentSyncService.js';

const router = express.Router();

/**
 * @route   POST /api/agents/sync/:agentId
 * @desc    Sync a single agent from HighLevel
 * @access  Private
 */
router.post('/sync/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { locationId } = req.body;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing locationId'
      });
    }

    const agent = await syncAgent(locationId, agentId);

    res.json({
      success: true,
      data: agent
    });

  } catch (error) {
    console.error('Failed to sync agent:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync agent',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/agents/sync-location/:locationId
 * @desc    Sync all agents for a location from HighLevel
 * @access  Private (secured by SSO - locationId must exist in database)
 */
router.post('/sync-location/:locationId', async (req, res) => {
  try {
    const { locationId } = req.params;

    // Verify location exists and is installed (simple auth check)
    const db = (await import('../db/connection.js')).default;
    const locationCheck = await db.query(
      'SELECT id FROM locations WHERE id = $1 AND is_deleted = false',
      [locationId]
    );

    if (locationCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Location not found or app not installed'
      });
    }

    const agents = await syncAllAgents(locationId);

    res.json({
      success: true,
      data: agents,
      count: agents.length
    });

  } catch (error) {
    console.error('Failed to sync location agents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync location agents',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/agents/:agentId/config
 * @desc    Get agent configuration from database
 * @access  Private
 */
router.get('/:agentId/config', async (req, res) => {
  try {
    const { agentId } = req.params;

    const agent = await getAgentConfig(agentId);

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }

    res.json({
      success: true,
      data: agent
    });

  } catch (error) {
    console.error('Failed to get agent config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent config',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/agents/location/:locationId
 * @desc    Get all agents for a location
 * @access  Private
 */
router.get('/location/:locationId', async (req, res) => {
  try {
    const { locationId } = req.params;

    const agents = await getLocationAgents(locationId);

    res.json({
      success: true,
      data: agents,
      count: agents.length
    });

  } catch (error) {
    console.error('Failed to get location agents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get location agents',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/agents/:agentId/actions
 * @desc    Get agent actions
 * @access  Private
 */
router.get('/:agentId/actions', async (req, res) => {
  try {
    const { agentId } = req.params;

    const actions = await getAgentActions(agentId);

    res.json({
      success: true,
      data: actions
    });

  } catch (error) {
    console.error('Failed to get agent actions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent actions',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/agents/:agentId/prompt
 * @desc    Get agent prompt
 * @access  Private
 */
router.get('/:agentId/prompt', async (req, res) => {
  try {
    const { agentId } = req.params;

    const prompt = await getAgentPrompt(agentId);

    if (!prompt) {
      return res.status(404).json({
        success: false,
        error: 'Agent prompt not found'
      });
    }

    res.json({
      success: true,
      data: { prompt }
    });

  } catch (error) {
    console.error('Failed to get agent prompt:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent prompt',
      message: error.message
    });
  }
});

export default router;
