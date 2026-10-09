# 9Router image diagnostics and false-lock fix — 2026-10-09

## Deployment

- Operator approval: explicit `Apply`.
- Runtime source commit: `ed872b3f3978`.
- Verification-fixture follow-up: `f74a4fc` (test-only; no runtime image rebuild).
- Guest: OrbStack machine `nyannyan`.
- Image: `local/9router:git-ed872b3f3978-20261009T130134Z`.
- Manifest digest: `sha256:1a068329307c0a46f7699bfe05034f7375891113adddd3efb44ce7b23aa97045`.
- Pre-switch old-image export: `/Volumes/Avalon/backups/operation-skuld/9router/9router-git-bb8efb450983-20261009T124652Z-20261009T130138Z.tar.gz`, SHA-256 `3aae42b3a0b333e1df7b46b08e56fbbae4a4b6357e59f20fcd21e30ac4399ed9`. The new image was built with BuildKit and loaded directly into the OrbStack daemon.
- CasaOS checkpoint: `/DATA/AppData/9router/backups/router-upgrade-20261009T130134Z`.
- OpenClaw was not rebuilt or restarted: `local/openclaw-amadeus:git-a1983e9b637d-20261009090331`.

## Effective runtime evidence

- npm `9router@0.5.95` effective CLI route marker verified at
  `/usr/local/lib/node_modules/9router/app/.next-cli-build/server/app/api/v1/images/generations/route.js`.
- Runtime policy marker verified in the effective CLI chunk. The route SHA-256 is
  `46a9032286fdd5688db1b668785f2f3dda6f6dcbc19c378b970ce5ab7f9bf356`.
- `/api/health`, ASR `/healthz`, and TTS `/healthz` returned HTTP 200. The
  unauthenticated `/v1/models` boundary remained protected.

## Verification performed

- `pnpm test:amadeus`: 137/137 passed.
- `pnpm check:secrets`, `git diff --check`, focused parser/Combo/runtime-policy tests:
  passed.
- Effective-bundle diagnostic fixture: passed for valid image output,
  `image_result_missing`, `sse_incomplete`, `upstream_failed`, `safety_refusal`,
  `account_unavailable`, partial-image terminal failure,
  `transport_interrupted`, and boolean diagnostic fields.
- Reference contract: passed unchanged reference bytes/MIME, exact
  `502 → 502 → success` model order, and `x-amadeus-image-model` attribution.
- Effective fallback contract: passed native first-model selection and terminal
  safety refusal without local fallback.
- Exact compiled account-selector fixture: request-scoped 502 returned
  `{shouldFallback:true,cooldownMs:0}` and performed zero provider-state updates;
  genuine 429 with a future `resets_at` returned `cooldownMs:420000` and performed
  one native update.

## Real edit smoke and interpretation

The authorized OpenClaw-to-9Router 256×256 reference edit reached the live route.
One trace succeeded on `cx/gpt-image-2.5-sunburst` with
`imageResultSeen:true` and `cooldownDecision:none`. A later trace produced three
bounded `502/upstream_failed` attempts in the configured order
`sunburst → flare → gpt-image-2.5`, followed by one typed
`amadeus_image_upstream_failed` terminal envelope. The trace contained no legacy
Plus/Pro entitlement diagnosis. The active Codex row remained
`testStatus=active`, `errorCode=null`, `backoffLevel=0`, with no `lastError` and
null image model locks after the failed trace.

## Rollback

Restore only the compose file from the protected checkpoint, then recreate the
9Router service without rebuilding:

```sh
orb -m nyannyan -u root docker cp \
  /DATA/AppData/9router/backups/router-upgrade-20261009T130134Z/docker-compose.yml \
  /var/lib/casaos/apps/9router/docker-compose.yml
orb -m nyannyan -u root bash -lc \
  'cd /var/lib/casaos/apps/9router && docker compose up -d --no-build 9router'
```

The checkpointed `data.sqlite` is retained for investigation and must not be
blindly copied over the live database.
