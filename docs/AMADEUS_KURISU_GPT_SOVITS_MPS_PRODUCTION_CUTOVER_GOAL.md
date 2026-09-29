# Amadeus Kurisu GPT-SoVITS MPS Production Cutover — Goal

Date: 2026-09-29
Type: production TTS integration / staged cutover / rollback-controlled runtime change
Status: `PLANNED_NOT_ACTIVE` — execute only after the owner invokes `/goal`.
Prerequisite: `docs/AMADEUS_KURISU_GPT_SOVITS_POC_GOAL.md` completed as `ACCEPTED_FOR_FURTHER_INTEGRATION`.

## Decision already made

The owner listened to the controlled A/B set and recorded:

> GPT-SoVITS 明显比 Qwen 3.1 更像牧濑红莉栖，Gate B 通过。

The validated candidate is the pinned `bysq/TTS-KurisuMakise` GPT-SoVITS-v2Pro runtime on Apple MPS. The existing MPS PoC runtime, model checkpoints, neutral reference, generated audio, benchmark files and smoke evidence remain outside Git and must not be deleted during this Goal.

## Goal

Promote the already validated GPT-SoVITS v2Pro MPS implementation into the production `amadeus-tts` boundary as the primary TTS provider, while retaining the current fallback order:

```text
GPT-SoVITS v2Pro MPS primary
  -> qwen-audio-3.1-tts-flash
  -> qwen-audio-3.0-tts-flash
  -> existing OminiX Qwen3-TTS fallback
```

The cutover must preserve the existing OpenClaw/ReplyEnvelope/channel contracts, protected Qwen model-bound voice IDs, bounded request policy, deterministic fallback behavior and a tested rollback to the current accepted production path.

## Non-goals

- Do not convert the model to MLX or change the OminiX MLX runtime in this Goal.
- Do not retrain or fine-tune the candidate.
- Do not change OpenClaw persona, Skills, ReplyEnvelope, channel routing or sender policy.
- Do not remove Qwen 3.1, Qwen 3.0 or the existing OminiX fallback.
- Do not expose GPT-SoVITS, reference audio, checkpoints or tokens publicly.
- Do not delete the MPS PoC runtime or external acceptance evidence.
- Do not change production until the explicit apply phase after all dry-run and compatibility checks pass.

## Required phases

### Phase 0 — freeze and protected checkpoint

1. Read the current Git/live state and verify the production `amadeus-tts` route, LaunchAgent, ports `18792`/`18793`, protected tokens and current health.
2. Record the current source hashes, provider/alias state and exact rollback artifacts outside Git.
3. Confirm the candidate checkpoint/reference hashes still match the PoC checkpoint and that no shared cache or unrelated service will be removed.

### Phase 1 — production-compatible GPT-SoVITS boundary

1. Convert the tested MPS runtime into a repo-owned, authenticated OpenAI-compatible service boundary for `/v1/audio/speech` and `/healthz`.
2. Preserve one resident model, bounded text length, bounded request timeout, single inference concurrency and non-root execution.
3. Accept only the production model/voice contract needed by `amadeus-tts`; reject unsupported style, instruction, seed and generation controls rather than silently changing character behavior.
4. Return the formats required by the existing bridge (`wav`, `mp3`, `opus`) and keep raw text/audio out of logs.
5. Make readiness fail closed until the pinned model, reference audio and MPS backend are loaded and warmed.

### Phase 2 — fallback routing design and dry-run

1. Define the provider/adapter changes required so GPT-SoVITS is attempted first and provider failures/timeouts fall through to Qwen 3.1, Qwen 3.0 and OminiX in that order.
2. Preserve the current Qwen `default` pure-clone contract and model-bound voice IDs on every fallback path.
3. Verify that only the intended `amadeus-tts` route changes; unrelated ASR, image, OpenClaw and other provider/Combo state must fail closed on drift.
4. Run repository tests, type/syntax checks, `pnpm check:secrets`, `git diff --check` and a no-write route smoke before any runtime mutation.

### Phase 3 — explicit staged apply

1. Require an explicit `--apply` or equivalent operator confirmation for each runtime/provider write.
2. Stop or drain the current resident TTS process before starting GPT-SoVITS; never overlap two resident speech models on the 24 GB host.
3. Apply the smallest possible provider/adapter/LaunchAgent change, retaining the current Qwen/OminiX artifacts for immediate rollback.
4. Restart only the affected service, then verify health, auth, model/voice contract, Japanese synthesis and fallback dispatch.

### Phase 4 — acceptance and rollback evidence

1. Run direct GPT-SoVITS health and synthesis smoke with the production request contract.
2. Run 9Router `amadeus-tts` provider smoke and verify the primary provider identity.
3. Force controlled GPT-SoVITS failure cases and prove Qwen 3.1 -> Qwen 3.0 -> OminiX fallback ordering without fabricating successful primary evidence.
4. Run a real owner-channel voice acceptance test covering Japanese pronunciation, character identity, visible text behavior and typed-text isolation.
5. Record latency/RTF, RSS, host memory pressure and rollback status in a dated checkpoint.
6. If any acceptance or resource gate fails, restore the protected Qwen/OminiX route and verify health before stopping.

## Acceptance gates

- **Compatibility:** GPT-SoVITS serves the existing authenticated `amadeus-tts` request contract without changing caller behavior.
- **Primary identity:** owner confirms the production path still sounds recognizably like Kurisu and matches the accepted PoC.
- **Fallback correctness:** forced primary failures produce Qwen 3.1, then Qwen 3.0, then OminiX in the exact documented order.
- **Host viability:** one resident MPS model coexists with the host workload without unacceptable sustained memory pressure or swap growth.
- **Safety:** secrets and private media stay outside Git; no public listener or second Agent/runtime is introduced.
- **Rollback:** a single protected checkpoint restores the current accepted Qwen 3.1 -> Qwen 3.0 -> OminiX route and all health checks pass.

## Completion evidence

The Goal is complete only when the dated checkpoint contains the exact candidate/provider revisions, route diff, health and auth evidence, primary-provider proof, fallback proof, owner-channel acceptance, resource measurements, protected rollback location and post-cutover health. A plan or dry-run alone is not completion.

## Deferred MLX optimization

MLX conversion, Japanese frontend work, checkpoint conversion/parity and MLX performance tuning are explicitly deferred to a later independent Goal. This Goal must not silently mix MLX implementation into the MPS production cutover.
