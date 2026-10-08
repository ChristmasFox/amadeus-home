# Amadeus Gateway Subscription Accounting & Kurisu Traffic Report Goal

Date: 2026-10-08 (Asia/Shanghai)

Status: OPERATOR_CLOSED_WITH_ACCEPTED_RESIDUALS; OWNER_DIRECT_QUERY_REPORTED_NORMAL; SUBSCRIPTION_LINKS_24_OF_24_VERIFIED; LEGACY_TOKEN_PRESERVED; RECONCILIATION_UNCALIBRATED; 2026-10-08_EVENING_CRON_CONFIGURED_NOT_YET_RUN; PRIOR_TOOL_OUTPUT_EXPOSURE_RECORDED

## Apply record — 2026-10-08

Phase 2 is live on `amadeus-gateway`. A protected pre-change checkpoint is kept
outside Git at
`/Volumes/Avalon/backups/operation-skuld/vps-subscription-accounting/phase2-prechange-20261008T042931Z`;
it includes the secret-bearing rollback archive and the pre-change Xray binary.
The legacy token, HY2 credential, and VLESS UUID were imported unchanged. Five
independent Labmem identities and their four-format subscriptions were created
on the VPS and have not been distributed.

The accounting service runs under its dedicated system identity. HY2 HTTP auth,
HY2 traffic/online stats, and Xray StatsService are loopback-only. Xray was
upgraded to official release 26.9.30 after verifying its published SHA-256.
The six identities' four formats returned HTTP 200 on both subscription ports
(48/48); the legacy QX body remained byte-identical. Legacy HY2 and VLESS
connectivity checks passed. The fixed read-only probe returns a sanitized
snapshot and the accounting database remains inaccessible to the probe user.

Provider T0 is `2026-10-08T04:58:07Z`. At snapshot time
`2026-10-08T05:10:46Z`, provider and all four traffic/online sources were
healthy, all six account baselines were covered, and proxy-accounted totals
were complete. Controlled Labmem001 transfers confirmed that each protocol's
own counters increased while other Labmem accounts remained unchanged. HY2
`tx` is recorded as client upload and `rx` as client download. A guarded,
idempotent migration set the verified legacy VLESS raw counters (814 upload /
4,320 download bytes) as the T0 baseline because no VLESS delta occurred after
T0; this preserves zero monitored legacy VLESS usage without counting prior
traffic.

Reconciliation remains `uncalibrated`. Provider growth and proxy-accounted
traffic differ materially during the observed interval, so the controlled
payload checks establish protocol attribution and direction only; they do not
establish a reliable provider ratio or anomaly threshold. No gap or anomaly is
reported. Phase 4 deployment and most Phase 5 runtime acceptance are recorded
in section 17. The operator reported that a direct owner query returned
normally, requested preservation of the existing legacy token, and directed
closure. All 24 public links across the six accounts and four formats were
rechecked as HTTP 200 with bodies matching the local subscription files. The
21:30 Cron configuration is live and enabled; its scheduled run was still in
the future at closure. See sections 18–19 for the acceptance record and
explicitly retained limitations.

## 0. Operator decision / hard migration boundary

This Goal introduces five named subscription accounts, per-account HY2/VLESS traffic accounting, VPS-wide reconciliation, and Kurisu WhatsApp reporting.

The operator explicitly requires the current production subscription token and current proxy credentials to remain valid during this Goal.

Hard requirements:

- Do not revoke, delete, rotate, invalidate, rename, or silently replace the current subscription token.
- Do not revoke or invalidate the current Hysteria 2 credential.
- Do not revoke or invalidate the current VLESS UUID.
- Do not delete the current token directory or remove its Caddy route.
- Existing clients must continue working without refresh throughout the migration.
- The current production credentials may be imported into runtime-only protected state as the legacy identity, but their values must never be committed, logged, printed in reports, or returned by OpenClaw tools.
- Legacy credential retirement is explicitly OUT OF SCOPE. It requires a later owner instruction after all users have moved to the new Labmem accounts.

If any implementation choice would make the current HY2/VLESS clients stop authenticating, that choice is invalid for this Goal.

## 1. Current verified baseline

The current amadeus-gateway architecture already provides most of the VPS-wide foundation:

