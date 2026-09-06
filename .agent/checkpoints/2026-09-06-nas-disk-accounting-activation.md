# 2026-09-06 NAS Disk Accounting Activation

- Source commit: `0e3115d`.
- External macOS forced command redeployed; rollback backup: `/Users/blacksidev/.local/bin/nas-control.codex-backup.20260906-140651`.
- LangBot Plugin API installation: `local/macos-nas-control` v0.1.4, task `19`, `INSTALL_READY`.
- Active `langbot_plugin_runtime` end-to-end smoke passed.
- Real output now shows the APFS system disk as approximately `已用 424GiB / 460GiB，可用 36.2GiB，使用率 92.1%` instead of the snapshot's misleading `16GiB / 31%`.
- Uptime and power are rendered in Chinese, e.g. `28天16小时10分钟` and `交流电源 · 电量 100% · 已充满`.
- Credentials stayed outside Git; no runtime plugin directory was manually edited.
