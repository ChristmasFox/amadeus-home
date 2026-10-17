# R2 — Tactical and social algorithms, including combat dynamics V2

Updated: 2026-10-17
Branch: `main`
Rule version: `tactical-social-rules-v2`
Intermediate schema: `2`

## Scope and method

R2 extends the existing `packages/pubg-intelligence/src/tactics.ts` and battle reconstruction pipeline. The new V2 candidates describe first-knock observed advantage duration, knock-balance reversal, effective contact after the first knock, and possible third-party contact. Each candidate carries a rule ID/version, numerator, denominator, sample size, value/unit, quality grade/reasons, assumptions, and support/counterexample references. Candidate IDs are derived from the rule/schema version, match scope, rule, pair references, and supporting evidence. Player references used across matches are stable pseudonyms; the UI resolves labels only within the selected squad scope.

The Lab SQLite source was opened read-only and copied using SQLite's backup API to a temporary local snapshot. `PRAGMA integrity_check` returned `ok`. Experiment writes went to a separate temporary SQLite file. The production source file's before/after fingerprints matched; no Lab or Gate production deployment or data was changed. Neither the snapshot nor experiment database is in the repository.

The live verification queried the latest 30 snapshot matches with telemetry for the selected squad, using the same date/squad filters as the UI. The 30 matches all analyzed successfully. A single-match drilldown returned tactical candidates and references scoped to the selected match. Of 46 displayed references, 40 identify a source event; six are explicitly match-level absence references for a pair with no joint engagement to cite. All references identify a match; references that name an event carry its source event ID and time. The API caps evidence lists per candidate, so these are review links, not exhaustive event exports.

## Rule and denominator contract

| Rule ID | Unit and denominator |
| --- | --- |
| `combat.first-knock-share` | Tracked-squad episodes with a first knock and identifiable attacker/team; numerator is episodes whose first attacker belongs to the selected squad. Episodes without a knock are not opportunities. |
| `combat.follow-up-hit-window` | Selected-squad first-knock episodes with a known victim team; numerator has at least one later effective DAMAGE/KNOCK/KILL against that team within 30 seconds. |
| `combat.knock-kill-conversion` | Only uniquely reconstructed outcomes (KILL or REVIVE) for the tracked first knock; numerator is KILL. Unresolved outcomes are excluded and reported as incomplete, not treated as failures. |
| `combat.first-knock-observed-advantage-duration` | Battle groups with an identifiable first knock and a subsequent observed knock-balance window; reports seconds until balance equalizes/reverses or the group ends. This covers observed knock state only, not whole-team strength. |
| `combat.observed-knock-advantage-reversal` | Current-squad-related observed knock-balance transitions where a prior lead existed; numerator is transitions where the other side becomes the observed leader. Unknown roster members are not counted. |
| `combat.subsequent-contact-after-first-knock` | Current-squad first knocks with known attacker and victim teams; numerator has a later effective DAMAGE/KNOCK/KILL by the same attacking team against the same victim team within 30 seconds. |
| `combat.possible-third-party-contact` | Current-squad battle groups with at least three known team references; candidate tag requires overlapping team-pair episode contact evidence. It does not establish third-party intent or causality. |
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

## Historical V1 real-snapshot coverage

The table below records the earlier `tactical-social-rules-v1` run on 30 selected-squad matches. It is retained as historical evidence and must not be read as V2 output. V2's full 100-match combat comparison and new rule measures follow it.

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

## V2 combat-dynamics comparison on the full archive

The baseline is the V1 implementation from main commit `07b48340caa8e489272120620107adcef6e2105a`; V2 uses the existing `battle.ts` and `tactics.ts` pipeline. All 100 archived entries matched a database row and a readable payload. SQLite and the raw archive were read-only. Reconstruction counters include all teams; tactical rule metrics use the first local squad-builder result consistently for both versions.

| Measure across 100 matches | V1 | V2 |
| --- | ---: | ---: |
| Team-pair episodes | 1,763 | 6,478 |
| Contact sources unassigned | 400,248 | 372,362 |
| Unknown-phase contacts | 313,128 | 0 |
| First-knock share | 62 / 82 (75.6%) | 167 / 279 (59.9%) |
| Follow-up effective contact | 54 / 62 (87.1%) | 135 / 167 (80.8%) |
| Knock-to-kill among uniquely resolved outcomes | 53 / 56 (94.6%) | 116 / 146 (79.5%) |

