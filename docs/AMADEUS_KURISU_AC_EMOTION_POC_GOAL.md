# Amadeus Kurisu A/C Emotion PoC Goal

Date: 2026-09-28 local

Status: planning-only until explicitly activated by the owner. This Goal must not replace `docs/CURRENT_TASK.md` unless the owner or a later task explicitly promotes it to the active Goal.

## 1. Objective

Build an isolated listening PoC that compares the currently accepted Kurisu production TTS path (**A**) with an experimental OminiX Qwen3-TTS MLX Base voice-clone + instruct path (**C**) using the exact same Japanese sentence and the same accepted Kurisu reference voice asset.

The purpose is to answer two listening questions only:

1. Does Base x-vector cloning in the C path preserve enough Kurisu speaker identity compared with the accepted production A path?
2. Can the C path add useful emotion/style control without unacceptable voice drift?

The PoC is not a production migration, does not change `amadeus-tts`, does not change the OpenClaw/9Router routing contract, and must stop after delivering the labeled listening set and objective runtime measurements to the owner on WhatsApp.

## 2. User-facing outcome

The owner receives one self-contained WhatsApp listening set from the existing linked Kurisu/secondary WhatsApp account:

1. one introductory text message containing the exact shared test sentence and experiment legend;
2. seven individually labeled audio samples, one audio attachment per message, in fixed A0/C0-C5 order;
3. one final compact metrics message containing generation wall time, output audio duration, realtime factor, and exact model/runtime identifiers for each sample.

The system must not rank A vs C, declare a winner, or promote C based on automated metrics. Voice similarity, character fidelity, naturalness, and emotion quality are subjective owner-listening acceptance items.

## 3. Fixed test sentence

Every sample MUST synthesize this exact Japanese text with no wording changes, added stage directions, punctuation rewrite, translation, truncation, or hidden prefix in the spoken content:

> ねえ、さっきから何度も言ってるでしょう。予定が変わったならちゃんと先に教えてくれればよかったのに、何も知らないまま待たされるこっちの気持ちも少しは考えてよ。それでも、無事に帰ってきたなら今回はもういいから、次からはちゃんと連絡して。

The visible WhatsApp labels may contain metadata, but the audio target text must remain byte-for-byte equivalent after normal Unicode handling.

## 4. Comparison matrix

Generate exactly these seven primary listening samples:

| ID | Path | Clone/conditioning | Emotion/instruct |
| --- | --- | --- | --- |
| A0 | Current accepted production Base 1.7B MLX path | Existing accepted full production ICL/reference configuration | Baseline; no new emotion control |
| C0 | OminiX Qwen3-TTS MLX Base 1.7B | x-vector clone from the same Kurisu reference | Neutral / no emotion instruct |
| C1 | Same C path | same x-vector clone | `用生气不满的语气说，语气锋利，但不要喊叫。` |
| C2 | Same C path | same x-vector clone | `用温柔轻柔的语气说，语速自然稍慢。` |
| C3 | Same C path | same x-vector clone | `用有些害羞和慌乱的语气说，略带迟疑。` |
| C4 | Same C path | same x-vector clone | `用悲伤失落但克制的语气说，声音稍低沉。` |
| C5 | Same C path | same x-vector clone | `用讽刺、无奈又略带嘲弄的语气说。` |

`C0` is mandatory. It isolates the voice-cloning difference from the emotion-conditioning difference. Without C0, an observed C1-C5 voice drift cannot be attributed cleanly to x-vector cloning vs instruct conditioning.

Do not add extra samples, alternate sentences, hidden prompt variants, or parameter sweeps before the seven required samples have been delivered. Any follow-up matrix requires a separate owner decision.

## 5. Architecture boundary

### A path

A0 uses the currently accepted production TTS implementation and configuration as an observational control only.

```text
same Japanese text
  -> current production com.amadeus.qwen3-tts service
  -> accepted Kurisu Base 1.7B MLX ICL/reference path
  -> normal production-compatible audio
```

A0 may invoke one normal synthesis request through the existing production service. It MUST NOT restart, stop, reload, reconfigure, replace, or redeploy the production LaunchAgent/service.

### C path

C0-C5 use OminiX Qwen3-TTS MLX Base voice cloning with x-vector conditioning. C1-C5 additionally use the experimental clone+instruct generation path.

