# Amadeus 1.4.8 — Workstation Authority Handoff Addendum

## Purpose

This addendum extends the final Operation Skuld cutover so that the migration transfers not only HomeLab/OpenClaw production authority, but also the operator's active development/Codex workstation authority from the old Mac to `Amadeus-M204`.

After final cutover, all new Amadeus/HomeLab development, Codex goals, repository changes, migration follow-up, maintenance and future requirements MUST originate from `Amadeus-M204` unless an explicit rollback is declared.

The old Mac becomes rollback-only and must no longer be used as the normal Codex execution host.

## Authority Model

Before final commit:

```text
old Mac            = legacy development authority + rollback source
Amadeus-M204       = destination candidate
```

After `COMMIT_SKULD_CUTOVER_1_4_8`:

```text
Amadeus-M204       = canonical workstation authority
Amadeus-M204 Codex = only normal executor for new goals/tasks
old Mac            = ROLLBACK_ONLY
old Mac Codex      = NO_NEW_WORK
```

Required final state:

```text
WORKSTATION_AUTHORITY=Amadeus-M204
CODEX_EXECUTION_AUTHORITY=Amadeus-M204
OLD_MAC_CODEX_MODE=rollback-only
OLD_MAC_ACCEPTS_NEW_REQUIREMENTS=NO
```

## Handoff Requirements

Before final cutover commit, verify on `Amadeus-M204`:

- canonical repository exists and is clean or intentionally committed;
- `origin` points to `ChristmasFox/amadeus-home`;
- GitHub SSH works from the M204 machine identity;
- Node/pnpm/Python/Git/tmux and required local development tooling are available;
- OrbStack `nyannyan` guest is the canonical destination guest;
- Codex can operate from the M204 repository and can read the repository execution contract;
- no required workflow depends on `/Users/blacksidev`, `/home/blacksidev`, or the old Mac hostname;
- host-specific configuration uses `Amadeus-M204`, `/Users/nyannyan`, `/home/nyannyan`, and `ORBSTACK_MACHINE=nyannyan`;
- future migration/maintenance evidence is written from the M204 working copy.

## Old Mac Closure

After `COMMIT_SKULD_CUTOVER_1_4_8`, the old Mac must not receive new normal development work.

Do not delete it immediately. Preserve it as a rollback asset, but mark its operating policy explicitly:

```text
OLD_MAC_ROLE=rollback-only
OLD_MAC_CODEX_MODE=rollback-only
OLD_MAC_NEW_GOALS=forbidden
OLD_MAC_PRODUCTION_OPENCLAW=disabled
OLD_MAC_OWNER_INGRESS=disabled
```

Recommended protection:

- keep the old repository and state intact for the rollback window;
- do not continue feature development from its working copy;
- do not run `/goal` for new requirements there;
- do not push normal post-cutover feature commits from the old Mac;
- only use old-Mac Codex for rollback diagnosis or recovery explicitly authorized as rollback work;
- if the old Mac is booted during the rollback window, it must not auto-resume production OpenClaw or take development authority back.

## Repository / Branch Continuity

At handoff time, `Amadeus-M204` must pull/fetch the final committed `main` and verify its local HEAD matches the intended authoritative remote commit.

After final cutover, new work should follow:

```text
new requirement
    -> Amadeus-M204
    -> /Users/nyannyan/agent-monorepo
    -> Codex
    -> test / commit / push
```

The old Mac must not independently continue from a diverged working tree.

## Final Cutover Integration

`COMMIT_SKULD_CUTOVER_1_4_8` now also authorizes workstation authority transfer.

When that token is executed successfully, record all of the following:

```text
DESTINATION_AUTHORITY=Amadeus-M204
SOURCE_AUTHORITY=retired
OPERATION_SKULD_CUTOVER=COMMITTED

WORKSTATION_AUTHORITY=Amadeus-M204
CODEX_EXECUTION_AUTHORITY=Amadeus-M204
OLD_MAC_CODEX_MODE=rollback-only
OLD_MAC_ACCEPTS_NEW_REQUIREMENTS=NO
```

The 72-hour rollback window remains valid, but rollback-only does not mean dual development authority. During the window, all normal new work still belongs on M204.

If an actual rollback is declared, first stop M204 authority and reconcile any post-cutover repository/runtime delta before temporarily restoring the old Mac as authority.

## Definition of Done

The workstation handoff is complete when:

```text
M204 OpenClaw authority        = active
M204 owner channels            = accepted
M204 repository                = canonical
M204 Codex                     = canonical executor
old Mac OpenClaw               = disabled
old Mac owner ingress          = disabled
old Mac Codex                  = rollback-only
new requirements on old Mac    = forbidden
rollback assets                = preserved
```

From that point onward, `Amadeus-M204` is both the HomeLab production authority and the development/workstation authority for Amadeus.