- Caddy serves subscription HTTPS on the existing domain and routes subscription requests to the local responder.
- amadeus-gateway-subscription.service listens on 127.0.0.1:8787 and serves qx.conf, server.snippet, clash.yaml, and shadowrocket.txt from /var/lib/caddy/subscription/<token>/.
- The subscription responder already calls KiwiVM getServiceInfo and returns Subscription-Userinfo plus X-Amadeus-Gateway-Usage for the whole VPS plan.
- KiwiVM traffic state is persisted and stale data is explicitly represented instead of fabricated as zero.
- Xray owns the VLESS + Reality listener on TCP 2053.
- Official Hysteria 2 owns the HY2 listener on UDP 2053.
- OpenClaw already exposes read-only VPS tools including amadeus_vps_usage.
- The VPS Skill already defines the ten-cell VPS traffic progress bar and the existing owner-only morning/evening WhatsApp report path through amadeus_notify_owner.
- The fixed owner WhatsApp sender/outbox remains the sole proactive delivery path.

This Goal extends those boundaries. It does not create a second Agent, second sender, Web admin panel, Grafana stack, or generic remote shell.

## 2. Target user model

Create exactly five managed subscription accounts:

- Labmem001
- Labmem002
- Labmem003
- Labmem004
- Labmem005

Each account represents one subscription identity, not one physical device.

A person may use the same Labmem account on multiple phones/computers and may switch between HY2 and VLESS. Accounting must aggregate all of that usage under the same Labmem ID.

Each Labmem account receives three independently generated runtime secrets:

- one subscription bearer token;
- one HY2 authentication secret;
- one VLESS UUID.

The four subscription formats for one account share the same subscription token but contain protocol-specific credentials.

The existing production token/password/UUID become one protected legacy identity. The legacy identity remains active and is reported separately from Labmem001-Labmem005.

## 3. Required user-facing result

Kurisu must support natural-language owner queries such as:

- VPS 流量怎么样
- VPS 还剩多少流量
- 这月用了多少
- 五个订阅分别用了多少
- 谁用的最多
- Labmem003 用了多少
- Labmem003 的 HY2 和 VLESS 分别用了多少
- 现在谁在线
- 旧订阅还有流量吗
- 最近一小时流量异常吗

Do not add keyword routing. OpenClaw selects bounded native tools from meaning.

The primary VPS report must preserve the existing whole-plan progress bar sourced from KiwiVM, including usage that happened before this accounting system was installed.

Below the VPS-wide plan summary, show the monitored per-subscription breakdown from the accounting start instant forward.

Example presentation shape:

VPS 套餐
███████░░░ 73.4%

已用 / 总量 / 剩余 / 重置时间

本次账户监控以来:
Labmem001  ...
Labmem002  ...
Labmem003  ...
Labmem004  ...
Labmem005  ...
Legacy      ...

HY2 / VLESS protocol split is shown only when useful or explicitly requested.

Never imply that pre-cutover historical traffic can be reconstructed per Labmem account.

## 4. Architecture

### 4.1 Runtime-only subscription account store

Add a lightweight SQLite store on the VPS, separate from the active Caddy responder state directory:

/var/lib/amadeus-accounting/subscription-accounts.sqlite

Use a dedicated service identity and strict filesystem permissions. The database is runtime state and must never enter Git.

Place accounting-specific environment and secret files under `/etc/amadeus-accounting` with
`root:amadeus-accounting` permissions. Keep the existing `/etc/amadeus-gateway` permissions
unchanged: the current Caddy subscription responder runs as `caddy` and reads its KiwiVM
credential file there. Give the collector a separately protected copy of that KiwiVM credential.

The operator explicitly requested the generated tokens and protocol credentials to be persisted. The database therefore stores the Labmem account records and their generated subscription token, HY2 secret, and VLESS UUID. This is allowed only inside the protected runtime database.

Minimum account fields:

- account_id
- enabled
- subscription_token
- hy2_secret
- vless_uuid
- is_legacy
- created_at
- disabled_at nullable

Minimum accounting state:

- source/protocol
- account_id
- raw counter value
- last sampled counter
- cumulative upload bytes
- cumulative download bytes
- online/client count where available
- sampled_at
- counter generation/restart marker where needed

Minimum reconciliation metadata:

- accounting_started_at
- provider_counter_at_start
- last_provider_counter
- last_provider_sample_at

