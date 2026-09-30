# Amadeus Qwen3-TTS MLX Production Rebaseline — Goal

Date: 2026-10-01
Type: production TTS rebaseline / provider simplification / destructive retirement cleanup / automatic apply
Status: `COMPLETE`

## Owner decision

The owner explicitly wants to return to the previously accepted local TTS configuration because it produced the best Kurisu voice quality:

```text
Qwen3-TTS 1.7B Base
+ community mlx-audio backend
+ MLX 8-bit model
+ original operator-owned ~46s Kurisu A reference
+ Auto language
```

The exact historical accepted baseline is the A/MLX/Auto candidate recorded around commit `c8f9261d1c093a8188db802c73a38a998d018944`. That candidate used the original ~46 second reference, `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit`, one local inference worker and the OpenAI-compatible speech boundary. The owner had already accepted real WhatsApp voice timbre and typed-message behavior for that candidate.

The post-rebaseline normal provider order is:

```text
local Qwen3-TTS 1.7B Base / MLX / original ~46s A reference
  -> qwen-audio-3.1-tts-flash
  -> qwen-audio-3.0-tts-flash
```

OminiX and GPT-SoVITS/GPT TTS are retired. They are not compatibility fallbacks, not dormant production engines and not alternate local providers after this Goal.

The owner also explicitly authorizes unattended execution through deployment. After automated gates pass, apply the production changes without waiting for another confirmation. Human listening, owner WhatsApp acceptance and other tests that require a person may be skipped for this Goal. Do not skip automated health, contract, fallback, secrets, source, rollback or cleanup checks.

## Desired steady state

1. Exactly one resident local TTS engine on the Mac: Qwen3-TTS 1.7B Base through the previously accepted `mlx-audio` MLX backend.
2. The canonical local voice profile is `kurisu-v1` using the original operator-owned ~46s A reference pair (`reference.wav` + its matching `reference.txt`). Do not substitute the later GPT-SoVITS 22.4s reference or any tuner-generated/shortened sample.
3. Normal/default synthesis uses pure ICL cloning with `lang_code="auto"`; no OminiX instruction layer, local persona prompt, pitch/speed tuner or GPT-SoVITS frontend is allowed to modify this baseline.
4. 9Router keeps the single logical `amadeus-tts` route and attempts the local Qwen3-TTS MLX service first. Cloud Qwen Audio is fallback only.
5. Cloud fallback order remains deterministic: Qwen Audio 3.1 first, then 3.0. Existing protected cloud API key and model-bound voice IDs remain outside Git.
6. No OminiX service, worker, tuner, model, venv, LaunchAgent or active source path remains in production.
7. No GPT-SoVITS service, adapter, model runtime, venv, LaunchAgent or active source path remains in production.
8. Preserve the Kurisu WAV sample assets from the retired GPT-SoVITS/Kurisu TTS package in a protected archive for possible future use. Preserve WAV files only plus a hash manifest; they must not remain active production references unless they are the canonical A reference.
9. Historical Goal/checkpoint documentation may remain as audit evidence when clearly historical; runtime code, active config and deployment scripts must not retain retired engines merely for compatibility.

## Pinned historical MLX baseline

Use the accepted historical values unless live verification proves the existing protected MLX assets already match them:

- `mlx-audio` source revision: `4ab7e6f7dedd69a136cfaa318c5dc8aed5119446`
- `mlx-audio` package version recorded by the accepted deployment: `0.5.6`
- model: `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit`
- model revision: `e7dd0585652209fa0d7783659aad4e8a324de11c`
- profile: `kurisu-v1`
- language: `auto`
- local OpenAI-compatible model aliases remain `amadeus-tts` / `qwen3-tts-1.7b`
- canonical service port should return to `127.0.0.1:18792` unless a live collision is found; do not preserve `:19871` merely for GPT-SoVITS compatibility.

Do not silently upgrade MLX/model dependencies during this rebaseline. First restore the accepted voice path exactly. Dependency modernization is a separate future Goal.

## Phase 0 live-collision exception — 2026-10-01

