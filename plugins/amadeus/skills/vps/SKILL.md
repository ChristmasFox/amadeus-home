---
name: vps
description: Use the bounded read-only KiwiVM and SSH tools for VPS facts, traffic, resources, and critical service health, including morning/evening owner reports.
---

# Read-only VPS capability

OpenClaw chooses these tools from the user's meaning. Do not create a keyword
router, command parser, generic shell bridge, or control fallback.

The VPS facts and account-usage tools are read-only. They do not accept an
endpoint, shell command, SQL, credential, channel, or recipient:

- `amadeus_vps_service_info`: fixed KiwiVM service/plan facts.
- `amadeus_vps_live_status`: fixed KiwiVM live state, mapped disk facts, and CPU
  throttling.
- `amadeus_vps_usage`: fixed KiwiVM traffic counters, quota, reset time, bounded
  history, and `deltaSincePreviousSampleBytes` from the persisted successful
  sample.
- `amadeus_vps_system_status`: fixed SSH probe for uptime, load average,
  memory, and `/` filesystem usage.
- `amadeus_vps_services`: fixed SSH probe for Caddy, Xray, Hysteria2, and frps.
- `amadeus_vps_subscription_overview`: empty input; returns five Labmem
  identities, the dedicated `M204-Net-Core` Mac mini identity, retired legacy
  history, protocol totals, a 12-hour sample window when known, freshness, each
  account's monitoring start time, and sanitized proxy-security facts. The
  window also exposes the whole-provider bytes, active subscription-account
  bytes, legacy bytes when complete, and an explicitly uncalibrated
  other-service/unattributed residual.
- `amadeus_vps_subscription_detail`: requires one `accountId` from
  `Labmem001`–`Labmem005`, `M204-Net-Core`, or `legacy`; returns one account's
  monitored protocol totals and known activity facts. Legacy is historical and
  disabled after its retirement.
- `amadeus_vps_traffic_fuse`: owner-only fixed read-only status for the
  Shanghai-local daily fuse, including whole-VPS provider/local-WAN counters,
  coverage and freshness, thresholds, state, verified shared rate, next
  midnight recovery time, and bounded durable events. It cannot change `tc`.

Subscription usage is owner-private. The plugin enforces a trusted direct-owner
context or scheduled-report context and rejects group sessions, including when
the owner is speaking in a group. The tools are also absent from group allowlists.

Select one or combine tools according to the request. Whole-plan traffic
questions use `amadeus_vps_usage` for KiwiVM truth and its progress bar, plus
`amadeus_vps_subscription_overview` for the T0-forward account breakdown.
Questions about today's Shanghai calendar-day usage, fuse state, why egress is
limited, or when it recovers use `amadeus_vps_traffic_fuse`. Keep
`provider_confirmed`, calibrated `local_wan_estimate`, `partial_coverage`,
`stale`, and `unknown` explicit. A verified cap is only the shared business
egress rate; it does not guarantee a 50 GB provider-billed ceiling because
ingress may already be billed before Linux can shape it. Never infer `CAPPED`
from a threshold alone: require the tool's verified state and rate.
Security and suspected proxy-usage questions such as “VPS 有没有被盗用”,
“HY2 有异常登录吗”, “Reality 有异常流量吗”, and “哪个订阅流量异常” use
`amadeus_vps_subscription_overview`; use its typed security facts and signals,
not model estimates. “M204-Net-Core 当前在线情况” uses
`amadeus_vps_subscription_detail` for that account's HY2 and VLESS online facts.
Account-specific questions use `amadeus_vps_subscription_detail`; explicit HY2
versus VLESS questions use the same tool's protocol split. Only call the
reported `totalMonitoredBytes` a total when `totalsComplete` is true. Otherwise
say the complete total is unknown and label `knownMonitoredBytes` as observed
traffic so far. Treat `knownProxyAccountedBytes` the same way when
`proxyAccountedComplete` is false; do not present it as a complete proxy total.
“现在谁在线” uses each protocol's overview count only when `onlineStatus` is
`ok`. HY2 reports connected client instances; VLESS reports Xray's active
source-IP count. Neither count proves physical-device ownership, and the
snapshot never includes client IP addresses.
“服务器正常吗” normally combines live
status, system status, and services; “Xray 挂了吗” uses the services tool.
Do not call a write action: restart, stop, start, reinstall, password reset,
or arbitrary shell execution are outside this capability. Account tools are
not added to WhatsApp/Telegram group or non-owner DM tool profiles.

