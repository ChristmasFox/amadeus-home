# 2026-09-25 — 9Router app proxy disabled on M204

- User authorized disabling the 9Router application-layer outbound proxy after container-start HTTP(S)_PROXY parity was restored.
- Verified old Mac source-freeze artifact `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-source-freeze-20260923T111228Z/9router/9router-data.tar.gz`: SQLite + WAL `quick_check=ok`, settings `outboundProxyEnabled=false`; no URL/no-proxy fields. New M204 before change: enabled with configured URL/no-proxy.
- External rollback checkpoint `/DATA/AppData/9router/backups/app-proxy-off-20260925T045736Z`: protected consistent SQLite backup, Compose/env copy and immutable image metadata. Rollback the app settings through local authenticated API and restart; the protected DB snapshot is a last-resort restore, not an active fallback.
- Changed only via 9Router local CLI-token API PATCH: `outboundProxyEnabled=false`, `outboundProxyUrl=""`, `outboundNoProxy=""`. Restarted existing 9Router Compose service, no rebuild/no image or OpenClaw mutation.
- Post-restart `/api/health=200`, unauthenticated `/v1/models=401`, startup proxy env present. Real authenticated `arthur-combo` request returned 200 with one choice; network namespace observed only `0.250.250.254:7897` outbound. No TLS/proxy fallback in the 90-second sampled log.
- Do not infer that intermittent DNS/Clash failures or upstream proxy-failure direct fallback are fixed. Pending work remains `.agent/tasks/2026-09-25-9router-dns-proxy-failclosed.md`.
