UPDATE session_contexts
SET expires_at='infinity'::timestamptz,
    context_json=jsonb_set(context_json,'{expiresAt}',to_jsonb('9999-12-31T23:59:59.999Z'::text))
WHERE platform='kook';