```text
same Kurisu reference audio
  -> Base speaker encoder / x-vector

same Japanese text
+ x-vector
+ optional instruct
  -> Qwen3-TTS Base Talker
  -> codec generation
  -> speech decoder
  -> audio
```

The C path MUST remain Base-model generation. Do not substitute CustomVoice as the synthesizer and do not implement the earlier Base -> x-vector -> CustomVoice proposal in this Goal.

The implementation surface being evaluated is OminiX's Base clone+instruct path, including `synthesize_voice_clone_instruct` / `generate_voice_clone_instruct` or the equivalent names at the pinned revision.

Planning reference upstream:

- repository: `https://github.com/OminiX-ai/OminiX-MLX`
- component: `qwen3-tts-mlx`
- planning-time source revision observed: `4988a3fcfa48b8cb5d0780a501b92c6a41401523`

Before execution, verify that the pinned revision exists and contains the expected Base voice-clone + instruct path. Use an exact immutable upstream commit for the PoC and record it in evidence. Do not silently follow a moving `main` branch during the experiment.

## 6. MLX/model comparability rules

The comparison should control all practical variables while acknowledging that A and C are different implementations.

1. Use the same accepted Kurisu reference audio asset for A and C. Do not copy that asset into Git.
2. Use the same Qwen3-TTS 12Hz 1.7B Base family for both paths.
3. Prefer the same production quantization/model artifact for C if OminiX can load it correctly.
4. If OminiX cannot consume the exact production artifact, use the closest compatible 1.7B Base artifact and record the exact model repository/revision, dtype/quantization, and reason for the mismatch. Do not modify production to force parity.
5. Keep target language Japanese and use the same target text.
6. Keep sampling controls as close as the implementations allow. Record temperature/top-k/top-p/repetition penalty/seed when applicable.
7. Use a fixed seed for C samples if OminiX supports deterministic generation. Use the same C-path seed across C0-C5 unless the upstream API specifically requires otherwise.
8. Do not infer that a speed or quality difference is caused by emotion conditioning if the underlying model artifact or quantization differs; record the confound explicitly.

## 7. Output normalization

For owner listening, all seven final artifacts must use one consistent container/codec/output policy. Prefer the existing production-compatible MP3 settings already used by Amadeus.

If OminiX emits WAV/PCM natively, convert C outputs after synthesis using a deterministic local encoder. The conversion step must not modify tempo, pitch, loudness intentionally, denoise, normalize differently per sample, or add silence beyond format requirements.

Record for each sample:

- source waveform sample rate;
- final MP3 codec/bitrate or equivalent production setting;
- source audio duration;
- final artifact duration;
- synthesis wall time excluding WhatsApp upload;
- post-encode time separately if material;
- realtime factor (`synthesis_wall_seconds / audio_duration_seconds`).

Do not use loudness normalization to make one path sound subjectively better. If existing production encoding performs a standard normalization step, apply the same step to every sample and document it.

## 8. Runtime isolation and memory safety

The C PoC must run beside production without mutating production.

- Do not stop or unload `com.amadeus.qwen3-tts` to make room for OminiX.
- Do not change port `18792`, production service files, LaunchAgent plist, model profile, voice profile, queue settings, timeout, `MAX_TEXT`, or authentication.
- Do not restart TTS, 9Router, OpenClaw, OrbStack/CasaOS, or unrelated services for this PoC.
- Place the OminiX source checkout, downloaded model assets, generated WAV/MP3 files, reference links/copies, and logs containing local paths under an external experiment root, not in Git. Preferred root:
  `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/kurisu-ac-emotion-poc-2026-09/<run-id>/`
- Run OminiX as a temporary foreground or explicitly managed experiment process. It must be stopped after delivery/evidence capture.
- Capture pre-run and post-run production `/healthz` status and the production LaunchAgent PID/last-exit state without restarting it.
- Capture memory pressure before model load and during C generation. If the Mac enters sustained warning/critical memory pressure, aggressive swap growth, repeated OOM, or production TTS health degrades, stop the C process immediately. Do not sacrifice production availability to complete the experiment.
- Generate C samples sequentially, not concurrently.

If C cannot coexist safely with production on the 24GB host, stop and report the blocker. Do not unload production unless the owner gives separate explicit approval.

## 9. Source-of-truth and reproducibility

Git should contain only reproducible, non-sensitive experiment definitions, such as:

- a small experiment runner/wrapper if needed;
- the fixed sentence and C emotion map;
- upstream revision/model identifiers;
- metric schema and report template;
- focused tests for deterministic argument construction / labels if new repository code is added.

