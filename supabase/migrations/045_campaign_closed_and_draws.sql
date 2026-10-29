-- ============================================================
-- 045_campaign_closed_and_draws.sql
--
-- Competitions: a "closed" campaign status, and an audit table for
-- winner draws. Each draw records who ran it, when, the exact pool of
-- eligible entries (ids + hash) and the random index used, so the
-- selection can be checked afterwards. Notification of the winner is
-- a separate, recorded admin action.
-- Idempotent.
-- ============================================================

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'active', 'paused', 'closed', 'archived'));

CREATE TABLE IF NOT EXISTS campaign_draws (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  drawn_by UUID NOT NULL REFERENCES auth.users(id),
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method TEXT NOT NULL DEFAULT 'random' CHECK (method IN ('random')),
  -- Eligible entry ids at draw time, sorted; and sha256 of them joined by ","
  pool_entry_ids JSONB NOT NULL,
  pool_size INTEGER NOT NULL CHECK (pool_size > 0),
  pool_hash TEXT NOT NULL,
  -- Index into pool_entry_ids chosen by crypto.randomInt(pool_size)
  random_index INTEGER NOT NULL,
  winner_entry_id UUID NOT NULL REFERENCES campaign_entries(id),
  note TEXT,
  -- Winner notification (separate admin action, after the draw)
  notified_at TIMESTAMPTZ,
  notified_by UUID REFERENCES auth.users(id),
  notification_template TEXT,
  notification_message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_campaign_draws_campaign
  ON campaign_draws(campaign_id, drawn_at DESC);

ALTER TABLE campaign_draws ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_draws_select ON campaign_draws;
DROP POLICY IF EXISTS campaign_draws_insert ON campaign_draws;
DROP POLICY IF EXISTS campaign_draws_update ON campaign_draws;
-- Members can read the audit trail; only admins can draw or notify.
-- No delete policy: draws are never removed.
CREATE POLICY campaign_draws_select ON campaign_draws FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY campaign_draws_insert ON campaign_draws FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY campaign_draws_update ON campaign_draws FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
