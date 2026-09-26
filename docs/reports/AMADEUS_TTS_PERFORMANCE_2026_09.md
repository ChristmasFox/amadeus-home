# Amadeus TTS Performance — September 2026

Status: **single A/MLX/Auto candidate live with protected MPS rollback; real WhatsApp owner acceptance and formal release pending**. Measured on M204 Apple Silicon / 24 GiB with the existing OpenClaw single-Agent architecture. This report uses only aggregate or numeric timing/memory data. The machine-checkable companion is [`data/AMADEUS_TTS_PERFORMANCE_2026_09.json`](data/AMADEUS_TTS_PERFORMANCE_2026_09.json); verify offline with `python3 scripts/check-tts-performance-report.py`. Protected raw logs, references and listening WAVs remain outside Git. No message content, transcript, user identity, token or voice bytes are published here.

## 1. Original production baseline

The 2026-09-25 **single real direct-DM sample** after removal of a redundant Skill read had ASR 0.702s, one Agent call 3.471s, Qwen TTS+MP3 35.162s, inbound→WhatsApp PTT 42.462s. This is not a baseline distribution. Two earlier synthetic short samples split the engine/encode stages as 15.840s/0.337s and 39.733s/0.205s, showing high model variance and small packaging cost. Evidence: `.agent/checkpoints/2026-09-25-amadeus-1.5.3-no-read-direct-dm-benchmark.md` and `2026-09-25-amadeus-1.5.3-tts-split-timing-live.md`.

The 1.5.9 product baseline was the official Qwen3-TTS 1.7B Base, PyTorch MPS/FP16, operator-owned ~46s A ICL voice reference, reusable clone prompt, `language=Auto`, one model lock and a 120s upstream TTS window. The current Goal did **not** increase that window or change the voice policy.

## 2. Instrumentation methodology

- The host service separates HTTP total, bounded worker/lock `queue_wait_ms`, `generate_or_model_ms`, WAV serialization, output encoding, audio duration, input-length bucket and `RTF = engine_inside_lock_ms / audio_duration_ms`. The upstream `generate_voice_clone` includes decoding/postprocessing; `decode_stage=inside_model_api` explicitly records this unsplittable library boundary rather than inventing decode numbers. No input text/reference/user identifier is logged.
- The MPS matrix uses public fixed Japanese short (~20 characters), normal (~50) and long (~100) fixtures. Each **complete** profile/language/bucket has one first-use trial and five warmed successful trials; p95 is linear interpolation on five points and is descriptive, not a robust tail estimate. Cold model startup is measured separately. The same protected A/D references and fixtures were used in the experimental MLX comparison. Actual generated durations are recorded for RTF/length context.
- B's four missing configs hit an explicit 110s per-sample experimental watchdog, below the unchanged 120s product window. These are **safety-incomplete**, not quietly imputed or counted as five successful warmed runs. `B Auto short` and `B Japanese long` did complete but show large variance. The crop/transcript alignment was not owner-approved, so no causal claim that a generic 15s reference is worse is justified.
- The identical A/Auto/short HTTP fixture was measured across a `Background → Interactive → Background → Interactive` LaunchAgent reversal, changing only `ProcessType`. Another 20 Interactive HTTP requests and five post-source-sync requests check stability. Real WhatsApp turns are reported separately, never mixed into controlled quantiles.

## 3. Reference/profile matrix

All durations are protected private experiments, not files in Git. A=46.00s ICL/current; B=15.40s ICL; C=8.15s ICL; D=4.55s ICL; E=4.55s x-vector-only. The B/C/D/E crops used tentative transcript alignment and are not production quality-approved. Each cell is warmed MPS **p50/p95 in milliseconds** (five successful trials when present):

| Profile | Language | Short | Normal | Long |
| --- | --- | ---: | ---: | ---: |
| A | Auto | 4528/5197 | 9770/9993 | 16263/16999 |
| A | Japanese | 4586/5040 | 9276/9664 | 16328/17011 |
| B | Auto | 12736/19656 | 110s timeout | 110s timeout |
| B | Japanese | 110s timeout | 110s timeout | 14030/50192 |
| C | Auto | 3520/3605 | 8428/8903 | 14959/15472 |
| C | Japanese | 3724/4166 | 8372/8597 | 14408/14988 |
| D | Auto | 2670/2893 | 8018/8572 | 14257/14480 |
| D | Japanese | 2716/2773 | 7457/7638 | 14558/14757 |
| E (x-vector) | Auto | 3201/4269 | 7730/8943 | 15348/16430 |
| E (x-vector) | Japanese | 3068/3197 | 7830/9693 | 15967/16521 |

A→D saved ~1.86s on the Auto short p50 in the isolated MPS matrix, but the owner heard a loss of Kurisu character. C/E are measured but not owner-approved. No shorter profile replaced A.

## 4. Auto vs Japanese

With the accepted A profile, MPS short p50 was 4.528s (`Auto`) versus 4.586s (`Japanese`); normal 9.770s versus 9.276s; long 16.263s versus 16.328s. The differences vary with length and five-sample uncertainty. Japanese speech is already the product output policy, but an engine `language=Japanese` switch was not shown to be a consistent quality-safe improvement; production remains `Auto`.

