# PR #3 P0 source acceptance — 2026-10-11

This checkpoint records source-only remediation on
`security/vps-public-info-redaction-20261010`. It is not a production
checkpoint and contains no runtime data or secret values.

## Review issues covered

- VPS accounting uses a private `root:amadeus-accounting` map and the forced
  read-only probe uses a separate ID-only `root:amadeus-vps-readonly` map.
  Missing or invalid probe maps emit a typed status and no accounting snapshot.
- `scripts/deploy-vps-accounting.sh` provides read-only preflight, explicit map
  inputs, protected backup, atomic unit/map install, a dedicated
  `root:amadeus-account-map-traverse` mode-`0710` parent with isolated map
  groups, pre/post-restart account continuity assertions, and rollback.
- OpenClaw validates a host mode-0600 map, proves uid `node` can read the
  bind mount through a unique private `/tmp` child owned by uid/gid
  `1000:1000` mode `0600` without changing `/tmp`, provisions the guest secret
  before Compose config, and records the guest path in the env file.
- A rewritten Git SHA marks a live image stale. The guarded
  `--lineage-bridge --apply --build` path rebuilds both images and validates
  the live OpenClaw image's embedded version while retaining fresh-image,
  semver, checkpoint and health gates.

## Evidence

- `bash scripts/test-vps-account-map-permissions.sh` — passed disposable
  Linux permission smoke for real file modes, non-root reads, directory
  traversal, isolated private/probe maps, unrelated-secret denial, and
  unchanged `/tmp` mode
- `bash scripts/test-vps-account-map-migration.sh`
- `bash scripts/test-openclaw-lineage-compatibility.sh` — passed synthetic
  post-rewrite dual-image compatibility test
- `bash scripts/test-openclaw-candidate-deploy.sh`
- `pnpm --filter @agent/amadeus-plugin typecheck`
- `pnpm --filter @agent/amadeus-plugin test` — 141 passed
- `python3 -m unittest discover -s infra/vps/subscription -p 'test_*.py'` — 47 passed
- `pnpm check:secrets`
- `pnpm check:architecture`
- `git diff --check`

No deploy, restart, remote preflight, merge, force push, tag update, branch
rewrite, or history rewrite was executed.
