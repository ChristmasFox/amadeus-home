# DeliveryEnvelope v2 — candidate applied, owner gates open

Date: 2026-09-30, Asia/Shanghai. Operator explicitly authorized apply.
Source commit: `a1df7b7f9e760f7a3db7b802231faf4d7bcb372e`.

The repository candidate deployment completed after focused tests, typecheck,
Amadeus build, pinned WhatsApp contract checks, secrets scan and a clean Git
preflight. Host BuildKit created and loaded immutable OpenClaw image
`local/openclaw-amadeus:git-a1df7b7f9e76-20260930095303`; Product Radar and
9Router retained their own images. Protected runtime checkpoint:
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930095303` (0700 root,
0600 manifest and consistent `openclaw-state.sqlite.before`). This checkpoint
contains the previous Compose/config, secret copies, npm projects and the
prior healthy immutable-image reference. Post-deploy evidence root:
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260930095303`
(0700, outside Git).

The candidate source restored the pinned `@openclaw/whatsapp` 2026.9.4
archive verified by SHA-512 and AST-installed the one typed channel-plan
boundary. Before switch, `plugins registry --refresh` rebuilt the SQLite
persisted index to include Amadeus with no diagnostic; strict Amadeus tool and
Skill CLI preflights then passed. CasaOS switched the one OpenClaw container
using `docker compose up -d --no-build`. The new Gateway registered Amadeus
(two observed startup markers), health/smoke passed, and the candidate owner
notification was sent through the existing outbox. Product Radar remained
healthy; the media-organizer adapter remained independently absent as already
recorded in the deployment log, not restored as a fallback.

Read-only follow-up: OpenClaw and Product Radar healthy, WhatsApp linked/
running/connected, Telegram running, Amadeus `amadeus_image_upscale` declared,
`voice-reply` and `image-upscale` Skills visible, pinned typed WhatsApp marker
present exactly once, and `tts.auto=off`. The host image-asset service reported
ready. A bounded synthetic Japanese MP3 request to the same `amadeus-tts`
logical speech route returned HTTP 200 and 15,596 bytes of audio in memory;
no audio payload or credential was written to Git.

**This is a candidate, not a release or full Goal acceptance.** No real owner
WhatsApp Gate A–F or recipient-downloaded image SHA-256/byte-size comparison
has been established yet. Real 2x/4x upscale document delivery, PNG/JPEG
MIME independence, no duplicate send, intentional JSON text, voice/TTS failure,
and restart/recreate durability remain owner-channel tasks. If any gate fails,
restore this candidate's protected Compose/config/npm project/SQLite registry
and the previous immutable OpenClaw image, not retired source hacks.
