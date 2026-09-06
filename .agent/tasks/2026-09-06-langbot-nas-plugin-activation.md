# LangBot NAS Plugin Activation — External Credential Required

Status: COMPLETE (2026-09-06)

The expanded `macos-nas-control` plugin is source-complete and packaged by the dry-run workflow. Production installation requires an external LangBot API key supplied via `LANGBOT_API_KEY` or `--api-key-file`; no key is present in the current shell and none may be written to Git. Do not modify the running plugin directory manually.

Activation command after restoring the key outside the repository:

```sh
./scripts/deploy-langbot.sh --apply --plugin macos-nas-control --api-key-file <external-file>
```


Activation evidence: `scripts/deploy-langbot.sh --apply --plugin macos-nas-control --api-key-file <external-file>` completed with task `15`, version `0.1.3`, and `INSTALL_READY`. A real NAS status call and formatter render were verified inside the active plugin runtime.
