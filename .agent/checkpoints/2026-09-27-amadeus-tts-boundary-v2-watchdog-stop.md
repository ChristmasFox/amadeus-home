# Amadeus TTS Boundary Rebaseline v2 — Matrix Watchdog Stop

Date: 2026-09-27 local. Active Goal: `docs/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_GOAL.md`. Worktree branch: `codex/tts-boundary-rebaseline-v2-2026-09`, based on canonical Amadeus 1.6.2 `origin/main` `bb9cfb8533c0e17a4a9e0c94a2b830a7b06eb4a6`.

## Immutable production control

- Version `1.6.2`; service source SHA-256 `de6780fc0b96a6dea1be790a64b9f9c72bc299f433f968ef5bfb5ade16ce393a`; engine config SHA-256 `91e9b7383047ad59e11cc0c919604f45f0c05fa1ee729ed2cafe36ce26a9f2aa`.
- Protected A / `kurisu-v1`, community MLX 1.7B Base 8-bit, Auto, Interactive, MP3, one worker/one pending slot, 5s admission wait, 120s external timeout, `MAX_TEXT=1200`.
- No production service/config/profile/policy modification, restart, deployment, or version bump occurred.
- Fresh 3-snapshot admission passed at the same LaunchAgent PID `50062` / runs `1`; `/healthz` and 9Router route ready; memory free 73/73/74%; TTS footprint ~3.30 GiB; startup disk free ~248.9 GiB; swap stable across snapshots.

## V2 measurement results at stop

Protected run root: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-rebaseline-v2-2026-09` (root mode 0700; evidence mode 0600).

- Fixture manifest SHA-256: `2342110427127531e30f18b7c8d350d367d5b2364b7329a6d8117155729a505c`.
- V2 200-row seeded schedule SHA-256: `6c307496951095b0c377e17efc78aa048f6df1e03679f9c47dd12dcbdddf7f80`; execution was restricted to 25–600 codepoints. 800/1000/1200 were not re-probed.
- Three excluded 50-character A warmups completed. The pre-matrix 50-character A anchor completed 20/20: endpoint p50 `5898.1` ms, p95 `6680.5` ms, max `6822.6` ms.
- Progressive safety probes passed once each at 25, 50, 100, 150, 200, 250, 320, 400, 500, and 600. No new synthesis request was sent at 800, 1000, or 1200.
- The matrix persisted 123 rows before its hard stop: 122 successful client rows and one failure. Each length other than 250 has 12 successful partial rows; 250 has 14 successes in 15 attempts, with the B-250 request hitting the unchanged 110-second experimental watchdog at `110002.4` ms. No bucket reached n=20; no percentiles or representatives were fabricated.
- Matrix phase stopped with `inflight_request_exceeded_110s_watchdog`. The runner submitted no request after the stop and exited. One later `RuntimeError`/`synthesis_failed` log event appeared after the saved cursor; attribution is time-correlated only because the unchanged service has no request ID. No retry was made.
- Post-stop read-only observation: health ready, PID/runs `50062`/`1`, memory free 78%, current TTS footprint ~3.90 GiB, lifetime peak ~19.60 GiB, swap free ~0.75 GiB, route ready, no LaunchAgent restart. Safety classifier returned no additional post-stop hard-stop reason.
- All 122 measured MP3s from partial buckets remain in the protected external `audio/` tree. No representative artifact is eligible because no bucket completed n=20; the protected listening index correctly records 0 artifacts and 10 incomplete buckets. The first derived index is preserved as `listening-index-pre-normalization.json` (SHA-256 `ce17221210536b34a5bc2656c8f77def69fbafb306658324ec278b07e2ab5d41`).
- Sequential soak, contention, and post-stress recovery anchor were recorded `not_run` because the ordinary matrix hard-stopped.

## Publication / disposition

- V2 report: `docs/reports/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_2026_09.md`, SHA-256 `36dbe369adf2cfbc7495954f1481f72aa5ffb04a3c11071f08d99f3c65ab23b0`.
- V2 data: `docs/reports/data/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_2026_09.json`, SHA-256 `98e9e451cdc3e4f2abdb0b0533c66beeaa89c5bc420ad12b8975fd1eba89941b`.
- Prior safety-stopped branch/report/data remain unchanged and unpooled. Tooling revision ledger and raw evidence are protected outside Git; partial audio was not pruned.
- Focused V2/boundary tests passed (14); complete TTS test discovery passed (38, 1 skipped); `pnpm check:secrets`, Python compilation, `git diff --check`, and RUNTIME workflow planning passed. Final publication/commit checks remain a separate step.
- Result is **incomplete-safety-stopped**, not Goal completion: zero complete matrix buckets and zero representative-listening artifacts. Do not submit more TTS requests under this run or change production policy.
