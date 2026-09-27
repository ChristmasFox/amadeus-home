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

## Planning record — Amadeus model-capability adapter (2026-09-27)

This records the answers for `docs/AMADEUS_MODEL_CAPABILITY_ADAPTER_GOAL.md`;
the Goal, Git source, and live runtime remain authoritative, not this template.

- **Identity and scope:** The user may request a new image, or explicitly ask
  for a voice reply from typed text. An admitted WhatsApp/Telegram group member
  may use native `image_generate` without approval; group admission is still
  determined by existing channel policies. Non-owner direct-chat tool access
  and unrelated sensitive/owner-only tools do not expand. Image editing and
  model tiers are out of scope. Mutation tools still require their existing
  owner identity and explicit confirmation; no new confirmation is required
  for a new image.
- **Architecture ownership:** OpenClaw remains the sole Agent and selects the
  native `image_generate` or final tagged TTS capability. The model-neutral
  image-generation and single voice-reply Skills own intent/output rules.
  `infra/9router/model-capabilities.json` and the existing 9Router management
  API own the deterministic ordered image fallback; no new domain state
  machine or transport-specific domain code is needed. Native channel reply
  attachment delivery remains unchanged.
- **Structured result, evidence, unknowns, and time:** The new-image contract
  yields one normal channel image attachment only on success. Failed or
  unavailable backends return their structured failure, not a fabricated
  image. Voice output is Japanese audio plus matching visible Japanese and a
  faithful Chinese summary; an ASR failure remains text-only. No new time
  semantics are introduced. Backend evidence is the Combo state, sanitized
  route logs, and real channel receipts; generated payloads are not Git data.
- **Side effects and recovery:** The only new persistent 9Router state is the
  `amadeus-image` Combo and its per-Combo fallback setting. Provisioning is
  idempotent via the existing protected loopback API client, with an external
  0600 minimal pre-change snapshot and independent restore. OpenClaw changes
  use the existing protected config/image checkpoint and immutable commit-tag
  release workflow. Existing 9Router accounts/OAuth, ASR/TTS aliases, native
  Mac TTS files/process, owner outbox, secrets, and senders remain untouched.
  No new outbox/idempotency key or secret is introduced.
- **Proof gates:** `pnpm test:model-capability-adapter`, affected package
  typecheck/build, architecture checks, `pnpm check:secrets`, pinned OpenClaw
  config validation, normal release tests/build, authenticated 9Router image
  smoke, fallback-path evidence, and real owner/non-owner group plus three-way
  voice acceptance are required. Record protected rollback paths and
  content-safe acceptance in a dated checkpoint; unfinished acceptance belongs
  in `.agent/tasks/` and does not count as Goal completion.
- **Explicit exclusions:** No `SOUL.md` or global `AGENTS.md` workflow, keyword
  router, second Agent/runtime, duplicate image/TTS tool or sender, 9Router
  source patch, ASR/TTS Combo fallback, or notification fallback is introduced.
