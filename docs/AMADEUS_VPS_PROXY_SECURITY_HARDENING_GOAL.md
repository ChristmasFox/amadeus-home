# Amadeus VPS Proxy Security Hardening Goal

Date: 2026-10-09 (Asia/Shanghai)

Status: COMPLETE WITH OPERATOR-ACCEPTED RESIDUAL — Phases 0–4 are applied and accepted, including the owner-DM query. The operator chose to preserve active credentials and accept the documented task-output exposure residual; no credential was rotated.

## 0. Objective

Harden the currently deployed Amadeus Gateway proxy stack against unauthorized traffic consumption without changing any active subscriber credential or client-visible node parameter.

This Goal covers two different threat models:

1. **VLESS + REALITY fallback abuse:** unauthenticated/invalid REALITY connections must not be able to turn the VPS into a useful generic relay through the REALITY target.
2. **Hysteria 2 abuse:** keep real HY2 clients compatible while preventing the masquerade path from generating uncontrolled third-party egress, collecting bounded failed-auth telemetry, and exposing enough owner-only security facts to detect leaked valid credentials.

The implementation must be based on the current runtime/accounting architecture already deployed on the VPS.

## 1. Current verified baseline

The authoritative current account set is:

- example-user-01
- example-user-02
- example-user-03
- example-user-04
- example-user-05
- example-device

Legacy is retired.

The existing retirement checkpoint proves:

- old Legacy subscription paths return 404;
- old Legacy HY2 authentication returns 403;
- old Legacy VLESS UUID no longer exists in active Xray and a real tunnel attempt fails;
- example-device HY2 and VLESS both passed real external HTTPS smoke tests.

Current proxy/runtime topology:

- Xray-core 26.9.30, native systemd.
- TCP 2053: VLESS + Reality + Vision.
- Reality public client SNI/serverName: www.apple.com.
- Reality target currently resolves to www.apple.com:443.
- UDP 2053: official Hysteria 2 v2.12.3.
- HY2 uses HTTP auth through loopback 127.0.0.1:18796/auth.
- HY2 Traffic Stats API is loopback-only on 127.0.0.1:19999 with a separate runtime secret.
- Xray StatsService is loopback-only on 127.0.0.1:10085.
- The accounting service maps HY2 auth identities and VLESS emails to the six active accounts and persists sanitized usage snapshots.
- Subscription generation explicitly keeps HY2 TLS verification enabled: Clash/Mihomo uses skip-cert-verify=false and Shadowrocket uses insecure=0.
- KiwiVM remains the authoritative whole-plan traffic/quota source.
- Reconciliation between provider bytes and proxy-accounted bytes is still uncalibrated and must not be used as a hard anomaly assertion.

## 2. Hard compatibility and safety boundaries

This Goal is a server-side hardening change.

It MUST NOT rotate or change:

- any Labmem subscription token;
- the example-device subscription token;
- any HY2 secret;
- any VLESS UUID;
- Reality private/public key pair;
- Reality shortId;
- client serverName/SNI;
- public VPS hostname/address;
- TCP 2053 or UDP 2053;
- Caddy subscription URLs or subscription file names.

It MUST NOT:

- recreate or re-enable Legacy;
- restore the pre-retirement Legacy checkpoint as running state;
- require users to refresh/re-import subscriptions;
- expose Xray StatsService, HY2 Traffic Stats, or accounting auth endpoint to the public Internet;
- introduce a generic shell/admin API;
- add a public security dashboard;
- automatically rotate, kick, disable, or block a valid Labmem/M204 account without a later explicit mutation authorization;
- change firewall/SSH policy as part of this Goal.

Existing clients should continue to work with their already imported node configuration. A brief Xray/Hysteria service restart during apply is acceptable; credential or subscription migration is not.

## 3. VLESS / REALITY anti-steal design

### 3.1 Replace direct external REALITY fallback target with a loopback gate

Follow the official XTLS "VLESS-TCP-REALITY (without being stolen)" topology, adapted to the pinned production config instead of copying the example wholesale.

Target topology:

