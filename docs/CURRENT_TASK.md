# Current Task — Amadeus 1.7.7 private image-generation repair

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: none.
Previous deployed release: **Amadeus 1.7.6**.
Target release: **Amadeus 1.7.7**.
Status: `SOURCE_GATES_PASSED_AWAITING_COMMIT_PUSH_DEPLOY`.

The 1.7.6 live runtime remains healthy. A privacy-preserving audit of the
owner's private WhatsApp image-generation turn found that the Agent passed
`model=openai/gpt-image-2`, overriding the configured logical
`openai/amadeus-image` route. The OpenAI-compatible image provider returned
HTTP 400 `invalid_request_error/bad_request` after the detached task was
accepted. The audit also found that a Chinese inbound message produced
`request_language=unknown` in lifecycle telemetry, indicating that session-only
request-context correlation missed the task context.

The 1.7.7 source fix adds a native `before_tool_call` policy that strips only
model-authored model overrides from generation/edit actions (list/status stay
unchanged), allowing OpenClaw to resolve the operator-configured image
capability. Lifecycle language capture now falls back to an account-scoped
channel/conversation snapshot when the task session key differs. `pnpm
test:delivery` (84 plus pinned integration), `pnpm test:amadeus` (121),
typecheck/build, architecture and fixture checks, version validation, secrets
scan, and `git diff --check` pass. Source commit/push, protected checkpoint,
immutable build and release deployment are pending.

The detailed live incident audit will be recorded in the dated release
checkpoint after deployment. Private user text and image prompt contents are
not retained in Git or release evidence.
