# VPS proxy security hardening — 2026-10-09

Status: Complete with operator-accepted task-output exposure residual; Phases 0–4 and owner-DM query accepted. Active credentials remain unchanged.

## Source and checks

- Source commit: `8434e2b4018c` on `main` (`feat(vps): harden proxy fallback and auth telemetry`).
- Focused Python tests: 41 passed. Amadeus tests: 136 passed. Amadeus typecheck, Python compilation, shell syntax, `pnpm check:secrets`, and `git diff --check` passed.
- Xray 26.9.30 candidate passed `xray run -test`. Hysteria 2.12.3 had no configured masquerade, so its config was left unchanged and retains the default 404 response.

## Protected rollback points

- VPS root-only pre-apply checkpoint: `/root/amadeus-checkpoints/2026-10-09-vps-proxy-security-hardening-preapply` on `example-vps`. It contains the prior Xray/Hysteria configs, accounting source/env, SQLite backup, sanitized snapshot, probe and manifest.
- CasaOS root-only pre-apply checkpoint: `/root/amadeus-checkpoints/2026-10-09-openclaw-proxy-security-hardening-preapply` on machine `example-node`. Directory mode is `0700`; files are `0600`. It contains the prior Compose file, old image reference/id, sanitized container facts, and the two prior VPS report definitions.
- Prior OpenClaw image remains available as `local/openclaw-amadeus:git-509639ee3a5e-20261008112407`.

## Applied VPS state

- Xray Reality fallback now targets loopback `127.0.0.1:<SERVICE_PORT>`. The gate routes only exact `www.apple.com` SNI to the audited camouflage target and sends other gate traffic to the block outbound. Xray system inbound counters are collected under `reality-fallback-gate`.
- A TLS 1.3 handshake with the allowlisted SNI returned the `www.apple.com` certificate with verification OK. A non-allowed SNI probe received no certificate. The gate counter source is healthy and observable.
- Accounting auth remains loopback-only and runs in `enforce` mode with a 900-second window, 120-failure threshold, 300-second cooldown and 4,096-source tracking cap. The source tracker keeps normalized addresses only in bounded process memory; persisted security data contains aggregates only.
- The manual report snapshot recorded Reality fallback `71,599 B`. The latest sanitized accounting snapshot at `2026-10-09T02:58:03Z` records `76,424 B` and the configured `reality_fallback_traffic` signal against 1,024 B. It records all six managed accounts enabled, Legacy disabled, HY2 limiter mode `enforce`, 900/900 seconds of limiter-window coverage, zero failures/limited requests in the current limiter window, and four persisted 12-hour auth failures. Xray, HY2 traffic and fallback sources are all `ok`. The aggregate includes controlled validation traffic and other gate traffic; it is not evidence of compromise.
- example-device and example-user-01 passed real VLESS HTTPS smokes with positive per-account counter deltas. Both passed HY2 HTTPS smokes after enforcement with TLS verification enabled. Invalid-auth probes returned a generic 403 response. Xray, Hysteria, accounting and Caddy are active; TCP/UDP <SERVICE_PORT> remain active; auth, stats and fallback listeners are loopback-only.
- No active credential, client-visible node parameter, public hostname/SNI, proxy port, SSH policy, firewall rule or DNS record was changed. No Legacy identity was restored.

## OpenClaw and owner reports

- Live image: `local/openclaw-amadeus:git-8434e2b4018c-20261009024420`, ARM64, image ID `sha256:8a2b836f50384b04f11ffb33d87ff30454fee5fce1b32a3fcb3417222a8a3180`. The container is healthy; Amadeus is loaded, with the VPS overview and fixed owner notifier registered.
- Live Compose config differs only in the OpenClaw image field. Normalized config comparison passed after ignoring that field; mounts, port bindings, restart policy and network names match the pre-apply container.
- The existing morning/evening VPS report jobs retain their IDs, enabled state, 09:30/21:30 Asia/Shanghai schedules, and no-deliver setting. Their messages now include sanitized Reality/HY2 metrics and signal wording.
- One manual morning report completed through the canonical owner outbox. The `.sent.json` record uses a `vps-report:manual:<ISO timestamp>:morning` key, contains the security counts and 2026-10-09 controlled-test context, has no IPv4 address or credential value, and does not use the scheduled key.
- The owner completed the query in the existing direct owner conversation. The visible response was timestamped `2026-10-09 11:08:01 +08:00`: all listed sources were `ok`; HY2 mode was `enforce`, limiter coverage was 900/900 seconds, failures were 15 in the limiter window and 19 over 43,200 seconds, rate-limited requests were zero, approximate unique sources were one, and the last failure was at 11:01:09. Reality fallback was 76,424 B (57,138 down / 19,286 up), with the configured 1,024 B `reality_fallback_traffic` signal. Reconciliation remained `uncalibrated`. These sanitized observations do not establish compromise.

## Rollback

- VPS: restore the exact prior Xray/accounting files and env from the VPS checkpoint, restart affected services, and immediately smoke example-device plus example-user-01 VLESS and HY2. The Hysteria config did not change.
- OpenClaw: restore the saved Compose file, then run `docker compose up -d --no-build openclaw`. Restore only the two report messages from `vps-report-jobs.before.json` using `cron edit`; preserve IDs and schedules. Do not delete accounting state or rotate credentials.

Temporary local client material, the secret-bearing Xray candidate and the staged VPS source directory were removed after acceptance. The protected checkpoints and previous immutable image remain available.

## Tool-output credential exposure — 2026-10-09

A read-only acceptance diagnostic printed six active subscription bearer-token
directory names in task tool output. The values are deliberately not repeated
in this checkpoint. No credential value was copied into Git, a checkpoint, an
owner report or a runtime file, and the listing made no runtime/account change.
The original task tool output may retain the diagnostic result. No token was
rotated; this Goal explicitly forbids rotation. The operator explicitly chose
to keep the credentials unchanged and accept this documented residual. This
breaches the Phase 0 no-credential-output rule; the control is not represented
as passing. The owner-DM acceptance is complete, and the Goal is closed with
this exception.
