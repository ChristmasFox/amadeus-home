# Amadeus TTS host memory/swap diagnostic — 2026-09-27 Asia/Shanghai

## Scope

Read-only host and OrbStack inspection requested by the owner. No TTS request, service restart, container stop, OrbStack config change, or process termination occurred.

## macOS host snapshot

- Captured about 12:33–12:35 CST (04:33–04:35 UTC); physical memory: 24 GiB.
- `memory_pressure`: 74% free. `vm_stat` showed ~6.47 GiB free pages and ~3.41 GiB compressor occupancy.
- `vm.swapusage`: 8 GiB total, 6,639.25 MiB used, 1,552.75 MiB free at 12:35. A sample around 12:32 showed 6,695.25 MiB used; swap use declined ~56 MiB over a few minutes.
- `OrbStack Helper` PID 1032: RSS ~5,155 MiB; `vmmap` physical footprint ~7.8 GiB, process-lifetime peak ~17.3 GiB.
- Qwen3-TTS MLX LaunchAgent PID 50062: `/healthz=ready`; RSS ~43 MiB; `vmmap` physical footprint ~3.3 GiB, lifetime peak ~19.1 GiB.

## OrbStack guest

- Read-only `orb config get memory_mib`: `12288` MiB.
- `nyannyan` VM `free -h`: ~11 GiB total, 4.8 GiB used, 4.6 GiB free, 7.0 GiB available; guest swap 12 GiB total, 526 MiB used.
- `docker stats --no-stream`: largest listed containers included OpenClaw ~1.01 GiB, Immich server ~658 MiB, PostgreSQL ~267 MiB, Jellyfin ~353 MiB, Emby ~189 MiB, and 9Router ~171 MiB.

## Interpretation

Host `vm.swapusage` is system-wide and does not attribute every swap byte to a PID. OrbStack Helper is the largest current host process/footprint; the TTS process has a high lifetime peak and a 3.3-GiB current footprint. These are plausible contributors, not an exact per-process swap accounting. The OrbStack guest itself had about 7 GiB available and only ~526 MiB of its own guest swap in use at capture. Host memory pressure was not critical, and host swap was slowly declining.

No action was taken. Keep CasaOS/9Router and the single TTS service running; do not raise OrbStack memory limit or manually delete swap files based on this snapshot.
