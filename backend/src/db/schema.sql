-- Trigger function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE companies (
  id               TEXT PRIMARY KEY,       -- GHL companyId (agency)
  name             TEXT,
  access_token     TEXT NOT NULL,          -- encrypted company token
  refresh_token    TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  user_type        TEXT DEFAULT 'Company',
  is_deleted       BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE locations (
  id            TEXT PRIMARY KEY,          -- GHL locationId
  name          TEXT,
  company_id    TEXT,                      -- GHL agency / company that owns this location
  user_type     TEXT,                      -- OAuth token class: Location | Company
  access_token  TEXT NOT NULL,             -- encrypted at rest
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_locations_company_id
  ON locations (company_id)
  WHERE is_deleted = false;

CREATE TABLE agents (
  id            TEXT PRIMARY KEY,          -- GHL agentId
  location_id   TEXT REFERENCES locations(id),
  name          TEXT,
  sync_cursor   BIGINT DEFAULT 0,          -- unix ms of newest ingested call
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT REFERENCES agents(id),
  label         TEXT NOT NULL,             -- 'baseline', 'candidate-1'
  source        TEXT NOT NULL CHECK (source IN ('snapshot','candidate')),
  parent_version_id UUID REFERENCES agent_versions(id),
  config        JSONB NOT NULL,            -- full agent config incl. prompt
  actions       JSONB NOT NULL DEFAULT '[]', -- agent's actions at snapshot time
  sim_overrides JSONB DEFAULT '{}',        -- {temperature, model} for harness only
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
-- Versions are INSERT-only. No UPDATE path exists in the code.

CREATE TABLE calls (
  id            TEXT PRIMARY KEY,          -- GHL callId or 'sim:<uuid>'
  agent_id      TEXT REFERENCES agents(id),
  agent_version_id UUID REFERENCES agent_versions(id), -- version active when call happened / simulated
  kind          TEXT NOT NULL CHECK (kind IN ('real','simulated')),
  test_run_id   UUID,                      -- null for real calls
  created_at_ghl TIMESTAMPTZ,
  duration_s    INT,
  summary       TEXT,
  raw_transcript TEXT,                     -- original flat string (real calls)
  executed_actions JSONB DEFAULT '[]',     -- same shape for real + simulated
  extracted_data JSONB DEFAULT '{}',
  redaction_map JSONB DEFAULT '{}',        -- {token: original} — never sent to LLMs
  is_deleted    BOOLEAN DEFAULT false,
  ingested_at   TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE call_turns (
  id            TEXT PRIMARY KEY,          -- '<callId>:<idx>' = the span ID
  call_id       TEXT REFERENCES calls(id) ON DELETE CASCADE,
  idx           INT NOT NULL,
  speaker       TEXT NOT NULL CHECK (speaker IN ('agent','caller','system')),
  text          TEXT NOT NULL,             -- redacted
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (call_id, idx)
);

CREATE TABLE rubrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_version_id UUID REFERENCES agent_versions(id),
  version       INT NOT NULL DEFAULT 1,    -- bumped on user edit
  content_hash  TEXT NOT NULL,             -- sha256 of criteria JSON, cache key
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE rubric_criteria (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_id     UUID REFERENCES rubrics(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,             -- 'collects_email', 'handles_price_objection'
  category      TEXT NOT NULL CHECK (category IN
                  ('data_collection','flow','tone','objection','compliance','tools')),
  description   TEXT NOT NULL,             -- human-readable, shown in UI
  check_type    TEXT NOT NULL CHECK (check_type IN ('deterministic','llm')),
  check_spec    JSONB NOT NULL,            -- see §6
  severity      INT NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 3),
  enabled       BOOLEAN DEFAULT true,
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE findings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id       TEXT REFERENCES calls(id) ON DELETE CASCADE,
  rubric_id     UUID REFERENCES rubrics(id),
  criterion_id  UUID REFERENCES rubric_criteria(id),
  status        TEXT NOT NULL CHECK (status IN ('pass','fail','partial','missed_opportunity','na')),
  -- missed_opportunity: agent met the criterion's letter but left value on the table
  -- (e.g. never offered the premium option). Feeds upsell/flow recommendations, not fixes.
  confidence    REAL,                      -- 0-1, 1.0 for deterministic
  rationale     TEXT,
  evidence_turn_ids TEXT[] DEFAULT '{}',   -- FKs into call_turns.id
  method        TEXT NOT NULL CHECK (method IN ('deterministic','llm')),
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (call_id, criterion_id, rubric_id)
);

CREATE TABLE issue_patterns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_version_id UUID REFERENCES agent_versions(id),
  rubric_id     UUID REFERENCES rubrics(id),
  criterion_id  UUID REFERENCES rubric_criteria(id),
  title         TEXT NOT NULL,             -- LLM-written, e.g. 'Caves on price objections'
  description   TEXT NOT NULL,
  fail_count    INT NOT NULL,
  call_count    INT NOT NULL,              -- calls evaluated
  impact_score  REAL NOT NULL,             -- see §7 formula
  representative_finding_ids UUID[] NOT NULL,
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE test_cases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT REFERENCES agents(id),
  seeded_by_pattern_id UUID REFERENCES issue_patterns(id), -- null = happy path
  kind          TEXT NOT NULL CHECK (kind IN ('happy_path','edge_case')),
  title         TEXT NOT NULL,
  persona       JSONB NOT NULL,            -- see §8
  scenario      TEXT NOT NULL,
  criterion_ids UUID[] NOT NULL,           -- rubric criteria this case asserts
  extra_asserts JSONB DEFAULT '[]',        -- case-specific deterministic checks
  archived      BOOLEAN DEFAULT false,
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE test_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_version_id UUID REFERENCES agent_versions(id),
  rubric_id     UUID REFERENCES rubrics(id),
  trigger       TEXT NOT NULL CHECK (trigger IN ('manual','verify_before','verify_after')),
  runs_per_case INT NOT NULL DEFAULT 3,
  status        TEXT NOT NULL DEFAULT 'queued',
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE test_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id   UUID REFERENCES test_runs(id) ON DELETE CASCADE,
  test_case_id  UUID REFERENCES test_cases(id),
  attempt       INT NOT NULL,              -- 1..runs_per_case
  call_id       TEXT REFERENCES calls(id), -- the simulated call
  passed        BOOLEAN NOT NULL,
  criterion_outcomes JSONB NOT NULL,       -- {criterionId: {status, rationale, evidenceTurnIds}}
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (test_run_id, test_case_id, attempt)
);

CREATE TABLE recommendations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_version_id UUID REFERENCES agent_versions(id), -- version being improved
  candidate_version_id UUID REFERENCES agent_versions(id), -- null until accepted into candidate
  tier          TEXT NOT NULL CHECK (tier IN ('applicable','advisory')),
  rec_type      TEXT NOT NULL,             -- see §10 whitelist
  payload       JSONB NOT NULL,            -- typed per rec_type
  rationale     TEXT NOT NULL,
  linked_pattern_ids UUID[] NOT NULL,      -- traceability: must be non-empty
  expected_criterion_ids UUID[] NOT NULL,  -- criteria this should fix
  status        TEXT NOT NULL DEFAULT 'proposed'
                CHECK (status IN ('proposed','accepted','rejected','applied','verified','regressed')),
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE llm_calls (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage         TEXT NOT NULL,             -- 'rubric','finding','pattern','testgen','sim_caller','sim_agent','judge','recommend'
  ref_id        TEXT,                      -- callId / testRunId etc.
  model         TEXT, temperature REAL,
  prompt_tokens INT, completion_tokens INT,
  latency_ms    INT,
  cache_hit     BOOLEAN DEFAULT false,
  is_deleted    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON llm_calls (stage, created_at);

-- Create triggers to automatically update updated_at timestamp
CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_versions_updated_at BEFORE UPDATE ON agent_versions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_calls_updated_at BEFORE UPDATE ON calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_call_turns_updated_at BEFORE UPDATE ON call_turns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rubrics_updated_at BEFORE UPDATE ON rubrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rubric_criteria_updated_at BEFORE UPDATE ON rubric_criteria
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_findings_updated_at BEFORE UPDATE ON findings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_issue_patterns_updated_at BEFORE UPDATE ON issue_patterns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_test_cases_updated_at BEFORE UPDATE ON test_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_test_runs_updated_at BEFORE UPDATE ON test_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_test_results_updated_at BEFORE UPDATE ON test_results
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_recommendations_updated_at BEFORE UPDATE ON recommendations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_llm_calls_updated_at BEFORE UPDATE ON llm_calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();