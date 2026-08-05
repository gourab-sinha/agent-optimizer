import db from '../db/connection.js';
import { listAgents, getAgent } from '../ghl/agents.js';

/**
 * Agent Sync Service
 * Syncs agent configurations from HighLevel to local database
 */

/**
 * Sync a single agent's full configuration
 * @param {string} locationId - Location ID
 * @param {string} agentId - Agent ID
 * @returns {Promise<Object>} Synced agent data
 */
export async function syncAgent(locationId, agentId) {
  try {
    console.log(`Syncing agent ${agentId} from HighLevel...`);

    // Fetch full agent details from HighLevel
    const agent = await getAgent(locationId, agentId);

    // Store in database with full configuration
    const result = await db.query(
      `INSERT INTO agents (
         id, location_id, name, config,
         business_name, voice_id, language, inbound_number, timezone
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE
       SET name = $3,
           config = $4,
           business_name = $5,
           voice_id = $6,
           language = $7,
           inbound_number = $8,
           timezone = $9,
           updated_at = NOW()
       RETURNING *`,
      [
        agent.id,
        locationId,
        agent.agentName || agent.name,
        JSON.stringify(agent), // Store full config as JSONB
        agent.businessName,
        agent.voiceId,
        agent.language,
        agent.inboundNumber,
        agent.timezone
      ]
    );

    console.log(`✓ Synced agent ${agentId}`);
    return result.rows[0];

  } catch (error) {
    console.error(`Failed to sync agent ${agentId}:`, error.message);
    throw error;
  }
}

/**
 * Sync all agents for a location
 * @param {string} locationId - Location ID
 * @returns {Promise<Array>} Synced agents
 */
export async function syncAllAgents(locationId) {
  try {
    console.log(`Syncing all agents for location ${locationId}...`);

    // Fetch all agents from HighLevel
    const agents = await listAgents(locationId);

    console.log(`Fetched ${agents.length} agents from HighLevel`);

    const syncedAgents = [];

    // Sync each agent (this will fetch full details for each)
    for (const agentSummary of agents) {
      try {
        const syncedAgent = await syncAgent(locationId, agentSummary.id);
        syncedAgents.push(syncedAgent);
      } catch (error) {
        console.error(`Failed to sync agent ${agentSummary.id}:`, error.message);
        // Continue syncing other agents
      }
    }

    console.log(`✓ Synced ${syncedAgents.length}/${agents.length} agents`);
    return syncedAgents;

  } catch (error) {
    console.error(`Failed to sync agents for location ${locationId}:`, error.message);
    throw error;
  }
}

/**
 * Get agent configuration from database
 * @param {string} agentId - Agent ID
 * @returns {Promise<Object>} Agent with full config
 */
export async function getAgentConfig(agentId) {
  try {
    const result = await db.query(
      `SELECT id, location_id, name, config, business_name, voice_id,
              language, inbound_number, timezone, sync_cursor,
              created_at, updated_at
       FROM agents
       WHERE id = $1 AND is_deleted = false`,
      [agentId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];

  } catch (error) {
    console.error(`Failed to get agent config for ${agentId}:`, error.message);
    throw error;
  }
}

/**
 * Get all agents for a location with their configurations
 * @param {string} locationId - Location ID
 * @returns {Promise<Array>} Agents with full config
 */
export async function getLocationAgents(locationId) {
  try {
    const result = await db.query(
      `SELECT id, location_id, name, config, business_name, voice_id,
              language, inbound_number, timezone, sync_cursor,
              created_at, updated_at
       FROM agents
       WHERE location_id = $1 AND is_deleted = false
       ORDER BY name`,
      [locationId]
    );

    return result.rows;

  } catch (error) {
    console.error(`Failed to get agents for location ${locationId}:`, error.message);
    throw error;
  }
}

/**
 * Extract actions from agent config
 * @param {string} agentId - Agent ID
 * @returns {Promise<Array>} Agent actions
 */
export async function getAgentActions(agentId) {
  try {
    const result = await db.query(
      `SELECT config->'actions' as actions
       FROM agents
       WHERE id = $1 AND is_deleted = false`,
      [agentId]
    );

    if (result.rows.length === 0) {
      return [];
    }

    return result.rows[0].actions || [];

  } catch (error) {
    console.error(`Failed to get actions for agent ${agentId}:`, error.message);
    throw error;
  }
}

/**
 * Get agent prompt for analysis
 * @param {string} agentId - Agent ID
 * @returns {Promise<string>} Agent prompt
 */
export async function getAgentPrompt(agentId) {
  try {
    const result = await db.query(
      `SELECT config->>'agentPrompt' as prompt
       FROM agents
       WHERE id = $1 AND is_deleted = false`,
      [agentId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].prompt;

  } catch (error) {
    console.error(`Failed to get prompt for agent ${agentId}:`, error.message);
    throw error;
  }
}

export default {
  syncAgent,
  syncAllAgents,
  getAgentConfig,
  getLocationAgents,
  getAgentActions,
  getAgentPrompt
};
