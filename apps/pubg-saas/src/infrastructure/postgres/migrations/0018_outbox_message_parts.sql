ALTER TABLE message_outbox
  ADD COLUMN reply_group_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN reply_part INTEGER NOT NULL DEFAULT 0 CHECK (reply_part >= 0),
  ADD COLUMN reply_part_count INTEGER NOT NULL DEFAULT 1 CHECK (reply_part_count >= 1),
  ADD CONSTRAINT message_outbox_reply_part_range CHECK (reply_part < reply_part_count);

CREATE INDEX idx_message_outbox_reply_parts
  ON message_outbox(bot_account_id,reply_group_key,reply_part)
  WHERE reply_group_key <> '';
