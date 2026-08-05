import { ghl } from './client.js';

/**
 * HighLevel Voice AI Agents API
 * Wrapper functions for agent-related API calls
 */

/**
 * List all voice AI agents for a location
 * @param {string} locationId - GHL location ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} List of agents
 */
export async function listAgents(locationId, options = {}) {
  try {
    const { limit = 100, skip = 0 } = options;

    const response = await ghl(locationId, 'GET', '/voice-ai/agents', {
      query: {
        locationId,  // HighLevel requires locationId in query params
        limit,
        skip
      }
    });

    console.log(`Fetched ${response.agents?.length || 0} agents for location ${locationId}`);

    return response.agents || [];

  } catch (error) {
    console.error(`Failed to list agents for location ${locationId}:`, error.message);
    throw error;
  }
}

/**
 * Get a specific agent by ID
 * @param {string} locationId - GHL location ID
 * @param {string} agentId - Agent ID
 * @returns {Promise<Object>} Agent data
 */
export async function getAgent(locationId, agentId) {
  try {
    const response = await ghl(locationId, 'GET', `/voice-ai/agents/${agentId}`);
    return response.agent || response;

  } catch (error) {
    console.error(`Failed to get agent ${agentId}:`, error.message);
    throw error;
  }
}

/**
 * Update an existing agent
 * @param {string} locationId - GHL location ID
 * @param {string} agentId - Agent ID
 * @param {Object} updates - Agent updates
 * @returns {Promise<Object>} Updated agent
 */
export async function updateAgent(locationId, agentId, updates) {
  try {
    const response = await ghl(locationId, 'PUT', `/v1/voice/agents/${agentId}`, {
      body: updates
    });

    console.log(`Updated agent ${agentId}`);
    return response.agent || response;

  } catch (error) {
    console.error(`Failed to update agent ${agentId}:`, error.message);
    throw error;
  }
}

export default {
  listAgents,
  getAgent,
  updateAgent
};
