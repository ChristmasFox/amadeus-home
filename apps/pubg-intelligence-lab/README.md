# PUBG Intelligence Lab

Local React research workspace for browsing Lab PUBG match history, selecting a discovered squad and date range, asking natural-language questions, and following analysis back to match evidence.

## Run locally

Use a standalone copy or snapshot of the Lab SQLite database. The server refuses to start without `PUBG_INTELLIGENCE_DB`; it opens that file through the PUBG Domain repository in SQLite read-only mode and does not configure the PUBG API client.

```sh
pnpm --filter @agent/pubg-domain build
pnpm --filter @agent/pubg-intelligence build
PUBG_INTELLIGENCE_DB=/path/to/read-only-snapshot.sqlite pnpm --filter @agent/pubg-intelligence-lab dev
```

The page binds to `http://127.0.0.1:4179` by default. To allow access from the same LAN, set `HOST` to the machine's private LAN IPv4 address (for example, `HOST=192.168.5.3`); public and wildcard bind addresses are rejected, and API requests are limited to peers in that interface's subnet. `PORT` changes the local port. The default experiment database is `~/.local/share/amadeus/pubg-intelligence-lab/experiments.sqlite`; set `PUBG_INTELLIGENCE_EXPERIMENT_DB` to choose another path. The app rejects a path that resolves to the same file as the match source. It creates the experiment directory with mode `0700` and the SQLite file with mode `0600`.

Date inputs use Asia/Shanghai calendar days. SQLite timestamps remain stored as UTC instants.

## Optional research model

Without model settings, a deterministic local answer is shown with a clear degraded-mode notice. If the base URL and API key below are set, the app uses Vercel AI SDK for bounded intent planning, read-only scoped tool calls, and a typed fact/inference/hypothesis presentation. Gemini Flash is the default model ID for an OpenAI-compatible router; `PUBG_INTELLIGENCE_AI_MODEL` can select another configured model such as the local 9router `arthur-combo` route. Only aliases and aggregate facts are sent in tool results; raw match/event references and player labels are resolved locally. Phone-like values, credentials, known squad names, and local file paths are redacted or aliased before model calls.

- `PUBG_INTELLIGENCE_AI_BASE_URL`
- `PUBG_INTELLIGENCE_AI_API_KEY`
- `PUBG_INTELLIGENCE_AI_MODEL` (optional; defaults to `google/gemini-2.5-flash`)

The response can use tactical coaching, squad-humor, or chronological-story wording. Templates change wording only; candidate claims are schema-validated, every claim must cite evidence returned by a read-only server tool, and unsupported numeric values or references fall back to local deterministic output. The server fixes the selected squad and date scope; model tool inputs cannot choose a tenant, file, database, or arbitrary match ID.

## Offline evaluation

Replay the checked-in sanitized benchmark without reading the Lab match snapshot:

```sh
pnpm --filter @agent/pubg-intelligence evaluation:replay
```

The runner compares the frozen `legacy-any-tracked-knock-v0` baseline with `tactical-social-rules-v1`, fingerprints the fixture corpus, and registers per-run metrics, error cases, resource use, parser/rule versions, and thresholds in the separate experiment SQLite file. The page's **实验登记 / 反例浏览** panel runs the same replay and stores bounded review labels (`confirm`, `reject`, `unresolved`, `wrong_evidence`) locally. Labels do not alter rules or production data. Template replay also checks that the three templates preserve numeric facts while changing wording; human preference was not collected. The current fixture holdout is synthetic and small; its promotion gate stays closed until an independently reviewed historical holdout is available.

## Data handling

- Keep the Lab production SQLite file read-only; snapshots are preferred for interactive work.
- The server binds only to loopback unless explicitly configured with a private LAN IPv4 address; LAN mode restricts API requests to that interface's subnet and exposes no general file or shell tool.
- It reads Match Store rows and only the current `telemetry-parser-6` / `review-features-6` cache.
- Missing current features stay explicitly missing. Battle reconstruction runs only after an explicit match drilldown, using a telemetry asset URL already present in the read-only snapshot. The URL must be HTTPS on `telemetry-cdn.pubg.com`; redirects are rejected, the PUBG API is never queried, and fetched bytes/results remain in process memory.
- Battle reconstruction never writes to the source cache. Its intermediate schema is `1` / `battle-reconstruction-v1`; output player and team references are match-scoped hashes, with ambiguous or unavailable evidence shown explicitly.
- Position context is sampled at most once per player per 15-second bucket. Engagements are grouped by known team pair (unknown teams fall back to player pair), a 28-second contact gap, and a matching knock-to-kill continuation window of 120 seconds.
- Explicit post-match phase signals remain unknown and are excluded from engagement and circle context; uncertain states are counted rather than relabeled as in-match.
- Experiment records go only to the separate local experiment database.
- Do not commit source snapshots, experiment databases, player phone numbers, or credentials.
