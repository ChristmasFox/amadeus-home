# Amadeus Kurisu GPT-SoVITS Character Voice PoC — Goal

Date: 2026-09-29
Type: host-native TTS evaluation / character-voice benchmark / deployment PoC
Canonical baseline: Git `main`; OpenClaw remains the sole Agent runtime; current production `amadeus-tts` routing remains unchanged during this Goal.

## Background

The owner’s target is stricter than generic voice similarity: Kurisu speech should be immediately recognizable as Makise Kurisu rather than merely sounding like a similar young Japanese female voice.

Current production TTS is already deployed and accepted:

```text
OpenClaw
  -> logical amadeus-tts
  -> 9Router TTS bridge
  -> qwen-audio-3.1-tts-flash + model-bound cloned voice
  -> qwen-audio-3.0-tts-flash + model-bound cloned voice
  -> existing native OminiX Qwen3-TTS fallback on :18792
```

Cloud `default` is now a zero-delta pure cloned-voice baseline: it sends the cloned `voice_id`, text and Japanese language hint without persona/style/emotion/speed/pitch instruction. This is the production reference against which the new candidate must be compared.

The candidate model is `bysq/TTS-KurisuMakise` on Hugging Face. Its model card states that it is a GPT-SoVITS-v2Pro model trained for Makise Kurisu and supports Japanese and Chinese. The repository contains a GPT checkpoint, a SoVITS checkpoint and Kurisu WAV material. These model/audio assets are runtime artifacts and must remain outside Git.

Upstream GPT-SoVITS currently supports Apple Silicon macOS installation with MPS or CPU. The owner’s Mac mini has 24 GB unified memory, which is sufficient for a GPT-SoVITS v2Pro inference PoC. OminiX-MLX also contains a `gpt-sovits-mlx` implementation, but its current Japanese frontend and direct compatibility with this specific v2Pro `.ckpt`/`.pth` pair must be proven before it can be selected as the long-term runtime.

## Goal

Deploy an isolated, host-native GPT-SoVITS v2Pro Kurisu PoC on the current macOS host and answer one question with real listening evidence:

> Does `bysq/TTS-KurisuMakise` produce a materially more immediately recognizable Makise Kurisu voice than the current Qwen Audio 3.1 cloned-voice `default` baseline?

The PoC must:

1. run on the macOS host, not inside the OpenClaw/9Router Linux containers;
2. load the `bysq/TTS-KurisuMakise` GPT-SoVITS-v2Pro checkpoints successfully;
3. synthesize Japanese correctly from at least one clean Kurisu reference clip;
4. expose an owner/operator-only local inference surface for repeatable tests;
5. leave the current production cloud -> cloud -> OminiX fallback chain untouched;
6. compare the candidate against production Qwen 3.1 `default` using identical Japanese target sentences;
7. measure latency/RTF and host memory while prioritizing voice identity over speed;
8. make the owner’s listening acceptance the final gate before any production integration or MLX port work.

## Non-goals

This Goal does **not**:

- replace `amadeus-tts` in 9Router;
- add GPT-SoVITS to the production fallback order;
- modify OpenClaw Skills, WhatsApp, Telegram or ReplyEnvelope behavior;
- remove the existing OminiX Qwen3-TTS service;
- start a second Agent, planner, router or sender;
- retrain or fine-tune the Kurisu model;
- publish a TTS endpoint to the Internet;
- commit model checkpoints, reference WAVs, generated audio, Hugging Face caches or secrets to Git;
- require an MLX implementation before the voice-quality hypothesis has been proven;
- make a release/version bump merely for this isolated PoC.

If the candidate does not clearly improve perceived Kurisu identity, stop after recording the result and remove/disable the PoC runtime. Do not integrate it into production because it is newer or local.

## Architecture invariants

### 1. Production TTS is frozen during the PoC

The accepted production path remains authoritative:

```text
qwen-audio-3.1-tts-flash
  -> qwen-audio-3.0-tts-flash
  -> OminiX Qwen3-TTS local fallback :18792
```

Do not edit the existing cloud model order, protected voice-id files, bridge fallback categories, emotion contract or `default` zero-delta rule during this Goal.

The existing Kurisu TTS tuner also already uses a host port. Codex must inspect live listeners and repository host definitions before choosing a PoC port. Do **not** assume `18793` is free.

### 2. The PoC is an execution service, not an Agent

Target boundary:

```text
operator A/B runner / browser / curl
              |
              v
host-native GPT-SoVITS PoC
              |
      TTS-KurisuMakise
              |
              v
       local audio files
```

