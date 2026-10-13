-- PUBG's official account names are public game data shared by shard/account,
-- separate from any tenant's private aliases or roster membership.
CREATE TABLE pubg_accounts (
  shard TEXT NOT NULL CHECK (shard IN ('steam', 'kakao', 'psn', 'xbox')),
  account_id TEXT NOT NULL CHECK (account_id ~ '^account\.[A-Za-z0-9_-]{1,128}$'),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  last_resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shard, account_id)
);
