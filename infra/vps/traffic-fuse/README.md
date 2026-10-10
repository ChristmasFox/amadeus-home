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

The example config keeps `autoApply=false`. A future runtime install must:

1. complete the read-only interface/qdisc/provider-scope audit;
2. provision the fixed probe group and root-only state/config paths;
3. arm and verify the one-shot rescue timer before any qdisc mutation;
4. perform a controlled isolated 2 Mbps aggregate test and SSH reconnect;
5. authorize live `--apply` separately, with a dated root-only checkpoint.

The fixed probe reads only the sanitized `public-snapshot.json`. It never reads
this SQLite file, proxy credentials, account databases, client addresses,
destination history, or provider API secrets. The HomeLab owner worker polls
the probe at a bounded cadence and lets the existing owner outbox deduplicate
warning, engagement, release, and failure event keys.