No read-only API/tool may return subscription_token, hy2_secret, VLESS UUID, KiwiVM credentials, or Traffic Stats API secret.

### 4.2 Preserve legacy HY2 compatibility with HTTP auth

Do not switch the existing HY2 listener directly from password auth to userpass auth because old clients currently send only the existing password and would become incompatible with username:password syntax.

Instead, introduce a loopback-only deterministic HY2 auth endpoint owned by the accounting service and configure Hysteria 2 auth.type=http.

The endpoint receives the auth string from Hysteria and performs exact credential lookup:

- current legacy HY2 secret -> accept and return client id legacy-hy2;
- Labmem001 secret -> accept and return client id Labmem001;
- ...
- Labmem005 secret -> accept and return client id Labmem005;
- anything else -> reject.

This keeps the current client auth payload valid while allowing new independent identities.

The auth service must:

- listen only on loopback;
- have no public Caddy route;
- never log submitted auth values;
- use bounded request size/time;
- fail closed for unknown credentials;
- expose a separate health check that contains no secret data.

Hysteria Traffic Stats must also be enabled on loopback with a strong runtime-only secret.

Use the native absolute /traffic counters without clear=1. The collector computes deltas and detects process/counter reset. Never clear a counter before its delta is durably persisted.

The native /online result may be sampled for current client-instance count. Do not present that number as exact physical-device ownership.

### 4.3 VLESS account identity and Xray statistics

Keep the existing VLESS UUID as a legacy client.

Add five new VLESS clients with one unique UUID per Labmem account.

Assign stable non-secret emails/tags:

- legacy-vless
- Labmem001.vless
- Labmem002.vless
- Labmem003.vless
- Labmem004.vless
- Labmem005.vless

Enable Xray stats, policy user uplink/downlink/online, and loopback StatsService only.

Do not expose Xray gRPC StatsService publicly.

The collector maps LabmemNNN.vless back to account_id LabmemNNN and persists protocol-specific deltas.
It stores only Xray's per-user active source-IP count, not the IP list; this count is not a physical-device count.

The current VLESS listener, Reality target, flow, TLS/Reality material, routing, and existing legacy client behavior remain otherwise unchanged.

### 4.4 Subscription files and Caddy

Keep the existing token directory and all four existing files untouched during migration.

Generate five new token directories:

/var/lib/caddy/subscription/<generated-token>/

Each directory contains the formats already supported by the repository:

- qx.conf
- server.snippet
- clash.yaml
- shadowrocket.txt

Format policy stays unchanged:

- Quantumult X continues to receive VLESS Reality.
- Clash/Mihomo receives HY2 and may include the matching VLESS node if the existing format policy does so.
- Shadowrocket receives the supported HY2/VLESS entries.
- All credentials inside a Labmem account's files must belong to that same Labmem account.

The new implementation may generate the bounded Caddy matcher list from account state, but it must not create an unrestricted filesystem server or directory listing.

The existing Subscription-Userinfo VPS-wide header remains backed by KiwiVM for compatibility. Per-account usage is an Amadeus/Kurisu reporting feature in this Goal; do not replace the global subscription header with a misleading per-user quota unless a later Goal explicitly changes that contract.

### 4.5 Accounting collector

Add one lightweight collector in the VPS accounting service.

Sample at a bounded cadence such as 60 seconds:

1. Hysteria /traffic and /online.
2. Xray user traffic stats.
3. Whole-VPS provider counter needed for the accounting baseline/reconciliation.

Persist deltas transactionally.

Counter rules:

- Current >= previous: delta = current - previous.
- Current < previous or generation changed: treat as source restart/reset; delta starts from the new counter without creating a negative value.
- Keep all five generated Labmem subscription URLs private until the provider T0 baseline is captured. Because these identities are new and unused before T0, their first observed absolute counters can be attributed from T0 if the protocol API omitted their initial zero entries.
- Legacy counters may include pre-T0 traffic. Baseline each legacy protocol at T0; if a legacy counter is first observed without an established T0 baseline, keep that protocol total unknown rather than assigning its absolute counter to this monitoring period.
- Never fabricate missing protocol values as zero.
- If one source fails, persist successful sources and mark the failed source stale/error.
- Account totals are the sum of the account's protocol deltas only for intervals that have real samples.

The legacy HY2/VLESS identity is included in proxy-accounted traffic so old-client usage is visible during migration.

