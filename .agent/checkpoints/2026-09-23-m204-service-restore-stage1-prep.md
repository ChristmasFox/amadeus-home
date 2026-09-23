# M204 non-Avalon service restore — stage 1 preparation

Date: 2026-09-23 (Asia/Shanghai)
Status: complete source checkpoint; Filebrowser/Xiaoya target restore pending

## Source and backup evidence

- Canonical source remains the existing OrbStack `ubuntu` CasaOS. M204 is not cut over and remains non-authoritative.
- Latest complete backup: `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-20260923T045305Z`.
- Manifest records 16 MIGRATE services, each `verify=passed`; all entries in `checksums.sha256` verified with `shasum -a 256 -c`.
- Xiaoya archive includes `xiaoyaliu/alist:latest` with image ID `sha256:98311280eab2399d80cc5d5b57aee4fdca422a0152a7384aafde7b72b3fbedc6`, `/home/blacksidev/xiaoya` bind data and `/opt/alist/data` volume data.
- Filebrowser archive includes AppData plus both image-declared volumes, `/database` and `/config`; the restore map and both tar archives are present and checksummed.
- An earlier backup attempt at `20260923T044715Z` omitted the `/config` archive because an OrbStack child command consumed the volume loop's stdin. It is incomplete and not a restore source. The loop now reads from a dedicated FD, the archive command receives `/dev/null`, and the fixture test simulates stdin consumption and requires both volume artifacts.
- Source checks still show Avalon media/download services as external references only. No media data was copied into this backup.

## Target state and safety boundaries

- After the user's OS-update recovery, M204 host `Amadeus-M204` has its canonical OrbStack `nyannyan` Ubuntu guest running; Docker/CasaOS are available.
- The target currently has Changedetection (`ghcr.io/dgtlmoon/changedetection.io:0.60.3`, healthy, no host port) and 9Router (`local/9router:0.5.81`, bound only to `127.0.0.1:20128`). No other business container has been started in this stage.
- Changedetection's source instance remains active; the target copy is only staged and temporarily polls in parallel. No user-facing ingress was changed.
- The 9Router source and target both return HTTP 200 from unauthenticated `/v1/models`, despite the historical expected-401 contract. Keep target loopback-only pending contract reconciliation.
- `/Volumes/Avalon` is absent on M204. Do not start services with direct Avalon binds; preserve the same path in their tracked definitions until the target disk is physically attached and UUID/sentinel/storage preflight passes.
- OpenClaw/Product Radar remain gated by the single-runtime/cutover boundary. frpc/Nginx Proxy Manager remain gated by ingress cutover. v2raya's host-network effects need separate review.
- Source-controlled Filebrowser and Xiaoya compose templates default to guest loopback. Filebrowser retains its existing writable `/DATA` view, so never expose it beyond local access without a separate security decision. Xiaoya data archives contain no literal `/Volumes/Avalon` path; actual Alist storage behavior remains unverified.

## Validation

- `bash scripts/test-full-homelab-backup.sh`: pass, including stdin-consumption regression.
- `pnpm test:migration-blockers`: pass (25/25); `pnpm check:secrets`, `git diff --check`, shell syntax, and both new Compose `config --quiet` checks: pass.
- `pnpm check:secrets`, `git diff --check`, shell syntax, and both new Compose `config --format json` checks: pass.
- `pnpm workflow:verify` reaches the architecture check but fails on three pre-existing references in unmodified `scripts/plan-destination-bootstrap.sh`, `scripts/plan-skuld-rollback.sh`, and `scripts/test-skuld-preparation-tooling.sh`; not changed as part of this task.

## Resume

Commit/push the tracked source, fast-forward the M204 clone, then restore and locally verify Filebrowser and Xiaoya from this checkpoint's exact artifacts. Keep both loopback-only, preserve the source runtime, and write the next checkpoint after their runtime verification.
