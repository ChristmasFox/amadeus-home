# Isolated PUBG SaaS 9Router connection attempt

Date: 2026-10-14 (Asia/Shanghai)

## Source and build

Commit `87de87d06a4ed3c9b8df4dab26a2d1c3947efabe` adds an exact
`MODEL_ALLOWED_INTERNAL_HOSTS` authority allowlist, permits HTTP only for a
listed authority, and routes only an exact listed model request around the
public egress proxy. All other model destinations continue through the proxy.
Focused tests cover the allowed authority, malformed allowlists, loopback and
other private-address rejection, lookalike hostnames, proxy routing, and
redirect rejection.

Evidence before deployment:

- `pnpm --filter @agent/pubg-saas exec tsx --test tests/model-config.test.ts` —
  7 passed.
- `pnpm --filter @agent/pubg-saas typecheck` — passed.
- `pnpm check:secrets` and `git diff --check` — passed.
- M204 local ARM64 image: `local/pubg-saas:git-87de87d06a4ed3c9b8df4dab26a2d1c3947efabe`,
  image ID `sha256:b4ac246a14797e058a82a7d4c4cf035880035b86735b369793e718684a51aa33`.
  No push occurred.

## Isolated runtime change

Target: OrbStack VM `pubg-saas-m2-clean`; Compose project `pubg-saas-public`;
stack path `/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas`.
The protected ignored `secrets/gateway.env` was atomically updated from the
single active row in `/srv/pubg-saas-9router/data/db/data.sqlite` table
`apiKeys`. The file is mode 0600. Values are intentionally omitted. The
configured model endpoint is `http://9router:20128/v1`, model ID `arthur-combo`,
and the allowlist is exactly `9router:20128`.

The command targeted `gateway worker` with `--force-recreate --wait`. Compose
also recreated `egress-proxy` because every SaaS service references the updated
shared image tag. This was not intended; PostgreSQL and `pubg-saas-9router`
were not recreated. The post-change status was:

- PostgreSQL: healthy; container ID unchanged.
- egress-proxy: healthy; recreated as a dependency on the new image.
- Worker: healthy on the new image.
- Gateway: running on the new image; Compose defines no Docker healthcheck.
- 9Router: running; Compose defines no Docker healthcheck.
- Gateway session row: one session present, updated after the new Gateway
  container start, confirming the KOOK WebSocket reconnected.
- Secret file and Compose `.env`: mode 0600; model API key was never printed.

The public model planner was invoked once with a synthetic, non-user query and
no retry. Result summary only: `source=fallback`,
`failure=provider_error`, `requestCount=1`. The isolated 9Router recorded that
request at `/v1/chat/completions` with upstream status `ok`; the SaaS planner
did not accept the result. No further model request was made. The current
hypothesis is incompatibility in streaming or structured-output response
handling; this is not confirmed and remains the blocker for model acceptance.

No private OpenClaw or private 9Router credential/service was touched. No image
was pushed. Work is paused at this failed acceptance point pending Arthur's
next direction.
