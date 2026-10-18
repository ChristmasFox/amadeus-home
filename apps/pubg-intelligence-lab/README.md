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

## Keep the page running

The page reads a read-only snapshot, so two LaunchAgents keep it current without touching Lab:

```sh
infra/macos/manage-intelligence-lab.sh --dry-run     # show the plan
infra/macos/manage-intelligence-lab.sh --apply       # install and start both agents
infra/macos/manage-intelligence-lab.sh --status
infra/macos/manage-intelligence-lab.sh --stop --apply
scripts/refresh-intelligence-snapshot.sh --apply     # refresh once by hand
```

- `com.amadeus.pubg-intelligence-lab` keeps the page on port 4179 (`KeepAlive`). `scripts/run-intelligence-lab.sh` rebuilds the two packages and picks the first private LAN IPv4 (en0, en1) at every start, so a changed address needs no edit; `BIND` and `PORT` live in `~/Library/Application Support/Amadeus/PubgIntelligenceLab/config.env`.
- `com.amadeus.pubg-intelligence-lab-refresh` runs at minute 20 of every hour, after the Lab prefetch at minute 5. `scripts/refresh-intelligence-snapshot.sh` opens the live database inside the OrbStack machine read-only, copies it with the SQLite backup API, verifies integrity and the SHA-256 of the transfer, compares match, latest-match and feature counts with the snapshot in use and swaps it atomically only when something changed; only then is the page restarted. The previous snapshot is kept as `snapshot.prev.sqlite`; the live database and the telemetry archive are never written.
- The **刷新数据** button in the top bar (`POST /api/refresh`, also behind the public login) runs `scripts/refresh-intelligence-now.sh`: it runs the existing hourly Lab job `amadeus-pubg-telemetry-hourly` once, then the snapshot refresh above, and the page reloads itself when new matches arrived. One run at a time, at most one every 2 minutes; progress is polled from `GET /api/refresh`.
- State is in `~/Library/Application Support/Amadeus/PubgIntelligenceLab` (`snapshot.sqlite`, `refresh.json`), logs in `~/Library/Logs/Amadeus/PubgIntelligenceLab`.

## Public access (optional)

The page is LAN-only by default. To also serve it on a public hostname behind a reverse proxy, set both
`PUBG_INTELLIGENCE_PUBLIC_HOST` (for example `pubg.example.com`) and `PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE` (a mode-`0600`
JSON scrypt verifier, format `amadeus-qwen-image-lab-scrypt-v1`, kept outside Git; the Image Lab verifier can be reused so
one password opens both). Setting only one of them, a group- or world-readable verifier, or a missing built client makes
the server refuse to start. See `infra/vps/README.md` for the proxy, tunnel and firewall steps.

- A request is public only when its `Host` header equals the configured hostname. Public requests get a password-only
  login page; every other route, including `/api/*` and `/assets/*`, returns 401 until a session exists. Sessions are
  signed tokens (12 h, surviving restarts; see Sessions) in a `Secure; HttpOnly; SameSite=Strict` cookie, and state-changing requests must
  carry the public `Origin`.
- Login is limited to 5 attempts per minute per visitor (keyed on `CF-Connecting-IP` / `X-Forwarded-For`, used for
  throttling only), 40 per minute overall, with a growing delay on failures. Wrong passwords never reveal anything else.
- The public hostname serves the built client (`vite build`; `scripts/run-intelligence-lab.sh` rebuilds it on every
  start), never the Vite dev server or its HMR socket. A request that carries proxy headers but a non-public `Host` is
  refused, so tunnelled traffic can never be mistaken for a LAN request.
- Everything an authenticated visitor can do on the LAN they can do publicly, including the research chat, which calls
  the configured model.

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

The page is a two-pane workspace: the left rail holds the data scope (squad, game mode, complete-telemetry switch (on by default), date range, match list) and the right pane is a set of tabs. `?tab=overview|field|style|compare|match|chat|lab` deep-links a tab; 队员对比 (`compare`) puts two members side by side (overlaid style radar, mirrored bars per metric with the better side highlighted, and a count of metrics each leads); selecting a match in the list opens 单局复盘.

