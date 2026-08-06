-- Migration: Initialize migrations tracking table
-- This is the foundation for the migration system

CREATE TABLE IF NOT EXISTS schema_migrations (
  version       TEXT PRIMARY KEY,              -- Migration file name (e.g., '002_add_agent_config')
  applied_at    TIMESTAMPTZ DEFAULT now(),
  checksum      TEXT                           -- SHA256 of migration content for integrity
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at);

COMMENT ON TABLE schema_migrations IS 'Tracks which database migrations have been applied';
COMMENT ON COLUMN schema_migrations.version IS 'Migration file name without .sql extension';
COMMENT ON COLUMN schema_migrations.checksum IS 'SHA256 hash of migration file content for integrity verification';
