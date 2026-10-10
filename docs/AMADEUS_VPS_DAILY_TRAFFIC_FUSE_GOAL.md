# Amadeus Gateway Daily Traffic Fuse — Goal

Date: 2026-10-10 (Asia/Shanghai)
Status: PHASE_0_READONLY_AUDIT_CAPTURED; PHASE_1_SOURCE_IMPLEMENTED; QDISC_AND_RECOVERY_DESIGN_PENDING; LIVE_APPLY_PENDING
Delivery: deterministic source and focused tests are in Git and the OpenClaw owner/read-only integration is deployed in Amadeus 1.10.4; production traffic shaping still requires a separate explicit --apply authorization after the read-only VPS audit.

## 0. Operator request and pinned defaults

Introduce an **automatic, whole-VPS daily traffic fuse** for the personal `amadeus-gateway` VPS.

Local-day behavior (Asia/Shanghai / UTC+08:00, **calendar day**, not a sliding 24-hour window):

- 00:00 starts a new day's traffic accounting.
- 40 GB of monitored whole-VPS usage: **one advance warning** to the WhatsApp owner.
- **50 GB (50,000,000,000 bytes)**: switch the VPS to a **shared 2 Mbps business-traffic egress shaper**.
- Once entered, the day stays in protection mode until the next local midnight, even if traffic pauses.
- The next 00:00: remove only the fuse-owned shaper, verify the normal network path, reset the new day's baseline/state, and send one recovery notification.
- The rate is a **shared** 2,000,000 bit/s on the shaped business egress, **not 2 Mbps per Labmem account, per port, or per process**.
- No deliberate throttling of the verified SSH recovery path and a tightly bounded control/notification channel; these exceptions mean the phrase "2 Mbps" is NOT a literal all-packets/all-directions cap.
- Keep the six valid identities: `Labmem001`–`Labmem005` and `M204-Net-Core`. Legacy remains retired. Do not rotate tokens, HY2 passwords, UUIDs, Reality material or subscriber URLs.
- Both protection and restoration must notify through **Kurisu's existing Steins;Gate worldline presentation and WhatsApp owner outbox**, not via a second sender or plain custom HTTP WhatsApp client.

A 2 Mbps one-direction continuous stream can still send approximately 21.6 GB over 24 hours, and inbound attack traffic may consume billed quota before Linux ingress control can act. This is a **loss-reduction fuse**, not a proof that provider-billed daily usage can never exceed 50 GB.

## 1. Current baseline to preserve

The latest source uses an Ubuntu 24.04 VPS with limited resources (2 vCPU / 1 GiB RAM). Live services include:

- Xray VLESS/REALITY/Vision on TCP 2053, with the completed anti-steal fallback gate;
- Hysteria 2 on UDP 2053, with per-account loopback HTTP auth and bounded failed-auth limiter;
- Caddy and frps exposing HomeLab services;
- `amadeus-gateway-accounting.service`: Python + SQLite, provider/HY2/Xray sampling every 60 seconds;
- KiwiVM `getServiceInfo.data_counter` as the authoritative provider quota counter;
- a sanitized read-only SSH probe for VPS facts;
- owner-only native VPS tools in `plugins/amadeus`;
- existing `amadeus_notify_owner` / owner outbox / WhatsApp destination;
- existing 09:30 and 21:30 Asia/Shanghai VPS report jobs.

No native `tc` daily-fuse lifecycle currently exists.

Important accounting facts: provider samples are accumulated across the billing cycle, not automatically from Shanghai midnight; current snapshots' `monitoringStartedAt` is not a midnight baseline. Per-account HY2/VLESS counters must NOT be substituted for total VPS traffic.

## 2. Threat model and accounting scope

This protects against:

- unexpectedly heavy usage by otherwise valid HY2/VLESS subscribers;
- high-traffic sessions or compromised services hosted via Caddy/frps;
- runaway processes/egress and incidental proxy traffic outside the six attributed accounts.

It does not claim to stop:

- provider-side counted ingress volumetric DDoS traffic;
- traffic billed before the shaper becomes active;
- traffic exempted for recovery/control services;
- sources outside the shaped VPS physical network path;
- provider billing semantics not yet calibrated.

The trigger must represent the **whole gateway**, including Caddy/frps/non-proxy services, not only `Labmem*` and `M204-Net-Core`.

The user-visible status distinguishes `provider_confirmed`, `local_wan_estimate`, `partial_coverage`, `stale`, and `unknown` whenever a source is incomplete; never print a fabricated exact "since 00:00" figure.