```text
Internet
  |
  v
TCP 2053 VLESS + REALITY
  |
  |-- valid REALITY/VLESS client --> normal VLESS proxy path
  |
  '-- invalid REALITY / fallback
          |
          v
     127.0.0.1:<dedicated-port>
     dokodemo-door inbound
          |
          +-- exact allowed TLS SNI --> direct to intended camouflage target
          |
          '-- every other destination/SNI --> blackhole
```

Use one fixed loopback-only fallback gate port that does not conflict with any current service. The implementation may use 24431 if the Phase 0 live audit proves it unused.

The public VLESS inbound keeps all current client-visible Reality settings. Only its fallback destination is changed from the external target to the local gate.

### 3.2 Exact SNI allowlist

The loopback gate must sniff TLS with routeOnly=true and route only the configured Reality serverNames to direct.

For the current single-name deployment, the only allowed value is the exact configured serverName corresponding to www.apple.com.

Prefer an exact routing expression (for example full:www.apple.com when supported by the pinned Xray build) instead of a suffix/wildcard rule.

All other traffic entering the fallback gate must hit the existing blackhole outbound.

If Phase 0 discovers multiple production serverNames, generate the exact allowlist from the live serverNames array rather than hard-coding only one entry.

### 3.3 Preserve Vision and all managed VLESS users

Do not replace the live listener with the minimal upstream example.

Preserve:

- xtls-rprx-vision flow;
- all six active managed VLESS identities;
- current Reality key material;
- current non-empty shortId policy;
- user traffic/online statistics;
- loopback StatsService;
- existing direct and block outbounds unless a deterministic routing change is required for the gate.

Never add an empty shortId merely because an upstream example contains one.

### 3.4 Add bounded fallback traffic counters

Enable Xray system inbound statistics if they are not already enabled:

- statsInboundUplink
- statsInboundDownlink

Give the loopback fallback inbound a stable non-secret tag such as reality-fallback-gate.

Extend the existing accounting collector to read:

- inbound>>>reality-fallback-gate>>>traffic>>>uplink
- inbound>>>reality-fallback-gate>>>traffic>>>downlink

Persist deltas with the same restart/reset-safe semantics used by current user counters.

These counters are security telemetry only. They must not be mixed into per-account VLESS usage.

No destination history, SNI history, or individual scanner IP history is required.

## 4. Hysteria 2 hardening

HY2 does not use REALITY's fallback model and must not be forced through the Xray gate.

### 4.1 Audit and eliminate external proxy masquerade egress

Phase 0 must inspect the real /etc/hysteria/config.yaml without printing secrets.

Classify current masquerade as:

- absent;
- local file;
- local string;
- external proxy.

If masquerade is absent, keep the 404 behavior unless the owner later asks for camouflage content.

If masquerade already uses local file/string content, preserve it after validating that it performs no external fetch.

If masquerade.type=proxy points to an Internet URL, replace it with a bounded local-only response. Prefer a small static string or local file so unauthenticated HTTP/3 probing cannot make the VPS fetch arbitrary/upstream content while still allowing an innocuous HTTP/3 response.

Do not add listenHTTP/listenHTTPS or extra public ports in this Goal.

This masquerade change must not modify HY2 auth, SNI, certificate, port, or client subscription parameters.

### 4.2 Keep HTTP auth loopback-only and validate official auth metadata

The auth backend remains 127.0.0.1:18796 only.

Extend the existing POST /auth parser to validate the Hysteria HTTP-auth fields that are already sent by the server:

- addr
- auth
- tx

The credential comparison remains constant-time using the current protected account store.

Never log or persist auth values.

Normalize addr into a client IP only for bounded abuse telemetry/rate control. Do not use the loopback HTTP peer address as the client identity because Hysteria itself is the HTTP caller.

Malformed addr/tx values must fail safely without exposing secrets.

### 4.3 Failed-auth telemetry and conservative throttling

Add an in-memory, bounded failed-auth tracker keyed by normalized client IP.

Requirements:

- no raw auth secret is ever stored;
- no unbounded map growth;
- entries expire automatically;
- only failures contribute to the abuse score;
- successful auth is never counted as failure;
- rate-limit thresholds are explicit configuration, not hidden constants;
- defaults must be conservative enough not to punish a normal client retry storm or multiple clients behind one NAT;
- limiter state is intentionally ephemeral across service restart.