## 5. MPS vs MLX

A separate **community** `Blaizzy/mlx-audio` PoC used its pinned 1.7B Base 8-bit model, not an official upstream MLX backend and not a 0.6B substitute. All 12 A/D × Auto/Japanese × three-bucket configs completed five warmed trials without sample failures. Direct engine warmed **p50/p95 milliseconds**, with comparable recorded output duration per matching fixture:

| Reference/fixture | MPS | MLX |
| --- | ---: | ---: |
| A Auto short | 4528/5197 | 3332/3465 |
| A Auto normal | 9770/9993 | 5117/5211 |
| A Auto long | 16263/16999 | 7939/8012 |
| D Japanese short | 2716/2773 | 1229/1287 |
| D Japanese normal | 7457/7638 | 3199/3322 |
| D Japanese long | 14558/14757 | 5592/5811 |

MLX was faster directly, especially long. Earlier owner feedback that “MLX sacrificed timbre” may have included D’s short-reference effect; after a specific same-reference A/MPS versus A/MLX comparison, the owner found **A/MLX acceptable** and explicitly requested implementation. This does not establish handset quality yet. MLX also has a separate community dependency/model conversion stack and larger Metal peak allocation. The first cold MLX model load was ~23.7s (subsequent process loads often benefited from cache). A real isolated `QwenMlxEngine` WAV smoke passed; the same native service later switched to MLX without running MPS in parallel. The OpenAI-compatible route/contract stayed unchanged. Evidence: `.agent/checkpoints/2026-09-26-tts-phase5-mlx-poc.md`.

## 6. p50 / p95 / min / max

A/MPS/Auto baseline and A/MLX/Auto candidate evidence (milliseconds; fixture scope must not be conflated with real-turn latency):

| Measurement | n | p50 | p95 | min | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Direct warmed MPS short | 5 | 4528 | 5197 | 4282 | 5293 |
| Direct warmed MPS normal | 5 | 9770 | 9993 | 9268 | 10045 |
| Direct warmed MPS long | 5 | 16263 | 16999 | 15760 | 17178 |
| HTTP Background reversal, short | 5 | 10391 | 10907 | 8915 | 10938 |
| HTTP Interactive, short | 20 | 4476 | 5278 | 3992 | 6241 |
| HTTP Interactive after Git source sync, MPS short | 5 | 4638 | 5174 | 4142 | 5245 |
| HTTP Interactive candidate MLX short | 20 | 3296 | 3516 | 3185 | 3528 |
| HTTP Interactive candidate MLX normal | 5 | 5424 | 5568 | 5217 | 5591 |

The same-fixture Background reversal→Interactive MPS p50 reduction was ~57%. For the same A/Auto/short HTTP fixture, MLX 20-run p50/p95 was 3.296s/3.516s versus MPS 4.476s/5.278s. MLX normal (~50-char) HTTP p50 was 5.424s. Both short p95 values are below the 15s target for that fixed phrase; neither is a real-WhatsApp p95. Two earlier A/MPS post-candidate inbound voice turns took TTS 9.331s/9.907s and inbound→media 22.577s/20.743s. The first observed A/MLX real voice turn took TTS **5.947s** and inbound→media **15.270s** (input bucket `<=80`, audio 6.800s); phone-side quality and typed boundary were still pending at this observation. Earlier post-QoS real turns also included TTS 7.480s and 25.360s, demonstrating substantial remaining variance. No claim that every reply is five seconds or that all end-to-end turns meet 10–18s is supported.

## 7. RTF

`RTF` divides model-inside-lock wall time by generated audio duration, excluding queue and encode. MPS A/Auto warmed median RTF: short **1.55**, normal **1.13**, long **1.04**. MLX A/Auto: short **1.20**, normal **0.64**, long **0.51**. RTF and actual duration for every complete config are in the numeric JSON; different stochastic output lengths make raw total comparisons alone insufficient.

## 8. Memory

- M204 has 24 GiB unified memory. Live A/MPS baseline TTS `vmmap` physical footprint was ~**9.3 GiB** after ~70 minutes resident; this includes more than model weights (working allocations/caches) and cannot be inferred from the small process RSS alone. A separate 19:55 local snapshot showed OrbStack Helper RSS ~4.1 GiB, macOS compressed ~3.96 GiB, swap used ~3.64 GiB and `memory_pressure -Q` reporting 73% free. These different accounting bases must **not** be added together. No proof of sustained active swap churn or a memory-leak rate was collected.
- Direct MPS D Metal driver peaks were ~5.0–6.1 GiB; the earlier A MPS direct matrix did not record the driver counter, so it is **unknown**, not zero. MLX Metal peaks were ~6.2–7.4 GiB for D and ~10.3–12.1 GiB for A. Both were measured alongside the production service; counters and cached allocations are backend-specific and not identical accounting measures.
- During the one-engine A/MPS→A/MLX candidate switch, the old MPS process exited before MLX bootstrapped. MLX cold startup `vmmap` physical-footprint peak reached **17.5 GiB**; macOS swap used grew from ~3.63 GiB to ~6.75 GiB. After warmup, idle MLX footprint was ~3.3 GiB (a short-batch immediate snapshot reached ~12.2 GiB), `memory_pressure -Q` later reported ~70–80% free, and swap used stabilized near ~6.76 GiB rather than continuing to rise during the sampled batches. A single `top` snapshot did not show active swap churn, but this does **not** prove long-term memory safety. The 24 GiB host needs continued real-traffic observation; rollback on pressure or instability. No `empty_cache`, idle eviction or restart-on-demand was introduced.