### 4.6 Sanitized read-only snapshot for OpenClaw

Do not give the HomeLab OpenClaw container direct access to the SQLite database or protocol credentials.

The VPS accounting service atomically writes a sanitized snapshot, for example:

/var/lib/amadeus-accounting/subscription-usage-public.json

The snapshot contains only:

- monitoring start time;
- each account ID;
- HY2 upload/download cumulative bytes;
- VLESS upload/download cumulative bytes;
- total monitored bytes;
- online/client count where known;
- freshness/status timestamps;
- legacy aggregate;
- provider baseline/reconciliation metadata that contains no credential.

Grant the existing amadeus-vps-readonly path read access only to this sanitized snapshot.

Extend the fixed amadeus-vps-readonly-probe with deterministic accounting records. Do not accept arbitrary paths, account names, SQL, shell fragments, or SSH_ORIGINAL_COMMAND execution.

### 4.7 OpenClaw / Amadeus native tools

Extend the existing VPS capability instead of creating a new runtime.

Preferred tools:

- amadeus_vps_subscription_overview: empty input; returns all five Labmem accounts, legacy aggregate, protocol totals, freshness, and monitoring start.
- amadeus_vps_subscription_detail: bounded accountId enum for Labmem001-Labmem005 plus legacy; returns one account's protocol totals and current activity facts.
- optionally keep whole-plan aggregation inside the existing amadeus_vps_usage rather than duplicating KiwiVM calls.

The tools are read-only and owner-only by existing tool/channel policy.

Do not add the new account-detail tools to WhatsApp/Telegram group allowlists or non-owner DM capabilities.

Update the VPS Skill so natural-language traffic questions combine:

- amadeus_vps_usage for provider truth and progress bar;
- subscription overview/detail for monitored account attribution;
- services/system tools only when the user also asks for health.

The model must not calculate usage from raw logs or invent missing numbers.

## 5. Provider total and reconciliation semantics

KiwiVM remains the authoritative plan/quota source.

The main progress bar always uses the current KiwiVM data_counter / plan_monthly_data values. This preserves all traffic already consumed earlier in the provider billing cycle.

Per-account accounting begins at the cutover timestamp T0. No migration logic may assign earlier provider traffic to Labmem accounts.

At T0 persist provider_counter_at_start.

After T0 expose three distinct quantities:

- providerDelta: KiwiVM counter growth since T0;
- proxyAccounted: monitored HY2 + VLESS account traffic, including legacy;
- reconciliationGap: providerDelta compared with the calibrated proxy accounting model.

Do not initially define reconciliationGap as a guaranteed byte-for-byte subtraction because KiwiVM accounting direction/overhead and protocol user counters may not have identical semantics.

Before enabling anomaly claims, run controlled transfer calibration for HY2 and VLESS and record:

- known payload size;
- Hysteria/Xray user counter delta;
- KiwiVM counter delta;
- network in/out raw history where available.

Only after this evidence defines the normal ratio/tolerance may the system label a reconciliation gap as anomalous.

Until calibration passes, report providerDelta and proxyAccounted separately and set reconciliation status to uncalibrated/unknown.

This prevents false alarms while still solving the immediate attribution problem.

## 6. WhatsApp morning/evening reporting

Reuse the existing OpenClaw scheduler + VPS Skill + amadeus_notify_owner path.

No direct WhatsApp API call and no second sender.

Target schedule:

- morning: 09:30 Asia/Shanghai;
- evening: 21:30 Asia/Shanghai.

The 2026-10-08 read-only runtime audit found exactly one existing morning job at
09:30 and one existing evening job at 23:00 Asia/Shanghai. Reuse those two
named jobs and edit their existing IDs in place; the evening expression changes
to 21:30. The source now refuses to proceed if a target name matches multiple
jobs, so deployment cannot silently leave a duplicate behind.

Each scheduled report must include:

- VPS whole-plan ten-cell progress bar;
- used / total / remaining / reset time when known;
- traffic growth since the relevant previous report/sample;
- Labmem001-Labmem005 monitored usage summary;
- legacy usage when non-zero;
- top account for the report window when deterministically available;
- source freshness/degraded state;
- reconciliation warning only after calibration makes that warning meaningful.

Keep the normal report concise for WhatsApp.

Detailed HY2/VLESS splits are shown on explicit query or when an anomaly needs explanation.

