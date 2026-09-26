# Remaining Phase 4 B-reference benchmark requirement — 2026-09-26

The post-Voice Goal explicitly requests at least five runs for every profile/language/fixture configuration. Four B (~15s ICL) configurations have only partial rows plus 110s watchdog timeouts; the report marks them **safety-incomplete**. Do not fill missing results with guesses or mark the full Goal achieved from the released A+MLX path.

## Safe next action

1. **Local alignment completed:** the previous B cut 15.40s overshot the exact aligned line-5 end at 13.76s by 1.64s. A separate protected B candidate at 14.05s in the following silence, with the same lines 1–5, has local ASR similarity 0.8434 versus old B 0.8070 (full A control 0.8092). Private files are under `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/protected-performance/clean-b-20260926/profiles/B` (0700/0600). This is stronger alignment evidence, not owner quality or latency acceptance. Never commit media/transcript or change live A.
2. **Next gate:** obtain a quiet isolated hardware benchmark window; avoid the live A+MLX process (18.4 GiB observed peak) overlapping a second MPS model during user traffic. Check memory pressure, live health and exact rollback before explicit apply. Do not disrupt WhatsApp merely to satisfy a test count.
3. Re-run B Auto/Japanese × short/normal/long with fixed public fixtures, five warmed attempts per config, separate cold-start evidence, 110s per-sample fail-closed watchdog, sanitized stage/RTF/memory/error metrics and private listening samples. If repeated timeouts persist, stop and document the genuine safety limit rather than extending the 120s product window.
4. Re-run `pnpm verify:voice`, report verifier, architecture/diff/secrets checks; update the numeric report and dated checkpoint. Preserve current released A+MLX and protected MPS rollback unless owner-approved evidence justifies a change.

No new Voice feature, second Agent/runtime, sender or profile switch is authorized by this follow-up. The full Goal remains active while this explicit matrix item is unresolved.
