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

## Follow-up release amendment (2026-09-09)

- Fixed additive migration backfill so existing `search_feed_runs` history
  populates `runCount`, `successCount`, `lastRunAt`, `lastSuccessAt`,
  `lastError`, and the current consecutive `failureCount` without retaining an
  old error after a newer successful run.
- Verification: Product Radar tests 46/46; LangBot tests 23/23 with the
  plugin directory on `PYTHONPATH`; root tests 129 pass / 1 skip; typecheck,
  build, Python compile, secret scan and diff check passed.
- Source commit `a446838fc992a7237e6637c3c1c4cd5a97059425` was pushed to
  `origin/main`.
- Host BuildKit image `local/product-radar:git-a446838fc992` was loaded into
  OrbStack `ubuntu`; active image ID is
  `sha256:933c98b5b184b655517735d3677762a420c06c86cf4eda85d6848018eeb5f4c8`.
- CasaOS Product Radar was recreated with `docker compose up -d --no-build`;
  rollback files are
  `/var/lib/casaos/apps/product-radar/docker-compose.yml.codex-backup.20260909-144144`
  and `/var/lib/casaos/apps/product-radar/.env.codex-backup.20260909-144144`.
- LangBot Product Radar `0.5.0` install task `97` reached `INSTALL_READY`;
  package SHA-256 is
  `17ee72dadfe014715f47863e8e086eeb85f8b6fb00e4d885ad4adc7d0a81bc04`,
  rollback dir is `.backups/langbot/20260909-144208`.
- Live verification: Product Radar and changedetection are healthy; `/health`
  is `ok`, with 3 Watches, 2 SearchFeeds, 2663 listings and 4 historical
  feed runs. Each historical Similarity Feed now reports 2 runs, 0 successes,
  2 consecutive failures and `WATERMARK_NOT_REACHED`. `scripts/doctor.sh`
  reports 0 failures and 0 warnings.
- User inbound Telegram/KOOK smoke remains pending. The deployed cancellation
  path is ownership-aware: a unique restored Watch can be deleted; multiple
  legacy Watches without a binding produce clarification instead of guessing.
