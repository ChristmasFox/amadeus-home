# Production-safe source privacy externalization — implementation plan

Status: **planning only**, not approved for production deployment, Git history ref
replacement, or tag rewrite.

## Input and evidence

A private offline history-rewrite rehearsal successfully reported:
- 14 local bundle refs; 9 rewritten; historical private 9Router account policy removed
  from all rewritten reachable histories.
- Executable code blobs at previous main and previous release tag preserved.
- No GitHub push.

A separate read-only current-main audit identified genuine production coupling.
Redacting these literal values inside history is not safe until deployment
identities and endpoints are read from operator-owned private runtime files.

## Proposed workstream A: active runtime definitions

1. **Qwen Image service** — the public debug UI currently embeds a specific
   hostname and HTTPS origin in `apps/qwen-image-service/debug_ui.py`.
   Switch to a validated explicit private host/origin config. Do not allow the
   community default to unexpectedly accept public requests; retain current
   production identity through a local protected config file or environment.
   `infra/macos/manage-qwen-image-debug-ui.sh` must consume the same source.
   Tests should exercise localhost, configured public origin, and unauthorized
   origin rejection.
2. **Engine filesystem paths** —
   `infra/macos/qwen-image-engine.json` and
   `infra/macos/qwen-image-fast-engine.json` contain machine-user-dependent
   absolute paths (logs, conversion code and patch assets). Move those paths to
   protected operator profile / templated resolution without changing quality,
   fast profile output or model invocation flags. Never invent a replacement
   path if the real asset is missing; fail clearly.
3. **VPS identity contracts** —
   `plugins/amadeus/src/vps.ts`,
   `plugins/amadeus/src/capabilities/vps/register.ts`,
   `infra/vps/amadeus-vps-readonly-probe.sh`, and
   `scripts/deploy-openclaw.sh` refer to specific real proxy account labels.
   Use a private account mapping/config consumed consistently by owner-only
   skill, tool schema, probe, scheduled report and accounting. Preserve deployed
   stable identifiers through private config; ensure public community install
   has neutral fixtures and is not silently granted owner access.
4. **Older workstation/migration scripts** —
   `scripts/migration-readiness.sh`,
   `scripts/openclaw-migration-safe-start.sh`,
   `scripts/openclaw-unique-runtime-gate.sh`,
   `scripts/plan-*.sh`,
   `scripts/restore-*-snapshot.sh`,
   `scripts/restore-skuld-secrets.sh`, `scripts/skuld-state-machine.sh`
   and their migration tests refer to operator-specific host and user names.
   First classify as ACTIVE/LEGACY/ARCHIVAL. ACTIVE code must use explicit
   externally provided host profile with safe defaults and fail-closed checks.
   LEGACY runbooks / irreversible restore helpers should be privately archived
   before removing them from public release; do not rewrite or execute them as
   part of VPS cleanup.

## Workstream B: privacy scan gates

- Make two separate CI signals:
  **public current snapshot** (all tracked docs/source) and **reachable
  history** (all branches and tags). Report sanitized path and rule only.
- Classify false positives: IP documentation ranges, localhost, synthetic test
  tokens, dynamic code variables and backup SHA-256 digests are not automatically
  real secrets. A source test referencing an operator name is still a disclosure,
  even if not an exploitable credential.
- Complete coverage must include `.agent/checkpoints`, old planning docs,
  READMEs, runtime/example configs, tests, inactive branch heads, release tags,
  and pull request refs where accessible.
- Never upload raw Gitleaks JSON, personal replacement rules, a Git bundle,
  active subscriptions or operational backups as an artifact.

## Workstream C: compatibility acceptance

Must be executed with staging/fixture data *before* altering main:
- `pnpm check:secrets`, architecture/typecheck and related Amadeus/VPS tests.
- Qwen image fast/quality profile config load, local debug UI auth/origin,
  model converter patch availability and failure cases.
- OpenClaw owner-only VPS account queries and notifications use private map;
  public community profile does not inherit personal accounts.
- Proxy HY2/VLESS subscription and FRP source code/images behave identically;
  no live DNS, firewalls, Caddy, SSH, 9Router policy, OAuth files, or services
  modified in this source-only phase.
- A fresh clone at future public HEAD works without private files in community
  profile. Production profile intentionally fails closed if operator-owned
  configuration files are absent.

## Workstream D: history cutover ONLY AFTER code migration

1. Keep verified private Git bundle (the user's earlier step) outside the
   repo and preserve a full ref manifest from every branch and tag.
2. On a disposable mirror, rewrite documented exact sensitive values/path
   only. Avoid blanket replace of generic IPv4, UUID, hash, domain endings.
3. Verify **all** intended public branch/tag ref trees, current HEAD public
   scanner, full-history scanner and build/CI in the rewritten clone.
4. Coordinate existing draft PR, open refs, tags, collaborative pushes and
   GitHub PR/cache retention; support may be required for old sensitive objects.
5. Obtain a **separate explicit operator authorization** for destructive
   remote ref replacement. No automatic force push in any repository CI/script.
6. Reclone/remap local worktrees after remote cutover. Never merge old history
   back in.

### Important limitation

The successful prior rehearsal retained runnable source verbatim by design;
therefore it is **not yet a publishable fully sanitized history**. The
operator-specific runtime coupling above must be resolved first, even if the
existing public documentation redaction PR has green CI.
