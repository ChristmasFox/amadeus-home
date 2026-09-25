# Amadeus 1.5.3 — WhatsApp Voice I/O

## Status

- Target version: `1.5.3`
- Base branch: `main`
- Planning base SHA: `dc121c566414202139adc47b2a4f4ec3b1377923`
- Implementation authority: `Amadeus-M204`
- Agent runtime: OpenClaw only
- User channel in scope: WhatsApp only
- Telegram adaptation: explicitly out of scope for this Goal
- Current repository version at planning time: `1.5.2`

## Mission

Add first-class voice-note input and output to the existing OpenClaw/Kurisu architecture without creating a second Agent runtime, a second planner, channel-specific business logic, or a parallel speech workflow.

The target user experience is:

```text
Arthur sends a WhatsApp voice note
        ↓
OpenClaw receives the media
        ↓
9Router Speech-to-Text
        ↓
Qwen Audio ASR
        ↓
transcript enters the same Kurisu conversation
        ↓
OpenClaw / Kurisu reasons and uses tools normally
        ↓
final reply text
        ↓
9Router Text-to-Speech
        ↓
M204 native Qwen3-TTS service
        ↓
kurisu-v1 cloned voice
        ↓
WhatsApp voice reply
```

Typed WhatsApp messages must continue to receive text by default. Voice-note input should receive voice output by default, with text fallback when TTS is unavailable.

This release is **voice-note I/O**, not real-time voice calling. Do not add VAD, WebRTC, barge-in, full-duplex streaming conversation, or a second persistent voice Agent.

## Architectural invariants

```text
WhatsApp               = transport only
OpenClaw / Kurisu       = sole Agent, session, memory, intent, tools, personality
9Router                 = model/provider control plane for chat + ASR + TTS
Qwen Audio ASR          = speech-to-text inference
M204 Speech Runtime     = local deterministic TTS inference service
Qwen3-TTS               = speech synthesis model
kurisu-v1               = voice profile, not a model identity
```

Keep the existing single-Agent rule. Do not restore LangBot, n8n, Mastra, a keyword router, a second planner, or a Telegram-specific speech path.

Speech is an I/O capability around OpenClaw; it must not become an independent conversational runtime.

## Existing system to evolve, not duplicate

Current OpenClaw configuration already routes the main model through:

```text
nine_router/arthur-combo
baseUrl = http://9router:20128/v1
```

The current 9Router image is repository-managed at:

```text
infra/docker/casaos/9router/Dockerfile
```

and currently installs `9router@0.5.81` on top of the pinned upstream image.

The current OpenClaw config source is:

```text
integrations/openclaw/openclaw.json.example
```

M204 already has a native macOS host-service pattern via `host.docker.internal`, currently used by MacHostAgent. Reuse that deployment boundary for TTS instead of forcing Qwen3-TTS into the CasaOS Linux guest.

## Desired logical model names

The long-term stable names exposed to OpenClaw are:

```text
arthur-combo   # chat / reasoning
amadeus-asr    # speech -> text
amadeus-tts    # text -> speech
```

OpenClaw should not need to know vendor-specific ASR model names, DashScope endpoint details, local TTS ports, or the physical TTS model implementation after this Goal is complete.

`amadeus-asr` and `amadeus-tts` are routing abstractions. They are not personality names.

## Important 9Router distinction

Do not confuse these 9Router concepts:

1. **Chat Combo** — normal `/v1/chat/completions` model grouping.
2. **Vision/Audio Adapter** — multimodal input fallback for chat models that cannot directly consume `audioInput`.
3. **Speech-to-Text** — `/v1/audio/transcriptions`.
4. **Text-to-Speech** — `/v1/audio/speech`.

The existing Combo named `amadeus-asr` that contains `Qwen/qwen-audio-3.0-asr-flash` is not sufficient evidence that `/v1/audio/transcriptions` can resolve that Combo.

For 1.5.3, ASR must use the real STT path and return a normalized transcription result. Do not implement production ASR by asking a chat model to "transcribe this audio" through `/v1/chat/completions` unless upstream 9Router/OpenClaw constraints make the standard STT route impossible and the limitation is explicitly documented. Prefer fixing the STT routing layer.

## Phase 0 — Re-discovery before coding

