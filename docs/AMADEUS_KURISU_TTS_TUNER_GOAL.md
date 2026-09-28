# Amadeus Kurisu TTS Tuner Goal

Date: 2026-09-28 local

Status: **active planning; execution requires an explicit `/goal` handoff**.

Target release: **Amadeus 1.6.7**. Release 1.6.6 is complete and is the production baseline for this Goal. Do not reopen the 1.6.6 migration, do not rerun the A/C matrix, and do not change `VERSION` in this planning-only commit.

## 1. Owner decision and objective

The owner has accepted and completed the 1.6.6 OminiX production migration. Production now uses the accepted OminiX Qwen3-TTS Base 1.7B x-vector path with the bounded Kurisu emotion contract.

The next problem is iterative voice tuning: the owner wants a browser page that makes Kurisu's delivery highly adjustable and makes it fast to compare style/prosody/generation changes without editing source by hand, restarting a second model, or using WhatsApp as the tuning UI.

This Goal SHALL build an owner-local **Kurisu TTS Tuner** that:

1. reuses the single resident production OminiX model and cached `kurisu-v1` speaker embedding;
2. provides a local HTML/CSS/JavaScript UI with strong but explicit tuning controls;
3. supports controlled PROD/A/B/C listening comparisons with clear variable locks;
4. exposes only generation controls actually supported by the pinned OminiX revision;
5. keeps free-form style experimentation strictly inside the local Lab boundary and never exposes it through normal `amadeus-tts` production requests;
6. preserves Git as the production source of truth by separating runtime drafts from production promotion;
7. preserves production voice priority, bounded memory use, rollback, notification and secret boundaries;
8. release the finished tuner as Amadeus 1.6.7 only after runtime acceptance.

The tuner is an operator tool, not a new Agent capability. OpenClaw does not plan or route tuner experiments.

## 2. Verified 1.6.6 production baseline

Implementation must start from current Git/live facts, not the historical PoC.

Current source facts on `main`:

- root `VERSION` is `1.6.6`;
- native service remains `apps/qwen3-tts-service/service.py` on production port `18792`;
- production `style` is normalized to the bounded enum in `apps/qwen3-tts-service/kurisu_emotion.py`;
- `apps/qwen3-tts-service/ominix_engine.py` owns one persistent OminiX worker process;
- `apps/qwen3-tts-service/ominix-worker/main.rs` loads one model, caches the reference speaker embedding once, and synthesizes sequentially;
- the current worker uses `SynthesizeOptions { language: "japanese", ..Default::default() }`, so normal production inherits generation defaults from the pinned model rather than exposing per-request sampling controls;
- production HTTP remains OpenAI-compatible and accepts only the bounded `style` value, not arbitrary instruct text;
- the stable compatibility boundary remains `amadeus-tts` / `qwen3-tts-1.7b` / `kurisu-v1` / `:18792` / existing Bearer auth / WAV, MP3 and Opus output.

The current baseline and emotion text are duplicated between Python and Rust. This Goal must remove that duplication before making style editable.

## 3. Pinned OminiX tuning surface

The production OminiX source remains pinned to revision:

`4988a3fcfa48b8cb5d0780a501b92c6a41401523`

At that revision `qwen3-tts-mlx::SynthesizeOptions` exposes these actual override fields:

```text
temperature
 top_k
 top_p
 max_new_tokens
 seed
 speed_factor
 repetition_penalty
```

Language is also an option, but Kurisu production remains pinned to Japanese. `speaker` is not a user tuning control for this Base x-vector path.

Implementation MUST verify the pinned upstream source before wiring each control. Do not invent pitch, volume, emotion-strength, pause-duration or other sliders that are not backed by a real model/runtime input. A future UI may offer higher-level semantic sliders only after there is a deterministic mapping with tests; V1 exposes real controls and free-form Lab instruct text instead of fake knobs.

The backend must publish a machine-readable tuning schema so the UI does not duplicate limits/defaults. Every field must declare:

```text
id
type
source/default or inherit state
safe min/max/step if verified
labMutable
productionPromotable
warning/description
```

If a safe range cannot be justified from pinned source/model config and focused tests, use a validated numeric input with conservative server-side bounds rather than an arbitrary slider range.

## 4. Canonical Kurisu style configuration

Create one Git-tracked canonical style document, proposed path:

`apps/qwen3-tts-service/kurisu_style.json`

