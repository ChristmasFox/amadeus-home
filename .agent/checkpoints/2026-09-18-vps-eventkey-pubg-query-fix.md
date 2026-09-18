# 2026-09-18 VPS eventKey / PUBG query source fix

## Scope

- Isolate manual OpenClaw cron VPS reports from the official scheduled report event key.
- Update the deployment-success owner smoke copy with Amadeus / world-line flavor without changing delivery semantics.
- Fix PUBG whole-team stats queries that lost selector and aggregate fields.

## Evidence

- `plugins/amadeus/src/owner.ts` detects `:run:manual:` in the isolated cron session key and namespaces an accidentally reused scheduled VPS key under `vps-report:manual:`.
- `plugins/pubg/src/index.ts` preserves all non-identity query fields when resolving `team=true`.
- Tests: `pnpm --filter @agent/amadeus-plugin test` passed (11); `pnpm --filter @agent/pubg-plugin test` passed (9).
- Typechecks passed for both affected packages.
- `bash -n scripts/deploy-openclaw.sh` and `git diff --check` passed.

## Deployment boundary

Source-only change. No CasaOS build, compose restart, or live OpenClaw cron mutation was performed in this checkpoint. Apply only through the explicit deployment workflow, then re-run real VPS owner delivery and whole-team PUBG query acceptance.
