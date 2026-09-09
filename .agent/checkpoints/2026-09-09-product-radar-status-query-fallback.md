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

Source commit `00e6889` is pushed to `origin/main`. LangBot Product Radar plugin `0.5.2` was installed with task `109` reaching `INSTALL_READY`; package SHA-256 is `3105e395b73344cea48dd78294f917200083ccafa9bdbd5a77fab69ecd3b0912`, rollback dir `.backups/langbot/20260909-160922`. Post-deploy `scripts/doctor.sh` returned 0 failures / 0 warnings, relevant containers remain running/healthy, and Product Radar still has the one enabled Watch observed during diagnosis. Product Radar runtime image and CasaOS compose remain unchanged. Real Telegram/KOOK inbound smoke is still pending user action.
