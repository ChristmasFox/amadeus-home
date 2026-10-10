# Mac Image Lab deployment — 2026-10-08

## Protected pre-deploy checkpoint

The pre-deploy Mac Image Lab files are preserved outside Git at:

```text
~/Library/Application Support/Amadeus/backups/qwen-image-public-lab-predeploy-20261008T071550Z
```

The backup directory is `0700`; all six recorded file hashes in `SHA256SUMS`
verify. The snapshot includes the previous bridge, UI, both LaunchAgent plists,
static page, and engine config. The bridge token and public password verifier
are not part of the snapshot.

## Apply and evidence

- The one-engine bridge and Quality/Fast configs were installed from the Git
  source. Installed bridge/UI/config hashes match the corresponding source
  files. Bridge health reports `ready` with the expected model and two
  profiles.
- The UI LaunchAgent serves port `<SERVICE_PORT>`. LAN root and model discovery return
  200 without login. The exact public Host serves the login page; incorrect
  password and unauthenticated model/task/generation requests return 401.
- The operator entered the password into the native hidden-input dialog. The
  runtime-only verifier exists at
  `~/Library/Application Support/Amadeus/secrets/qwen-image-lab-auth.json`,
  mode `0600`; its contents were not read, logged, or committed.
- Both LaunchAgents initially returned macOS `bootstrap` error 5 through their
  manager scripts. A direct `launchctl bootstrap gui/501 <plist>` retry
  succeeded for each; both jobs are running and their health checks pass.
- Quality 1024x1024, fixed-seed local image smoke is in progress. Fast smoke
  and authenticated public image acceptance are pending.

## Rollback order

If rolling back the public service, first remove the frpc mapping using
`.agent/checkpoints/2026-10-08-qwen-image-public-lab-frpc.md`. Then restore the
Mac files from the protected pre-deploy snapshot and reload only the two
Image Lab LaunchAgents. Keep the runtime verifier outside Git; do not restore
the old unauthenticated UI while the public route remains active.
