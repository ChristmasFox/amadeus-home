# Qwen image local-only OpenClaw candidate — 2026-10-07

Status: deployed for operator WhatsApp testing; not a release or final Goal
acceptance.

## Source and preflight

- The operator explicitly authorized applying the Qwen candidate. Only Qwen
  files were committed as `e0a2217f302da1c6fd93cde4cb784067d082fa63`;
  unrelated VPS source/document changes were preserved separately.
- `pnpm workflow:plan` selected an explicit OpenClaw release-config apply.
  Candidate dry-run selected OpenClaw rebuild and Product Radar reuse.
- Focused Qwen bridge and image-route tests passed (11 each). Identity (10),
  Presentation (8), and Amadeus (134) tests, Amadeus typecheck, pinned delivery
  boundary fixture, shell syntax, secrets scan and `git diff --check` passed.
  The apply script repeated its broader preflight tests and secrets scan.
- Before the switch, the Qwen bridge was `ready/idle` on loopback 18793,
  the live OpenClaw image was the 1.9.5 primary-only baseline, and 9Router
  was `local/9router:git-0a062a1c2c13-20261005T153458Z`.

## Protected switch

- Applied `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=1
  ./scripts/deploy-openclaw.sh --apply --candidate --build-auto` on the
  canonical OrbStack CasaOS host `nyannyan`.
- New immutable OpenClaw image:
  `local/openclaw-amadeus:git-e0a2217f302d-20261006185442`, image ID
  `sha256:b1bab014141f507dccebe921e19fc897f258fe1de76e04201105e90962e75674`.
  Product Radar image was reused; 9Router image and Combo were unchanged.
- Pre-switch checkpoint:
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261006185442`, directory
  mode 0700, `checkpoint.json` mode 0600. It contains protected pre-switch
  compose/config/env/state backups and a backup manifest. Post-deploy evidence:
  `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261006185442`.
- The script completed successfully: OpenClaw and Product Radar health,
  Amadeus Gateway registration, NAS SSH read-only smoke, owner notification
  and outbox smoke passed. The optional media adapter network smoke was
  skipped because the service is absent. Candidate mode skipped release
  maintenance and log policy checks.

## Read-only runtime check

- OpenClaw and 9Router containers are running from the intended images.
  In the OpenClaw container, `AMADEUS_QWEN_IMAGE_LOCAL_ONLY=1`, base URL is
  `http://host.docker.internal:18793/v1`, and the mounted token is mode 0600.
- An authenticated container request to `/v1/models` returned HTTP 200 and
  `local/qwen-image-2.1-uncensored`. Bridge `/health` remained `ready/idle`,
  strict concurrency one, queue capacity one, and deadline 600000 ms.
- This temporary route bypasses GPT Image. A real WhatsApp generation/edit,
  exactly-one image+caption delivery, follow-up state, and the eventual
  GPT-primary-to-Qwen fallback have **not** been tested or accepted here.

## Recovery boundary

If operator testing fails, restore the protected OpenClaw pre-switch
checkpoint and previous immutable image through the existing candidate
rollback procedure. Do not modify Product Radar, 9Router, TTS/ASR, model
assets or unrelated VPS services. The local Qwen bridge can be stopped with
`infra/macos/manage-qwen-image.sh --stop --apply` after OpenClaw rollback.
