# OpenClaw first-person PUBG identity deployment checkpoint

- Date: 2026-09-18 (Asia/Shanghai)
- Observed failure: trusted WhatsApp sender `263376739561510@lid` was already bound to `Arthur` and `SG_LabmemNo007`, but the model handled “我昨天战绩呢” as `team=true` instead of resolving `reference=self`.
- Fix: first-person PUBG references (`我/我的/本人/自己`) must call `identity_resolve(reference=self)` and pass the returned `personId` to the PUBG tool. `team=true` is reserved for an explicit whole-team request.
- Source commit: `f4abc5d` (`fix(pubg): resolve first-person identity before team stats`).
- Image: `local/openclaw-amadeus:git-f4abc5dafb60-20260918132941`.
- CasaOS checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260918132941`.
- Verification: Identity 10/10, PUBG domain 9/9, PUBG plugin 9/9, Amadeus 10/10, affected typechecks/build, secrets scan, OpenClaw/Product Radar health, plugin preflight, media-adapter network, NAS read-only smoke, and owner outbox smoke passed.
- Runtime identity evidence: `263376739561510@lid` resolves to `Arthur` with PUBG external account `SG_LabmemNo007`.
- Boundary: no unsolicited real-group test message was sent; unknown or unbound senders remain fail-closed.
