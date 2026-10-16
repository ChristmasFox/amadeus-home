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

## Optional intent model

Without model settings, a local deterministic intent parser handles summary, trend, player comparison, map breakdown, and telemetry coverage questions. If all three variables below are set, the app uses the Vercel AI SDK with an OpenAI-compatible endpoint to classify the research question. Match data and calculations stay local; phone-like and credential-shaped text is redacted before planning and persistence.

- `PUBG_INTELLIGENCE_AI_BASE_URL`
- `PUBG_INTELLIGENCE_AI_API_KEY`
- `PUBG_INTELLIGENCE_AI_MODEL`

## Data handling

- Keep the Lab production SQLite file read-only; snapshots are preferred for interactive work.
- The server binds only to loopback unless explicitly configured with a private LAN IPv4 address; LAN mode restricts API requests to that interface's subnet and exposes no general file or shell tool.
- It reads Match Store rows and only the current `telemetry-parser-6` / `review-features-6` cache.
- Missing current features stay explicitly missing. The app never downloads telemetry or writes to the source cache.
- Experiment records go only to the separate local experiment database.
- Do not commit source snapshots, experiment databases, player phone numbers, or credentials.
