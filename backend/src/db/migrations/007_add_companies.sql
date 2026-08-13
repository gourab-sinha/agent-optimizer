-- Agency (company) OAuth tokens. One install at the agency mints
-- per-subaccount location tokens via POST /oauth/locationToken.

CREATE TABLE IF NOT EXISTS companies (
  id               TEXT PRIMARY KEY,
  name             TEXT,
  access_token     TEXT NOT NULL,
  refresh_token    TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  user_type        TEXT DEFAULT 'Company',
  is_deleted       BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_not_deleted
  ON companies (id)
  WHERE is_deleted = false;

COMMENT ON TABLE companies IS 'HighLevel agency accounts and their company-level OAuth tokens';
