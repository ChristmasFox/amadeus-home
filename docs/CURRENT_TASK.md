# Current Task — Qwen Audio TTS model fallback (Completed)

Date: 2026-09-29 local.

The `amadeus-tts` route now tries `qwen-audio-3.1-tts-flash`, then the
model-bound `qwen-audio-3.0-tts-flash` voice, then the existing M204 OminiX
service for bounded transient cloud failures. A separate protected 3.1 cloned
voice was enrolled from the authorized 46-second sample because Qwen binds a
cloned voice to its target model.

Source commit: `13cbd55`. Live 9Router image: `local/9router:git-13cbd559ab24-20260929T062044Z`.
The 3.1 direct smoke, protected secret preparation, live bridge smoke, health
checks, and rollback checkpoint all passed. Evidence and rollback details are
recorded in `.agent/checkpoints/2026-09-29-amadeus-qwen-audio-tts-model-fallback.md`.

The temporary public voice-enrollment origin and frp mapping were removed after
provisioning. The Cloudflare `audio.nyannyan.top` DNS record may still exist;
remove that record when convenient because the sample endpoint is no longer
served. There is no active Goal after this completion.

---

# Current Task — Qwen Audio TTS cloud primary (Completed)

Date: 2026-09-29 local. Completed Goal:
`docs/AMADEUS_QWEN_AUDIO_TTS_CLOUD_FALLBACK_GOAL.md`.

The cloud `qwen-audio-3.0-tts-flash` voice path is now the primary
`amadeus-tts` provider, with the existing M204 OminiX service as a bounded
transient-failure fallback. The 46-second protected reference was cloned,
the 9Router adapter was deployed, and real owner WhatsApp acceptance passed
for typed voice, ordinary text-only, and inbound voice-note turns. The owner
confirmed both generated voice replies were playable. Evidence and rollback
details are recorded in
`.agent/checkpoints/2026-09-29-amadeus-qwen-audio-tts-cloud-release.md` and
the protected runtime paths listed there.

There is no active Goal after this completion. Older completed Goals below
remain historical evidence and are not live instructions.

---

# Previous Task — Kurisu TTS Tuner (Completed / release 1.6.7)

Date: 2026-09-28 local. Completed Goal: `docs/AMADEUS_KURISU_TTS_TUNER_GOAL.md`.

The owner explicitly confirmed that the Amadeus 1.6.6 Kurisu OminiX production Goal is complete and requested the next development plan: build a highly adjustable local HTML tuner for Kurisu voice style/prosody/generation parameters.

The Goal was implemented and released as **1.6.7** with exactly one patch bump. Runtime acceptance and the final OpenClaw release deployment are recorded in `.agent/checkpoints/2026-09-28-amadeus-kurisu-tts-tuner-release.md`.

The tuner reuses the existing single resident OminiX Base 1.7B production model and cached `kurisu-v1` x-vector. It does not start a second model. Production remains on the existing bounded `amadeus-tts` / `:18792` contract. Per the owner's explicit LAN-access request, the tuner is served by the same native TTS process on `0.0.0.0:18793`; Host/Origin allowlists expose the intended `192.168.5.3` browser endpoint without adding a 9Router/OpenClaw/channel/public route.

The design priority is strong adjustability without fake controls: editable baseline and emotion delta, PROD/A/B/C controlled comparison, text/style/seed/sampling/speed locks, STYLE ONLY / SAMPLING / VARIANCE / FREE COMPARE modes, and the actual pinned OminiX controls `temperature`, `top_k`, `top_p`, `max_new_tokens`, `seed`, `speed_factor`, and `repetition_penalty`. Model/reference/x-vector/language identity remain locked.

Git remains the production source of truth. Runtime drafts/history/audio stay protected outside Git. The browser may create a hash-bound production proposal, but production style is changed only by an explicit repo-owned promotion path that updates the canonical Git-tracked style config, validates, commits/installs the reviewed state, smokes production, and uses the existing owner-notification path. Do not give the TTS HTTP service general Git/shell mutation authority.

Production voice work has priority over Lab batches; Lab samples are sequential and yield between samples. Any real native/candidate switch and final 1.6.7 release must preserve the deployment-notification guarantee established in 1.6.6.

## Previous task — Kurisu OminiX Production Migration (Release 1.6.6, Complete)

Completed Goal: `docs/AMADEUS_KURISU_OMINIX_PRODUCTION_GOAL.md`.

Release 1.6.6 completed the protected A backup, production cutover to OminiX Base 1.7B x-vector + bounded Kurisu emotion, pinned OpenClaw/9Router style transport, deployment-notification repair, rollback evidence and real owner handset acceptance. Current production remains the compatibility baseline for the tuner.

The existing bounded emotion IDs are `default`, `irritated`, `embarrassed`, `angry`, `sarcastic`, `soft`, and `sad`. The current production style already includes explicit sentence-level prosody, emphasis, contrastive rhythm/energy and the sharp-to-soft Kurisu tsundere contour; the tuner exists to let the owner iterate on those characteristics efficiently without reopening the migration.

Evidence remains in `.agent/checkpoints/2026-09-28-amadeus-kurisu-ominix-release.md` and the existing completed Goal/report history.

Older completed/paused Goals and checkpoints remain historical evidence in their existing documents; they are not live instructions.
