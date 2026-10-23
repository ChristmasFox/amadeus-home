# R4 — Experiment and evaluation loop

Updated: 2026-10-17  
Branch: `research/pubg-intelligence`  
Evaluation manifest: `1`  
Evaluation engine: `pubg-intelligence-evaluation-v1`  
Benchmark: `pubg-intelligence-r4-first-knock-fixtures-v1`

## SOURCE_FIXED

`packages/pubg-intelligence` now provides a versioned offline evaluation API and one-command replay for a first-knock baseline/candidate comparison. The sanitized corpus has eight cases grouped into six strata and is split by whole match, avoiding event-level leakage between development and holdout. The replay runs the actual R1 normalization/reconstruction and R2 tactical analyzer; the baseline is the legacy “any tracked knock in match” rule and the candidate is `combat.first-knock-share` from `tactical-social-rules-v1`.

Every run records a SHA-256 dataset fingerprint, parser/rule versions, thresholds, split and stratum counts, runtime and process memory, template numeric parity/diversity, metrics, false-positive/false-negative changes, unresolved labels, abstentions, and evidence-linked counterexamples. The Lab has a replay/registry/counterexample panel and bounded human labels (`confirm`, `reject`, `unresolved`, `wrong_evidence`). Evaluation reports and review labels are stored only in the separate local experiment database. The production Lab snapshot is opened read-only and was not changed.

Command:

```sh
pnpm --filter @rine-kit/pubg-intelligence evaluation:replay
```

## BUILD_VERIFIED

- `pnpm --filter @rine-kit/pubg-intelligence build` — passed.
- `pnpm --filter @rine-kit/pubg-intelligence test` — 29 passed.
- `pnpm --filter @agent/pubg-intelligence-lab typecheck` — passed.
- `pnpm --filter @agent/pubg-intelligence-lab test` — 2 passed.
- `pnpm --filter @agent/pubg-intelligence-lab build` — passed.
- `pnpm check:secrets` — passed.
- `git diff --check` — passed.
- One-command replay — completed and persisted a versioned experiment report to a separate local experiment database.

The replayed fixture corpus had eight cases (three development, five holdout) across six strata. Holdout included three labeled cases and two unresolved cases. On labeled holdout, baseline counts were TP=1, FP=1, FN=0, TN=1 (precision 0.50, recall 1.00, F1 0.67); candidate counts were TP=1, FP=0, FN=0, TN=2 (precision/recall/F1 1.00). The observed deltas were FP −1 and FN 0. These are fixture-only results and must not be read as historical match performance.

The template check retained identical numeric facts across three templates and generated three distinct wordings. The three non-null holdout expectations are fixture ground truth, not analyst review. Human template-preference and benchmark-review labels have not been collected. The live `wrong_evidence` request was an API persistence smoke check, not an analyst judgment. The report keeps the promotion gate closed: the holdout is small and synthetic, two labels are unresolved, and there is no independently labeled historical holdout. No candidate promotion is authorized by this result.

## LIVE_VERIFIED

The local page at `http://192.168.5.3:4179` returned HTTP 200; the Vite client module and `/api/bootstrap` also returned HTTP 200. Bootstrap showed 543 cached matches and 283 with telemetry features. `POST /api/evaluations/replay` returned 201 with eight case outcomes and the fixture metrics above. A bounded `wrong_evidence` review write returned 201, and the run appeared in the evaluation registry. The read-only source snapshot fingerprint matched before and after replay/review operations.

The live review API persistence check used a sanitized fixture case only. No analyst conclusion is claimed. No production Lab/Gate deployment, production-data write, external model call, or historical-label promotion was performed.

## Limitations and next-stage entry

- The available independently reviewed historical holdout for this R4 label is zero. A prior episode audit does not label first-knock ownership under this benchmark contract, so it is not reused as a substitute.
- The fixture corpus has only eight cases. Its small sample is useful for deterministic regression mechanics, not statistical claims.
- The report includes false-positive and false-negative evidence links and unresolved examples, but useful human preference labels require analyst review.
- R5 may consume only the stable deterministic package API and Gate-owned authorized data. It must not ingest Lab experiment results or access the Lab SQLite database.

## RELEASED

Stage implementation is committed on `research/pubg-intelligence`; no product release or production deployment occurred.