Continue using stable owner notification event keys so scheduled retries are idempotent.

## 7. Alerting scope

P0 is accounting + query + morning/evening reports.

After calibration, enable bounded alerts using config values rather than hidden literals:

- whole-plan used percentage warning/critical thresholds;
- abnormal provider growth in a sampling/report window;
- calibrated reconciliation gap above tolerance;
- one account producing an unusually large share of monitored traffic.

Do not automatically block a Labmem account or run tc/TrafficCop from this capability.

Traffic blocking/limiting is a separate explicit mutation capability and is out of scope here.

## 8. Source layout target

Keep changes close to the existing owners.

Expected source areas:

- infra/vps/subscription/ for the runtime account store/service, migration/provisioning helpers, Caddy/subscription integration, tests, and documentation;
- infra/vps/systemd/ for the accounting service unit/template if needed;
- infra/vps/amadeus-vps-readonly-probe.sh for the fixed sanitized accounting snapshot;
- plugins/amadeus/src/vps.ts or a sibling VPS-accounting module for snapshot parsing and aggregation;
- plugins/amadeus/src/capabilities/vps/register.ts for the new native read-only tools;
- plugins/amadeus/skills/vps/SKILL.md for tool-selection/reporting rules;
- OpenClaw schedule/config source only if the existing morning/evening schedules are not already defined elsewhere.

Do not put secrets, generated tokens, generated UUIDs, filled subscription files, SQLite databases, or provider credentials in Git.

## 9. Deployment phases

### Phase 0 — read-only audit

Before modifying runtime:

- inspect current /etc/hysteria/config.yaml without printing the password;
- inspect current /etc/xray/config.json without printing UUID/private material;
- identify the active legacy subscription token path without printing the token;
- verify Caddy/subscription responder services and current links;
- record Hysteria/Xray/Caddy versions and systemd units;
- inspect current OpenClaw VPS report schedules;
- confirm current KiwiVM counter and reset date;
- confirm disk/memory headroom.

Produce a protected dated checkpoint outside public Git.

### Phase 1 — source implementation, no runtime switch

Implement and test:

- SQLite schema/account store;
- exact five Labmem account creation logic;
- secret generation;
- legacy import path;
- loopback HY2 auth endpoint;
- Hysteria stats collector;
- Xray stats collector/parser;
- counter reset handling;
- sanitized snapshot writer;
- subscription rendering for per-account credentials;
- fixed read-only probe records;
- OpenClaw tool parsing;
- VPS Skill behavior;
- scheduled report composition.

No production credential is changed in this phase.

### Phase 2 — protected VPS candidate apply

Requires explicit apply.

`accounting_cli.py` defaults to a no-write dry-run; each database, secret, candidate, or
subscription-file write requires its explicit `--apply` option.

Create protected backups of:

- /etc/hysteria/config.yaml
- /etc/xray/config.json
- /etc/caddy/Caddyfile
- current subscription directories
- relevant systemd units
- current subscription responder files/config

Then:

1. Install the accounting service and database.
2. Import the current production token/password/UUID as legacy without printing them.
3. Generate Labmem001-Labmem005 token/HY2/VLESS credentials on the VPS.
4. Persist the five account records in SQLite.
5. Generate five new subscription directories.
   Keep these URLs private and undistributed until the collector captures the provider T0 baseline.
6. Validate all generated files without exposing credentials in command output.
7. Start the accounting service in auth-only mode so Hysteria can use the loopback HTTP auth endpoint without sampling an incomplete source set.
8. Enable loopback Hysteria HTTP auth + Traffic Stats while preserving the legacy credential mapping. Restart Hysteria only after config validation/checkpoint, then verify an existing legacy HY2 client still works.
9. Add the five VLESS clients and legacy email tag/stats configuration. Run `xray run -test` before restart/reload, then verify existing legacy VLESS still works.
10. Update/validate/reload Caddy only as needed for the new token paths. Confirm legacy links still work and the five new account links return 200.
11. Enable the collector only after HY2 and VLESS stats sources are both healthy; its first provider sample records T0 before any Labmem URLs are distributed.

Any legacy-client failure triggers rollback before proceeding.

### Phase 3 — accounting calibration

Perform controlled test traffic separately through:

- one new Labmem HY2 subscription;
- one new Labmem VLESS subscription.

