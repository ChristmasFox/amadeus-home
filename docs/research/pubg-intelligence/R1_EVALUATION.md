# R1 Battle & Match Reconstruction — V2 evaluation

Updated: 2026-10-17
Branch: `main`
Schema/parser: `2` / `battle-reconstruction-v2`
Tactical rules: `tactical-social-rules-v2`

## Phase diagnosis from the raw archive

PUBG defines `common.isGame` as the blue-zone/safe-zone phase. `0` means before lift off, `0.1` means on the airplane, `0.5` means before a zone appears, `1.0` is the first safe zone, and each later `0.5` value is a subsequent zone transition. Values `2.0` and above therefore describe later in-match zone phases, not post-match events ([PUBG telemetry objects](https://documentation.pubg.com/en/telemetry-objects.html)).

R1 V1 incorrectly treated numeric `common.isGame >= 2` as post-match/unknown. V2 follows the documented phase signal: numeric values below `1` are `pre_match`, values `1` and above are `in_match`, and missing or invalid values stay `unknown` unless a separate reliable event-time signal resolves the phase. Pre-match contacts are excluded and counted; unknown-phase contacts remain excluded and counted separately from untimed, same-team, ineffective, and unknown-team contacts.

The read-only audit covered all 100 locally archived telemetry payloads. Every archive entry had a matching Lab match row and readable payload.

| Archive-wide phase evidence | Count |
| --- | ---: |
| Raw telemetry rows | 3,316,224 |
| `ATTACK` / `DAMAGE` / `KNOCK` / `KILL` records | 976,882 |
| Records with numeric `common.isGame >= 2` | 598,792 |
| `>= 2` records normalized as `in_match` by PUBG Domain | 598,792 |
| `>= 2` records at or before match duration + 30 seconds | 598,790 |
| Remaining timestamp outliers | 2 `LogPlayerAttack` records |

The two timestamp outliers are attack records, not the effective `DAMAGE`/`KNOCK`/`KILL` episode anchors. The phase field still identifies them as in-match zone phases; the outlier timing remains a separate audit observation. In the archive-wide V1/V2 comparison below, unknown-phase contact counts fell from 313,128 to 0. Missing or malformed phase and time are still represented as unknown, not as an inferred post-match phase.

## Method and comparison

The reconstruction comparison used all teams and the same 100 archived matches for both versions. Tactical rule metrics use the first squad returned by the existing local squad builder. The baseline implementation was copied from main commit `07b48340caa8e489272120620107adcef6e2105a`; V2 runs the existing `battle.ts` and `tactics.ts` pipeline. SQLite was opened read-only and raw telemetry was read from the verified local archive; there was no CDN fallback or source-cache write.

| Archive-wide reconstruction measure | V1 baseline | V2 candidate | Difference |
| --- | ---: | ---: | ---: |
| Raw telemetry rows | 3,316,224 | 3,316,224 | 0 |
| Battle-normalized `DAMAGE` / `KNOCK` / `KILL` records before assignment | 414,015 | 414,015 | 0 |
| Team-pair episodes | 1,763 | 6,478 | +4,715 |
| Contact events left unassigned | 400,248 | 372,362 | −27,886 |
| Unknown-phase contacts | 313,128 | 0 | −313,128 |

Contact-event signatures (sorted team references plus source contact IDs) had 1,709 unchanged signatures, 4,769 new V2 signatures, and 54 V1 signatures absent from V2. These are structural differences, not true-positive, false-positive, or false-negative counts. V2 newly assigned 27,886 contact sources and removed no previously assigned source contacts in this run.

V2 produced 4,822 battle groups: 744 had at least three known team references, 743 carried a possible third-party contact tag, 7,131 observed knock-balance windows, 761 observed reversals, and 1,450 groups with a post-knock response. These are candidate counts from telemetry, not adjudicated accuracy measures.

## Real match example

In archived match ordinal 39 (match ID and player labels intentionally omitted), V1 produced one episode; V2 produced 79 team-pair episodes and 43 groups, including 11 groups with at least three known team references.

One two-team episode ran from 505.280 to 543.800 seconds. The first observed knock was `telemetry-17617` at 511.268 seconds. The corresponding observed knock-balance lead lasted 4.994 seconds; a later reversal was recorded at 516.790 seconds by `telemetry-17865`. The UI links these times to the raw event references. This is a concrete reconstruction example, not a human-confirmed correctness label.

## Rule-level comparison

Across the same 100 matches, opportunity sets changed as V2 recovered more phase-valid contacts and pair episodes. Rates below describe the resulting opportunities; they do not measure algorithm accuracy.

| Rule | V1 baseline | V2 candidate |
| --- | ---: | ---: |
| First-knock share | 62 / 82 (75.6%) | 167 / 279 (59.9%) |
| Follow-up effective contact | 54 / 62 (87.1%) | 135 / 167 (80.8%) |
| Knock-to-kill among uniquely resolved outcomes | 53 / 56 (94.6%) | 116 / 146 (79.5%) |
| First-knock observed advantage duration | unavailable in V1 | 249 windows across 68 matches; mean 25.3 seconds; 32 matches had no evaluable window |
| Observed knock-balance reversal | unavailable in V1 | 145 reversals / 517 prior-lead transitions; 1,743 observed change samples |
| Effective contact after the tracked squad's first knock | unavailable in V1 | 102 / 124 opportunities (82.3%) |
| Possible third-party contact | unavailable in V1 | 109 candidate groups among 109 selected-squad multi-team groups |

The possible-third-party rule marks overlapping contact evidence and does not infer intent or causality. All four V2 dynamics rules retain event references; incomplete roster and phase evidence stays explicit.

## Known limits and open questions

- The archive has no independent per-engagement truth labels. Archive-wide false-positive count, missed-engagement count, precision, and recall are **unknown**. New or missing signatures must not be reported as errors without human labels.
- Episode boundaries still use the established 28-second contact gap and 120-second pending-knock outcome window. Their sensitivity across maps, modes, and sparse matches is not calibrated.
- Battle grouping requires overlapping episode time, a shared known team reference, and contact evidence from both episodes. Union-find can link a chain of pair overlaps transitively; human review must establish whether a long chain is one fight or several adjacent fights.
- A possible third-party tag proves only overlapping, team-attributed contact evidence. Telemetry cannot establish intent, target selection, or causal effect.
- Team states cover observed members only. The data cannot establish a complete four-player roster, missing members' alive state, line of sight, voice communication, or why a knock was not converted.
- Positions are sparse samples, not continuous paths. Future work needs a stratified, manually reviewed holdout before tuning thresholds or claiming reliability.
