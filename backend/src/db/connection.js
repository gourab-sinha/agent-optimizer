import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;

dotenv.config();

/**
 * PostgreSQL connection pool
 * Used for all database operations in the application
 */

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  max: parseInt(process.env.DB_POOL_MAX || '20', 10), // Increased default for scale
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
  // Statement timeout to prevent long-running queries
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

// Log pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Log pool connections (optional, for debugging)
pool.on('connect', () => {
  console.log('New database connection established');
});

/**
 * Execute a SQL query
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;

    // Log slow queries
    if (duration > 1000) {
      console.warn('Slow query detected:', {
        text,
        duration: `${duration}ms`,
        rows: res.rowCount
      });
    }

    return res;
  } catch (error) {
    console.error('Database query error:', {
      text,
      error: error.message
    });
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<Object>} Database client
 */
async function getClient() {
  return await pool.connect();
}

/**
 * Health check - test database connectivity
 * @returns {Promise<boolean>} True if database is healthy
 */
async function healthCheck() {
  try {
    const result = await pool.query('SELECT NOW() as now');
    return {
      healthy: true,
      timestamp: result.rows[0].now,
      poolSize: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingClients: pool.waitingCount
    };
  } catch (error) {
    console.error('Database health check failed:', error.message);
    return {
      healthy: false,
      error: error.message
    };
  }
}

/**
 * Close the connection pool
 */
async function close() {
  await pool.end();
  console.log('Database pool closed');
}

/**
 * Batch insert helper - inserts multiple rows efficiently
 * @param {string} table - Table name
 * @param {string[]} columns - Column names
 * @param {Array<Array>} rows - Array of row value arrays
 * @returns {Promise<Object>} Query result
 */
async function batchInsert(table, columns, rows) {
  if (!rows.length) return { rowCount: 0 };

  const columnList = columns.join(', ');
  const values = [];
  const placeholders = [];

  let paramIndex = 1;
  for (const row of rows) {
    const rowPlaceholders = [];
    for (const value of row) {
      values.push(value);
      rowPlaceholders.push(`$${paramIndex++}`);
    }
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  const sql = `INSERT INTO ${table} (${columnList}) VALUES ${placeholders.join(', ')}`;
  return query(sql, values);
}

/**
 * Batch upsert helper - inserts or updates multiple rows
 * @param {string} table - Table name
 * @param {string[]} columns - Column names
 * @param {Array<Array>} rows - Array of row value arrays
 * @param {string[]} conflictColumns - Columns for ON CONFLICT
 * @param {string[]} updateColumns - Columns to update on conflict
 * @returns {Promise<Object>} Query result
 */
async function batchUpsert(table, columns, rows, conflictColumns, updateColumns) {
  if (!rows.length) return { rowCount: 0 };

  const columnList = columns.join(', ');
  const values = [];
  const placeholders = [];

  let paramIndex = 1;
  for (const row of rows) {
    const rowPlaceholders = [];
    for (const value of row) {
      values.push(value);
      rowPlaceholders.push(`$${paramIndex++}`);
    }
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  const conflictClause = conflictColumns.join(', ');
  const updateClause = updateColumns.map(col => `${col} = EXCLUDED.${col}`).join(', ');

  const sql = `
    INSERT INTO ${table} (${columnList})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (${conflictClause}) DO UPDATE SET ${updateClause}, updated_at = NOW()
  `;

  return query(sql, values);
}

export default {
  query,
  getClient,
  healthCheck,
  close,
  batchInsert,
  batchUpsert,
  pool
};
