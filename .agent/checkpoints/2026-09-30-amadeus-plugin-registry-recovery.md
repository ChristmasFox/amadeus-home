# Amadeus persisted plugin registry recovery — 2026-09-30

The fifth authorized DeliveryEnvelope candidate applied source
`6f0a4f5476e0e683519a0bc40b42f80928cceb86`. It passed static/image
preflight and briefly replaced the single OpenClaw container. The Gateway
became healthy but did **not** register Amadeus. No WhatsApp Gate was claimed.
The previous image, Compose/env/config and WhatsApp module were restored from
protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930085757`.
On recreation even the old image did not register Amadeus, although its
healthcheck passed. This disproved the earlier assumption that the offline
CLI diagnostic was harmless. The host-native image asset service itself
remained ready; the Amadeus tool path was temporarily unavailable.

Read-only inspection of `state/openclaw.sqlite` identified the canonical
persisted `plugins.installedIndex` record: 63 plugins, no Amadeus entry, and
one saved Amadeus unreadable-entry diagnostic. This persisted index was the
blocking runtime state; changing immutable images did not rebuild it.

Before mutation, a consistent SQLite backup and 0600 manifest were created
under root-0700 protected external path
`/DATA/AppData/openclaw/backups/amadeus-plugin-registry-recovery-20260930T093520Z`.
The official `openclaw plugins registry --refresh` command returned a fresh
index with 64 plugins, one Amadeus record, and no Amadeus diagnostic. A
subsequent CLI showed Amadeus `loaded`; after restarting only the **old**
OpenClaw image, the actual Gateway emitted two Amadeus registration markers,
`voice-reply`/`image-upscale` Skills appeared, `tts.auto=tagged`, and the
container was healthy. The checksum-pinned candidate image, inspected with
a read-only mount of the refreshed registry, also discovered Amadeus without
a diagnostic. This is not a successful DeliveryEnvelope production switch.

Git's deployment source now must capture a consistent SQLite checkpoint before
staging config, run the official registry refresh from the candidate image,
and require a fresh Amadeus record/zero diagnostics **before** the original
strict plugin/Skill preflights and real Gateway registration gate. If a later
candidate fails, restore the attempt's image/config/installed channel module
and protected registry state. Runtime secrets and media remain outside Git.
