# Fix post-deploy storage gates without weakening external identity checks

- Status: root cause identified by read-only diagnosis; no storage/log-policy apply or cleanup was performed.
- The Avalon host volume is mounted with matching configured UUID and sentinel; it is distinct from the internal root filesystem. The OrbStack guest sees `/Volumes` via host `virtiofs`.
- The post-deploy preflight incorrectly requires legacy Immich source `/DATA/Gallery/immich` inside the guest. That source is absent from the destination guest (retained externally). Source-stat failure cascades into unknown filesystem/free-space results and a generic “verified external storage unavailable” message.
- Evidence: `.agent/checkpoints/2026-09-25-postdeploy-storage-gate-diagnosis.md`; release evidence logs for 1.5.4, 1.5.5, 1.5.6 show the generic message.
- Next: update `apply-docker-log-policy.sh` and `storage-maintenance.sh` so their post-deploy gates verify Avalon mount UUID/sentinel and relevant destination, without requiring a legacy migration source. Keep strict source checks for copy-first migrations. Add fixtures for mounted-valid-volume + missing legacy source; prove no cleanup occurs when identity fails.
- After source tests and secrets/architecture gates, commit/push. Apply only the bounded log-policy/storage-maintenance correction with explicit authorization, backup/checkpoint, and post-apply verification. Never bypass the identity gate or run broad prune.
