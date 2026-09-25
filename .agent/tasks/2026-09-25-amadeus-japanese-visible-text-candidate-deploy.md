# Japanese visible voice-text acceptance — complete

- Status: complete. Owner confirmed the Japanese visible-text fix is correct (“没问题了”).
- Formal release: `VERSION=1.5.4`, release commit `ac179bb`, pushed and deployed via `./scripts/deploy-openclaw.sh --apply --build-auto`.
- Live image: `local/openclaw-amadeus:git-ac179bbd28b9-20260925161434`; rollback checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925161434`.
- Contract: voice turn = Japanese PTT + matching visible Japanese kanji/kana line + Chinese summary; typed-only remains Chinese-only; consecutive voice turns remain FIFO.
- Release evidence: `.agent/checkpoints/2026-09-26-amadeus-1.5.4-formal-release.md`.
- Separate non-blocking post-deploy external-storage gate warnings are tracked in `.agent/tasks/2026-09-26-post-deploy-storage-gate.md`.
