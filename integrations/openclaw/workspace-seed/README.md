# OpenClaw workspace seeds

The `*.seed.md` files in this directory are Git-managed bootstrap content only.
The runtime workspace at `/DATA/AppData/openclaw/workspace` is authoritative.
Deployment preparation may create a missing top-level seed file, but must not
rewrite or change permissions on an existing path or any runtime-created state.

Review differences with `scripts/openclaw-workspace-sync.sh --plan`. A deliberate
single-file sync requires `--apply --approve-file NAME`; there is no bulk apply.
