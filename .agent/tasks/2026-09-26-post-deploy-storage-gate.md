# Fix post-deploy storage gates without weakening external identity checks

- Status: completed in source and formally deployed. 1.5.7/1.5.8 identity-only post-deploy gates passed; bounded storage maintenance completed. 1.5.8 doctor validates the live Immich upload mount separately and no longer checks the retired migration source.
- The Avalon host volume is mounted with matching configured UUID and sentinel; it is distinct from the internal root filesystem. The OrbStack guest sees `/Volumes` via host `virtiofs`.
- The post-deploy preflight incorrectly requires legacy Immich source `/DATA/Gallery/immich` inside the guest. That source is absent from the destination guest (retained externally). Source-stat failure cascades into unknown filesystem/free-space results and a generic “verified external storage unavailable” message.
- Evidence: `.agent/checkpoints/2026-09-25-postdeploy-storage-gate-diagnosis.md`, `.agent/checkpoints/2026-09-25-amadeus-1.5.7-formal-release.md`, and `.agent/checkpoints/2026-09-25-amadeus-1.5.8-formal-release.md`.
- Implemented: both post-deploy callers use the identity-only gate. Copy-first migration checks remain strict. Fixtures cover missing legacy source with valid storage, mismatched identity rejection, and no report/cleanup on a failed post-deploy gate.
- Never bypass the identity gate or run broad prune. A separate Docker log-policy task tracks the remaining host default/Compose parser concern.
