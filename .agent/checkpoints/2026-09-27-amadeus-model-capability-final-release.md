# Amadeus model-capability adapter — final 1.6.5 release

Date: 2026-09-27 local. Goal:
`docs/AMADEUS_MODEL_CAPABILITY_ADAPTER_GOAL.md`. This content-safe checkpoint
records the final release and owner acceptance. It contains no private prompts,
sender/group identifiers, phone numbers, credentials, account data, generated
image/audio payloads, or voice samples.

## Release and runtime evidence

- Source release commit: `fb7dd742b609` on
  `codex/model-capability-adapter-2026-09`, pushed to origin; `VERSION=1.6.5`.
  `RELEASE_NOTES.md` contains one Chinese release entry and passes the version
  validator. The release was applied with the existing explicit workflow:
  `scripts/deploy-openclaw.sh --apply --build-auto --full-verify --machine nyannyan`.
- Immutable OpenClaw image:
  `local/openclaw-amadeus:git-fb7dd742b609-20260927142412`, healthy.
  Product Radar reused its unchanged healthy image. Release output recorded
  `OPENCLAW_HEALTH=passed`, `PRODUCT_RADAR_HEALTH=passed`,
  `NAS_SSH_READONLY_SMOKE=passed`, `OWNER_NOTIFICATION=sent`,
  `OWNER_OUTBOX_SMOKE=passed`, `POST_DEPLOY_MAINTENANCE=passed`.
  The known optional media adapter absence and `LOG_POLICY=warning` remain
  report-only and are not a voice fallback.
- Protected release rollback checkpoint:
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927142412`;
  directory mode 0700, config and manifests mode 0600. Post-deploy evidence:
  `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260927142412`
  mode 0700. The earlier absent-Combo and GPT-first priority-only 0600
  snapshots remain available for independent 9Router rollback.
- Live readback: primary chat `nine_router/arthur-combo`; image
  `openai/amadeus-image`; ASR `amadeus-asr`; TTS `amadeus-tts`,
  `kurisu-v1`, MP3, `tts.auto=tagged`, max 1200, timeout 120000; global
  `tts,message` deny retained. WhatsApp/Telegram group safe tools are
  `web_search,web_fetch,image_generate`; non-owner direct wildcard remains
  web-only. 9Router PID remained `1449961`; native TTS LaunchAgent remained
  PID `50062`, HTTP 200/ready. Neither was restarted.

## Acceptance disposition

The owner confirmed the final candidate behavior after the typed-voice fix:
real typed voice responses now preserve one audio attachment and the required
visible format:

```text
中文：<Chinese summary>

日本語：<Japanese answer>
```

The owner had already reported the GPT-first image/group behavior as having no
issues; the final runtime also passed the scoped policy projection, real
logical image transport smoke, exact 9Router fallback fixture, and focused
no-duplicate/format tests. No generated media or private channel content is
retained here.

Repository gates passed during release: build, typecheck, full tests,
OpenClaw patch/lifecycle tests, candidate policy/config validation,
architecture check, secrets scan, `git diff --check`, version/release-notes
validation, immutable image build/transfer, CasaOS switch, health/smoke and
owner outbox delivery. The exact live 9Router helper still classifies an
upstream HTTP 400 as fallback-eligible; missing-prompt 400 is rejected before
Combo dispatch. This limitation is documented and no 9Router source change
was made.

All Goal acceptance criteria are now dispositioned without expanding into
9Router source changes, ASR/TTS Combo work, new model tiers, a second Agent,
or a duplicate sender/tool path.
