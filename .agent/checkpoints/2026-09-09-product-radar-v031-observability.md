# Product Radar V0.3.1 Runtime Observability checkpoint

Date: 2026-09-09 (Asia/Shanghai)
Status: deployed; verified; user inbound smoke pending

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

## Release evidence

- Source commit `8c502a3a73e5e55cffdd575f551aefa362e6a8d1` was pushed to
  `origin/main`.
- Host BuildKit built and loaded `local/product-radar:git-8c502a3a73e5`; the
  active CasaOS image is `local/product-radar:git-8c502a3a73e5` with digest
  `sha256:23160cae30aba2c5853182ce837b815b2ce72cfceab87332f4362c17c216daa7`.
- CasaOS `.env` and Compose backups are
  `.env.codex-backup.20260909-142302` and `.codex-backup.20260909-142302`;
  Product Radar was recreated with `docker compose up -d --no-build`.
- LangBot Product Radar plugin `0.5.0` package SHA-256 is
  `cb8ee31fad24683df691bb4e6939ca77a465fd41d8b4d0f9228bd3832d5f4b94`;
  install task `94` reached `INSTALL_READY`, rollback dir is
  `.backups/langbot/20260909-142343`.
- Live `/health` is `status=ok`; 3 existing Watches, 2 SearchFeeds and 2663
  listings remain; status API smoke initialized 3 runtime-stat rows and the
  context API returned HTTP 200. `scripts/doctor.sh` reported 0 failures and
  0 warnings. No real Watch was created/deleted and no manual Telegram/KOOK
  notification was sent.

## User smoke

- The deployed plugin now restores a Watch from the durable ownership key after
  reload, then routes `不要盯着了` / `取消监控` to deterministic delete. The 3
  historical Watches predate this binding and are intentionally not guessed
  among; if the current conversation has no binding, the bot asks for the
  product URL or Watch ID rather than claiming success.

## Rollback

- Restore the recorded CasaOS `.env` image backup and run Compose with
  `--no-build`.
- Restore the LangBot plugin package from the deployment backup.
- Do not remove `/DATA/AppData/product-radar` or changedetection datastore.
