#!/usr/bin/env node

/**
 * Database Migration Runner (Alembic-style)
 * Tracks and applies migrations in order
 *
 * Usage:
 *   node src/db/run-migrations.js         # Run all pending migrations
 *   node src/db/run-migrations.js status  # Show migration status
 *   node src/db/run-migrations.js create <name>  # Create new migration
 */

import dotenv from 'dotenv';
import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import pkg from 'pg';

const { Client } = pkg;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Calculate SHA256 checksum of file content
 */
function calculateChecksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Get database client
 */
async function getClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  return client;
}

/**
 * Ensure migrations table exists
 */
async function ensureMigrationsTable(client) {
  const initMigrationPath = join(MIGRATIONS_DIR, '001_init_migrations.sql');
  const initMigrationSQL = await readFile(initMigrationPath, 'utf-8');

  await client.query(initMigrationSQL);
  console.log('✓ Migrations table ready');
}

/**
 * Get list of applied migrations from database
 */
async function getAppliedMigrations(client) {
  try {
    const result = await client.query(
      'SELECT version, applied_at, checksum FROM schema_migrations ORDER BY version'
    );
    return new Map(result.rows.map(row => [row.version, row]));
  } catch (error) {
    // Table doesn't exist yet
    return new Map();
  }
}

/**
 * Get list of migration files from filesystem
 */
async function getMigrationFiles() {
  const files = await readdir(MIGRATIONS_DIR);

  return files
    .filter(f => f.endsWith('.sql'))
    .sort() // Natural sort by filename (001_, 002_, etc.)
    .map(f => f.replace('.sql', ''));
}

/**
 * Apply a single migration
 */
async function applyMigration(client, version) {
  const filePath = join(MIGRATIONS_DIR, `${version}.sql`);
  const content = await readFile(filePath, 'utf-8');
  const checksum = calculateChecksum(content);

  console.log(`\nApplying migration: ${version}`);

  // Start transaction
  await client.query('BEGIN');

  try {
    // Skip the init migration's CREATE TABLE statement if we're re-running it
    // (it will be handled by ensureMigrationsTable)
    if (version !== '001_init_migrations') {
      await client.query(content);
    }

    // Record migration
    await client.query(
      `INSERT INTO schema_migrations (version, checksum)
       VALUES ($1, $2)
       ON CONFLICT (version) DO UPDATE
       SET checksum = $2, applied_at = now()`,
      [version, checksum]
    );

    await client.query('COMMIT');
    console.log(`✓ Applied: ${version}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`✗ Failed to apply ${version}:`, error.message);
    throw error;
  }
}

/**
 * Verify migration checksums haven't changed
 */
async function verifyChecksums(appliedMigrations) {
  const files = await getMigrationFiles();
  const warnings = [];

  for (const version of files) {
    if (appliedMigrations.has(version)) {
      const filePath = join(MIGRATIONS_DIR, `${version}.sql`);
      const content = await readFile(filePath, 'utf-8');
      const currentChecksum = calculateChecksum(content);
      const appliedChecksum = appliedMigrations.get(version).checksum;

      if (currentChecksum !== appliedChecksum) {
        warnings.push({
          version,
          issue: 'Modified after application'
        });
      }
    }
  }

  return warnings;
}

/**
 * Show migration status
 */
async function showStatus() {
  console.log('\n📊 Migration Status\n');
  console.log('='.repeat(80));

  const client = await getClient();

  try {
    await ensureMigrationsTable(client);

    const appliedMigrations = await getAppliedMigrations(client);
    const files = await getMigrationFiles();
    const warnings = await verifyChecksums(appliedMigrations);

    console.log('\nMigrations:\n');

    for (const version of files) {
      const applied = appliedMigrations.get(version);

      if (applied) {
        const appliedDate = new Date(applied.applied_at).toISOString();
        console.log(`✓ ${version.padEnd(40)} applied ${appliedDate}`);
      } else {
        console.log(`○ ${version.padEnd(40)} pending`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\nTotal: ${files.length} migrations`);
    console.log(`Applied: ${appliedMigrations.size}`);
    console.log(`Pending: ${files.length - appliedMigrations.size}`);

    if (warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      warnings.forEach(w => {
        console.log(`   ${w.version}: ${w.issue}`);
      });
    }

    console.log();

  } finally {
    await client.end();
  }
}

/**
 * Run all pending migrations
 */
async function runMigrations() {
  console.log('\n🔄 Running Database Migrations\n');
  console.log('='.repeat(80));

  const client = await getClient();

  try {
    await ensureMigrationsTable(client);

    const appliedMigrations = await getAppliedMigrations(client);
    const files = await getMigrationFiles();

    // Verify checksums of applied migrations
    const warnings = await verifyChecksums(appliedMigrations);
    if (warnings.length > 0) {
      console.log('\n⚠️  Warning: Some applied migrations have been modified:');
      warnings.forEach(w => {
        console.log(`   - ${w.version}`);
      });
      console.log('\nProceeding with pending migrations...\n');
    }

    // Find pending migrations
    const pending = files.filter(version => !appliedMigrations.has(version));

    if (pending.length === 0) {
      console.log('\n✓ No pending migrations. Database is up to date!\n');
      return;
    }

    console.log(`\nFound ${pending.length} pending migration(s):\n`);
    pending.forEach(v => console.log(`  - ${v}`));
    console.log();

    // Apply each pending migration
    for (const version of pending) {
      await applyMigration(client, version);
    }

    console.log('\n' + '='.repeat(80));
    console.log(`✓ Successfully applied ${pending.length} migration(s)\n`);

  } finally {
    await client.end();
  }
}

/**
 * Create a new migration file
 */
async function createMigration(name) {
  if (!name) {
    console.error('Error: Migration name is required');
    console.log('Usage: node src/db/run-migrations.js create <name>');
    console.log('Example: node src/db/run-migrations.js create add_user_roles');
    process.exit(1);
  }

  const files = await getMigrationFiles();

  // Get next version number
  let nextVersion = 1;
  if (files.length > 0) {
    const lastFile = files[files.length - 1];
    const lastVersionMatch = lastFile.match(/^(\d+)_/);
    if (lastVersionMatch) {
      nextVersion = parseInt(lastVersionMatch[1]) + 1;
    }
  }

  const versionStr = String(nextVersion).padStart(3, '0');
  const fileName = `${versionStr}_${name}.sql`;
  const filePath = join(MIGRATIONS_DIR, fileName);

  const template = `-- Migration: ${name.replace(/_/g, ' ')}
-- Created: ${new Date().toISOString()}

-- Add your migration SQL here
-- Example:
-- ALTER TABLE users ADD COLUMN email TEXT;
-- CREATE INDEX idx_users_email ON users(email);

`;

  await writeFile(filePath, template);

  console.log(`\n✓ Created migration: ${fileName}`);
  console.log(`📝 Edit: ${filePath}\n`);
}

/**
 * Main CLI handler
 */
async function main() {
  const command = process.argv[2];

  try {
    switch (command) {
      case 'status':
        await showStatus();
        break;

      case 'create':
        const name = process.argv[3];
        await createMigration(name);
        break;

      case 'up':
      case undefined: // default to running migrations
        await runMigrations();
        break;

      default:
        console.log('Unknown command:', command);
        console.log('\nUsage:');
        console.log('  node src/db/run-migrations.js         # Run all pending migrations');
        console.log('  node src/db/run-migrations.js status  # Show migration status');
        console.log('  node src/db/run-migrations.js create <name>  # Create new migration');
        process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runMigrations, showStatus, createMigration };
