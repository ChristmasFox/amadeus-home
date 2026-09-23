# Operation Skuld — Mac mini migration runbook

Status: readiness and rehearsal only. This document is tracked so a future
cutover is an execution task with an explicit checkpoint. Amadeus 1.4.4 does
not perform this cutover, change DNS, rotate channels, or stop the current
CasaOS runtime.

## Phase 0 — Freeze and checkpoint

1. Confirm the implementation and deployment-evidence commits are pushed.
2. Run `scripts/migration-readiness.sh` on the current control Mac and save its
   output with the release evidence.
3. Create the service-aware data backup with `scripts/backup.sh`. Export
   credentials separately with `scripts/export-skuld-secrets.sh --apply
   --passphrase-file PATH`; the encrypted artifact, not a plaintext tar, is the
   boundary. Verify both manifests and keep the secret bundle separate from Git.
4. Record the current OpenClaw and Product Radar image tags, CasaOS compose
   files, FashionSigLIP health, cron list, and the owner outbox count.

The freeze boundary is the last successful readiness result. New owner
outbox entries or database writes after that boundary must either be replayed
to the destination or cause the cutover to stop.

## Phase 1 — Prepare the destination Mac

**Destination identity (Amadeus-M204 / nyannyan)**:

- Mac hostname: `Amadeus-M204`; macOS user: `nyannyan`; macOS home: `/Users/nyannyan`
- OrbStack machine: `nyannyan` (NOT `ubuntu` — that is the source machine)
- Linux user: `nyannyan`; Linux home: `/home/nyannyan`
- Ubuntu release: `Ubuntu 24.04 LTS / noble`
- Strategy: clean OrbStack Ubuntu guest (`scripts/plan-clean-orbstack-guest.sh`)
- No `/Users/blacksidev` or `/home/blacksidev` paths are active destination dependencies

**Preparation steps**:

1. Run the destination bootstrap plan: `scripts/plan-destination-bootstrap.sh`
2. Install the tracked dependencies with `scripts/bootstrap.sh --check`.
3. Copy the local, non-secret `infra/host-profile.env` override and set
   `ORBSTACK_MACHINE=nyannyan`, `MAC_CONTROL_USER=nyannyan`, and other profile keys.
4. Restore secret files out-of-band with mode `0600`; never copy their values
   into this repository or a terminal transcript.
5. Run `scripts/install-fashion-siglip-macos.sh --apply` and wait for health
   to report `status=ok` and `device=mps`. The model cache may be downloaded
   again; it is not a migration blocker.

**Clean guest creation**: see `scripts/plan-clean-orbstack-guest.sh` for the full plan.
Do NOT import or export the source OrbStack machine (`ubuntu`) as the destination strategy.

## Phase 2 — Restore and validate data

Restore in manifest order: workspace/config metadata, identity SQLite, PUBG
SQLite, Product Radar SQLite, owner outbox, and VPS usage state. For every
SQLite file run a read-only `PRAGMA integrity_check`; compare the recorded
checksums and row/table counts with the external backup manifest. Validate
pending and sent owner events without sending them.

## Phase 3 — Rebuild and preflight

1. Build immutable OpenClaw and Product Radar images from the pushed commit.
2. Create `amadeus_network`, attach only the active compatibility services,
   and render both CasaOS compose files.
3. Run OpenClaw config validation, plugin/Skill preflight, architecture and
   secret scans, then run `scripts/doctor.sh` with FashionSigLIP required.
4. Exercise no-delivery smoke cases: a worldline policy mapping, a Product
   Radar structured event, a PUBG structured report, and an idempotent owner
   outbox enqueue in a temporary directory.

## Phase 4 — Shadow-free cutover window

This is the only phase that would change routing, and it is deliberately not
executed by the 1.4.4 Goal. At the approved window, pause inbound traffic at
the chosen edge, drain or explicitly account for the owner outbox, stop the
old CasaOS app only after the destination preflight is green, and start the
destination with `docker compose up -d --no-build`. Do not run two agent
runtimes or a shadow notification path.

