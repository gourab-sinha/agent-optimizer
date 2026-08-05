-- Migration: Add full agent configuration to agents table
-- This stores the live/current agent configuration from HighLevel

ALTER TABLE agents ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- Add index for faster JSONB queries
CREATE INDEX IF NOT EXISTS idx_agents_config ON agents USING gin(config);

-- Add columns for commonly queried fields (for faster filtering without JSON parsing)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS voice_id TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS inbound_number TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS timezone TEXT;

-- Add index for inbound number lookups
CREATE INDEX IF NOT EXISTS idx_agents_inbound_number ON agents(inbound_number);

-- Add index for language filtering
CREATE INDEX IF NOT EXISTS idx_agents_language ON agents(language);

-- Comment on config column
COMMENT ON COLUMN agents.config IS 'Full agent configuration from HighLevel API including prompt, voice settings, actions, etc.';
