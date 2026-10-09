# VPS proxy security hardening — 2026-10-09

Status: Phases 0–3 applied and accepted; OpenClaw/report changes applied; a real direct owner-DM query remains pending because the Mac is locked.

## Source and checks

- Source commit: `8434e2b4018c` on `main` (`feat(vps): harden proxy fallback and auth telemetry`).
- Focused Python tests: 41 passed. Amadeus tests: 136 passed. Amadeus typecheck, Python compilation, shell syntax, `pnpm check:secrets`, and `git diff --check` passed.
- Xray 26.9.30 candidate passed `xray run -test`. Hysteria 2.12.3 had no configured masquerade, so its config was left unchanged and retains the default 404 response.

## Protected rollback points

- VPS root-only pre-apply checkpoint: `/root/amadeus-checkpoints/2026-10-09-vps-proxy-security-hardening-preapply` on `amadeus-gateway`. It contains the prior Xray/Hysteria configs, accounting source/env, SQLite backup, sanitized snapshot, probe and manifest.
- CasaOS root-only pre-apply checkpoint: `/root/amadeus-checkpoints/2026-10-09-openclaw-proxy-security-hardening-preapply` on machine `nyannyan`. Directory mode is `0700`; files are `0600`. It contains the prior Compose file, old image reference/id, sanitized container facts, and the two prior VPS report definitions.
- Prior OpenClaw image remains available as `local/openclaw-amadeus:git-509639ee3a5e-20261008112407`.

## Applied VPS state

- Xray Reality fallback now targets loopback `127.0.0.1:24431`. The gate routes only exact `www.apple.com` SNI to the audited camouflage target and sends other gate traffic to the block outbound. Xray system inbound counters are collected under `reality-fallback-gate`.
- A TLS 1.3 handshake with the allowlisted SNI returned the `www.apple.com` certificate with verification OK. A non-allowed SNI probe received no certificate. The gate counter source is healthy and observable.
- Accounting auth remains loopback-only and runs in `enforce` mode with a 900-second window, 120-failure threshold, 300-second cooldown and 4,096-source tracking cap. The source tracker keeps normalized addresses only in bounded process memory; persisted security data contains aggregates only.
- Latest sanitized accounting snapshot: all six managed accounts enabled; Legacy disabled; Reality fallback `71,599 B`; HY2 limiter mode `enforce`; 900/900 seconds of limiter-window coverage; one post-restart failed-auth sample; zero rate-limited attempts in that window; persisted 12-hour auth failures `4`. Xray, HY2 traffic and fallback sources are all `ok`. The current configured signal is `reality_fallback_traffic` at 71,599 B against 1,024 B. This includes controlled validation traffic and is not evidence of compromise.
- M204-Net-Core and Labmem001 passed real VLESS HTTPS smokes with positive per-account counter deltas. Both passed HY2 HTTPS smokes after enforcement with TLS verification enabled. Invalid-auth probes returned a generic 403 response. Xray, Hysteria, accounting and Caddy are active; TCP/UDP 2053 remain active; auth, stats and fallback listeners are loopback-only.
- No active credential, client-visible node parameter, public hostname/SNI, proxy port, SSH policy, firewall rule or DNS record was changed. No Legacy identity was restored.

## OpenClaw and owner reports

- Live image: `local/openclaw-amadeus:git-8434e2b4018c-20261009024420`, ARM64, image ID `sha256:8a2b836f50384b04f11ffb33d87ff30454fee5fce1b32a3fcb3417222a8a3180`. The container is healthy; Amadeus is loaded, with the VPS overview and fixed owner notifier registered.
- Live Compose config differs only in the OpenClaw image field. Normalized config comparison passed after ignoring that field; mounts, port bindings, restart policy and network names match the pre-apply container.
- The existing morning/evening VPS report jobs retain their IDs, enabled state, 09:30/21:30 Asia/Shanghai schedules, and no-deliver setting. Their messages now include sanitized Reality/HY2 metrics and signal wording.
- One manual morning report completed through the canonical owner outbox. The `.sent.json` record uses a `vps-report:manual:<ISO timestamp>:morning` key, contains the security counts and 2026-10-09 controlled-test context, has no IPv4 address or credential value, and does not use the scheduled key.
- A real owner-DM query is not yet accepted. The Gateway CLI owner-targeted agent turn did not expose the native VPS tool; local mode could not start while the Gateway owned its state directory. The Mac was locked and CUA could not open WhatsApp. No query message was delivered. Resume after the operator unlocks the Mac; ask the owner conversation to query `amadeus_vps_subscription_overview` and verify the visible response before completing the Goal.

## Rollback

- VPS: restore the exact prior Xray/accounting files and env from the VPS checkpoint, restart affected services, and immediately smoke M204-Net-Core plus Labmem001 VLESS and HY2. The Hysteria config did not change.
- OpenClaw: restore the saved Compose file, then run `docker compose up -d --no-build openclaw`. Restore only the two report messages from `vps-report-jobs.before.json` using `cron edit`; preserve IDs and schedules. Do not delete accounting state or rotate credentials.

Temporary local client material, the secret-bearing Xray candidate and the staged VPS source directory were removed after acceptance. The protected checkpoints and previous immutable image remain available.