It becomes the sole declarative source for production speech style. The exact schema may be adjusted during implementation, but must represent at least:

```json
{
  "schemaVersion": 1,
  "profile": "kurisu-v1",
  "language": "japanese",
  "baseline": "...",
  "generationDefaults": {},
  "emotions": {
    "default": { "instruct": "", "generationOverrides": {} },
    "irritated": { "instruct": "...", "generationOverrides": {} },
    "embarrassed": { "instruct": "...", "generationOverrides": {} },
    "angry": { "instruct": "...", "generationOverrides": {} },
    "sarcastic": { "instruct": "...", "generationOverrides": {} },
    "soft": { "instruct": "...", "generationOverrides": {} },
    "sad": { "instruct": "...", "generationOverrides": {} }
  }
}
```

Rules:

- preserve the exact V1 emotion IDs unless a later owner decision changes them;
- production `final_instruct = baseline + selected emotion instruct`;
- unsupported production emotions still fail closed;
- model identity, reference audio, x-vector and credentials are not part of this JSON;
- production generation overrides are explicit and nullable/inherit-by-default; do not silently convert inherited OminiX/model defaults into guessed constants;
- remove hard-coded baseline/delta duplication from the Rust worker after the canonical config path is proven;
- validate the config in both focused tests and install/deploy preflight.

Python may own validation/composition and send the already validated effective instruct/options to the private worker protocol. The Rust worker must not become a second configuration source.

## 5. Runtime architecture

Target architecture:

```text
                         single macOS process boundary

Production clients                                    Owner browser
OpenClaw -> 9Router -> :18792                         http://127.0.0.1:18793
          bounded API                                      |
                 \                                         |
                  \                                        v
                   +------ TTS service / Lab API -----------+
                                      |
                           priority inference coordinator
                                      |
                              one OminiX worker
                                      |
                         one Base 1.7B resident model
                         one cached kurisu-v1 x-vector
```

Requirements:

- `18792` behavior stays production-compatible;
- tuner default listener is `127.0.0.1:18793` only;
- implementation must preflight that the configured tuner port is free; do not silently choose a random replacement port;
- tuner and production share the same already-loaded engine and speaker embedding;
- no second OminiX model process, no second 1.7B allocation, no per-request CLI/model startup;
- no 9Router, OpenClaw, WhatsApp, Telegram or public tunnel is used for tuner traffic;
- no CORS access from arbitrary origins;
- remote/mobile exposure is explicitly out of scope for V1.

The tuner may run as a second `ThreadingHTTPServer` thread inside the existing native TTS process. Do not create a separate Node/Vite/Next service just to serve the UI.

## 6. Frontend implementation

Use repository-owned static files with no remote CDN/assets and no frontend runtime dependency. Prefer:

```text
apps/qwen3-tts-service/tuner/index.html
apps/qwen3-tts-service/tuner/app.js
apps/qwen3-tts-service/tuner/style.css
```

Vanilla HTML/CSS/JavaScript is sufficient. If implementation proves a build system is materially necessary, stop and document why before adding it.

The page must be usable on a normal desktop browser and prioritize rapid ear-based comparison rather than dashboard decoration.

### 6.1 Header/status

Show read-only current facts:

- production/lab health;
- engine = OminiX;
- model id/revision;
- OminiX revision;
- profile `kurisu-v1`;
- current production style hash;
- current queue state;
- current release version;
- warning if the browser config snapshot is stale relative to current production hash.

Never expose reference audio path/content, x-vector bytes, Bearer token, owner target or other secrets.

### 6.2 Test text

Provide:

- editable Japanese test text;
- character count;
- soft warning around routine 40-90 Japanese characters;
- hard service limit remains 1200 characters;
- quick test-sentence presets may be provided per emotion, but arbitrary user Japanese text is allowed;
- punctuation remains exactly user-controlled because punctuation is a real prosody variable.

### 6.3 Style editor

Expose separately:

- production baseline, editable in candidate slots;
- selected emotion delta;
- selected emotion ID;
- read-only effective combined instruct preview;
- diff against current production baseline/delta;
- buttons to reset candidate style to current production.

Lab-only free-form baseline/delta text is allowed here. It must never be accepted by `POST /v1/audio/speech`.

### 6.4 Comparison slots

Provide four slots:

```text
PROD   read-only production snapshot
A      candidate
B      candidate
C      candidate
```

Each candidate can clone PROD or another candidate. Each slot shows its exact effective style hash and generation overrides.