Verify the corresponding account and protocol counters increase and other Labmem counters do not.

Compare the observed protocol counters with KiwiVM provider delta and establish the reconciliation tolerance/semantics.

Do not enable anomaly gap language before this passes.

### Phase 4 — OpenClaw / Kurisu integration

Add the owner-only read-only tools and Skill rules.

Verify manual queries:

- whole VPS usage;
- all accounts;
- one account;
- protocol split;
- legacy usage;
- stale/error behavior.

Update or create the two scheduled owner reports at 09:30 and 21:30 Asia/Shanghai without creating duplicate jobs.

Use the existing owner outbox and WhatsApp owner target.

### Phase 5 — real acceptance

Real acceptance must prove:

- existing legacy subscription URL still works;
- existing legacy HY2 client still authenticates;
- existing legacy VLESS client still authenticates;
- all five Labmem token URLs work;
- each Labmem account authenticates on its intended protocols;
- Labmem HY2 usage increments only the correct account;
- Labmem VLESS usage increments only the correct account;
- counters survive collector/OpenClaw restart;
- Hysteria/Xray restart is handled as counter reset, not negative/lost accounting;
- KiwiVM progress still includes the provider's earlier current-cycle usage;
- Kurisu manual VPS query shows the provider progress bar plus per-subscription breakdown;
- Kurisu account-specific query returns deterministic facts;
- one morning/evening dry/manual report goes through the existing owner outbox to the fixed WhatsApp owner;
- no generated token/password/UUID appears in Git, test snapshots, logs, owner reports, or checkpoint prose.

## 10. Rollback

Rollback must preserve client reachability first.

If Hysteria HTTP auth causes any regression:

- restore the exact protected pre-change Hysteria config;
- restart Hysteria;
- verify the legacy client;
- leave the new accounting DB disabled for later debugging.

If Xray stats/new clients cause regression:

- restore the protected Xray config;
- run xray config test;
- restart/reload;
- verify the legacy VLESS client.

If Caddy/subscription changes regress existing links:

- restore protected Caddy/subscription state;
- validate Caddy;
- reload;
- verify the legacy token path.

OpenClaw integration rollback restores only the previous Amadeus image/config/schedule state. It must not delete the VPS account database or rotate credentials automatically.

No rollback path is allowed to delete the current production token/password/UUID.

## 11. Security and privacy

- Secrets never enter Git.
- Do not print generated secrets in Codex logs, test output, checkpoint text, owner messages, or normal service logs.
- SQLite and backups use strict runtime permissions.
- Hysteria auth and traffic APIs are loopback-only.
- Xray StatsService is loopback-only.
- No public Web management UI.
- Caddy access logging for bearer-token subscription paths remains disabled/sanitized.
- The sanitized OpenClaw snapshot contains usage facts only.
- New tools remain owner-only; group users never receive subscription/account traffic details.
- Destination/stream logging is not collected by default. This Goal accounts bytes and accounts, not browsing history.

## 12. Validation commands / proof gates

Follow the repository's minimum-sufficient workflow first:

- pnpm workflow:plan
- focused Python unit tests for subscription/accounting service
- focused Amadeus plugin tests
- affected TypeScript typecheck/build
- git diff --check
- pnpm check:secrets

For runtime apply additionally require:

- Python syntax/unit checks;
- Hysteria config/service smoke;
- xray run -test against candidate config;
- caddy validate;
- systemd active/enabled checks;
- local loopback auth/stats health without printing secrets;
- old-client smoke before and after each proxy switch;
- new-account controlled accounting test;
- OpenClaw tool smoke;
- real owner WhatsApp report acceptance;
- dated protected checkpoint and rollback evidence.

Do not bump version or deploy HomeLab/OpenClaw merely because this planning document exists. Actual release/apply requires the normal explicit authorization; the operator authorized this Goal's Apply on 2026-10-08.

## 13. Definition of done

This Goal is complete only when:

- five runtime subscription identities Labmem001-Labmem005 exist with independent token, HY2 credential, and VLESS UUID;
- the old production token/HY2/VLESS credentials remain active and unchanged;
- each new account's HY2 and VLESS traffic is separately attributable and aggregatable;
- legacy usage is visible separately;
- whole-plan KiwiVM usage/progress remains authoritative and includes pre-accounting current-cycle traffic;
- per-account accounting clearly states its T0 boundary;
- reconciliation semantics are calibrated before anomaly claims;
- Kurisu can query whole-VPS and per-subscription usage naturally;
- morning/evening owner WhatsApp reports include the VPS progress bar and subscription summary;
- no second sender/runtime/keyword router/admin panel is introduced;
- no secret is committed or exposed;
- real acceptance and rollback evidence are recorded.

