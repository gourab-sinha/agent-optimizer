import crypto from 'crypto';
import db from '../db/connection.js';
import { listAgents, getAgent } from '../ghl/agents.js';

/**
 * Agent Sync Service
 * Syncs agent configurations from HighLevel to local database
 */

/**
 * Calculate hash of agent configuration for change detection
 * @param {Object} agentConfig - Agent configuration object
 * @returns {string} SHA256 hash of the config
 */
function calculateConfigHash(agentConfig) {
  // Extract only the fields that matter for evaluation
  const relevantConfig = {
    agentPrompt: agentConfig.agentPrompt || agentConfig.prompt,
    model: agentConfig.model,
    temperature: agentConfig.temperature,
    actions: agentConfig.actions || [],
    voiceId: agentConfig.voiceId,
    language: agentConfig.language,
  };

  const normalized = JSON.stringify(relevantConfig, Object.keys(relevantConfig).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Sync a single agent's full configuration
 * @param {string} locationId - Location ID
 * @param {string} agentId - Agent ID
 * @returns {Promise<Object>} Synced agent data with versionCreated flag
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
           is_deleted = false,
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

    const syncedAgent = result.rows[0];
    console.log(`✓ Synced agent ${agentId}`);

    // Check if we need to create a new agent version
    const configHash = calculateConfigHash(agent);

    // Get the latest version for this agent
    const latestVersionResult = await db.query(
      `SELECT id, config, created_at
       FROM agent_versions
       WHERE agent_id = $1 AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 1`,
      [agentId]
    );

    let versionCreated = false;
    let versionId = null;

    if (latestVersionResult.rows.length === 0) {
      // No version exists - create the first baseline version
      console.log(`  → Creating baseline version (first sync)`);

      const versionResult = await db.query(
        `INSERT INTO agent_versions (agent_id, label, source, config, actions)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          agentId,
          'baseline',
          'snapshot',
          JSON.stringify(agent),
          JSON.stringify(agent.actions || [])
        ]
      );

      versionId = versionResult.rows[0].id;
      versionCreated = true;
      console.log(`  ✓ Created baseline version ${versionId}`);

    } else {
      // Version exists - check if config changed
      const latestVersion = latestVersionResult.rows[0];
      const latestConfigHash = calculateConfigHash(latestVersion.config);

      if (configHash !== latestConfigHash) {
        // Config changed - create new snapshot version
        console.log(`  → Config changed, creating new snapshot version`);

        const versionResult = await db.query(
          `INSERT INTO agent_versions (agent_id, label, source, config, actions)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            agentId,
            'baseline',
            'snapshot',
            JSON.stringify(agent),
            JSON.stringify(agent.actions || [])
          ]
        );

        versionId = versionResult.rows[0].id;
        versionCreated = true;
        console.log(`  ✓ Created new version ${versionId} (config changed)`);

      } else {
        // Config unchanged - no new version needed
        versionId = latestVersion.id;
        console.log(`  → Config unchanged, using existing version ${versionId}`);
      }
    }

    return {
      ...syncedAgent,
      versionCreated,
      versionId,
    };

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

    // Get the IDs of agents from HighLevel
    const highlevelAgentIds = agents.map(a => a.id);

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

    // Mark agents as deleted if they're not in HighLevel anymore
    if (highlevelAgentIds.length > 0) {
      const deleteResult = await db.query(
        `UPDATE agents
         SET is_deleted = true, updated_at = NOW()
         WHERE location_id = $1
           AND id != ALL($2)
           AND is_deleted = false
         RETURNING id, name`,
        [locationId, highlevelAgentIds]
      );

      if (deleteResult.rows.length > 0) {
        console.log(`Marked ${deleteResult.rows.length} agents as deleted:`,
          deleteResult.rows.map(a => `${a.name} (${a.id})`).join(', '));
      }
    } else {
      // If no agents in HighLevel, mark all agents for this location as deleted
      const deleteResult = await db.query(
        `UPDATE agents
         SET is_deleted = true, updated_at = NOW()
         WHERE location_id = $1 AND is_deleted = false
         RETURNING id, name`,
        [locationId]
      );

      if (deleteResult.rows.length > 0) {
        console.log(`Marked all ${deleteResult.rows.length} agents as deleted (no agents in HighLevel)`);
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
