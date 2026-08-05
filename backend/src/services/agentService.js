import queries from '../db/queries.js';

/**
 * Agent Service
 * Business logic for agent management
 */

/**
 * Create a new agent
 * @param {Object} data - Agent data
 * @returns {Promise<Object>} Created agent
 */
export async function createAgent(data) {
  const { id, location_id, name, sync_cursor = 0 } = data;

  // Verify location exists
  const location = await queries.getLocationById(location_id);
  if (!location) {
    throw new Error(`Location ${location_id} not found`);
  }

  const agent = await queries.createAgent({
    id,
    location_id,
    name,
    sync_cursor
  });

  return agent;
}

/**
 * Get agent by ID
 * @param {string} id - Agent ID
 * @returns {Promise<Object>} Agent data
 */
export async function getAgentById(id) {
  const agent = await queries.getAgentById(id);

  if (!agent) {
    throw new Error(`Agent ${id} not found`);
  }

  return agent;
}

/**
 * Get agent with location details
 * @param {string} id - Agent ID
 * @returns {Promise<Object>} Agent with location
 */
export async function getAgentWithLocation(id) {
  const agent = await queries.getAgentById(id);

  if (!agent) {
    throw new Error(`Agent ${id} not found`);
  }

  const location = await queries.getLocationById(agent.location_id);

  return {
    ...agent,
    location
  };
}

/**
 * Update agent
 * @param {string} id - Agent ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated agent
 */
export async function updateAgent(id, data) {
  const agent = await queries.updateAgent(id, data);

  if (!agent) {
    throw new Error(`Agent ${id} not found`);
  }

  return agent;
}

/**
 * Update agent sync cursor
 * @param {string} id - Agent ID
 * @param {number} syncCursor - New sync cursor value
 * @returns {Promise<Object>} Updated agent
 */
export async function updateSyncCursor(id, syncCursor) {
  return updateAgent(id, { sync_cursor: syncCursor });
}

/**
 * Soft delete agent
 * @param {string} id - Agent ID
 * @returns {Promise<Object>} Deleted agent
 */
export async function deleteAgent(id) {
  const agent = await queries.softDeleteAgent(id);

  if (!agent) {
    throw new Error(`Agent ${id} not found`);
  }

  return agent;
}

/**
 * List agents
 * @param {Object} options - Query options
 * @returns {Promise<Array>} List of agents
 */
export async function listAgents(options = {}) {
  return queries.listAgents(options);
}

/**
 * List agents by location
 * @param {string} locationId - Location ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} List of agents
 */
export async function listAgentsByLocation(locationId, options = {}) {
  return queries.listAgents({
    ...options,
    location_id: locationId
  });
}

export default {
  createAgent,
  getAgentById,
  getAgentWithLocation,
  updateAgent,
  updateSyncCursor,
  deleteAgent,
  listAgents,
  listAgentsByLocation
};
