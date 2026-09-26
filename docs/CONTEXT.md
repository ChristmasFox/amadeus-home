# Canonical context — 2026-09-26

Read this together with `docs/CURRENT_TASK.md` and the named active Goal. This is a startup map, not a replacement for inspecting Git and the live target before a runtime change.

- Source of truth: Git `main` for released source; current work uses a short-lived branch. Production runtime definition is `infra/docker/casaos/`, deployment scripts, and protected external configuration. Never commit credentials, voice references, generated audio, message contents, or business data.
- Active Goal: `docs/AMADEUS_POST_VOICE_ENGINEERING_PERFORMANCE_GOAL.md` in ordered phases. Voice 1.5.9 is the baseline; performance conclusions require controlled measurements and owner quality acceptance.
- Current production: OpenClaw 2026.9.4 is the sole Agent runtime; native PUBG/Amadeus plugins, deterministic domain/presentation and owner outbox remain. No LangBot/n8n/old Runtime, keyword router, second planner, or sender fallback.
- `VERSION=1.5.9` at baseline. Running CasaOS is OrbStack `nyannyan` on M204, not an assumed `ubuntu` alias. Resolve target using local `infra/host-profile.env` via `scripts/host-profile.sh`; never put secrets into Git. Read `docs/PROJECT_STATE.md` for concise current runtime details.
- Development: use `pnpm workflow:plan`; FAST/RUNTIME uses focused tests/typecheck and `git diff --check`, no automatic Docker build or deploy. Full `pnpm test` is CI/release/explicit use. Secrets scan before commit; high-risk runtime changes require checkpoint and rollback.
- Production apply is explicit. `scripts/deploy-openclaw.sh` is dry-run by default; release uses immutable Git-tagged images and CasaOS Compose `up -d --no-build`, with a protected external checkpoint and real acceptance.
- Ownership and safety details: `AGENTS.md` and `docs/ARCHITECTURE.md`. Task/open gates: `docs/CURRENT_TASK.md`. Historical diaries: `docs/history/`, `.agent/checkpoints/` and `.agent/tasks/`; do not read them all on startup.
