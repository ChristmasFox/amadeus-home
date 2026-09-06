# LangBot NAS Plugin Activation — External Credential Required

Status: PENDING EXTERNAL CREDENTIAL

The expanded `macos-nas-control` plugin is source-complete and packaged by the dry-run workflow. Production installation requires an external LangBot API key supplied via `LANGBOT_API_KEY` or `--api-key-file`; no key is present in the current shell and none may be written to Git. Do not modify the running plugin directory manually.

Activation command after restoring the key outside the repository:

```sh
./scripts/deploy-langbot.sh --apply --plugin macos-nas-control --api-key-file <external-file>
```
