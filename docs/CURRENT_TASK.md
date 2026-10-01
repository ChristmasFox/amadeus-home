# Current Task — Amadeus 1.7.6 delivery-boundary repair

Date: 2026-10-01 (Asia/Shanghai).

Active Goal: none.
Previous completed Goal: `docs/AMADEUS_IMAGE_LIFECYCLE_NATURAL_PERSONA_MESSAGING_GOAL.md` (1.7.5).
Target release: **Amadeus 1.7.6**.
Status: `DEPLOYED_AUTOMATED_GATES_PASSED_AWAITING_OWNER_CHANNEL_ACCEPTANCE`.

Source commit `092b262` is pushed to `main`. The immutable OpenClaw 2026.9.4
image `local/openclaw-amadeus:git-092b262332b7-20261001102103` (image ID
`sha256:fa5ea5829b3d1e795e90b9ba8522140efc55eed502b82eb34a9168a34de3a14`)
is live on OrbStack `nyannyan`; runtime `/opt/amadeus/VERSION=1.7.6`, OpenClaw
and Product Radar health, Gateway Amadeus registration, NAS read-only smoke,
owner notification/outbox smoke, and post-deploy maintenance passed. Protected
rollback checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261001102103`
(directory 0700, manifest 0600); content-safe evidence is under
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261001102103`.

The pre-deploy live image was actually the healthy 1.7.4 rollback tag
`git-628703c803e7-20260930184906`, despite prior context claiming 1.7.5. Source
review matched a previously documented OpenClaw WhatsApp defect: the final
`delivery.deliver()` callback may bypass `preparePayload`. The callback now
re-runs strict typed preparation and preserves trusted internal provenance;
regression tests cover direct callback bypass, legacy marker/sentinel-shaped
malformed output, internal heartbeat silence, and a valid structured reply. The
exact user-reported send was not correlated to content-bearing logs, so its
individual runtime event path is not claimed as proven.

Focused delivery suite (83 plus pinned integration), full Amadeus suite (117),
typecheck/build, architecture checks, version checks, secrets scan, and
`git diff --check` passed. Deployment skipped only the absent optional
`media-organizer-adapter` network check and reported a non-blocking host Docker
log-policy warning; detailed automated results are in
`.agent/checkpoints/2026-10-01-amadeus-1.7.6-whatsapp-final-delivery-release.md`.

Manual post-deploy owner WhatsApp/image-experience acceptance has not yet been
performed. The deployment notification/outbox smoke is not represented as that
acceptance. No cross-restart exactly-once claim is made.
