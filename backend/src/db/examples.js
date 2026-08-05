require('dotenv').config();
const queries = require('./queries');
const db = require('./connection');

/**
 * CRUD Operation Examples
 *
 * Run this file to see how to perform database operations:
 * node src/db/examples.js
 */

async function runExamples() {
  try {
    console.log('=== Database CRUD Examples ===\n');

    // ============================================
    // 1. CREATE - Insert new records
    // ============================================
    console.log('1. Creating a new location...');
    const location = await queries.createLocation({
      id: 'loc_123',
      name: 'Test Location',
      access_token: 'encrypted_access_token',
      refresh_token: 'encrypted_refresh_token',
      token_expires_at: new Date(Date.now() + 3600000) // 1 hour from now
    });
    console.log('Created location:', location);

    console.log('\n2. Creating a new agent...');
    const agent = await queries.createAgent({
      id: 'agent_456',
      location_id: 'loc_123',
      name: 'Sales Agent',
      sync_cursor: 0
    });
    console.log('Created agent:', agent);

    console.log('\n3. Creating a call...');
    const call = await queries.createCall({
      id: 'call_789',
      agent_id: 'agent_456',
      agent_version_id: null,
      kind: 'real',
      test_run_id: null,
      created_at_ghl: new Date(),
      duration_s: 120,
      summary: 'Customer inquiry about pricing',
      raw_transcript: 'Agent: Hello...\nCaller: Hi...',
      executed_actions: [{ action: 'send_email', status: 'success' }],
      extracted_data: { email: 'customer@example.com' },
      redaction_map: {}
    });
    console.log('Created call:', call);

    // ============================================
    // 2. READ - Fetch records
    // ============================================
    console.log('\n4. Reading location by ID...');
    const fetchedLocation = await queries.getLocationById('loc_123');
    console.log('Fetched location:', fetchedLocation);

    console.log('\n5. Reading agent by ID...');
    const fetchedAgent = await queries.getAgentById('agent_456');
    console.log('Fetched agent:', fetchedAgent);

    // ============================================
    // 3. UPDATE - Modify records
    // ============================================
    console.log('\n6. Updating location name...');
    const updatedLocation = await queries.updateLocation('loc_123', {
      name: 'Updated Test Location'
    });
    console.log('Updated location:', updatedLocation);

    console.log('\n7. Updating agent sync cursor...');
    const updatedAgent = await queries.updateAgent('agent_456', {
      sync_cursor: 1000
    });
    console.log('Updated agent:', updatedAgent);

    // ============================================
    // 4. LIST - Query multiple records
    // ============================================
    console.log('\n8. Listing all locations...');
    const locations = await queries.listLocations({ limit: 10 });
    console.log(`Found ${locations.length} locations`);

    console.log('\n9. Listing agents for location...');
    const agents = await queries.listAgents({
      location_id: 'loc_123',
      limit: 10
    });
    console.log(`Found ${agents.length} agents`);

    console.log('\n10. Listing calls for agent...');
    const calls = await queries.listCalls({
      agent_id: 'agent_456',
      kind: 'real',
      limit: 10
    });
    console.log(`Found ${calls.length} calls`);

    // ============================================
    // 5. SOFT DELETE - Mark as deleted
    // ============================================
    console.log('\n11. Soft deleting agent...');
    await queries.softDeleteAgent('agent_456');
    console.log('Agent soft deleted');

    console.log('\n12. Trying to fetch soft-deleted agent...');
    const deletedAgent = await queries.getAgentById('agent_456');
    console.log('Deleted agent (should be null):', deletedAgent);

    console.log('\n13. Listing agents including deleted...');
    const allAgents = await queries.listAgents({
      location_id: 'loc_123',
      includeDeleted: true,
      limit: 10
    });
    console.log(`Found ${allAgents.length} agents (including deleted)`);

    // ============================================
    // 6. USING GENERIC CRUD FUNCTIONS
    // ============================================
    console.log('\n14. Using generic create function...');
    const genericAgent = await queries.create('agents', {
      id: 'agent_999',
      location_id: 'loc_123',
      name: 'Generic Agent',
      sync_cursor: 0,
      is_deleted: false
    });
    console.log('Created with generic function:', genericAgent);

    console.log('\n15. Using generic read function...');
    const genericRead = await queries.read('agents', 'agent_999');
    console.log('Read with generic function:', genericRead);

    console.log('\n16. Using generic update function...');
    const genericUpdate = await queries.update('agents', 'agent_999', {
      name: 'Updated Generic Agent'
    });
    console.log('Updated with generic function:', genericUpdate);

    console.log('\n17. Using generic list function...');
    const genericList = await queries.list('locations', {
      limit: 5,
      orderBy: 'created_at DESC'
    });
    console.log(`Listed ${genericList.length} records`);

    // ============================================
    // 7. RAW QUERIES (for complex operations)
    // ============================================
    console.log('\n18. Running custom SQL query...');
    const result = await db.query(
      `SELECT a.id, a.name, l.name as location_name
       FROM agents a
       JOIN locations l ON a.location_id = l.id
       WHERE a.is_deleted = false
       LIMIT $1`,
      [5]
    );
    console.log('Custom query results:', result.rows);

    // ============================================
    // 8. TRANSACTIONS (for atomic operations)
    // ============================================
    console.log('\n19. Running transaction...');
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // Create multiple related records atomically
      await client.query(
        'INSERT INTO locations (id, name, access_token, refresh_token) VALUES ($1, $2, $3, $4)',
        ['loc_tx', 'Transaction Location', 'token1', 'token2']
      );

      await client.query(
        'INSERT INTO agents (id, location_id, name) VALUES ($1, $2, $3)',
        ['agent_tx', 'loc_tx', 'Transaction Agent']
      );

      await client.query('COMMIT');
      console.log('Transaction committed successfully');

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Transaction rolled back:', error.message);
      throw error;
    } finally {
      client.release();
    }

    // ============================================
    // CLEANUP
    // ============================================
    console.log('\n20. Cleaning up test data...');
    // Delete in correct order: child records first, then parents
    await queries.hardDelete('calls', 'call_789');
    await queries.hardDelete('agents', 'agent_456');
    await queries.hardDelete('agents', 'agent_999');
    await queries.hardDelete('agents', 'agent_tx');
    await queries.hardDelete('locations', 'loc_123');
    await queries.hardDelete('locations', 'loc_tx');
    console.log('Cleanup complete');

    console.log('\n=== Examples completed successfully! ===');

  } catch (error) {
    console.error('Error running examples:', error);
    throw error;
  } finally {
    // Close database connection
    await db.close();
  }
}

// Run examples if called directly
if (require.main === module) {
  runExamples()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { runExamples };
