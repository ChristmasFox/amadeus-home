# Remaining Phase 4 B-reference benchmark requirement — 2026-09-26

The post-Voice Goal explicitly requests at least five runs for every profile/language/fixture configuration. Four B (~15s ICL) configurations have only partial rows plus 110s watchdog timeouts; the report marks them **safety-incomplete**. Do not fill missing results with guesses or mark the full Goal achieved from the released A+MLX path.

## Safe next action

1. Verify a **clean, accurately matched** ~15s private A-derived audio/transcript pair by owner listening or local-only alignment; the previous B crop used tentative line timing and may have mismatched speech/text. Keep audio/transcript in a 0700/0600 external profile directory, never Git or cloud ASR by default. Do not change the live A production profile.
2. Plan an isolated hardware benchmark window without two resident heavyweight models competing on the 24 GiB production Mac; confirm production service/rollback and memory pressure before any explicit apply. Do not disrupt WhatsApp traffic merely to satisfy a test count.
3. Re-run B Auto/Japanese × short/normal/long with fixed public fixtures, five warmed attempts per config, separate cold-start evidence, 110s per-sample fail-closed watchdog, sanitized stage/RTF/memory/error metrics and private listening samples. If repeated timeouts persist, stop and document the genuine safety limit rather than extending the 120s product window.
4. Re-run `pnpm verify:voice`, report verifier, architecture/diff/secrets checks; update the numeric report and dated checkpoint. Preserve current released A+MLX and protected MPS rollback unless owner-approved evidence justifies a change.

No new Voice feature, second Agent/runtime, sender or profile switch is authorized by this follow-up. The full Goal remains active while this explicit matrix item is unresolved.
