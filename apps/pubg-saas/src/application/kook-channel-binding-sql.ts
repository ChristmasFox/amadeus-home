/** One authoritative KOOK binding relationship for PUBG queries and memory. */
export const KOOK_CHANNEL_BINDING_JOIN = `JOIN channel_bindings binding ON binding.tenant_id=tenant.tenant_id
  AND binding.platform=tenant.platform AND binding.bot_account_id=tenant.bot_account_id`;
export const KOOK_CHANNEL_VERSION_JOIN = `JOIN channel_binding_versions version ON version.bot_account_id=binding.bot_account_id
  AND version.channel_id=binding.channel_id`;
export const KOOK_CHANNEL_BINDING_FILTER = `tenant.platform='kook' AND tenant.bot_account_id=$1
  AND tenant.guild_id=$2 AND binding.channel_id=$3`;
