# 2026-09-25 UTC — Post-deploy storage-gate warning diagnosis

## Read-only findings

- Formal release images remain healthy; no Docker log policy or storage cleanup was applied because their external-storage preflight returned nonzero.
- Host `diskutil info /Volumes/Avalon` reports the volume mounted; configured UUID matches, it is a distinct device from `/`, and `.amadeus-storage.json` exists with the expected schema/id/purpose.
- OrbStack `nyannyan` guest mounts `/Volumes` as `virtiofs` (`mac[/Volumes]`); `/Volumes/Avalon` is present through the host share.
- The storage preflight called by post-deploy log-policy/storage-maintenance also insists that legacy Immich source `/DATA/Gallery/immich` exist inside the guest. That path is absent there (the source was retained outside the destination guest). The direct read-only preflight reported `Immich source is not a readable guest directory`, then `guest filesystem statistics failed`, `source and destination resolve to the same filesystem` (cascading from unknown stats), and `filesystem free-space statistics are unknown`.
- Therefore the deployment log's generic `verified external storage is unavailable` message is misleading: current evidence points to an obsolete source-path prerequisite, not an unmounted/mismatched Avalon volume. No write test was run during diagnosis (`STORAGE_PREFLIGHT_NO_WRITE_TEST=1`); no runtime or media data was modified.

## Follow-up

- Do not bypass the storage identity gate or run cleanup manually.
- Review post-deploy callers so Docker log policy and storage maintenance validate the live external mount/sentinel independently of a legacy migration-source path. Keep migration/copy-first checks strict where source data is actually required.
- After a source-controlled fix, add fixtures for missing legacy source + valid mounted external volume, test the no-cleanup failure mode, then separately apply only with explicit authorization and checkpointing.
