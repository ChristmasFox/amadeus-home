# Detached image generation completion — protected candidate

Date: 2026-09-30 Asia/Shanghai. Source commit
`77ed8e60a489021170004fa9d3fcebf9b25e5850`.

Root cause: pinned OpenClaw `image_generate` detaches background work in a
normal user session. Its immediate native tool result is `status=started` with
no image path. The generated image later arrives as a typed task-completion
attachment on an inter-session run. The previous Amadeus blanket
inter-session silence suppressed its reply; the after-tool hook saw only the
start result. Read-only transcript metadata and 9Router logs established
successful provider generation followed by repeated completion wake attempts.
No message bodies, identifiers or image bytes are stored here.

Source now accepts only a verified `image_generate:<UUID>` provenance as a
media-completion run, uses the same v2 decoder and settlement, imports typed
image attachment facts as inline registered assets, and cancels the competing
native delivery after the one settlement. A stable opaque delivery id based
on the trusted completion source key makes retries idempotent. Other internal
handoffs remain silent; no text/path tokens decide disposition, and no
automatic media sender is restored. Pinned WhatsApp normal image primitive
and Telegram regressions, plugin 77 tests, typecheck/build, diff check and
secrets scan passed.

Single candidate image:
`local/openclaw-amadeus:git-77ed8e60a489-20260930133806`.
Protected checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930133806`.
Private post-deploy evidence:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930133806`.
Gateway registration, health/NAS and owner outbox passed. Product Radar,
9Router and host image service were not switched. This does not prove real
owner image generation: a new inbound request must show generation completion,
one inline attachment and no duplicate automatic sender. Recipient hash and
other DeliveryEnvelope Goal gates remain open.

## Real owner generation gate failed (21:42–21:44 local)

The owner reported no generated picture. The native `image_generate` tool was
actually invoked at 21:42:15 and returned its background-task start receipt.
9Router primary image generation returned 429; the configured Gemini image
fallback succeeded at 21:43:03. The verified inter-session completion user
turn carried one `image/jpeg` image content part (plus runtime text); no
corresponding generated asset was imported into the Amadeus registry, and no
inline DeliveryEnvelope was settled. The first completion Agent run ended on
`Stream ended without finish_reason`/LLM request timeout. A subsequent run
stopped but the plugin logged `amadeus envelope preparation failed closed`.
The exact inner exception is not logged by the current source; it cannot be
asserted from this evidence whether typed payload attachments were absent,
asset import failed, or the completion route was missing. Do not claim that
the source repair passed the real gate. The current candidate remains healthy
for DM/upscale, but normal image generation is unaccepted. No user content,
image bytes, personal identifiers or paths are stored here.