## Phase 5 — Validate and reopen

Verify health, plugin tools, cron definitions, Product Radar sensor access,
FashionSigLIP MPS health, read-only NAS/VPS probes, SQLite integrity, and the
owner outbox contract. Reopen inbound traffic only after the checks are
recorded. A real user-facing inbound/outbound test requires an explicit,
separately approved test message; health or a mock is not delivery evidence.

## Rollback — 时间跳跃

Trigger rollback when destination health is not stable, a database checksum or
row-count comparison is wrong, identity resolution differs, a required secret
cannot be validated, owner outbox idempotency is broken, or any inbound event
is observed by both runtimes.

1. Pause destination ingress and stop the destination runtime.
2. Preserve destination logs, outbox, and a timestamped checkpoint. Do not
   overwrite the current host data.
3. Reactivate the last known-good CasaOS compose and immutable images from the
   pre-cutover checkpoint; restore only files proven unchanged or replay the
   destination outbox with its original event keys.
4. Re-run health, integrity, and routing checks from a new session before
   reopening ingress.

Rollback is no longer automatically safe after new writes have been accepted
by both hosts, after secrets have been rotated without a reverse copy, or
after external routing has been changed without a recorded reverse route.
Stop and perform a data-divergence review instead of guessing.

## Explicit non-actions for 1.4.4

## Explicit non-actions for 1.4.6

- No SSH to or mutation of Amadeus-M204 destination.
- No freeze of source (old Mac) runtime.
- No enabling of second OpenClaw owner-channel runtime.
- No Avalon unmounting or cutover.
- Same constraints as 1.4.4 above.

- No Mac mini provisioning or cutover.
- No DNS, tunnel, WhatsApp pairing, Telegram allowlist, or VPS firewall change.
- No deletion of the old CasaOS app data or old compatibility network.
- No reintroduction of LangBot, n8n, n8n-sandbox, or a second runtime.
## Phase 2A — Service-aware restore contract (Amadeus 1.4.5)

This phase is a restore rehearsal contract only. It does not execute the Mac mini cutover in the 1.4.5 hardening goal. Restore only from Git-tracked source, the verified Avalon external artifacts, and the encrypted secret bundle.

### Critical persistent data
- `pubg-sqlite` — restore `/DATA/AppData/openclaw/data/pubg.sqlite` using `sqlite-integrity-check` before service start; restore order `30`.
- `identity-sqlite` — restore `/DATA/AppData/openclaw/data/identity.sqlite` using `sqlite-integrity-check` before service start; restore order `20`.
- `product-radar-sqlite` — restore `/DATA/AppData/product-radar/product-radar.sqlite` using `sqlite-integrity-check` before service start; restore order `40`.
- `owner-outbox` — restore `/DATA/AppData/openclaw/notifications` using `json-contract-and-idempotency-check` before service start; restore order `50`.
- `vps-usage-state` — restore `/DATA/AppData/openclaw/data/vps-usage-state.json` using `json-parse` before service start; restore order `60`.
- `openclaw-workspace` — restore `/DATA/AppData/openclaw/workspace` using `tracked-file-diff` before service start; restore order `10`.
- `9router-provider-state` — restore `/DATA/AppData/9router/data` using `protected-directory-and-exact-image` before service start; restore order `15`.
- `immich-postgres` — restore `/DATA/AppData/immich/pgdata` using `fresh-pg-dump-and-vector-extension-check` before service start; restore order `25`.
- `immich-external-media` — restore `host-profile:IMMICH_MEDIA_ROOT` using `external-identity-and-file-equivalence;not-tar-archived` before service start; restore order `26`.
- `changedetection-datastore` — restore `/DATA/AppData/changedetection/datastore` using `protected-datastore` before service start; restore order `35`.
- `media-adapter-state` — restore `/DATA/AppData/media-organizer-adapter` using `registered-service-state` before service start; restore order `45`.