## 9. Owner quality acceptance

The owner rejected D’s loss of Kurisu character. After listening to the **same A reference and same sentence** on MPS and MLX, the owner found **A/MLX acceptable** and asked for implementation. Earlier broad timbre concern is superseded only for that specific A+MLX direct sample; real WhatsApp/handset quality remains to be accepted after the backend switch. On the preceding A/MPS candidate, the owner confirmed one Japanese PTT, nonduplicated visible text and an ordinary typed message without voice. That acceptance does **not** automatically transfer to A/MLX; a new real handset test is required. C/E lack affirmative quality approval and were not selected. Earlier evidence: `.agent/checkpoints/2026-09-26-tts-owner-selects-a-mps.md` and `2026-09-26-post-voice-owner-whatsapp-acceptance.md`; the later A+MLX owner decision is recorded separately.

## 10. Chosen production configuration

**Candidate A/MLX/Auto**: original operator-owned ~46s reference, community MLX 1.7B Base 8-bit ICL, the same OpenAI-compatible service contract, one inference worker and bounded pending slot, unchanged 120s external TTS window and `ProcessType=Interactive`. The existing A/MPS source is the rollback point, not a second running engine. OpenClaw remains the single Agent runtime. **The single-engine live candidate switch succeeded** with protected A/MPS rollback; fixed HTTP short/normal timing and cold/idle memory were measured. Real WhatsApp handset quality, longer-running memory stability and formal release remain pending.

## 11. Rejected alternatives

- **D short profile**: p50 short synthesis saved ~1.86s versus A, but owner judged the voice character worse. **C/E**: faster in some matrix cells but not owner-approved; no quality-safe production case. **B**: high variance and four 110s watchdog stops; incomplete, unsafe to claim five warmed successes for those cells. Transcript/crop alignment uncertainty prevents inferring that *all* 15s references are poor.
- **MLX 1.7B 8-bit** is conditionally selected for A only after direct owner listening; cold A footprint peak 17.5 GiB, temporary swap growth and community dependency upkeep are candidate gates, not hidden costs. **0.6B** was unnecessary and not substituted. **Direct Ogg/Opus** remains optional/not switched: measured MP3 encode ~0.03–0.37s and native WhatsApp PTT/MIME/duration equivalence across channels was not proven.
- **Timeout increase, second Agent, keyword router, unbounded queue, format-first optimization**: forbidden or contradicted by measured engine-dominated latency. No such fallback is present.

## 12. Remaining bottleneck

Model generation dominates: controlled HTTP queue wait was near zero and encode tens to hundreds of milliseconds, while actual MPS model stage ranged from ~7.37s to ~24.98s in earlier real post-QoS turns. The selected scheduling change strongly improved identical short work in reversible A/B/A/B tests; for live MLX, fixed HTTP latency is measured but real WhatsApp tail latency, handset timbre and peak memory pressure with the 46s reference remain the gates. Do not infer those from direct benchmark alone. Profile MPS/MLX allocation and any cache/idle policy **only** as a separate measured variable with rollback. Do not substitute a longer timeout or silently trim essential answer content.

## 13. Rollback instructions

- OpenClaw candidate checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260926104238`; previous immutable 1.5.9 image is recorded in `.agent/checkpoints/2026-09-26-amadeus-1.5.9-formal-release.md`. The final release must add its own protected checkpoint and image tag. Restore Compose/config from the named checkpoint using the repository deployment/rollback procedure, then `docker compose up -d --no-build` and health/WhatsApp acceptance; do not revive retired runtimes.
- **Pre-A+MLX protected rollback:** `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/protected-performance/pre-a-mlx-candidate-20260926T123834Z` holds the exact A/MPS service/plist/reference/token with SHA manifest and 0600 permissions. On MLX memory/quality/health failure, explicitly run `infra/macos/manage-qwen3-tts.sh --apply-plist-only --engine mps` (the prior MPS venv/model remain intact), then wait for ready health, compare source SHA and perform fixed synthetic plus real owner voice acceptance. If source files differ, restore them from that protected checkpoint first. Never start two resident engines. Earlier pre-source-sync and pre-QoS checkpoints remain audit-only. No rollback drill or unrequested WhatsApp message was sent.

Build-cache evidence: `.agent/checkpoints/2026-09-26-openclaw-docker-cache-benchmark.md` (patch-only wall 39s→3s, plugin-dist-only 1s with apt/glibc/npm cached). All external raw timings and samples remain under protected `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/perf-matrix-20260926/`; JSON here deliberately strips private paths/content and retains the four B safety-incomplete markers.
