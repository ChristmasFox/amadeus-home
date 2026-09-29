# Amadeus image assets and on-demand upscale checkpoint

- Date: 2026-09-29 (Asia/Shanghai)
- Source commits: `849041e`, `d745e4f`, `6210c70`, `7175240`
- Release image: `local/openclaw-amadeus:git-6210c70b0ca6-20260929215321`
- Host service: launchd `com.amadeus.image-assets`, configured port `18792`,
  Apple MLX readiness passed.
- Protected release checkpoint:
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260929215321`
- Protected candidate refresh checkpoint:
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260929215636`
- Post-deploy evidence roots:
  `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260929215321`
  and `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260929215636`

## Verified

- Host asset import returns opaque ids and stores originals separately from
  derived outputs; originals remain unchanged after upscale.
- Realistic 2x: `1080x1440 -> 2160x2880`, approximately `15.9s`.
- Anime 2x: `1346x467 -> 2692x934`, approximately `10.5s`.
- Explicit anime 4x: `1346x467 -> 5384x1868`, approximately `46.5s`.
- Manual `imageId` CLI invocation, authenticated controlled read, and
  unauthenticated `401` behavior passed.
- Host service restart preserved derived metadata and lineage.
- OpenClaw container recreate preserved the mounted asset tree checksum:
  `e8f8f13605f77da0116ad15d6e0934bdbc51f8d7b7acd581cb2176407486aa08`.
- Live plugin preflight contains `amadeus_image_upscale` and Skill
  preflight contains `image-upscale`.
- A direct source-level `upscaleImage` invocation against the live service
  returned `img_7411df57670b42d284b4f1f0e533ce45`, parent
  `img_75bc75b5296841f6955dc1217284aaf0`, `2160x2880`, and a structured image
  attachment/media path under the container asset root.
- `pnpm workflow:plan`, focused Python/TypeScript tests, build, secrets scan,
  and diff checks passed before release apply.

## Pending

The owner WhatsApp inbound acceptance is not claimed. A synthetic CLI delivery
reached WhatsApp but did not carry trusted inbound sender metadata, so its tool
catalog remained restricted to `web_search`/`web_fetch`. Production policy was
not broadened to make that synthetic path pass. The owner must send a real
inbound generation/upscale request and verify the delivered image, reply
precedence, and no-automatic-upscale behavior.

## Rollback

Restore the previous OpenClaw compose/config and immutable image from the
protected checkpoint, run `docker compose up -d --no-build`, and stop the host
service with `scripts/manage-amadeus-image-service.sh --apply stop`. Leave the
asset root and registry intact unless deletion is explicitly requested.
