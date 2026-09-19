# Checkpoint: deployment notes are single-release summaries

- Date: 2026-09-19 Asia/Shanghai
- Scope: deployment notification source and version-management guidance
- Runtime deployment: not required; this changes the next deployment's notification body only

## Policy now enforced

- `RELEASE_NOTES.md` contains only the current version's concise additions or fixes.
- Prior release text must be replaced, not appended; unchanged capabilities are omitted.
- `scripts/amadeus-version.sh check` rejects more than one Amadeus release heading and rejects empty or
  runtime-named bodies.
- The global `/Users/blacksidev/AGENTS.md` records the same rule for future sessions.

## Current release body

`Amadeus 1.1.2` now contains only the PUBG review-ordering change. The deployment script will append the
standard `El Psy Kongroo.` closing when the next owner deployment notification is generated.
