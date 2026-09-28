# Amadeus Kurisu OminiX Production Migration Goal

Date: 2026-09-28 local

Status: **active planning; execution requires an explicit `/goal` handoff**.

Target release: **Amadeus 1.6.6**. The repository is currently at 1.6.5. Do not bump `VERSION` in this planning-only commit; the implementation must perform exactly one `./scripts/amadeus-version.sh bump patch` only after the new production path is implementation-complete and ready for final release.

## 1. Owner decisions and objective

The owner has listened to the completed Kurisu A/C Emotion PoC and accepts the C path for production. The prior comparison Goal is complete for decision purposes.

This Goal SHALL:

1. preserve the current production A path as a protected rollback checkpoint;
2. replace the resident production TTS engine with the accepted C path: pinned OminiX Qwen3-TTS MLX Base 1.7B x-vector voice cloning plus bounded emotion/style conditioning;
3. keep the stable external TTS contract (`amadeus-tts`, `qwen3-tts-1.7b`, `kurisu-v1`, port 18792, auth, formats, timeout and channel delivery) unless a compatibility change is strictly required and documented;
4. give Kurisu a deterministic voice-personality baseline and a small bounded semantic emotion contract;
5. restore deployment notifications so a real runtime switch is not silently completed;
6. release the completed migration as Amadeus 1.6.6 with a real release notification and rollback evidence.

This Goal does **not** repeat the A0/C0-C5 comparison matrix. The owner already accepted C. Post-cutover health/speech/channel smoke is release acceptance, not another A/C experiment.

## 2. Accepted PoC facts

The accepted C implementation is fixed to the same family and revisions proven in `docs/reports/AMADEUS_KURISU_AC_EMOTION_POC_2026_09.md` unless an implementation blocker requires an owner-approved change:

- OminiX repository: `OminiX-ai/OminiX-MLX`
- OminiX revision: `4988a3fcfa48b8cb5d0780a501b92c6a41401523`
- component: `qwen3-tts-mlx`
- model: `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit`
- model revision: `e7dd0585652209fa0d7783659aad4e8a324de11c`
- model mode: Base x-vector voice clone; C1-C5 proved clone+instruct, not CustomVoice
- language: Japanese for Kurisu spoken replies
- listening output baseline: mono 24 kHz MP3, 96 kbps

The accepted production voice source remains the protected `kurisu-v1` reference asset. Do not commit the reference audio, transcript, derived x-vector, generated audio, tokens, owner target, or model weights.

## 3. Release and version invariant

This is a user-visible production capability change and must be a numbered release, not an unversioned runtime mutation.

Implementation flow:

1. keep `VERSION=1.6.5` while implementing and validating non-release source changes;
2. use the existing candidate mechanism only if needed to validate the OpenClaw transport patch against the live runtime, while keeping the live version unchanged;
3. after C is integrated and production acceptance gates are ready, run exactly:
   `./scripts/amadeus-version.sh bump patch`
4. expected result from 1.6.5 is **1.6.6**;
5. replace `RELEASE_NOTES.md` with a single Chinese Amadeus 1.6.6 release entry only;
6. run `./scripts/amadeus-version.sh check`;
7. commit the reviewed release source before any final release apply;
8. final release must use the normal release path, not `--candidate`, and must prove the owner notification is delivered.

The release notes should describe only this release: Kurisu OminiX production TTS, personality-aware bounded emotion delivery, and restored deployment notifications. Do not repeat unchanged capabilities.

## 4. Target production architecture

The stable capability and channel routing remain:

```text
OpenClaw / Amadeus
  -> voice-reply contract
  -> bounded semantic emotion id
  -> tagged native TTS
  -> OpenAI-compatible TTS provider
  -> 9Router logical model: amadeus-tts
  -> selfhosted-tts connection
  -> M204 native :18792
  -> OminiX Qwen3-TTS Base 1.7B 8-bit
     + kurisu-v1 x-vector
     + deterministic Kurisu style mapping
  -> MP3/Opus/WAV
  -> existing channel reply delivery
```

OpenClaw remains the sole Agent runtime. 9Router remains a model/protocol router and must not infer user intent or Kurisu emotion. The M204 TTS service must not become a second planner.

There must be exactly one resident 1.7B production TTS engine after cutover. Do not keep A and C resident together as fallback; the PoC already showed unnecessary memory/swap pressure when both allocations coexisted.

## 5. Kurisu voice personality baseline

