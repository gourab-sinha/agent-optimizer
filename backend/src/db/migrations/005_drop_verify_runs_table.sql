-- Migration: Drop verify_runs table
-- Created: 2026-08-07
-- Description: Removes verify_runs table which was added but never used in the application
-- Rationale: The table was created in migration 004 but no code references it.
--            The verification functionality can be re-implemented in the future if needed.

-- Safety checks before dropping
DO $$
DECLARE
  row_count INTEGER;
BEGIN
  -- Check if table exists and get row count
  SELECT COUNT(*) INTO row_count FROM verify_runs;

  -- Log the current state
  RAISE NOTICE 'verify_runs table exists with % rows', row_count;

  -- Safety: Only proceed if table is empty
  IF row_count > 0 THEN
    RAISE EXCEPTION 'Cannot drop verify_runs table: contains % rows. Please backup or migrate data first.', row_count;
  END IF;
END $$;

-- Drop indexes first
DROP INDEX IF EXISTS idx_verify_runs_candidate;
DROP INDEX IF EXISTS idx_verify_runs_status;

-- Drop trigger
DROP TRIGGER IF EXISTS update_verify_runs_updated_at ON verify_runs;

-- Drop the table
DROP TABLE IF EXISTS verify_runs;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Successfully dropped verify_runs table and its associated indexes and triggers';
END $$;
