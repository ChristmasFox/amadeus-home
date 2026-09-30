# DeliveryEnvelope v2 — fourth candidate stopped at offline Skill listing

Date: 2026-09-30, Asia/Shanghai. Explicit production apply authorization
remains active. Source attempt: `71255820faa572ca42a6f7fe3b190699b9d047b1`.

The fourth candidate built immutable image
`local/openclaw-amadeus:git-71255820faa5-20260930084057`, passed non-root
bundle readability, created protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930084057`, and
installed the checksum-pinned typed WhatsApp plan. The outgoing config and
Compose were staged. Before any `docker compose up`, the out-of-process CLI
`skills list --json` omitted all Amadeus Skills, so the script stopped. The
same CLI had already misreported the Amadeus entry under the mounted config;
this Skill omission is a consequence of that scanner path, not evidence that
the candidate image lacks the files.

Independent uid-1000 inspection of this exact candidate image read the bundled
Amadeus manifest (27 declared tools) and **all 14 non-empty Skill files**,
including `voice-reply` and `image-upscale`. The prior healthy Gateway startup
log proves real Amadeus registration on the old image even though its own
out-of-process plugin inspector falsely reports an unreadable entry.

Protected rollback atomically restored and SHA-verified OpenClaw and Product
Radar Compose/env, OpenClaw config/env and the previous WhatsApp monitor from
this attempt's checkpoint. The previous immutable image remained healthy,
`tts.auto=tagged`, and no production container switch or real WhatsApp Gate
occurred. Secrets and media stay outside Git.

Next candidate uses uid-1000 manifest/Skill readability and source tests before
switch, then **actual Gateway Amadeus registration and health** as hard gates
immediately after the single-container switch. If the real Gateway does not
register, restore its own protected checkpoint. Do not call this Goal complete
until real owner WhatsApp Gates A–F pass.
