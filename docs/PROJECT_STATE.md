# Project State — 2026-09-26

## Source and architecture

- Canonical `main` contains the complete 1.6.0 release; the old Voice and short-lived performance branches were merged and retired. `VERSION=1.6.0` is formally applied to the CasaOS Agent image; native A+MLX TTS is the selected single backend. External references, samples, weights and secrets never enter Git.
- OpenClaw 2026.9.4 is the sole Agent runtime. Native Amadeus/PUBG plugins, deterministic domain/presentation and one owner outbox remain; no retired runtime, keyword router or sender fallback.

## Live release and rollback

- M204 OrbStack `nyannyan` CasaOS: OpenClaw release `local/openclaw-amadeus:git-c730b495763a-20260926130153`, Product Radar `local/product-radar:git-d988000e1c5d-20260924130631`, both healthy, OpenClaw restarts 0, WhatsApp linked. Protected OpenClaw release checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260926130153`; prior candidate image/checkpoint retained for rollback.
- The **same** Mac `com.amadeus.qwen3-tts` LaunchAgent now serves the original A (~46s) reference with pinned community MLX 1.7B Base 8-bit ICL, `language=Auto`, one bounded inference worker and `ProcessType=Interactive`. MPS exited before MLX started; no dual-running TTS. OpenAI-compatible endpoint health ready; Git service source SHA `41420a36aa09b294e74e4f7a40e2ed9bc5b5bc9bfb6be19017917e92c3157005` matches live. Pinned source/model/dependency manifest is protected outside Git. Exact MPS rollback: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/protected-performance/pre-a-mlx-candidate-20260926T123834Z`.
- Owner rejected short D reference, then accepted the same-A direct MLX comparison and confirmed post-switch real WhatsApp Japanese PTT, nonduplicated visible text and typed input without voice. Four real turns had TTS 5.95/5.82/7.53/6.42s and inbound→media 15.27/12.01/22.18/21.35s. This is not a real p95; a fifth real voice also delivered during a synthetic test's bounded queue contention.

## Measured limits and remaining Goal item

- Original single DM baseline: ASR 0.702s, Agent 3.471s, TTS+MP3 35.162s, end-to-end 42.462s. Fixed short HTTP A/MPS Interactive 20-run p50 4.48s/p95 5.28s; A/MLX 20-run p50 3.30s/p95 3.52s. A/MLX normal five-run p50 5.42s. MP3 encode remains minor; direct Opus not selected.
- MLX cold/real `vmmap` peak reached 18.4 GiB on 24 GiB Mac; swap rose from ~3.63 to ~6.75 GiB, reached ~7.03 GiB after a post-release real voice then fell to ~6.31 GiB; sampled memory pressure ~70–80% free. Idle footprint ~3.3 GiB; long-term memory safety is a monitoring gate, not a zero-risk claim. A/MPS before switch had ~9.3 GiB physical footprint. B ~15s reference hit four supervised 110s timeouts; its incomplete cells are explicitly documented, not filled with guessed p95.
- Docker cache patch-only candidate wall 39s→3s; plugin-dist-only 1s with OS/glibc/npm cached. Machine-checkable performance report and numeric data are in `docs/reports/`. Full local gates, immutable CasaOS release/checkpoint and owner notification passed. Known `LOG_POLICY=warning` and optional media adapter absence remain; post-release real WhatsApp owner acceptance and canonical `main` push passed. Four B configs remain safety-incomplete; the full Goal stays active pending that explicit matrix item. Strict doctor has one known optional media-adapter failure; non-strict doctor exits 0.

Use `docs/CURRENT_TASK.md` for the next action and dated `.agent/checkpoints/2026-09-26-*` for evidence and rollback, not historical diaries as runtime instructions.
