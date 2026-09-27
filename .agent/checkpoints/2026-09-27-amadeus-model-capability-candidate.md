# Amadeus model-capability adapter — OpenClaw 1.6.4 candidate

Date: 2026-09-27 local. **Candidate only; not a final release or Goal
completion.** No sender/group identifiers, private messages, generated
image/audio, credentials, account emails, OAuth state, or media payloads are
recorded in this Git checkpoint.

## Production switch and independent recovery

- Source branch at candidate build: `codex/model-capability-adapter-2026-09`,
  commit `02df41443a54` (version remains 1.6.4). The explicit command used
  the private host profile, `--machine nyannyan`, `--apply --candidate
  --build-auto --full-verify`. The workflow selected OpenClaw build and
  Product Radar reuse; full local verification, secrets scan, immutable
  commit-tag image transfer, Compose `--no-build`, health and smoke passed.
- Current candidate image:
  `local/openclaw-amadeus:git-02df41443a54-20260927125732`, healthy.
  Previous released image:
  `local/openclaw-amadeus:git-b389e869d6a2-20260927084301`.
  Product Radar stayed on
  `local/product-radar:git-d988000e1c5d-20260924130631`, healthy.
- Deployment rollback checkpoint:
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927125732`.
  It contains the prior config (0600), prior WhatsApp npm project/monitor,
  Compose/image definitions and protected runtime data. Its directory was
  initially created as **0755** by the old release script; it was promptly
  tightened to **0700**, and both manifests were tightened to **0600**.
  The prior config was read back as the concrete image default and
  `tts.auto=inbound`. A source fix now creates future checkpoints with
  umask 077, directory mode 0700 and 0600 manifests from the outset.
  The earlier, smaller protected pre-goal config/monitor/image checkpoint is
  `/DATA/AppData/openclaw/backups/amadeus-model-capability-pre-20260927T125216Z`.
- Post-deploy evidence directory:
  `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260927125732`
  (0700). The first 9Router Combo prestate file, which independently removes
  only `amadeus-image` on rollback, remains
  `/Volumes/Avalon/backups/operation-skuld/amadeus-model-capability/amadeus-image-preapply-20260927T125332Z-47371.json`
  (0600 under a 0700 directory). Do **not** use the later idempotence
  checkpoint to remove this newly created Combo.

## Candidate runtime readback

- Primary chat: `nine_router/arthur-combo`. Default image:
  `openai/amadeus-image`; OpenAI-compatible catalog exposes only
  `amadeus-image`, still at `http://9router:20128/v1` with the existing
  external SecretRef. Private-network opt-in and 180-second image timeout
  remain unchanged. 9Router owns the Gemini → GPT Image fallback.
- ASR model remains `amadeus-asr`. TTS is `tts.auto=tagged`, final mode,
  `amadeus-tts`, `kurisu-v1`, MP3, `maxTextLength=1200`, `timeoutMs=120000`.
  Global Agent-facing `tts,message` deny remains. Ordinary typed requests
  have no automatic TTS without a tag; a real channel check is still needed.
- Both WhatsApp and Telegram wildcard group rules contain only
  `web_search,web_fetch,image_generate`; the fixed WhatsApp owner retains
  the full group/direct profile, while the global non-owner direct sender
  policy remains web-only. The version-pinned group policy patch is present
  in both core/worker bundles, and the versioned tagged-typed Japanese guard
  was applied to the volume-installed WhatsApp monitor. A read-only policy
  projection **against the live candidate config/modules** showed image
  availability for non-owner WhatsApp/Telegram group contexts, web-only for
  non-owner WhatsApp direct contexts, full owner group/direct access minus
  global denies. This is **not real inbound group acceptance**.
- 9Router image/PID remained unchanged (`1449961` at the post-candidate
  check); native Mac TTS LaunchAgent remained PID `50062`, exit 0 and HTTP
  200/ready. Neither service was restarted. OpenClaw and Product Radar
  health passed. Optional media adapter absence remains an existing warning.

## Remaining acceptance and caveat

The direct authenticated `amadeus-image` transport smoke and exact 9Router
Combo fallback fixture are in the preceding Combo checkpoint. The pinned
9Router helper also treats an upstream HTTP 400 as fallback-eligible; only
request-level missing-prompt validation was verified to return 400 before
Combo dispatch. No source modification or damaging account fault was used.

Real channel tests are still missing: owner and non-owner group image delivery,
non-image group isolation, non-owner sensitive-tool denial, and inbound voice,
typed explicit voice, ordinary typed text. Verify the single structured image
attachment, one Japanese audio attachment, Japanese/Chinese visible text,
Japanese speech/text identity, and no directive leakage without copying the
media or private prompt into Git. Only after those gates and a disposition of
the upstream-400 limitation can the single version bump and final release
proceed. The Goal remains active.