The PoC must contain no conversational planning, persona policy, channel delivery, keyword routing or model-provider selection logic.

### 3. Model and audio assets stay outside Git

Codex must discover/use a durable host-side model/cache root consistent with the current host profile. Git may contain declarative setup scripts, checksums/manifests, service templates and documentation, but not the actual `.ckpt`, `.pth`, pretrained base weights, WAV corpus or generated audio.

Do not hardcode a historical macOS username or personal home path in tracked files.

### 4. Treat third-party PyTorch checkpoints as untrusted artifacts

The Hugging Face GPT checkpoint is a PyTorch/pickle-style artifact. Before loading it:

- download only from the intended `bysq/TTS-KurisuMakise` repository;
- record the exact Hugging Face revision and SHA-256 of downloaded candidate files in non-secret reproducibility evidence;
- run in a dedicated non-root Conda/Python environment;
- do not grant the PoC arbitrary repository write authority, Docker socket access, SSH credentials or secret mounts;
- bind inference to loopback by default;
- do not execute arbitrary scripts from the model repository.

This is an evaluation service, so least privilege is preferred over convenience.

## Phase 0 — Discover current host and freeze the baseline

Before installing anything, Codex must:

1. read `AGENTS.md`, `docs/CONTEXT.md`, `docs/CURRENT_TASK.md`, this Goal and current TTS state;
2. run the normal repository startup checks (`git status --short --branch`, recent log, `pnpm workflow:plan` where applicable);
3. inspect the current macOS host profile and available disk space;
4. inspect listeners/services around current TTS ports so the PoC cannot collide with production `:18792` or the existing tuner;
5. verify current `amadeus-tts` health and perform one production Qwen 3.1 `default` baseline synthesis without changing configuration;
6. record enough timing/provider evidence to prove later A/B output really came from Qwen 3.1 and not a fallback.

No PoC install should proceed if the production baseline is unhealthy for unrelated reasons.

## Phase 1 — Install a pinned upstream GPT-SoVITS v2Pro environment

Use the official upstream `RVC-Boss/GPT-SoVITS` implementation first because it is the compatibility reference for the candidate v2Pro checkpoints.

Requirements:

- use a dedicated Conda environment, preferably Python 3.10 unless the pinned upstream revision requires otherwise;
- pin and record the exact GPT-SoVITS Git revision used by the PoC;
- install macOS dependencies such as FFmpeg through the existing host package convention;
- install the upstream pretrained v2Pro dependencies required by that revision;
- keep dependency/model caches outside the repository;
- prefer MPS for the first accelerated attempt when the pinned upstream supports the candidate correctly;
- if v2Pro MPS fails or produces suspect output, fall back to CPU for the compatibility/voice-quality proof rather than patching production or immediately adopting an unofficial fork;
- do not train on the Mac in this Goal.

The first milestone is not maximum speed. It is a known-good reference implementation that can load the candidate and synthesize Japanese correctly.

## Phase 2 — Acquire and validate `TTS-KurisuMakise`

Download the model repository into the protected host-side model area and pin its revision.

Codex must identify rather than hardcode guessed Unicode filenames:

- the single candidate GPT `.ckpt`;
- the single candidate SoVITS `.pth`;
- the provided WAV directory/sample material.

Validation gates:

- checkpoint files exist and hashes are recorded;
- upstream GPT-SoVITS identifies/loads them as the expected v2Pro family;
- required upstream v2Pro pretrained components are present;
- no checkpoint/audio is copied into Git;
- a minimal model load completes without touching production services.

If checkpoint architecture/shape is incompatible with current upstream GPT-SoVITS, investigate the smallest pinned compatible upstream revision before any conversion/rewrite. Do not silently reinterpret the files as another model generation.

## Phase 3 — Select a neutral Kurisu reference

For the first comparison, use **one** clean neutral/reference-style Kurisu clip rather than emotion-specific routing.

Selection criteria:

- one speaker only;
- Japanese;
- preferably about 3-8 seconds;
- no obvious BGM, effects, clipping or another character;
- normal conversational Kurisu rather than screaming/crying/extreme acting;
- stable level and clear speech;
- exact reference transcript available or produced and manually checked.

The supplied WAV material may be inspected and auditioned locally. Reference audio and transcript remain outside Git if the transcript reproduces copyrighted dialogue beyond what is necessary for operator evidence; tracked docs should store only filenames/hashes/selection metadata when possible.

Do not build seven emotion refs yet. First prove speaker identity with a neutral baseline.

## Phase 4 — Stand up an isolated local PoC endpoint

