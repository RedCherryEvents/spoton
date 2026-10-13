-- ============================================================
-- 043_ai_usage_automation_generate.sql
--
-- The Automation Generator can turn a script into a draft with the
-- account's own AI key; record that spend under its own mode.
-- Idempotent.
-- ============================================================

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'automation_generate'));
