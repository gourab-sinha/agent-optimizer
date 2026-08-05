require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

/**
 * Database migration script for agent-optimizer
 * Reads and executes schema.sql to set up the PostgreSQL database
 */

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully');

    // Read the schema.sql file
    const schemaPath = path.join(__dirname, 'schema.sql');
    console.log(`Reading schema from: ${schemaPath}`);

    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at: ${schemaPath}`);
    }

    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute the schema
    console.log('Executing schema...');
    await client.query(schema);
    console.log('Schema executed successfully');

    // Verify tables were created
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log('\nCreated tables:');
    result.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    console.log('\nMigration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

// Run migration if called directly
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { migrate };
