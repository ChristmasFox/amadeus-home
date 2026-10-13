-- Durable transport staging precedes tenant authorization, including onboarding
-- in unbound channels and user-scoped DMs. Only sanitized request fields are
-- retained, with expiry and terminal payload removal.
CREATE TABLE kook_ingress_events (
  bot_account_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('group','direct','button')),
  user_id TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  tenant_id TEXT,
  team_id TEXT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('channel','direct')),
  target_id TEXT NOT NULL,
  reply_to_message_id TEXT,
  fingerprint TEXT NOT NULL,
  event_json JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','retry','done','dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  last_error_code TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  PRIMARY KEY (bot_account_id,event_id),
  CHECK ((tenant_id IS NULL) = (team_id IS NULL))
);
CREATE INDEX idx_kook_ingress_due
  ON kook_ingress_events(bot_account_id,status,next_attempt_at,received_at);
CREATE INDEX idx_kook_ingress_actor
  ON kook_ingress_events(bot_account_id,user_id,channel_id,received_at)
  WHERE status IN ('pending','processing','retry');

-- A redelivery of the exact same callback can recover a committed mutation's
-- receipt; a new click/event cannot reuse a consumed token.
ALTER TABLE pending_team_actions ADD COLUMN consumed_event_id TEXT;
ALTER TABLE pending_account_claims ADD COLUMN consumed_event_id TEXT;

-- Onboarding replies and user-scoped DMs have no team. The destination is
-- copied from the trusted ingress row, never from a handler/model payload.
ALTER TABLE message_outbox ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE message_outbox ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE message_outbox ALTER COLUMN channel_id DROP NOT NULL;
ALTER TABLE message_outbox ADD COLUMN IF NOT EXISTS source_event_id TEXT;
ALTER TABLE message_outbox ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'channel'
  CHECK (target_kind IN ('channel','direct'));
ALTER TABLE message_outbox ADD COLUMN target_id TEXT;
UPDATE message_outbox SET target_id=channel_id;
ALTER TABLE message_outbox ALTER COLUMN target_id SET NOT NULL;
ALTER TABLE message_outbox ADD CONSTRAINT message_outbox_target_nonempty CHECK (length(target_id) > 0);
ALTER TABLE message_outbox ADD CONSTRAINT message_outbox_team_scope
  CHECK ((tenant_id IS NULL) = (team_id IS NULL));
ALTER TABLE message_outbox ADD CONSTRAINT message_outbox_destination_kind
  CHECK ((target_kind='direct' AND channel_id IS NULL)
    OR (target_kind='channel' AND channel_id IS NOT NULL AND channel_id=target_id));
CREATE INDEX idx_message_outbox_bot_due ON message_outbox(bot_account_id,status,next_attempt_at,lease_until,created_at);