## 3. Meter design: provider truth + fast local guard

Implement a lightweight bounded **daily metering service** using the current accounting foundation, plus a deterministic privileged shaper boundary.

### 3.1 Provider counter

Read KiwiVM's actual counter from the existing successful accounting provider samples; do not introduce competing unsynchronized requests or give the shaper direct KiwiVM credentials if a sanitized provider sample suffices.

Persist timestamped monotonic provider increments and reset-generation metadata in protected SQLite; handle counter wrap/decrease, official billing-period reset, stale/error, out-of-order samples and VPS restarts.

Aggregate all provider increments whose intervals are attributable to the Shanghai-local calendar day; do NOT treat the previous billing-cycle counter as the day's zero.

Near midnight a 60-second provider polling interval cannot attribute cross-midnight traffic precisely. Record boundary uncertainty; if only rough allocation is possible, label the result accordingly. Never silently assign an entire pre-midnight interval to the next day.

### 3.2 Local NIC fast guard

Independently read the **actual public-WAN interface** `/sys/class/net/<iface>/statistics/rx_bytes` and `tx_bytes` at a configurable cadence (target 5–10 seconds), using an audited default-route/interface identity and preserving per-interface baseline/generation.

Exclude loopback and duplicate virtual/tunnel interfaces; never naively sum `eth0`, `veth`, `wg`, etc. If WAN interface changes, host reboots, or counters reset, flag the discontinuity and recover from persisted state without negative or huge synthetic deltas.

Do not assume `RX+TX == KiwiVM data_counter`. First audit and calibrate the provider's accounting scope and expected NIC direction/forwarding overhead with controlled tests and existing provider observations. Persist calibration version and provenance.

Normal fuse triggering is allowed on either a provider-confirmed >=50 GB daily delta, or an appropriately calibrated conservative local-WAN safety trigger. If no reliable coherent source exists, mark the meter degraded and notify; do not pretend that an uncalibrated counter equals billed bytes or unconditionally reset a partially observed day to zero.

The local fast guard should detect a heavy burst well before the next 60-second KiwiVM sample when calibrated. The VPS may still overshoot 50 GB during the 5–10 second guard detection/apply interval.

### 3.3 Day boundary and first-day coverage

Use `Asia/Shanghai` for every daily partition independent of the VPS system timezone and UTC for durable timestamps.

The day identifier is `YYYY-MM-DD` in Asia/Shanghai. A calendar day is [00:00, next 00:00) in that timezone.

At startup in the middle of a day, do not call traffic observed only since installation "the day's total". Either reconstruct trustworthy midnight-boundary measurements from actual persisted samples or mark `partial_coverage` and treat the first partial day as a conservative safety monitor; start full-day enforcement after a verified following-midnight rollover.

Reboots and service gaps cannot restart the current day's tally from zero. Count a gap only from provable counter deltas, with completeness metadata; stay explicit about unknown/unobserved periods.

Use decimal GB for the 40/50 GB operator thresholds and exact bytes internally. UI should not accidentally compare 50 GiB with a 50 GB threshold.

## 4. Safety state machine

Persist one durable state per Shanghai calendar day. Example states:

```text
INIT/DEGRADED
  -> NORMAL
      -> WARNED       (daily >=40 GB; one event)
      -> PROTECTING   (daily >=50 GB, protection desired)
          -> CAPPED   (tc applied AND read-back verified; one event)
          -> APPLY_FAILED (tc not verified; urgent owner event)
  -> next local day:
      -> RELEASING
          -> NORMAL (fuse-owned tc absent and ordinary path verified; one event)
          -> RELEASE_FAILED (retry + urgent owner event)
```

A fast leap from below 40 GB to >=50 GB should trigger protection directly; the advance-warning event may be omitted or combined with the protection alert rather than sending a stale warning after the cap.

State transitions must be atomic with a durable intent/journal before external tc operations. Report `CAPPED` only after inspecting the kernel qdisc/classes/filters and proving the expected shaper exists.

After a crash between applying `tc` and writing success, startup reconciliation reads **actual kernel state** and corrects durable state without duplicating notifications. Reconcile on timer ticks and service restarts.

Once CAPPED, no counter decrease, source stale interval, or KiwiVM billing-cycle reset may automatically uncap within the same day.

At the next midnight, release the previous day's rule regardless of the provider's monthly billing reset schedule, switch to a new-day meter, and only then begin enforcing the new day's independent threshold.

