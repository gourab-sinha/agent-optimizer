-- Migration: Enhance calls table to store additional HighLevel call data
-- Based on HighLevel Voice AI API call logs response structure

-- Add missing call fields from HighLevel API
ALTER TABLE calls ADD COLUMN IF NOT EXISTS contact_id TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS from_number TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_agent_deleted BOOLEAN DEFAULT false;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS message_id TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS translation JSONB DEFAULT '{}';

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_calls_contact_id ON calls(contact_id);
CREATE INDEX IF NOT EXISTS idx_calls_from_number ON calls(from_number);
CREATE INDEX IF NOT EXISTS idx_calls_created_at_ghl ON calls(created_at_ghl DESC);
CREATE INDEX IF NOT EXISTS idx_calls_agent_kind ON calls(agent_id, kind);

-- Add comments
COMMENT ON COLUMN calls.contact_id IS 'HighLevel contact ID associated with the call';
COMMENT ON COLUMN calls.from_number IS 'Phone number that initiated the call';
COMMENT ON COLUMN calls.is_agent_deleted IS 'Whether the agent was deleted in HighLevel at time of call retrieval';
COMMENT ON COLUMN calls.message_id IS 'HighLevel message ID if call was part of a conversation';
COMMENT ON COLUMN calls.translation IS 'Translated transcript if call was in a different language';
COMMENT ON COLUMN calls.executed_actions IS 'Array of executed call actions with full parameters and timestamps';
COMMENT ON COLUMN calls.extracted_data IS 'Key-value pairs of data extracted during the call (email, phone, custom fields, etc.)';
