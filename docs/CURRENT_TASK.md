# Current Task — Amadeus TTS default-only local-first policy follow-up

Date: 2026-10-01 (Asia/Shanghai).

Active Task: `.agent/tasks/2026-10-01-amadeus-tts-default-only-policy.md`.

Status: `IN_PROGRESS`.

The owner requests default voice only for all current production TTS requests:
valid emotion/style inputs must be normalized to `default`, local Qwen3-TTS MLX
must always be attempted first, and cloud Qwen may be used only for operational
local failure. Keep emotion code for a future explicit opt-in, but force the
production flag off. The completed Qwen3-TTS rebaseline Goal remains
`docs/AMADEUS_QWEN3_TTS_MLX_REBASELINE_GOAL.md`; this follow-up does not reopen
its waived human-listening gates or change the model/profile/ASR/ImageAssets.

The direct user instruction authorizes applying this TTS-only bridge policy after
focused tests and secrets checks. Deploy only the affected 9Router image and
verify the non-default-style logical route still reports local Qwen3 MLX.
