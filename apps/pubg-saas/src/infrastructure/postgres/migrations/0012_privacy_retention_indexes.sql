CREATE INDEX IF NOT EXISTS idx_result_sets_bot_expiry
  ON result_sets(bot_account_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_session_contexts_bot_expiry
  ON session_contexts(bot_account_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_usage_records_bot_recorded_at
  ON usage_records(bot_account_id, recorded_at);
