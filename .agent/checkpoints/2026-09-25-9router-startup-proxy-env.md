# 2026-09-25 — M204 9Router startup proxy parity

- User explicitly requested restoring old Mac container-start proxy environment on M204.
- Old evidence: `/Volumes/Avalon/backups/operation-skuld/log-policy/20260922T120815Z/9router.before.yml` carries both cases of HTTP(S)_PROXY and NO_PROXY to `host.docker.internal:7897`.
- New source: `infra/docker/homelab/9router/docker-compose.example.yml`; M204 live: `/var/lib/casaos/apps/9router/docker-compose.yml` on OrbStack `nyannyan`.
- Preflight: `host.docker.internal:7897` resolved/reached from the live container; candidate `docker compose config --quiet` passed; ASR fixture and `pnpm check:secrets` passed.
- External rollback: `/DATA/AppData/9router/backups/proxy-env-20260925T043942Z` mode 0700, original Compose/candidate and SQLite API-consistent snapshot mode 0600. Restore the original Compose and run `docker compose up -d --no-build --no-deps 9router` to roll back; immutable image unchanged.
- Applied only Compose, no build or data rewrite. Post-recreate `/api/health=200`, unauthenticated `/v1/models=401`, six proxy environment keys verified, original image retained.
- Real `arthur-combo` chat completion first attempt timed out (25 s); 9Router logged `[ProxyFetch] Proxy failed, falling back to direct` and `ENOTFOUND chatgpt.com`. Network trace included `0.250.250.254:7897` and a direct public `:443` destination. Retry returned HTTP 200 with one choice in 1.8 s. This is intermittent, not resolved.
- Independent DNS observations: Tailscale resolver `100.100.100.100` gave inconsistent/wrong OpenAI address answers and later no answer, while HTTPS DoH via the host proxy gave Cloudflare IPs. This does not prove whether Tailscale or its upstream/system DNS is causal.
- No TLS verification bypass, no Tailscale or Clash mutation, no second runtime or public 9Router ingress.
