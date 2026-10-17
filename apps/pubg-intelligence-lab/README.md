# PUBG Intelligence Lab

**Active development branch: `main`.** The original `research/pubg-intelligence` branch is historical; do not create new algorithm work there. This is an independent local/LAN React app within the same monorepo. Changes to this page do not require deploying Gate or rebuilding OpenClaw. Run the page independently using the instructions below.

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
- `PUBG_INTELLIGENCE_AI_CONFIG_FILE` (optional owner-only `0600` JSON file with `baseURL`, `apiKey`, and optional `modelId`; the default is `~/.config/amadeus/pubg-intelligence-ai.json`)

The current Lab-local owner config selects `arthur-combo` at `http://127.0.0.1:20128/v1`. The research service calls 9Router server-side, so a browser opened from another LAN device does not need a router URL of its own. The top bar shows the configured model ID when the model is available. To move 9Router to another host, set `PUBG_INTELLIGENCE_AI_BASE_URL` or update the external owner config to a stable private LAN address or hostname; do not pin an OrbStack temporary IP in source. Keep `apiKey` in the owner-only file or runtime environment, never in Git.

For OpenAI-compatible 9Router routes, the app sends `stream: false` explicitly because this router returns SSE when the field is omitted. The assistant submits its final response through a typed AI SDK tool call, then validates the full local claim schema and evidence references.

The response can use tactical coaching, squad-humor, or chronological-story wording. Templates change wording only; candidate claims are schema-validated, every claim must cite evidence returned by a read-only server tool, and unsupported numeric values or references fall back to local deterministic output. The server fixes the selected squad and date scope; model tool inputs cannot choose a tenant, file, database, or arbitrary match ID.

## Workspace and analytics

The page is a two-pane workspace: the left rail holds the data scope (squad, game mode, complete-telemetry switch, date range, match list) and the right pane is a set of tabs. `?tab=overview|field|match|chat|lab` deep-links a tab; selecting a match in the list opens 单局复盘.

| Tab | What it shows |
| --- | --- |
| **总览** | Key findings, KPIs (win and top-10 rate with 95% intervals, median placement, damage and kills per player), 150-match trend, player form, map table, weapon efficiency, supply/cooperation profile, lineups and "who is better to have" |
| **落点与交战** | Key findings, combat quality cards, death analysis, landing preference per map on a 1 km grid |
| **单局复盘** | The single-match review: domain summary, battle reconstruction, tactical candidates, evidence trace |
| **研究对话** | The natural-language research assistant and its evidence ledger |
| **评估实验** | Offline evaluation registry and counterexample review |

### Data scope controls

- **Game mode** (`mode=squad|duo|solo|other|all`, default `squad`) applies to the match list and both analytics endpoints. Solo, duo and TDM results are not comparable with squad rates, so they are never mixed unless `all` is chosen. `bootstrap.modeCounts` feeds the counts.
- **仅看完整遥测** (`complete=1`) keeps only matches with a verified raw telemetry archive entry, i.e. the complete event stream. Matches that only have parsed feature facts are excluded. The archive ID list is re-read at most every 30 seconds because the hourly prefetch adds entries. Unchecked, every match with a Match Store record is used, because placement, damage and kills do not need telemetry.
- The date range and squad apply everywhere. The research assistant keeps its own server-fixed scope.

### Analytics reference

All algorithms are deterministic and live in `packages/pubg-intelligence/src`; the page only renders them.