If a release fails, keep a durable `RELEASE_FAILED` and retry; do not claim restoration occurred. A separate systemd timer with `Persistent=true`, checked by `systemd-analyze calendar`, should own missed-midnight catch-up, independent of OpenClaw/WhatsApp availability.

Provide `status`, `dry-run`, and separate explicit `apply`/`release` administrative commands, each deterministic and bounded.

## 5. Network shaping

### 5.1 Scope

Apply Linux `tc` with HTB/classes or another audited kernel shaper to the single actual public-WAN interface. All non-exempt **business egress together** receive a shared cap of 2 Mbps (not each matching flow separately).

Include at least Xray/HY2 proxy replies, Caddy public services, frps-public relay traffic and other normal public-facing business egress in the shared bucket. Do not accidentally exempt all TCP 443 or 2053 as "control traffic".

Protect the established SSH management/recovery path with a small explicit, auditable class/exception. Keep essential health/notification transport functional where possible with **narrow, verifiable** exceptions, not a blanket allowlist for attacker-controlled traffic.

Local-only traffic (127.0.0.1, UNIX sockets) should not be inadvertently throttled.

The policy should not modify Xray, Hysteria, Caddy, frps credentials, listeners or account accounting.

### 5.2 Preexisting qdisc and ownership

Pre-audit `tc -s -j qdisc show dev <iface>`, `tc -j class show`, filters and routing. Detect other qdisc shaping/fq_codel, existing handles/classes, CAKE, Tailscale or provider routing constraints.

Never overwrite a nontrivial/foreign existing root qdisc. If the existing shape cannot be safely composed with this feature, abort with a truthful apply-failure event instead of destructive `tc qdisc replace`.

Tag all fuse-owned kernel handles/classes/filters. Idempotent apply/restart, and remove **only those rules owned by this fuse** at restoration. Record pre-change configuration in a root-only checkpoint, but do not pretend an arbitrary complex foreign qdisc can be reconstructed from a text dump.

Privileged actions must live behind a minimal allowlisted helper or dedicated `CAP_NET_ADMIN` service, fixed real-interface identity and fixed `apply|release|status` operations. No arbitrary shell, SQL, interface strings or `tc` parameters accepted from OpenClaw/Kurisu.

If SSH recovery becomes unreachable during testing, an independent local/console or timed rollback mechanism must restore the pre-change network state. An apply test without a proved emergency rollback route is prohibited.

### 5.3 Ingress and billing caveat

An egress HTB shaper does **not** reliably bound provider-billed ingress. Document this in the user-visible state. An ingress IFB option can be assessed separately in Phase 0/controlled tests but must not be described as able to prevent packets arriving at the provider.

In high-volume inbound attack conditions, recommend/provider-side firewall or DDoS mitigation as a separate owner-authorized incident action. Do not add blanket firewall blocks or disable ports here.

## 6. Dedicated low-cost runtime boundary

Preferred shape:

- existing `amadeus-gateway-accounting`: authoritative provider/identity observation and sanitized factual snapshot;
- a very small fixed `amadeus-vps-traffic-fuse` controller, SQLite daily state and 5–10 second local network watcher;
- one restricted privileged tc helper and two systemd units/timers as appropriate for periodic reconciliation and midnight rollover;
- a fixed sanitized event/state export, consumed by the existing `amadeus-vps-readonly-probe`;
- the HomeLab OpenClaw plugin's bounded owner notifier worker consumes pending events and uses the **existing owner outbox**; no second WhatsApp sender.

Keep this low-memory for the 1 GiB VPS. No Grafana, Prometheus, Redis, database server, web panel or LLM process on the VPS.

Persist state under a protected location such as `/var/lib/amadeus-traffic-fuse/`; do not let untrusted Caddy/frps users write policy or event state.

Read-only snapshot must contain no proxy credentials, token paths, client IPs, destination/SNI history or KiwiVM API secrets.

## 7. Steins;Gate / Kurisu WhatsApp delivery (hard requirement)

**Reuse the actual presentation contracts**, not a hand-coded alternate theme renderer:

- `packages/presentation/src/worldline/policy.ts`
- `packages/presentation/src/worldline/adapter.ts`
- `packages/presentation/src/worldline/contracts.ts`
- `plugins/amadeus/src/owner.ts`
- `plugins/amadeus/src/capabilities/notification/register.ts`
- `plugins/amadeus/skills/owner-notification/SKILL.md`