Recommended initial configuration surface:

- HY2_AUTH_FAIL_WINDOW_SECONDS
- HY2_AUTH_FAIL_THRESHOLD
- HY2_AUTH_FAIL_COOLDOWN_SECONDS
- HY2_AUTH_FAIL_MAX_TRACKED_SOURCES

The implementation must include a telemetry-only mode and an enforcement mode.

Deployment sequence:

1. deploy telemetry first;
2. run real HY2 compatibility smoke and synthetic invalid-auth tests;
3. inspect observed failure behavior;
4. enable conservative enforcement only when test evidence shows normal clients are unaffected.

A throttled source receives the same generic authentication rejection behavior as an invalid credential. Do not create a response that reveals whether a submitted secret exists.

### 4.4 Security metrics without browsing history

Add sanitized aggregate HY2 auth security facts to the public accounting snapshot:

- authFailuresWindow
- authRateLimitedWindow
- approximate/known unique failure sources in the bounded window
- limiter mode
- last failure timestamp when known

Do not expose:

- submitted auth;
- subscription token;
- HY2 secret;
- VLESS UUID;
- raw source IP;
- destination hostname/history.

Existing /traffic and /online account usage remains unchanged.

## 5. Valid-credential leak detection

Protocol hardening cannot distinguish an attacker from the owner after a valid credential has been stolen.

Use the existing account model to surface suspicious behavior without automatic revocation.

Security observations may include:

- one account's recent traffic increasing sharply relative to its own recent window;
- HY2 online client-instance count being materially above the account's configured/observed baseline;
- VLESS online source-IP count increasing materially;
- an account producing an unusually dominant share of the monitored proxy window;
- nonzero Reality fallback-gate traffic after hardening;
- sustained HY2 failed-auth activity.

Do not use a single online-count sample as proof of compromise.

Do not call provider/proxy byte differences anomalous while reconciliation.status=uncalibrated.

Initial behavior is notify/query only. Automatic kick, account disable, token rotation, HY2-secret rotation, and UUID rotation remain out of scope.

## 6. Kurisu / OpenClaw security visibility

Extend the existing owner-only VPS capability instead of adding a new Agent or direct WhatsApp sender.

Preferred approach:

- extend amadeus_vps_subscription_overview with a sanitized security section; and/or
- add one bounded owner-only read tool named amadeus_vps_proxy_security.

The result may contain:

- Reality fallback gate byte counters and freshness;
- HY2 failed-auth/rate-limit aggregate counters;
- current six active accounts;
- account online/traffic facts already available from accounting;
- source health;
- explicit uncalibrated reconciliation state.

The tool must remain unavailable to groups and non-owner DMs.

Update plugins/amadeus/skills/vps/SKILL.md so queries such as:

- VPS 有没有被盗用
- HY2 有异常登录吗
- Reality 有异常流量吗
- 哪个订阅流量异常
- example-device 当前在线情况

select deterministic native tools instead of relying on model guesses.

Kurisu must use cautious wording:

- "observed suspicious signal" is allowed when a defined metric crosses a configured threshold;
- "credential leaked" or "VPS compromised" requires direct evidence and must not be inferred from traffic volume alone;
- provider/proxy gap remains unknown until calibration is complete.

## 7. Morning/evening owner reports

Reuse the existing 09:30 / 21:30 Asia/Shanghai VPS report jobs and amadeus_notify_owner.

Do not create duplicate cron jobs or a second WhatsApp delivery path.

Normal reports should stay concise and add a security line only when facts are available, for example:

```text
安全：正常
Reality fallback 12h: 0 B
HY2 失败认证 12h: 3，限流 0
```

When a defined security signal is present, surface it clearly with the affected account/protocol if known.

Do not print raw client IPs, credentials, subscription URLs, or destination history.

## 8. Runtime state and configuration ownership

Keep security state next to the existing accounting service.

Expected changes:

- infra/vps/subscription/accounting_service.py
  - parse addr/tx;
  - bounded auth-failure tracker;
  - optional conservative enforcement;
  - collect fallback inbound stats.
