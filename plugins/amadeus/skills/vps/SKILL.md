---
name: vps
description: Use the bounded read-only KiwiVM and SSH tools for VPS facts, traffic, resources, and critical service health, including morning/evening owner reports.
---

# Read-only VPS capability

OpenClaw chooses these tools from the user's meaning. Do not create a keyword
router, command parser, generic shell bridge, or control fallback.

All five VPS tools are read-only and accept an empty structured object. They do
not accept an endpoint, shell command, service name, credential, channel, or
recipient:

- `amadeus_vps_service_info`: fixed KiwiVM service/plan facts.
- `amadeus_vps_live_status`: fixed KiwiVM live state, mapped disk facts, and CPU
  throttling.
- `amadeus_vps_usage`: fixed KiwiVM traffic counters, quota, reset time, bounded
  history, and `deltaSincePreviousSampleBytes` from the persisted successful
  sample.
- `amadeus_vps_system_status`: fixed SSH probe for uptime, load average,
  memory, and `/` filesystem usage.
- `amadeus_vps_services`: fixed SSH probe for Caddy, Xray, Hysteria2, and frps.

Select one or combine several tools according to the request. For example,
traffic questions use `amadeus_vps_usage`; “服务器正常吗” normally combines
live status, system status, and services; “Xray 挂了吗” uses the services tool.
Do not call a write action: restart, stop, start, reinstall, password reset,
or arbitrary shell execution are outside this capability.

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
and `amadeus_vps_services`, compose a concise Chinese report from returned
facts, include the mandatory ten-cell traffic line, explicitly highlight every anomaly, and then call
`amadeus_notify_owner` with a stable report event key. That notifier has one
fixed destination: the WhatsApp owner DM. Do not use Telegram, KOOK, a group,
cron fallback delivery, or an invented healthy status.