### Secret restore targets (metadata only)
Decrypt the bundle into a private `0700` staging directory, validate file modes and logical IDs, then place values out-of-band into the target. Never print values.
- `openclaw-env` — target `/DATA/AppData/openclaw/openclaw.env`, required `true`, mode `0600`.
- `whatsapp-runtime-state` — restore the protected `/DATA/AppData/openclaw/config/credentials` subtree from the encrypted bundle before OpenClaw starts; manifest filenames are opaque hashes.
- `pubg-api-key` — target `/DATA/AppData/openclaw/secrets/pubg-api-key`, required `true`, mode `0600`.
- `pubg-team` — target `/DATA/AppData/openclaw/secrets/pubg-team.json`, required `true`, mode `0600`.
- `telegram-bot-token` — target `/DATA/AppData/openclaw/secrets/telegram-bot-token`, required `true`, mode `0600`.
- `owner-target` — target `/DATA/AppData/openclaw/secrets/owner-whatsapp-target`, required `true`, mode `0600`.
- `mac-ssh-key` — target `/DATA/AppData/openclaw/secrets/mac-ssh-key`, required `true`, mode `0600`.
- `vps-readonly-key` — target `/DATA/AppData/openclaw/secrets/vps-readonly-ssh-key`, required `true`, mode `0600`.
- `vps-known-hosts` — target `/DATA/AppData/openclaw/secrets/vps-ssh-known-hosts`, required `true`, mode `0600`.
- `kiwivm-credentials` — target `/DATA/AppData/openclaw/secrets/kiwivm-credentials.json`, required `true`, mode `0600`.
- `kook-token` — target `/DATA/AppData/openclaw/secrets/kook-bot-token`, required `true`, mode `0600`.

### Runtime service restore steps
- `openclaw` — classify as `ACTIVE` and restore/verify its declared health boundary before reopening traffic.
- `product-radar` — classify as `ACTIVE` and restore/verify its declared health boundary before reopening traffic.
- `media-adapter` — classify as `ACTIVE` and restore/verify its declared health boundary before reopening traffic.
- `changedetection` — classify as `COMPATIBILITY` and restore/verify its declared health boundary before reopening traffic.
- `fashion-siglip` — classify as `ACTIVE` and restore/verify its declared health boundary before reopening traffic.
- `9router` — classify as `ACTIVE` and restore/verify its declared health boundary before reopening traffic.
- `immich-server` — classify as `ACTIVE / external media` and restore/verify its declared health boundary before reopening traffic.
- `immich-machine-learning` — classify as `ACTIVE / rebuildable cache` and restore/verify its declared health boundary before reopening traffic.
- `immich-postgres` — classify as `ACTIVE / protected internal DB` and restore/verify its declared health boundary before reopening traffic.
- `immich-redis` — classify as `ACTIVE / rebuildable state` and restore/verify its declared health boundary before reopening traffic.
- `openclaw-crons` — classify as `ACTIVE` and restore/verify its declared health boundary before reopening traffic.

