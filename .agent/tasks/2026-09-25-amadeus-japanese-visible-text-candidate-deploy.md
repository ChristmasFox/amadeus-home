# Deploy Japanese visible voice-text postprocessor candidate

- Status: source fix verified; CasaOS candidate deployment and owner handset acceptance remain pending.
- Current runtime is still the prior same-version candidate `local/openclaw-amadeus:git-fb1d4578bafe-20260925152845`.
- Keep `VERSION=1.5.3`; do not create a formal release before owner acceptance.
- After explicit CasaOS apply authorization, run the deployment script in dry-run first, then use the same-version candidate path with OpenClaw-only build/apply; preserve the external rollback checkpoint and verify the patched WhatsApp monitor has the Japanese-text marker exactly once, OpenClaw healthy/restarts=0, and WhatsApp linked/connected.
- Owner retest: one voice DM, two consecutive group voice notes (FIFO, each Japanese PTT + matching visible Japanese line + Chinese summary), and typed-only Chinese (no Japanese line/PTT).
- Record runtime image, backup checkpoint, and redacted acceptance evidence in a dated checkpoint. Do not copy message content or secrets into Git.
