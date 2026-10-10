# 9Router bounded upstream diagnostic headers — 2026-10-10

## Deployment

- Operator approval: explicit `Apply`.
- Runtime source commit: `83bb76b5e7c8`.
- Guest: OrbStack machine `nyannyan`.
- New image: `local/9router:git-83bb76b5e7c8-20261010T032550Z`.
- Image manifest digest: `sha256:828a0c7b2c54e169c8ec4a0219f764c1ca2024efb04a79afb5db2f95a269be9a`.
- Protected CasaOS checkpoint: `/DATA/AppData/9router/backups/router-upgrade-20261010T032550Z`.
- Pre-switch image export: `/Volumes/Avalon/backups/operation-skuld/9router/9router-git-ed872b3f3978-20261010T032554Z.tar.gz`.
- Pre-switch export SHA-256: `d107f99eb95b3e09a2b09a8f5f8e4b1a608a655057225a9735c8449403d03be9`.
- Only 9Router was recreated. OpenClaw remained on its existing image.

## Change

The source-managed 0.5.95 Codex image route now returns bounded diagnostic
headers for typed SSE failures: event, error type, error code and reason. The
Combo patch copies only those allowlisted tokens into the structured attempt
summary. Prompt text, image bytes, response bodies, credentials and cookies
remain excluded.

The three-model order remains `sunburst -> flare -> gpt-image-2.5`. Request-
scoped 502 failures keep `cooldownDecision=none` and continue to the next
model. A confirmed safety refusal remains terminal.

## Evidence

- Effective CLI route marker: `9ROUTER_IMAGE_UPSTREAM_DIAGNOSTICS=verified`.
- Effective Combo marker: `9ROUTER_IMAGE_COMBO_SAFETY=verified`.
- Diagnostic fixture passed, including exact synthetic headers for
  `response.failed/server_error/server_overloaded/provider_busy`.
- Reference preservation fixture passed: unchanged bytes/MIME and the native
  `sunburst -> flare -> gpt-image-2.5` order.
- Fallback fixture passed: native primary selection and terminal safety refusal.
- Authorized real prompt-only image smoke passed with a PNG response. The live
  trace showed `sunburst` 502 followed by successful `flare`; no provider state
  lock was written for the request-scoped failure.
- 9Router health, runtime policy and isolated ASR/TTS checks passed.

The real smoke did not expose typed upstream fields because that 502 response
contained no allowlisted event/type/code/reason fields. The new path is covered
by the synthetic response-header fixture; a future naturally occurring typed
provider failure will populate those fields in the live log.

The separate screenshot showing “Selected model is at capacity” was from the
Codex development task UI, not WhatsApp or 9Router, and is not deployment
evidence for the image provider.

## Rollback

Restore only the compose file from the protected checkpoint and recreate the
9Router service without rebuilding:

```sh
orb -m nyannyan -u root docker cp \
  /DATA/AppData/9router/backups/router-upgrade-20261010T032550Z/docker-compose.yml \
  /var/lib/casaos/apps/9router/docker-compose.yml
orb -m nyannyan -u root bash -lc \
  'cd /var/lib/casaos/apps/9router && docker compose up -d --no-build 9router'
```

The checkpointed SQLite copy is retained for investigation and must not be
blindly copied over the live database.
