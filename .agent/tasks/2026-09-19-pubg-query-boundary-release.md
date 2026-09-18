# Follow-up: release PUBG query boundary hardening

- Source changes are verified but not deployed.
- Before applying, rebuild the affected OpenClaw image, switch the runtime PUBG config to `businessDayStart: 06:00`, preserve a rollback checkpoint, and run the release smoke matrix.
- Complete one real Telegram/WhatsApp inbound test for a nickname query, a first-person query, a team query, a 06:00 boundary query, and a recent-match review.