Allow the owner to select any subset for sequential generation. Hard-cap one comparison batch to a small bounded number of generated samples; V1 default is four primary samples. If repeat/variance testing is implemented, enforce a server-side total-job cap and never prequeue an unbounded matrix.

Keyboard shortcuts for play/pause and switching PROD/A/B/C are welcome if they do not complicate accessibility.

### 6.5 Variable locks and experiment modes

The UI must make controlled experiments easy by explicitly showing which variables differ.

Modes:

**STYLE ONLY**
- same text;
- same model/profile/language;
- same seed policy or one fixed comparison seed;
- same sampling/speed controls;
- only baseline/emotion instruct may differ.

**SAMPLING**
- same text and style;
- tune only verified generation options.

**VARIANCE**
- same text/style/options;
- vary/randomize seed deliberately to hear stochastic spread.

**FREE COMPARE**
- advanced owner mode; independent candidate overrides while identity/model/language remain locked.

Provide individual lock controls for text, style, seed, sampling group and speed. The UI must label a comparison as uncontrolled if more than the intended variable group differs.

### 6.6 Advanced real controls

Expose the pinned OminiX controls with an explicit `inherit production/model default` state:

- `temperature`;
- `top_k`;
- `top_p`;
- `seed`, plus a deliberate randomize button;
- `speed_factor`;
- `repetition_penalty`;
- `max_new_tokens` under an Expert/Safety section because it primarily affects generation length/cutoff rather than personality.

Also allow output preview format (`wav`, `mp3`, `opus`) if this can reuse the existing encoder safely. Default comparison should prefer WAV for raw listening or a clearly labeled production-parity format; do not normalize different candidates differently.

The following remain read-only/locked in V1:

- model path/revision;
- OminiX source revision;
- `kurisu-v1` reference;
- x-vector/speaker embedding;
- language = Japanese;
- speaker/model family;
- production auth/network identity.

Changing voice reference/model identity is a different capability and requires a separate Goal.

### 6.7 Results

For each generated sample show:

- audio player;
- audio duration;
- wall synthesis time;
- RTF;
- prefill/generation/decode timings when the pinned worker can return them;
- generated codec frame count when available;
- effective parameter values including inherited/default state;
- exact candidate style hash;
- error/busy state without fabricated audio.

Extend the worker response to preserve the timing breakdown already returned by OminiX instead of throwing it away. Do not log or display private filesystem paths.

## 7. Lab API

A concrete V1 API may use:

```text
GET  /api/v1/status
GET  /api/v1/config
GET  /api/v1/schema
POST /api/v1/synthesize
GET  /api/v1/history
GET  /api/v1/history/<id>
GET  /api/v1/audio/<artifact-id>
POST /api/v1/drafts
POST /api/v1/proposals
```

The exact route names may change, but boundaries may not.

`POST /api/v1/synthesize` is the only endpoint that may accept Lab free-form instruct/parameter overrides. Validate:

- text length;
- UTF-8/JSON body size;
- style length;
- option types and server-side ranges;
- output format;
- no arbitrary file paths;
- no command strings;
- no model/reference path overrides;
- no network URL inputs.

The service creates all output paths itself.

The production `/v1/audio/speech` request schema must remain bounded and must ignore/reject Lab-only fields.

## 8. Production-priority scheduling

The current production service has one inference worker and one pending slot. The tuner must not turn that bounded queue into a large FIFO that delays normal voice replies.

Refactor admission into explicit classes:

```text
production = high priority
lab        = low priority
```

Rules:

- only one model inference can run at a time;
- production waiting work is always chosen before the next Lab sample;
- a Lab batch submits one sample at a time, yielding back to the scheduler after every sample;
- do not enqueue all A/B/C/repeat variants into the model queue at once;
- a currently running OminiX call is not force-cancelled if the upstream runtime cannot safely interrupt it;
- production may therefore wait for one already-running Lab sample, but must not wait behind the remainder of a Lab batch;
- Lab should return a clear busy/queued state rather than expanding memory/queues;
- close/shutdown must cancel pending Lab jobs cleanly.

Add concurrency tests proving normal production can preempt between Lab variants.

## 9. Security and browser boundary

V1 is owner-local only.

Required controls:

- bind Lab listener to loopback, not `0.0.0.0`;
- reject unexpected `Host`/`Origin` values;
- do not emit permissive CORS headers;
- use same-origin static assets only;
- apply a restrictive Content-Security-Policy;
- require JSON + a page/session CSRF nonce for mutating API calls so unrelated web pages cannot form-submit state changes to loopback;
- do not send the production TTS Bearer token into browser JavaScript;
- never expose secrets/reference/x-vector/private target through status/debug APIs;
- bound request bodies, style length, history storage and generated audio size;
- sanitize logs: no spoken text, arbitrary instruct, test sentence, credentials or private paths in normal logs.

If implementation requires binding the tuner beyond loopback, stop. Remote access needs a separate owner decision and authentication design.

## 10. Draft/history storage

Tuning work is not production state.

Store runtime-only experiments under a protected non-Git directory, e.g.:

`~/Library/Application Support/Amadeus/speech/tuner/`

Directory mode 0700; metadata/audio/proposals mode 0600 where applicable.

A run record may contain:

- experiment/run id;
- timestamp;
- selected emotion;
- test text or text hash according to user-selected history policy;
- production style hash at generation time;
- candidate baseline/delta;
- generation overrides and seed;
- timing/duration/RTF;
- candidate label;
- owner note/rating;
- selected/proposal state.

Generated audio and private experiment text never enter Git.

Implement bounded retention with explicit constants/config (for example max age + count + bytes). The exact defaults must be chosen during implementation based on observed audio size and must have tests. Pinned/proposal artifacts must not be silently deleted while still referenced by a pending proposal.

Allow exporting/importing a **non-secret tuner preset JSON**. Export must exclude paths, token, reference data and x-vector.

## 11. Production promotion and Git source of truth

The browser must not directly mutate production style in a way that exists only in the installed runtime.

V1 workflow:

```text
Tune in browser
 -> Save Draft (runtime-only)
 -> Create Production Proposal
 -> proposal contains candidate config + expected current style hash + experiment id
 -> explicit repo-owned promotion command / Codex apply
 -> update canonical Git-tracked kurisu_style.json
 -> validate/tests/secrets
 -> commit reviewed desired state
 -> install/hot-reload exact committed config
 -> smoke
 -> owner notification
```

Add a narrow repo-owned command, proposed shape:

```text
./scripts/promote-kurisu-style.sh --proposal <id> --dry-run
./scripts/promote-kurisu-style.sh --proposal <id> --apply
```

The command must:

- accept only a proposal id/file from the protected tuner proposal directory;
- refuse stale proposals whose `expectedProductionStyleHash` does not match current canonical production style;
- validate schema/emotion IDs/parameter policy;
- show a content-safe diff;
- update only the canonical style config and explicitly allowed metadata;
- never copy generated audio or secrets into Git;
- default to dry-run;
- leave commit/release orchestration under normal repo workflow rather than silently pushing from the TTS service.

The UI button should be named `Create Production Proposal`, not `Apply`, unless a later implementation adds a separately reviewed Git-backed management boundary. This keeps tuning convenient without giving the speech HTTP process general Git/shell write access.

After committed style installation, reload style/config without loading a second model. A production style change should not require replacing the resident OminiX model solely to reread text/parameter config. If the current process structure cannot safely hot-reload the Python-side style store, implement a bounded reload message/state swap; do not fork a second model.

## 12. Rollback

There are two independent rollback levels.

### Tuner/release rollback

Before deploying the 1.6.7 native service, preserve the existing healthy 1.6.6 installed service/worker/plist/config and content-safe hashes in the protected external checkpoint workflow. Restore 1.6.6 if the new service or Lab listener harms production health.

### Style promotion rollback

Every promoted canonical style has a Git predecessor and style hash. Rollback is a new explicit Git-backed promotion/revert of that config, followed by validation/hot reload/smoke. Do not rely on browser localStorage or runtime history as the production rollback source.

No automatic fallback engine is introduced.

## 13. Release/version/notification invariant

Planning keeps `VERSION=1.6.6`.

When implementation and real runtime acceptance are ready:

1. keep 1.6.6 during development/candidate validation;
2. create a protected native TTS checkpoint before the real service switch;
3. any real candidate/native runtime switch must use the deployment notification behavior established by 1.6.6; it must not silently complete;
4. run exactly one `./scripts/amadeus-version.sh bump patch` only for final release, producing **1.6.7**;
5. replace `RELEASE_NOTES.md` with one concise Chinese 1.6.7 entry for the tuner only;
6. run `./scripts/amadeus-version.sh check`;
7. final release notification must use the existing owner outbox/OwnerNotifier and require observed sent evidence;
8. no direct WhatsApp sender, phone number, bot credential or notification fallback may be introduced.

