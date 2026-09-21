# Amadeus 1.4.5 execution plan

Authoritative scope:
- `docs/AMADEUS_1_4_5_OPERATION_SKULD_FINAL_HARDENING_GOAL.md`
- `docs/AMADEUS_1_4_5_DEVELOPMENT_EFFICIENCY_ADDENDUM.md`

## Phase state

| Phase | Scope | Status | Minimum evidence |
| --- | --- | --- | --- |
| 0 | Re-audit main and canonical CasaOS host | passed | clean main, live runtime inventory, storage/log baseline recorded |
| 1 | Fresh-clone and tracked migration scripts | passed | tracked scripts, non-recursive fresh-clone rehearsal |
| 2 | Storage state/history, scheduler, safe GC and retention | passed live | storage warning fixture, GC safety, scheduler fixture, guarded retention |
| 3 | Service-aware backup and restore fixtures | passed live | SQLite snapshot API, pg logical-dump contract, 9Router isolated fixture |
| 4 | HomeLab classification, secret coverage, manifest/runbook | passed live/source | explicit service classes, logical secret coverage, consistency contract, bundle fixture |
| 5 | Immich reclaim gate/readiness hardening | passed; reclaim intentionally pending | fresh one-way gate, retained-source live state |
| 6 | Final fresh-clone rehearsal and full release gate | passed | one final full local gate, bounded evidence |
| 7 | 1.4.5 release, canonical host deploy and live acceptance | passed | checkpoint, doctor/storage/readiness, deployment evidence, push |

## Constraints

- Never execute Mac mini cutover in this goal.
- Never reclaim `/DATA/Gallery/immich`; leave `SOURCE_RECLAIM_PENDING`.
- No generic Docker volume/system prune, unknown AppData deletion, or secret values in Git/logs.
- Development uses scope-aware targeted validation; full test/typecheck/build runs only at release boundary unless a failure or shared contract requires a focused rerun.
- Host mutations require explicit `--apply`; canonical runtime is CasaOS in OrbStack `ubuntu`.

## Current evidence

- Phase 0 audit checkpoint: `.agent/checkpoints/2026-09-21-amadeus-1.4.5-phase-0-audit.md`.
- Targeted source gates passed: architecture, storage/reclaim, service-aware backup, 9Router fixture restore, scheduler fixture, manifest/readiness, secret scan, shell syntax, and scope-aware workflow/compact-runner tests.
- One affected-only OpenClaw image build and one canonical CasaOS apply completed; Product Radar reused its live image. Immich source reclaim and Mac mini cutover were not performed.

## Final evidence

- Release: `VERSION=1.4.5`, release commit `650ba76`, current clean/pushed `HEAD=41acb87`.
- Live deploy: OpenClaw image `local/openclaw-amadeus:git-47ce26ae82a3-20260921153903`; Product Radar reused `local/product-radar:git-16a8c15d727f-20260921082428`.
- Live checkpoint/evidence: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260921153903` and `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260921153903`.
- Live post-deploy service-aware backup: `/Volumes/Avalon/backups/operation-skuld/live-post-1.4.5-20260921T155832Z/service-aware`.
- Final encrypted secret bundle: `/Volumes/Avalon/backups/operation-skuld/live-1.4.5-20260921T155352Z/secrets/secrets-20260921T155354Z`.
- Final live acceptance: doctor `0 failure(s), 0 warning(s)`; migration readiness `OPERATION_SKULD=READY`; storage state truthfully `critical` (external `warning`) with all target free bytes above the acknowledged 10 GiB hard minimum; scheduler checks loaded; exact 9Router isolated restore passed.
- Final tracked report: `docs/reports/AMADEUS_1_4_5_DEPLOYMENT.md`.

## Compact evidence policy

Record command name, exit status, duration, and bounded output in phase evidence. Do not store prompts, secret values, private messages, or raw service credentials. Live state belongs outside Git under the verified Operation Skuld backup root; this file records only paths and pass/fail facts.
