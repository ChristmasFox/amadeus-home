# 2026-09-06 LangBot NAS Plugin Activation

- External key file: `/Users/blacksidev/.config/agent-monorepo/secrets/langbot-api-key` (value not logged or committed).
- Command: `scripts/deploy-langbot.sh --apply --plugin macos-nas-control --api-key-file ...`.
- Result: plugin `local/macos-nas-control` version `0.1.3`, task `15`, `INSTALL_READY`.
- Active plugin runtime contains the installed formatter.
- End-to-end smoke inside `langbot_plugin_runtime` called real macOS `nas.status` and rendered the V2 mobile card with macOS version, CPU, memory, disks, network, cloudflared, and process information.
- No runtime plugin directory was manually edited.
