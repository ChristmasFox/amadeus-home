# Investigate post-deploy external storage gate warnings

- Status: pending read-only diagnosis; do not re-run apply gates until the external storage mount and identity are verified.
- Amadeus 1.5.4 formal release is healthy and complete; this is a separate post-deploy maintenance warning, not a release rollback trigger.
- Evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925161434/log-policy.log` says `LOG_POLICY=blocked; verified external storage is unavailable`; `storage-maintenance.log` says `REASON=verified external storage gate failed`.
- 1.5.4 evidence also contains this warning. The 1.5.5 release repeated it at `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925164645/{log-policy.log,storage-maintenance.log}`.
- Consequently Docker logging policy was not applied and post-deploy cleanup was not executed in either release. No external-storage gate was bypassed.
- Next: use `storage-preflight.sh --status` and mount/sentinel/UUID evidence to reconcile the host-shared `/Volumes/Avalon` path versus the guest's verified external storage gate. Preserve the release rollback checkpoint. Once the required external storage identity is verifiably available, separately authorize/apply the log-policy and storage-maintenance operations; never bypass the gate or prune broad resources.

- Amadeus 1.5.6 formal release repeated the same blocked gates: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260925183945/{log-policy.log,storage-maintenance.log}`. Voice release is healthy; these separate operations remain unapplied. No broad cleanup was performed.
