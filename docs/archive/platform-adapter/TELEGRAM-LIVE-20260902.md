# Telegram Live Verification — 2026-09-02

## Configuration

- LangBot Bot name: `Arthur's Agent`
- Telegram username: `@arthur_amadues_bot`
- LangBot bot UUID: `e2ff1900-fd8a-4ad5-9e99-6cae6afdb831`
- Adapter: `telegram`
- Enabled: `true`
- Pipeline: `KOOK Pipeline` (`2cc265c7-0dd1-4221-b594-0a6b38d7c1d5`)
- Token: configured in LangBot, value intentionally omitted

## Network Fix

The Ubuntu host could reach Telegram through the existing local proxy, while the
LangBot container had no proxy environment and the built-in Telegram adapter
failed during `getMe` with `httpx.ConnectTimeout`.

The LangBot CasaOS definition now supplies the existing proxy to the main
LangBot service and excludes local/container networks through `NO_PROXY`.
The previous definition is kept on the host as:

`/var/lib/casaos/apps/langbot/docker-compose.yml.pre-20260902-telegram-proxy`

The plugin runtime, PUBG Query Engine, n8n workflows and `pubg_cache` were not
changed.

## Timeout Incident and Remediation

At 21:31 on 2026-09-02 the built-in adapter reported `telegram.error.TimedOut`.
The traceback ended in `httpcore.ReadTimeout` while `telegram.py` was running
`application.initialize()` and `get_me()` through the proxy. The old adapter
allowed this transient startup exception to end the platform task.

The first remediation image was `langbot-local:4.10.8-telegram-retry-20260902`.
After reviewing the outbound failure path, the live image was upgraded to
`langbot-local:4.10.8-telegram-send-retry-20260902` at 21:53:36 on
2026-09-02, then to `langbot-local:4.10.8-telegram-watchdog-20260902` at
22:17:13 after a polling liveness incident. Its Telegram adapter uses explicit configurable
connect/read/write/pool timeouts, applies the configured HTTPS proxy to both
normal requests and polling, retries startup with exponential backoff, uses
indefinite polling bootstrap retries, and retries transient outbound Bot API
calls (`TimedOut`/`NetworkError`) up to three attempts. Cosmetic streaming
draft failures are ignored after retry so they cannot turn a successful final
reply into an adapter error. The timeout values are supplied by the LangBot
Compose environment and contain no credentials. The watchdog keeps the
adapter task alive, checks PTB's polling task, records polling errors, and
restarts the adapter after an unexpected polling exit. Normal shutdown sets a
stop flag so it does not restart during service shutdown.

## Verification

- Telegram Bot API `getMe`: PASS from inside the LangBot container.
- Telegram Bot API `getWebhookInfo`: PASS; webhook URL empty, pending updates `0`.
- LangBot latest Telegram adapter log: `Telegram adapter running`.
- Post-send-retry stability window: PASS; the new container stayed running, no new adapter timeout appeared, and five consecutive in-container `getMe` requests succeeded.
- Outbound retry fixture: PASS; a simulated `TimedOut` was retried and succeeded on the second call.
- Polling recovery: PASS; 8 Telegram updates were consumed after the recovery restart, with successful replies and pending updates returning to `0`.
- Watchdog stability: PASS; the watchdog image remained running during a 25-second observation with no new adapter error.
- LangBot service: running; both KOOK and Telegram bots enabled.
- Real Telegram user inbound/reply: PASS for private and group chats.

## Observed Smoke Test

- Private chat `测试`: received and replied successfully.
- Private chat `今天战绩` and a follow-up date query: received and returned the structured PUBG result/status.
- Group chat `测试`: received and replied successfully.
- Group chat `今天战绩` and `昨天战绩`: received and returned the corresponding PUBG status/report.
- LangBot monitoring rows show one assistant response for each observed user message; no Telegram timeout appeared after the proxy fix.

## Optional Next Check

Open Telegram, find `@arthur_amadues_bot`, and send:

```text
/pubg
```

or:

```text
昨日战绩
```

Do not send the Bot token in chat. For any future regression, verify one reply,
the PUBG pipeline result, and the structured trace in LangBot logs. KOOK still
requires its own human-inbound smoke test.

## Current Rollback Point

The live compose backup immediately before the outbound retry deployment is:

`/var/lib/casaos/apps/langbot/docker-compose.yml.pre-20260902-telegram-send-retry`

The previous images remain available as
`langbot-local:4.10.8-telegram-send-retry-20260902` and
`langbot-local:4.10.8-telegram-retry-20260902`. No n8n workflow, plugin runtime,
PUBG Query Engine, or `pubg_cache` data was changed by this remediation.