The fuse controller must produce deterministic, transport-neutral **security facts/events**. Only at the Amadeus/presentation boundary adapt them to `worldline_notification_intent` / `owner_notification`; the existing renderer owns headline labels, character/theme styling and optional `El Psy Kongroo.` ending.

No new hard-coded persona prompt, chatbot keyword router, raw WhatsApp Graph API sender, Telegram/group fallback, or channel-specific code in the fuse controller.

### 7.1 Event/theme mapping using EXISTING vocabulary

| Event | `kind` / severity | Theme returned by current policy | Required facts |
| --- | --- | --- | --- |
| 40 GB advance warning | `status_changed`, `warning` | `worldline_divergence` / 世界线偏移 | Shanghai date, observed usage, threshold, remaining headroom, data freshness |
| 50 GB protection applied | `network_degraded`, `warning` (or `error` if genuinely severe) | `worldline_divergence` / 世界线偏移 | usage, exact trigger source, 50 GB threshold, verified 2 Mbps shared egress, cap time, **next 00:00 Asia/Shanghai recovery time** |
| Midnight verified release | `source_recovered`, `success` | `worldline_convergence` / 世界线收束 | previous day's date/usage, actual verified released time, normal egress restored, new-day window |
| Apply/release or meter failure | `dependency_failure`, `error` | `ibn_5100` / IBN 5100 | operation failed, observed kernel state, retry plan, evidence freshness, never falsely assert restored/protected |
| Existing scheduled VPS report | `scheduled_report` | `dmail` / D-Mail | daily fuse state, day usage/coverage, next recovery time if capped |

Do not misrepresent a traffic anomaly as a confirmed attack: **`sern_alert` is reserved for genuine critical confirmed security incidents**, not "50 GB used". Likewise, there is no need to invent a new worldline theme.

Suggested renderer-owned message meaning (illustrative only, not a second text-renderer):

```text
Amadeus • 世界线偏移 · VPS 流量保险丝已启动
今天已监测：50.3 GB / 警戒线 50 GB
保护状态：已实际生效
整机业务出口：共享 2 Mbps
预计解除：2026-10-11 00:00（北京时间）
当前信号仅说明流量超阈值，不代表凭据被盗。
```

The restoration intent must yield a truthful 世界线收束 message only after the `tc` removal is verified.

### 7.2 Durable and deduplicated delivery

Persist bounded, credential-free event records on the VPS before trying to deliver.

Use stable event keys such as:

- `vps-daily-fuse:2026-10-10:warning`
- `vps-daily-fuse:2026-10-10:engaged`
- `vps-daily-fuse:2026-10-10:released`
- `vps-daily-fuse:2026-10-10:apply-failed`
- `vps-daily-fuse:2026-10-10:release-failed`

For `released`, the key names **the protected day being released**, even though the notification occurs at the following midnight.

When polling/retrying, do not duplicate owner notifications: the canonical outbox must own pending/sent markers and retries.

Extend a **bounded deterministic native owner worker** (target: ~60-second polling) that reads the sanitized fixed VPS probe, applies `adaptWorldlineNotification`, and uses `OwnerNotifier.notify` / existing owner outbox. Avoid triggering an LLM cron every 5 seconds and do not wait until the 09:30/21:30 reports to announce the fuse.

`queued` is not `sent`; the outbox retry worker ensures eventual delivery if the HomeLab or WhatsApp transport is briefly unavailable. Keep a bounded journal long enough to survive outages and expose delivery status without disclosing secrets.

No user-selectable recipient: the only destination remains the configured WhatsApp owner DM.

### 7.3 Existing morning/evening reports and query

Do not create duplicate 09:30/21:30 jobs. Extend the existing VPS Skill/overview to include:

- today's observed provider/local usage with coverage/source status;
- threshold and state (`normal`, `warned`, `capped`, `apply_failed`, `release_failed`, etc.);
- actual effective shared rate if verified;
- time in protection, next midnight recovery deadline;
- distinction between all-VPS traffic and Labmem/M204 account breakdown.

Kurisu natural-language queries such as "今天 VPS 用了多少流量", "为什么被限速了", "限速什么时候恢复", "VPS 保险丝状态" use **read-only** deterministic tools. Chat queries are not a path to root `tc` mutation.

## 8. Important failure rules

