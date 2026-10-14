# PUBG SaaS KOOK reply cleanup rollout — 2026-10-14

## Scope

Arthur authorized removing internal assistant-response scaffolding from public
KOOK replies, full requested validation, push to `origin/main`, and replacement
of only Gateway and Worker on OrbStack VM `pubg-saas-m2-clean`. PostgreSQL,
egress-proxy, SaaS 9Router, the `nyannyan` VM, private Kurisu/OpenClaw and
private 9Router are outside this change.

## Source and validation

Source commit `ef81896` is pushed to `origin/main`. Conversation prompts no
longer use bracketed reply labels, the public assistant prompt says not to
repeat context scaffolding, and assistant history is sanitized before reuse.
The shared outbound queue sanitizes reply bodies before persistence and claim;
the KOOK HTTP client sanitizes once more at the final send boundary. Cleanup
removes leading internal speaker/reply labels, known internal JSON/tool/debug
artifacts, and preserves ordinary prose and KOOK mention markup.

The 12:55 UTC incident was traced to `PublicQueryAuthorizer.loadAgentConversation`
prefixing assistant history with `[回复成员N]`; the model echoed it and the
reply was persisted without cleanup. `message_outbox.payload_json={}` is the
existing successful-send privacy scrub in `KookMessageQueue.markSent`, not an
empty sent body. The delivered, sanitized transcript remains for 12 hours,
linked by source event and the remote KOOK message ID returned by the sender.

Validation passed:

- `pnpm test:pubg-saas`: 141/141 with the reused isolated PostgreSQL 18 fixture.
- `pnpm test:pubg`: 70/70 across Identity, Presentation, Domain and PUBG plugin.
- `pnpm typecheck:pubg`, `pnpm typecheck:pubg-saas`, `pnpm build:pubg`,
  `pnpm build:pubg-saas`, `pnpm check:architecture`,
  `pnpm test:architecture`, `pnpm check:secrets` and `git diff --check` passed.
- Focused PG ingress/outbox and KOOK sender tests passed 10/10.

## Pre-switch rollback point

Before the authorized replacement, `pubg-saas-m2-clean` ran
`local/pubg-saas:git-3c51d4b6c0b55a15ba4ec39bd391d28aac21f98d`.
Gateway `4eb208072980` and Worker `a96544a59005` were on that image; Worker
was healthy and both had zero restarts. PostgreSQL `e47fd49fcab5`,
egress-proxy `c5cd33cba219`, and SaaS 9Router `2ce598008143` were running and
must remain untouched. Live stack directory:
`/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas`.

The target-side protected pre-switch record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-ef81896-pre-switch.txt`
with mode `0600`. It records the prior image and container IDs. To roll back,
restore the recorded image into `PUBG_SAAS_IMAGE` in the protected stack `.env`,
keep mode `0600`, validate Compose config, then recreate only Gateway and Worker
with `docker compose ... up -d --no-deps --force-recreate --no-build --wait
gateway worker`.

## Deployment result

The pushed source archive for commit `ef81896a1c85a22afaf8c533e0d95929b425962f`
was built on `pubg-saas-m2-clean` for `linux/arm64` and loaded locally:

- Tag: `local/pubg-saas:git-ef81896a1c85a22afaf8c533e0d95929b425962f`
- Image ID: `sha256:fe49c38fb9183882b68058b8b4d0fab90b0f6f111c317b682c03bffee9d9018f`
- Compose project: `pubg-saas-public`
- Stack `.env` retained mode `0600`; only `PUBG_SAAS_IMAGE` changed.
- Only Gateway and Worker were recreated with `--no-deps --force-recreate
  --no-build --wait`.

| Component | Before | After | Result |
| --- | --- | --- | --- |
| Gateway | `4eb208072980` | `5a02654f9dcd` | Running, zero restarts |
| Worker | `a96544a59005` | `6afb2788ef31` | Healthy, zero restarts |
| PostgreSQL | `e47fd49fcab5` | unchanged | Healthy |
| egress-proxy | `c5cd33cba219` | unchanged | Healthy |
| SaaS 9Router | `2ce598008143` | unchanged | Running |

The read-only PostgreSQL session probe returned `connected=true`,
`last_sn=59`, updated at `2026-10-14T14:13:30.421144Z`. Gateway and Worker
each had zero error-level log matches in the 10-minute verification window.
The two structured Worker cycle records reported zero queue snapshot errors,
zero team failures and no alert codes. No model call, PUBG API call, migration,
database container change, private runtime change, or human KOOK event was
performed for deployment verification.

The protected pre-switch rollback record is
`/var/tmp/pubg-saas-m2-clean/checkpoints/20261014-pubg-saas-ef81896-pre-switch.txt`
with mode `0600`. To roll back, restore its `PREVIOUS_IMAGE` value to
`PUBG_SAAS_IMAGE` in the protected stack `.env`, keep mode `0600`, validate
Compose config, then recreate only Gateway and Worker with
`docker compose ... up -d --no-deps --force-recreate --no-build --wait gateway
worker`.

Arthur's live KOOK retest of the 12:55 `昨日队内误伤统计` response remains
pending. M2 is not complete until Arthur validates the real conversation.
