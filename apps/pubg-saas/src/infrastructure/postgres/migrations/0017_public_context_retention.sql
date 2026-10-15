-- Match the private assistant's persistent conversation session behavior.
-- Tenant, user, channel, team and binding revisions remain checked per request.
ALTER TABLE kook_conversation_messages
  DROP CONSTRAINT IF EXISTS kook_conversation_messages_content_check;

UPDATE kook_conversation_messages
SET expires_at='infinity'::timestamptz;

UPDATE public_query_sessions
SET expires_at='infinity'::timestamptz;
