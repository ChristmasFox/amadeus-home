# OpenClaw/Kurisu continuity state inventory — 1.4.8

This document defines the source-of-truth boundary for the Operation Skuld cutover. The runtime data root is `/DATA/AppData/openclaw`; Git workspace files are seeds only.

| State class | Runtime source | Cold snapshot | Secret bundle | Notes |
| --- | --- | --- | --- | --- |
| OpenClaw config, sessions, transcripts, SQLite state | `config/**` | Included, except `config/credentials/**` | Credentials only | Includes OpenClaw-created state and its symlink entries; symlinks are archived as links, never dereferenced. |
| Runtime workspace and media | `workspace/**` | Included in full | No | Runtime copy is authoritative; includes `MEMORY.md`, `memory/**`, and runtime-created files. |
| Amadeus SQLite/JSON runtime state | `data/**` | Included in full | No | Requires `identity.sqlite` and `pubg.sqlite`; SQLite databases are discovered by the SQLite file header, not filename suffix alone. WAL/SHM companions are included. |
| Owner outbox and delivery state | `notifications/**` | Included in full | No | Private content; artifact remains encrypted. |
| OpenClaw provider credentials | `config/credentials/**` | Excluded | Included | WhatsApp pairing/session state is required and restored before OpenClaw. Snapshot continuity HMAC binds exact opaque paths, content hashes, modes, and runtime owner without exposing per-file hashes. Restore requires the image runtime owner `1000:1000` (`node`). |
| Host env and mounted secret files | `openclaw.env`, `secrets/**` | Excluded | Included | Never print values or put them in Git. |
| Runtime image and deployment definition | immutable image ref, Git commit, CasaOS Compose source | Recorded by reference | No | Rebuilt/reloaded from Git; not copied as mutable workspace data. |

The inventory implementation must report regular-file count/bytes, symlink count, deterministic tree hashes, discovered session/transcript counts, and integrity results for every actual SQLite database. It must not emit file contents, transcript text, memory plaintext, provider identifiers, or raw credential paths.

The source observation on 2026-09-23 was read-only while the source OpenClaw container was running, so its counts and successful SQLite read checks are discovery evidence only—not a cold snapshot, freeze proof, or cutover acceptance. Final source/destination hashes and database checks are captured again after the exact source-freeze approval and after destination restore.

The source credential ownership probe observed every entry as `1000:1000`; directory modes were one `0700` root plus three `0755` nested directories, and file modes were two `0600` plus 854 `0644`. Cold snapshot tooling fails closed if source ownership differs from the OpenClaw runtime identity. Destination secret restore normalizes the credential tree to `1000:1000`, then the state restore verifier checks every opaque path, file content, mode, and owner before OpenClaw can start.
