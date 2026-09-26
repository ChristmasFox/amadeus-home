# Amadeus 1.6.1 — PUBG evidence guard release

Date: 2026-09-26, Asia/Shanghai.

## Acceptance progression

- Original incident: 23:05 group person query returned an unverified zero-match claim without tools. The later explicit refresh used `team=true` instead of a person subject.
- First candidate requested `before_agent_finalize` revision; OpenClaw 2026.9.4 failed with `Session transcript projection is rebuilding`. It was not released.
- Second candidate logged `wrong_scope` for real person requests at 23:42 and 23:44, but its legacy `message_sending` hook did not replace the WhatsApp payload. It was not released. This is why the owner's initial “好了” was not treated as sufficient factual acceptance.
- Final candidate `local/openclaw-amadeus:git-b2e275df5a59-20260926154636` uses `reply_payload_sending` with the canonical session key. A controlled, visible group delivery at 23:48 asked the ordinary person query; the model again omitted the data tool. Logs showed `missing_data`, then `replaced unverified outbound match claim`, then WhatsApp `Sending message`. Thus the fail-closed transport boundary was exercised, not just a unit mock. It does **not** prove automatic person-specific tool choice or that a fresh match report is always produced.

## Release

- Version source: `scripts/amadeus-version.sh bump patch` advanced 1.6.0 → 1.6.1; `RELEASE_NOTES.md` describes only 1.6.1.
- Full `pnpm test`, PUBG plugin typecheck/build and targeted tests, architecture, `pnpm check:secrets`, `git diff --check`, dry-run plan passed.
- `scripts/deploy-openclaw.sh --apply --build-auto` built only the OpenClaw image and switched the one CasaOS runtime. Immutable source image: `local/openclaw-amadeus:git-55fbdc3b1076-20260926155013`. Product Radar image unchanged.
- Protected checkpoint: `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260926155013`; post-deploy evidence: `/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20260926155013`. Previous 1.6.0 immutable release/checkpoint `/DATA/AppData/openclaw/backups/amadeus-openclaw-20260926130153` retained. Roll back via protected Compose/config/image checkpoint if health or delivery regresses; preserve the now-correct ingress bridge trust when restoring.
- Release preflight passed; OpenClaw/Product Radar healthy; config validation valid with zero issues; WhatsApp listening; owner notification sent and outbox smoke passed; public `/` and `/healthz` HTTP 200 with TLS verification passed. Optional media adapter remains absent; `LOG_POLICY=warning` is known and not a release blocker.

## Limit

The guard detects specific PUBG match-fact claims and prevents unsupported delivery or personal→team scope drift. It does not serve as a deterministic natural-language planner and cannot guarantee first-turn tool selection; users may see a safe cannot-confirm reply and need to retry. It does not replace official PUBG API facts, identity resolution or the native Skill.