On M204, Codex must first follow `AGENTS.md` startup rules and read:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/PROJECT_STATE.md`
4. `docs/CURRENT_TASK.md`
5. `.agent/state.md`
6. this Goal

Then run:

```sh
git status --short --branch
git log -5 --oneline --decorate
pnpm workflow:plan
```

Before editing speech config, inspect the actual pinned OpenClaw `2026.9.4` source/config schema available in the environment and the exact 9Router release chosen for implementation. Do not invent OpenClaw speech config keys from memory.

Also inspect the live 9Router state before changing it:

```text
/v1/models/stt
/v1/models/tts
/v1/models/info
/v1/audio/transcriptions
/v1/audio/speech
```

Record sanitized evidence only. Never commit API keys, workspace IDs, account identifiers, cloned voice source files, or private WhatsApp media.

## Phase 1 — 9Router speech control plane

### 1.1 Upgrade decision

The dashboard currently reports a newer 9Router release than the repository-pinned `0.5.81`. Evaluate the current upstream release first.

Preferred order:

1. verify whether the latest tested upstream version already supports the required Qwen STT/TTS behavior;
2. if yes, bump the repository-managed 9Router package through the existing pinned Dockerfile pattern;
3. if no, add the smallest source-controlled compatibility patch necessary;
4. do not fork the entire 9Router codebase into this repository.

Any 9Router version change must remain reproducible from Git and must preserve the existing OpenAI/Codex proxy fix, LAN binding policy, API-key protection, and current no-proxy rules.

### 1.2 ASR route

Target model:

```text
qwen-audio-3.0-asr-flash
```

Use Alibaba Model Studio / DashScope as the inference authority. Current official API behavior must be rechecked at implementation time. At planning time, the model is documented as a synchronous non-real-time ASR model and supports DashScope multimodal-generation requests; Qwen ASR families also have OpenAI-compatible entry points in supported regions.

The external contract from OpenClaw must remain:

```http
POST /v1/audio/transcriptions
Content-Type: multipart/form-data

model=amadeus-asr
file=<audio>
```

Expected normalized success shape:

```json
{
  "text": "transcribed user speech"
}
```

Requirements:

- `amadeus-asr` must resolve to a real STT route, not merely an LLM Chat Combo.
- If 9Router still cannot expand STT combos, use a model alias or minimal STT routing extension rather than adding routing logic to OpenClaw business code.
- The actual DashScope model ID must be replaceable later without editing WhatsApp or OpenClaw channel code.
- API key and workspace/region information remain runtime secrets/config outside Git.
- Support WhatsApp voice-note formats encountered in production. Normalize/convert only when required by the provider.
- Preserve Chinese, Japanese, and English recognition; do not hard-code Chinese-only language hints.
- Do not silently substitute another ASR model on ordinary transcription errors unless an explicit fallback is configured and tested in 9Router.

### 1.3 ASR failure semantics

Return a structured failure that OpenClaw can convert into a short user-visible message. Do not feed empty transcription into Kurisu as if the user sent a blank message.

Distinguish at least:

```text
unsupported_audio
transcription_failed
provider_unavailable
auth_unavailable
timeout
```

If upstream provides only a generic failure, normalize it at the provider boundary without inventing a transcript.

### 1.4 TTS route

Use 9Router's native `Self-hosted TTS` provider instead of `Local Device`.

`Local Device` means the host OS's built-in speech engine; it is not the Qwen3-TTS inference service.

Target external contract:

```http
POST /v1/audio/speech
Content-Type: application/json

