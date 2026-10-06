# Amadeus Krea2 local fallback paused — 2026-10-06

## Operator decision

The operator requested that the local Krea2 deployment be paused and the live
runtime restored before the candidate rollout. The forced WhatsApp fallback
acceptance was not completed, so the goal is not released or version-bumped.

## Runtime after rollback

- OpenClaw: `local/openclaw-amadeus:git-0a062a1c2c13-20261005153543`
- 9Router: `local/9router:git-0a062a1c2c13-20261005T153458Z`
- OpenClaw image base URL: `http://9router:20128/v1`
- Image timeout: restored to the pre-candidate 120000 ms value
- Krea bridge: stopped; loopback port 18793 is closed
- Synthetic primary test endpoint: stopped; port 18796 is closed
- OpenClaw health: `{"ok":true,"status":"live"}`
- WhatsApp: connected, healthy, lifecycle `ready`

Rollback sources:

- `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261006100001`
- `/DATA/AppData/9router/backups/router-upgrade-20261006T095859Z`
- `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261006100422` (candidate
  and forced-test recovery checkpoint)

## Acceptance evidence retained

- Healthy primary WhatsApp acceptance succeeded before the forced test and sent
  one native image attachment.
- Reference-image requests failed closed when the primary was unavailable.
- Local Krea direct and bridge smoke tests passed, including cold and warm
  benchmarks.
- Two live forced-primary text-to-image attempts reached the local engine but
  exceeded the 600-second deadline; no successful WhatsApp local-fallback
  acceptance was claimed.

## Source state

The repository retains the candidate source and the bounded retry/timeout
cleanup commit `308bb97`, but it is not deployed after this rollback.