Treat every result's status and source as factual. `stale`, `partial`,
`degraded`, `error`, `unknown`, inactive services, offline/stopped state, API
failure, SSH failure, high root filesystem usage, low remaining traffic, and CPU
throttling must not be described as healthy. A stale traffic result keeps the
last successful counter only; never replace unavailable values with zero.

For a traffic report, keep formatting in Kurisu's final response rather than in
the tool. Use a ten-cell bar from the numeric `usedPercent`:
`filled = clamp(floor(usedPercent / 10), 0, 10)`, then
`"█".repeat(filled) + "░".repeat(10 - filled)`. Show used/total, remaining,
`deltaSincePreviousSampleBytes`, and `resetAt` only when those values are
known. Convert bytes consistently and say when a value is unavailable. A
traffic report is invalid without one dedicated line containing exactly ten
`█`/`░` cells followed by the percentage, including when the percentage is
below 1% (for example `░░░░░░░░░░ 0.9%`).

Scheduled morning/evening VPS reports must call all of
`amadeus_vps_live_status`, `amadeus_vps_usage`, `amadeus_vps_system_status`,
`amadeus_vps_services`, `amadeus_vps_subscription_overview`, and
`amadeus_vps_traffic_fuse`. Compose a
concise Chinese report from returned facts. Include the mandatory ten-cell
whole-plan line, used/total/remaining/reset time when known, provider growth
since the prior successful sample, each active account's monitored total from
its own `monitoringStartedAt`, and the retired legacy total only when
non-zero. Include the
the report window's start/end and sampling coverage. The report must include
one separate line for the default 12-hour window: whole-provider bytes,
active subscription-account bytes, legacy bytes when known, and
`otherServiceBytes` as “其他服务/未归因残差（未校准）” when it is available.
This residual is `providerBytes - active subscriptionBytes`; it is useful for
tracking the gap but is not a precise per-service measurement while
reconciliation is uncalibrated. Include the 12-hour account growth and top
account only when the returned values are complete and comparable. Preserve
unknown protocol counters as unknown; do not turn missing rows or stale/error
sources into zero. State clearly that
per-account attribution begins at the returned T0 and does not reconstruct
earlier current-cycle usage. A monitored total is incomplete while its source
or account counters are missing; never infer zero from a missing row.

Keep provider growth since T0, proxy-accounted totals, and KiwiVM's current
whole-plan quota as three distinct facts. While reconciliation is
`uncalibrated`, say its relationship is unknown and do not calculate a gap or
claim an anomaly. Show HY2/VLESS splits in the normal report only when useful;
include them for an explicit query or when a calibrated anomaly requires
explanation. When security facts are available, add a concise security line
with the observed 12-hour HY2 failed-auth and rate-limit counts and the 12-hour
Reality fallback byte count. If a configured security signal is present, name
the signal and affected account/protocol when supplied. Do not print IPs,
credentials, subscription URLs, or destination history. The unique failure
source count is approximate and covers only the bounded limiter window; limiter
state resets when the accounting service restarts. Highlight source
staleness/degradation and report an unknown reset time as unavailable. Then call
`amadeus_notify_owner` with the existing
stable event key such as `vps-report:2026-09-18:evening`. A manually triggered
cron run must never use the scheduled key; use
`vps-report:manual:<current ISO time>:evening` instead. The plugin also
isolates an accidentally reused scheduled key at the tool boundary. That
notifier has one fixed destination: the WhatsApp owner DM. Do not use Telegram,
KOOK, a group, cron fallback delivery, or an invented healthy status.

Add one concise Shanghai-day fuse line to both scheduled reports: observed
whole-VPS bytes and source/coverage, state and threshold, actual shared rate
only when verified, time in protection when known, and the exact next
Asia/Shanghai midnight recovery when capped. Keep this separate from the
provider billing-cycle total and the six-account breakdown. If the fuse tool is
unavailable or degraded, say so; never imply that no cap exists.

Describe a configured threshold crossing as an “observed suspicious signal”.
Traffic volume, one online-count sample, failed-auth counts, or fallback bytes
alone do not prove credential theft or VPS compromise. Do not call a credential
“leaked” or the VPS “compromised” without direct evidence. Provider/proxy
differences remain unknown while reconciliation is `uncalibrated`.