V2 added 27,886 assigned contact sources and removed none that V1 had assigned. Episode signatures had 1,709 unchanged, 4,769 new, and 54 absent from V2. These changes reflect different opportunity sets after correcting the phase interpretation and retaining additional pair episodes; they are not labeled true/false positives or misses. The first-knock, follow-up, and conversion rates in the table are scoped to the selected squad, unlike reconstruction counts above.

| New V2 candidate | Archive result |
| --- | --- |
| First-knock observed advantage duration | 249 windows in 68 matches; total 6,294.1 seconds, mean 25.3 seconds. Thirty-two matches had no evaluable window. |
| Observed knock-balance reversal | 145 reversals among 517 prior-lead transitions; 1,743 observed change samples across 100 matches. |
| Subsequent contact after first knock | 102 / 124 opportunities (82.3%) across 100 matches. |
| Possible third-party contact | 109 candidate tags among 109 selected-squad groups with at least three known team references. This is a generated candidate count, not a correctness rate. |

The archive-wide V2 reconstruction produced 4,822 battle groups, including 744 groups with at least three known team references and 743 with a possible third-party tag. It also emitted 7,131 observed knock-balance windows, 761 reversals, and 1,450 groups with a post-knock response. Details and the real-match example are in [`R1_EVALUATION.md`](R1_EVALUATION.md).

The cross-match query produced six recurrent-pair candidates: one met the three-match support threshold and five did not. All six were graded low because source completeness was insufficient; their per-candidate denominators ranged from 8 to 11 eligible matches, with 1–3 supporting matches. Thus the current data does not support a high-confidence “regular duo” claim. Blue-zone damage had no explicit BlueZone/Poison positive reason in the scoped rows; 10/30 matches lacked evaluable reason coverage. This is an availability limitation, not evidence that the squad took no blue-zone damage.

## Fixture and edge-case verification

The sanitized fixtures assert deterministic replay and stable candidate IDs; no duplicate normalized source events; event references stay within the exact match; directional actor/victim references; explicit denominator/sample/value fields; and null/incomplete outcomes for empty or incomplete data. Boundary tests cover inclusive 30-second follow-up/response windows, exclusion after the boundary, the strict `>1,000` isolation threshold, repeated-pair minimum of three matches, missing coordinates/timestamps/team attribution, circle transitions, and explicit damage reasons. No fixture or rule encodes a specific player name or a preselected insight.

The match-only `no-joint-engagement-observed` counterexample has a precise match citation but no event ID because absence is not a source event. Analysts can reject it by inspecting that match's event/episode drilldown. All positive shared-engagement support is event-cited.

## Verification evidence

- `pnpm --filter @agent/pubg-domain test` — 41 passed, including the documented `common.isGame` phase boundaries.
- `pnpm --filter @agent/pubg-intelligence test` — 41 passed, including overlap grouping, no-time-only merging, timeline/reversal evidence, and persistent review labels.
- `pnpm --filter @agent/pubg-intelligence typecheck` and `build`.
- `pnpm --filter @agent/pubg-intelligence-lab test` — 4 passed, including archived-only reconstruction and review write/read.
- `pnpm --filter @agent/pubg-intelligence-lab typecheck` and `build`.
- `pnpm check:secrets` and `git diff --check` are run at the source commit boundary.
- The full 100-match comparison is reproduced from the local snapshot and raw archive; no Lab or Gate deployment is part of this V2 change.

## Limitations

- The evaluated real-data slice is 30 matches because the API intentionally caps a query at 30. It is a recent telemetry-backed slice, not a stratified holdout.
- The V2 combat comparison uses the complete local archive of 100 matches, but still lacks independent event/engagement labels. V2 false-positive count, missed-engagement count, precision, and recall remain unknown.
- The 30-match rule-coverage table above is V1 historical data; other coordination, social, and rotation rollups have not been recomputed for V2 in this report.
- Position evidence is sampled and sparse; 17/30 matches could not evaluate general teammate distance, and 24/30 could not evaluate onset separation.
- The source does not provide explicit blue-zone damage reasons in this slice, so causal attribution is deliberately withheld.
- Third-party tags are time/team-overlap candidates, not verified third-party attacks. Knock advantage counts only observed members and never supplies a full 4v4 state.
- Incomplete/unrecognized or untimed source rows downgrade candidate quality. Analyst labels remain local and do not alter rules or teach the system automatically.