Kurisu is the spoken persona inspired by Makise Kurisu. The default spoken delivery must not collapse to a generic neutral female voice whenever no strong situational emotion is selected.

The TTS service owns one deterministic `kurisu-default` baseline instruction. It should describe observable delivery characteristics rather than rely on the single label “tsundere”. Baseline intent:

- rational, composed, intelligent and self-assured;
- natural and restrained rather than theatrical;
- slightly sharp/dry, with light impatience or dry wit when appropriate;
- lightly tsundere / reluctant-to-admit-concern flavor;
- no forced moe voice, no exaggerated anime acting, no repeated catchphrases.

The baseline is a speech-delivery contract. General conversation personality remains owned by the existing persona layer; do not move capability workflow into `SOUL.md` or global `AGENTS.md`.

## 6. Bounded Emotion V1 contract

Do not expose arbitrary free-form instruct text to the Agent. OpenClaw may select only a small semantic enum; the native TTS boundary maps that enum to fixed reviewed OminiX instruct text.

Production V1 enum:

```text
default
irritated
embarrassed
angry
sarcastic
soft
sad
```

Semantics:

- `default`: Kurisu baseline only; this is the fallback for missing/unknown semantic need.
- `irritated`: stronger impatience / mild reproach while remaining controlled.
- `embarrassed`: flustered, reluctant, slightly hesitant, trying to hide the feeling.
- `angry`: clearly angry/sharp but restrained; do not shout by default.
- `sarcastic`: dry sarcasm, teasing/complaining, restrained mockery.
- `soft`: concern/comfort with a softer voice while preserving Kurisu’s restrained character.
- `sad`: subdued and restrained sadness, slightly lower/slow delivery.

The service combines:

```text
final_instruct = kurisu_default_baseline + emotion_delta
```

`default` uses the baseline with no additional delta. Unsupported values must fail closed or normalize to `default` according to the final request-schema decision; they must never be treated as raw prompt text.

Do not add intensity scales, panic/fear/surprise, per-sentence emotion segmentation, or free-form prompt control in this release.

## 7. Semantic emotion selection boundary

Emotion selection belongs to the normal Agent response semantics, not keyword routing.

The voice-reply Skill may instruct OpenClaw to select one enum value that matches the tone of the Japanese answer. It must not define trigger-word tables such as `担心 -> embarrassed`.

The existing visible contract remains:

```text
中文：<faithful concise summary>

日本語：<spoken Japanese answer>
<audio-only tagged TTS controls>
```

The Japanese visible line and TTS spoken text remain identical. Emotion metadata must not appear in visible WhatsApp/Telegram text.

Ordinary typed replies that do not request voice remain text-only. Verified inbound voice and explicit typed voice requests continue to share the same voice-reply contract.

## 8. OpenClaw -> 9Router emotion transport

Pinned OpenClaw v2026.9.4 must be treated as the implementation truth. Its OpenAI speech provider currently accepts per-reply directive overrides for voice/model/speed but does not natively map an `emotion` directive into the OpenAI-compatible request body. Do not assume newer upstream behavior is present.

Preferred production transport:

```text
[[tts:emotion=embarrassed]]
[[tts:text]]...Japanese text...[[/tts:text]]
   -> validated provider override
   -> OpenAI-compatible request body: style="embarrassed"
   -> 9Router
   -> native TTS service style enum
```

Implement the smallest pinned-runtime patch needed to make `emotion` a bounded provider override and serialize it as `style` only for the configured custom OpenAI-compatible TTS path. The patch must:

- validate against the exact V1 enum;
- preserve existing voice/model/speed behavior;
- preserve `tts.auto=tagged` and audio-only `tts:text` behavior;
- strip directives from visible output exactly as today;
- never allow `provider` switching;
- never allow arbitrary instruct text to enter the request;
- be fixture-tested against pinned OpenClaw 2026.9.4;
- be applied reproducibly in the immutable image/runtime path and be recognized by `deploy-openclaw.sh` rebuild detection.

Do not invent a second `[[amadeus:*]]` text marker protocol.

## 9. Minimal 9Router pass-through

The evaluated 9Router TTS handler already recognizes request `style` and passes it to `handleTtsCore`, but the current `selfhosted-tts` adapter does not forward that option to the native endpoint.

This Goal authorizes only the minimal protocol pass-through required for this capability:

```text
incoming body.style
 -> existing TTS handler style argument
 -> selfhosted-tts adapter options.style
 -> upstream /v1/audio/speech body.style
```