## 14. Explicit non-goals

Not part of this Goal:

- deleting/revoking the current token or credentials;
- retroactively assigning old historical traffic to the five Labmem accounts;
- per-device accounting below one subscription identity;
- automatic account blocking;
- tc/TrafficCop enforcement;
- ntopng/Grafana/Prometheus deployment;
- destination browsing-history retention;
- public account management UI;
- changing VPS provider or monthly plan;
- changing HY2/VLESS ports or Reality identity unless separately authorized.

## 15. Future cleanup gate

After all five users have moved and the operator explicitly instructs that the legacy access may be removed, create a separate cleanup/migration checkpoint.

Only that later owner-authorized step may:

- revoke the old subscription token;
- revoke the old HY2 credential;
- remove the old VLESS UUID;
- remove the legacy token directory/Caddy matcher;
- delete or archive the legacy account record.

Do not infer that authorization from successful Labmem deployment.

## 16. Upstream documentation references

Implementation must verify the pinned runtime versions against official documentation before apply:

- Hysteria 2 full server config / HTTP auth / trafficStats: https://v2.hysteria.network/docs/advanced/Full-Server-Config/
- Hysteria 2 Traffic Stats API: https://v2.hysteria.network/docs/advanced/Traffic-Stats-API/
- Xray policy user stats: https://xtls.github.io/en/config/policy.html
- Xray statistics: https://xtls.github.io/en/config/stats.html
- Xray API / StatsService: https://xtls.github.io/en/config/api.html

## 17. Apply and runtime acceptance record — 2026-10-08

