ALTER TABLE kook_ingress_events DROP CONSTRAINT kook_ingress_events_event_kind_check;
ALTER TABLE kook_ingress_events ADD CONSTRAINT kook_ingress_events_event_kind_check
  CHECK (event_kind IN ('group','direct','button','guild_join'));
ALTER TABLE message_outbox ADD COLUMN welcome_guild_id TEXT;
ALTER TABLE message_outbox ADD CONSTRAINT message_outbox_welcome_channel
  CHECK (welcome_guild_id IS NULL OR (target_kind='channel' AND tenant_id IS NULL AND team_id IS NULL));