A tuner experiment or draft save is not a deployment and must not send notifications. A real production style promotion should send one content-safe owner event containing style hash/change summary after successful smoke.

## 14. Implementation phases

### Phase 0 — Fresh facts and design lock

- read `AGENTS.md`, `docs/CONTEXT.md`, `docs/CURRENT_TASK.md`, this Goal and relevant 1.6.6 checkpoint;
- `git status --short --branch` and latest log;
- confirm live production is still OminiX/1.6.6 and healthy on `:18792`;
- confirm current OminiX/model revisions and worker binary identity;
- verify port 18793 availability;
- verify pinned upstream `SynthesizeOptions` fields against revision `4988a3...`;
- capture current production style hash and defaults before refactor.

### Phase 1 — Canonical style/config refactor

- introduce schema + canonical `kurisu_style.json`;
- preserve current 1.6.6 behavior byte-for-meaning as migration baseline;
- make Python validation/composition the one style owner;
- remove Rust baseline/delta duplication;
- extend private worker request with validated effective instruct and optional synthesis overrides;
- expose detailed OminiX timing response;
- prove production endpoint still rejects arbitrary styles/options.

### Phase 2 — Lab scheduling/API

- add loopback listener sharing the existing server/engine;
- add production-priority vs Lab-low-priority scheduler;
- implement schema/status/config/synthesize endpoints;
- add CSRF/origin/body/path protections;
- ensure Lab output paths are service-generated and protected;
- add bounded history/artifact retention.

### Phase 3 — Static tuner UI

- implement status header, Japanese test text and emotion selector;
- implement baseline/delta/effective-style editor;
- implement PROD/A/B/C slots and clone/reset/diff operations;
- implement STYLE ONLY / SAMPLING / VARIANCE / FREE COMPARE modes;
- implement variable locks;
- implement advanced verified OminiX controls with inherit state;
- implement sequential generate/playback and metrics;
- implement history, notes, preset export/import and production proposal creation;
- keep UI dependency-free and same-origin.

### Phase 4 — Promotion boundary

- implement proposal schema/hash/stale detection;
- implement repo-owned dry-run/apply promotion script;
- implement canonical style validation and safe install/hot reload;
- add content-safe style-promotion owner notification after successful production smoke;
- prove no runtime-only production drift remains after promotion.

### Phase 5 — Verification

Run the minimum sufficient workflow plus focused tests. At minimum prove:

- current production 1.6.6 bounded style behavior is preserved before tuner-only changes;
- all seven emotion IDs resolve correctly from canonical JSON;
- Lab free-form instruct never becomes accepted on `:18792`;
- every exposed OminiX option maps to the correct pinned `SynthesizeOptions` field;
- invalid types/ranges are rejected;
- worker rejects arbitrary output paths;
- PROD/A/B/C are generated sequentially;
- production jobs win between Lab samples;
- stale production proposal is rejected;
- history retention cannot delete pending proposal artifacts;
- no CORS/public bind/secret leak;
- production health, direct authenticated speech, 9Router `amadeus-tts`, and real voice path remain healthy;
- `git diff --check`;
- focused Python/Rust/JS tests and syntax/build checks;
- `pnpm workflow:plan`;
- `pnpm check:secrets`.

### Phase 6 — Candidate/runtime acceptance

With explicit apply authorization from the active Goal:

- create protected pre-switch checkpoint;
- deploy one updated native TTS process only;
- confirm one resident OminiX model;
- confirm production :18792 health and speech first;
- confirm tuner is reachable only at loopback :18793;
- run one controlled STYLE ONLY comparison and one SAMPLING override without changing production style;
- during a multi-sample Lab run, submit/observe a production speech request and prove it gets priority between Lab samples;
- verify history/proposal files and permissions;
- verify deployment notification delivery for the real runtime switch.

### Phase 7 — 1.6.7 release

- after acceptance, bump once from 1.6.6 to 1.6.7;
- write single-release Chinese notes;
- final verification and secrets scan;
- normal release apply;
- verify release owner notification sent marker;
- record content-safe checkpoint/report;
- update `docs/CURRENT_TASK.md` to complete only after all Definition-of-Done gates pass.

## 15. Validation checklist