- If source data is stale, report stale and retain the prior verified fuse state. Do not silently assume zero usage.
- If the provider resets its monthly counter within a day, continue the calendar day's verified accumulated delta; do not prematurely uncap.
- If a server reboots while capped, inspect and reapply the same day's cap as soon as safe; still release at the next midnight.
- If midnight arrives while the HomeLab/OpenClaw is down, the VPS systemd timer must release without WhatsApp/LLM.
- If a temporary VPS-to-HomeLab connection fails, persist the event and let the owner outbox retry after connectivity recovers.
- If applying shaper fails, do not mark CAPPED or send "已限速"; report APPLY_FAILED and retry safely.
- If releasing fails, do not send "已恢复"; report RELEASE_FAILED and retry.
- Do not repeat trigger/release notifications on each polling pass.
- If the monitored public interface changes, suspend unsafe mutation, report the changed identity and require a validated policy on the replacement device.
- Honor date transitions even if the hourly or billing history is discontinuous, with the appropriate `partial_coverage` status.

## 9. Expected source ownership

Recommended paths, adjusted after Phase 0 audit:

- `infra/vps/traffic-fuse/` — isolated deterministic controller, state machine, NIC sampler, tc helper, configuration template, tests, runbook;
- `infra/vps/systemd/` — controller/reconciler and independent midnight release timer templates;
- `infra/vps/amadeus-vps-readonly-probe.sh` — one fixed sanitized fuse read route, no user-provided path/command;
- `infra/vps/subscription/accounting_service.py` and/or store — add timestamped provider samples/deltas only if needed to produce truthful whole-day data;
- `plugins/amadeus/src/vps.ts`, VPS capability/Skill — read-only typed status;
- `plugins/amadeus/src/owner.ts` or its existing worker integration — bounded deterministic alert producer routed to canonical owner outbox;
- `packages/presentation` — reuse policy/adapter/renderer; extend tests/registry only if a new producer registration is required by architecture checks;
- `docs/PROACTIVE_NOTIFICATION_PRODUCERS.md` — register the fuse as a VPS producer rather than a new sender;
- `infra/vps/README.md` — public architecture and explicit ingress caveat.

No secret, live `tc` dump containing private endpoints, filled env, database, public IP, or raw provider credential may be added to Git.

## 10. Execution phases

### Phase 0 — read-only audit (NO apply)

- Re-read latest main/active VPS accounting deployment; verify `Labmem001`–`Labmem005` + `M204-Net-Core`, Legacy retired.
- Inspect provider cadence, available time-series history and billing semantics; evaluate actual Shanghai-midnight coverage.
- Identify the real default-route WAN NIC, current `tc` qdiscs/classes/filters, counters and route/SSH connectivity; do not print secrets.
- Check if provider-side ingress is counted and whether rate shaping on the chosen interface can affect all intended business paths.
- Verify existing owner outbox, worldline presentation, report jobs, and safe fixed VPS probe.
- Record proposed memory/CPU footprint and prove a non-SSH network recovery path or timed rollback before any qdisc mutation.
- Document exact day-boundary algorithm, calibration evidence, source uncertainties and the first-day behavior.

### Phase 1 — implementation / tests (NO live mutation)

- Build bounded daily meter with day-key SQLite state and provider increment + fast WAN sampler.
- Implement deterministic 40/50 GB transitions and next-midnight reset/release, including stale/counter-reset handling.
- Implement restricted `tc` apply/status/release with protected SSH recovery; no unknown existing qdisc destruction.
- Add systemd controller and independent midnight timer source.
- Export a sanitized security/traffic-fuse snapshot and durable event journal through the fixed probe.
- Add owner-only tool/status and deterministic worldline event adapter -> owner outbox.
- Update VPS Skill, provider registry, report schedule text only as needed (preserve job IDs).
- Verify fake-clock time boundaries, outage/reboot, provider billing resets, race conditions, exact-byte thresholds and actual tc command construction against isolated mock/stub network devices.

### Phase 2 — safe passive deployment and calibration (explicit apply required)

- Root-only dated recovery checkpoint before any runtime change.
- Deploy meter **observation-only** and capture true midnight continuity and local/provider comparison.
- Run controlled low-volume traffic calibration; include Caddy/frps and HY2/VLESS representative cases.
- Verify read-only Kurisu report/source provenance and that no `tc` shaper is installed while in observation-only mode.
- Verify fixed owner event delivery with manual unique keys; prove no new WhatsApp sender or credential exposure.
- If provider/local scopes remain uncalibrated, keep protection disabled and report blocker; do not claim complete protection.

### Phase 3 — actual fuse apply and real acceptance (separate explicit apply)

