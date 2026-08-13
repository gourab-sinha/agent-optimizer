-- Persist the HighLevel agency (company) that owns each installed location.
-- Required so Custom JS / embed resolve can bind agency → subaccount → agent.

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS company_id TEXT,
  ADD COLUMN IF NOT EXISTS user_type TEXT;

CREATE INDEX IF NOT EXISTS idx_locations_company_id
  ON locations (company_id)
  WHERE is_deleted = false;

COMMENT ON COLUMN locations.company_id IS 'HighLevel company/agency ID that installed or owns this location';
COMMENT ON COLUMN locations.user_type IS 'OAuth token type at install time: Location or Company';
