# Upscale default 2x — candidate applied — 2026-09-30

## Source and candidate runtime

- Pushed source commit: `d7f2847d82f4f1dc15f84589a8a5907890992cae`
- Immutable OpenClaw image: `local/openclaw-amadeus:git-d7f2847d82f4-20260930154020`
- OpenClaw host: CasaOS on OrbStack `nyannyan`
- Phase: candidate apply, no VERSION bump/release
- OpenClaw rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930154020`

## Host service checkpoint

- Protected host checkpoint:
  `/Volumes/Avalon/backups/operation-skuld/image-service/amadeus-image-service-default2x-20260930T154020Z`
- Contents: prior installed `service.py`, prior launchd plist, safe rollback note;
  permissions 0700 directory / 0600 files. No service token, model weights, or
  asset database was copied.

## Applied behavior and verification

- Amadeus tool boundary defaults to scale 2 and honors an explicit current-turn
  user 4x request; it does not let a model-proposed 4x override an unmarked
  user request.
- Host image service now defaults omitted scale to 2 and preserves explicit 4.
- Candidate OpenClaw image is healthy; Amadeus registered and Gateway ready.
- Image service LaunchAgent running; health reports engine ready; live installed
  module verification returned `validate_scale(None)=2`, `validate_scale(4)=4`.
- Before apply: `pnpm test:delivery` (44 tests), `pnpm test:amadeus` (78 tests),
  `pnpm typecheck:amadeus`, `pnpm build:amadeus`, host image service unit suite
  (8 tests), `pnpm check:secrets`, and `git diff --check` passed.
- `manage-amadeus-image-service.sh --apply install` updated files but its first
  launchctl bootstrap returned exit 5. Read-only diagnosis found the service
  unloaded and port closed; retrying the same `launchctl bootstrap` succeeded.
  LaunchAgent and health were then verified running/ready. No rollback was
  necessary.
- No actual user image was upscaled or delivered as a live paid/compute smoke.
  The image generation Goal's separate WhatsApp acceptance gates remain open.

Detailed safe deploy summary:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930154020/deployment-summary.md`.
