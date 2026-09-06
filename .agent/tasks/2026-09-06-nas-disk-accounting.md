# NAS Disk Accounting and Chinese Status — Activation

Status: COMPLETE (2026-09-06)

The source and external macOS forced command now calculate APFS occupied space from `total - available` instead of the root snapshot's misleading `df Used` column. The formatter also translates uptime and power status to Chinese. Manifest version: `0.1.4`.

After committing, run:

```sh
./scripts/deploy-langbot.sh \
  --apply \
  --plugin macos-nas-control \
  --api-key-file /Users/blacksidev/.config/agent-monorepo/secrets/langbot-api-key
```

Then execute the end-to-end formatter smoke inside `langbot_plugin_runtime` and record the result in a dated checkpoint.


Activation completed: LangBot Plugin API task `19` installed `macos-nas-control` v0.1.4. Active plugin-runtime end-to-end smoke passed with real macOS NAS data, APFS-correct disk usage, Chinese uptime, and Chinese power output.
