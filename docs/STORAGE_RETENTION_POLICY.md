# Storage and log retention policy

This policy is intentionally conservative. Runtime data is classified before
any cleanup; unknown paths are report-only.

| Class | Examples | Action | Owner |
| --- | --- | --- | --- |
| PROTECTED | Immich media, PostgreSQL/SQLite, secrets, owner outbox, current/previous/rollback images, protected checkpoints | Never generic GC | Owning service / Operation Skuld |
| REBUILDABLE | Docker BuildKit cache, FashionSigLIP model cache, package caches | Remove only after the configured age | Storage maintenance |
| ROTATABLE | Docker stdout/stderr with an explicit compose policy; registered application logs | Recreate or rotate through the owning service | Compose/service owner |
| DISPOSABLE | Dangling images, completed temporary build artifacts, expired unprotected release artifacts | Remove only through an explicit allow-list | Storage maintenance |
| UNKNOWN | Unregistered AppData, arbitrary application logs, unnamed volumes | Report-only | Human operator |

Managed compose services use the host-profile policy:

```yaml
logging:
  driver: local
  options:
    max-size: "20m"
    max-file: "5"
```

The CasaOS Docker daemon is also configured for new containers with the same
bounded default. The declaration is tracked in
`infra/docker/daemon.json.example`; applying it must preserve unrelated daemon
keys, keep a timestamped external backup, validate JSON, and verify all active
containers after the OrbStack machine restart. Existing unknown containers are
not recreated automatically and remain report-only until their owner is known.

`scripts/storage-maintenance.sh` never runs volume pruning, a blind
`docker system prune -a`, generic AppData deletion, or deletion under the
Immich media root. Existing containers with an unknown owner are inventoried
and reported rather than truncated through Docker's private log files.

The macOS scheduler observes both the internal disk and the verified external
volume. Maintenance notifications are structured owner-outbox events; normal
healthy checks do not send messages.
