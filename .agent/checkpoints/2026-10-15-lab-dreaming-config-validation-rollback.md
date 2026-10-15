# Lab Dreaming config enablement stopped and rolled back — 2026-10-15

## Scope and result

Arthur authorized a Lab-only change on OrbStack `nyannyan` / container
`openclaw`: explicitly enable Memory Core Dreaming for owner WhatsApp direct
messages only, restart Lab, run a controlled Dreaming acceptance, verify the
incremental index, and release after live evidence. The attempt stopped at
config validation and was rolled back. No Dreaming run, index refresh, build,
or release action followed.

## Protected checkpoint

Pre-change checkpoint:
`/Volumes/Avalon/backups/operation-skuld/lab-dreaming-config-20261015T151500Z-pre`

The protected directory is mode `0700`; checkpoint files are `0600`. The
config snapshot SHA-256 is
`7106f78e2cde95b7b3ed6cf4ef457eaf4fd7f9d0ea75a125da54768190f09315`.
The six-file `workspace/memory` copy totals 45,683 bytes and matches the live
tree by sorted relative path, size, and SHA-256. Both online SQLite snapshots
pass `PRAGMA integrity_check=ok`; their source WAL/SHM sidecars are kept as
`.source-copy` support files and match the checkpoint manifest. No SQLite,
Workspace, MEMORY.md, or session history was changed during this attempt.

An independent verifier initially assumed copied WAL sidecars kept SQLite's
usual adjacent names. The checkpoint stores those original sidecars with a
`.source-copy` suffix and has separate online-backup files; after correcting
that verifier assumption, config, memory, both SQLite snapshots, and sidecars
all matched the manifest.

## Failed validation and rollback

The config was atomically replaced with the requested values while preserving
the WhatsApp SecretRef and excluding Telegram, groups, and channels. The
temporary file was created by the root process with mode `0600`; replacing
the original therefore changed ownership to `root:root`. The container's
`node` user (uid 1000) could not read it. `openclaw config validate --json`
failed with `EACCES`; the gateway was not restarted with the attempted config.

Before rollback, the protected rollback script was corrected to restore
ownership `1000:1000` before mode `0600`. Rollback command:

```sh
bash /Volumes/Avalon/backups/operation-skuld/lab-dreaming-config-20261015T151500Z-pre/rollback-config.sh
```

The script restored only `openclaw.json`, restored its expected owner and
mode, and restarted only Lab `openclaw`. Post-rollback evidence: config hash
returned to the checkpoint SHA above; owner/mode are `1000:1000` / `0600`;
`openclaw config validate --json` returned `valid: true`; Docker reports
`running healthy` on the previously verified Lab image. No SQLite or Workspace
restore was needed. The Dreaming schedule was not edited.

One direct CLI health probe emitted recent recipient metadata in its terminal
output. That output was not copied into Git or this checkpoint; future health
checks for this task must use sanitized metadata probes.

## Source and release status

The owner-only WhatsApp template/policy and preparer tests pass locally. The
release snapshot hash query now uses direct `sha256sum` with a 30-second bound;
its focused timeout/command test and the release-tooling test pass. The
`pnpm check:secrets` and `git diff --check` checks passed. These source changes
remain uncommitted; no new image was built or pushed.

The existing local `lab/v1.10.5` tag remains at commit
`0f109389378dc322dbc780997f3133b5f69eb53e`; no tag was moved or recreated.
Formal release was not attempted after this failed validation. Any future
continuation must first fix the config replacement ownership issue, rerun
validation before restart, and re-establish the P1 live gates.