9Router must not interpret, remap, classify or choose the emotion. It only forwards the bounded string supplied by OpenClaw. Existing `amadeus-tts` alias/model identity remains unchanged.

Keep the change reproducible from this repository (patch/provision fixture or equivalent source-of-truth mechanism), with an exact upstream revision check. Do not broaden into a general 9Router refactor, TTS Combo work, ASR changes, or new fallback behavior.

If a clean pass-through cannot be implemented without a larger 9Router fork, stop and report the blocker instead of bypassing 9Router or inventing a hidden text encoding.

## 10. Native OminiX production service contract

The production endpoint remains `:18792` and must retain the current bounded OpenAI-compatible service surface:

- `GET /healthz`
- authenticated `GET /v1/voices`
- authenticated `POST /v1/audio/speech`
- model id `qwen3-tts-1.7b`
- voice id `kurisu-v1`
- Bearer auth using the existing protected token
- hard input limit 1200 characters
- WAV / MP3 / Opus output
- MP3 96 kbps compatibility
- one inference worker and one bounded pending slot
- 5-second queue-start timeout
- existing outer 120-second TTS request window
- sanitized metrics/logging only; never log spoken text, reference transcript, token or private owner target.

The implementation may use a direct Rust HTTP service or a lightweight existing HTTP boundary with one persistent OminiX worker, but it MUST load the OminiX model once and keep it resident. Per-request CLI/model startup is prohibited.

The service must load/extract the `kurisu-v1` speaker x-vector once at startup and cache it for all requests. V1 should keep the protected reference audio as the voice source of truth. Persisting a derived x-vector is optional; if persisted, it must stay outside Git with mode 0600 and be bound to reference/model hashes.

`/healthz` may return ready only after model load, x-vector preparation and a real bounded warmup have succeeded.

## 11. A-path protected rollback checkpoint

Before stopping the current A service, create a new protected external checkpoint under the existing Avalon/Skuld backup boundary. This is mandatory and precedes any production cutover.

Preserve enough state to restore A without relying on the new C runtime:

- current `com.amadeus.qwen3-tts` LaunchAgent plist;
- installed `service.py`, `mlx_engine.py`, `engine_contract.py` and runtime requirements;
- current `qwen3-tts-engine.json` and model/revision identity;
- current MLX environment/venv metadata and all non-reconstructible runtime files;
- protected `kurisu-v1` reference pair;
- protected TTS token;
- model asset snapshot or a verified immutable reconstruction manifest sufficient for offline rollback according to available storage;
- current health/PID/last-exit state;
- SHA-256 for non-secret files and metadata-only records for secrets.

Checkpoint directory must be mode 0700; protected files mode 0600. Secret/reference contents never enter Git or logs.

Rollback procedure must be scripted/documented and proven syntactically before cutover:

```text
stop C
 -> restore A files/plist/runtime
 -> bootstrap A
 -> wait ready on :18792
 -> direct authenticated speech smoke
 -> 9Router amadeus-tts smoke
```

Do not keep A resident as automatic fallback.

## 12. Deployment notification gap and required fix

The current release workflow already creates `amadeus-release:<version>` through the owner outbox and requires a `.sent.json` marker for a normal release. However, `deploy-openclaw.sh --candidate` explicitly sets `OWNER_NOTIFICATION=skipped-candidate`, and the native macOS TTS manager has no deployment notification envelope. This explains why real recent candidate/native switches can be silent even though the release notifier itself exists.

This Goal changes the invariant to:

> **Every successful real runtime deployment/switch must leave an owner notification event; candidate and release notifications are distinct and idempotent.**

Required behavior:

### Candidate runtime switch

A successful `--candidate` switch must enqueue/deliver a clearly labeled candidate deployment notification, not a release notification. Suggested idempotency key:

```text
amadeus-candidate-deploy:<source-commit>:<checkpoint-id>
```

It should include content-safe source commit/checkpoint/component facts and make clear that no release version was published.

### Final release

The final 1.6.6 release continues using:

```text
amadeus-release:1.6.6
```

It must contain the one-release Chinese `RELEASE_NOTES`, target host, version, and content-safe acceptance/rollback facts. Completion requires production outbox entry plus observed sent marker through the existing WhatsApp owner notifier.

### Failed cutover / rollback

If C cutover fails and A is restored, enqueue one warning event through the same owner outbox with an idempotent rollback key. Do not create a direct WhatsApp sender or alternate transport.