### HomeLab classified services
Use the classification table in `docs/OPERATION_SKULD_SERVICE_INVENTORY.md`; no active service may remain a vague manual restore path.
- `openclaw` — `MIGRATE`; backup `service-aware-backup plus encrypted secret bundle`; restore `restore workspace/config, SQLite snapshots, outbox, then start CasaOS compose`; verify `healthz, SQLite integrity, outbox contract, cron list`.
- `product-radar` — `MIGRATE`; backup `SQLite consistent snapshot plus encrypted runtime env`; restore `restore snapshot/env then start compose`; verify `health endpoint, SQLite integrity, owner outbox contract`.
- `9router` — `MIGRATE`; backup `protected data archive plus exact docker save artifact`; restore `docker load exact image, restore env/data, isolated dashboard/auth test`; verify `dashboard 200, unauthenticated models 401, fixture-auth boundary`.
- `immich` — `MIGRATE`; backup `fresh pg_dump -Fc plus external media identity/equivalence`; restore `logical pg_restore, attach Avalon media, verify UUID/sentinel/health`; verify `pg_restore --list, Immich health, media equivalence; source retained`.
- `changedetection` — `MIGRATE`; backup `protected datastore archive`; restore `restore datastore before container start`; verify `HTTP health and datastore presence`.
- `media-organizer-adapter` — `MIGRATE`; backup `registered service-state archive`; restore `restore state and reconnect Avalon/download/media mounts`; verify `healthz and dry-run organize contract`.
- `frpc` — `MIGRATE`; backup `sanitized config backup plus encrypted credential bundle`; restore `restore config/secret and start CasaOS compose`; verify `systemd/container running and tunnel status`.
- `xiaoya` — `MIGRATE`; backup `explicit host-directory archive`; restore `restore exact host directories before container start`; verify `HTTP health and mounted data read`.
- `homarr` — `REBUILD`; backup `compose/config declaration; data is disposable dashboard state`; restore `recreate pinned compose and restore optional dashboard data`; verify `HTTP health`.
- `emby` — `MIGRATE`; backup `config directory archive plus external media reference`; restore `restore config, attach media, recreate compose`; verify `health endpoint and library scan boundary`.
- `qbittorrent` — `MIGRATE`; backup `config directory archive plus external downloads reference`; restore `restore config, attach downloads, recreate compose`; verify `web health and download path read/write`.
- `nginxproxymanager` — `MIGRATE`; backup `database/certificate state archive`; restore `restore data and certificates before proxy start`; verify `proxy health and TLS certificate inventory`.
- `filebrowser` — `MIGRATE`; backup `explicit named-volume export plus /DATA/AppData/db archive`; restore `restore named volumes/data before start`; verify `health endpoint and authenticated boundary`.
- `ariang` — `REBUILD`; backup `pinned compose declaration`; restore `recreate image; no persistent state`; verify `HTTP health`.
- `aria2` — `MIGRATE`; backup `config archive plus external downloads reference`; restore `restore config/secret and attach downloads`; verify `RPC auth boundary and path read`.
- `jellyfin` — `MIGRATE`; backup `config archive plus external media reference`; restore `restore config/cache policy and attach media`; verify `health endpoint and library path read`.
- `alist` — `MIGRATE`; backup `data directory archive plus external storage reference`; restore `restore data and attach Avalon`; verify `health and storage mount read`.
- `v2raya` — `MIGRATE`; backup `state directory archive`; restore `restore state before container start`; verify `HTTP health and config parse`.
- `xiaoyakeeper` — `REBUILD`; backup `pinned compose declaration`; restore `recreate with Docker socket boundary review`; verify `container running; no persistent data`.
- `dashdot` — `REBUILD`; backup `pinned compose declaration`; restore `recreate read-only host metrics service`; verify `HTTP health`.
- `fashion-siglip` — `REBUILD`; backup `installer/source tracked; model cache redownload policy`; restore `run macOS installer and redownload model`; verify `LaunchAgent and MPS health`.

### 9Router isolated restore rehearsal
Load the exact image artifact, restore env/data into an isolated project/network, start without production provider credentials, check `/dashboard` returns 200, check unauthenticated `/v1/models` returns 401, and use only fixture authentication for the authenticated boundary.

### Immich restore and reclaim boundary
Restore the latest `immich-postgres` logical dump with `pg_restore`; attach Avalon, verify UUID and sentinel, verify live media root and health, and keep `/DATA/Gallery/immich` retained. Source reclaim remains pending until the separate fresh one-way checksum gate and explicit approval token pass.

### Completion boundary
This runbook describes the future destination procedure. `Mac mini cutover: NOT EXECUTED` and `Immich source reclaim: PENDING` remain mandatory 1.4.5 evidence.
