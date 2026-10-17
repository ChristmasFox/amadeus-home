# Persistent raw Telemetry archive and live AI verification

Updated: 2026-10-17

Branch: `research/pubg-intelligence`

Archive schema: `pubg-raw-telemetry-archive-v1`

## SOURCE_FIXED

The existing PUBG Domain downloader now archives the complete successful telemetry CDN response body before JSON parsing or feature extraction. It reuses the existing match prefetch/download path, so enabling retention adds no second request for a telemetry body. New capture failures remain retryable through the prefetch retry state; the offline backfill retries each selected match up to three times.

`packages/pubg-intelligence` owns a private gzip archive keyed by a SHA-256 directory derived from Match ID. The manifest retains the Match ID and each immutable response capture's raw/gzip byte lengths and SHA-256 values. Repeated bodies deduplicate; changed bodies for one Match ID append a separate capture. Payload and manifest files are atomically published, reads verify both hashes, cross-process file locks prevent duplicate downloads, and archive directories/files use `0700`/`0600`. There is no rolling eviction. The backfill command rejects archive locations inside the Git repository and prints aggregate counts only.

The OpenClaw PUBG plugin connects the archive to its existing telemetry prefetch worker and a persistent host-shared Compose mount. The research page reads the same archive first, verifies the raw body, and only uses the snapshot's allowed HTTPS telemetry URL when there is no local capture. The Lab Match Store stays opened read-only; reconstructed events remain in process memory, and experiment writes remain in the separate experiment SQLite database.

The historical runner accepts only a read-only SQLite source, selects the 100 newest matches, and never fills gaps by reaching further into history. Ordering comes from `matches.timestamp_ms DESC, match_id DESC`. It accepts only `https://telemetry-cdn.pubg.com` asset URLs and rejects redirects. The package tests cover the 100-match boundary, missing assets, retry, cross-instance deduplication, corrupt data, hash tampering, stable source state, and repository-path/symlink checks.

The real AI path uses the existing Vercel AI SDK and owner-only external configuration. For the local 9Router `arthur-combo` route, the OpenAI-compatible provider explicitly sends `stream: false`; when omitted, this route returns SSE to a non-streaming SDK call. The assistant's final response is submitted via a required typed AI SDK tool call, then checked against the full Zod contract and locally known evidence aliases. The response contract still rejects unsupported citations and numbers.

## BUILD_VERIFIED

- `pnpm --filter @agent/pubg-domain build` — passed.
- `pnpm --filter @agent/pubg-intelligence build` — passed.
- `pnpm --filter @agent/pubg-plugin build` — passed.
- `pnpm --filter @agent/pubg-intelligence-lab typecheck` and `build` — passed.
- `pnpm --filter @agent/pubg-domain test` — 40 passed.
- `pnpm --filter @agent/pubg-intelligence test` — 39 passed.
- `pnpm --filter @agent/pubg-plugin test` — 14 passed.
- `pnpm --filter @agent/pubg-intelligence-lab test` — 4 passed.
- `pnpm check:architecture` and `pnpm test:architecture` — passed; the fixture copy list now includes the existing `packages/agent-memory` source required by its unchanged assertions.
- `pnpm check:secrets` and `git diff --check` — passed.

Focused real-data commands:

```sh
PUBG_INTELLIGENCE_DB=/path/to/read-only-snapshot.sqlite \
PUBG_TELEMETRY_ARCHIVE_DIR=/path/outside/repository \
pnpm --filter @agent/pubg-intelligence telemetry:backfill

PUBG_INTELLIGENCE_DB=/path/to/read-only-snapshot.sqlite \
PUBG_TELEMETRY_ARCHIVE_DIR=/path/outside/repository \
pnpm --filter @agent/pubg-intelligence-lab archive:e2e

PUBG_INTELLIGENCE_DB=/path/to/read-only-snapshot.sqlite \
PUBG_TELEMETRY_ARCHIVE_DIR=/path/outside/repository \
pnpm --filter @agent/pubg-intelligence-lab ai:e2e
```

The command output includes aggregate counts and AI result shape only; it does not include Match IDs, player labels, telemetry content, or credentials.

## LIVE_VERIFIED

The authorized snapshot contained 543 matches. The newest 100, covering 2026-10-05 through 2026-10-16 UTC, all had allowed telemetry assets. The first backfill archived 100/100 with no missing assets and no failures. The 100 latest raw bodies total 2,101,398,745 bytes; their gzip payloads total 152,437,525 bytes. All 100 Match-ID entries were read back through archive hash verification. A second run selected the same 100, found all 100 already archived, wrote none, and recorded zero failures. The read-only snapshot's SHA-256 was unchanged across that run.

The real archive replay returned page HTTP 200, episode status `available`, and zero CDN requests while reading a 24,390,472-byte raw body from the local archive. No Match Store or experiment database write was used for this replay.

The real AI end-to-end run made five 9Router calls against the snapshot. The planner and assistant both reported `ai-sdk`; the assistant answered with three schema-valid claims and four evidence references. On the restarted page at `http://192.168.5.3:4179`, the page, `/src/client/main.tsx`, and `/api/bootstrap` returned HTTP 200; the client module contained `createRoot`, bootstrap reported the model enabled and 543 matches, and a live scoped research API call returned HTTP 200 with an AI SDK answer and linked evidence.

## RELEASED

Source changes are prepared for `research/pubg-intelligence`; this is not a Lab product deployment. The running OpenClaw production collector was not switched. Once this branch is accepted and deployed through the existing Lab candidate path, future telemetry bodies seen by the existing prefetch/download process will be retained permanently. The local snapshot page and the 100-match historical backfill are live-verified; future production ingestion is source-verified but not runtime-verified.

## Limits and follow-up

- Historical backfill intentionally covers only the newest 100 matches. Older matches are not fetched as substitutes.
- Permanent retention is unbounded by design; the current archive uses about 146 MiB on disk for these 100 matches. Host capacity must be monitored as more matches are collected.
- Future production auto-archival still requires a Lab candidate deployment; production collection was not changed in this task.
- Real-provider verification proves connectivity and a valid cited answer for the tested question, not general answer quality or latency.