### Sender architecture

All deployment events must continue to use:

```text
scripts/notify-owner.sh
 -> protected owner outbox
 -> Amadeus OwnerNotifier
 -> configured owner WhatsApp secondary account
```

No phone number, channel credential or direct Baileys/Meta sender may be added to deployment scripts.

Add regression coverage proving candidate and release paths no longer silently report success without the expected notification state.

## 13. Implementation phases

### Phase 0 — Fresh facts and completed PoC closure

1. Read `AGENTS.md`, `docs/CONTEXT.md`, `docs/CURRENT_TASK.md`, this Goal, architecture/project state, the A/C PoC report, current TTS service/manager, voice-reply Skill, OpenClaw config, 9Router speech provisioning and release scripts.
2. Run `git status --short --branch` and `git log -5 --oneline --decorate`.
3. Record the owner decision that C is accepted; mark the old PoC historical/completed in current task state when implementation begins.
4. Confirm live Amadeus version is 1.6.5 and current production TTS is healthy before any mutation.
5. Verify pinned OminiX/model revisions and the protected reference hash against the accepted PoC evidence.

### Phase 1 — Implement bounded emotion plumbing while VERSION remains 1.6.5

1. Add the deterministic V1 emotion enum and Kurisu baseline/delta mapping at the native TTS boundary.
2. Implement the long-lived OminiX production engine/service without per-request model reload.
3. Extend `/v1/audio/speech` with optional bounded `style`; absent style must remain backward-compatible and select `default`.
4. Add focused native service tests for auth, model/voice validation, style allowlist, default fallback policy, formats, queue bounds and secret/text log hygiene.
5. Add the pinned OpenClaw provider patch that converts validated `[[tts:emotion=...]]` to request `style` for the custom OpenAI-compatible TTS path.
6. Update the voice-reply Skill to select one semantic V1 emotion without keyword rules and emit the emotion directive alongside the existing exact Japanese `tts:text` block.
7. Add the minimal pinned 9Router selfhosted-TTS style pass-through plus fixture/version guard.
8. Update image/rebuild detection and patch application so the immutable OpenClaw image cannot omit the emotion transport patch.
9. Keep `amadeus-tts`, ASR, image routing and unrelated permissions unchanged.

### Phase 2 — Fix deployment notification semantics

1. Change real candidate apply from `skipped-candidate` to a distinct candidate deployment notification.
2. Preserve the existing normal release notification and hard sent-marker acceptance.
3. Add a reusable content-safe rollback/failure deployment event path through the same outbox.
4. Add tests that candidate/release notification event keys are deterministic and that no direct sender/target secret appears in scripts.
5. Do not notify on dry-run or non-mutating validation.

### Phase 3 — Non-resident/static verification

Before loading a second 1.7B model:

- compile/build the OminiX production component;
- run unit/contract tests;
- run pinned OpenClaw patch fixtures;
- run 9Router pass-through fixture tests;
- run voice-reply policy tests including marker stripping and ordinary typed text-only behavior;
- run architecture checks and `pnpm check:secrets`;
- verify rollback tooling syntax;
- verify no private audio/embedding/model/token files are staged.

Do not rerun the A/C matrix.

### Phase 4 — Optional OpenClaw candidate integration, no version bump

If the pinned OpenClaw/9Router transport change requires live integration proof before native cutover, deploy the single current runtime with `--candidate` while VERSION remains 1.6.5. This candidate is allowed only to verify routing/marker/config compatibility; it is not another TTS quality comparison.

The newly fixed candidate notification must be delivered and recorded. Do not call this a release.

### Phase 5 — Backup A and cut over directly to C

1. Capture pre-cutover TTS health/PID/memory state.
2. Create and verify the protected A rollback checkpoint.
3. Stop/unload A and wait until its inference PID is fully gone; never overlap the two resident model engines.
4. Install/start C on the same production contract/port 18792.
5. Wait for C `/healthz=ready` after real warmup.
6. Run direct authenticated health/voices/speech smoke for `default` and at least one non-default bounded style.
7. Run one authenticated 9Router `amadeus-tts` smoke proving style reaches C.
8. Run one real WhatsApp voice-reply smoke proving visible Chinese/Japanese text, one audio attachment, hidden directives, and one selected Kurisu emotion.

These are deployment acceptance smokes, not A/C tests. Do not regenerate A comparison audio.

