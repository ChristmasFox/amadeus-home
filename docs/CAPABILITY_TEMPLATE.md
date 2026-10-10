# Capability planning template

Use this template before adding or materially changing a capability. Keep the
answers in the capability design/PR notes or the relevant checkpoint; do not
turn this file into a second runtime registry.

## Identity and scope

- Capability name:
- User intents and non-goals:
- Trusted identity/authorization boundary:
- Explicit confirmation required for:
- Owning plugin and Skill:

## Architecture ownership

- Deterministic domain owner:
- Native tool names and input schemas:
- External service/adapter boundary:
- Presentation contract and renderer:
- Evidence references and unknown/null semantics:
- Instant/query-period/display-time semantics:

## Side effects and recovery

- Persistent data and source-of-truth files:
- Secrets and runtime-only configuration:
- Idempotency key/outbox behavior:
- Backup and rollback checkpoint:
- Prohibited channels, fallbacks, or retired paths:

## Validation and acceptance

- Unit/integration/regression tests:
- Architecture fixture/check:
- Typecheck/build commands:
- Secrets scan:
- Runtime smoke and real user-facing acceptance evidence:
- Remaining work recorded in `.agent/tasks/`:

Do not add capability-specific workflow to `SOUL.md` or the global workspace
`AGENTS.md`; do not add a keyword router, a second agent runtime, or a free-form
notification transport path.

## Planning record — Amadeus model-capability adapter (2026-09-27)

This records the answers for `docs/AMADEUS_MODEL_CAPABILITY_ADAPTER_GOAL.md`;
the Goal, Git source, and live runtime remain authoritative, not this template.

- **Identity and scope:** The user may request a new image, or explicitly ask
  for a voice reply from typed text. An admitted WhatsApp/Telegram group member
  may use native `image_generate` without approval; group admission is still
  determined by existing channel policies. Non-owner direct-chat tool access
  and unrelated sensitive/owner-only tools do not expand. Image editing and
  model tiers are out of scope. Mutation tools still require their existing
  owner identity and explicit confirmation; no new confirmation is required
  for a new image.
- **Architecture ownership:** OpenClaw remains the sole Agent and selects the
  native `image_generate` or final tagged TTS capability. The model-neutral
  image-generation and single voice-reply Skills own intent/output rules.
  `infra/9router/model-capabilities.json` and the existing 9Router management
  API own the deterministic ordered image fallback; no new domain state
  machine or transport-specific domain code is needed. Native channel reply
  attachment delivery remains unchanged.
- **Structured result, evidence, unknowns, and time:** The new-image contract
  yields one normal channel image attachment only on success. Failed or
  unavailable backends return their structured failure, not a fabricated
  image. Voice output is Japanese audio plus matching visible Japanese and a
  faithful Chinese summary; an ASR failure remains text-only. No new time
  semantics are introduced. Backend evidence is the Combo state, sanitized
  route logs, and real channel receipts; generated payloads are not Git data.
- **Side effects and recovery:** The only new persistent 9Router state is the
  `amadeus-image` Combo and its per-Combo fallback setting. Provisioning is
  idempotent via the existing protected loopback API client, with an external
  0600 minimal pre-change snapshot and independent restore. OpenClaw changes
  use the existing protected config/image checkpoint and immutable commit-tag
  release workflow. Existing 9Router accounts/OAuth, ASR/TTS aliases, native
  Mac TTS files/process, owner outbox, secrets, and senders remain untouched.
  No new outbox/idempotency key or secret is introduced.
- **Proof gates:** `pnpm test:model-capability-adapter`, affected package
  typecheck/build, architecture checks, `pnpm check:secrets`, pinned OpenClaw
  config validation, normal release tests/build, authenticated 9Router image
  smoke, fallback-path evidence, and real owner/non-owner group plus three-way
  voice acceptance are required. Record protected rollback paths and
  content-safe acceptance in a dated checkpoint; unfinished acceptance belongs
  in `.agent/tasks/` and does not count as Goal completion.
- **Explicit exclusions:** No `SOUL.md` or global `AGENTS.md` workflow, keyword
  router, second Agent/runtime, duplicate image/TTS tool or sender, 9Router
  source patch, ASR/TTS Combo fallback, or notification fallback is introduced.

