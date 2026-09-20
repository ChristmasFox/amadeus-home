---
name: nas
description: Read the fixed Mac NAS status and disk probes, or request owner-only sleep.
user-invocable: false
---

# NAS

Use `amadeus_nas` only with `status`, `disk`, or the explicit owner-only
`sleep` action. The tool is a fixed command boundary, not a generic shell.
Keep unavailable fields unknown and report the command result faithfully.
