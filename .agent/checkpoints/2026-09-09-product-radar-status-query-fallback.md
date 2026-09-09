# Product Radar status query fallback checkpoint — 2026-09-09

## Diagnosis

At 16:01, `监控的怎么样了` reached LangBot. The Product Radar Luna intent action failed with `ActionCallError`; the listener returned no Product Radar command, so LangBot's general chat handled the message and produced an incorrect statement that the previous red down-jacket Watch had been cancelled. The live Product Radar API still had one enabled Similarity Watch, with `DEGRADED` status and both SearchFeeds reporting `WATERMARK_NOT_REACHED`.

## Source changes

- Add a narrow, explicit Product Radar status-query fallback for Luna/provider outages.
- Allow unscoped status/stats requests to report one current Watch or aggregate the current list instead of asking for an ID.
- Include each Feed `lastError` in status output so enabled/degraded is distinguishable from cancelled.
- Bump the Product Radar LangBot plugin manifest to `0.5.2`.

## Verification

- LangBot Product Radar tests: 31/31 passed.
- Python compile: passed.
- `pnpm workflow:plan`: FAST / LANGBOT_PLUGIN; no Docker build or runtime image change.
- `git diff --check`: passed.
- Live Watch data was read only; no Watch was created, deleted, or modified.

## Release status

Source changes are ready for commit and plugin deployment. Product Radar runtime image and CasaOS compose remain unchanged.
