# R2 — Tactical and social algorithms

Updated: 2026-10-16
Branch: `research/pubg-intelligence`
Rule version: `tactical-social-rules-v1`
Intermediate schema: `1`

## Scope and method

R2 adds deterministic, versioned candidates to `packages/pubg-intelligence` and exposes them in the Lab match drilldown and scoped recurrent-pair query. Each candidate carries a rule ID/version, numerator, denominator, sample size, value/unit, quality grade/reasons, assumptions, and support/counterexample references. Candidate IDs are derived from the rule/schema version, match scope, rule, pair references, and supporting evidence. Player references used across matches are stable pseudonyms; the UI resolves labels only within the selected squad scope.

The Lab SQLite source was opened read-only and copied using SQLite's backup API to a temporary local snapshot. `PRAGMA integrity_check` returned `ok`. Experiment writes went to a separate temporary SQLite file. The production source file's before/after fingerprints matched; no Lab or Gate production deployment or data was changed. Neither the snapshot nor experiment database is in the repository.

The live verification queried the latest 30 snapshot matches with telemetry for the selected squad, using the same date/squad filters as the UI. The 30 matches all analyzed successfully. A single-match drilldown returned tactical candidates and references scoped to the selected match. Of 46 displayed references, 40 identify a source event; six are explicitly match-level absence references for a pair with no joint engagement to cite. All references identify a match; references that name an event carry its source event ID and time. The API caps evidence lists per candidate, so these are review links, not exhaustive event exports.

## Rule and denominator contract

| Rule ID | Unit and denominator |
| --- | --- |
| `combat.first-knock-share` | Tracked-squad episodes with a first knock and identifiable attacker/team; numerator is episodes whose first attacker belongs to the selected squad. Episodes without a knock are not opportunities. |
| `combat.follow-up-hit-window` | Selected-squad first-knock episodes with a known victim team; numerator has at least one later effective DAMAGE/KNOCK/KILL against that team within 30 seconds. |
| `combat.knock-kill-conversion` | Only uniquely reconstructed outcomes (KILL or REVIVE) for the tracked first knock; numerator is KILL. Unresolved outcomes are excluded and reported as incomplete, not treated as failures. |
| `coordination.sampled-teammate-distance` | Same-team player pairs with valid positions in the same 15-second bucket; reports mean XY distance in telemetry coordinate units. No line-of-sight inference. |
| `coordination.combat-onset-separation` | Synchronized teammate position pairs in the 15-second bucket containing a tracked episode's onset; reports mean XY distance. Episodes without a valid pair remain unknown. |
| `coordination.sampled-isolation-candidate` | Episodes with a tracked contact and at least two teammate samples; candidate requires exactly one tracked contact participant and every sampled teammate farther than 1,000 XY units. It does not infer visibility or communication. |
| `coordination.response-after-ally-knock` | Timed, team-attributed knocks against a tracked player; numerator has a different tracked teammate make an effective action against the same opponent team within 30 seconds. |
| `social.directed-friendly-damage` | Known same-team DAMAGE events between two selected-squad players; numerator requires positive damage and `hit=true`. Actor → victim direction is retained. |
| `social.directed-rescue` | Timed knocks of selected-squad members with known victim team; numerator is a one-to-one same-victim REVIVE match within 120 seconds. Untimed or conflicting rows lower completeness. |
| `social.shared-engagement-pair` | For each player pair and match, episodes in which either member has a contact event; numerator is episodes in which both members have contact events. Joint presence is not a relationship claim. |
| `social.recurrent-shared-engagement-pair` | Across eligible scoped matches, denominator is matches with in-match telemetry; numerator is matches with at least one shared engagement. A candidate needs support in at least three distinct matches. |
| `social.friendly-fire-followed-by-rescue` | Confirmed directed friendly-damage events; numerator has a same-actor, same-victim REVIVE within 120 seconds. It describes an event sequence, not intent or humor. |
| `rotation.engagement-near-circle-transition` | Tracked episodes; numerator has an observed safety/poison-circle radius transition within ±60 seconds of episode start. No causal claim. |
| `rotation.sampled-movement` | Adjacent valid positions for a selected-squad player separated by 0–30 seconds; reports summed XY displacement / summed elapsed seconds. Missing gaps are not interpolated. |
| `rotation.explicit-blue-zone-damage` | Positive in-match damage to selected-squad players with a non-empty `damageReason`; numerator explicitly names BlueZone/Poison. `isInBlueZone` alone is not treated as cause. |

