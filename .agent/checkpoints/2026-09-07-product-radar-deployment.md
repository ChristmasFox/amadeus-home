# Product Radar deployment checkpoint — 2026-09-07

## Deployment target

- Canonical target: OrbStack Linux machine `ubuntu`, CasaOS.
- Compose: `/var/lib/casaos/apps/product-radar/docker-compose.yml`.
- Product Radar image: `local/product-radar:git-dd80fb7a606d`.
- changedetection image: `ghcr.io/dgtlmoon/changedetection.io:0.60.3`.
- Product Radar data: `/DATA/AppData/product-radar`.
- changedetection datastore: `/DATA/AppData/changedetection/datastore`.
- LangBot shared network: `langbot_langbot_network`.

Secrets remain outside Git. The Product Radar container reads the existing
LangBot API credential from `/run/secrets/langbot-api-token`; admin recipient IDs
are sourced from the existing external admin identity file. No secret values are
recorded here.

## Commands and evidence

- Host BuildKit build succeeded with empty proxy build args after the first Corepack network attempt failed:
  `docker buildx build --load -t local/product-radar:git-dd80fb7a606d --build-arg HTTP_PROXY= --build-arg HTTPS_PROXY= --build-arg ALL_PROXY= apps/product-radar`.
- Image transfer succeeded with `docker save | orb -m ubuntu -u root docker load`.
- The committed CasaOS template was copied to the canonical compose path.
- changedetection initially used an unavailable `wget` healthcheck in the first container definition; commit `380f132` replaced it with the image-provided Python healthcheck. The container was recreated without deleting its datastore.
- Product Radar bind-mounted data initially needed ownership for the non-root `node` user; `/DATA/AppData/product-radar` and the mounted LangBot token file were set to UID/GID `1000` with restrictive modes.
- changedetection API access was verified with the generated datastore `api_access_token` without printing it; Product Radar `/health` subsequently returned HTTP 200.
- LangBot API access was verified with the mounted existing `X-API-Key` credential; the read-only bot listing request returned HTTP 200.
- Seller preview returned HTTP 200 with `baselineCount=5`.
- Product preview returned HTTP 200 with title, KRW 1,400,000 price, ACTIVE status, two images, and seller `4771473 / 기미히끼잉잉`.
- Runtime containers were healthy: `product-radar` and `changedetection`.
- Product Radar LangBot plugin install task `24` reached `INSTALL_READY`.

## Safety boundary

No test Watch was created through the deployed API, no changedetection notification
was forced, and no Telegram/KOOK message was sent. The user can now perform the
acceptance test through LangBot using the natural-language Seller/Product Watch
flows.

## Rollback

The deployment was additive because the Product Radar CasaOS app did not exist
before this change. To stop it while preserving data, run from the canonical app
directory:

```sh
orb -m ubuntu -u root bash -lc \
  'cd /var/lib/casaos/apps/product-radar && docker compose down'
```

Do not remove `/DATA/AppData/product-radar` or
`/DATA/AppData/changedetection/datastore` during a rollback unless data deletion
is explicitly requested.

## Post-deployment listener fix

The first installed plugin task `24` exposed only the Command component because the
Product Radar EventListener YAML lacked `spec: {}`. Commit `efbf19e` added the
manifest field. Reinstall task `32` reached `INSTALL_READY`; the LangBot API now
reports both `Command` and `EventListener` components for `product-radar`.

The deployed Product Radar and changedetection containers remained healthy. The
user should resend the natural-language request; no Watch or test notification was
created by the diagnostic work.

## Post-deployment interaction fix

The first preview worked but the Telegram inline keyboard did not render because
the active LangBot image only consumed the existing PUBG marker. Commit `53d1b84`
updated the Product Radar bridge to use that existing renderer marker and added
plain `确认监控` / `取消` handling scoped to the pending conversation. It also
sets natural-language watches to `intervalSeconds=120` and adds `停止监控` /
`停止这个商品 <URL>` controls that PATCH the Watch to `enabled=false`.

LangBot plugin reinstall task `35` reached `INSTALL_READY`; the API reports both
`Command` and `EventListener` components. No test Watch or real platform
notification was created by this fix.

## Telegram callback routing fix

A user acceptance attempt reached the Product Radar confirmation message, but
clicking the button produced a Telegram callback error. The existing patched host
router only forwarded `pubg:m:` and `hh1:` data; `pr1:confirm:<token>` fell through
to its JSON callback parser. Commit `d73b9fc` added `pr1:` to the router.

The patch image was built and activated as:

- `local/langbot-agent:d73b9fcf5ec2-20260907-220006`
- compose backup: `/var/lib/casaos/apps/langbot/docker-compose.yml.codex-backup.20260907-220009`

Both `langbot` and `langbot_plugin_runtime` restarted successfully. The active
Telegram source contains the `pr1:` route, Product Radar and changedetection are
healthy, and the Product Radar database still has zero Watches because the failed
callback did not create one.
