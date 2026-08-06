import db from '../db/connection.js';
import { listCalls, getCall } from '../ghl/calls.js';

/**
 * Call Sync Service
 * Syncs call logs from HighLevel API to local database
 */

/**
 * Sync calls for a specific agent
 */
export async function syncAgentCalls(locationId, agentId, options = {}) {
  const { page = 1, pageSize = 50 } = options; // HighLevel max is 50

  console.log(`Syncing calls for agent ${agentId} in location ${locationId}`);

  // Fetch calls from HighLevel
  const calls = await listCalls(locationId, { agentId, page, pageSize });

  console.log(`Fetched ${calls.length} calls from HighLevel`);

  // Store each call in database
  const syncedCalls = [];
  for (const call of calls) {
    // Log the first call to see the structure
    if (syncedCalls.length === 0) {
      console.log('[Call Sync] Sample call object keys:', Object.keys(call));
      console.log('[Call Sync] Sample call object:', JSON.stringify(call, null, 2));
    }

    // Determine if call is simulated or real
    // Check multiple possible field names that HighLevel might use
    let kind = 'real'; // default to real
    if (call.trialCall === true || call.trialCall === 'true') {
      kind = 'simulated';
    } else if (call.isSimulated === true || call.isSimulated === 'true') {
      kind = 'simulated';
    } else if (call.type === 'trial' || call.type === 'simulated' || call.type === 'test') {
      kind = 'simulated';
    } else if (call.callType === 'trial' || call.callType === 'simulated' || call.callType === 'test') {
      kind = 'simulated';
    }

    const result = await db.query(
      `INSERT INTO calls (
        id, agent_id, kind, created_at_ghl, duration_s,
        summary, raw_transcript, executed_actions, extracted_data,
        contact_id, from_number, is_agent_deleted, message_id, translation
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        agent_id = $2,
        kind = $3,
        created_at_ghl = $4,
        duration_s = $5,
        summary = $6,
        raw_transcript = $7,
        executed_actions = $8,
        extracted_data = $9,
        contact_id = $10,
        from_number = $11,
        is_agent_deleted = $12,
        message_id = $13,
        translation = $14,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        call.id,
        agentId,
        kind,
        call.createdAt || new Date().toISOString(),
        call.duration || 0,
        call.summary || null,
        call.transcript || null,
        JSON.stringify(call.executedCallActions || []),
        JSON.stringify(call.extractedData || {}),
        call.contactId || null,
        call.fromNumber || null,
        call.isAgentDeleted || false,
        call.messageId || null,
        JSON.stringify(call.translation || {})
      ]
    );

    syncedCalls.push(result.rows[0]);
  }

  console.log(`Synced ${syncedCalls.length} calls to database`);

  return syncedCalls;
}

/**
 * Get calls for an agent from database
 */
export async function getAgentCalls(agentId, options = {}) {
  const { limit = 50, offset = 0, kind } = options;

  let query = `
    SELECT * FROM calls
    WHERE agent_id = $1 AND is_deleted = false
  `;

  const params = [agentId];

  if (kind) {
    query += ` AND kind = $${params.length + 1}`;
    params.push(kind);
  }

  query += ` ORDER BY created_at_ghl DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await db.query(query, params);

  return result.rows;
}

/**
 * Get call statistics for an agent
 */
export async function getAgentCallStats(agentId) {
  const result = await db.query(
    `SELECT
      COUNT(*) as total_calls,
      COUNT(CASE WHEN kind = 'real' THEN 1 END) as real_calls,
      COUNT(CASE WHEN kind = 'simulated' THEN 1 END) as simulated_calls,
      AVG(duration_s) as avg_duration,
      MAX(created_at_ghl) as latest_call
    FROM calls
    WHERE agent_id = $1 AND is_deleted = false`,
    [agentId]
  );

  return result.rows[0];
}

/**
 * Get calls for a location from database
 */
export async function getLocationCalls(locationId, options = {}) {
  const { limit = 50, offset = 0, agentId, kind } = options;

  let query = `
    SELECT c.*, a.name as agent_name, a.location_id
    FROM calls c
    LEFT JOIN agents a ON c.agent_id = a.id
    WHERE a.location_id = $1 AND c.is_deleted = false
  `;

  const params = [locationId];

  if (agentId) {
    query += ` AND c.agent_id = $${params.length + 1}`;
    params.push(agentId);
  }

  if (kind) {
    query += ` AND c.kind = $${params.length + 1}`;
    params.push(kind);
  }

  query += ` ORDER BY c.created_at_ghl DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await db.query(query, params);

  return result.rows;
}