{
  "model": "amadeus-tts",
  "input": "Kurisu final reply text"
}
```

9Router should resolve the logical target to the self-hosted provider and ultimately call the M204 native service.

Keep model and voice separate:

```text
TTS model  = qwen3-tts-1.7b (or the exact canonical runtime id selected by the service)
voice      = kurisu-v1
```

Do not encode the voice identity as a fake model such as `qwen3-tts-kurisu`.

### 1.5 Fallback policy

Primary production voice is local `kurisu-v1`.

TTS failure must never make the whole Agent response fail. Required user-facing behavior:

```text
TTS healthy   -> send voice reply
TTS unhealthy -> send the already-produced text reply
```

A cloud/Edge emergency voice may be added later, but 1.5.3 does not need to silently replace Kurisu's voice with a different persona. Prefer text fallback over unexpected voice identity changes.

## Phase 2 — M204 native Qwen3-TTS runtime

### 2.1 Runtime location

Run TTS natively on macOS, outside CasaOS/OrbStack, so Apple Silicon acceleration can be used directly.

Suggested source tree:

```text
apps/qwen3-tts-service/
├── README.md
├── pyproject.toml or requirements lock
├── src/
│   ├── app.py
│   ├── config.py
│   ├── engine.py
│   ├── voices.py
│   └── schemas.py
└── tests/
```

Exact Python package structure may differ if Codex finds a cleaner repository-conformant location.

Suggested runtime endpoint:

```text
http://host.docker.internal:18792
```

Do not reuse MacHostAgent port `18791`.

### 2.2 API contract

Implement an OpenAI-compatible minimum surface so 9Router can use its existing Self-hosted TTS adapter:

```http
GET  /healthz
GET  /v1/voices
POST /v1/audio/speech
```

`POST /v1/audio/speech` must accept at least:

```json
{
  "model": "qwen3-tts-1.7b",
  "voice": "kurisu-v1",
  "input": "text",
  "response_format": "mp3"
}
```

The service may synthesize WAV internally, but it must return a media type and format that the WhatsApp/OpenClaw path can actually deliver. Add deterministic conversion via `ffmpeg` only if required.

### 2.3 Model

Use the official Qwen3-TTS **1.7B** family, not a nonexistent 17B model.

Prefer the official `Qwen3-TTS-12Hz-1.7B-Base` path for the final cloned voice because Base supports reusable voice cloning/prompt workflows.

Codex may use an Apple-Silicon/MPS or MLX implementation if it materially improves reliability/performance on M204, but must preserve the same service contract and document the selected backend.

Do not couple OpenClaw or 9Router to MPS/MLX-specific code.

### 2.4 Persistent model lifecycle

The TTS daemon must load the model once and keep it resident.

Required lifecycle:

```text
process start
  -> load model
  -> load kurisu-v1 voice profile
  -> precompute/cache reusable speaker prompt if supported
  -> warmup
  -> health ready
```

Do not reload the model or re-derive voice cloning state for every WhatsApp reply.

Expose meaningful health states such as:

```text
starting
loading_model
warming_up
ready
degraded
failed
```

`/healthz` must not report ready before the model and active voice profile can synthesize.

### 2.5 launchd

Add source-controlled macOS service management under `infra/macos/`, following the existing MacHostAgent pattern.

Requirements:

- LaunchAgent or LaunchDaemon choice must be justified by the required accelerator/user-session behavior.
- install/uninstall/status scripts are idempotent;
- no model weights or voice source audio in Git;
- logs go to a documented local path with rotation or bounded growth;
- restart policy must not create a crash loop that saturates the host;
- service should recover automatically after M204 reboot.

## Phase 3 — `kurisu-v1` Voice Profile

The production voice must be a reusable profile separate from model weights.

Target runtime layout outside Git, for example:

```text
~/Library/Application Support/Amadeus/voices/kurisu-v1/
├── reference.wav
├── reference.txt
├── prompt-cache.bin / prompt.pt / backend-specific cache
└── metadata.json
```

The exact host path may follow the repository's existing host-profile conventions.

Git may contain only a sanitized template/schema, not the actual reference audio or generated voice embedding if it could expose private/licensed material.

### Voice identity goal

The desired voice is Kurisu-inspired:

- young adult feminine voice;
- intelligent, clear, slightly cool timbre;
- natural but somewhat quick pacing;
- restrained confidence;
- light sharpness / tsundere flavor when appropriate;
- capable of natural Chinese and Japanese pronunciation;
- not exaggerated anime acting on every sentence.

The implementation should create an original Amadeus/Kurisu-inspired voice profile rather than depending on a runtime clone of a specific voice actor. The operator is responsible for providing reference material they are allowed to use.

### Persona vs voice separation

Voice identity and conversational personality remain separate:

```text
SOUL / OpenClaw persona -> what Kurisu says and conversational tone
kurisu-v1 profile        -> stable speaker identity
TTS style instruction    -> local prosody/emotion hint when supported
```

Do not move personality rules into 9Router.

Do not put keyword rules such as `if PUBG then sarcastic` into the TTS runtime. If style is supported, accept a bounded style field from the speech layer and map it deterministically to backend instructions.

## Phase 4 — OpenClaw native media/speech integration

### 4.1 Use the native OpenClaw speech lifecycle

Inspect pinned OpenClaw `2026.9.4` and use its supported media/speech hooks/providers. Do not create a separate WhatsApp voice bot or poller.

Required behavior:

```text
WhatsApp voice note
  -> OpenClaw recognizes inbound audio
  -> transcription provider call
  -> transcript becomes the user turn in the existing session
  -> Kurisu performs the normal tool loop
  -> final response text is available
  -> reply modality follows inbound modality policy
