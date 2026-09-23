# Amadeus 1.4.8 — Phase 8 Avalon destination preflight (recovered and passed)

Date: 2026-09-23
Approval: `APPROVE_AVALON_MOVE_1_4_8` received.
Goal: `docs/AMADEUS_1_4_8_OPERATION_SKULD_FINAL_CUTOVER_AND_MEMORY_CONTINUITY_GOAL.md`

## Verified on M204 host

```text
SOURCE_AVALON_PATH=absent
DESTINATION_HOST=Amadeus-M204
DESTINATION_ETHERNET=en0:192.168.5.3 (1000baseT full-duplex)
AVALON_MOUNT=/Volumes/Avalon
AVALON_UUID=0C2CC618-D273-470C-8036-9AD6A0D967D7
AVALON_FILESYSTEM=APFS
AVALON_SIZE=8.0TB
AVALON_IDENTITY=verified
AVALON_SENTINEL=verified
AVALON_CAPACITY=expected
AVALON_FREE_SPACE=984GiB (13%, warning below the 20% warning threshold)
IMMICH_MEDIA_ROOT=present
DESTINATION_HOST_WRITE_TEST=passed
DESTINATION_HOST_PROBE_CLEANUP=passed
```

The previously empty ignored target `EXTERNAL_STORAGE_VOLUME_UUID` was set to the observed UUID. A copy of the prior non-secret profile is retained at `/Users/nyannyan/host-profile.env.pre-avalon-20260923`.

After attachment, the encrypted secret bundle and cold snapshot SHA-256 values match the source checkpoint. All 22 checksums in the final HomeLab backup passed again on M204. The manifests and required backup files are present.

## Initial guest-side blocker (resolved)

OrbStack reports `/Volumes` as a `virtiofs` mount in the `nyannyan` guest. The guest's `test -e /Volumes/Avalon` returned true, but `ls -ld /Volumes/Avalon` did not return for over ten minutes; the guest process remained alive despite SIGINT/SIGTERM/SIGKILL. A guest-side read/write/content check therefore has **not** passed.

An approved `orbctl restart nyannyan` was started to recover the shared mount. At checkpoint time OrbStack still reports the machine as `stopping`; the same restart command remains live. No force-stop was used because OrbStack warns it may cause data loss.

No destination container currently binds Avalon; only the six non-Avalon staging services were present before the restart. No Avalon-dependent service, OpenClaw, Product Radar, or owner ingress was started.

```text
AVALON_GUEST_READ=blocked
AVALON_CONTENT=blocked
CUTOVER=BLOCKED
DESTINATION_AUTHORITY=NO
```

Do not start any Avalon consumer or destination OpenClaw until the guest can read the actual mounted volume and the remaining Phase 8 checks pass. The host-local iMessage-only OpenClaw LaunchAgent remains separately unclassified; recheck the unique-runtime gate before any destination OpenClaw startup.

## Recovery update — Phase 8 destination gate passed

After the guest restart completed, `orbctl info nyannyan` reported `State: running`. The guest's `/Volumes` VirtioFS view now reads the attached Avalon volume successfully:

```text
AVALON_GUEST_MOUNT=/Volumes (virtiofs, rw)
AVALON_GUEST_CAPACITY=7.3T total, 985G available (87% used; warning below 20% free)
AVALON_GUEST_SENTINEL=readable; storageId=avalon-primary-8tb
AVALON_GUEST_IMMICH_MEDIA_ROOT=present
AVALON_GUEST_COLD_SNAPSHOT_SHA256=verified
AVALON_GUEST_SECRET_BUNDLE_SHA256=verified
AVALON_GUEST_BACKUP_MANIFEST=present
AVALON_GUEST_WRITE_PROBE=passed and removed
AVALON_GUEST_READ=verified
AVALON_CONTENT=verified
```

The secret bundle and cold snapshot hashes matched the source-freeze checkpoint values. The M204 guest write probe used a unique temporary file, read it back, and removed it. The six loopback staging containers (Dashdot, AriaNG, Xiaoya, Filebrowser, 9Router, Changedetection) returned after restart. A guest-side Docker mount inspection found no `/Volumes/Avalon` bind among them; no Avalon-dependent service, destination OpenClaw, Product Radar, or owner ingress was started.

```text
PHASE_8=PASSED
CUTOVER=NOT_EXECUTED
DESTINATION_AUTHORITY=NO
```

Phase 9 restore has not started. The host-local iMessage-only OpenClaw LaunchAgent remains separately unclassified; before any destination OpenClaw startup, recheck the unique-runtime gate and classify that LaunchAgent.
