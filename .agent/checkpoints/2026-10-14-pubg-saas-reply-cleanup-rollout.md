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

Deployment is pending in this checkpoint. Append the built immutable image,
post-switch container IDs, Worker health, KOOK connection state, protected
service identity check, and bounded startup log result after deployment.
