# Typed voice modality candidate live

Date: 2026-09-28 Asia/Shanghai.

- Source commit: `89826fd` (`fix(amadeus): scope typed voice replies per turn`), pushed to `origin/main`.
- Candidate image: `local/openclaw-amadeus:git-89826fd8e5cc-20260928035547`.
- External rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260928035547`.
- Post-deploy evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260928035547`.
- OpenClaw health, Product Radar health, and NAS SSH read-only smoke passed. WhatsApp `secondary` remained linked, connected, and healthy.
- Real WhatsApp inbound acceptance after the switch: the explicit typed voice turn produced exactly one media reply; the following ordinary typed turn produced one text reply and no media reply. No duplicate audio was observed.
- The older `outbound-prepared-v1` failed queue count of 2 was pre-existing; no new failure was observed during this acceptance window.

No secrets, message bodies, phone numbers, audio files, or runtime credentials are stored in this checkpoint.