Read-only M204 inspection found that the accepted historical TTS port `127.0.0.1:18792` is currently owned by the separate Amadeus ImageAssets LaunchAgent, which OpenClaw uses. OrbStack reaches this loopback service through `host.docker.internal`; moving it would require an unrelated OpenClaw restart and image-service port migration, so preserve ImageAssets unchanged. Port `18794` was verified unoccupied and is the rebaseline TTS port under the explicitly allowed live-collision exception above. Bind Qwen TTS to `127.0.0.1:18794`; no GPT compatibility port is reused. The existing ImageAssets listener remains on `127.0.0.1:18792`. A controlled ImageAssets port-reconfiguration attempt returned a launchd bootstrap I/O error and its helper restored the original plist; post-rollback health was HTTP 200 on 18792. Do not retry or restart OpenClaw for this Goal.

## Non-goals

- Do not train, fine-tune or convert a new model.
- Do not introduce IndexTTS, Fish Speech, GPT-SoVITS MLX, OminiX, another voice-cloning engine or a second local resident model.
- Do not change OpenClaw persona, ReplyEnvelope/DeliveryEnvelope semantics, WhatsApp routing, ASR, image generation or unrelated provider behavior.
- Do not add keyword routing or a second Agent/runtime.
- Do not preserve dead compatibility branches for OminiX or GPT-SoVITS.
- Do not require an owner listening session or manual WhatsApp test before apply; the owner explicitly waived human acceptance for this run.
- Do not delete the canonical ~46s A reference pair or the explicitly archived Kurisu WAV samples.

## Phase 0 — re-read Git and live runtime, then freeze rollback

1. Follow `AGENTS.md`: read `docs/CONTEXT.md`, `docs/CURRENT_TASK.md`, this Goal, `docs/PROJECT_STATE.md`, current TTS source and deployment files; then run `git status --short --branch` and recent log inspection.
2. Inspect live Mac and OrbStack/9Router state before mutation:
   - current listeners on `18792`, `18793`, `19870`, `19871`, `18794`, `20130`;
   - relevant LaunchAgents/processes;
   - current 9Router TTS bridge health/provider metadata;
   - current local voice profile paths and file hashes;
   - current MLX asset path/manifest;
   - current GPT-SoVITS and OminiX asset paths.
3. Prove which reference is the historical A profile. The target pair must be the original operator-owned ~46s `kurisu-v1/reference.wav` and matching transcript. Record duration, file size and SHA-256 in protected checkpoint evidence without copying the media into Git.
4. If the accepted MLX venv/model/source assets are still present under the historical protected `mlx-poc` path, verify them against the pinned revisions and reuse them. If missing or invalid, rebuild them from the pinned source/model revisions before changing production.
5. Create one temporary protected rollback checkpoint of the current GPT-SoVITS/9Router route sufficient to recover from a failed apply. This checkpoint is for the operation only; after all automated post-apply gates pass, retired heavy model/runtime assets are intentionally cleaned per Phase 5.
6. Before deleting any GPT-SoVITS/Kurisu package directory, copy every Kurisu reference/sample `.wav` that belongs to that retired TTS package into a dedicated mode-0700 protected archive outside Git (prefer Avalon or the existing Amadeus protected voice area). Generate a content-free manifest containing relative filename, size and SHA-256. Include the last recorded `crs_0695.WAV_0000000000_0000224000.wav` if it exists. Do not archive generated output audio, caches or model weights unless required to identify the sample set.

## Phase 1 — source rebaseline to the accepted Qwen3 MLX engine

The implementation must be a clean rebaseline, not another compatibility layer.

1. Change `infra/macos/qwen3-tts-engine.json` back to `productionEngine: "mlx"` and remove OminiX-specific repository/revision/component/model fields.
2. Keep the accepted `QwenMlxEngine` synthesis semantics:
   - `mlx_audio.tts.utils.load_model`;
   - `ref_audio` = canonical `kurisu-v1/reference.wav`;
   - `ref_text` = matching canonical transcript;
   - `lang_code="auto"`;
   - no instruction/persona/speed/pitch/emotion mutation in the local engine;
   - one inference lock/worker and bounded queue behavior.
3. Simplify `apps/qwen3-tts-service/service.py` so the production engine set is Qwen MPS rollback only if still needed for emergency source-level recovery and MLX as the selected production engine. Remove the OminiX engine import/selection path and any production-only behavior that exists solely to support OminiX instruction synthesis.
4. Remove OminiX runtime source from the active tree, including `ominix_engine.py`, `ominix-worker/**`, OminiX-specific tests/config/deploy plumbing and OminiX-only tuner service code. If a style JSON is still required by the cloud bridge, keep only the cloud-facing style data at the bridge boundary; do not keep a local OminiX engine to consume it.
5. Restore/retain the pinned `mlx-audio` preparation and verification scripts used by the accepted A/MLX deployment. They must validate source revision, model revision, dependency manifest and protected asset permissions before apply.
6. Keep the local service authenticated and loopback-only. Keep `/healthz` and `/v1/audio/speech` compatible with current callers.
7. Keep the current DeliveryEnvelope/ReplyEnvelope call contract. Do not revert unrelated message architecture to the 2026-09-26 tree.

