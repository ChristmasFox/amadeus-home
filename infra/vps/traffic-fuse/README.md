# Amadeus VPS traffic fuse source

This directory is the deterministic Phase 1 source for the daily whole-VPS
traffic fuse. It is not a deployment script and does not contain credentials.

## Local checks

```sh
python3 -m unittest discover -s infra/vps/traffic-fuse -p 'test_*.py' -v
python3 -m py_compile infra/vps/traffic-fuse/*.py
```

The controller uses exact decimal thresholds of 40,000,000,000 and
50,000,000,000 bytes, partitions by `Asia/Shanghai`, stores UTC timestamps,
and keeps source coverage explicit. A provider counter reset, WAN counter or
interface change, stale source, and cross-midnight interval remain partial or
unknown. Cross-midnight increments are proportionally apportioned and retain a
partial-coverage marker.

## Administrative boundary

`traffic_fuse.py` exposes `status`, `dry-run`, `sample`, `tick`, `apply`, and
`release`. `apply` and `release` invoke only the fixed `tc_helper.py` when run
with a root-owned runtime config. The helper accepts only `status`, `apply`, or
`release`, validates the configured interface and SSH port, rejects a foreign
root qdisc, and requires a post-operation kernel read-back. The current
`amadeus-gateway` audit found a foreign root `fq` qdisc, so the helper must
reject a live apply until an operator-approved, non-destructive composition or
replacement plan and an independent rescue path are proven.

## Runtime install (live on amadeus-gateway since 2026-10-23)

`install.sh <staged infra/vps dir> [interface]` installs the code under
`/usr/local/libexec/amadeus-vps-traffic-fuse/`, the root-owned config under
`/etc/amadeus/traffic-fuse.json`, the setgid state directory
`/var/lib/amadeus-traffic-fuse/` (group `amadeus-accounting-snapshot`, so the fixed
probe can read `public-snapshot.json`) and enables the 10-second sampling timer and
the Shanghai-midnight release timer. The rescue service/timer are installed but never
enabled: arm `amadeus-vps-traffic-fuse-rescue.timer` by hand before any manual
`tc_helper.py apply`. The sampling and release services run with
`SupplementaryGroups=amadeus-accounting-snapshot` so they can read the provider snapshot
without extra capabilities. `autoApply` is set to `true` in the runtime config only
after the controlled test below passed.

The kernel-default root qdisc (handle `0:`, kind equal to `net.core.default_qdisc`, or
`noqueue` on virtual devices) is not "foreign": `tc qdisc del root` makes the kernel
recreate exactly that qdisc, so the helper may replace it and release restores it.
Any other root qdisc (another kind, an explicit handle) is still refused.

Verified on 2026-10-23: isolated veth namespace test (business flow 1.94 Mbit/s,
port-22 flow in the control class, release restores the default), then a live
apply/release on `eth0` with the rescue timer armed (fq 0: -> htb 1a: -> fq 0:,
read-back verified, SSH uninterrupted).

Operational notes: the first day after install has `partial_coverage` (traffic before
the first sample is not counted); a full-day guard starts at the next Shanghai midnight.
