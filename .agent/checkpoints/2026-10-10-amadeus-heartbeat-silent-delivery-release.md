# Amadeus heartbeat silent delivery fix — 2026-10-10

## Deployment

- Operator request: prevent the internal heartbeat sentinel from reaching the owner private chat.
- Runtime source commit: `5085b3f`.
- Amadeus version: `1.10.2`.
- Guest: OrbStack machine `nyannyan`.
- Image: `local/openclaw-amadeus:git-5085b3fb0b3f-20261010010836`.
- Image manifest: `sha256:61649779f7d830db39ad2e58c180aaa0688bfad0855a007fef70d279bd0ee68a`.
- CasaOS checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261010010836`.
- External deployment evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261010010836/`.
- Product Radar was reused unchanged at `local/product-radar:git-d988000e1c5d-20260924130631`.

## Cause and fix

The heartbeat runner sends through OpenClaw's native durable sender with
ordinary outbound hooks suppressed. A shared main session could resolve its
last WhatsApp direct route, and a control-prefixed `NO_REPLY` was not
recognized by the upstream silent-token parser. The internal sentinel then
reached the WhatsApp sender.

The image now applies the pinned
`scripts/patch-openclaw-heartbeat-silence.mjs` patch to
`heartbeat-runner-CPy-qxAy.mjs`. The final native heartbeat boundary:

1. suppresses text-only `NO_REPLY` payloads;
2. suppresses `[[...]]`-prefixed `NO_REPLY` payloads; and
3. strips a leading control marker from a real heartbeat alert before sending.

Media-bearing payloads remain deliverable. The guard is independent of the
Amadeus typed WhatsApp boundary, so a future hook-order or native-route change
cannot re-enable this leak.

## Verification

- Heartbeat patch fixture and compiled syntax check: passed.
- Amadeus typecheck and 137 tests: passed.
- Architecture check and secrets scan: passed.
- Immutable image preflight: plugin readable, heartbeat marker present exactly once.
- Running container reports `Amadeus 1.10.2` and image manifest above.
- OpenClaw container: `running`, health `healthy`.
- Amadeus plugin registration: passed.
- Cron target verification: passed for both managed jobs.
- NAS SSH read-only smoke: passed.
- Owner notification and owner outbox smoke: passed.
- No heartbeat trajectory event or heartbeat-triggered send was observed after the switch. The two post-start WhatsApp sends corresponded to the release outbox event `amadeus-release:1.10.2` and the separate report-only log-policy warning `log-policy:post-deploy:1.10.2`; neither was a heartbeat reply.

## Rollback

The protected checkpoint contains the pre-switch Compose/config/runtime state.
Restore only the previous OpenClaw Compose/config files from that checkpoint,
then recreate the single CasaOS OpenClaw service with `docker compose up -d
--no-build`. Do not copy the checkpoint database over the live database unless
the rollback is explicitly extended to state recovery.
