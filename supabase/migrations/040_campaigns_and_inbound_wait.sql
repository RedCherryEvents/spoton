-- ============================================================
-- 040_campaigns_and_inbound_wait.sql
--
-- First-class campaigns + campaign entries, inbound-wait parks for
-- Ask Question, and a wider notifications.type check.
-- Idempotent. Does not rename existing automation trigger/step types.
-- ============================================================

-- Campaigns (account-scoped; names/codes/keywords are user-defined)
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  keyword TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, code)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_account ON campaigns(account_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_account_status ON campaigns(account_id, status);

DROP TRIGGER IF EXISTS set_updated_at ON campaigns;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaigns_select ON campaigns;
DROP POLICY IF EXISTS campaigns_insert ON campaigns;
DROP POLICY IF EXISTS campaigns_update ON campaigns;
DROP POLICY IF EXISTS campaigns_delete ON campaigns;
CREATE POLICY campaigns_select ON campaigns FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY campaigns_insert ON campaigns FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY campaigns_update ON campaigns FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY campaigns_delete ON campaigns FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- Per-campaign custom fields (EAV definitions)
CREATE TABLE IF NOT EXISTS campaign_field_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text'
    CHECK (field_type IN ('text', 'number', 'email', 'phone', 'select')),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  options JSONB,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (campaign_id, key)
);

CREATE INDEX IF NOT EXISTS idx_campaign_fields_campaign
  ON campaign_field_definitions(campaign_id, position);

ALTER TABLE campaign_field_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_fields_select ON campaign_field_definitions;
DROP POLICY IF EXISTS campaign_fields_insert ON campaign_field_definitions;
DROP POLICY IF EXISTS campaign_fields_update ON campaign_field_definitions;
DROP POLICY IF EXISTS campaign_fields_delete ON campaign_field_definitions;
CREATE POLICY campaign_fields_select ON campaign_field_definitions FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY campaign_fields_insert ON campaign_field_definitions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY campaign_fields_update ON campaign_field_definitions FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY campaign_fields_delete ON campaign_field_definitions FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- One entry per contact per campaign
CREATE TABLE IF NOT EXISTS campaign_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'disqualified', 'withdrawn')),
  entry_reference TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_entries_campaign_status
  ON campaign_entries(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_entries_contact
  ON campaign_entries(contact_id);
CREATE INDEX IF NOT EXISTS idx_campaign_entries_account
  ON campaign_entries(account_id);

DROP TRIGGER IF EXISTS set_updated_at ON campaign_entries;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON campaign_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE campaign_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_entries_select ON campaign_entries;
DROP POLICY IF EXISTS campaign_entries_insert ON campaign_entries;
DROP POLICY IF EXISTS campaign_entries_update ON campaign_entries;
DROP POLICY IF EXISTS campaign_entries_delete ON campaign_entries;
CREATE POLICY campaign_entries_select ON campaign_entries FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY campaign_entries_insert ON campaign_entries FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY campaign_entries_update ON campaign_entries FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY campaign_entries_delete ON campaign_entries FOR DELETE
  USING (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS campaign_entry_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id UUID NOT NULL REFERENCES campaign_entries(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES campaign_field_definitions(id) ON DELETE CASCADE,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entry_id, field_id)
);

ALTER TABLE campaign_entry_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_entry_values_select ON campaign_entry_values;
DROP POLICY IF EXISTS campaign_entry_values_insert ON campaign_entry_values;
DROP POLICY IF EXISTS campaign_entry_values_update ON campaign_entry_values;
DROP POLICY IF EXISTS campaign_entry_values_delete ON campaign_entry_values;
CREATE POLICY campaign_entry_values_select ON campaign_entry_values FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM campaign_entries e
      WHERE e.id = campaign_entry_values.entry_id
        AND is_account_member(e.account_id)
    )
  );
CREATE POLICY campaign_entry_values_insert ON campaign_entry_values FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM campaign_entries e
      WHERE e.id = campaign_entry_values.entry_id
        AND is_account_member(e.account_id, 'agent')
    )
  );
CREATE POLICY campaign_entry_values_update ON campaign_entry_values FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM campaign_entries e
      WHERE e.id = campaign_entry_values.entry_id
        AND is_account_member(e.account_id, 'agent')
    )
  );
CREATE POLICY campaign_entry_values_delete ON campaign_entry_values FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM campaign_entries e
      WHERE e.id = campaign_entry_values.entry_id
        AND is_account_member(e.account_id, 'agent')
    )
  );

-- Inbound-wait parks for Ask Question (delay waits keep wait_kind='delay')
ALTER TABLE automation_pending_executions
  ADD COLUMN IF NOT EXISTS wait_kind TEXT NOT NULL DEFAULT 'delay';

DO $$
BEGIN
  ALTER TABLE automation_pending_executions
    DROP CONSTRAINT IF EXISTS automation_pending_executions_wait_kind_check;
  ALTER TABLE automation_pending_executions
    ADD CONSTRAINT automation_pending_executions_wait_kind_check
    CHECK (wait_kind IN ('delay', 'inbound_reply'));
EXCEPTION WHEN others THEN
  NULL;
END $$;

ALTER TABLE automation_pending_executions
  ADD COLUMN IF NOT EXISTS expect_var_key TEXT;

CREATE INDEX IF NOT EXISTS idx_automation_pending_inbound
  ON automation_pending_executions (account_id, contact_id, created_at)
  WHERE status = 'pending' AND wait_kind = 'inbound_reply';

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_pending_inbound_one
  ON automation_pending_executions (account_id, contact_id)
  WHERE status IN ('pending', 'running') AND wait_kind = 'inbound_reply';

-- Notifications: allow automation-generated rows
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'automation_notify'));