Quality grades are transparent: high requires at least 10 samples and complete required fields; moderate requires 4–9 and complete fields; low covers 1–3 samples or incomplete fields; insufficient means no valid denominator. Unknown and missing states stay null/incomplete rather than being converted to zero.

## Real-snapshot coverage

Coverage for 30 selected-squad matches (support/counterexample counts are distinct cited event references returned by the API; event lists are capped per candidate):

| Rule ID | Evaluated / 30 | Unknown / 30 | Sample size | Support refs | Counterexample refs |
| --- | ---: | ---: | ---: | ---: | ---: |
| `combat.first-knock-share` | 30 | 0 | 32 | 25 | 5 |
| `combat.follow-up-hit-window` | 30 | 0 | 27 | 30 | 4 |
| `combat.knock-kill-conversion` | 30 | 0 | 25 | 32 | 2 |
| `coordination.combat-onset-separation` | 6 | 24 | 26 | 27 | 2 |
| `coordination.response-after-ally-knock` | 30 | 0 | 6 | 8 | 2 |
| `coordination.sampled-isolation-candidate` | 30 | 0 | 17 | 16 | 19 |
| `coordination.sampled-teammate-distance` | 13 | 17 | 1,457 | 104 | 104 |
| `rotation.engagement-near-circle-transition` | 30 | 0 | 64 | 70 | 17 |
| `rotation.explicit-blue-zone-damage` | 20 | 10 | 902 | 0 | 136 |
| `rotation.sampled-movement` | 20 | 10 | 1,338 | 130 | 138 |
| `social.directed-friendly-damage` | 30 | 0 | 33 | 24 | 0 |
| `social.directed-rescue` | 30 | 0 | 6 | 2 | 5 |
| `social.friendly-fire-followed-by-rescue` | 30 | 0 | 33 | 0 | 24 |
| `social.shared-engagement-pair` | 19 | 11 | 27 | 52 | 34 |

The cross-match query produced six recurrent-pair candidates: one met the three-match support threshold and five did not. All six were graded low because source completeness was insufficient; their per-candidate denominators ranged from 8 to 11 eligible matches, with 1–3 supporting matches. Thus the current data does not support a high-confidence “regular duo” claim. Blue-zone damage had no explicit BlueZone/Poison positive reason in the scoped rows; 10/30 matches lacked evaluable reason coverage. This is an availability limitation, not evidence that the squad took no blue-zone damage.

## Fixture and edge-case verification

The sanitized fixtures assert deterministic replay and stable candidate IDs; no duplicate normalized source events; event references stay within the exact match; directional actor/victim references; explicit denominator/sample/value fields; and null/incomplete outcomes for empty or incomplete data. Boundary tests cover inclusive 30-second follow-up/response windows, exclusion after the boundary, the strict `>1,000` isolation threshold, repeated-pair minimum of three matches, missing coordinates/timestamps/team attribution, circle transitions, and explicit damage reasons. No fixture or rule encodes a specific player name or a preselected insight.

The match-only `no-joint-engagement-observed` counterexample has a precise match citation but no event ID because absence is not a source event. Analysts can reject it by inspecting that match's event/episode drilldown. All positive shared-engagement support is event-cited.

## Verification evidence

- `pnpm --filter @agent/pubg-intelligence typecheck`
- `pnpm --filter @agent/pubg-intelligence test` — 19 passed
- `pnpm --filter @agent/pubg-intelligence build`
- `pnpm --filter @agent/pubg-intelligence-lab typecheck`
- `pnpm --filter @agent/pubg-intelligence-lab test` — 1 passed
- `pnpm --filter @agent/pubg-intelligence-lab build`
- `pnpm check:secrets`
- `git diff --check`
- Live page, bootstrap, match list, scoped single-match analysis, and 30-match recurrent-pair API returned HTTP 200 at `http://192.168.5.3:4179`.

## Limitations

- The evaluated real-data slice is 30 matches because the API intentionally caps a query at 30. It is a recent telemetry-backed slice, not a stratified holdout.
- Position evidence is sampled and sparse; 17/30 matches could not evaluate general teammate distance, and 24/30 could not evaluate onset separation.
- The source does not provide explicit blue-zone damage reasons in this slice, so causal attribution is deliberately withheld.
- Incomplete/unrecognized or untimed source rows downgrade pair-candidate quality. This report does not claim precision/recall against an independently labeled R2 benchmark; analyst corrections belong to R4.
