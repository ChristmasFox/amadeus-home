# PUBG Stats OpenClaw Plugin

This is the only PUBG business entry in the migrated OpenClaw runtime. It
registers ten deterministic tools and delegates all data, query, SQLite, and
Telemetry work to `@agent/pubg-domain`.

OpenClaw owns Telegram, WhatsApp, and future channel transport. The plugin
keeps a small adapter boundary in `src/adapters/`: the current OpenClaw
adapter normalizes trusted channel/session context, while the Domain receives
only platform-neutral inputs. Adding another OpenClaw channel or host adapter
must not require changes to `packages/pubg-domain`.

For person-specific requests, the plugin consumes canonical `Person` IDs and
provider-neutral `pubg` external accounts from `@agent/identity`. It resolves
those accounts to PUBG player IDs at the plugin boundary; the Domain never sees
Telegram/WhatsApp identities, nicknames, phone numbers, or JIDs. An unbound
sender or missing PUBG account is an explicit error, not a configured-team
fallback. `team=true` is the only explicit team subject.

Runtime credentials and team identity are external. Set `PUBG_TEAM_CONFIG_FILE`,
`PUBG_DATABASE_PATH`, and `PUBG_API_KEY_FILE` (or configure the corresponding
non-secret plugin paths). The plugin never stores the API key in OpenClaw
configuration or in the repository.

Raw telemetry fetched by the existing team prefetch is archived before the
Domain feature parser runs. `PUBG_TELEMETRY_ARCHIVE_DIR` defaults to
`/var/lib/amadeus/pubg-telemetry-archive`; the CasaOS Compose template mounts a
persistent host-shared directory there. Gzip payloads are keyed by Match ID and
verified with raw and compressed SHA-256 values. Atomic archive failures remain
in the existing prefetch retry schedule.

At bootstrap the private adapter creates the sole `private` `TeamContext` from
the protected team config and pairs it with a scope-pinned SQLite repository
adapter. The async Domain service does not use the public SaaS database or
infer a team from model-supplied arguments.

## Daily review to a WhatsApp group

`pubg-daily-review` sends **one** review a day, at **09:30 Asia/Shanghai**
(the plugin `timezone`), covering the business day that just ended: yesterday
06:00 (inclusive) to today 06:00 (exclusive, the plugin `businessDayStart`).
It aggregates every squad ranked match of that day (at least two members on the
same team) into one message; there is no gap-based session splitting and no
polling. The service holds a single timer that sleeps until the next 09:30;
only a day that could not finish (a failed send, the directory unavailable, or
no prefetch yet after 06:00 — waited for at most two hours) is tried again,
every ten minutes, until it is sent or blocked. On start it runs once to catch
up a day that came due while the gateway was down; `stop()` clears the timer.

The message is the same rich card a 昨日战绩 question gets from
`pubg_query_stats` (medals by K/D, titles, localized and rounded metrics, team
totals), a Kurisu-voiced opener and remarks picked from the numbers, the day's
placements, findings against the squad's previous 30 days, best and worst
match, and always ends with the share page `<origin>/s/<token>` for exactly the
day's matches. Without `reviewPageBaseUrl` the day is blocked and the owner is
told; it is never sent without the link.

Every decision is recorded in `squad_session_reviews`, keyed
`pubg-daily:<team>:<business day>`, so a day is sent at most once (the WhatsApp
send also carries that idempotency key). The first run records the switch-on
time; days that were already due by then are marked skipped, never backfilled.
Days without squad matches are recorded as skipped and send nothing.

| Config | Meaning |
| --- | --- |
| `sessionReviewMode` | The daily review: `off` (default), `dry-run` (render and record, never send) or `deliver` |
| `reviewGroupTargetFile` | File holding the one WhatsApp group JID (`…@g.us`), kept outside Git |
| `reviewGroupExpectedName` | The group's current name; delivery is refused when it differs |
| `reviewGroupAccountId` | WhatsApp account that is a member of the group |
| `reviewPageBaseUrl` | Intelligence Lab origin; required for delivery (7-day link, token issued per send, only its hash stored) |
| `ownerNotificationOutboxDir` | amadeus owner outbox; a blocked day queues an owner notice there |

Before each send the service checks that the target is a group JID, that the
account's OpenClaw conversation directory (read with `operator.admin`) contains
that group and that its name matches. A wrong target sends nothing and queues an
owner notice; a directory outage keeps retrying and tells the owner once; a
failed send is retried up to five times with a fresh link.

`src/session-review-cli.ts` (run with `tsx`) lists groups, previews a day's
message exactly as it would be sent (placeholder link, nothing sent), sends a
test message, or sends one day by hand with the same checks and key:

```sh
export PUBG_GATEWAY_CALL="orb -m <machine> -u root docker exec openclaw openclaw gateway call"
tsx src/session-review-cli.ts groups
tsx src/session-review-cli.ts preview --db <snapshot.sqlite> --team <team.json> [--day YYYY-MM-DD]
tsx src/session-review-cli.ts send --db <pubg.sqlite> --team <team.json> --share-base <origin> \
  --target-file <file> --expected-name <group name> --account <account id> [--day YYYY-MM-DD] [--record]
```

Inside the OpenClaw container the CLI is bundled as
`/app/dist/extensions/pubg/dist/session-review.js`; `--record` writes the send
to the ledger and `--resend <tag>` sends a deliberate second copy of a day.

### Share links on record answers

With `reviewPageBaseUrl` set, record queries that are built from concrete
matches (`pubg_query_stats`, `pubg_compare_stats`, `pubg_search_matches`,
`pubg_get_match`, `pubg_get_review_facts`, `pubg_get_period_review`) end their
`displayText` with `🔗 <origin>/s/<token>` for exactly those matches (7 days,
enemies anonymised). The 误伤 query (`pubg_query_team_damage`), operational tools,
errors and results without matches get no link. The same link is declared as
`replyLink: {kind: "share", url}`; the amadeus delivery boundary appends it when
the agent retold the answer without it (see the amadeus README).
