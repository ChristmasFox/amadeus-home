# PUBG group fresh-query evidence guard candidate — 2026-09-26

## Incident

At 23:05:54 CST the group asked for an individual's today's PUBG record. The agent replied at 23:06:01 with an unsupported zero-match assertion without calling `identity_resolve` or any PUBG data tool. After an explicit refresh request it called `pubg_query_stats` at 23:06:32 with `team=true`, producing fresh team data but not the originally requested person scope. The 23:05 scheduled prefetch did not make the first answer evidenced.

## Source and candidate

- Commits `81ee776` and `866b5f3`: the native PUBG plugin checks current-turn successful data-tool evidence for outgoing PUBG match claims, and rejects `team=true` when the user did not ask for the team. On a violation it replaces the outbound factual claim with an explicit cannot-confirm reply. It does not add a runtime, sender, keyword router, or change Domain fact calculation.
- Unit cases reproduce no-tool zero, failed tool, scheduled prefetch insufficiency, person→team scope drift, follow-up refresh, successful person/team tool result, safe uncertainty and unrelated chat. PUBG plugin test/typecheck/build, architecture, secrets, diff check and full `pnpm test` passed before the first candidate.
- Candidate 1 `local/openclaw-amadeus:git-81ee776646d6-20260926152645` was health-green, but a deliberate no-tool isolated agent turn triggered an OpenClaw 2026.9.4 `before_agent_finalize` retry and failed with `Session transcript projection is rebuilding`. **Do not release that image.**
- Candidate 2 `local/openclaw-amadeus:git-866b5f3206e2-20260926152955` removes the host revision request, retaining the fail-closed delivery hook. The single runtime was replaced via `scripts/deploy-openclaw.sh --apply --candidate --build-auto` with the existing version 1.6.0. Checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260926152955`; post-deploy evidence `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260926152955`. Previous 1.6.0 release image/checkpoint remain protected.

## Verification and remaining acceptance

- Candidate 2 OpenClaw/Product Radar healthy; plugin preflight and config validation passed; WhatsApp linked during deploy smoke. An isolated no-deliver whole-team turn called `pubg_query_stats` successfully. An adversarial no-tool isolated turn completed without transcript projection error and logged `pubg evidence guard will block unsupported outbound claim: missing_data`. A separate isolated person query called `identity_resolve` and `pubg_query_stats`.
- The isolated CLI uses `--deliver=false`, so it does **not** prove the WhatsApp `message_sending` replacement on a real group turn. The outbound behavior is unit-tested but owner group acceptance remains pending. Candidate is live, not released; do not claim real group acceptance or bump version yet.
- If the candidate regresses production, restore the prior immutable OpenClaw 1.6.0 image and associated config/Compose from protected release checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260926130153`; do not select candidate 1. Keep the current narrow trusted-proxy bridge config when restoring ingress or revalidate it afterward.
