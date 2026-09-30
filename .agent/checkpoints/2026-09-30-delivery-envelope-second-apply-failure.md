# DeliveryEnvelope v2 — second candidate stopped at non-root plugin preflight

Date: 2026-09-30, Asia/Shanghai. Operator's explicit apply authorization
remains in scope. Source attempt: `f31dd2e9e38c3cb9822f1ba761dc0a38e7f343ea`.

The focused tests/secrets checks and host BuildKit completed; candidate image
`local/openclaw-amadeus:git-f31dd2e9e38c-20260930080024` was loaded. A new
protected checkpoint exists at
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930080024` (0700 root,
0600 manifest/config). The pinned WhatsApp archive passed version/SHA checks,
the one typed plan installed, and Compose/config definitions were staged.
Before `docker compose up -d`, runtime plugin inspection reported Amadeus
entry unreadable. Root-only image inspection identified
`/app/dist/extensions/amadeus/dist/index.js` and its source map as 0600 root;
the non-root OpenClaw user cannot load them. No production container switch or
WhatsApp acceptance occurred.

Protected rollback restored, via atomic copies verified byte-for-byte against
the checkpoint, OpenClaw compose, its `.env`, OpenClaw config and env,
Product Radar compose and `.env`, and the previous installed WhatsApp monitor
module. Read-only follow-up observed `tts.auto=tagged`, the previous
`local/openclaw-amadeus:git-6311e21b412c-20260930044402` image, and healthy
OpenClaw. No runtime secrets or media are stored in this Git record.

The source fix makes Amadeus's generated bundle explicitly 0644 in build and
immutable image, and tests it as uid 1000 **before** any future persistent
runtime write. Next candidate must have a fresh Git source commit/tag and
checkpoint. If it fails again, restore from its own protected checkpoint;
never reactivate the retired source implementation.
