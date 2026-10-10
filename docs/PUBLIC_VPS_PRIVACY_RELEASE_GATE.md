# Public VPS information sanitization — release gate

The repository contains operator-specific VPS deployment history. This PR
**generalizes tracked documentation and examples only**; it does not change
live servers, DNS, FRP/Xray/Hysteria2 secrets, databases, production runtime
scripts, or the operator's Docker state.

## Scope

- Public reference files must use documentation-only hostnames such as
  `sub.example.com` and sample labels rather than the operator's domains,
  VM names, or proxy account labels.
- Historical VPS/FRP/security checkpoints are sanitized to avoid publishing
  actual hostnames and endpoint mappings, but their **content is still present
  in previous Git commits**.
- Source code and port-binding defaults remain unchanged; using this branch
  does not alter the live subscription endpoint or make it unreachable.
- CI uses `scripts/audit-public-infrastructure.mjs --strict-vps` for tracked
  VPS docs/templates/selected historical notes. This is a **limited** guard,
  not a claim of full repository or historical secrets safety.

## Operator-side verification (on your trusted computer)

1. Back up any operational private notes you need from the old main tree
   before checking out or merging major sanitizations. Never paste original
   values into GitHub issues or this PR.
2. Inspect live DNS yourself, especially any DNS-only subscription hostname;
   replacing text in Git does **not** conceal an IP that DNS still exposes.
3. Run read-only full-history scanning locally, with redacted output and without
   uploading reports containing private values:

   ```sh
   gitleaks git --redact --log-opts='--all' .
   gitleaks dir --redact .
   node scripts/audit-public-infrastructure.mjs --audit-all
   ```

4. Examine any historical findings privately. Rotate **only** credentials
   actually confirmed compromised, in a separate, explicitly approved
   operational change. Do not rewrite Git history, delete tags, or force-push
   without separate coordination, backups, and fork review.
5. If your production docs were previously copied directly from Git,
   examine diffs before using generalized examples as live configuration.

## Explicit limitations

- Removed strings remain accessible in Git commit history and existing clones.
  Old public release/tag snapshots may also retain the information.
- Public DNS, CT logs, third-party caches, and previously published
  subscription endpoints are outside Git.
- Only private full-history audit can answer whether active OAuth, HY2,
  Xray, FRP, SSH or subscription credentials were ever committed.
- This PR must be reviewed separately from production deployments and should
  not be treated as proof that the entire monorepo is sanitized.