Git MUST NOT contain:

- Kurisu/reference audio;
- x-vectors/embeddings derived from the reference;
- generated A/C audio;
- downloaded model weights;
- owner phone number/JID/WhatsApp target;
- WhatsApp session data;
- bearer tokens/API keys/secrets;
- raw logs containing secret headers or private target identifiers.

The repository remains the source of truth for how the PoC is reproduced; large/private assets remain external runtime inputs.

## 10. WhatsApp delivery contract

Use the existing configured owner WhatsApp target and the existing linked Kurisu/secondary WhatsApp account. Resolve both from the current protected runtime configuration/secret source; do not hardcode or print the real target.

Use the canonical OpenClaw outbound CLI/media path rather than restoring the globally denied Agent-facing `message` tool. The current OpenClaw CLI supports a normal outbound message with local media attachment; use the installed/pinned runtime command surface after validating its arguments.

Do not create a second sender, webhook sender, ad-hoc WhatsApp library, or direct Baileys/Meta transport.

### Intro message

Send one text message similar to:

```text
【Kurisu A/C Emotion Test】
以下 7 条语音使用完全相同的日语长句，仅比较当前生产 A 与实验 C（Base x-vector + instruct）。请按 A0 -> C0 -> C1...C5 顺序试听。

测试文本：
ねえ、さっきから何度も言ってるでしょう。予定が変わったならちゃんと先に教えてくれればよかったのに、何も知らないまま待たされるこっちの気持ちも少しは考えてよ。それでも、無事に帰ってきたなら今回はもういいから、次からはちゃんと連絡して。
```

### Audio labels

Send one separate labeled message + one audio attachment for each sample, exactly in this order:

```text
【Kurisu A/C Test — A0】
Path: Production Base 1.7B ICL
Emotion: baseline
```

```text
【Kurisu A/C Test — C0】
Path: OminiX Base 1.7B x-vector
Emotion: neutral
```

```text
【Kurisu A/C Test — C1】
Path: OminiX Base 1.7B x-vector + instruct
Emotion: angry
```

```text
【Kurisu A/C Test — C2】
Path: OminiX Base 1.7B x-vector + instruct
Emotion: soft
```

```text
【Kurisu A/C Test — C3】
Path: OminiX Base 1.7B x-vector + instruct
Emotion: embarrassed
```

```text
【Kurisu A/C Test — C4】
Path: OminiX Base 1.7B x-vector + instruct
Emotion: sad
```

```text
【Kurisu A/C Test — C5】
Path: OminiX Base 1.7B x-vector + instruct
Emotion: sarcastic
```

The attachment must be the corresponding audio artifact, not a document bundle or archive. Keep the labels concise so later listening is easy on mobile.

### Final metrics message

After all seven audio deliveries succeed, send one compact table/list containing at least:

```text
ID | synth wall time | audio duration | RTF | model/runtime
```

Do not include the owner target, secrets, local reference path, or sensitive environment data in the message.

## 11. Delivery verification

A CLI exit code alone is not enough. Record content-safe delivery evidence for all seven samples and the intro/summary messages using message IDs/status returned by the canonical OpenClaw channel path where available. Do not commit raw private destination identifiers.

If one WhatsApp audio send fails:

1. do not regenerate the audio unless the file itself is invalid;
2. retry the same labeled artifact through the same canonical sender with a bounded retry;
3. do not switch to another transport/account automatically;
4. if still unsuccessful, stop and report which sample is pending.

No owner notification fallback is introduced.

## 12. Capability planning record

### Identity and scope

- Capability/experiment name: Kurisu A/C emotion-control PoC.
- Owned intent: owner-requested controlled evaluation of existing Kurisu TTS vs experimental Base clone+instruct.
- Non-goals: production emotion feature, general user emotion control, CustomVoice migration, TTS model fallback, ASR changes, image changes, dynamic emotion classification by Arthur.
- Trusted boundary: execution and WhatsApp delivery are owner-only experiment operations. No group/user-facing TTS policy changes.
- Explicit confirmation: this Goal authorizes the isolated PoC and sending the resulting labeled samples to the already configured owner WhatsApp target; it does not authorize production replacement.
- Owner: experiment scripts/report under repo; native production TTS remains owned by existing macOS service definitions.

### Architecture ownership

