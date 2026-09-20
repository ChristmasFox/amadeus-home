# Capability planning template

Use this template before adding or materially changing a capability. Keep the
answers in the capability design/PR notes or the relevant checkpoint; do not
turn this file into a second runtime registry.

## Identity and scope

- Capability name:
- User intents and non-goals:
- Trusted identity/authorization boundary:
- Explicit confirmation required for:
- Owning plugin and Skill:

## Architecture ownership

- Deterministic domain owner:
- Native tool names and input schemas:
- External service/adapter boundary:
- Presentation contract and renderer:
- Evidence references and unknown/null semantics:
- Instant/query-period/display-time semantics:

## Side effects and recovery

- Persistent data and source-of-truth files:
- Secrets and runtime-only configuration:
- Idempotency key/outbox behavior:
- Backup and rollback checkpoint:
- Prohibited channels, fallbacks, or retired paths:

## Validation and acceptance

- Unit/integration/regression tests:
- Architecture fixture/check:
- Typecheck/build commands:
- Secrets scan:
- Runtime smoke and real user-facing acceptance evidence:
- Remaining work recorded in `.agent/tasks/`:

Do not add capability-specific workflow to `SOUL.md` or the global workspace
`AGENTS.md`; do not add a keyword router, a second agent runtime, or a free-form
notification transport path.