## Planning record — Kurisu TTS Tuner (2026-09-28)

This records the answers for `docs/AMADEUS_KURISU_TTS_TUNER_GOAL.md`; that Goal,
Git source, and live runtime remain authoritative.

- **Identity and scope:** This is an owner-local operator/developer tool for
  listening experiments against the already accepted Kurisu production voice.
  It owns test text, Lab-only baseline/emotion-instruct overrides, verified
  OminiX sampling/speed controls, controlled PROD/A/B/C comparison, private
  history/drafts and production proposal creation. It does not add a chat
  command, OpenClaw tool, group feature, public endpoint, new voice identity,
  model fallback or model training. Creating a production proposal is allowed
  from the local tuner; changing production still requires an explicit
  repo-owned `--apply` promotion and normal deployment/release authorization.
- **Trusted identity/authorization boundary:** V1 binds the tuner only to the
  M204 loopback interface, with strict Host/Origin, no permissive CORS,
  same-origin static assets and CSRF protection for mutations. The browser does
  not receive the production TTS bearer token, reference audio, x-vector,
  owner target or filesystem paths. Remote/mobile exposure is a later Goal.
- **Architecture ownership:** `apps/qwen3-tts-service` owns the tuner because it
  already owns the native single-model speech runtime. The tuner is a second
  loopback HTTP listener/thread inside that same process, not a second service
  or Agent. It shares the one persistent OminiX worker/model/x-vector. A
  canonical Git-tracked `kurisu_style.json` becomes the deterministic
  production style owner; the Rust worker stops duplicating baseline/emotion
  literals. A repo-owned promotion script is the only bridge from a protected
  runtime proposal to desired Git production state.
- **Structured result/evidence:** The UI/API exposes health, production style
  hash, exact candidate effective config, audio duration, synthesis timing/RTF,
  OminiX timing breakdown where available, and explicit inherited/overridden
  parameter state. Errors/busy/invalid states are shown as such; no fabricated
  audio or guessed defaults. Model/reference identity is read-only. Tuner
  history may keep protected experiment metadata/audio with bounded retention,
  but normal logs must not contain spoken text or free-form instruct text.
- **Real adjustment surface:** The pinned OminiX revision is verified to expose
  `temperature`, `top_k`, `top_p`, `max_new_tokens`, `seed`, `speed_factor`, and
  `repetition_penalty`. The UI publishes only controls actually backed by the
  pinned runtime, plus Lab-only baseline/emotion text and test-text punctuation.
  Language stays Japanese and speaker/model/reference identity are locked. Fake
  pitch/volume/emotion-strength sliders are prohibited unless a later tested
  deterministic mapping is introduced.
- **Scheduling and side effects:** Production synthesis is high priority and Lab
  synthesis is low priority. Lab variants are sequential and yield after every
  sample so a production request cannot sit behind a whole A/B/C batch. The
  current in-flight model call is not forcibly interrupted. Drafts/history and
  generated audio remain outside Git under protected bounded storage.
  Production `/v1/audio/speech` remains bounded and never accepts arbitrary Lab
  instruct/options.
- **Source of truth/promotion/recovery:** Browser `Save Draft` is runtime-only;
  `Create Production Proposal` creates a hash-bound protected proposal. The
  repo-owned promotion command verifies expected production style hash, schema
  and safe parameter policy, then updates only the canonical tracked style
  config under explicit `--apply`. Runtime installation/hot reload follows the
  committed source. Tuner release rollback restores the protected 1.6.6 native
  service checkpoint; style rollback uses Git predecessor/hash and explicit
  promotion, not browser local state. No second resident engine is fallback.
- **Notification/idempotency:** Experiments and draft saves do not notify.
  Real native/candidate/release switches retain the 1.6.6 owner-outbox
  notification guarantee. Successful production style promotion sends one
  content-safe owner event keyed by resulting style hash/change identity.
  There is no new sender or recipient selection path.
