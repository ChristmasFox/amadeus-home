# Current Task — Amadeus TTS Boundary Rebaseline V2 (Paused)

Date: 2026-09-27 local. Goal: `docs/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_GOAL.md`. The owner requested delivery of only the complete 25/50/100/150-codepoint report and to stop promptly. The broader 25–600 Goal is paused, not complete.

Production TTS control `prod-1.6.2-a-mlx-auto-interactive` was not changed, restarted, or redeployed. The current host check returned `/healthz=ready`, LaunchAgent PID `50062`; no benchmark process was active.

## Preserved V2 runs

- Primary root: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-rebaseline-v2-2026-09`. B-250 hit the unchanged 110-second watchdog (`110002.4 ms`); the dataset stopped, and its partial rows were not pooled or resumed. Original report remains `docs/reports/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_2026_09.md`.
- Safe-prefix root: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-rebaseline-v2-safe-25-200-2026-09`. Owner stopped after 99 persisted client rows. Lengths 25/50/100/150 each have 20/20 successes; 200 has 19/19 persisted rows. The later service success for A-200 lacked a persisted client timing row and is excluded. No synthesis request was submitted after the stop. Four verified fixture-A listening artifacts for the requested lengths remain outside Git.
- Requested extract: `docs/reports/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_25_50_100_150_2026_09.md` and `docs/reports/data/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_25_50_100_150_2026_09.json`. The extract uses only 25/50/100/150; no cross-run pooling and no production policy recommendation.
- A later empty fresh-root preparation remains protected at `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-rebaseline-v2-safe-25-200-completion-2026-09`. Control capture refused before writing a control manifest because this branch is based on `63d3b79` / VERSION 1.6.2 while `origin/main` advanced to `1401e49` / VERSION 1.6.4. No TTS request was sent from that root.

The full 25–600 matrix, soak, contention, and recovery requirements remain incomplete. Do not infer completion from the four-bucket extract or change production policy.
