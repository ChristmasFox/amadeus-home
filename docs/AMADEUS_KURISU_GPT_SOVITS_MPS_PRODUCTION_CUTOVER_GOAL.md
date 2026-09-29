# Amadeus Kurisu GPT-SoVITS MPS Production Cutover — Goal

Date: 2026-09-29
Type: production TTS integration / staged cutover / rollback-controlled runtime change
Status: `IN_PROGRESS_GROUP_CHANNEL_FIX` — production apply completed on 2026-09-29; direct-message acceptance passed, but group-channel acceptance exposed a concurrency defect.
Prerequisite: `docs/AMADEUS_KURISU_GPT_SOVITS_POC_GOAL.md` completed as `ACCEPTED_FOR_FURTHER_INTEGRATION`.

## Decision already made

The owner listened to the controlled A/B set and recorded:

> GPT-SoVITS 明显比 Qwen 3.1 更像牧濑红莉栖，Gate B 通过。

The validated candidate is the pinned `bysq/TTS-KurisuMakise` GPT-SoVITS-v2Pro runtime on Apple MPS. The existing MPS PoC runtime, model checkpoints, neutral reference, generated audio, benchmark files and smoke evidence remain outside Git and must not be deleted during this Goal.

## Goal

Promote the already validated GPT-SoVITS v2Pro MPS implementation into the production `amadeus-tts` boundary as the only resident local TTS provider, with the normal fallback order:

```text
GPT-SoVITS v2Pro MPS primary
  -> qwen-audio-3.1-tts-flash
  -> qwen-audio-3.0-tts-flash
```

The cutover must preserve the existing OpenClaw/ReplyEnvelope/channel contracts, protected Qwen model-bound voice IDs, bounded request policy, deterministic fallback behavior and a tested rollback to the current accepted production path. The OminiX Qwen3-TTS runtime is retained as a complete rollback asset but is not part of the post-cutover normal route or resident local TTS set.

## Current execution checkpoint — 2026-09-29

