---
name: macos-host
description: Read owner-authorized bounded telemetry from the real Amadeus-M204 macOS host.
---

Use `amadeus_macos_host_status` for CPU/load, memory pressure, uptime, internal
disk, Avalon, network, power, and selected service facts. Use
`amadeus_macos_host_processes` for the bounded top CPU/memory process lists.

These tools are owner/private capabilities. The MacHostAgent is read-only and
has no arbitrary command, file path, or sudo operation. If power telemetry is
degraded because `powermetrics` lacks privilege, report that field as degraded
while preserving the other host facts.
