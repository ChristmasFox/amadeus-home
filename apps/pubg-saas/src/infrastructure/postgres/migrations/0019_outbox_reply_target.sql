ALTER TABLE message_outbox
  ADD COLUMN reply_to_message_id TEXT;

UPDATE message_outbox
SET reply_to_message_id=source_event_id
WHERE source_event_id IS NOT NULL;
