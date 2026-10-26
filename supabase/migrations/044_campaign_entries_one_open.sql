-- ============================================================
-- 044_campaign_entries_one_open.sql
--
-- At most one open (in_progress / legacy active) entry per contact per
-- campaign. addCampaignEntry already reuses an open entry, but its
-- check-then-insert could race when two keyword messages from the same
-- contact were processed at once; with this index the second insert
-- fails and addCampaignEntry returns the surviving open entry.
-- Duplicate-status rows and closed entries are unaffected.
--
-- Idempotent. Skips (with a NOTICE) instead of failing if existing data
-- already has a contact with two open entries in one campaign.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM campaign_entries
     WHERE status IN ('in_progress', 'active')
     GROUP BY campaign_id, contact_id
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'idx_campaign_entries_one_open not created: some contacts have more than one open entry in a campaign. Close the extras, then re-run this migration.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_entries_one_open
      ON campaign_entries (campaign_id, contact_id)
      WHERE status IN ('in_progress', 'active');
  END IF;
END $$;