- infra/vps/subscription/accounting_store.py
  - persist only safe aggregate/counter deltas needed across reports;
  - no raw IP/auth persistence.
- infra/vps/subscription/accounting.env.example
  - documented non-secret limiter configuration.
- infra/vps/subscription/accounting_cli.py
  - render the hardened Xray candidate while preserving active managed identities;
  - render Hysteria local masquerade candidate only when needed.
- infra/vps/proxy/config.example.jsonc
  - reflect anti-steal loopback gate and exact routing structure.
- infra/vps/README.md and subscription/README.md
  - document security architecture and recovery boundary.
- plugins/amadeus/src/vps.ts and VPS capability registration/Skill
  - expose sanitized security facts.
- focused Python and TypeScript tests.

Do not put live secrets, filled subscription files, live Xray/Hysteria configs, source IPs, or protected checkpoints in Git.

## 9. Phase 0 — read-only live audit

Before any runtime mutation:

1. Re-read current main and confirm example-device + example-user-01-example-user-05 are the only enabled managed identities.
2. Confirm Legacy is still disabled and its old credentials remain rejected.
3. Inspect /etc/xray/config.json through a secret-safe summary:
   - VLESS listener/tag/port;
   - Reality target/dest;
   - serverNames count/value(s);
   - shortId presence/length without printing private key or client UUIDs;
   - routing tags;
   - StatsService and policy state.
4. Inspect /etc/hysteria/config.yaml through a secret-safe summary:
   - UDP listen;
   - auth type and backend URL;
   - certificate/SNI-related non-secret facts;
   - trafficStats listen state;
   - masquerade type and whether it has external egress.
5. Confirm loopback candidate gate port is unused.
6. Record current Xray/Hysteria/Caddy/accounting service health.
7. Record current six-account sanitized accounting snapshot.
8. Take a protected pre-change checkpoint before apply.

No credential value may appear in stdout, repository files, checkpoint prose, or ChatGPT/Codex task output.

## 10. Phase 1 — source implementation and tests

Implement code and tests without changing the live VPS.

Required focused tests:

### Xray rendering

- preserves all six active managed VLESS users;
- never recreates Legacy;
- preserves Vision, Reality keys/serverNames/shortId, ports, API, existing outbounds;
- creates exactly one loopback fallback gate;
- public Reality target points only to that gate;
- exact allowlist routes configured serverNames to direct;
- catch-all gate rule routes to blackhole;
- no empty shortId is introduced;
- system inbound stats are enabled without disabling user stats;
- rerender is idempotent.

### Hysteria rendering

- existing HTTP auth and trafficStats remain loopback-only;
- external proxy masquerade is converted to local-only content;
- absent/local masquerade stays safe and deterministic;
- no HY2 credential/SNI/certificate/public port change;
- rerender is idempotent.

### HY2 auth service

- valid Labmem and M204 secrets still authenticate;
- retired Legacy stays rejected;
- malformed addr/tx is handled safely;
- auth values never enter logs/snapshot;
- bounded tracker expiry/max-size behavior;
- telemetry mode does not block valid clients;
- enforcement mode throttles repeated failures according to configured threshold;
- successful authentication does not increment failure counters;
- same rejection shape is used for unknown/throttled credentials.

### Security snapshot/tool

- contains no token, secret, UUID, source IP, or destination;
- preserves stale/error/unknown states;
- fallback counter reset/restart cannot create negative or giant synthetic deltas;
- group/non-owner access remains rejected.

## 11. Phase 2 — protected candidate validation

Before switching services:

- create protected backups of active Xray/Hysteria config and accounting service source/state;
- render candidates without secret output;
- run xray run -test against the candidate;
- validate the pinned Hysteria candidate using the strongest supported non-invasive method available for v2.12.3; if there is no standalone config-check command, use a temporary non-public/non-conflicting candidate process smoke instead of guessing a command;
- run Python/TypeScript focused tests;
- run pnpm check:secrets and git diff --check.

Do not apply if the candidate changes any client-visible credential/parameter.

## 12. Phase 3 — staged runtime apply