- Deterministic experiment orchestration: repository experiment script/config if implementation needs one.
- Production A call: existing native TTS service only.
- C external implementation: pinned OminiX `qwen3-tts-mlx` Base path.
- Presentation/delivery: existing OpenClaw WhatsApp sender/CLI.
- Evidence: sanitized model/runtime identifiers, metrics, health snapshots, delivery receipts.
- Unknown semantics: subjective voice/emotion quality stays `pending_owner_listening`; do not turn it into an automated score.

### Side effects and recovery

- Persistent experiment data: external experiment root only.
- Secrets/runtime-only config: existing owner target/account/auth remain outside Git.
- Idempotency: unique run ID; artifact IDs A0/C0-C5 must not be duplicated silently. A rerun uses a new run ID.
- Rollback: no production mutation is allowed, so rollback is stopping/removing the temporary C process/worktree and preserving production unchanged.
- Prohibited fallback: no alternate sender, no CustomVoice substitution, no production service restart/unload, no 9Router/OpenClaw route edits.

## 13. Implementation phases

### Phase 0 — Fresh facts and guardrails

Before modifying files or launching models:

1. Read `AGENTS.md`, `docs/CONTEXT.md`, `docs/CURRENT_TASK.md`, this Goal, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, and the current native TTS macOS definitions relevant to the production path.
2. Run `git status --short --branch` and `git log -5 --oneline --decorate`.
3. Do not disturb the current active task/branch. Create an isolated worktree/branch for this PoC if implementation changes are required.
4. Capture current production TTS health, LaunchAgent PID/last exit, engine/profile identity, and safe memory-pressure baseline.
5. Verify the exact external Kurisu reference used by production without copying it into Git or printing private paths unnecessarily.
6. Verify the canonical owner WhatsApp account/target path without logging the target value.

### Phase 1 — Reproducible C environment

1. Create the external run root.
2. Checkout the pinned OminiX revision outside Git or as a disposable external source checkout; do not vendor the upstream repository wholesale.
3. Verify `qwen3-tts-mlx` builds/runs on the host and that the selected Base model can perform x-vector cloning and clone+instruct.
4. Resolve the closest compatible Base model artifact under the comparability rules above.
5. Record immutable upstream/model revisions and relevant build/runtime versions.
6. Do one minimal non-production dry smoke if required before the full target sentence. Do not send smoke artifacts to WhatsApp and do not expand into a tuning matrix.

### Phase 2 — Generate A0

1. Submit the fixed Japanese sentence once through the existing production synthesis path.
2. Save the returned artifact to the external run root.
3. Measure wall time and duration using the existing service/client evidence available without changing production.
4. Verify the resulting audio is non-empty/decodable.

Do not restart production before or after A0.

### Phase 3 — Generate C0-C5

1. Load OminiX Base in the isolated process.
2. Use the same accepted Kurisu reference.
3. Generate C0 neutral/no-instruct first.
4. Generate C1-C5 sequentially with the fixed instructions exactly as defined in this Goal.
5. Use one fixed C seed and comparable generation controls when supported.
6. Capture per-sample timings and basic validity metadata.
7. Convert outputs to the common listening MP3 policy without subjective DSP.
8. Watch host memory pressure and production TTS health; abort C safely on pressure/health regression.

### Phase 4 — Local verification

Before WhatsApp writes:

- exactly seven primary artifacts exist;
- every artifact is decodable audio and non-zero duration;
- every generation record hashes/identifies the exact fixed target sentence;
- C samples use Base clone paths, not CustomVoice;
- labels and artifact IDs map one-to-one;
- no output/reference/model asset is staged in Git;
- production `/healthz` is still ready.

### Phase 5 — WhatsApp delivery

1. Send the intro text through the canonical existing linked WhatsApp account.
2. Send A0, C0, C1, C2, C3, C4, C5 in exact order, one label + one audio attachment per item.
3. Verify each delivery result before advancing.
4. Send the final objective metrics summary.
5. Record sanitized message/delivery evidence.

This phase is an explicitly owner-requested external write for this Goal. Do not use an alternate channel if WhatsApp is unavailable.

### Phase 6 — Cleanup and report