- **Proof gates:** Focused Python/Rust/JS tests must prove canonical config
  migration, option mapping/range validation, Lab-only free-form separation,
  output-path safety, production-priority scheduling, stale proposal rejection,
  bounded retention, loopback/CORS/CSRF controls and detailed timing. Runtime
  acceptance must prove one resident model, healthy production :18792, tuner
  only on loopback :18793, controlled STYLE ONLY and SAMPLING experiments, and
  a production request winning between Lab variants. Run `pnpm workflow:plan`,
  `git diff --check`, affected checks and `pnpm check:secrets`. Final release is
  one patch bump to 1.6.7 with protected checkpoint and observed owner release
  notification sent evidence.
- **Explicit exclusions:** No SOUL/global AGENTS workflow, keyword router,
  second Agent/runtime/model worker/frontend process, 9Router/OpenClaw tuner
  route, public tunnel, reference/x-vector editor, ASR/image change, automatic
  TTS fallback, generated media in Git, direct WhatsApp sender, or general Git
  shell authority inside the TTS HTTP process.

## Planning record — single-reference image editing transport (2026-10-01)

- **Intent/identity:** Preserve one explicit image reference on native
  `image_generate`; existing owner/group admission is unchanged. No mask,
  multi-reference parity, or pixel-exact inpainting claim. Reject unsupported
  multi-image input before task admission; never drop references or silently
  turn editing into prompt-only generation.
- **Owners:** Existing Skill owns intent; pinned OpenClaw OpenAI provider overlay
  translates only the operator logical route `openai/amadeus-image` into
  9Router's existing `/images/generations` JSON `image` data-URI contract.
  9Router still owns canonical Combo selection, accounts and fallback. Exact
  0.5.91 Codex adapter accepts `image`/`images`; Antigravity adapter accepts only
  the first reference. No second provider stack, tool, runtime or sender.
- **Contract:** One PNG/JPEG/WebP reference, signature/MIME checked, <=10 MiB;
  same bytes/MIME sent to both Combo attempts. Existing prompt, size, quality,
  background, output format and image response/delivery contract retained.
  Other providers retain native multipart edits. No new time semantics.
- **Side effects/recovery:** Generation remains an existing paid capability;
  no new secrets or persistent reference copies, no URL refetch in the adapter.
  Use existing release backup and immutable-image rollback. Log only route,
  reference count, HTTP status and correlation IDs, never bytes/data URIs.
- **Evidence:** Focused actual outbound-body fixture, exact live 9Router adapter
  and fallback byte-preservation fixture, normal-text/non-target-provider
  regression, secrets/anchor checks, and an explicit-apply synthetic-reference
  live smoke (not private user media). Real owner delivery remains distinct.

## Planning record — VPS subscription accounting & Kurisu traffic reports (2026-10-08)

This records the capability answers for docs/AMADEUS_VPS_SUBSCRIPTION_ACCOUNTING_GOAL.md. The Goal, Git source, and live runtime remain authoritative.

- **Identity and scope:** The capability is owner-only read access to whole-VPS traffic and five subscription identities Labmem001-Labmem005. One subscription identity may be used across several physical devices and across HY2/VLESS. The current production subscription token, HY2 credential, and VLESS UUID remain active throughout this Goal and are represented as a separate legacy identity. Legacy retirement requires a later explicit owner instruction.
- **Architecture ownership:** amadeus-gateway keeps protocol/runtime ownership. Official Hysteria 2 remains the UDP 2053 server; Xray remains the TCP 2053 VLESS/Reality server; Caddy and the existing subscription responder remain the subscription edge. A lightweight VPS SQLite accounting service owns account metadata, loopback HY2 HTTP auth, native protocol counter collection, and a sanitized snapshot. plugins/amadeus extends the existing VPS capability with bounded read-only overview/detail tools; OpenClaw remains the sole planner and scheduler.
- **Structured result and time semantics:** KiwiVM remains the whole-plan quota/progress truth and therefore includes traffic used earlier in the current billing cycle. Per-account usage begins at an explicit accounting start instant T0 and must never claim retroactive attribution. Results carry source freshness, monitoringStartedAt, protocol/account totals, and legacy totals. Reconciliation is uncalibrated/unknown until controlled HY2/VLESS transfers establish the relation between protocol counters and provider billing counters.
- **Secrets and persistent state:** Exactly five generated token/HY2-secret/VLESS-UUID sets are persisted only in a mode-protected VPS SQLite database and rendered into runtime-only subscription files. The existing legacy credentials may be imported into protected runtime state without printing. No token, password, UUID, provider API key, stats secret, filled subscription file, database, or backup enters Git/logs/owner reports.
- **Compatibility strategy:** Hysteria uses loopback HTTP auth rather than a direct password->userpass cutover so an existing client that sends only the current password continues to authenticate; the backend maps that credential to legacy-hy2 and new secrets to Labmem IDs. Xray keeps the legacy VLESS client and adds five tagged clients with user stats. Existing subscription URLs/directories remain valid.
- **Notification/delivery:** Scheduled morning/evening reports reuse OpenClaw scheduling, the VPS Skill, amadeus_notify_owner, and the fixed WhatsApp owner outbox. Initial target times are 09:00 and 21:00 Asia/Shanghai unless equivalent production jobs already exist. There is no second sender or group delivery path.
- **Recovery and mutation boundary:** Runtime apply requires protected Hysteria/Xray/Caddy/subscription checkpoints and staged old-client smoke after each switch. Any regression restores the exact pre-change protocol config. No rollback or completion step is allowed to delete/revoke legacy credentials. Automatic blocking, tc/TrafficCop, destination logging, Grafana/Prometheus/ntopng, and public admin UI are outside this Goal.
- **Proof gates:** Focused Python/TypeScript tests, affected typecheck/build, git diff --check, pnpm check:secrets, Hysteria/Xray/Caddy validation, controlled per-account HY2/VLESS traffic tests, provider reconciliation calibration, old-client compatibility, five new token link smokes, OpenClaw query smokes, and one real owner WhatsApp report are required before completion.

