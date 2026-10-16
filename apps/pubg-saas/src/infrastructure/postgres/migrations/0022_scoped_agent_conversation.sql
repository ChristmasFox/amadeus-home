-- Old group transcripts have no trustworthy tenant/team/binding provenance.
-- Keep them as archives, but do not let a later binding generation reuse them.
ALTER TABLE kook_conversation_messages
  ADD COLUMN context_scope_kind TEXT,
  ADD COLUMN context_tenant_id TEXT,
  ADD COLUMN context_team_id TEXT,
  ADD COLUMN context_binding_revision BIGINT;

ALTER TABLE kook_conversation_messages
  ADD CONSTRAINT kook_conversation_context_scope_kind_check
    CHECK (context_scope_kind IS NULL OR context_scope_kind IN ('direct','group')),
  ADD CONSTRAINT kook_conversation_context_scope_shape_check
    CHECK (
      (context_tenant_id IS NULL) = (context_team_id IS NULL)
      AND (context_binding_revision IS NULL OR context_binding_revision >= 0)
      AND (
        context_scope_kind IS NULL
        OR (context_scope_kind='direct' AND context_tenant_id IS NULL
          AND context_team_id IS NULL AND context_binding_revision IS NULL)
        OR (context_scope_kind='group' AND context_binding_revision IS NOT NULL)
      )
    );

-- A retained direct-message row is safe to reuse only when its original
-- durable ingress still proves the same bot + actor-derived channel key.
UPDATE kook_conversation_messages conversation
SET context_scope_kind='direct'
FROM kook_ingress_events ingress
WHERE conversation.context_scope_kind IS NULL
  AND conversation.source_event_id=ingress.event_id
  AND conversation.bot_account_id=ingress.bot_account_id
  AND ingress.event_kind='direct'
  AND conversation.channel_id='dm:' || ingress.bot_account_id || ':' || ingress.user_id;

CREATE INDEX idx_kook_conversation_scope_recent
  ON kook_conversation_messages(
    bot_account_id,channel_id,context_scope_kind,context_tenant_id,context_team_id,
    context_binding_revision,created_at DESC,message_id DESC
  );
