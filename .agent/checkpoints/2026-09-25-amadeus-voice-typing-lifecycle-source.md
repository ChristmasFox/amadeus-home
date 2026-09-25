# 2026-09-25 — WhatsApp voice typing and scoped queue source candidate

## Source changes

- Added `scripts/patch-openclaw-whatsapp-voice-lifecycle.mjs`, pinned by exact anchors to OpenClaw / `@openclaw/whatsapp` 2026.9.4.
- OpenClaw core treats a new event in a session with a live WhatsApp voice lease as `enqueue-followup`, not steering. The queue lock is read from a process-global map created only for active WhatsApp audio replies; typed-only runs, heartbeat/reset paths and other channels retain existing behavior.
- The WhatsApp reply dispatcher starts a composing keepalive for audio inbound replies, refreshes every 3 seconds, and clears it when the complete WhatsApp inbound-turn promise settles after final sends/flush. It has a hard 120-second fallback, is released on WhatsApp disconnect, and is cleared if composing presence cannot be sent.
- Deployment backs up the external `npm/projects` tree before the persistent channel-package patch. The immutable OpenClaw image carries the source patch for core queue behavior.
- Added fixture and lease tests, and registered them in the default test command.

## Validation completed

- `pnpm test:openclaw-voice-lifecycle` passed, including 3-second cadence, immediate composing, 120-second cap, queue identity/order gates, typed-path isolation, exact PTT-then-Chinese-summary pending-turn behavior, failure/cancellation/disconnect cleanup, syntax and patch idempotency.
- Applied the patch to temporary copies of the exact locally installed pinned OpenClaw 2026.9.4 core runner and the live same-version WhatsApp monitor source; both patched files passed `node --check`, and a second apply was idempotent.
- Verified the WhatsApp runtime stdin invocation used by deployment.
- Updated one stale architecture-fixture assertion to the current guard wording (`unscoped prompt enrichment`); the checker itself passed before this fixture repair.
- No live runtime files were changed; no image was built and no container was restarted.

## Not yet validated

- Full `pnpm test`, `pnpm typecheck`, architecture check and secrets scan now pass. Immutable candidate build and CasaOS candidate apply are still pending.
- Real handset proof that composing dots remain visible through both the Japanese PTT and Chinese summary is pending; WhatsApp presence remains provider/client best-effort.
- Real direct voice and group-concurrency ordering are pending. The owner must confirm one Japanese PTT plus one concise Chinese text and that the competing group message is answered afterward.
- No release/version bump. `VERSION` remains 1.5.2 and release acceptance remains closed.
