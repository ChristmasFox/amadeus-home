# Product Radar LangBot Message JSON parsing repair

Date: 2026-09-11 (Asia/Shanghai)

## User-visible symptom

After the first provider repair and JSON-mode hardening, the user retried an image plus “帮我长期盯着这件，有同款通知我”. Telegram received a normal assistant answer instead of a Product Radar Bunjang proposal.

## Live evidence

- LangBot log at 23:10:28 recorded the exact inbound as `帮我长期盯着这件，有同款通知我[Image]`.
- Plugin runtime at 15:10:50 recorded `intent_planner.py ... JSONDecodeError`; LangBot then streamed the normal chat response (`19 chunks`, `5028 chars`).
- A second request at 23:12:28 produced the same parser error before the new plugin install at 23:12:39.
- Direct 9Router call with the complete Product Radar prompt, JSON mode, and mock image returned a valid structured command (`domain=product_radar`, `intent=create_watch`, `watchType=similarity`); missing source is normalized to Bunjang.

## Root cause

LangBot's real `invoke_llm` contract returns a `provider_message.Message` object. Product Radar's `_content_text()` handled strings, dicts, and lists but not object attributes. Its fallback `str(Message)` wrapped valid JSON in model metadata, so `_parse_json()` raised `JSONDecodeError`. Test doubles returned dicts and therefore missed the production-only type mismatch.

## Change

- Read `.content`, `.all_content`, `.text`, `.message`, `.output` and tool-call argument fields from provider objects before string fallback.
- Keep provider-enforced `response_format=json_object` and one bounded protocol retry; no fixed-keyword primary router was added.
- Normalize source entities to lowercase and default missing similarity source to `bunjang`.
- Added a test double returning a real-shape Message-like object.
- Product Radar plugin manifest advanced to `0.5.6`.

## Verification

- LangBot Product Radar tests: 35/35.
- Product Radar tests: 51/51.
- Real 9Router Luna text and multimodal JSON-mode smokes: passed.
- Mock PNG positive/negative matcher and similarity Watch pause/delete lifecycle: passed.
- LangBot API installation: `local/product-radar 0.5.6`, task `17`, `INSTALL_READY`.
- Runtime: Product Radar `/health` `ok`, Watch count `0`; `scripts/doctor.sh` 0 failure / 0 warning.
- No new parser errors appeared after the plugin mounted at 23:12:40; the two preceding errors belong to the old artifact.

## Git and rollback

- Source commit: `9686530` (`fix(product-radar): parse langbot message responses`), pushed to `origin/main`.
- LangBot plugin rollback directory: `.backups/langbot/20260911-231234/`.
- Earlier provider rollback database backup remains `/DATA/AppData/langbot/backups/langbot.db.codex-product-radar-luna-20260911-224005`.

## Remaining boundary check

Codex did not send a Telegram message. User should resend the image and natural-language request and verify the bot returns “🎯 准备监控”, `平台：bunjang`, and “开始监控 / 取消”.