Apply one protocol at a time.

### 12.1 REALITY first

1. Replace Xray with validated anti-steal candidate.
2. Restart/reload Xray.
3. Verify service active and TCP 2053 listening.
4. Real smoke through example-device VLESS.
5. Real smoke through at least one Labmem VLESS.
6. Verify account counters continue incrementing correctly.
7. Perform an intentionally invalid/non-allowed fallback probe and verify it cannot use the VPS as a generic relay.
8. Verify the intended camouflage SNI path behaves according to the anti-steal design.
9. Verify fallback-gate inbound counters are observable.
10. Any managed-client regression triggers immediate Xray rollback before HY2 changes.

### 12.2 HY2 second

1. Apply local-only masquerade change only if Phase 0 found unsafe external proxy masquerade.
2. Deploy auth telemetry changes in telemetry-only mode.
3. Restart accounting service as needed, then Hysteria only if its config changed.
4. Verify UDP 2053 and Hysteria service health.
5. Real smoke through example-device HY2.
6. Real smoke through at least one Labmem HY2.
7. Verify TLS remains validated by generated subscription settings.
8. Send bounded invalid-auth probes from a controlled client and verify aggregate failure telemetry increments without credential leakage.
9. Enable conservative limiter enforcement only after normal-client retry behavior is confirmed.
10. Re-run real HY2 smokes after enforcement.
11. Any managed-client regression triggers rollback of HY2/accounting changes.

## 13. Phase 4 — OpenClaw/Kurisu integration

After protocol compatibility passes:

- expose sanitized security facts through the existing owner-only VPS capability;
- update VPS Skill tool-selection rules;
- update existing morning/evening reports in place;
- do one owner-DM manual security query;
- do one manual report using a manual event key;
- do not consume or replace a scheduled report idempotency key.

No direct WhatsApp API call is added.

## 14. Security alert thresholds

Thresholds must be named configuration and documented.

Do not hard-code an assertion that every extra online client means compromise.

Initial alerts should be based on combinations, for example:

- HY2 auth failure count crosses a configured window threshold;
- rate limiter actually activates;
- fallback-gate traffic exceeds a configured byte threshold;
- account traffic spike plus online-count spike occurs together;
- one account becomes a configured high share of the recent complete proxy window.

Provider/account reconciliation must remain excluded from hard alerts until a later calibration explicitly changes reconciliation.status away from uncalibrated.

## 15. Rollback

### Xray rollback

Restore the exact protected pre-change Xray config, validate it, restart/reload Xray, and immediately verify example-device plus one Labmem VLESS client.

Rollback must not restore Legacy credentials.

### Hysteria rollback

Restore the exact protected pre-change Hysteria config and accounting-service source/config, restart affected services, and verify example-device plus one Labmem HY2 client.

If the pre-change Hysteria config contained an external proxy masquerade and rollback is required for availability, record that security regression explicitly and open a follow-up instead of silently calling the system hardened.

### OpenClaw rollback

Restore only the previous Amadeus plugin/Skill/report configuration. Do not delete the accounting database or rotate subscription/proxy credentials.

## 16. Acceptance / Definition of Done

This Goal is complete only when all of the following are true:

- main contains the hardened source and documentation;
- Legacy remains retired;
- exactly example-user-01-example-user-05 + example-device remain active;
- no active token, HY2 secret, VLESS UUID, Reality key, shortId, hostname, SNI, or public proxy port was rotated/changed unintentionally;
- all existing six subscription identities remain usable without re-import;
- M204 + at least one Labmem real VLESS smoke passes after anti-steal apply;
- M204 + at least one Labmem real HY2 smoke passes after HY2 hardening apply;
- invalid REALITY fallback traffic cannot turn the VPS into a generic relay;
- intended camouflage fallback is limited to the exact allowlisted serverName(s);
- fallback-gate bytes are observable as security telemetry;
- HY2 masquerade performs no uncontrolled external proxy fetch;
- HY2 invalid-auth telemetry works without storing secrets/raw IPs;
- conservative limiter behavior is tested and does not block normal clients;
- HY2 /traffic and /online remain loopback-only and protected;
- Xray StatsService remains loopback-only;
- Kurisu owner query can report proxy security facts;
- existing 09:30/21:30 owner reports remain unique and enabled;
- no new public management surface is introduced;
- no credential appears in Git/logs/report output;
- protected rollback evidence exists.

