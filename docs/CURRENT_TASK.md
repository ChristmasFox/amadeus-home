# Current Task — Stable Amadeus 1.6.0

Date: 2026-09-26. No active product/engineering Goal. The Post-Voice engineering and TTS performance Goal is complete **as explicitly amended by the owner** in §12: no further B reference testing. Four B matrix cells remain honestly safety-incomplete in the report; do not resume that experiment or claim five successful runs.

- Canonical `main` and 1.6.0 source are pushed. The single live OpenClaw/Kurisu agent and A+MLX/Auto native TTS service are healthy. Owner accepted post-release WhatsApp Japanese voice/visible text/typed isolation and explicitly confirmed no pronunciation, naturalness, volume or rhythm anomaly.
- Performance/quality/memory/rollback evidence: `docs/reports/AMADEUS_TTS_PERFORMANCE_2026_09.md`, its numeric JSON, and `.agent/checkpoints/2026-09-26-*`. Short fixed-phrase MLX HTTP 20-run p50 3.30s/p95 3.52s; real turns are not a p95.
- Routine operational watch, not a pending Goal gate: MLX peak footprint 18.4 GiB and transient swap growth on 24 GiB Mac. Retain protected A/MPS and CasaOS checkpoints; rollback if real quality, health or memory pressure regresses. Optional media adapter absence and daemon log-policy warning remain known.

New work needs an explicit task/Goal and the minimum sufficient verification. Do not revive retired runtimes, add Voice features, change the accepted A profile or rerun B without a new owner request.
