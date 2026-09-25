# Close Japanese visible voice-text acceptance and release Amadeus 1.5.4

- Status: owner acceptance received; formal release preparation/deployment is in progress.
- Current candidate: `local/openclaw-amadeus:git-b655dba924f9-20260925155559` (source `b655dba`).
- Owner acceptance received; `VERSION` has been advanced to `1.5.4` using the required patch bump. Formal release follows the release checklist.
- Deployment used `./scripts/deploy-openclaw.sh --apply --candidate --build-openclaw`; rollback checkpoint is `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260925155559`. Post-apply health passed, restart count is 0, WhatsApp is linked/connected, and all three lifecycle/FIFO/Japanese-text markers occur once.
- Owner acceptance: “没问题了”. Preserve the contract: voice turn = Japanese PTT + matching visible Japanese kanji/kana line + Chinese summary; typed-only remains Chinese-only; consecutive voice turns remain FIFO.
- Record owner result in a dated checkpoint. Do not copy message content or secrets into Git.
