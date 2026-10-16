# R3 — Natural-language research assistant and evidence presentation

Updated: 2026-10-17

Branch: `research/pubg-intelligence`

Assistant contract: `research-assistant-v1`

## SOURCE_FIXED

`packages/pubg-intelligence` now exposes a Vercel AI SDK assistant with bounded, server-registered read-only tools for match search, scoped match metrics, directed rescue comparisons, episode lookup, and evidence lookup. The server fixes the selected squad, date range, and optional match before exposing any tool. Tool parameters accept only enumerated metrics, bounded limits, `M####` match aliases, and `E####` evidence aliases; raw match IDs, account IDs, player labels, paths, phone-like values, and credential-shaped text are removed or aliased before model prompts.

The model returns a typed `fact` / `inference` / `hypothesis` contract. Every claim must cite evidence, report the exact cited-evidence count, list assumptions, and state uncertainty for inferences and hypotheses. Citation aliases must have been returned by a tool, and numeric tokens must occur in tool output; invalid output uses the deterministic fallback. Three templates alter wording only. Unsupported and known evidence-gap questions abstain without attaching unrelated match-store citations. Follow-up history is bounded and remains untrusted input.

The Lab model configuration is server-only: `PUBG_INTELLIGENCE_AI_BASE_URL`, `PUBG_INTELLIGENCE_AI_API_KEY`, and optional `PUBG_INTELLIGENCE_AI_MODEL`. The default model ID is Gemini Flash through an OpenAI-compatible route. No AI key is committed. The local experiment store remains separate from the read-only Match Store; its SQLite file is mode `0600`, newly created child directories are `0700`, and existing parent directory permissions are preserved.

## BUILD_VERIFIED

- `pnpm --filter @agent/pubg-intelligence build`
- `pnpm --filter @agent/pubg-intelligence test` — 26 passed (assistant schema/tool checks plus R1/R2 regressions).
- `pnpm --filter @agent/pubg-intelligence-lab typecheck`
- `pnpm --filter @agent/pubg-intelligence-lab test` — 2 passed.
- `pnpm --filter @agent/pubg-intelligence-lab build`
- `pnpm check:secrets` — passed.
- `git diff --check` — passed.

Fixtures exercise the AI SDK tool loop, injection strings, typed tool bounds, out-of-scope match rejection before a model call, match/player aliasing, path/phone/credential redaction, evidence-link validation, invented-number rejection, exact evidence counts, required uncertainty, missing model, unsupported question abstention, and deterministic template invariants. The API integration mock executes the actual AI SDK planner and assistant request flow; it confirms the model sees only the selected-date aggregate and no out-of-scope match/account identifiers.

## LIVE_VERIFIED

The local Lab UI and API at `http://192.168.5.3:4179` returned HTTP 200 after restart against the authorized read-only snapshot. Bootstrap reported 543 matches and 283 parser/feature-cache matches. Three scoped research requests returned HTTP 200 for the full snapshot date range:

| Request | Selected matches | Result |
| --- | ---: | --- |
| Recent average-damage trend | 543 | Local deterministic fallback, degraded due to unavailable model, with eight evidence references. |
| Why the squad often wipes in the third circle | 543 | Abstained with no claims or citations because the snapshot has no reliable circle-number and wipe-causality labels. |
| Who revives whom more often | 543 | Abstained with no claims or citations in no-model mode; aggregate Match Store revive totals do not establish pair direction. |

The snapshot SHA-256 was unchanged before and after the queries. Experiment results went to a separate temporary SQLite file. Production Lab and Gate deployments were not changed.

The current environment has no configured AI base URL or API key, so a real external Gemini/9router call was **not** live-verified. The AI SDK path, tools, and structured output were exercised with `MockLanguageModelV4`; the UI gives an explicit degraded-mode notice until an operator configures a model.

## Limitations and next-stage entry

- This proves the scoped real-data API and safe fallback behavior, not real-provider quality or latency.
- Circle number and wipe-cause labels are unavailable in the observed snapshot. The assistant does not infer them from distance, timing, or a generic circle transition.
- Directed rescue claims require event-level telemetry and a configured model or an explicit local analysis request; per-player aggregate revive totals are not treated as pair evidence.
- R4 may evaluate answer groundedness and usefulness, but no model-produced insight is promoted automatically.
