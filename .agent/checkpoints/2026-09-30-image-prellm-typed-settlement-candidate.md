# Typed generated image settlement before completion LLM

Date: 2026-09-30 Asia/Shanghai. Source commit
`0bccf10fed16f883bb557aaf0e1495f902bbb6f4`.

The previous real owner gate proved native `image_generate` executed and
9Router fallback generated successfully. Read-only inspection of the trusted
completion turn showed a typed `image/jpeg` data part whose bytes matched the
native generated file byte-for-byte. The prior candidate waited for a second
LLM run to produce a final payload; its first run failed with an incomplete
stream, and a later attempt failed envelope preparation. No generated image
was delivered. No message content, identifiers, image bytes or paths are
retained here.

New source checks host-owned inter-session provenance plus the matching
`image_generate:<UUID>` run identity, imports only bounded typed image data
through the existing asset service, and prepares an attachment-only v2
envelope. It settles using the same WhatsApp or Telegram typed settlement
before the completion LLM succeeds/fails. The later model reply is canceled,
with a stable opaque delivery id preventing duplicate sends on retries. No
text parsing, path token, automatic media sender or second ledger was added.

Focused real-hook-chain tests, plugin 77 tests, typecheck/build, diff check and
secrets scan passed. Protected candidate apply built only OpenClaw:
`local/openclaw-amadeus:git-0bccf10fed16-20260930142414`.
Checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930142414`.
External private evidence:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930142414`.
Gateway registration, health/NAS and owner outbox passed. 9Router, Product
Radar and host image service were not switched. A fresh real owner ordinary
image-generation request is still required to prove provider completion,
one inline settlement, no duplicate and recipient visibility. Other Goal
gates remain open.
