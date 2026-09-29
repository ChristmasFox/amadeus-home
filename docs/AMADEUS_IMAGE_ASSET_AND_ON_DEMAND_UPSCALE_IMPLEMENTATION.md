# Amadeus Image Asset and On-Demand Upscale Implementation

Date: 2026-09-29 (Asia/Shanghai)

This document records the implementation and operator boundary for
`AMADEUS_IMAGE_ASSET_AND_ON_DEMAND_UPSCALE_GOAL.md`. It is deliberately
content-safe: service tokens, generated image bytes, personal message data,
and credentials remain outside Git.

## Discovered baseline

- The current Mac host is Apple Silicon `Amadeus-M204`; OpenClaw `2026.9.4`
  remains the only Agent runtime.
- CasaOS runs in OrbStack machine `nyannyan`; the OpenClaw container reaches
  the host service through the configured `AMADEUS_IMAGE_SERVICE_BASE_URL`.
- The durable external volume `/Volumes/Avalon` is mounted and healthy, but the
  current launchd/TCC boundary blocked service-created directories there.
- The default runtime root therefore uses the Mac-local application-support
  directory derived from `$HOME`; an external root remains an explicit host
  profile override and must pass a launchd write-access smoke before use.

## Runtime layout

The host profile owns all machine-specific values:

```text
AMADEUS_IMAGE_ASSET_ROOT           $HOME/Library/Application Support/Amadeus/ImageAssets/assets
AMADEUS_IMAGE_REGISTRY_PATH        $HOME/Library/Application Support/Amadeus/ImageAssets/asset-registry.sqlite3
AMADEUS_IMAGE_SERVICE_INSTALL_DIR  $HOME/Library/Application Support/Amadeus/ImageAssets
AMADEUS_IMAGE_SERVICE_MODEL_CACHE_DIR  <install-dir>/models
AMADEUS_IMAGE_SERVICE_TOKEN_FILE   $HOME/Library/Application Support/Amadeus/secrets/image-service-token
AMADEUS_IMAGE_SERVICE_BASE_URL     http://host.docker.internal:18792
AMADEUS_IMAGE_SERVICE_PORT         18792
```

The OpenClaw compose template mounts the configured asset root read-only at
`/var/lib/amadeus/image-assets` and mounts the token as
`/run/secrets/amadeus_image_service_token`. The service registry is local to
the Mac install directory to avoid SQLite locking semantics on a shared
external volume; image originals and derived files remain separate and
immutable/lineage-linked.

## Engine and policy

- Engine: `realesrgan-mlx`, source commit
  `52c0fc1044277900b995308095a1f3cc484a3581`.
- Runtime dependencies are installed in the external host venv; model files
  are cached outside Git under the configured model-cache directory.
- `auto` uses an explicit asset `styleHint` only when trustworthy; otherwise it
  selects the realistic/general profile. The model names never enter the Agent
  contract.
- Supported scales are `2` and `4`; default is `2`. Supported modes are
  `auto`, `realistic`, and `anime`.
- `amadeus_image_upscale` is the only semantic upscale tool. Normal
  `image_generate` does not invoke it.

## Persistence and delivery boundary

OpenClaw captures native `image_generate` result attachments in the
`after_tool_call` hook, imports bytes into the host registry, and preserves the
native attachment delivery path. The `message_sent` hook binds the outgoing
message id to the imported asset. Resolution order is explicit `imageId`,
replied asset, then the current conversation's recent asset. No global latest
image or channel-specific phrase router exists.

The service exposes only token-protected metadata/media routes keyed by opaque
`img_<uuid>` ids. It does not expose directory listing, arbitrary paths, or a
public media origin.

## Operator commands

All mutating host actions require `--apply`:

```sh
scripts/manage-amadeus-image-service.sh --plan install
scripts/manage-amadeus-image-service.sh --apply install
scripts/manage-amadeus-image-service.sh status
scripts/manage-amadeus-image-service.sh health
scripts/manage-amadeus-image-service.sh upscale img_<uuid> --scale 2 --mode auto
```

The launchd label is `com.amadeus.image-assets`. `uninstall` removes only the
launchd definition and leaves asset bytes, registry, model cache, and token
files for recovery.

## Host smoke evidence

The host service reached authenticated readiness with Apple MLX and passed:

- realistic 2x: `1080x1440 -> 2160x2880`, approximately `15.9s`, derived
  lineage recorded and source preserved;
- anime/illustration 2x: `1346x467 -> 2692x934`, approximately `10.5s`,
  `profile=anime`;
- explicit anime 4x: `1346x467 -> 5384x1868`, approximately `46.5s`, within
  the configured output-pixel limit;
- manual `imageId` CLI invocation returned a new derived asset;
- authenticated controlled media read returned the derived PNG, while the
  unauthenticated read returned `401`;
- stopping and restarting the launchd service preserved the registry and
  derived metadata.

No generated binary acceptance assets are committed. The remaining release
and channel evidence is recorded in the dated checkpoint created by the
OpenClaw deployment procedure.

## Rollback

Before host or OpenClaw apply, preserve the protected external checkpoint
created by the deployment script. To disable the optional capability:

1. stop the host service with
   `scripts/manage-amadeus-image-service.sh --apply stop`;
2. restore the previous OpenClaw image/compose/config from the deployment
   checkpoint and run `docker compose up -d --no-build` on the CasaOS host;
3. leave the asset root and registry intact unless explicit asset deletion is
   requested;
4. if needed, remove the launchd definition with
   `scripts/manage-amadeus-image-service.sh --apply uninstall`.

Ordinary native image generation remains independent of the host engine. A
host outage returns a bounded upscale failure and never deletes or overwrites
the source image.