Amadeus 1.9.9 is live in immutable image
`local/openclaw-amadeus:git-b80f9a7882cc-20261008052549`. OpenClaw health,
Product Radar health, Amadeus registration, NAS read-only smoke, owner outbox,
and both report Cron targets passed. The pre-switch checkpoint is
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20261008052549`; deployment
evidence is kept outside Git at
`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-openclaw-20261008052549`.

The two existing jobs were edited in place, with IDs preserved:

- morning `0a0bbe0f-43f1-4582-af45-22dbafb6cf5c`: enabled, `30 9 * * *`, `Asia/Shanghai`;
- evening `bfc071e5-31a1-4ca5-8836-b228e0f8589a`: enabled, `30 21 * * *`, `Asia/Shanghai`.

Both have `delivery.mode=none` and use the existing owner outbox. A real owner
report was delivered during the midday acceptance run. That run initially used
the scheduled evening idempotency key outside its schedule window. Amadeus 1.9.9
fixes classification using the actual Cron session context and schedule window;
the acceptance tests cover both an out-of-window manual run and the scheduled
run. The evening prompt has a date-limited recovery key for 2026-10-08 so that
tonight's scheduled report can still be sent once; future evenings use the
normal daily key. The prompt correction is committed in `be53156`.

After the individual Xray and Hysteria restarts, each service became active and
the collector recorded a generation reset with nonnegative deltas and preserved
cumulative totals. A controlled local VLESS request and HY2 request both
returned HTTP 200 after restart. The five Labmem identities each connected
through both intended protocols (HTTP 200 each), and subsequent healthy
collector samples recorded nonzero traffic for all five accounts on both HY2
and VLESS. The legacy HY2 and VLESS credentials also connected after both
restarts. The earlier 48/48 subscription-format checks passed on both ports;
the legacy QX response remained byte-identical. No generated credential was
printed or included in the repo.

The latest sanitized VPS snapshot at acceptance had provider, HY2 traffic and
online, and Xray traffic and online sources all `ok`; all five accounts had
known HY2/VLESS totals, legacy remained represented separately, and
`proxyAccountedComplete=true`. Provider T0 remains
`2026-10-08T04:58:07Z`. Reconciliation remains `uncalibrated`, with no gap or
anomaly claim. The deployment evidence and restore pointers are in
`.agent/checkpoints/2026-10-08-vps-subscription-accounting-deployment.md`.

The deploy's managed-container log policy check reported a warning because the
OrbStack Docker daemon has no default logging policy. Every managed container
still had bounded `local/20m x5` logging; changing the daemon policy would
restart OrbStack and was outside this Goal.

## 18. Current acceptance audit — 2026-10-08

This earlier audit was superseded by the operator-directed closure in section
19.

At the latest live audit, Amadeus remained 1.9.9, the Amadeus plugin was loaded,
and its runtime registry contained all seven VPS tools. Both existing report
jobs were unique and enabled with `lastStatus=ok`; the morning run had completed
at 09:30 Asia/Shanghai. The evening job's latest run was the earlier manual
acceptance at 13:18 and its next run was 21:30, so the one-time scheduled
recovery run had not yet happened.

VPS acceptance was rechecked: all six current identities had unique subscription
tokens, HY2 secrets, and VLESS UUIDs; all 48 subscription URLs returned HTTP 200
on both ports and response bodies matched their local files. All five Labmem
accounts retained sampled nonzero HY2 and VLESS counters. The provider, Hysteria
traffic/online, and Xray traffic/online sources were `ok`, and all critical
services were active. Reconciliation remains `uncalibrated`.

A non-delivered headless OpenClaw CLI attempt did not include the actual inbound
owner sender context; the model saw no VPS tools. It is not proof that normal
WhatsApp owner queries fail, but it cannot prove they work either. A real owner
WhatsApp direct-message query covering the whole plan and a Labmem protocol split
is still needed. Stale/error behavior is covered by the focused Amadeus tests.

Two VPS-local Labmem001 controlled downloads were also run: one 32 MiB HY2
transfer and one 32 MiB VLESS transfer, each HTTP 200. At the next collector
snapshot, the corresponding Labmem001 protocol counters increased by 33,607,618
and 33,608,159 bytes. Raw `eth0` RX/TX deltas are recorded in the deployment
checkpoint. The direct KiwiVM counter did not advance across either test, while
the baseline showed unrelated legacy and interface traffic; this is useful
path/accounting evidence but not sufficient provider calibration. Reconciliation
remains `uncalibrated`, with no gap or anomaly claim.

During this audit, the member listing of the protected pre-change archive was
accidentally printed in a tool result and included the legacy subscription
bearer-token path. The token value is deliberately omitted from this repository
record. No runtime secret, Caddy route, or proxy credential was changed. The
operator later explicitly instructed that the existing legacy token be
preserved. The prior tool-output exposure cannot be undone; it remains a
recorded residual, and this repository does not claim the no-secret-in-logs
condition was satisfied.

## 19. Operator-directed closure — 2026-10-08

At 14:08 Asia/Shanghai, the operator reported that a direct owner query had
returned normally, instructed that the legacy token remain unchanged, and
asked to close this Goal. This is operator-reported acceptance; no WhatsApp
transcript was captured in the repository. The four formats for Legacy and
Labmem001–Labmem005 were rechecked over public HTTPS: all 24 returned HTTP 200
and each response body matched its corresponding local subscription file.
The subscription URLs are intentionally not recorded in Git or this Goal.

Live Cron state was checked on CasaOS `nyannyan`: the existing morning and
evening job IDs remain unique, enabled, and configured for 09:30 and 21:30
Asia/Shanghai with `delivery.mode=none`. The 09:30 job and the earlier manual
owner-report run had `lastStatus=ok`. At closure, 21:30 had not yet occurred;
the configured future run is not represented as already executed.

Follow-up 16 MiB Labmem001 upload trials returned HTTP 200 over HY2 and VLESS.
The corresponding account counters increased by about 16.8 MB per protocol,
and raw interface TX rose by about 16.9 MB. The provider counter sampled later
also increased, but unrelated legacy/frps traffic and provider sampling delay
prevented isolating either test's KiwiVM delta. Reconciliation therefore
remains `uncalibrated`; provider and proxy totals are reported separately, and
no anomaly language or reconciliation alert is enabled.

The operator closed the Goal with those limitations recorded. The old token
and proxy credentials remain unchanged as requested. The earlier tool-output
exposure remains an acknowledged residual; no claim is made that it was erased
or that the original no-secret-exposure condition was met. The 21:30 scheduled
run and any future provider calibration are outside this closed Goal unless
the operator opens a follow-up.
