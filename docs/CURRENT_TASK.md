# Current Task — Kurisu TTS Tuner (Active Planning / target 1.6.7)

Date: 2026-09-28 local. Active Goal: `docs/AMADEUS_KURISU_TTS_TUNER_GOAL.md`.

The owner explicitly confirmed that the Amadeus 1.6.6 Kurisu OminiX production Goal is complete and requested the next development plan: build a highly adjustable local HTML tuner for Kurisu voice style/prosody/generation parameters.

The new Goal is planning-only until an explicit `/goal` handoff. Do not implement or deploy from this planning commit. `VERSION` remains **1.6.6** during planning and development; the target final release is **1.6.7**, with exactly one patch bump only after implementation and runtime acceptance are ready.

The tuner must reuse the existing single resident OminiX Base 1.7B production model and cached `kurisu-v1` x-vector. It must not start a second model. Production remains on the existing bounded `amadeus-tts` / `:18792` contract. The proposed tuner is an owner-local loopback UI/API on `127.0.0.1:18793`, served by the same native TTS process, with no 9Router/OpenClaw/channel/public path.

The design priority is strong adjustability without fake controls: editable baseline and emotion delta, PROD/A/B/C controlled comparison, text/style/seed/sampling/speed locks, STYLE ONLY / SAMPLING / VARIANCE / FREE COMPARE modes, and the actual pinned OminiX controls `temperature`, `top_k`, `top_p`, `max_new_tokens`, `seed`, `speed_factor`, and `repetition_penalty`. Model/reference/x-vector/language identity remain locked.

Git remains the production source of truth. Runtime drafts/history/audio stay protected outside Git. The browser may create a hash-bound production proposal, but production style is changed only by an explicit repo-owned promotion path that updates the canonical Git-tracked style config, validates, commits/installs the reviewed state, smokes production, and uses the existing owner-notification path. Do not give the TTS HTTP service general Git/shell mutation authority.

Production voice work has priority over Lab batches; Lab samples are sequential and yield between samples. Any real native/candidate switch and final 1.6.7 release must preserve the deployment-notification guarantee established in 1.6.6.

## Previous task — Kurisu OminiX Production Migration (Release 1.6.6, Complete)

Completed Goal: `docs/AMADEUS_KURISU_OMINIX_PRODUCTION_GOAL.md`.

Release 1.6.6 completed the protected A backup, production cutover to OminiX Base 1.7B x-vector + bounded Kurisu emotion, pinned OpenClaw/9Router style transport, deployment-notification repair, rollback evidence and real owner handset acceptance. Current production remains the compatibility baseline for the tuner.

The existing bounded emotion IDs are `default`, `irritated`, `embarrassed`, `angry`, `sarcastic`, `soft`, and `sad`. The current production style already includes explicit sentence-level prosody, emphasis, contrastive rhythm/energy and the sharp-to-soft Kurisu tsundere contour; the tuner exists to let the owner iterate on those characteristics efficiently without reopening the migration.

Evidence remains in `.agent/checkpoints/2026-09-28-amadeus-kurisu-ominix-release.md` and the existing completed Goal/report history.

Older completed/paused Goals and checkpoints remain historical evidence in their existing documents; they are not live instructions.