### Local style compatibility rule

The accepted A/MLX sound is the priority. The local engine must never receive synthetic OminiX/GPT-style instructions.

- `style=default` or omitted: attempt local A/MLX first.
- explicit non-default style/emotion: do not mutate the local clone; route directly to the existing cloud Qwen fallback path that supports instruction control.
- do not silently map a non-default style to a different local engine.

This exception keeps semantic correctness while making ordinary/default speech local-first.

## Phase 2 — 9Router TTS bridge simplification

1. Keep one logical `amadeus-tts` bridge and current DeliveryEnvelope-facing request contract.
2. Change the local endpoint from GPT-SoVITS `:19871` back to the authenticated Qwen3-TTS MLX service on `:18794` (Phase 0 collision exception).
3. Update health/provider metadata to truthfully report:

```text
localProvider = qwen3-tts-mlx
localModel = Qwen3-TTS-12Hz-1.7B-Base-8bit
fallbackOrder = [qwen3-tts-mlx, qwen-audio-3.1-tts-flash, qwen-audio-3.0-tts-flash]
```

4. For default synthesis, attempt local MLX first within the existing bounded deadline. Only timeout/network/408/429/5xx/busy/invalid-audio style operational failures may fall through to cloud. Configuration/auth/contract errors fail closed rather than hiding a broken deployment.
5. Preserve the existing cloud 3.1 -> 3.0 model-bound voice IDs and protected key handling. Do not log text, audio, API keys or voice IDs.
6. Remove GPT-SoVITS-specific provider labels, URLs, adapter assumptions and tests from the active bridge.
7. Remove OminiX fallback logic entirely. There must be no fourth provider in normal or hidden fallback order.
8. Update focused executable bridge tests to prove:
   - local MLX success stops the chain;
   - forced local operational failure reaches 3.1;
   - forced local + 3.1 operational failure reaches 3.0;
   - configuration/auth failures fail closed;
   - non-default styles bypass local and use cloud;
   - no OminiX/GPT-SoVITS endpoint is ever called.

## Phase 3 — automated validation before runtime mutation

Run the minimum sufficient validation selected by the repository workflow, plus explicit TTS checks:

1. focused Python tests for Qwen3 TTS service/MLX deployment;
2. Node bridge tests for `tts-bridge.mjs`;
3. syntax/type checks for touched code;
4. `pnpm check:secrets`;
5. `git diff --check`;
6. repository search confirming no active runtime/config reference to OminiX or GPT-SoVITS remains outside historical docs/checkpoints/archive notes;
7. dry-run of Mac Qwen3-TTS manager showing `ENGINE=mlx` and the expected protected paths;
8. dry-run of 9Router deployment/provisioning showing local `:18794` primary and cloud-only fallback.

If these automated checks fail, fix them before apply. Do not ask the owner to wake up for a listening verdict.

## Phase 4 — unattended apply to production

The owner has explicitly authorized automatic apply for this Goal. After Phase 3 passes, use the repository's explicit `--apply` mechanisms without another confirmation prompt.

Apply in this order to avoid two resident local models on the 24 GB Mac:

1. Ensure the accepted MLX assets and canonical A reference are ready.
2. Stop/boot out GPT-SoVITS adapter/API LaunchAgents and confirm `:19870`/`:19871` are no longer serving.
3. Stop any stale OminiX tuner/service process if present and confirm `:18793` is not serving.
4. Install/render/start `com.amadeus.qwen3-tts` with `AMADEUS_TTS_ENGINE=mlx`, the pinned MLX model path and canonical `kurisu-v1` profile. Warm it to ready on `127.0.0.1:18794` (Phase 0 collision exception).
5. Run direct authenticated local health and Japanese synthesis smoke before changing 9Router routing.
6. Apply the 9Router TTS bridge/compose/provider change so the single `amadeus-tts` logical route points local-first to `:18794` and cloud fallback only.
7. Recreate/reload only the minimum affected 9Router service; do not rebuild/restart OpenClaw or unrelated HomeLab services unless the repository's actual dependency graph requires it.
8. Verify 9Router and TTS health after the switch.