After interactive synthesis works, expose a deterministic local API using upstream GPT-SoVITS `api_v2.py` or a minimal repo-owned wrapper if required for health/readiness and fixed configuration.

Requirements:

- bind to `127.0.0.1` by default;
- use a configurable port discovered to be free; do not assume `18793`;
- load one pinned Kurisu GPT + SoVITS pair;
- use the selected neutral reference by default for the benchmark path;
- accept Japanese target text and return WAV for comparison;
- impose bounded request text length and timeout;
- keep concurrency at 1 for the PoC unless measurements justify otherwise;
- log timing/error categories but not raw audio or unnecessary full text;
- run as the current non-root operator account;
- do not auto-start at boot until interactive owner listening confirms the model is worth keeping.

A temporary launch script is sufficient for the first listening session. If the candidate passes the owner gate, a later phase/follow-up may define a launchd service.

## Phase 5 — Controlled Qwen 3.1 vs GPT-SoVITS A/B

Create one repeatable operator script/report that generates both sides from the same Japanese test set.

### Qwen side

Use the existing production Qwen Audio 3.1 model-bound cloned voice with:

```text
emotion = default
instruction = absent
persona/style/speed/pitch = absent
language = ja
```

The script/evidence must verify the response provider is Qwen 3.1, not Qwen 3.0 or local fallback.

### GPT-SoVITS side

Use:

```text
candidate = bysq/TTS-KurisuMakise v2Pro
reference = selected neutral Kurisu clip
prompt language = ja
target language = ja
```

Use the same target text as Qwen. Do not add emotion prompting in the first identity benchmark.

### Test set

Use roughly 8-12 short/medium Japanese lines that cover:

- neutral explanatory speech;
- short sharp response;
- question intonation;
- longer sentence;
- common particles and sentence endings;
- a restrained tsundere-like line without explicit model-side emotion control.

Do not tune the test set separately per backend. Keep the text identical.

### Listening procedure

Produce clearly paired A/B files with loudness differences normalized enough that volume alone does not bias the result. Preserve an unprocessed copy for debugging.

Primary owner questions:

1. Which output is immediately more recognizable as Makise Kurisu?
2. Does the candidate keep that identity across all sentences rather than only one lucky line?
3. Does Japanese pronunciation remain natural enough for daily Amadeus use?
4. Does the candidate sound like the same character on short and long sentences?

Do not let latency decide the winner if the character identity difference is large; voice identity is the purpose of this PoC.

## Phase 6 — Performance and resource evidence

For the candidate, record at minimum:

- device path actually used: MPS or CPU;
- process RSS / practical memory footprint after warm load;
- cold model-load time;
- warm synthesis latency;
- generated audio duration;
- RTF (`inference_seconds / audio_seconds`);
- whether subsequent requests reuse loaded models;
- any MPS fallback/warnings;
- host memory pressure before/after several consecutive requests.

On the 24 GB Mac mini the acceptance target is not a hard numeric SLA. The model must coexist safely with the current HomeLab workload without sustained severe memory pressure or swap growth caused by the PoC.

## Phase 7 — MLX/OminiX feasibility report, only after voice quality is proven

Do **not** spend the main PoC budget porting before the owner listens to the upstream candidate.

If the owner says the GPT-SoVITS candidate is clearly more Kurisu-like, then inspect `OminiX-ai/OminiX-MLX/gpt-sovits-mlx` and produce a concrete compatibility report covering:

1. mapping/conversion of this exact v2Pro `.ckpt` and `.pth` to OminiX/MLX weight format;
2. tensor names/shapes and v2Pro architecture compatibility;
3. parity of speaker/reference conditioning;
4. Japanese frontend/G2P support required for `ja` inference;
5. any missing Japanese text normalization/phoneme implementation in the current Rust frontend;
6. expected service boundary for a future native MLX candidate;
7. whether conversion can be verified against upstream output within acceptable audio similarity/quality.

Current evidence already suggests OminiX has GPT-SoVITS inference infrastructure but its main text preprocessor is not yet a complete Japanese frontend. Treat this as a hypothesis to verify against the pinned current source, not as permission to fake Japanese support.

A future MLX migration must be a separate Goal or explicitly approved extension after the owner accepts the upstream voice. It must not be silently mixed into this validation deployment.

## Decision gates

### Gate A — model compatibility

Pass only if upstream GPT-SoVITS v2Pro loads the candidate checkpoints and generates intelligible Japanese.

If fail:

- capture exact compatibility evidence;
- try a justified pinned upstream revision if the model metadata indicates one;
- do not modify production;
- stop rather than performing an unbounded rewrite.

### Gate B — character identity

The owner must listen to the paired files.

