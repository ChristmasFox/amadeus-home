# Amadeus 1.4.8

Operation Skuld final migration hardening and runtime-state continuity.

- Make repository workspace content seed-only and preserve existing runtime memory and identity state.
- Add encrypted cold-state snapshot, authenticated continuity evidence, complete SQLite checks, and approval-gated restore with rollback copies.
- Verify provider credential paths, content, permissions, and runtime ownership without exposing per-file identifiers in the manifest.
- Add isolated local validation mode with channel ingress, public ingress, and owner delivery disabled; fail closed on multiple active production runtimes.
