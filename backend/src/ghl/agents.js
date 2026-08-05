import ghlClient from './sdk-client.js';

/**
 * HighLevel Voice AI Agents API
 * Wrapper functions using official @gohighlevel/api-client SDK
 *
 * API Documentation: https://marketplace.gohighlevel.com/docs/ghl/voice-ai/agents
 */

/**
 * List all voice AI agents for a location
 * @param {string} locationId - GHL location ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} List of agents
 */
export async function listAgents(locationId, options = {}) {
  try {
    const { page = 1, pageSize = 50, query } = options;

    const response = await ghlClient.voiceAi(locationId).getAgents({
      page,
      pageSize,
      query
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
    const response = await ghlClient.voiceAi(locationId).getAgent(agentId);
    return response.agent || response;

  } catch (error) {
    console.error(`Failed to get agent ${agentId}:`, error.message);
    throw error;
  }
}

/**
 * Create a new voice AI agent
 * @param {string} locationId - GHL location ID
 * @param {Object} agentData - Agent configuration
 * @returns {Promise<Object>} Created agent
 */
export async function createAgent(locationId, agentData) {
  try {
    const response = await ghlClient.voiceAi(locationId).createAgent(agentData);

    console.log(`Created agent ${response.agent?.id} for location ${locationId}`);
    return response.agent || response;

  } catch (error) {
    console.error(`Failed to create agent for location ${locationId}:`, error.message);
    throw error;
  }
}

/**
 * Update an existing agent (partial update)
 * @param {string} locationId - GHL location ID
 * @param {string} agentId - Agent ID
 * @param {Object} updates - Agent updates
 * @returns {Promise<Object>} Updated agent
 */
export async function updateAgent(locationId, agentId, updates) {
  try {
    const response = await ghlClient.voiceAi(locationId).patchAgent(agentId, updates);

    console.log(`Updated agent ${agentId}`);
    return response.agent || response;

  } catch (error) {
    console.error(`Failed to update agent ${agentId}:`, error.message);
    throw error;
  }
}

/**
 * Delete an agent
 * @param {string} locationId - GHL location ID
 * @param {string} agentId - Agent ID
 * @returns {Promise<void>}
 */
export async function deleteAgent(locationId, agentId) {
  try {
    await ghlClient.voiceAi(locationId).deleteAgent(agentId);
    console.log(`Deleted agent ${agentId}`);

  } catch (error) {
    console.error(`Failed to delete agent ${agentId}:`, error.message);
    throw error;
  }
}

export default {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent
};
