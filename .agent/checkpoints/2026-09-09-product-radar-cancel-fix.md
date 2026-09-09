# Product Radar cancellation routing fix checkpoint

Date: 2026-09-09 (Asia/Shanghai)
Status: deployed; verified; user inbound smoke pending

## Root cause

The offline fallback mapped plain `取消监控` to the pending-create
`control=cancel` path unconditionally. With an existing Watch, the listener
could report that no proposal existed without calling Product Radar's delete
API. Natural stop phrases also depended on an in-memory active context.

## Fix

- Pending proposal present: keep `control=cancel` and remove only the proposal.
- Active Watch in the ownership-aware context: emit structured `delete_watch`
  with that Watch ID and use the existing deterministic DELETE API path.
- No unique active context: return clarification instead of claiming success.
- Add conservative offline aliases for `不要盯着了`, `不要再盯了`, and
  `不想盯了`; Luna remains the primary semantic parser.
- Correct the manifest display label to `0.4.1`.

## Verification

- LangBot Product Radar tests: 19/19
- Python compile: passed
- `pnpm check:secrets`: passed
- `git diff --check`: passed
- Source commit `bc8d140220a82b429a84982e0e9f207bcf729f20` pushed to
  `origin/main`.
- LangBot plugin task `89` reached `INSTALL_READY`, live manifest version and
  label are `0.4.1`.
- Product Radar remained healthy with `/health` status `ok`; existing Watch
  count remained 3. No real Watch was deleted during validation and no real
  Telegram/KOOK notification was sent.

## User smoke

Retry `取消监控` or `不要盯着了` in the original Telegram conversation. If
the in-memory active context expired after a plugin restart, specify the
product URL or Watch ID so ownership and target resolution remain explicit.
