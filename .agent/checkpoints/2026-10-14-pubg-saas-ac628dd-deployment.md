# PUBG SaaS `ac628dd` deployment — 2026-10-14

## Scope

Arthur authorized replacing only the Gateway and Worker on OrbStack VM
`pubg-saas-m2-clean`. PostgreSQL, egress-proxy, the SaaS 9Router, the
`nyannyan` VM, private Kurisu, private OpenClaw and private 9Router were outside
the operation. No image was pushed. Source tests and the backup/restore drill
were not rerun, as requested.

## Build and deployment

The clean, pushed Git commit `ac628dde9ad46d824603d387446f9e1a95eeaa28` was
streamed from its Git archive to the target VM and built there for `linux/arm64`
using BuildKit. The immutable image is
`local/pubg-saas:git-ac628dde9ad46d824603d387446f9e1a95eeaa28`, image ID
`sha256:7d05776e3b9232b2ac67653378ad4e66015ba62c3ccc67b00b9383ff61f46293`.

The protected pre-switch record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-ac628dd-pre-switch.txt`
(mode `0600`). The live stack file remains mode `0600`; only its
`PUBG_SAAS_IMAGE` value changed. Compose used:

```sh
docker compose --project-name pubg-saas-public \
  --project-directory /var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas \
  --env-file /var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas/.env \
  -f /var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas/compose.yaml \
  up -d --no-deps --force-recreate --no-build --wait gateway worker
```

## Verification

| Component | Before | After | Result |
| --- | --- | --- | --- |
| Gateway | `2d4110cbc564` | `ba7ff5a5c7a1` | Running, zero restarts |
| Worker | `8390ee76f047` | `a965bc8da5bf` | Healthy, zero restarts |
| PostgreSQL | `e47fd49fcab5` | unchanged | Healthy |
| egress-proxy | `c5cd33cba219` | unchanged | Healthy |
| SaaS 9Router | `2ce598008143` | unchanged | Running |

The read-only KOOK session query returned `connected=true`, `last_sn=43`, and
`updated_at=2026-10-14T11:44:08.669Z`. Gateway and Worker logs each had zero
matches for error/fatal/exception/provider-fallback patterns after startup.
No human message, model request, PUBG request or migration was performed.

## Rollback

The previous image `local/pubg-saas:git-d936f79` remains local on the target
with image ID `sha256:7aad5fa11fa4c6f245b9d74862138c9aac1da3c45412f7935b694ac3f3bb622e`.
Restore `PUBG_SAAS_IMAGE=local/pubg-saas:git-d936f79` in the protected stack
`.env`, preserve mode `0600`, validate with `docker compose ... config --quiet`,
then recreate only Gateway and Worker with `--no-deps --force-recreate
--no-build --wait`. The protected record above contains the exact stack path
and pre-switch service IDs.

Arthur's real KOOK acceptance remains pending. M2 is not complete until Arthur
tests and accepts the live experience.