Closure exception: the owner explicitly accepted preserving the credentials and
the documented task-output exposure residual. The Phase 0 no-credential-output
rule was violated once; this is recorded as an accepted residual, not described
as a passing control. No credential or runtime state was changed in response.

## 17. Explicit non-goals

Not part of this Goal:

- credential rotation for any active account;
- deleting historical Legacy accounting rows;
- per-device identities below the subscription-account level;
- automatic account revoke/kick/rotation;
- automatic tc/TrafficCop enforcement;
- nftables/ufw redesign;
- SSH hardening changes;
- changing VPS provider/plan;
- HY2 port hopping;
- HY2 salamander/gecko obfuscation;
- mTLS or certificate pin rollout that would require client changes;
- Grafana/Prometheus/ntopng;
- destination/SNI browsing-history retention;
- security changes to frps, Caddy-hosted HomeLab apps, 9Router, OpenClaw public UI, or Image Lab unless a direct dependency is discovered during audit.

## 18. Upstream references that must be rechecked during implementation

- XTLS anti-steal server example:
  https://github.com/XTLS/Xray-examples/tree/main/VLESS-TCP-REALITY%20(without%20being%20stolen)
- Xray routing/policy/statistics:
  https://xtls.github.io/en/config/routing.html
  https://xtls.github.io/en/config/policy.html
  https://xtls.github.io/en/config/stats.html
- Hysteria 2 Full Server Config (HTTP auth, Traffic Stats, Masquerade):
  https://v2.hysteria.network/docs/advanced/Full-Server-Config/
- Hysteria 2 Protocol:
  https://v2.hysteria.network/docs/developers/Protocol/
- Hysteria 2 Traffic Stats API:
  https://v2.hysteria.network/docs/advanced/Traffic-Stats-API/

Implementation must follow the pinned production versions and live audited state when documentation/examples differ from the current runtime.

## 19. Execution evidence — 2026-10-09

### Source and validation

- Hardened source is committed on `main` at `8434e2b4018c` (`feat(vps): harden proxy fallback and auth telemetry`). Qwen/Image Lab worktree changes were not included.
- Focused Python suite: 41 passed. Amadeus suite: 136 passed. Amadeus typecheck, Python compilation, shell syntax, `pnpm check:secrets`, and `git diff --check` passed.
- The Xray candidate passed the pinned 26.9.30 `run -test`; it preserves the six active managed identities and client-facing Reality parameters. The live Hysteria config had no masquerade, so it remains unchanged and uses the v2.12.3 default 404 response.

### VPS apply and acceptance

- Protected pre-apply VPS checkpoint: `/root/amadeus-checkpoints/2026-10-09-vps-proxy-security-hardening-preapply` (root-only; Xray/Hysteria/accounting source, env, DB backup, snapshot, probe and manifest). A separate OpenClaw pre-apply checkpoint is recorded in `.agent/checkpoints/2026-10-09-vps-proxy-security-hardening.md` and stored root-only on CasaOS.
- Xray Reality now falls back to `127.0.0.1:24431`; that loopback gate routes only exact `www.apple.com` SNI to the audited camouflage target and blocks every other gate route. Xray system inbound counters feed the `reality-fallback-gate` security snapshot.
- A verified TLS 1.3 handshake through the allowed SNI returned the `www.apple.com` certificate. A non-allowed SNI probe received no certificate and ended with an unexpected EOF. The loopback gate counter is observable. The manual report snapshot was 71,599 B; the latest read-only snapshot at `2026-10-09T02:58:03Z` is 76,424 B against the configured 1,024 B observation threshold. The counter includes controlled acceptance traffic and other aggregate gate traffic; it does not prove compromise.
- Accounting auth remains loopback-only and now runs `enforce` with a 900-second window, threshold 120, 300-second cooldown and 4,096-source cap. The latest limiter window reports zero failures and zero throttled requests with 900/900 seconds of coverage; the 12-hour persisted aggregate reports four failures. Sources for Xray, HY2 traffic and fallback are `ok`. No raw source address or auth value is persisted.
- example-device and example-user-01 passed VLESS HTTPS smokes with positive per-account counter deltas. Both passed HY2 HTTPS smokes after enforcement with TLS verification enabled. Controlled invalid-auth probes returned the same generic 403 shape. Xray, Hysteria, accounting and Caddy are active; TCP/UDP 2053 and loopback-only auth/stats/gate listeners were verified. All six active accounts remain enabled; Legacy remains disabled. No active credential, client parameter, hostname, SNI or public port changed.

