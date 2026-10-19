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

## Session review to a WhatsApp group

`pubg-session-review-worker` checks every five minutes for a closed squad
session and writes one review for it. A session is the squad's ranked matches
(at least two members on the same team) with gaps under 40 minutes, measured
from the end of the previous match. It counts as closed only when the gap has
passed **and** an hourly prefetch finished after the gap; missing telemetry is
waited for up to 90 minutes after the last match. Every decision is recorded in
`squad_session_reviews` in the plugin database, keyed by the first match ID, so
a session is reviewed once. The first run records the switch-on time, and
sessions that ended earlier are marked skipped instead of being backfilled.

Findings compare the session with the squad's own ranked matches from the 30
days before it (seeded bootstrap over matches). Only differences whose interval
excludes zero are stated as fact; others appear as "仅本时段观察" or not at all.

| Config | Meaning |
| --- | --- |
| `sessionReviewMode` | `off` (default), `dry-run` (render and record, never send) or `deliver` |
| `reviewGroupTargetFile` | File holding the one WhatsApp group JID (`…@g.us`), kept outside Git |
| `reviewGroupExpectedName` | The group's current name; delivery is refused when it differs |
| `reviewGroupAccountId` | WhatsApp account that is a member of the group |
| `reviewPageBaseUrl` | Intelligence Lab origin; each delivered review links to its own share page `<origin>/s/<token>` (7 days, token issued per send, only its hash stored) |
| `ownerNotificationOutboxDir` | amadeus owner outbox; a blocked review queues an owner notice there |

Before each send the worker checks that the target is a group JID, that the
account's OpenClaw conversation directory contains that group and that its name
matches. A failed check sends nothing to any group and queues an owner notice;
a failed send is retried with the same text and idempotency key up to five
times.

`src/session-review-cli.ts` (run with `tsx`) lists groups, previews a session,
sends a test message or one session by hand, using the same checks and key:

```sh
export PUBG_GATEWAY_CALL="orb -m <machine> -u root docker exec openclaw openclaw gateway call"
tsx src/session-review-cli.ts groups
tsx src/session-review-cli.ts preview --db <snapshot.sqlite> --team <team.json>
tsx src/session-review-cli.ts send --db <snapshot.sqlite> --team <team.json> \
  --target-file <file> --expected-name <group name> --account <account id>
```

Inside the OpenClaw container the CLI is bundled as
`/app/dist/extensions/pubg/dist/session-review.js`; there it can issue a share
link (`--share-base <origin>`), record the send in the ledger (`--record`) and
send a deliberate second copy of a session (`--resend <tag>`).