```

Typed messages continue on the existing text path.

### 4.2 Reply-modality policy

Target policy:

```text
inbound text  -> text response
inbound voice -> voice response
```

If OpenClaw's native equivalent of `tts.auto = inbound` exists in the pinned version, prefer it. Verify the exact schema from source instead of assuming the key name.

TTS failure -> text fallback.

For the owner's added bilingual preference: when an inbound voice turn is
answered in Japanese or another non-Chinese language, speak one reply and
append **one concise Chinese text summary** of the same facts. Use OpenClaw's
native visible-text / `[[tts:text]]` audio-only split and the one existing
WhatsApp reply transport; no extra Agent tool/sender or translation runtime.
An explicit request for Chinese output yields one Chinese voice reply without a
redundant Chinese text summary. Typed messages remain text-only. Verify the
pinned directive parser, actual phone order/count, TTS failure fallback and
faithfulness of the summary before release.

ASR failure -> a concise text error response, not a synthesized hallucinated answer.

### 4.3 WhatsApp only

For this Goal:

- production acceptance is WhatsApp DM;
- do not add Telegram voice logic;
- do not duplicate configuration into a Telegram adapter;
- do not remove existing Telegram support merely to satisfy this Goal;
- do not require Telegram acceptance before release.

If an OpenClaw speech setting is channel-neutral, configure it once. The fact that Telegram may technically inherit generic support later is not a release requirement.

### 4.4 Session and identity

Transcribed audio must enter the same existing WhatsApp session identity as a text message from that sender.

Do not create separate `voice:<sender>` sessions.

Identity binding, owner authorization, tools, memory, follow-up context, and presentation rules must be identical after transcription.

### 4.5 Transcription provenance

Do not expose raw base64 audio or provider credentials to the Agent.

The Agent may receive:

```text
transcribed text
minimal media metadata when useful
transcription failure state
```

Do not persist private WhatsApp audio indefinitely. Define temporary-file cleanup and maximum retention explicitly.

## Phase 5 — Optional 9Router Skills

9Router's `9router-stt` and `9router-tts` Skills are useful as Agent-facing documentation/tools for explicit user requests such as:

```text
“把这个录音转成文字”
“把这段文字生成语音文件”
```

They are **not** the automatic WhatsApp voice-note pipeline.

Do not require the LLM to decide whether to invoke the STT Skill before every inbound voice note. Automatic speech input belongs to the OpenClaw media lifecycle.

If the Skills are installed or mirrored into the OpenClaw workspace, document them as optional explicit speech utilities and keep them separate from automatic reply modality.

## Phase 6 — Configuration and secrets

### Repository-safe config may include

- logical model names (`arthur-combo`, `amadeus-asr`, `amadeus-tts`);
- native TTS service port;
- non-secret health paths;
- launchd templates;
- voice-profile schema and profile name `kurisu-v1`;
- model family/runtime selection;
- deterministic timeout and size limits.

### Must remain outside Git

- DashScope API key;
- Alibaba workspace ID if treated as deployment-private configuration;
- production provider/account identifiers;
- WhatsApp private media;
- `reference.wav`;
- cloned prompt/embedding when derived from protected reference material;
- actual 9Router API keys;
- local bearer tokens if one is added between 9Router and the TTS daemon.

Run `pnpm check:secrets` before every commit that touches runtime config.

## Phase 7 — Performance and reliability constraints

Voice-note interaction must remain usable for everyday WhatsApp conversation.

Record real M204 measurements for:

```text
T_download  = WhatsApp media acquisition
T_asr       = ASR request
T_agent     = OpenClaw + tools + LLM
T_tts_first = TTS start / first usable audio
T_tts_total = complete synthesis
T_total     = inbound voice received -> outbound voice sent
```

Do not block release on an arbitrary synthetic latency target, but document baseline p50-style manual observations from at least several short clips and identify obvious bottlenecks.

Bound resources:

- maximum inbound voice-note size/duration;
- ASR timeout;
- TTS input text length or chunking strategy;
- max temporary-file age;
- model warmup timeout;
- retry count.

Avoid unbounded retries.

### Long responses

Do not send a single enormous generated audio file for very long answers.

Prefer one of:

1. short spoken summary + text detail;
2. deterministic sentence/paragraph chunking into bounded voice messages;
3. text fallback when the response exceeds a configured speech limit.

Choose one policy, test it, and document it.

## Phase 8 — Tests

Add focused automated coverage for at least:

### 9Router boundary

- `amadeus-asr` resolves through the intended STT path;
- multipart transcription request is normalized correctly;
- provider errors do not become fake transcripts;
- `amadeus-tts` resolves to the self-hosted provider;
- TTS request preserves input/model/voice contract;
- TTS failure returns a usable failure to OpenClaw.

If upstream 9Router is not vendored, implement repository-level smoke/integration tests against its public HTTP contract rather than duplicating upstream unit tests.

### Qwen3-TTS service

- `/healthz` startup vs ready semantics;
- unknown voice returns a deterministic 4xx;
- missing input returns a deterministic 4xx;
- `kurisu-v1` resolution uses runtime profile storage;
- model engine is singleton/persistent;
- successful request returns valid non-empty audio;
- cleanup works;
- no reference material appears in logs.

Heavy model tests may be marked as M204 integration tests rather than normal CI tests if model weights are unavailable in CI.

### OpenClaw integration

Use the actual pinned OpenClaw config schema and test that:

- inbound voice produces a transcript user turn;
- inbound text still follows the existing text path;
- voice input chooses voice output when TTS is healthy;
- TTS failure falls back to text;
- ASR failure does not call the normal Agent with empty text;
- session identity remains the same as WhatsApp text DM;
- no Telegram-specific code is required.

### Architecture checks

Assert or manually verify:

- no LangBot/n8n/Mastra/runtime reintroduction;
- no new keyword router;
- no second sender;
- no private voice assets in Git;
- no channel-specific logic in deterministic domain packages;
- OpenClaw remains the only conversational Agent.

## Phase 9 — Deployment on M204

This Goal includes real deployment and acceptance, but all destructive/runtime changes still follow repository safety rules and checkpoint requirements.

Suggested release sequence:

```text
1. implement and test source
2. install/download Qwen3-TTS runtime and model outside Git
3. provision kurisu-v1 outside Git
4. install native macOS speech service
5. health + local synthesis smoke
6. update/rebuild 9Router only if required
7. direct 9Router ASR smoke
8. direct 9Router TTS smoke
9. update OpenClaw config
10. build OpenClaw image only if source changes require it
11. checkpoint CasaOS + host service config
12. deploy
13. WhatsApp real acceptance
14. observe logs/latency
15. release/version/checkpoint
```

Do not modify the live 9Router dashboard manually and leave Git unable to reconstruct the result. Any required 9Router provider patch, version pin, or startup config must be represented in repository source/templates/scripts.

## Real acceptance matrix

The release is not complete until all required rows pass on M204.

| Case | Input | Expected |
| --- | --- | --- |
| A | WhatsApp typed DM | normal text reply; no TTS |
| B | short Chinese voice note | correct-enough transcript enters normal Kurisu session; voice reply returned |
| C | short Japanese voice note | transcript is processed; voice reply returned |
| D | voice note requiring an existing tool | transcript triggers the same native tool path as equivalent typed text |
| E | follow-up voice after typed context | same session/context is preserved |
| F | typed follow-up after voice | same session/context is preserved |
| G | ASR provider unavailable | concise text failure; no hallucinated response |
| H | TTS service stopped | Kurisu text reply still arrives |
| I | TTS service restarted | service reloads model/profile and voice replies recover without OpenClaw restart when feasible |
| J | M204 reboot | launchd restores TTS service; OpenClaw/9Router recover through existing service management |
| K | long reply | configured long-response speech policy is applied without oversized/unbounded audio |
| L | repeated same voice-note delivery/retry if channel can duplicate | no uncontrolled duplicate billing/work beyond the chosen idempotency strategy |

For ASR quality acceptance, use ordinary spoken Chinese/Japanese/English samples and manually compare transcript meaning. Do not commit the recordings.

For TTS acceptance, confirm:

- output is intelligible;
- `kurisu-v1` is consistently loaded;
- consecutive replies do not randomly change speaker identity;
- Chinese and Japanese are natural enough for daily use;
- first synthesis after warmup and subsequent synthesis are measured separately.

## Idempotency and duplicate protection

WhatsApp/media retries can repeat inbound payload delivery. Where OpenClaw does not already guarantee media-message idempotency, use the stable channel message/media identifier or content hash at the speech boundary to avoid unnecessary repeated ASR work.

Do not build a new global message broker merely for this.

If caching transcription, store only bounded metadata/text necessary for retry handling and define expiry. Avoid long-term audio storage.

## Observability

Add sanitized operational logs for:

```text
speech direction: inbound/outbound
provider logical route
request id / channel message id hash
input duration/size bucket
ASR/TTS elapsed time
success/failure category
TTS voice profile name
fallback-to-text event
```

Never log:

```text
full private audio
base64 payloads
API keys
reference audio
full secrets
private access tokens
```

Prefer structured logs that can be correlated across OpenClaw -> 9Router -> M204 TTS without exposing message contents.

## Rollback

Before applying runtime changes, create a checkpoint containing sanitized copies/metadata for:

- previous OpenClaw config;
- previous 9Router image/tag/config;
- previous CasaOS compose state;
- launchd service state;
- current repository commit;
- voice runtime version/model id without voice asset contents.

Rollback must be able to restore:

```text
WhatsApp text-only behavior
existing arthur-combo routing
previous 9Router runtime
```

A TTS failure must not require rolling back the entire Agent system; disabling speech output and retaining text should be an immediate degraded mode.

## Repository deliverables expected from M204 Codex

At completion, the repository should contain the necessary subset of:

```text
docs/AMADEUS_1_5_3_VOICE_IO_GOAL.md
apps/qwen3-tts-service/**
infra/macos/*qwen*tts* or equivalent speech-runtime service files
infra/docker/casaos/9router/**               # only if version/patch changes are required
integrations/openclaw/openclaw.json.example  # verified native speech config
scripts/**                                    # install/test/deploy helpers only when justified
docs/ARCHITECTURE.md
docs/PROJECT_STATE.md
docs/CURRENT_TASK.md
.agent/checkpoints/<date>-amadeus-1.5.3-voice-io*.md
RELEASE_NOTES.md
VERSION
```

Do not create files only to match this example list; evolve existing structure when a cleaner canonical location already exists.

## Version and release protocol

Only after implementation and required acceptance have passed:

```sh
scripts/amadeus-version.sh bump patch
```

Expected version from the planning base is `1.5.3`.

Do not manually edit version semantics around the release script.

Update `RELEASE_NOTES.md` only for the actual 1.5.3 release and keep repository state consistent with the existing release protocol.

## Required validation before final commit

Run the lowest sufficient workflow first, then release validation when deploying:

```sh
pnpm workflow:plan
pnpm check:secrets
git diff --check
```

Run all affected package/app tests and typechecks. Because this Goal adds a native Python service, include its unit/lint/type checks using the dependency tooling selected by the implementation.

When real deployment is authorized by this Goal, also run the repository's RELEASE path required by `AGENTS.md`, including immutable image/checkpoint rules for any container image that actually changed.

## Completion protocol

For each completed implementation phase:

- update `docs/CURRENT_TASK.md`;
- update `docs/PROJECT_STATE.md`;
- write a dated `.agent/checkpoints/` record;
- put unresolved follow-ups in `.agent/tasks/`;
- run matching tests and `pnpm check:secrets`;
- preserve a rollback checkpoint before runtime cutover.

The Goal is complete only when code/config is reproducible from Git, M204 runtime acceptance passes, WhatsApp voice-note input/output works through the single OpenClaw/Kurisu session, and text fallback remains healthy.

## Explicit non-goals

Do not implement in 1.5.3:

- Telegram voice adaptation or Telegram acceptance;
- real-time phone-call style conversation;
- WebRTC;
- always-listening microphone;
- wake word;
- VAD/barge-in;
- live streaming speech-to-speech;
- second Agent or speech-specific planner;
- voice actor identity matching as a product requirement;
- a generic arbitrary local shell API;
- storing user voice notes as a permanent memory source;
- a second model router inside `plugins/amadeus`;
- personality logic inside 9Router;
- TTS logic inside deterministic domain packages.

## Codex execution directive

M204 Codex should treat this document as the authoritative 1.5.3 implementation Goal.

Optimize the architecture, but preserve the invariants above. When implementation details differ from the examples because pinned OpenClaw/9Router source provides a cleaner native mechanism, use the native mechanism and document the divergence in `PROJECT_STATE` and the final checkpoint.

Do not stop after generating code. Complete local tests, source-controlled deployment definitions, M204 runtime installation, direct ASR/TTS smokes, WhatsApp real acceptance, rollback evidence, documentation, version bump, commit, and push unless blocked by an external credential/model asset that only the operator can provide.

If blocked by the operator-only `kurisu-v1` reference asset, finish every other implementation step, provide a deterministic provisioning command/path, leave the system able to run with a clearly marked temporary test voice only for engineering smoke, and do not call production voice acceptance complete until `kurisu-v1` is installed and tested.
