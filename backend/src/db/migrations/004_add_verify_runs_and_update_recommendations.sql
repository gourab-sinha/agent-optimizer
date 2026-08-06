-- Migration: Add verify_runs table and update recommendations table
-- Created: 2026-08-06
-- Description: Adds verify_runs for before/after comparison and supporting_test_case_ids to recommendations

-- Add supporting_test_case_ids column to recommendations if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'recommendations'
    AND column_name = 'supporting_test_case_ids'
  ) THEN
    ALTER TABLE recommendations
    ADD COLUMN supporting_test_case_ids UUID[] NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- Create verify_runs table
CREATE TABLE IF NOT EXISTS verify_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_version_id UUID NOT NULL REFERENCES agent_versions(id),
  candidate_version_id UUID NOT NULL REFERENCES agent_versions(id),
  baseline_test_run_id UUID REFERENCES test_runs(id),
  candidate_test_run_id UUID REFERENCES test_runs(id),
  comparison JSONB,               -- per-criterion {before, after, delta, verdict}
  gate_passed BOOLEAN,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create trigger for verify_runs
CREATE TRIGGER update_verify_runs_updated_at BEFORE UPDATE ON verify_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_verify_runs_candidate ON verify_runs(candidate_version_id);
CREATE INDEX IF NOT EXISTS idx_verify_runs_status ON verify_runs(status);
