# R1 Battle & Match Reconstruction — evaluation

Updated: 2026-10-16
Branch: `research/pubg-intelligence`
Schema/parser: `1` / `battle-reconstruction-v1`

## Scope and method

R1 reads a read-only Lab snapshot. It uses the existing PUBG Domain telemetry normalizer and `combatEventKey`; raw source rows are not written back. A match is fetched only after the operator opens its reconstruction, and only from an HTTPS `telemetry-cdn.pubg.com` asset URL already stored in the snapshot. Redirects are rejected. The source snapshot’s SHA-256 was identical before and after the real-data run; the digest is intentionally not recorded here.

Engagement candidates are effective `DAMAGE`, `KNOCK`, and `KILL` records with known participants. Known team IDs form a team-pair key; if a team is unknown, the participant ID is used as that side’s fallback key. Same-team records are excluded. A new contact joins the active pair episode when the gap from the last contact is at most 28 seconds. A matching kill may extend a pending knock episode for up to 120 seconds. Context events are assigned only to one nearest episode within −5/+28 seconds; ties are left unassigned and counted. Positions retain the first valid sample per player per 15-second bucket. Knock outcomes and team states are based on observed events; missing evidence stays unknown. Explicit post-match `common.isGame` signals stay unknown and are excluded from engagement/circle context. Circle transitions mean a change between consecutive in-match periodic circle samples, not an inferred server-side phase boundary.

Episode IDs are deterministic hashes of the match, team/player pair, parser/schema versions, and source contact IDs. Source timeline references remain `telemetry-N`; player/team references returned to the UI are match-scoped hashes. Each event and circle transition points back to its underlying telemetry source event.

## Fixed sanitized fixture

The fixture has three manually annotated A/B engagements (10–28s, 60–80s, and a later single-contact episode), plus one same-team damage negative example. It also exercises revive and kill outcomes, zone changes, position sampling, overlap, ambiguous context, duplicate DBNOs, missing timestamps, explicit post-match phase, team conflicts, and exact boundary values.

| Measure | Result |
| --- | ---: |
| Annotated fixture episodes | 3 |
| Matched episodes (TP) | 3 |
| Unsupported episodes (FP) | 0 |
| Missed annotated episodes (FN) | 0 |
| Fixture precision / recall | 3/3 / 3/3 (100% / 100%, fixture only) |
| Same-team negative example excluded | 1/1 |
| Duplicate timeline assignment | 0 |

These fixture scores describe only this small deterministic corpus; they are not a historical-data accuracy claim. Boundary tests prove that 28 seconds and 120 seconds are inclusive, while one second beyond each threshold splits/does not attach. The overlap fixture retains both team-pair episodes, drops a tied context event, and reports zero duplicate event assignments.

## Real snapshot check

The local API was exercised against one actual snapshot match with a stored telemetry asset. The browser/API response returned HTTP 200 and `available` with parser `battle-reconstruction-v1`.

| Measure | Observed |
| --- | ---: |
| Raw telemetry rows | 39,373 |
| PUBG Domain normalized events | 35,202 |
| Battle-normalized events | 16,177 |
| Contact events | 5,684 |
| Reconstructed episodes | 10 |
| Circle samples / changed samples | 167 / 24 |
| Contact events assigned to episodes | 173 |
| Unassigned contact events | 5,511 |
| Duplicate source records / duplicate timeline assignments | 0 / 0 |
| Overlapping episode pairs | 9 |
| Ambiguous context events left unassigned | 256 |
| Positions suppressed by 15-second sampling | 100 |
| Shared circle-sample context references | 40 |
| Knock chains without an observed outcome in-window | 0 |
| Revives without one unique matching knock | 24 |
| Contacts excluded for unknown phase / circle samples with unknown phase | 4,298 / 125 |

The 5,511 unassigned contacts break down into 4,298 with unknown/post-match phase, 553 without both participants, 530 same-team contacts, and 130 ineffective damage records; untimed, pre-match, unknown-team, and duplicate-source contact counts were each zero in this sample. State conflict count is 10 distinct source events across episode-scoped state replays; per-episode conflict counts are also shown in the UI.

Manual review covered the first eight episodes by start time. All eight had at least one damage/knock/kill anchor with two different team references, and every timeline event linked to an evidence reference. Seven episodes had a knock and their displayed first knock matched the earliest knock in that episode; one damage-only episode had no knock and remained explicitly without a first-knock claim. A same-team damage record in the in-match phase was checked as a counterexample and was excluded from all episode timelines. The reviewed window contained eight overlapping episode-pair combinations with distinct team-pair references; context ambiguity was surfaced rather than force-assigned.

This is a one-match, eight-episode manual check. It does not estimate historical recall: the full snapshot match set has no independent episode annotation corpus yet. The exact excluded-event and ambiguity counts above are published so follow-up annotation can identify misses.

## Known limits

- The real-data check covers one match, not a stratified holdout. Do not generalize the fixture score or reviewed subset to the whole cache.
- `unassignedContactEventCount` includes non-participant, same-team, ineffective, duplicate, pre-match, and untimed source contacts; the typed counters explain these categories.
- Position records are sparse samples; the retained point is not a continuous path. No line-of-sight or causal inference is made.
- Team state summaries cover telemetry-observed members only. Absence of a record does not mean alive, dead, or rescued.
- A periodic circle change is not proof of the exact gameplay phase transition time.
- Signed asset URLs are held in server memory only and are never returned to the browser or persisted by the experiment store.
