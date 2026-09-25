# Investigate post-deploy external storage gate warnings

- Status: pending read-only diagnosis; do not re-run apply gates until the external storage mount and identity are verified.
- Amadeus 1.5.4 formal release is healthy and complete; this is a separate post-deploy maintenance warning, not a release rollback trigger.
- Evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925161434/log-policy.log` says `LOG_POLICY=blocked; verified external storage is unavailable`; `storage-maintenance.log` says `REASON=verified external storage gate failed`.
- Consequently Docker logging policy was not applied and post-deploy cleanup was not executed. No extra runtime mutation was made.
- Next: use `storage-preflight.sh --status` and mount/sentinel/UUID evidence to reconcile the host-shared `/Volumes/Avalon` path versus the guest's verified external storage gate. Preserve the release rollback checkpoint. Once the required external storage identity is verifiably available, separately authorize/apply the log-policy and storage-maintenance operations; never bypass the gate or prune broad resources.
