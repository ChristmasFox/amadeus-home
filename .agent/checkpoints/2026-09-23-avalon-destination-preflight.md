# Amadeus 1.4.8 — Phase 8 Avalon destination preflight (in progress)

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

## Guest-side blocker

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
