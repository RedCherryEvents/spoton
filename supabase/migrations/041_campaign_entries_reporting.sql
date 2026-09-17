-- ============================================================
-- 041_campaign_entries_reporting.sql
--
-- Campaign entries become a first-class reporting surface:
-- richer statuses, duplicate audit rows, JSON answers, activity
-- metadata, and expirable client report shares.
-- Idempotent. Does not rename existing campaign/automation tables.
-- ============================================================

-- Campaign-level reporting settings (duplicate rule, client branding)
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Allow more than one entry per contact so duplicates can be kept
ALTER TABLE campaign_entries
  DROP CONSTRAINT IF EXISTS campaign_entries_campaign_id_contact_id_key;

ALTER TABLE campaign_entries
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE campaign_entries
  ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE campaign_entries
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE campaign_entries
  ADD COLUMN IF NOT EXISTS automation_id UUID REFERENCES automations(id) ON DELETE SET NULL;
ALTER TABLE campaign_entries
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID;
ALTER TABLE campaign_entries
  ADD COLUMN IF NOT EXISTS entry_number INTEGER;

-- Widen status: keep legacy 'active' / 'withdrawn' so in-flight
-- automations keep writing until the app normalizes them.
ALTER TABLE campaign_entries
  DROP CONSTRAINT IF EXISTS campaign_entries_status_check;
ALTER TABLE campaign_entries
  ADD CONSTRAINT campaign_entries_status_check
  CHECK (status IN (
    'in_progress',
    'completed',
    'invalid',
    'duplicate',
    'disqualified',
    'active',
    'withdrawn'
  ));

UPDATE campaign_entries
   SET status = 'in_progress'
 WHERE status = 'active';

UPDATE campaign_entries
   SET completed_at = COALESCE(completed_at, updated_at)
 WHERE status = 'completed'
   AND completed_at IS NULL;

-- Stable per-campaign entry numbers for "Entry #"
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY created_at, id) AS n
    FROM campaign_entries
   WHERE entry_number IS NULL
)
UPDATE campaign_entries e
   SET entry_number = numbered.n
  FROM numbered
 WHERE e.id = numbered.id;

-- Hydrate answers JSON from the existing EAV values
UPDATE campaign_entries e
   SET answers = COALESCE((
     SELECT jsonb_object_agg(
              d.key,
              jsonb_build_object('label', d.label, 'value', v.value)
            )
       FROM campaign_entry_values v
       JOIN campaign_field_definitions d ON d.id = v.field_id
      WHERE v.entry_id = e.id
   ), '{}'::jsonb)
 WHERE e.answers = '{}'::jsonb
   AND EXISTS (
     SELECT 1 FROM campaign_entry_values v2 WHERE v2.entry_id = e.id
   );

CREATE INDEX IF NOT EXISTS idx_campaign_entries_campaign_contact
  ON campaign_entries(campaign_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_campaign_entries_created
  ON campaign_entries(campaign_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_entries_number
  ON campaign_entries(campaign_id, entry_number)
  WHERE entry_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_entries_reference
  ON campaign_entries(campaign_id, entry_reference)
  WHERE entry_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_entries_answers
  ON campaign_entries USING gin (answers);

-- Viewer-readable, agent-writable stays on campaign_entries.
-- Keep select for all members; writes remain agent+.

CREATE TABLE IF NOT EXISTS campaign_report_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  permissions JSONB NOT NULL DEFAULT '{
    "summary": true,
    "statistics": true,
    "answer_breakdown": true,
    "entry_details": true
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_report_shares_campaign
  ON campaign_report_shares(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_report_shares_account
  ON campaign_report_shares(account_id);

ALTER TABLE campaign_report_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_report_shares_select ON campaign_report_shares;
DROP POLICY IF EXISTS campaign_report_shares_insert ON campaign_report_shares;
DROP POLICY IF EXISTS campaign_report_shares_update ON campaign_report_shares;
DROP POLICY IF EXISTS campaign_report_shares_delete ON campaign_report_shares;

-- Members can see shares for their account (UI list). Writes are admin+.
CREATE POLICY campaign_report_shares_select ON campaign_report_shares FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY campaign_report_shares_insert ON campaign_report_shares FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY campaign_report_shares_update ON campaign_report_shares FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY campaign_report_shares_delete ON campaign_report_shares FOR DELETE
  USING (is_account_member(account_id, 'admin'));