The explicit apply phase is complete. GPT-SoVITS v2Pro MPS is ready through
the loopback API on `:19870` and authenticated adapter on `:19871`; the live
`amadeus-tts` bridge returned `gpt-sovits-mps` for the primary smoke. With the
adapter deliberately stopped, the bridge returned valid cloud audio and the
9Router audit log recorded `qwen-audio-3.1-tts-flash` as the first fallback;
the executable bridge test records the subsequent 3.0 fallback ordering.
OminiX is uninstalled with no listeners on `:18792`/`:18793`. The complete
rollback checkpoint remains protected and readable. Evidence is retained at
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-postapply-20260929T171128Z/`.

The direct-message path was accepted, but the owner reported incorrect
group-chat behavior. The retained diagnosis at
`/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-cutover-postapply-20260929T171128Z/group-chat-diagnosis-20260929T173255Z/`
shows that GPT-SoVITS and ASR completed while concurrent group arrivals could
overlap in the same session and let a later text run reach the final WhatsApp
delivery boundary first. The repo-only candidate fix changes the ingress tail
to serialize every inbound WhatsApp arrival per session, not only arrivals
that already observe a voice lease. Focused lifecycle, bundle, policy,
voice-failure, bilingual-envelope, group-policy, syntax, diff and secrets
checks pass. The fix has not been applied to production; do not restart or
switch the live service until the explicit apply phase. Keep this Goal open
until a real group text voice request, inbound group voice note, concurrent
group messages, ordinary group text isolation, and owner DM regression all
pass.

## Non-goals

- Do not convert the model to MLX or change the OminiX MLX runtime in this Goal.
- Do not retrain or fine-tune the candidate.
- Do not change OpenClaw persona, Skills, ReplyEnvelope, channel routing or sender policy.
- Do not remove Qwen 3.1 or Qwen 3.0, their protected model-bound voice IDs, or the complete OminiX rollback assets.
- Do not leave OminiX Qwen3-TTS resident after cutover; safely boot it out and disable its `:18792` service and `:18793` tuner.
- Do not expose GPT-SoVITS, reference audio, checkpoints or tokens publicly.
- Do not delete the MPS PoC runtime or external acceptance evidence.
- Do not change production until the explicit apply phase after all dry-run and compatibility checks pass.

## Required phases

### Phase 0 — freeze and protected checkpoint

1. Read the current Git/live state and verify the production `amadeus-tts` route, OminiX LaunchAgent, ports `18792`/`18793`, protected tokens and current health.
2. Record the current source hashes, provider/alias state and complete OminiX rollback artifacts outside Git.
3. Confirm the candidate checkpoint/reference hashes still match the PoC checkpoint and that stopping OminiX will not delete shared caches or unrelated service data.

### Phase 1 — production-compatible GPT-SoVITS boundary

1. Convert the tested MPS runtime into a repo-owned, authenticated OpenAI-compatible service boundary for `/v1/audio/speech` and `/healthz`.
2. Preserve one resident model, bounded text length, bounded request timeout, single inference concurrency and non-root execution.
3. Accept only the production model/voice contract needed by `amadeus-tts`; reject unsupported style, instruction, seed and generation controls rather than silently changing character behavior.
4. Return the formats required by the existing bridge (`wav`, `mp3`, `opus`) and keep raw text/audio out of logs.
5. Make readiness fail closed until the pinned model, reference audio and MPS backend are loaded and warmed.

### Phase 2 — fallback routing design and dry-run

1. Define the provider/adapter changes required so GPT-SoVITS is attempted first and provider failures/timeouts fall through to Qwen 3.1 and then Qwen 3.0.
2. Preserve the current Qwen `default` pure-clone contract and model-bound voice IDs on every fallback path.
3. Verify that OminiX is not selected by the normal post-cutover route; it is rollback-only. Unrelated ASR, image, OpenClaw and other provider/Combo state must fail closed on drift.
4. Run repository tests, type/syntax checks, `pnpm check:secrets`, `git diff --check` and a no-write route smoke before any runtime mutation.

### Phase 3 — explicit staged apply

1. Require an explicit `--apply` or equivalent operator confirmation for each runtime/provider write.
2. Start and warm GPT-SoVITS MPS first on a dedicated production boundary, then stop or drain the current OminiX resident TTS process; never overlap two resident local speech models on the 24 GB host.
3. Safely boot out the OminiX `com.amadeus.qwen3-tts` service, verify no OminiX listener remains on `:18792`, and safely disable the `:18793` tuner. Preserve the complete OminiX source, model, voice, token, plist and rollback checkpoint outside Git.
4. Apply the smallest possible provider/adapter/route change so only GPT-SoVITS is resident locally and Qwen 3.1 -> Qwen 3.0 are the live fallbacks.
5. Verify health, auth, model/voice contract, Japanese synthesis and fallback dispatch after the cutover.

### Phase 4 — acceptance and rollback evidence

1. Run direct GPT-SoVITS health and synthesis smoke with the production request contract.
2. Run 9Router `amadeus-tts` provider smoke and verify the primary provider identity.
3. Force controlled GPT-SoVITS failure cases and prove Qwen 3.1 -> Qwen 3.0 fallback ordering without fabricating successful primary evidence; verify OminiX is not attempted in the normal route.
4. Verify the OminiX service and tuner are stopped, disabled and no longer listening on `:18792`/`:18793`, while all rollback assets remain readable and protected.
5. Run a real owner-channel voice acceptance test covering Japanese pronunciation, character identity, visible text behavior and typed-text isolation.
6. Record latency/RTF, RSS, host memory pressure and rollback status in a dated checkpoint.
7. If any acceptance or resource gate fails, restore the protected pre-cutover Qwen 3.1 -> Qwen 3.0 -> OminiX route, including the OminiX service/tuner, and verify health before stopping.

## Acceptance gates

- **Compatibility:** GPT-SoVITS serves the existing authenticated `amadeus-tts` request contract without changing caller behavior.
- **Primary identity:** owner confirms the production path still sounds recognizably like Kurisu and matches the accepted PoC.
- **Fallback correctness:** forced primary failures produce Qwen 3.1, then Qwen 3.0 in the exact documented order; OminiX is not part of the normal post-cutover route.
- **Host viability:** GPT-SoVITS MPS is the only resident local TTS model and coexists with the host workload without unacceptable sustained memory pressure or swap growth.
- **OminiX retirement:** the OminiX `:18792` service and `:18793` tuner are safely stopped and disabled, with no OminiX process/listener left resident; complete rollback assets remain protected and usable.
- **Safety:** secrets and private media stay outside Git; no public listener or second Agent/runtime is introduced.
- **Rollback:** a single protected checkpoint restores the pre-cutover Qwen 3.1 -> Qwen 3.0 -> OminiX route, including OminiX service/tuner recovery, and all health checks pass.

## Completion evidence

The Goal is complete only when the dated checkpoint contains the exact candidate/provider revisions, route diff, health and auth evidence, primary-provider proof, fallback proof, owner-channel acceptance, resource measurements, protected rollback location and post-cutover health. A plan or dry-run alone is not completion.

The current dated checkpoint is
`.agent/checkpoints/2026-09-29-amadeus-kurisu-gpt-sovits-post-cutover.md`.
It records all non-owner-channel gates and explicitly marks owner-channel
acceptance as pending.

## Deferred MLX optimization

MLX conversion, Japanese frontend work, checkpoint conversion/parity and MLX performance tuning are explicitly deferred to a later independent Goal. This Goal must not silently mix MLX implementation into the MPS production cutover.