1. Stop the isolated OminiX process.
2. Confirm no PoC listener/service remains resident.
3. Recheck production TTS health/PID/last-exit and host memory pressure.
4. Leave generated listening artifacts outside Git for later owner review; do not delete them until owner acceptance or explicit cleanup.
5. Write a content-safe report under `docs/reports/` with objective metrics, exact revisions, comparability caveats, WhatsApp delivery status, and `pending_owner_listening` for subjective conclusions.
6. Run the minimal repository verification level selected by `pnpm workflow:plan`, plus `git diff --check` and `pnpm check:secrets` before commit.
7. Stop. Do not promote C to production, modify `amadeus-tts`, or continue into a larger benchmark without owner feedback.

## 14. Validation gates

Required before declaring the PoC execution complete:

- [ ] Production TTS was never restarted/stopped/reconfigured/redeployed.
- [ ] OminiX ran as an isolated temporary process and is stopped afterward.
- [ ] Exact same Japanese target sentence used for A0 and C0-C5.
- [ ] Exact same accepted Kurisu reference asset used where applicable.
- [ ] A0 came from the current accepted production Base ICL path.
- [ ] C0-C5 came from Qwen3-TTS Base x-vector clone; C1-C5 used the fixed instruct strings.
- [ ] No C sample was generated by CustomVoice.
- [ ] Seven final audio artifacts are valid and consistently encoded.
- [ ] Per-sample wall time, duration, RTF, model/runtime identity are captured.
- [ ] Model/quantization mismatch, if any, is explicitly recorded.
- [ ] Intro + A0 + C0-C5 + metrics summary were delivered through the canonical owner WhatsApp path.
- [ ] Content-safe delivery receipts/status were captured.
- [ ] Production health is ready after the experiment with no observed regression caused by the PoC.
- [ ] No reference/generated audio/model weights/x-vectors/secrets/private owner target are in Git.
- [ ] Focused tests/checks, `git diff --check`, and `pnpm check:secrets` pass for repository changes.
- [ ] Subjective outcome remains `pending_owner_listening` until the owner actually listens.

## 15. Owner listening rubric for the next turn

Do not pre-score this in code. When the owner later listens, ask for or accept simple feedback on these dimensions:

### A0 vs C0

- Kurisu speaker identity similarity
- character/role feeling
- Japanese pronunciation and prosody
- naturalness
- obvious artifacts

This isolates full production ICL vs C x-vector clone.

### C0 vs C1-C5

- whether the requested emotion is clearly audible;
- whether the voice remains recognizably Kurisu;
- whether stronger emotion causes timbre drift;
- whether pace/pitch changes feel natural rather than exaggerated;
- whether any emotion is too weak to justify production support.

A later production decision must be based on owner listening plus objective stability/performance evidence. This Goal deliberately makes no production recommendation.

## 16. Stop conditions

Stop immediately and preserve evidence if any of the following occurs:

- production TTS health degrades;
- memory pressure becomes sustained warning/critical or the host begins unsafe swap/OOM behavior;
- OminiX requires stopping production to proceed;
- the C implementation cannot prove it is using Base clone+instruct rather than CustomVoice;
- the same reference or exact same target sentence cannot be used;
- the generated audio is corrupt/empty/repeatedly non-deterministic in a way that prevents a controlled comparison;
- owner WhatsApp target/account cannot be resolved safely from existing configuration;
- sending would require hardcoding/exposing private target credentials;
- any step would require changing 9Router/OpenClaw production TTS routing.

Record the blocker and stop instead of broadening scope.

## 17. Explicit exclusions

This Goal does NOT authorize:

- replacing the production Qwen3-TTS service;
- changing the accepted Kurisu voice profile/reference;
- changing `amadeus-tts` routing or 9Router configuration;
- adding TTS fallback models;
- enabling CustomVoice production;
- teaching Arthur to infer emotions dynamically;
- changing typed/inbound voice reply behavior;
- changing WhatsApp/Telegram group permissions;
- changing ASR/image-generation capabilities;
- adding a second Agent runtime, sender, keyword router, or notification fallback;
- committing private audio/model/secret assets;
- version bump or release deployment.

## 18. Definition of done

The PoC implementation is done only when:

1. the fixed seven-sample A/C set exists and is objectively verified;
2. all seven labeled audio samples plus intro and metrics summary have been sent successfully to the configured owner WhatsApp target through the canonical linked account;
3. production TTS remains healthy and unchanged;
4. the temporary OminiX process is stopped;
5. reproducible non-sensitive experiment code/config and a content-safe objective report are committed;
6. subjective evaluation is explicitly left pending for the owner's later listening.

Then stop and wait for owner feedback. Do not convert C into a production feature inside this Goal.
