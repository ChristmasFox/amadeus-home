# Current Task — Kurisu OminiX Production Migration (Release 1.6.6)

Date: 2026-09-28 local. Completed Goal: `docs/AMADEUS_KURISU_OMINIX_PRODUCTION_GOAL.md`.

The owner accepted the completed Kurisu A/C Emotion PoC and authorized the production direction: do not repeat the A/C matrix; preserve the current A runtime as a protected rollback checkpoint, then cut production TTS over to the accepted OminiX Base 1.7B x-vector + bounded emotion path. The stable `amadeus-tts` capability, `kurisu-v1` voice identity, port 18792 and existing channel delivery remain the compatibility boundary.

Current repository and production release are **1.6.6**. The patch bump was performed exactly once, and the single-release Chinese notes, verification, deployment, rollback evidence, and owner notification are recorded in the checkpoint below.

Deployment notification reliability is part of this Goal. Real candidate/native/release runtime switches must no longer complete silently: candidate and final release events use distinct idempotent owner-outbox notifications, and final `amadeus-release:1.6.6` delivery must have a sent marker before the Goal is complete. Keep the existing OwnerNotifier/WhatsApp secondary delivery path; do not add another sender or hardcode an owner target.

Implementation and release execution are complete through the protected A backup, OminiX C cutover, bounded Kurisu emotion contract, pinned OpenClaw/9Router pass-through, release 1.6.6, deployment notifications, rollback evidence, and a real owner handset inbound voice acceptance. See `.agent/checkpoints/2026-09-28-amadeus-kurisu-ominix-release.md` for content-safe evidence. The CLI `agent --deliver` path remains excluded because it bypasses the channel TTS finalizer.

## Previous task — Kurisu A/C Emotion PoC (Complete / owner accepted)

Goal: `docs/AMADEUS_KURISU_AC_EMOTION_POC_GOAL.md`.

Execution evidence: `docs/reports/AMADEUS_KURISU_AC_EMOTION_POC_2026_09.md`.

The PoC used the same accepted Kurisu reference and Qwen3-TTS 1.7B Base family for the production A control and pinned OminiX C path. C0-C5 used OminiX Base x-vector / clone+instruct, not CustomVoice; all labeled samples were delivered to the owner WhatsApp target. The owner has now listened and accepted C for production, superseding the report's earlier `pending_owner_listening` decision state.

Older completed/paused Goals and checkpoints remain historical evidence in their existing documents; they are not live instructions.
