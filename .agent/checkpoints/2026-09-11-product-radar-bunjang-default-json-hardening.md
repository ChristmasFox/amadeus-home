# Product Radar Bunjang default + structured JSON parser hardening

Date: 2026-09-11 (Asia/Shanghai)

## User-visible symptom

An image plus “帮我长期盯着这件，有同款通知我” still received the general-chat answer instead of a Product Radar proposal. The intended behavior is an automatic Bunjang similarity Watch when no platform is explicitly named.

## Evidence and cause

- Product Radar plugin logs at the screenshot time showed `intent_planner.py ... JSONDecodeError`, after the earlier Cloudflare `1010` provider failure had been repaired.
- A direct 9Router multimodal smoke with the full Product Radar prompt returned valid JSON with `domain=product_radar`, `intent=create_watch`, and `watchType=similarity`; omitted source is normalized to `bunjang`.
- The previous parser relied on prompt-only JSON instructions and `funcs=[]`; JSON mode was not requested, so a model response could be syntactically non-JSON and bypass the listener.

## Change

- `intent_planner.py` requests OpenAI-compatible `response_format=json_object`, falls back for older/unsupported providers, and performs one bounded protocol retry when parsing fails.
- Source entities are normalized to lowercase; similarity creation already defaults to `bunjang`, now covered by structured command and payload assertions.
- No Product Radar keyword list was added as the primary router; Luna remains the semantic owner and Core still consumes only structured commands.
- Mock PNG positive/negative matcher assertions and similarity Watch pause/delete lifecycle assertions were added.
- Plugin manifest advanced to `0.5.5`.

## Verification

- LangBot Product Radar tests: 34/34.
- Product Radar tests: 51/51.
- Python compile, `git diff --check`, secret scan: passed.
- Real 9Router Luna text and multimodal JSON-mode smokes: passed.
- LangBot plugin API install: `local/product-radar 0.5.5`, task `13`, `INSTALL_READY`.
- Runtime: Product Radar `/health` `ok`, Watch count `0`; `scripts/doctor.sh` 0 failure / 0 warning.

## Git and rollback

- Source commit: `59e44fe` (`fix(product-radar): enforce structured bunjang watch parsing`), pushed to `origin/main`.
- LangBot plugin rollback directory: `.backups/langbot/20260911-230315/`.
- The external LangBot database/model rollback backup from the preceding Luna provider repair remains `/DATA/AppData/langbot/backups/langbot.db.codex-product-radar-luna-20260911-224005`.

## Remaining boundary check

No real Telegram message was sent by Codex. User should send the reference image plus the natural-language request and verify that the bot shows “🎯 准备监控”, platform Bunjang, and “开始监控 / 取消” buttons.