## Planning record — VPS daily traffic fuse & themed Kurisu alerts (2026-10-10)

This records the required capability decisions for `docs/AMADEUS_VPS_DAILY_TRAFFIC_FUSE_GOAL.md` (planning only).

- **Intent / identity:** Protect the operator-owned whole VPS on each Shanghai-local calendar day. Thresholds are 40 GB for one warning and 50 GB for automatic shared 2 Mbps business-egress shaping until next 00:00. The policy affects six active proxy identities together; it does not authenticate new users or re-enable retired Legacy. Query is owner-only; chat users cannot invoke arbitrary privileged network actions.
- **Deterministic owner:** VPS local meter/controller holds the daily SQLite state, WAN NIC fast samples, provider counter provenance, kernel `tc` apply/status/release, and a separate midnight systemd release timer. Accounting/SQLite remains the provider/traffic fact source; privileged `CAP_NET_ADMIN` helper is fixed and narrowly scoped. No LLM or sender executes `tc`.
- **Structured facts:** Day key, boundary/freshness/coverage, provider-confirmed and calibrated WAN metrics, threshold bytes, state, verified rate/kernel state, triggeredAt, nextRecoveryAt, operation errors, and source generation are explicit. Unknown, partial and stale data cannot become fabricated exact daily usage. A 2 Mbps egress shaper is not a provider-side DDoS ingress cap.
- **Notification:** Persist sanitized durable event keys for warning/engaged/released/failure, with retries and de-duplication. A bounded deterministic Amadeus worker adapts events with the **existing** `worldline_notification_intent` contract and `adaptWorldlineNotification`, then uses the canonical `OwnerNotifier` WhatsApp outbox. Kind `status_changed`/`network_degraded` yields 世界线偏移; `source_recovered` with success yields 世界线收束; scheduled reports use D-Mail. The renderer owns character/style/closing; no second sender or new persona text.
- **Safety / recovery:** Maintain SSH management reachability, never overwrite a foreign root qdisc, checkpoint/verify active `tc` state, arm timed rescue, and release only fuse-owned rules. A reported cap/release must match actual kernel verification. Existing six tokens/proxy secrets, REALITY fallback hardening, HY2 security, scheduled report job IDs and Legacy retirement remain unchanged.
- **Proof:** Fake-clock day/midnight tests, provider reset and source-staleness tests, NIC counter rollover, simulated high-speed trigger, isolated 2 Mbps aggregate-shaping proof, existing-qdisc preservation, SSH/reboot/rescue, outbox retry/idempotence, themed WhatsApp proof, focused test/typecheck, secrets scan and protected runtime checkpoint. Phase 0/1 are source-only; actual runtime apply requires explicit owner authorization.
