# Current Task — Amadeus 1.7.8 image-generation repair

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: none.
Previous live release: **Amadeus 1.7.7**.
Target release: **Amadeus 1.7.8**.
Status: `SOURCE_GATES_PASSED_AWAITING_COMMIT_PUSH_DEPLOY`.

The owner retried private WhatsApp image generation on 1.7.7 and it still failed.
Content-safe logs confirmed `before_tool_call` ran, but the tool result still
reported `openai/gpt-image-2` and the provider returned HTTP 400. The exact pinned
2026.9.4 hook implementation shallow-merges returned params over original params;
omitting `model` did not delete it. The 1.7.8 hook writes a blank model sentinel,
which the native tool treats as no override and therefore resolves the configured
`openai/amadeus-image` capability. No rollback is being performed.

The same trace had `request_language=unknown`. Read-only database comparison
showed the task and inbound session keys match, so 1.7.7 conversation fallback
was not the issue. The capture used `event.body ?? event.content`; a present but
blank body prevented fallback to non-empty content. 1.7.8 now selects the first
non-empty string and tests blank-body Chinese/Japanese capture plus the model
sentinel's OpenClaw merge behavior.

`pnpm test:delivery` (84 plus pinned integration), `pnpm test:amadeus` (121),
Amadeus typecheck/build, architecture checks/fixtures, version validation,
secrets scan and `git diff --check` pass. Source commit/push, protected
checkpoint, immutable build and release deployment are pending.
