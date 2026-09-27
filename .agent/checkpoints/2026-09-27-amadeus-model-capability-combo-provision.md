# Amadeus model-capability adapter — protected pre-apply and 9Router Combo gate

Date: 2026-09-27 local. Goal remains active; **OpenClaw candidate/release and
real channel acceptance have not yet occurred**. No generated image/audio,
private prompt, sender/group identifier, token, provider account, or OAuth
material is present in this Git record.

## Source and protected rollback baseline

- Source commit before the first production write:
  `8c1599ffb099864ee7db49a3808eed4347ee0289` on
  `codex/model-capability-adapter-2026-09` (pushed); `VERSION=1.6.4`.
- Live OpenClaw before any switch:
  `local/openclaw-amadeus:git-b389e869d6a2-20260927084301`, healthy.
  Live 9Router: `local/9router:git-0296df534708-20260925T051532Z`, PID
  `1449961`; no restart. Native Mac TTS LaunchAgent PID `50062`, last exit 0;
  `/healthz` HTTP 200/ready. Product Radar remains healthy.
- Protected pre-goal OpenClaw checkpoint:
  `/DATA/AppData/openclaw/backups/amadeus-model-capability-pre-20260927T125216Z`.
  Directory mode 0700; config, WhatsApp monitor and manifest mode 0600;
  manifest SHA-256 values and source commit were read back and verified.
  It preserves the prior config, prior volume-installed voice guard, and
  previous immutable image tag/digest without publishing their contents.
- Avalon mount UUID and storage sentinel matched the private host profile
  before the 9Router write. Minimal 9Router prestate checkpoint:
  `/Volumes/Avalon/backups/operation-skuld/amadeus-model-capability/amadeus-image-preapply-20260927T125332Z-47371.json`.
  Its directory is 0700, file 0600. It contains only the absence of the
  previous `amadeus-image` Combo/strategy and the fields required for
  independent removal; it contains no provider settings or credentials.

## 9Router management API acceptance

- `scripts/provision-9router-image-combo.py --apply` created `kind=image`
  `amadeus-image` with ordered models
  `ag/gemini-3.1-flash-image` → `cx/gpt-image-2.5` and an explicit
  per-Combo `fallback` strategy. Authenticated `--verify-live` readback passed.
  A second `--apply` returned `IMAGE_COMBO=existing` and
  `IMAGE_STRATEGY=existing` (no API mutation); its additional protected
  poststate snapshot is adjacent to the original. Unrelated Combos, aliases,
  global/other Combo strategy settings, and provider connection identities
  had identical in-memory projections before/after. 9Router PID unchanged.
- One paid prompt-only request from the **live OpenClaw container network**
  with `model=amadeus-image` returned HTTP 200, one valid JPEG (380,668 bytes).
  The bytes/base64 were validated in memory and discarded, not saved to Git.
  Sanitized 9Router logs observed Gemini as attempt 1/2 and successful first
  backend. This transport smoke is **not** Agent selection or group delivery.
- Read-only synthetic fault fixture against the exact compiled 9Router image
  route and Combo response helper passed: Gemini success stays first; 429 on
  the first model advances to GPT Image 2.5 and succeeds from one logical
  request; both unavailable return a structured failure. No real provider
  credential/quota was altered and no live first-model fault was induced.
- An authenticated missing-prompt request returned HTTP 400 before Combo
  dispatch; no `amadeus-image` attempt was observed in the router logs.
  **Limitation:** this pinned 9Router helper classifies an *upstream* HTTP 400
  as fallback-eligible too. Do not claim general no-fallback behavior for
  upstream request errors. No 9Router source change is permitted in this Goal.

## Independent rollback readiness

- Remove only the new 9Router Combo/strategy with the original **prestate**
  file (not the later idempotence snapshot):
  `python3 scripts/provision-9router-image-combo.py --apply --machine nyannyan --restore-checkpoint <the original protected prestate path above>`.
  Its tested restore logic preserves unrelated Combo/alias/settings state.
- Prior OpenClaw image/config, prior TTS activation/Skill, prior group policy,
  and the prior WhatsApp monitor can be restored from the protected pre-goal
  checkpoint and the previous immutable source/image. The normal candidate
  release script will create its own broader checkpoint before switching.
  9Router accounts, ASR/TTS aliases, native TTS files/process, and unrelated
  Amadeus capabilities do not need rollback for this change.

Next gate: immutable OpenClaw candidate build/apply under the existing release
workflow, then real group/voice acceptance. This checkpoint is not Goal
completion or authorization to claim real channel delivery.