| Metric | Method | Module | Source |
| --- | --- | --- | --- |
| Win, top-10, revive, finish rates | Wilson score interval (95%) | `analytics.ts` | Match Store / telemetry |
| Player form (hot, steady, cold) | Last 5 matches against the earlier median and MAD baseline; robust z, flagged at \|z\| ≥ 1.5; needs 8 matches | `analytics.ts` | Match Store |
| Trend | Theil-Sen slope, robust to a single outlier match | `analytics.ts` | Match Store |
| Map table | Per-map rates; damage index = per-player damage on the map ÷ overall (needs 5 matches) | `analytics.ts` | Match Store |
| Weapon efficiency | Hit rate shrunk toward the pooled rate with a 30-shot prior; names merged across `Item_Weapon_X_C`, `WeapX_C`, `ZU_Item_Weapon_X`; melee and throwables excluded | `analytics.ts` | Cached features |
| Lineups and member impact | Presence set per match; top-10 rate with versus without a member, Newcombe interval of the difference | `analytics.ts` | Match Store |
| Landing preference | `LogParachuteLanding` on a 1 km grid; main cell per match; top-10 rate and early-wipe rate (squad's longest survival under 7 minutes) per cell | `landing.ts` | Raw archive |
| Combat quality | First-knock share, lead retention, follow-up delay, revive and finish rates, third-party candidates from reconstructed battles | `combat-quality.ts`, `battle.ts` | Raw archive |
| Death analysis | Stage from teams alive at the member's death (opening ≥ 20, mid 10–19, late 5–9, final ≤ 4), killer weapon, killed-after-knock rate, squad-wipe stage | `combat-quality.ts` | Raw archive |
| Supply and cooperation profile | Healing and boost use per alive minute against the other members, armour-break conversion, friendly damage dealt and taken, flash use, vehicle distance | `profiles.ts` | Cached features |
| Key findings | Rule set `highlight-rules-v1` over the results above; each finding carries its sample size or interval and small samples produce none | `insights.ts`, `profiles.ts` | All of the above |

Conventions that keep the numbers honest:

- Unknown placement is excluded from rates, not counted as a loss; notes say how many matches were skipped.
- "With versus without" comparisons, landing outcomes and lineups are correlations, not causes. Third-party contact is an overlap candidate, not a claim about intent.
- Raw supply counts are deliberately not correlated with placement: placement tracks survival time almost exactly (Spearman 0.92), so those correlations only restate "lasted longer". Use rates per alive minute instead.
- Trend charts clip the damage axis at the 95th percentile and say so, and recent-versus-earlier comparisons use medians so one burst match cannot move them.

### Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/analytics/performance` | Squad analytics, maps, lineups, series, profiles, weapons, highlights (`squadId`, `mode`, `complete`, `from`, `to`) |
| `GET /api/analytics/telemetry` | Combat quality, deaths, landing, highlights from the archive (same query plus optional `limit`, default and maximum 400) |
| `GET /api/matches` | Match list (`mode`, `complete`, `search`, `offset` in addition to the scope) |
| `GET /api/bootstrap` | Counts, squads, `modeCounts`, `archivedMatchCount` |

Telemetry analytics read only the local archive, never the CDN. Per-match results are cached for the process lifetime without keeping parsed telemetry documents in memory, and the default squad is warmed in the background at start. A cold request over about 120 matches takes roughly a minute. Matches whose telemetry has already expired are reported as "no archive", not as failures.

### Telemetry availability

PUBG keeps a match and its telemetry for about 14 days, so older matches can no longer be downloaded. The hourly Lab cron `amadeus-pubg-telemetry-hourly` archives new matches; the local archive is then the only long-term copy. Every match in the last 14 days should have complete data once that cron has run, while older matches keep their Match Store record (placement, kills, damage, survival time) and, for some, parsed features or an archive entry from before the retention window passed. Do not delete older Match Store rows: they carry the long-term rates and cannot be re-fetched.

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
- The production PUBG plugin writes complete CDN response bodies to the host-shared archive before feature parsing. Each Match ID has one immutable archive entry, gzip payloads, a manifest with raw and compressed SHA-256 values, atomic payload/manifest publication, and no rolling retention. Unique response bodies for the same Match ID are retained as separate captures; repeated body hashes are deduplicated.
- Historical backfill reads a read-only SQLite snapshot and considers only the newest `HISTORICAL_TELEMETRY_BACKFILL_LIMIT` (500) matches; an older match never replaces a selected row with a missing telemetry asset. PUBG's telemetry CDN keeps a match for about 14 days and answers 403 afterwards, so those assets are counted as missing without retries and the local archive is the only long-term copy. New matches are archived by the existing Lab cron `amadeus-pubg-telemetry-hourly` (`5 * * * *`, `pubg_prefetch_telemetry`); the backfill only catches up on matches that were played before archiving existed or while it was failing. After a game, a new Match-ID directory should appear in the archive within about an hour. `PUBG_TELEMETRY_BACKFILL_LIMIT` lowers the cap for one run. Run it with `PUBG_INTELLIGENCE_DB=/path/to/read-only-snapshot.sqlite PUBG_TELEMETRY_ARCHIVE_DIR=/path/outside/the/repository pnpm --filter @agent/pubg-intelligence telemetry:backfill`. The runner rejects archive paths inside the repository, retries CDN failures three times, and prints aggregate counts only. New matches use the existing team prefetch and retry schedule, so an archive failure remains eligible for the normal scheduled retry.
- The local research page reads the same archive first. Set `PUBG_TELEMETRY_ARCHIVE_DIR` when the archive is not at `~/.local/share/amadeus/pubg-telemetry-archive`; verified archived bytes are replayed without CDN requests.
- Battle reconstruction runs only after an explicit match drilldown and reads verified local archive entries only; it never falls back to the telemetry CDN. The Lab source cache remains read-only.
- Its intermediate schema is `2` / `battle-reconstruction-v2`. Output player and team references are match-scoped hashes. Existing team-pair Episodes remain intact; V2 groups them only when their time overlaps, a known team reference is shared, and both sides have contact evidence.
- PUBG `common.isGame` phase values below `1` are pre-match; values `1` and above are in-match safe-zone phases. Missing or invalid phase and unreliable time remain unknown and appear in diagnostics.
- Battle groups show observed knock, revive, kill, and knock-balance changes. Team state covers observed members only; a full four-player roster is never inferred. Possible third-party contact is an overlap candidate, not a claim about intent or cause.
- Position context is sampled at most once per player per 15-second bucket. Pair episodes keep the existing 28-second contact gap and 120-second knock-outcome window.
- The match drilldown links timelines and tactical diagnoses to raw event references. Human battle reviews (`correct`, `insufficient_inference`, `wrong`, `unknown`) are stored in the separate local experiment database and never alter rules automatically.
- Experiment records go only to the separate local experiment database.
- Do not commit source snapshots, experiment databases, player phone numbers, or credentials.