On any failed gate, stop C and restore A from the protected checkpoint before broadening scope. Emit the rollback warning event.

### Phase 6 — Version 1.6.6 and final release

Only after C is healthy and the integrated path is accepted:

1. `./scripts/amadeus-version.sh bump patch` -> 1.6.6.
2. Write single-release Chinese `RELEASE_NOTES.md`.
3. Run `./scripts/amadeus-version.sh check`.
4. Run the repository-selected RELEASE verification plus focused TTS/notification checks, `git diff --check`, and `pnpm check:secrets`.
5. Commit reviewed release source.
6. Perform the normal final release apply through the existing release workflow; do not use candidate mode for the final version.
7. Verify OpenClaw/9Router/native TTS health and the real voice path remains healthy after release.
8. Require `amadeus-release:1.6.6` to reach the production owner outbox and `.sent.json`; a release with missing notification is incomplete.
9. Record immutable image/source identifiers, native TTS engine/model revisions, A rollback checkpoint and owner-notification evidence in a dated release checkpoint/report.

## 14. Validation gates

Required before Goal completion:

- [ ] Owner-approved C path is used; no new A/C matrix was run.
- [ ] Production uses pinned OminiX Base 1.7B 8-bit x-vector path, not CustomVoice.
- [ ] `kurisu-v1` remains the stable voice identity and protected reference source.
- [ ] Only one 1.7B production TTS engine is resident after cutover.
- [ ] Stable external `amadeus-tts` alias and port 18792 remain valid.
- [ ] Existing auth, 1200-char cap, 120s outer timeout, one-worker/one-pending behavior and formats are preserved.
- [ ] Kurisu default baseline is always applied for voice replies.
- [ ] Only the seven V1 emotion ids are accepted; no free-form Agent instruct reaches OminiX.
- [ ] Ordinary typed replies remain text-only; voice-note/explicit-voice paths still produce one Japanese audio reply plus visible Chinese/Japanese text.
- [ ] TTS directives never leak into visible messages.
- [ ] Pinned OpenClaw 2026.9.4 patch has focused fixtures.
- [ ] 9Router only forwards `style`; it does not infer or remap emotion.
- [ ] Current A runtime has a verified protected rollback checkpoint before cutover.
- [ ] Rollback procedure restores A without requiring C.
- [ ] Candidate real deployment, when used, produces a distinct candidate owner notification.
- [ ] Final VERSION is 1.6.6 and release notes validate.
- [ ] Final release owner notification `amadeus-release:1.6.6` has a sent marker.
- [ ] No private voice/reference/x-vector/model/owner-target/secret data is committed.
- [ ] Focused tests, relevant build/typecheck, architecture checks, `git diff --check`, and `pnpm check:secrets` pass.

## 15. Stop conditions

Stop and restore/preserve evidence rather than improvising if:

- A backup cannot be verified before cutover;
- OminiX C cannot bind the current production contract without breaking `amadeus-tts`;
- C requires A to remain resident to function;
- production enters sustained memory pressure/OOM or C cannot reach ready reliably;
- pinned OpenClaw cannot carry a bounded style without a broad upstream fork;
- 9Router style forwarding requires a large routing refactor instead of a narrow pass-through;
- the real WhatsApp smoke leaks TTS directives, duplicates audio, or changes normal text-only behavior;
- release notification cannot enter and drain through the existing owner outbox;
- implementation would require hardcoding owner/channel secrets or introducing another sender.

## 16. Explicit exclusions

This Goal does not authorize:

- another A/C listening matrix;
- CustomVoice production migration;
- free-form Agent-generated TTS instruct prompts;
- emotion intensity sliders or unlimited emotion taxonomy;
- per-sentence emotion segmentation;
- TTS model fallback/Combo work;
- ASR or image-generation changes;
- changing group permissions;
- replacing 9Router as the stable model routing boundary;
- a second Agent/runtime or notification sender;
- keeping A resident as automatic fallback;
- committing private voice/model/secret assets.

## 17. Definition of done

The Goal is complete only when Amadeus 1.6.6 is running with C as the sole production TTS engine, Kurisu voice replies use the deterministic personality baseline plus bounded emotion contract, the stable `amadeus-tts` path works end-to-end through real WhatsApp, A can be restored from a verified protected checkpoint, and the 1.6.6 deployment notification has been delivered through the existing owner outbox/WhatsApp notifier.

Then stop. Any later emotion expansion is a separate Goal.