| Tab | What it shows |
| --- | --- |
| **总览** | Key findings, KPIs (win and top-10 rate with 95% intervals, median placement, damage and kills per player), 150-match trend, player form, map table, weapon efficiency, supply/cooperation profile, lineups and "who is better to have" |
| **落点与交战** | Key findings, combat quality cards, fight environment and win rates, death analysis, engagement-distance profile, zone pressure per circle, landing preference per map (with contest cost and area names), squad roles |
| **打法风格** | A "who fights best" panel (fighting-power index, a verdict sentence, stable per-step strengths and weaknesses, and the shots → hits → knocks → finishes funnel), a comparison matrix of play-style axes by member, one card per member (radar, archetype, most distinctive traits with their confidence, weapon and weapon-class preference), the axes on which the squad differs most, and squad overlaps and gaps |
| **单局复盘** | The single-match review: domain summary, battle reconstruction, tactical candidates, evidence trace |
| **研究对话** | The natural-language research assistant and its evidence ledger |
| **评估实验** | Offline evaluation registry and counterexample review |

### Performance and restarts

The page restarts whenever the hourly snapshot refresh finds new data, so a restart has to be cheap:

- Per-match analysis (parsing a 25 MB telemetry file and deriving everything from it) runs on a small pool of worker threads (`PUBG_INTELLIGENCE_ANALYSIS_WORKERS`, default 3), so the server thread stays free: requests answer in milliseconds while the analysis works in the background. Before this, the page was unreachable for about 90 seconds after every restart.
- Results are cached on disk in `~/.local/share/amadeus/pubg-intelligence-lab/analysis-cache/<version>/<squad>/<match>.json`. The version is a hash of the built analysis packages plus `match-analysis.ts`, so any change to the analysis code starts a fresh cache; older versions are left in place, never deleted. After a restart the page is ready in about 3 seconds and the first telemetry request takes a fraction of a second; a completely cold cache (new code) takes about 40 seconds in the background.
- `PUBG_INTELLIGENCE_BOOT_TIMING=1` prints how long each startup phase takes.

### Sessions

Public sessions are signed tokens (`id.expiry.signature`, HMAC-SHA256), not server memory, so a restart does not log anyone out. The signing key comes from a persistent secret (`session-secret`, mode `0600`, in `PUBG_INTELLIGENCE_STATE_DIR`, default `~/.local/share/amadeus/pubg-intelligence-lab`) combined with the password verifier, so changing the password ends every session. Logged-out tokens are remembered in `session-revoked.json` until they would have expired.

### Archive backup

PUBG deletes telemetry about 14 days after a match, so the raw archive cannot be rebuilt. `scripts/backup-pubg-telemetry-archive.sh` (dry run by default, `--apply` to copy) makes an append-only copy to `/Volumes/Avalon/backups/pubg-telemetry-archive` (`PUBG_TELEMETRY_ARCHIVE_BACKUP_DIR` overrides): payload files are content-addressed and copied only when absent, manifests are refreshed, nothing is ever deleted or overwritten, and every source file is checked against the copy by size. `infra/macos/manage-intelligence-lab.sh --apply` installs a daily 03:40 LaunchAgent for it. The result goes to `archive-backup.json`, which the page shows at the bottom of the left rail (amber when the backup is missing, failed, skipped because the disk is not mounted, or older than 48 hours).

### Map background

The route map can sit on the official PUBG map artwork. The images are PUBG's own assets, so they are not stored in Git: `scripts/fetch-pubg-map-images.sh` (dry run by default, `--apply` to download) fetches the high-resolution no-text maps from `pubg/api-assets`, shrinks each to a 3072 px JPEG and keeps them in `~/.local/share/amadeus/pubg-intelligence-lab/maps` (override with `PUBG_INTELLIGENCE_MAP_DIR`). `GET /api/maps/<MapName>` serves them (404 when a map is missing, in which case the page falls back to the grid; the public hostname needs a session like every other route). The maps in the ranked data (Erangel, Miramar, Taego, Rondo) are installed; run the script with `--apply` and no `--only` to fetch the rest.

### Code layout

`src/server/` is split by responsibility: `server.ts` wires the HTTP API and startup; `snapshot.ts` holds the read-only data snapshot and the scope helpers (squad, mode, ranked filter); `match-views.ts`, `telemetry-analytics.ts` and `assistant-scope.ts` compute the match views, the telemetry analytics and the research assistant's scoped tools; `match-analysis.ts` with `analysis-worker.ts`, `analysis-pool.ts` and `analysis-cache.ts` do the heavy per-match work off the server thread; `public-access.ts` and `public-site.ts` are the password-protected public hostname; `http-utils.ts` has the request helpers.

### Tests

