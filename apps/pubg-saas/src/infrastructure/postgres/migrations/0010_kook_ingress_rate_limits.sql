-- Recent addressed-request counters are read under the bot admission lock.
-- These indexes cover bot-wide and actor/channel/tenant windows without adding
-- retained message content or a separately mutable rate-counter table.
CREATE INDEX IF NOT EXISTS idx_kook_ingress_recent_bot
  ON kook_ingress_events(bot_account_id,received_at);
CREATE INDEX IF NOT EXISTS idx_kook_ingress_recent_actor
  ON kook_ingress_events(bot_account_id,user_id,received_at);
CREATE INDEX IF NOT EXISTS idx_kook_ingress_recent_channel
  ON kook_ingress_events(bot_account_id,channel_id,received_at)
  WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kook_ingress_recent_tenant
  ON kook_ingress_events(bot_account_id,tenant_id,received_at)
  WHERE tenant_id IS NOT NULL;
