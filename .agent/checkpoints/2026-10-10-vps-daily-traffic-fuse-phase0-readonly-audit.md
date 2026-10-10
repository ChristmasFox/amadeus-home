# VPS daily traffic fuse Phase 0 read-only audit

Date: 2026-10-10 (Asia/Shanghai)
Status: READ_ONLY_AUDIT_CAPTURED; LIVE_APPLY_BLOCKED_PENDING_RECOVERY_AND_QDISC_DESIGN

This checkpoint contains only sanitized observations. No VPS service, firewall,
qdisc, route, proxy credential, account credential, or traffic source was
modified. No traffic was generated for this audit.

## Observed source and calendar facts

- `amadeus-gateway-accounting.service` was active.
- The host timezone was `Asia/Shanghai`; the fuse still uses an explicit
  `Asia/Shanghai` `ZoneInfo` partition and UTC durable timestamps.
- Provider sampling in the accounting SQLite delta history was 60 seconds for
  each of the seven most recent intervals.
- The sanitized provider snapshot reported source `ok`, six enabled active
  accounts (`Labmem001`–`Labmem005` and `M204-Net-Core`), and `legacyEnabled=false`.
- The provider report window was 43,200 seconds with 241 samples at audit time;
  `providerComplete` was still false, as expected while the post-rollout window
  remains incomplete.

## Routing and qdisc facts

- The default route used `eth0`.
- A route lookup for the current SSH peer also used `eth0`.
- `tc -j qdisc show dev eth0` reported a root `fq` qdisc with handle `0:`;
  no classes or filters were present.
- The fuse helper therefore treats the current root as foreign and refuses to
  replace or delete it. The current source does not install a live shaper.
- The installed `fq` implementation exposes only a qdisc-wide `maxrate` option;
  using `tc qdisc change ... fq maxrate 2mbit` would throttle the SSH recovery
  path too and cannot provide the required business-only shared class. A
  `clsact` attachment can classify packets but does not provide a shaped
  egress queue. Neither is an acceptable composition for this Goal.

## Recovery and apply boundary

- The audit did not prove an independent console path or a timed rescue that
  can clear a fuse-owned rule if SSH becomes unreachable.
- It did not prove that the existing `fq` root can be composed with the
  intended aggregate HTB policy without replacing a foreign root.
- It did not calibrate provider-billed ingress against the WAN counters.
- The Phase 1 controller/helper/systemd source is present in Git, but
  `autoApply` remains false in the example configuration and no traffic-fuse
  unit is installed or active on the VPS.

## Next safe step

Design and test a non-destructive composition or an explicitly checkpointed
replacement strategy for the existing `fq` root, prove an independent timed or
console recovery path, and complete provider/local scope calibration before a
separate operator-authorized `--apply`. Until then, report the fuse as source
implemented and live apply pending; do not claim a 2 Mbps cap or recovery.

## Source evidence after the audit

- `infra/vps/traffic-fuse/` now contains the bounded SQLite meter, Shanghai
  partitioning, reset/staleness handling, durable event keys, fixed `tc`
  planner/read-back, and rescue/release templates.
- The fixed SSH probe exposes only the sanitized traffic-fuse snapshot; the
  Amadeus owner tool and 60-second worker reuse the existing worldline adapter
  and owner outbox.
- Focused Python tests (11), Amadeus VPS tests (4), Amadeus typecheck,
  architecture check, secrets scan, `sh -n`, `py_compile`, and `git diff
  --check` passed. `systemd-analyze` was not available on the Mac audit host;
  no runtime units were installed or started.
- The VPS's read-only `systemd-analyze calendar "*-*-* 00:00:00
  Asia/Shanghai"` normalized to the next UTC+08 midnight. Unit-file
  verification was not run by writing temporary unit files to the VPS.
