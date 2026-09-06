# 2026-09-06 NAS Disk Accounting and Localization — Source Stage

## Findings

macOS `df -Ph /` reported `460GiB total`, `16GiB Used`, `36.2GiB Avail`, and `31%`. The root mount is an APFS system snapshot, so the snapshot Used column does not represent the whole APFS container. The reliable occupied-space calculation for this status payload is `total blocks - available blocks`, producing approximately `424GiB` used and `92.1%` usage on the current Mac.

## Changes

- `nas-control.sh` now reads raw `df -P` blocks, derives occupied blocks, humanizes all three sizes, and emits a decimal usage percentage.
- `nas_status.py` now labels disk fields as `已用 ... / ...` and supports decimal warning thresholds.
- Uptime is rendered as Chinese days/hours/minutes.
- `pmset` source, battery percentage, charging state, and remaining time are rendered as Chinese power status.
- Plugin manifest version bumped to `0.1.4` so LangBot accepts the update.

## Activation evidence

The external forced command was updated and the clean commit was installed through the authenticated LangBot Plugin API. `macos-nas-control` v0.1.4 reached `INSTALL_READY` as task `19`. The active plugin runtime called the real macOS `nas.status` command and rendered approximately `424GiB / 460GiB`, `92.1%` usage for the system disk, plus Chinese uptime and power status. No runtime plugin directory was manually edited.
