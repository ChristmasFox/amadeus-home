# Amadeus 1.4.8 — M204 runtime readiness progress

Date: 2026-09-24 04:40 UTC

## Verified on M204

- Host identity: `Amadeus-M204`, macOS 27.0, user `nyannyan`.
- Canonical repository: `/Users/nyannyan/agent-monorepo`, `main` at `3a4186723a29f7b100e136257eeab07efec56dd3`, clean and equal to `origin/main`.
- `origin`: `git@github.com:ChristmasFox/amadeus-home.git`; `git ls-remote --heads origin main` succeeds with the same SHA using the M204 machine identity.
- Toolchain: Node `v24.21.0`, pnpm `11.19.0`, Python `3.11.16`, tmux, cloudflared; `bootstrap.sh --check`, `pnpm workflow:plan`, `pnpm check:secrets`, and `git diff --check` pass.
- Canonical guest: OrbStack machine `nyannyan`, Ubuntu 24.04 arm64; Docker `29.8.1`, Compose `v5.5.1`, CasaOS `v0.4.15`, `/DATA/AppData`, `/var/lib/casaos/apps`, and `amadeus_network` are present.
- Avalon: host UUID `0C2CC618-D273-470C-8036-9AD6A0D967D7` matches profile; `diskutil verifyVolume` returned fsck exit code 0; guest reads `/Volumes/Avalon/.amadeus-storage.json` with `storageId=avalon-primary-8tb` and the required purpose.
- Product Radar: source-freeze SQLite restored, integrity check `ok`, current ARM64 image built from this SHA and loaded as `local/product-radar:git-3a41867-20260924042936`; service healthy at loopback `127.0.0.1:5315`.
- Immich: source-freeze PostgreSQL dump restored; server, machine-learning, PostgreSQL and Redis are healthy; `/api/server/ping` returns `pong`, PostgreSQL query and vector extension checks pass; server binds loopback `127.0.0.1:2283`.
- FashionSigLIP: tracked installer completed; LaunchAgent `com.productradar.fashion-siglip` reports healthy MPS worker on `127.0.0.1:18400`.

## Remaining gates

```text
TELEGRAM_ACCEPTANCE=pending
WHATSAPP_ACCEPTANCE=pending
MEDIA_ADAPTER=not-restored
DESTINATION_AUTHORITY=NO
OPERATION_SKULD_CUTOVER=NOT_COMMITTED
```

- Real owner acceptance still requires one controlled Telegram owner message and one controlled WhatsApp owner message, each with exactly one M204 reply and no old-Mac reply. Recent WhatsApp group traffic is excluded from this evidence; no `SKULD-TELEGRAM-20260924` or `SKULD-WHATSAPP-20260924` marker has been observed.
- The registered `media-organizer-adapter` remains unavailable because its backup contains state only and no reproducible image/compose definition in the repository. No replacement runtime was invented.
- `scripts/doctor.sh` now reports 2 failures: the missing media adapter and its storage-boundary check, whose legacy `/DATA/Gallery/immich` source path is absent on the destination guest. Avalon identity/content itself is verified; the legacy source remains preserved externally and has not been reclaimed.
- No `COMMIT_SKULD_CUTOVER_1_4_8` approval was supplied or executed. Rollback assets and the retained Immich source remain untouched.