- `pnpm test` runs the unit and API tests. `tests/api-contract.test.ts` starts the real server on a fixture SQLite database with a small telemetry archive and checks the scope filters, comparison, relative form, match story, analytics and map-image routes, including the worker pool.
- `pnpm smoke:ui [url] [--shots dir]` opens every tab of a running page in a real browser, on a desktop and on a phone, and fails on console errors, failed requests, HTTP errors or sideways overflow; on the phone it also opens the scope drawer. It uses `playwright-core` with the installed Chrome (`CHROME` overrides the path).

### Phones

At 820 px and below the workspace becomes a normal scrolling page: the top bar and tab strip stay pinned, the data scope (squad, mode, complete-telemetry switch, dates, match list) opens as a slide-in drawer from the "数据范围" button, the match timeline and wide tables scroll sideways inside their own panel, and grids collapse to one or two columns.

### Data scope controls

- **Ranked only.** Every endpoint keeps only ranked matches (`isCompetitive`, PUBG `matchType=competitive`). Normal, arcade, event and casual (`airoyale`) matches are discarded: casual lobbies are about 90 bots (`ai.` accounts), normal lobbies often contain bots too, and none of them are comparable with ranked play. In the archive, ranked telemetry contains no bot accounts. `bootstrap.rankedMatchCount` shows how many of the stored matches qualify.
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
| Weapon efficiency | Older per-weapon figures from the cached match features (every shot counts, including idle ones and finishing shots, so these hit rates are lower than the play-style page's); hit rate shrunk toward the pooled rate with a 30-shot prior; names merged across `Item_Weapon_X_C`, `WeapX_C`, `ZU_Item_Weapon_X`; melee and throwables excluded | `analytics.ts` | Cached features |
| Lineups and member impact | Presence set per match; top-10 rate with versus without a member, Newcombe interval of the difference | `analytics.ts` | Match Store |
| Landing preference | `LogParachuteLanding` on a 1 km grid; main cell per match; top-10 rate and early-wipe rate (squad's longest survival under 7 minutes) per cell | `landing.ts` | Raw archive |
| Combat quality | First-knock share, lead retention, follow-up delay, revive and finish rates, third-party candidates from reconstructed battles | `combat-quality.ts`, `battle.ts` | Raw archive |
| Death analysis | Stage from teams alive at the member's death (opening ≥ 20, mid 10–19, late 5–9, final ≤ 4), killer weapon, killed-after-knock rate, squad-wipe stage | `combat-quality.ts` | Raw archive |
| Long-run combat | Per match, each member's damage, kills, knocks and assists divided by the fair split among the members present; summed over every Match Store match in scope, so the lobby's strength cancels out. The composite is the geometric mean of damage, kills and knocks; the interval comes from seeded bootstrap over matches (stable: interval excludes 1 and |ratio| ≥ 1.1) | `combat-long.ts` | Match Store |
| Lobby percentile | The whole lobby is rebuilt from one raw payload (gun damage to other teams and knocks per player, time on the ground from landing to death); each member's damage and knocks per minute alive are placed among every real player who stayed at least two minutes; 0.50 is the lobby median, the interval is a seeded bootstrap over matches | `lobby.ts` | Raw archive |
| Fight win rate | Per battle group: win when more opponents than squad members were knocked or killed, draw when equal, unscored without a knock; split by initiator (first effective damage), stage, third-party flag, duration; initiator and third-party gaps use the Newcombe interval | `fights.ts` | Raw archive |
| Engagement distance | Gun damage with both coordinates by distance band (<25, 25–75, 75–150, ≥150 m), dealt versus taken, headshot damage share per band and the main band per weapon | `field.ts` | Raw archive |
| Zone pressure | Per circle (integer part of `isGame`): share of the squad's position samples inside the blue zone, position relative to the safe-zone centre (centre / middle / edge / outside), blue-zone damage | `field.ts` | Raw archive |
| Landing contest | Other teams whose nearest member landed within 500 m of the squad centre; early-wipe and top-10 rates by contest level and their Newcombe differences; the area name comes from the first position sample after landing | `field.ts`, `landing.ts` | Raw archive |
| Squad roles | First knock dealt, first member knocked, revives and kills as shares of the squad total; a title needs at least 15 events and a 40% share | `fights.ts` | Raw archive |
| Streaks and team wipes | A takedown is a knock, or a kill without a prior knock. Takedowns of different enemies by one member at most 60 s apart form a streak (2 / 3 / 4+). A team wipe is an enemy team whose final push (takedowns at most 60 s apart up to its last death) was taken down entirely by the squad, at least two players; each member is credited to the knocker, else the killer. Reports wipes per match, full-team (4) and solo wipes, stage, duration, per-member streaks, chained-takedown share (Wilson interval) and wipe takedowns, plus how often the squad's own final push fell to a single team or player | `streaks.ts` | Raw archive |
| Match story | One match's raw telemetry as a plain-language story. Lifelines per member (alive, down, dead, from landing), takedown / kill / revive / down / death events with weapon and distance, fights (contacts are grouped by opposing team: a fight stays open while the squad keeps meeting one of its teams within 35 s, and a new team joins only within 12 s, so back-to-back fights against different teams stay separate; enemy teams, enemy takedowns versus own downs, who fired first, damage both ways, result win / lose / draw / skirmish), every other player's route (a sample every 20 s after landing, bots excluded), the circle and alive-team count over time with the first time of each phase, the route per member (10 s samples after landing, never the plane's flight path) and damage per minute. The page turns these into highlights, a timeline with fight windows, a replayable route map (zoom follows the squad and the opponents it is fighting; other teams are shown as grey dots, the teams in the current fight in red with their last two minutes of movement), fight cards that also name each opposing team (size, players taken down, damage dealt to us, weapons), fight cards, a per-member table and a down log; the old battle-reconstruction output stays under a collapsed developer section | `match-story.ts` | Raw archive |
| Knock-down causes | For each time a squad member is knocked down: the opposing team that did it, the weapon and distance, the damage the squad took and returned in the 20 s before, how many opposing teams hit the squad in that window, the distance to the nearest living teammate and the opposing teams within 300 m. Priority order sets one cause: not a player (gas, fall…) → circle / environment; two or more teams hitting in 20 s → crossfire; no damage returned to the attacking team → long-range ambush (≥150 m) or close ambush; returned fire but no teammate within 150 m → isolated; otherwise lost duel. Summaries give the share per cause, no-return-fire share, revive share, per-member and per-stage splits and plain-language findings | `match-insight.ts` | Raw archive |
| Turning points | First death, the start of a collapse (consecutive lost fights ending the match), the costliest and the decisive fight of one match | `match-insight.ts` | Raw archive |
| Rotation | `poisonGasWarning*` is the next safe circle (white, fixed for a phase) and `safetyZone*` the gas wall closing on it (blue). Per circle: distance outside the white circle when it appeared, seconds until the squad centre was inside, when the wall started to close, the margin (negative = caught by the gas), seconds in the gas and gas damage, distance moved and vehicle share; plus landing-to-first-fight time. "Late" = not inside when the wall started to move. Summaries are descriptive only: gas damage is not compared with placement, because squads that live longer pass more circles and take more gas | `match-insight.ts` | Raw archive |
| State and sessions | Matches are split into sessions at gaps over 40 minutes. For each game number in the session and each hour of the day (Shanghai time): mean damage per present member with a bootstrap interval, top-10 rate with a Wilson interval, median placement. Tested contrasts, each with a 95% interval from resampling whole sessions (games of one night are correlated, so resampling matches would understate the uncertainty): first game versus the rest (warm-up), the last three versus the first three games of sessions of 8+ games (fatigue; a positive gap does not mean getting better, since people keep playing when it goes well), and the game after a placement of 15 or worse versus the others (tilt). Claims are made only when the interval excludes zero; an absent effect is reported as absent, and an interval that merely touches zero is flagged as suggestive. Uses every ranked match in scope regardless of the complete-telemetry switch, because sessions need unbroken runs | `rhythm.ts` | Match Store |
| Match versus usual | For the selected match, each member's damage, kills, knocks, assists, survival and (with an archive) damage per minute, hit rate, takedowns, longest streak, wipe takedowns and times downed become a midrank percentile among that member's other matches of the same mode (most recent 150, at least 8). The form score is the mean over damage, kills, knocks, survival and damage per minute; the squad placement is placed the same way. Highlights name the placement, the best-form member and up to two outliers (≥ 85th or ≤ 15th percentile) per member. Nothing is compared across members | `match-relative.ts` | Match Store + raw archive |
| Play style and fighting power | Twenty-four axes in five groups (fighting efficiency, shooting, tempo, cooperation and supplies, position and risk). Fighting efficiency covers damage per alive minute, hit rate (each gun shot is paired with its damage by `attackId`: a shot is a hit when it hurt a standing opponent, so a shotgun blast is one shot and at most one hit; only shots fired inside a fight count, meaning someone on either side was hurt within 8 s before or after; shots that went into a downed opponent are neither hits nor misses, and shots fired outside any fight (walls, vehicles, empty air, test fire) are reported separately as idle shots; launchers are excluded; first-shot and follow-up hit rates split a burst's first bullet, or a single shot, from the bullets fired within 0.12 s of the previous one, and the burst share is the follow-up bullets' share of all shots; the absolute value is a property of the telemetry events, which log every bullet of automatic fire, so it is not the in-game accuracy), damage per shot, share of fights with a knock and knock-to-finish conversion; hit rate and damage per shot are compared on the same weapon mix (indirect standardisation: the teammates' per-class rate, shrunk toward their overall rate with a 200-shot prior, applied to the member's own shots per class), so a sniper is not rated a better shot for using a bolt-action. Damage per minute includes rocket, grenade, sticky bomb, mortar and fire damage to opponents; distance, headshot and hit statistics use gunfire only. The fighting-power index is the weighted geometric mean of the teammate ratios of damage per minute (0.5), knock share (0.25) and same-weapon hit rate (0.25). The weights were checked on 112 ranked squad matches: per match, damage per minute tracked the squad's fight-win share best (Spearman 0.35, versus 0.18 for knock share and 0.12 for hit rate); headshot share had a split-half reliability of 0.45 and no relation to winning, and conversion depends on teammates finishing, so both remain separate axes outside the index; with its interval taken from the same bootstrap resamples, and the verdict names a leader only when that interval excludes parity. The remaining axes: engagement distance (damage-weighted median), far (≥150 m) and close (<25 m) damage share, sniper/DMR and SMG/shotgun/pistol weapon-class share, headshot share, fight frequency, initiative, fragging, late-game damage share (circle 5+), early looting speed, revives, throwables, healing/boost use per alive minute, isolation (share of samples with no teammate within 150 m), times downed per fight, circle-edge share, on-foot distance and vehicle use. Each is the member's value divided by the teammates' pooled value (the member excluded). A 95% bootstrap interval over matches (300 seeded resamples) grades a difference: stable (interval excludes 1, ratio ≥ 1.15 or ≤ 0.87), lean (the direction holds in ≥ 85% of resamples but the interval crosses 1, shown with that confidence), otherwise even. Archetypes are the highest-scoring fixed weighted rules (stable axes count fully, lean 60%, even axes 25%): a stable high score names the type, a weaker one reads "（倾向）" or "偏…", and a player close to teammates on everything is "均衡全能型", so nobody is left without a type | `style.ts` | Raw archive |
| Supply and cooperation profile | Healing and boost use per alive minute against the other members, armour-break conversion, friendly damage dealt and taken, flash use, vehicle distance | `profiles.ts` | Cached features |
| Key findings | Rule set `highlight-rules-v1` over the results above; each finding carries its sample size or interval and small samples produce none | `insights.ts`, `profiles.ts` | All of the above |

Conventions that keep the numbers honest:

- Unknown placement is excluded from rates, not counted as a loss; notes say how many matches were skipped.
- "With versus without" comparisons, landing outcomes and lineups are correlations, not causes. Third-party contact is an overlap candidate, not a claim about intent.
- Raw supply counts are deliberately not correlated with placement: placement tracks survival time almost exactly (Spearman 0.92), so those correlations only restate "lasted longer". Use rates per alive minute instead.
- Fight initiative is a correlation: the side that shoots first usually also saw first and held the better position, so "先手 83% vs 被动 30%" describes the pattern rather than proving that opening fire wins.
- Landing contest can raise the early-wipe rate without lowering the final top-10 rate; both are shown side by side so one is not reported without the other.
- Play style is relative to the teammates: "偏近战" means closer than the teammates, not close in absolute terms. Axes with too little data stay unknown, "lean" is always labelled as a tendency with its confidence, and a squad whose members show no differences at all is reported as homogeneous instead of forcing labels.
- Trend charts clip the damage axis at the 95th percentile and say so, and recent-versus-earlier comparisons use medians so one burst match cannot move them.

### Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/analytics/performance` | Squad analytics, maps, lineups, series, profiles, weapons, highlights (`squadId`, `mode`, `complete`, `from`, `to`) |
| `GET /api/analytics/telemetry` | Combat quality, deaths, landing, highlights from the archive (same query plus optional `limit`, default and maximum 400) |
| `GET /api/analytics/compare` | Per-match numbers for every squad member in scope (damage, kills, knocks, assists, survival, revives, squad placement) for the player-comparison charts (`squadId`, `mode`, `complete`, `from`, `to`) |
| `GET /api/matches/:id/story` | Plain-language story of one match (`squadId`); `available:false` with a reason when there is no raw archive. `?match=<id>` on the page deep-links a match |
| `GET /api/matches/:id/relative` | The selected match against each member's usual level (`squadId`) |
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
