-- Bounded, channel-scoped conversation context for the public assistant.
-- Message bodies are retained for at most 12 hours; no tenant authority is
-- inferred from this table. The active ingress lease remains the source of
-- truth for every tool invocation.
CREATE TABLE kook_conversation_messages (
  bot_account_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  speaker_kind TEXT NOT NULL CHECK (speaker_kind IN ('human','assistant')),
  speaker_id TEXT NOT NULL,
  source_event_id TEXT,
  reply_to_message_id TEXT,
  content TEXT NOT NULL CHECK (length(content) <= 1600),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (bot_account_id, channel_id, message_id)
);
CREATE INDEX idx_kook_conversation_recent
  ON kook_conversation_messages(bot_account_id,channel_id,created_at DESC);
CREATE INDEX idx_kook_conversation_expiry
  ON kook_conversation_messages(expires_at);

-- Provider diagnostics and token counts contain no prompt or response text.
CREATE TABLE kook_agent_runs (
  bot_account_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  model_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('replied','provider_fallback','tool_degraded','model_unconfigured')),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,64}$'),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (bot_account_id,event_id)
);
CREATE INDEX idx_kook_agent_runs_expiry ON kook_agent_runs(expires_at);
