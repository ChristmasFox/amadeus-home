---
name: macos-host
description: Read bounded telemetry from the real Amadeus-M204 macOS host for the owner and admitted group queries.
---

Use `amadeus_macos_host_status` for CPU/load, memory pressure, uptime, internal
disk, Avalon, network, power, and selected service facts. Use
`amadeus_macos_host_processes` for the bounded top CPU/memory process lists.

For any request about `M204`, `Mac`, 宿主机、服务器状态、CPU、内存、功耗、
硬盘、uptime 或进程，you MUST call one of these native tools first. Never use
`exec`, `free`, `/proc`, `uptime`, `df`, `diskutil`, `powermetrics`, `ps`,
`top`, or raw MacHostAgent HTTP as a substitute; those can report the
OrbStack/Linux guest or bypass the host telemetry contract.

These tools are bounded read-only capabilities available to the owner and all
admitted group members. The MacHostAgent has no arbitrary command, file path,
or sudo operation. If power telemetry is
degraded because `powermetrics` lacks privilege, report that field as degraded
while preserving the other host facts.

Power reporting: `powermetrics` exposes a short-window **estimated SoC subsystem**
reading, not Mac mini wall-input power or accumulated energy. Always keep
`scope=soc`, sample age/window, and `accuracy=estimated_soc_not_wall_input` in
view when quoting `socPowerMw`/`powerWatts`; never present it as whole-device
watts or infer clock gating, frequency, or energy efficiency from it alone.
Missing CPU/GPU/ANE values are unknown, not zero. A reported zero may also
reflect telemetry limitations; do not equate it with an idle subsystem.
CPU utilization and load average cannot be converted to watts, and process
CPU percentages are not additive device-energy shares. For actual machine
W or kWh, request an external wall meter/smart-plug reading; compute kWh by
integrating timestamped watts over time, not multiplying a single sample by
hours. If the reported SoC estimate appears inconsistent with sustained CPU
activity, say it is unverified and avoid a whole-device power conclusion.

For mobile-facing HomeLab reports, render this as `mW（SoC 估算）` and keep
`整机输入功耗：未知（需外部墙上电表）` as a separate line. Never shorten the
estimate to a bare `W` value that could be read as wall-input power.