- Take a protected qdisc/SSH rollback checkpoint and arm independently verified timed rescue.
- On a safe isolated test interface or controlled test environment, demonstrate real shaping at **2 Mbps aggregate** and the expected management exception without losing SSH.
- Test forced/simulated threshold crossing using a supported non-production test source, not artificially burning 50 GB of the user's quota.
- Verify warning -> apply -> tc readback -> one themed WhatsApp alert with next 00:00; prove replay idempotence.
- Verify restart while CAPPED restores the rule and does not duplicate notifications.
- Verify simulated midnight release and a real local day-boundary test where feasible; both must read back qdisc removal, new-day state and a single 世界线收束 alert.
- Test `tc` apply failure, release failure, provider API outage, NIC counter reset, midnight billing reset, outbox outage and multi-day offline catch-up.
- Verify six active node/subscription clients and frps/Caddy service usability; Legacy must remain revoked.
- Ensure morning/evening reports continue once each at 09:30/21:30 and include the fuse status.
- Record evidence without tokens, addresses, private keys, API keys, or customer IPs.

## 11. Tests and proof gates

Minimum source checks:

- `pnpm workflow:plan` / correct focused verification level;
- Python tests for meter/controller, Shanghai date partition, counter reset, calendar/billing reset mismatch, SQLite restart durability and event de-duplication;
- shaper helper unit/sandbox tests for fixed interface, rate, qdisc ownership, SSH safety, idempotent apply/release;
- focused Amadeus/owner notification and worldline policy/renderer tests;
- group/non-owner denied for account/fuse details;
- affected typecheck and shell/systemd syntax;
- `git diff --check`;
- `pnpm check:secrets`.

Runtime proof after explicit apply:

- configured timer analyzed/validated; independent midnight trigger present;
- exact source freshness and counters recorded;
- `tc -s -j` proves aggregate business rate and no foreign-qdisc deletion;
- SSH new-session reconnect plus timed local rollback mechanism;
- controlled legitimate 6-account behavior and services unaffected except expected lower throughput after cap;
- owner warning/engagement/release messages rendered with existing 世界线/D-Mail style;
- delivered message has `.sent.json` evidence or clearly `queued` if awaiting retry;
- rollback documentation tested.

## 12. Rollback and operational recovery

- Stop the fuse controller/timer only after establishing whether an active owned shaper must be released; never just stop the service and leave the VPS permanently limited.
- Restore only fuse-owned qdisc/classes/filters and validate the prechange network path.
- Restore prior accounting snapshot/probe/owner-worker integration independently; never roll back successful Legacy retirement or REALITY anti-steal/HY2 security hardening.
- Preserve the event journal and day state for audit with credential-free checkpoint text.
- Restore an automatically removed fuse rule only if today's protected state and cutoff still require it; after next midnight it must stay removed.
- If the control channel is broken, the root-only timed rescue must clear the fuse-owned rules while preserving SSH access.

## 13. Definition of done

The Goal is complete only when:

1. The new day's measured full-gateway usage is credible and calendar-boundary provenance is explicit.
2. >=40 GB warns once; >=50 GB reliably enforces **shared 2 Mbps business egress** once, with verified kernel state.
3. Midnight release/reset is VPS-local, durable, and independent of OpenClaw availability.
4. Crash/reboot/outbox outage has tested recovery without duplicate warnings.
5. WhatsApp notifications use the existing **worldline themes** through the canonical owner outbox: warning/engagement 世界线偏移, verified recovery 世界线收束, normal reports D-Mail, operational failure IBN 5100 as appropriate.
6. Each capped notice states the actual rate, factual reason, and exact next midnight recovery time.
7. Normal six-account connections and protected SSH management remain functional; Legacy never returns.
8. No separate sender, LLM-controlled tc command, public admin port, or secret leak exists.
9. Ingress and provider-accounting limitations are explicit rather than claiming an absolute 50 GB daily bill cap.
10. Focused tests, live representative traffic proof, WhatsApp delivery evidence, and protected rollback checkpoint are recorded.

## 14. Non-goals

- Automatic HY2/VLESS account disabling, credentials rotation, or user-specific bandwidth caps.
- Retrofitting strict per-client quotas, Destination/SNI browsing-history logging, or traffic interception.
- Monthly 90% override or persistent month-end protection (possible future separate policy).
- Replacing the current 09:30/21:30 reports, worldline renderer, or WhatsApp delivery system.
- SSH/firewall/Cloudflare/provider plan changes.
- Claiming that `tc` or IFB alone can stop incoming provider-billed DDoS traffic.
