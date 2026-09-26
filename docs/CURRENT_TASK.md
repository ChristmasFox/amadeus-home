# Current Task — Stable Amadeus 1.6.0

Date: 2026-09-26. No active product/engineering Goal. The Post-Voice engineering and TTS performance Goal is complete **as explicitly amended by the owner** in §12: no further B reference testing. Four B matrix cells remain honestly safety-incomplete in the report; do not resume that experiment or claim five successful runs.

- Canonical `main` and 1.6.0 source are pushed. The single live OpenClaw/Kurisu agent and A+MLX/Auto native TTS service are healthy. Owner accepted post-release WhatsApp Japanese voice/visible text/typed isolation and explicitly confirmed no pronunciation, naturalness, volume or rhythm anomaly.
- Performance/quality/memory/rollback evidence: `docs/reports/AMADEUS_TTS_PERFORMANCE_2026_09.md`, its numeric JSON, and `.agent/checkpoints/2026-09-26-*`. Short fixed-phrase MLX HTTP 20-run p50 3.30s/p95 3.52s; real turns are not a p95.
- Routine operational watch, not a pending Goal gate: MLX peak footprint 18.4 GiB and transient swap growth on 24 GiB Mac. Retain protected A/MPS and CasaOS checkpoints; rollback if real quality, health or memory pressure regresses. Optional media adapter absence and daemon log-policy warning remain known.

2026-09-26 evening operational repair: `claw.nyannyan.top` root had OpenClaw `proxy_attribution_required` 403 after Docker bridge changed from `172.24.0.1` to `172.20.0.1`. The narrow `gateway.trustedProxies` update is applied to live config and Git example; public root and `/healthz` both return 200, TLS valid, container healthy. The token gate still applies to authenticated Control UI connections. See `.agent/checkpoints/2026-09-26-claw-proxy-attribution-recovery.md` for backup/rollback.

New work needs an explicit task/Goal and the minimum sufficient verification. Do not revive retired runtimes, add Voice features, change the accepted A profile or rerun B without a new owner request.
