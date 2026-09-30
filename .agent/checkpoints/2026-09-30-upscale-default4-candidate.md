# Default 4x on-demand upscale candidate apply

Date: 2026-09-30 Asia/Shanghai. Source commit
`9221fce0a519f7daa66b53091c71a40a16dfec46`.

Operator changed the unspecified multiplier default from 2x to 4x. Explicit
2x is preserved. 2K/4K remain independent long-edge resolution profiles;
output-pixel limits reject excessive 4x jobs instead of silently using 2x.
The native tool constrains ordinary inbound requests to 4x even when the
Agent proposes 2x, while an unambiguous explicit inbound 2x wins. The host
service, manual CLI, Skill and source documentation agree.

Validation: host Python service tests (8), Amadeus plugin tests (75),
affected plugin typecheck/build, shell syntax, focused end-to-end typed
attachment/provider tests, diff check and secrets scan passed. A protected
host checkpoint contains the previous installed service.py and launchd
plist plus a consistent SQLite registry copy (0700 directory, 0600 files):
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-image-default4-20260930T210638`.
The managed install copied the new service, then its immediate launchctl
bootstrap briefly returned I/O error (exit 5). A subsequent managed
`--apply start` succeeded; the service is now healthy/engine ready, and the
installed service.py matches committed source. Asset files were not modified
by installation.

The single CasaOS OpenClaw candidate was built/applied from the same source:
`local/openclaw-amadeus:git-9221fce0a519-20260930130737`. Protected
OpenClaw checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930130737`.
Private post-deploy evidence:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930130737`.
The real Gateway registered Amadeus, and health/NAS/owner outbox smokes passed.
Product Radar and 9Router were not rebuilt. No version bump or release.

A real owner request **without a multiplier** is needed to prove 4x from
inbound/tool through host registry and document settlement. An explicit 2x
request and recipient-downloaded SHA-256 remain real acceptance checks.
DeliveryEnvelope Goal Gates A-F are still open where not proven.