- [ ] 1.6.6 is treated as completed baseline, not reopened.
- [ ] `VERSION` stays 1.6.6 until final release bump.
- [ ] Exactly one resident OminiX model/x-vector allocation.
- [ ] Production remains `:18792`; Lab is loopback-only `:18793`.
- [ ] `amadeus-tts`, `kurisu-v1` and bounded production emotion contract remain compatible.
- [ ] Canonical Git-tracked style config eliminates Python/Rust prompt duplication.
- [ ] Lab can edit baseline and emotion delta freely without leaking free-form control into production API.
- [ ] Temperature/top-k/top-p/max-new-tokens/seed/speed/repetition-penalty controls are backed by pinned upstream fields.
- [ ] Unsupported/fake sliders are absent.
- [ ] PROD/A/B/C slots and controlled variable locks work.
- [ ] Fixed-seed comparisons are explicit; random seed changes are never silent.
- [ ] Detailed timing/RTF is visible without logging spoken text.
- [ ] Production queue wins between Lab samples.
- [ ] Batch size/history/audio storage are bounded.
- [ ] Lab never exposes secrets/reference/x-vector/private paths.
- [ ] No public/CORS access and mutating calls have same-origin/CSRF protection.
- [ ] Drafts/history/audio remain outside Git.
- [ ] Production proposal is hash-bound and stale proposals fail closed.
- [ ] Production style only changes through Git-backed explicit promotion.
- [ ] Real runtime switch and final release each produce the required owner notification evidence.
- [ ] Focused tests, workflow plan, diff check and secrets scan pass.
- [ ] Final release is exactly 1.6.7 with one-release notes.

## 16. Stop conditions

Stop and report instead of expanding scope if:

- tuner requires a second resident 1.7B model;
- loopback isolation cannot be maintained;
- production request latency/availability is materially degraded by Lab work and priority scheduling cannot bound it;
- arbitrary Lab instruct/options can reach the normal `:18792` contract;
- implementation requires exposing the reference audio, x-vector, production token or private filesystem data to the browser;
- a requested UI control cannot be mapped to a verified pinned OminiX input;
- production promotion cannot preserve Git as source of truth;
- safe style hot reload would require overlapping model processes;
- current production is no longer the recorded healthy OminiX 1.6.6 baseline;
- required release/deployment notification cannot be observed.

Do not solve any stop condition by adding a second Agent/runtime, hidden sender, alternate TTS endpoint through 9Router, public tunnel, runtime-only production config, or moving model identity controls into the page.

## 17. Explicit non-goals

This Goal does not:

- retrain or fine-tune Qwen weights;
- replace `kurisu-v1` reference/x-vector;
- add another speaker/model;
- add dynamic emotion IDs beyond the existing V1 enum;
- add per-word/per-phoneme pitch curves or timeline editing;
- add fake high-level sliders not backed by real controls;
- expose tuner through WhatsApp/Telegram/OpenClaw/9Router;
- add public/mobile remote access;
- change ASR/image/PUBG/HomeLab capabilities;
- add automatic TTS model fallback;
- create a second model worker or frontend server process;
- let the TTS HTTP process commit/push arbitrary Git changes;
- store generated audio, reference assets or secrets in Git.

## 18. Definition of Done

The Goal is complete only when all of the following are true:

1. the local browser tuner is reachable on the M204 loopback interface and nowhere else;
2. production and tuner demonstrably share one resident OminiX Base 1.7B model and one cached `kurisu-v1` x-vector;
3. the owner can compare PROD/A/B/C using editable test text, baseline, emotion delta and all verified OminiX generation controls;
4. experiment modes and locks make controlled comparisons obvious and reproducible;
5. generated results provide usable audio plus objective timing/RTF and effective config evidence;
6. production voice requests remain bounded and take priority between Lab samples;
7. tuner drafts/history/proposals are protected and bounded outside Git;
8. one canonical Git style config owns production baseline, emotion deltas and promotable generation defaults;
9. a candidate can be converted into a stale-safe production proposal and applied through the repo-owned explicit promotion path without a second model load;
10. production `amadeus-tts` and real channel voice behavior remain healthy;
11. version is released exactly as Amadeus 1.6.7 with protected rollback evidence;
12. the final release owner notification has observed sent evidence;
13. no secret/private media/runtime-only production desired state enters Git.

After completion, stop. Actual artistic tuning of every Kurisu emotion is an owner-driven use of the finished tuner, not a requirement to keep expanding this Goal.