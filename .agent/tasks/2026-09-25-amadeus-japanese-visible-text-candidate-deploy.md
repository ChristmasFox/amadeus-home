# Deploy Japanese visible voice-text postprocessor candidate

- Status: same-version candidate deployed; owner handset acceptance remains pending.
- Current candidate: `local/openclaw-amadeus:git-b655dba924f9-20260925155559` (source `b655dba`).
- Keep `VERSION=1.5.3`; do not create a formal release before owner acceptance.
- Deployment used `./scripts/deploy-openclaw.sh --apply --candidate --build-openclaw`; rollback checkpoint is `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925155559`. Post-apply health passed, restart count is 0, WhatsApp is linked/connected, and all three lifecycle/FIFO/Japanese-text markers occur once.
- Owner retest: one voice DM, two consecutive group voice notes (FIFO, each Japanese PTT + matching visible Japanese line + Chinese summary), and typed-only Chinese (no Japanese line/PTT).
- Record owner result in a dated checkpoint. Do not copy message content or secrets into Git.
