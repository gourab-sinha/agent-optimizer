-- Migration: Add Performance Indexes for 10k+ Users Scale
-- These indexes improve query performance for common access patterns

-- ============================================================================
-- Calls table indexes
-- ============================================================================

-- Index for fetching calls by agent, ordered by date (most common query)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_agent_created
  ON calls (agent_id, created_at_ghl DESC)
  WHERE is_deleted = false;

-- Index for fetching calls by location
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_location_created
  ON calls (location_id, created_at_ghl DESC)
  WHERE is_deleted = false;

-- ============================================================================
-- Findings table indexes
-- ============================================================================

-- Compound index for call + rubric lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_call_rubric
  ON findings (call_id, rubric_id)
  WHERE is_deleted = false;

-- Index for criterion-based queries (pattern detection)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_criterion_status
  ON findings (criterion_id, status)
  WHERE is_deleted = false;

-- ============================================================================
-- Test results indexes
-- ============================================================================

-- Index for fetching test results by run
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_results_run
  ON test_results (test_run_id)
  WHERE is_deleted = false;

-- Index for fetching test results by test case
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_results_case
  ON test_results (test_case_id)
  WHERE is_deleted = false;

-- ============================================================================
-- Agent versions indexes
-- ============================================================================

-- Index for fetching latest version by agent
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_versions_agent_created
  ON agent_versions (agent_id, created_at DESC)
  WHERE is_deleted = false;

-- ============================================================================
-- Rubrics and criteria indexes
-- ============================================================================

-- Index for fetching rubric by agent version
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rubrics_version
  ON rubrics (agent_version_id)
  WHERE is_deleted = false;

-- Index for fetching criteria by rubric
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rubric_criteria_rubric
  ON rubric_criteria (rubric_id)
  WHERE is_deleted = false AND enabled = true;

-- ============================================================================
-- Issue patterns indexes
-- ============================================================================

-- Index for fetching patterns by agent version
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issue_patterns_version
  ON issue_patterns (agent_version_id)
  WHERE is_deleted = false;

-- Index for sorting patterns by impact
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issue_patterns_impact
  ON issue_patterns (agent_version_id, impact_score DESC)
  WHERE is_deleted = false;

-- ============================================================================
-- Recommendations indexes
-- ============================================================================

-- Index for fetching recommendations by agent version
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recommendations_version
  ON recommendations (agent_version_id)
  WHERE is_deleted = false;

-- ============================================================================
-- LLM calls indexes (for cost tracking)
-- ============================================================================

-- Index for aggregating LLM usage by stage
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_llm_calls_stage_created
  ON llm_calls (stage, created_at DESC)
  WHERE is_deleted = false;

-- ============================================================================
-- Locations and tokens indexes
-- ============================================================================

-- Index for fetching locations by company
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_locations_company
  ON locations (company_id)
  WHERE is_deleted = false;

-- ============================================================================
-- Call turns index (for transcript searches)
-- ============================================================================

-- Index for fetching turns by call
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_call_turns_call
  ON call_turns (call_id, idx)
  WHERE is_deleted = false;