No human test is required to proceed from this phase to cleanup.

## Phase 5 — automated post-apply gates and destructive retirement cleanup

Run these automated gates first:

### A. Local engine identity

- `/healthz` ready;
- engine/provider reports MLX/Qwen3-TTS truthfully;
- installed plist/environment points to the pinned MLX model and canonical A profile;
- canonical A WAV duration remains approximately 46 seconds and its hash is unchanged from Phase 0.

### B. Local synthesis

Run bounded Japanese default-style synthesis through the direct local endpoint in at least WAV and the production output format. Verify HTTP success, valid decodable audio, non-zero duration and bounded size. This is a technical smoke only; do not claim new human voice-quality acceptance.

### C. End-to-end route

Call the logical 9Router `amadeus-tts` route with a default request and prove the returned provider is local `qwen3-tts-mlx`.

### D. Forced fallback

With a controlled temporary local outage/failure, prove the bridge falls back to Qwen Audio 3.1. With controlled local + 3.1 operational failure in the executable test harness, prove 3.0 is next. Restore healthy local service immediately after the controlled test.

### E. Retirement state

Verify:

- no listener on `19870`, `19871` or `18793`;
- `18792` remains owned only by ImageAssets; `18794` is owned only by Qwen3-TTS MLX;
- no GPT-SoVITS/OminiX LaunchAgent loaded;
- no GPT-SoVITS/OminiX process resident;
- active 9Router config contains no GPT-SoVITS/OminiX route.

### F. Host viability

Record memory pressure, swap used, Qwen3 TTS process footprint and OrbStack footprint after warmup plus one synthesis. These measurements are evidence, not a new owner gate. Fail/rollback only for clear service instability, severe memory pressure or repeated crash/restart, not merely because historical swap pages remain allocated.

### G. Source integrity

Run final focused tests, secrets scan, `git diff --check`, source search and health checks after runtime apply.

When A–G pass, destructive retirement is authorized:

1. Delete retired GPT-SoVITS model weights, venv/runtime source, adapter runtime, active plist files and dedicated caches that are no longer referenced.
2. Delete retired OminiX model/source/worker/venv/tuner assets and dedicated caches that are no longer referenced.
3. Delete obsolete active repository scripts/plists/tests/config for GPT-SoVITS/OminiX as part of the committed source cleanup.
4. Preserve only:
   - the canonical ~46s A `kurisu-v1` reference pair;
   - the protected archived Kurisu `.wav` sample set + SHA-256 manifest from Phase 0;
   - current cloud TTS secrets/voice IDs;
   - historical text-only docs/checkpoints needed for audit.
5. Never use broad wildcard deletion at the parent `Application Support/Amadeus`, `/Volumes/Avalon`, or model-cache level. Every destructive path must be enumerated and verified to belong exclusively to the retired TTS implementation before deletion.
6. The temporary pre-change heavy rollback checkpoint may be removed after A–G pass and the local/cloud route is healthy, except for small text/hash manifests useful for audit. Do not retain multiple gigabytes of OminiX/GPT-SoVITS merely as a dormant compatibility path.

## Phase 6 — commit, push and record final state

1. Update `docs/CURRENT_TASK.md` and `docs/PROJECT_STATE.md` to the actual post-apply state.
2. Write a dated `.agent/checkpoints/` record containing only non-sensitive facts:
   - source commit;
   - MLX source/model revisions;
   - canonical profile hash/duration (hash only, no media/transcript content unless already non-sensitive and required);
   - live ports/providers;
   - automated test results;
   - forced fallback proof;
   - host memory snapshot;
   - retired path list;
   - protected WAV archive path + manifest hash;
   - explicit note that human listening/owner-channel acceptance was waived for this run.
3. Commit and push the clean source to canonical `main` after the runtime and source agree.
4. Do not bump the root Amadeus product version solely for this infrastructure/provider rebaseline unless the existing repository release workflow determines that a versioned product release is actually required.

## Automated acceptance gates

The Goal is complete when all of the following are true:

- **Exact baseline restored:** production local TTS is Qwen3-TTS 1.7B Base / `mlx-audio` / pinned MLX 8-bit / original ~46s A reference / Auto language.
- **Local-first:** normal/default `amadeus-tts` requests use local MLX first.
- **Cloud fallback only:** operational local failure falls through to Qwen Audio 3.1 then 3.0; there is no OminiX or GPT-SoVITS fallback.
- **Single resident local model:** only Qwen3-TTS MLX remains resident.
- **Retired engines removed:** OminiX and GPT-SoVITS active source/runtime/model/venv/service assets are removed after successful gates.
- **WAV samples preserved:** Kurisu sample WAVs from the retired GPT-SoVITS/Kurisu package are preserved in a protected archive with hashes.
- **Security:** secrets/private audio are not added to Git and no new public listener exists.
- **Automated health:** direct local synthesis, logical route, forced fallback, restart/health and source integrity checks pass.
- **No human gate:** completion does not wait for owner listening, manual WhatsApp acceptance or other human interaction because the owner explicitly waived those gates for this run.

## Failure and rollback rule

Before destructive Phase 5 cleanup, any failed automated apply/health/fallback gate must restore the temporary pre-change route sufficiently to keep `amadeus-tts` available, then stop with evidence. Do not destroy the only working production path after a failed switch.

After A–G pass and retired assets are deliberately deleted, long-term recovery is declarative rather than compatibility-based: rebuild the pinned Qwen3 MLX service from Git + protected A profile, while cloud Qwen remains the runtime fallback. Do not resurrect OminiX/GPT-SoVITS automatically.


## Completion evidence — 2026-10-01

All automated gates A–G passed and the authorized retirement cleanup completed.

| Gate | Evidence |
| --- | --- |
| A — exact local identity | LaunchAgent health is ready on loopback `127.0.0.1:18794`, with `provider=qwen3-tts-mlx`, the pinned Qwen3-TTS 1.7B Base MLX 8-bit model, `kurisu-v1`, and `language=auto`. Port 18792 remains the separately owned ImageAssets service under the Phase 0 live-collision exception. |
| B — local synthesis/auth | Direct Japanese WAV and MP3 requests passed; WAV decoded with non-zero bounded duration, MP3 decoded with FFmpeg, and unauthenticated speech returned 401. |
| C — logical route | The logical `amadeus-tts` alias returned valid MP3. The 9Router sidecar recorded `qwen3-tts-mlx` as the successful local provider. One clean bridge provider connection remains. |
| D — cloud fallback | Controlled local `busy` was followed by a real successful Qwen Audio 3.1 fallback while the production local service remained healthy. The executable bridge test forced local and 3.1 operational failures and verified 3.0 as attempt 2. |
| E — retirement state | No listeners remain on 18793, 19870, or 19871; GPT-SoVITS/OminiX LaunchAgents/processes/provider connections are absent. Qwen3-TTS alone owns 18794; ImageAssets remains on 18792. |
| F — host viability | Current Qwen footprint was 3,380 MiB with 17.2 GiB peak; system free-memory reading was 70%, swap 5,223 MiB, OrbStack host RSS about 5,272 MiB. No repeated crash or severe active memory pressure occurred. |
| G — source/security integrity | Focused Python and Node tests, Amadeus tests/typecheck/build, pinned MLX asset verification, secrets scan, final active-source search and `git diff --check` passed. Legacy implementation/config/tests/plists are removed from active source. |

The original A WAV remains unchanged (46.000 s, SHA-256
`fb1ed35df7a872cea3e12d77546e9d7ba885df562214d320007b5e5d1b4482fa`). The
retired package's one Kurisu sample WAV is protected outside Git at
`/Volumes/Avalon/backups/operation-skuld/amadeus-kurisu-wav-archive-20261001`;
its manifest SHA-256 is
`e1362946d7d04abb4d22faa4ed65e93acbeb97045445c955992ebfd58e75a6c9`.
The temporary pre-change DB/config checkpoints and old active 9Router image tag
were removed after the gates passed; the small content-safe Phase 0 hash/state
record remains at
`/Volumes/Avalon/backups/operation-skuld/qwen3-tts-rebaseline-20261001/baseline.json`.

Source commits `0fdfdbb` (rebaseline/deployed bridge source), `45f96a9`
(final retirement/source cleanup), and `46d0b49` (content-safe evidence) are pushed to canonical `main`; the dated
content-safe completion record is
`.agent/checkpoints/2026-10-01-amadeus-qwen3-tts-mlx-rebaseline.md`. Amadeus
`VERSION=1.7.4` was not changed. Human listening, owner-channel and WhatsApp
gates were explicitly waived and were not performed.
