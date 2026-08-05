import queries from '../db/queries.js';

/**
 * Call Service
 * Business logic for call management
 */

/**
 * Create a new call
 * @param {Object} data - Call data
 * @returns {Promise<Object>} Created call
 */
export async function createCall(data) {
  const {
    id,
    agent_id,
    agent_version_id,
    kind,
    test_run_id,
    created_at_ghl,
    duration_s,
    summary,
    raw_transcript,
    executed_actions = [],
    extracted_data = {},
    redaction_map = {}
  } = data;

  // Verify agent exists
  const agent = await queries.getAgentById(agent_id);
  if (!agent) {
    throw new Error(`Agent ${agent_id} not found`);
  }

  const call = await queries.createCall({
    id,
    agent_id,
    agent_version_id,
    kind,
    test_run_id,
    created_at_ghl,
    duration_s,
    summary,
    raw_transcript,
    executed_actions,
    extracted_data,
    redaction_map
  });

  return call;
}

/**
 * Get call by ID
 * @param {string} id - Call ID
 * @returns {Promise<Object>} Call data
 */
export async function getCallById(id) {
  const call = await queries.getCallById(id);

  if (!call) {
    throw new Error(`Call ${id} not found`);
  }

  return call;
}

/**
 * Get call with agent details
 * @param {string} id - Call ID
 * @returns {Promise<Object>} Call with agent
 */
export async function getCallWithAgent(id) {
  const call = await queries.getCallById(id);

  if (!call) {
    throw new Error(`Call ${id} not found`);
  }

  const agent = await queries.getAgentById(call.agent_id);

  return {
    ...call,
    agent
  };
}

/**
 * List calls
 * @param {Object} options - Query options
 * @returns {Promise<Array>} List of calls
 */
export async function listCalls(options = {}) {
  return queries.listCalls(options);
}

/**
 * List calls by agent
 * @param {string} agentId - Agent ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} List of calls
 */
export async function listCallsByAgent(agentId, options = {}) {
  return queries.listCalls({
    ...options,
    agent_id: agentId
  });
}

/**
 * List real calls
 * @param {Object} options - Query options
 * @returns {Promise<Array>} List of real calls
 */
export async function listRealCalls(options = {}) {
  return queries.listCalls({
    ...options,
    kind: 'real'
  });
}

/**
 * List simulated calls
 * @param {Object} options - Query options
 * @returns {Promise<Array>} List of simulated calls
 */
export async function listSimulatedCalls(options = {}) {
  return queries.listCalls({
    ...options,
    kind: 'simulated'
  });
}

/**
 * Soft delete call
 * @param {string} id - Call ID
 * @returns {Promise<Object>} Deleted call
 */
export async function deleteCall(id) {
  const call = await queries.softDelete('calls', id);

  if (!call) {
    throw new Error(`Call ${id} not found`);
  }

  return call;
}

export default {
  createCall,
  getCallById,
  getCallWithAgent,
  listCalls,
  listCallsByAgent,
  listRealCalls,
  listSimulatedCalls,
  deleteCall
};
