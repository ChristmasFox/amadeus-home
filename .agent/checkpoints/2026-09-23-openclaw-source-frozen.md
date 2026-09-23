# Amadeus 1.4.8 — Phase 7 source freeze complete

Date: 2026-09-23
Goal: `docs/AMADEUS_1_4_8_OPERATION_SKULD_FINAL_CUTOVER_AND_MEMORY_CONTINUITY_GOAL.md`
Source-freeze approval: received from the user (Phase 7 only).

## Required state

```text
SOURCE_FROZEN=YES
SOURCE_OPENCLAW_STOPPED=YES
SOURCE_OWNER_INGRESS=OFF
DESTINATION_AUTHORITY=NO
SAFE_TO_MOVE_AVALON=yes
```

Phase 7 is complete. Phase 8 is not authorized yet: do not unmount Avalon or start destination consumers until the separate `APPROVE_AVALON_MOVE_1_4_8` approval is supplied.

Post-freeze host audit: the Amadeus CasaOS `openclaw` container remains stopped. A separate macOS LaunchAgent named `ai.openclaw.gateway` is running in local mode with loopback binding (`127.0.0.1:18789`); its config has only the iMessage channel enabled. It uses the host-local `~/.openclaw` config, not the CasaOS `/DATA/AppData/openclaw` state, and was not stopped because its relationship to this migration's production authority is unestablished. The exact production-runtime scope must be rechecked before destination OpenClaw startup; this finding does not authorize unmounting Avalon.

## Final OpenClaw continuity artifacts

- Final encrypted secret bundle: `/Volumes/Avalon/backups/operation-skuld/secrets-20260923T112416Z/secrets.tar.enc`
- Secret manifest: `/Volumes/Avalon/backups/operation-skuld/secrets-20260923T112416Z/secrets.manifest.json`
- Secret bundle SHA-256: `f7cf09f6f4b5c093b77e25fd3b1913983dff48419daadfc8922ddc9e8a7e9378`
- Authentication, full import/decrypt metadata validation, and restore dry-run: passed.
- Final cold snapshot: `/Volumes/Avalon/backups/operation-skuld/openclaw-cold/openclaw-cold-20260923T112531Z.tar.gz.enc`
- Snapshot manifest: `/Volumes/Avalon/backups/operation-skuld/openclaw-cold/openclaw-cold-20260923T112531Z.manifest.json`
- Snapshot SHA-256: `367ffc43f53ec9dfda96b1f14caacf944c7994b1f356aa8e5f4f93d12f3d6e36`
- The snapshot was verified during creation and by the standalone verifier. It binds to secret bundle `f7cf09f6…e9378` and Git commit `54a760471c5576dc61df2ee669b6280ea937b43b`.
- Captured workspace: 155 files / 20,172,403 bytes; `MEMORY.md` SHA-256 `9a31ea1e0762065463066600aec74ea56502a95101e488338b29cfc8085bfbd8`.
- Captured OpenClaw state: 4,888 files / 235,858,460 bytes; 84 session/JSONL files and 6 transcript files. Required identity and PUBG SQLite databases report `integrity=ok`; the snapshot's discovered SQLite set passed.
- Credential continuity: 855 files / 322,588 bytes. The stopped source guest's `find` count, two bundle exports made after OpenClaw was stopped, and the final cold manifest all agree on the same 855 path/size/mode fingerprints. An earlier live inventory recorded 856 files; the reason for that earlier one-file count difference is unknown, but no mismatch exists among the two exports and the final source snapshot. Earlier artifacts remain available as recovery references; nothing was deleted.

### 2026-09-23 session metric audit correction

The 84 session/JSONL and 6 transcript values above were derived using arbitrary path-substring matching and are invalid. The encrypted archive and authenticated workspace/state/credential evidence remain intact; only these derived counters are superseded. The OpenClaw primary session/transcript data is SQLite-backed and was not measured by those numbers. See `.agent/checkpoints/2026-09-23-kurisu-recall-audit.md` for corrected destination SQLite counts and operator recall evidence.

## Final HomeLab backup

- Backup directory: `/Volumes/Avalon/backups/operation-skuld/full-homelab-backup-source-freeze-20260923T111228Z`
- Manifest: `full-homelab-manifest.json` — all 16 MIGRATE services passed; 38 artifacts recorded.
- `checksums.sha256`: all 22 entries independently verified.
- Immich PostgreSQL logical dump was created with `pg_dump -Fc` and its restore list passed. Avalon media/download bulk data remains `external-reference-only` and is carried by the physical Avalon disk, not copied into this backup.
- qBittorrent's transient `config/qBittorrent/ipc-socket` was reported by tar as a socket and not archived; the service config artifact and checksum passed. No other backup failure was reported.

## Source and destination runtime state

Stopped on the source: OpenClaw, Product Radar, 9Router, Changedetection, Immich server/ML/Redis/PostgreSQL, media-organizer-adapter, Emby, qBittorrent, aria2, Jellyfin, Alist, Xiaoya, Homarr, and xiaoyakeeper. Homarr/xiaoyakeeper were stopped first because they have writable Docker-socket access and could restart consumers.

No active source container has an Avalon bind. Remaining source containers are the non-Avalon AriaNG, Dashdot, Filebrowser, frpc, Nginx Proxy Manager, and v2raya. Public tunnel/proxy configuration was not changed; those services remain behind the later ingress/cutover approval boundary. Source restart policies were not edited.

M204 still has only the six previously staged loopback/no-host-port services (9Router, AriaNG, Changedetection, Dashdot, Filebrowser, Xiaoya). Destination OpenClaw and Product Radar are absent. M204 host and guest both report Avalon unmounted. Therefore destination authority remains `NO`.

Source Avalon remains mounted at `/Volumes/Avalon`, APFS, UUID `0C2CC618-D273-470C-8036-9AD6A0D967D7`; configured sentinel passed after shutdown. Both OrbStack guest and macOS host `sync` completed after final artifact creation. No unmount or physical disk move was attempted.

## Verification and repository evidence

- Pre-freeze `migration-readiness.sh`: 0 failures / 0 warnings; `OPERATION_SKULD=READY`.
- Pre-freeze `doctor.sh`: 0 failures / 0 warnings.
- Final cold-snapshot standalone verification: passed.
- Final HomeLab manifest: 16/16 passed; checksums: 22/22 passed.
- The owner/mode cross-platform verifier fix was tested by `python3 scripts/test-openclaw-continuity.py`; `pnpm check:architecture`, Python/shell syntax checks, `pnpm check:secrets`, and `git diff --check` passed before execution. Relevant implementation is pushed on `main` through commit `54a7604`.

Source OpenClaw owner ingress is off; no destination owner ingress was enabled. The disk is only declared safe for the next move phase; it is still mounted on the source and must remain there until the separate user approval.
