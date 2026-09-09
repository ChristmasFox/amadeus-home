# Product Radar V0.3.1 Runtime Observability checkpoint

Date: 2026-09-09 (Asia/Shanghai)
Status: source implemented; release pending

## Scope

- Added additive SQLite tables/columns for Watch runtime stats and runs,
  SearchFeed health, AI usage ledger, heartbeat delivery idempotency, and
  opaque ownership context binding.
- Added deterministic status/stats/usage API responses and a 24-hour
  Similarity Watch heartbeat digest with independent channel delivery.
- Added GPT-5.6 Luna structured status/stats intents and provider usage
  extraction. Polling, SearchFeed and Sharp matching remain non-LLM paths.
- Persisted `platform + chat + sender + domain` context binding so plugin
  reloads can restore the caller's active Watch. Ambiguous multiple Watches
  still require clarification.

## Verification before release

- Product Radar tests: 45/45.
- Product Radar typecheck/build: passed.
- LangBot Product Radar tests: 21/21; Python compile: passed.
- `pnpm check:secrets`: passed.
- `git diff --check`: passed.

## Release checklist

- [ ] Commit and push source.
- [ ] Build/load immutable Product Radar image with host BuildKit.
- [ ] Recreate CasaOS Product Radar with `docker compose up -d --no-build`.
- [ ] Install Product Radar plugin through the LangBot API and verify ready.
- [ ] Verify health, watch/feed/runtime schema, and context API without
  creating/deleting a real Watch or sending manual test messages.

## Rollback

- Restore the recorded CasaOS `.env` image backup and run Compose with
  `--no-build`.
- Restore the LangBot plugin package from the deployment backup.
- Do not remove `/DATA/AppData/product-radar` or changedetection datastore.
