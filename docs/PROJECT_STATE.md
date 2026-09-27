# Project State — 2026-09-27

## Source and architecture

- Canonical `origin/main` is the 1.6.2 source cleanup baseline; the active image-generation branch carries unreleased `VERSION=1.6.4` for the current acceptance follow-up. The live CasaOS image is Amadeus 1.6.3. Keep the source branch, live image tag, and current release version distinct in reports.
- OpenClaw 2026.9.4 is the **sole Agent runtime**. Native Amadeus/PUBG plugins, deterministic domain/presentation and one owner outbox remain; no retired runtime, keyword router, custom image provider, or sender fallback was introduced.

## Live release and rollback

- M204 OrbStack `nyannyan` CasaOS: OpenClaw `local/openclaw-amadeus:git-ac021ae81ac4-20260927082000` (Amadeus 1.6.3) and Product Radar `local/product-radar:git-d988000e1c5d-20260924130631`; post-deploy OpenClaw and Product Radar health passed. WhatsApp remains linked. The protected pre-change OpenClaw checkpoint is `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260927082000` (root chmod 0700; config copy 0600); post-deploy evidence is `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260927082000`. Preserve this checkpoint for rollback.
- Live OpenClaw config now has default image-generation model `openai/ag/gemini-3.1-flash-image`, a 180-second timeout, and the owner-approved shared `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork=true` opt-in. It reuses the existing `OPENCLAW_9ROUTER_API_KEY` SecretRef/env source. No Google key/path was added. The 1.6.3 image-generation acceptance follow-up is below; do not treat the deployed configuration alone as proof of a working Agent turn.
- The **same** Mac `com.amadeus.qwen3-tts` LaunchAgent serves the original A (~46s) reference with pinned community MLX 1.7B Base 8-bit ICL, `language=Auto`, one bounded inference worker and `ProcessType=Interactive`. MPS exited before MLX started; no dual-running TTS. Preserve the exact MPS rollback and continue protecting the TTS service/process.
- The owner previously accepted real WhatsApp Japanese PTT/nonduplicated visible text/typed-without-voice and confirmed no pronunciation/naturalness/volume/rhythm anomaly after 1.6.2. This remains prior evidence, not post-1.6.3 acceptance.

## 1.6.3 default image-generation rollout — acceptance pending

- The protected 1.6.3 deploy checkpoint above was created before switching config. The existing `openai` provider plugin is loaded and advertises its native image-generation provider. A direct authenticated transport smoke from the OpenClaw container requested `ag/gemini-3.1-flash-image`, returned HTTP 200 and one JPEG (569,192 bytes), and handled the binary only in memory; no image/base64 was persisted or logged.
- The first owner WhatsApp Agent turn responded with third-party prompt suggestions instead of generating an image. Its session trajectory contained no `image_generate` mention or tool-call/result markers. A pinned-runtime tool-factory reproduction under the configured owner policy showed `image_generate` present after global and sender filtering, while `tts` and generic `message` remained denied. Therefore the failure was tool selection/presentation, not an observed 9Router route or response-parse failure.
- The active 1.6.4 source follow-up adds only a scoped `plugins/amadeus/skills/image-generation/SKILL.md` to map semantic new-image intent to the native tool. It has no fixed phrase router and contains no model ID; no SOUL or global AGENTS instructions changed. The 1.6.4 apply and a fresh owner-channel attachment acceptance are still pending.
- The TTS matrix process (PID 79839 when last observed) was not restarted by the OpenClaw 1.6.3 release. Recheck current process/runtime state before any further apply; do not restart TTS or 9Router.

## 1.6.2 stability cleanup release

- The historical 1.5.3 Voice remote branch had only an older Goal document and was retired after main-content comparison. MLX source terminology now says selected community backend, preserving the third-party caveat and explicit MPS rollback.
- Native LaunchAgent was applied with private launchd stderr, truncated above 1 MiB before each bootstrap. The previous native source/plist, protected A profile/token and exact MPS rollback remain outside Git. Same A/MLX/Auto/Interactive engine, model, timeout, worker and format are verified. Port 18792 remains deliberately wildcard for OrbStack/9Router; guest-to-host/LAN-address and authenticated 9Router speech succeeded, unauthenticated synthesis/inventory returned 401. No independent physical LAN peer test was available, so LAN exposure is conservatively assumed.
- A real WhatsApp audio inbound produced one media reply with Japanese TTS and a Chinese visible summary; an ordinary typed inbound produced a text-only reply. The owner replied “确认正常 通过” when asked to verify accepted Kurisu sound, visible text correctness/nonduplication and typed isolation. No Docker/CasaOS rebuild or new voice experiment was run. Protected native recovery and real acceptance: `.agent/checkpoints/2026-09-26-amadeus-1.6.2-stability-release.md`.

## Measured limits and operational watch

- Original single DM baseline: ASR 0.702s, Agent 3.471s, TTS+MP3 35.162s, end-to-end 42.462s. Fixed short HTTP A/MPS Interactive 20-run p50 4.48s/p95 5.28s; A/MLX 20-run p50 3.30s/p95 3.52s. A/MLX normal five-run p50 5.42s. MP3 encode remains minor; direct Opus not selected.
- MLX cold/real `vmmap` peak reached 18.4 GiB on 24 GiB Mac; swap rose from ~3.63 to ~6.75 GiB, reached ~7.03 GiB after a post-release real voice then fell to ~6.31 GiB; sampled memory pressure ~70–80% free. Idle footprint ~3.3 GiB; long-term memory safety is a monitoring gate, not a zero-risk claim. A/MPS before switch had ~9.3 GiB physical footprint. B ~15s reference hit four supervised 110s timeouts; its incomplete cells are explicitly documented, not filled with guessed p95.
- Docker cache patch-only candidate wall 39s→3s; plugin-dist-only 1s with OS/glibc/npm cached. Machine-checkable performance report and numeric data are in `docs/reports/`. Full local gates, immutable CasaOS release/checkpoint and owner notification passed. Known `LOG_POLICY=warning` and optional media adapter absence remain; post-release real WhatsApp owner acceptance and canonical `main` push passed. Four B configs remain safety-incomplete; owner explicitly cancelled further B tests after accepting released A+MLX (Goal §12). The numeric data remains incomplete, not fabricated; the performance Goal is complete as amended. Strict doctor has one known optional media-adapter failure; non-strict doctor exits 0.

Use `docs/CURRENT_TASK.md` for the next action and dated `.agent/checkpoints/2026-09-26-*` for evidence and rollback, not historical diaries as runtime instructions.
