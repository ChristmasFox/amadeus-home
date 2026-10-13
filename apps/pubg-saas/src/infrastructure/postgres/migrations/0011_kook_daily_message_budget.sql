CREATE TABLE kook_message_daily_usage (
  bot_account_id TEXT PRIMARY KEY CHECK (length(bot_account_id) BETWEEN 1 AND 128),
  window_key DATE NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= 10000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kook_message_daily_reservations (
  bot_account_id TEXT NOT NULL CHECK (length(bot_account_id) BETWEEN 1 AND 128),
  reservation_hash TEXT NOT NULL CHECK (reservation_hash ~ '^[a-f0-9]{64}$'),
  window_key DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'spent', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_account_id, reservation_hash)
);

CREATE INDEX idx_kook_message_daily_reservations_window
  ON kook_message_daily_reservations(window_key);
