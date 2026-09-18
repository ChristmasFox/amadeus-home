# Amadeus version management checkpoint

- Version source: `VERSION`, initial baseline `1.0.0`.
- Release-note source: `RELEASE_NOTES.md`; the first line must match the version.
- `scripts/amadeus-version.sh` supports `show`, `check`, `notes`, and `bump patch|minor|major`.
- `scripts/deploy-openclaw.sh` validates and reads the release notes before dry-run/apply, reports
  the version in its plan, and queues the owner smoke notification as
  `Amadeus <version> · 世界线收束` with the release notes followed by `El Psy Kongroo.`.
- The notification validator rejects an empty body and the runtime name so the user-facing message
  stays focused on the update content.
- This checkpoint is source-only; no CasaOS deployment was performed.
