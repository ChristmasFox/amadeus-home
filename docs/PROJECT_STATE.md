# Project State — 2026-09-26

## Source and architecture

- Canonical `main` contains the complete 1.5.9 Voice baseline; current short-lived goal branch is `work/post-voice-engineering-performance`. `VERSION=1.5.9` until formal release. Git owns definitions; real secrets, voice references and generated samples are outside Git.
- OpenClaw 2026.9.4 is the sole Agent runtime, with native Amadeus/PUBG plugins, deterministic domain/presentation and one owner outbox. No retired LangBot/n8n/old Runtime fallback.

## Live candidate (not formal release)

- M204 OrbStack `nyannyan` CasaOS: OpenClaw `local/openclaw-amadeus:git-c75619421d23-20260926104238`, Product Radar `local/product-radar:git-d988000e1c5d-20260924130631`; both healthy, OpenClaw restarts 0, WhatsApp linked/connected. OpenClaw rollback: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260926104238`.
- Native Mac TTS service source matches Git SHA `41420a36aa09b294e74e4f7a40e2ed9bc5b5bc9bfb6be19017917e92c3157005`: original A ~46s private profile, **community MLX 1.7B Base 8-bit ICL candidate**, Auto, one bounded inference worker, `ProcessType=Interactive`, health ready. The previous MPS process exited before the same LaunchAgent switched; D remains rejected. Protected MPS rollback `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/protected-performance/pre-a-mlx-candidate-20260926T123834Z`. Pre-sync rollback: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/pre-source-sync-20260926T104532Z`; pre-QoS rollback: `qos-ab-20260926T092129Z` under the same external qwen3-tts root.
- Owner rejected D's loss of character, then compared exact A/MPS and A/MLX direct samples, found A+MLX acceptable and requested a controlled implementation; live A+MLX/Auto candidate is now running, and confirmed candidate WhatsApp one Japanese PTT, nonduplicated visible text and typed input without TTS. Two real candidate voice turns had TTS 9.33s/9.91s and inbound→media 22.58s/20.74s; no real p95 claim.

## Measured limits / release work

- Original direct-DM baseline: ASR 0.702s, Agent 3.471s, Qwen+MP3 35.162s, end-to-end 42.462s (single observation). Controlled same-fixture Background→Interactive A/B/A/B yields p50 10.39s→4.48s on the local HTTP endpoint; 20 Interactive samples p95 5.28s. B ~15s ICL reference triggered repeated supervised 110s timeouts; four matrix configs remain incomplete by safety design. MLX 1.7B 8-bit direct PoC was faster and used more Metal memory; owner later accepted the A+MLX direct voice sample. Real MLX handset/memory acceptance is pending.
- Live memory snapshot (19:55 local): TTS `vmmap` physical footprint ~9.3 GiB on 24 GiB Mac; OrbStack Helper RSS ~4.1 GiB; macOS swap used ~3.64 GiB, compressed ~3.96 GiB, `memory_pressure -Q` reported 73% free. Figures use different accounting bases and must not be summed; no model eviction/cache tweak has been made. Record this tradeoff in the performance report.
- Docker cache patch-only candidate wall 39s→3s; plugin-dist-only 1s after stable OS/glibc/npm layers. Optional direct Opus is not selected. MLX candidate HTTP 20 short requests p50 3.30s/p95 3.52s, five normal p50 5.42s; cold footprint peaked 17.5 GiB and macOS swap rose ~3 GiB before settling, so memory remains an explicit gate. One real A+MLX WhatsApp voice turn: TTS 5.947s, inbound→media 15.270s, one media send; handset quality and typed-boundary confirmation pending. Final report update, full release gates and post-release acceptance remain. Strict doctor still reports one known optional media-adapter absence; non-strict doctor exits 0.

For evidence and rollback details, see dated `.agent/checkpoints/2026-09-26-*` and the active Goal. Historical diaries are under `docs/history/`.