Pass only if the owner judges the candidate clearly worth keeping because it is more immediately recognizable/stable as Kurisu than the current Qwen 3.1 default baseline.

Automated speaker similarity scores may be supplementary, but they cannot replace this listening gate.

### Gate C — host viability

Pass if the candidate can remain loaded or be started on demand without unacceptable memory pressure, and warm synthesis is practical enough for further integration experiments.

### Gate D — production integration

**Out of scope for this Goal.** Even if A-C pass, do not change `amadeus-tts` routing until a separate integration decision is approved.

## Recorded owner outcome and closure

- Gate A passed: the pinned upstream GPT-SoVITS v2Pro candidate loaded on MPS and produced intelligible Japanese.
- Gate B passed on 2026-09-29: the owner listened to the controlled paired samples and judged GPT-SoVITS clearly more like Makise Kurisu than Qwen 3.1: `GPT-SoVITS 明显比 Qwen 3.1 更像牧濑红莉栖，Gate B 通过。`
- Gate C passed for continued evaluation: warm RTF was `0.432–0.552`, API RSS was approximately `1.67–1.77 GiB`, and the candidate remained isolated on loopback.
- Final outcome: `ACCEPTED_FOR_FURTHER_INTEGRATION`.
- The MPS PoC runtime and all external A/B, benchmark and smoke evidence remain retained; no cleanup or deletion is authorized by this closure.
- Production routing, protected voice IDs, OpenClaw, 9Router and the existing `:18792`/`:18793` services were not changed.
- The next phase is a separate, not-yet-active Goal: `docs/AMADEUS_KURISU_GPT_SOVITS_MPS_PRODUCTION_CUTOVER_GOAL.md`.
- MLX conversion is explicitly deferred to a later independent optimization Goal.

## Expected repository changes

Keep the implementation small. Likely tracked artifacts, subject to Codex discovery, are:

```text
docs/AMADEUS_KURISU_GPT_SOVITS_POC_GOAL.md
infra/macos/...              # optional host setup/service template only if needed
scripts/...                  # focused install/verify/A-B helper if justified
.agent/tasks/...             # only for unresolved follow-up work
```

Do not vendor GPT-SoVITS or the Hugging Face model into this monorepo.

If a helper is added, it should fetch/pin external sources into the host runtime area, verify revisions/hashes and fail closed on mismatches rather than duplicating third-party source.

## Validation level

Planning/document-only commit is **FAST**.

During execution:

- repository helper changes: focused syntax/tests + `git diff --check`;
- before any commit that contains runtime/service setup: `pnpm check:secrets`;
- model/runtime deployment to the Mac host requires explicit `--apply` or equivalent confirmation path consistent with repo rules;
- no Docker/OpenClaw release build is required because production containers are intentionally unchanged;
- record a dated checkpoint only when the host runtime is actually installed/changed and rollback evidence is warranted.

## Rollback / cleanup

Before host runtime mutation, record the pre-existing state of any path/service/port that will be touched.

Rollback must be able to:

- stop the PoC process/service;
- remove its launchd entry if one was created;
- remove only the dedicated PoC environment/model/cache directories selected for this Goal;
- leave production `:18792`, existing tuner, 9Router/OpenClaw containers and protected Qwen voice IDs untouched;
- preserve generated A/B evidence only when the owner wants it retained.

No rollback action may delete shared Conda, Homebrew, Hugging Face or model caches belonging to unrelated services.

## Completion evidence

This Goal is complete when the repository/runtime evidence records:

- pinned upstream GPT-SoVITS revision;
- pinned `bysq/TTS-KurisuMakise` revision and candidate checkpoint hashes;
- chosen device path (MPS/CPU) and reason;
- selected neutral reference metadata;
- successful Japanese local synthesis;
- local endpoint health/smoke evidence if an endpoint was started;
- paired Qwen 3.1 vs GPT-SoVITS A/B outputs generated from identical text;
- provider proof that the Qwen samples came from 3.1;
- latency/RTF and memory evidence for the candidate;
- owner listening verdict;
- explicit statement that production routing was not changed;
- if the owner accepts the candidate, an MLX/OminiX compatibility report or a clearly scoped follow-up task for it.

The final outcome is one of:

```text
REJECTED
  Candidate is not sufficiently more Kurisu-like; clean up PoC and keep production unchanged.

ACCEPTED_FOR_FURTHER_INTEGRATION
  Candidate clearly improves Kurisu identity; keep the PoC/evidence and plan the MLX/production integration separately.
```

This Goal does not itself authorize `GPT-SoVITS -> production` cutover.