### OpenClaw and owner report

- Candidate image `local/openclaw-amadeus:git-8434e2b4018c-20261009024420` (ARM64, image ID `sha256:8a2b836f50384b04f11ffb33d87ff30454fee5fce1b32a3fcb3417222a8a3180`) is live and healthy. Only the OpenClaw Compose image reference changed; normalized Compose configuration matched after ignoring that one field, and container mounts, port bindings, restart policy and network names were unchanged. The Amadeus plugin loaded with the existing VPS overview and fixed owner notifier registered.
- The existing morning and evening jobs remain unique, enabled and no-deliver at 09:30 and 21:30 Asia/Shanghai, with their IDs unchanged. Their messages now include sanitized Reality/HY2 security facts, explicit stale/unknown handling, and cautious signal wording.
- A manual morning report was sent through the canonical owner outbox and verified as `.sent.json` with a `vps-report:manual:<ISO timestamp>:morning` key. It included Reality fallback 71,599 B, four 12-hour auth failures, one limiter-window failure, zero throttles, `enforce`, full 900-second coverage, and the configured fallback signal. It explicitly says 2026-10-09 includes controlled acceptance traffic. The saved report contained no IPv4 address or credential values and did not consume the scheduled idempotency key.
- The owner completed the required query in the existing direct owner conversation. The visible result was timestamped `2026-10-09 11:08:01 +08:00`; all listed sources were `ok`. It reported HY2 limiter `enforce`, 900/900 seconds of coverage, 15 failures in the limiter window and 19 over 43,200 seconds, zero rate-limited requests, about one unique failure source, and the last failure at 11:01:09. Reality fallback remained 76,424 B (57,138 down / 19,286 up) with the configured `reality_fallback_traffic` signal at 1,024 B; reconciliation remained `uncalibrated`. The query returned sanitized security facts and did not establish compromise.

### Rollback and cleanup

- VPS rollback: restore the exact Xray/accounting files and env from `/root/amadeus-checkpoints/2026-10-09-vps-proxy-security-hardening-preapply`, restart affected services, then verify M204 and example-user-01 VLESS/HY2 smokes. Hysteria config did not change.
- OpenClaw rollback: restore the root-only pre-apply Compose backup at `/root/amadeus-checkpoints/2026-10-09-openclaw-proxy-security-hardening-preapply/docker-compose.before.yml` and run `docker compose up -d --no-build openclaw`; restore the two prior report messages from `vps-report-jobs.before.json` with `cron edit`. Do not roll back or delete the accounting database or rotate credentials.
- Temporary local client configs, the Xray candidate containing live identities, and the staged VPS source directory were removed after acceptance. Protected rollback checkpoints and the previous immutable OpenClaw image remain available.

### Tool-output credential exposure — 2026-10-09

- During a read-only acceptance diagnostic, a directory listing printed the six active subscription bearer-token directory names in task tool output. Their values are intentionally omitted here and will not be repeated.
- No credential value was copied into Git, a checkpoint, an owner report, or a runtime file, and no runtime or account state was changed by that listing. The task output itself may retain the original diagnostic result.
- The operator explicitly chose to keep active credentials unchanged and accept this documented residual. No token was rotated; rotation remains an explicit non-goal and hard boundary of this Goal.
- This violated the Phase 0 rule that credentials must not appear in stdout or task output. The owner accepted preserving the current credentials with that residual recorded. The Goal is complete with this exception; the no-output control is not represented as having passed.
