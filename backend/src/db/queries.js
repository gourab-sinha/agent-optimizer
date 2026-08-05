import db from './connection.js';

/**
 * CRUD Operations for Agent Optimizer Database
 *
 * Usage examples:
 * - Create: await createLocation({ id: 'loc123', name: 'My Location', ... })
 * - Read: await getLocationById('loc123')
 * - Update: await updateLocation('loc123', { name: 'Updated Name' })
 * - Delete (soft): await softDeleteLocation('loc123')
 * - Delete (hard): await deleteLocation('loc123')
 * - List: await listLocations({ limit: 10, offset: 0 })
 */

// ============================================
// LOCATIONS
// ============================================

async function createLocation(data) {
  const { id, name, access_token, refresh_token, token_expires_at } = data;

  const result = await db.query(
    `INSERT INTO locations (id, name, access_token, refresh_token, token_expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, name, access_token, refresh_token, token_expires_at]
  );

  return result.rows[0];
}

async function getLocationById(id) {
  const result = await db.query(
    'SELECT * FROM locations WHERE id = $1 AND is_deleted = false',
    [id]
  );

  return result.rows[0];
}

async function updateLocation(id, data) {
  const fields = [];
  const values = [];
  let paramCount = 1;

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  });

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(id);

  const result = await db.query(
    `UPDATE locations
     SET ${fields.join(', ')}
     WHERE id = $${paramCount} AND is_deleted = false
     RETURNING *`,
    values
  );

  return result.rows[0];
}

async function softDeleteLocation(id) {
  const result = await db.query(
    'UPDATE locations SET is_deleted = true WHERE id = $1 RETURNING *',
    [id]
  );

  return result.rows[0];
}

async function deleteLocation(id) {
  const result = await db.query(
    'DELETE FROM locations WHERE id = $1 RETURNING *',
    [id]
  );

  return result.rows[0];
}

async function listLocations(options = {}) {
  const { limit = 50, offset = 0, includeDeleted = false } = options;

  const whereClause = includeDeleted ? '' : 'WHERE is_deleted = false';

  const result = await db.query(
    `SELECT * FROM locations ${whereClause}
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return result.rows;
}

// ============================================
// AGENTS
// ============================================

async function createAgent(data) {
  const { id, location_id, name, sync_cursor = 0 } = data;

  const result = await db.query(
    `INSERT INTO agents (id, location_id, name, sync_cursor)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, location_id, name, sync_cursor]
  );

  return result.rows[0];
}

async function getAgentById(id) {
  const result = await db.query(
    'SELECT * FROM agents WHERE id = $1 AND is_deleted = false',
    [id]
  );

  return result.rows[0];
}

async function updateAgent(id, data) {
  const fields = [];
  const values = [];
  let paramCount = 1;

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  });

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(id);

  const result = await db.query(
    `UPDATE agents
     SET ${fields.join(', ')}
     WHERE id = $${paramCount} AND is_deleted = false
     RETURNING *`,
    values
  );

  return result.rows[0];
}

async function softDeleteAgent(id) {
  const result = await db.query(
    'UPDATE agents SET is_deleted = true WHERE id = $1 RETURNING *',
    [id]
  );

  return result.rows[0];
}

async function listAgents(options = {}) {
  const { limit = 50, offset = 0, location_id, includeDeleted = false } = options;

  const conditions = [];
  const params = [];
  let paramCount = 1;

  if (!includeDeleted) {
    conditions.push('is_deleted = false');
  }

  if (location_id) {
    conditions.push(`location_id = $${paramCount}`);
    params.push(location_id);
    paramCount++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);

  const result = await db.query(
    `SELECT * FROM agents ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    params
  );

  return result.rows;
}

// ============================================
// CALLS
// ============================================

async function createCall(data) {
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

  const result = await db.query(
    `INSERT INTO calls (
      id, agent_id, agent_version_id, kind, test_run_id,
      created_at_ghl, duration_s, summary, raw_transcript,
      executed_actions, extracted_data, redaction_map
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    [
      id, agent_id, agent_version_id, kind, test_run_id,
      created_at_ghl, duration_s, summary, raw_transcript,
      JSON.stringify(executed_actions),
      JSON.stringify(extracted_data),
      JSON.stringify(redaction_map)
    ]
  );

  return result.rows[0];
}

async function getCallById(id) {
  const result = await db.query(
    'SELECT * FROM calls WHERE id = $1 AND is_deleted = false',
    [id]
  );

  return result.rows[0];
}

async function listCalls(options = {}) {
  const {
    limit = 50,
    offset = 0,
    agent_id,
    kind,
    includeDeleted = false
  } = options;

  const conditions = [];
  const params = [];
  let paramCount = 1;

  if (!includeDeleted) {
    conditions.push('is_deleted = false');
  }

  if (agent_id) {
    conditions.push(`agent_id = $${paramCount}`);
    params.push(agent_id);
    paramCount++;
  }

  if (kind) {
    conditions.push(`kind = $${paramCount}`);
    params.push(kind);
    paramCount++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);

  const result = await db.query(
    `SELECT * FROM calls ${whereClause}
     ORDER BY ingested_at DESC
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    params
  );

  return result.rows;
}

// ============================================
// GENERIC CRUD HELPERS
// ============================================

/**
 * Generic create function
 * @param {string} table - Table name
 * @param {Object} data - Data to insert
 * @returns {Promise<Object>} Created row
 */
async function create(table, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

  const result = await db.query(
    `INSERT INTO ${table} (${keys.join(', ')})
     VALUES (${placeholders})
     RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * Generic read function
 * @param {string} table - Table name
 * @param {string} id - Record ID
 * @returns {Promise<Object>} Row or null
 */
async function read(table, id) {
  const result = await db.query(
    `SELECT * FROM ${table} WHERE id = $1 AND is_deleted = false`,
    [id]
  );

  return result.rows[0];
}

/**
 * Generic update function
 * @param {string} table - Table name
 * @param {string} id - Record ID
 * @param {Object} data - Data to update
 * @returns {Promise<Object>} Updated row
 */
async function update(table, id, data) {
  const fields = [];
  const values = [];
  let paramCount = 1;

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  });

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(id);

  const result = await db.query(
    `UPDATE ${table}
     SET ${fields.join(', ')}
     WHERE id = $${paramCount} AND is_deleted = false
     RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * Generic soft delete function
 * @param {string} table - Table name
 * @param {string} id - Record ID
 * @returns {Promise<Object>} Deleted row
 */
async function softDelete(table, id) {
  const result = await db.query(
    `UPDATE ${table} SET is_deleted = true WHERE id = $1 RETURNING *`,
    [id]
  );

  return result.rows[0];
}

/**
 * Generic hard delete function
 * @param {string} table - Table name
 * @param {string} id - Record ID
 * @returns {Promise<Object>} Deleted row
 */
async function hardDelete(table, id) {
  const result = await db.query(
    `DELETE FROM ${table} WHERE id = $1 RETURNING *`,
    [id]
  );

  return result.rows[0];
}

/**
 * Generic list function
 * @param {string} table - Table name
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Rows
 */
async function list(table, options = {}) {
  const { limit = 50, offset = 0, includeDeleted = false, orderBy = 'created_at DESC' } = options;

  const whereClause = includeDeleted ? '' : 'WHERE is_deleted = false';

  const result = await db.query(
    `SELECT * FROM ${table} ${whereClause}
     ORDER BY ${orderBy}
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return result.rows;
}

export default {
  // Locations
  createLocation,
  getLocationById,
  updateLocation,
  softDeleteLocation,
  deleteLocation,
  listLocations,

  // Agents
  createAgent,
  getAgentById,
  updateAgent,
  softDeleteAgent,
  listAgents,

  // Calls
  createCall,
  getCallById,
  listCalls,

  // Generic CRUD
  create,
  read,
  update,
  softDelete,
  hardDelete,
  list
};
