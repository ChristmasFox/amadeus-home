# Amadeus Kurisu GPT-SoVITS PoC checkpoint

- Date: 2026-09-29 (Asia/Shanghai)
- Status: `WAITING_FOR_OWNER_LISTENING`
- Source commit at PoC start: `ea3ec283e3cd71646698430416c9562c942a7b33`
- Active Goal: `docs/AMADEUS_KURISU_GPT_SOVITS_POC_GOAL.md`

## Isolated candidate

- Candidate: `bysq/TTS-KurisuMakise`, upstream revision `8bbdc59cb265a95013ed03ce5404d18d73b5f0e7`, GPT-SoVITS `v2Pro`.
- GPT checkpoint SHA-256: `43b33267a84853056ab1df047d747b6e2c774ca10e4d95809d05c1fe7540d478`.
- SoVITS checkpoint SHA-256: `6d97085ec9373dacf0aa6a35656e264466cbc31bc891dbb51e6e585c9093a21c`.
- Selected neutral reference SHA-256: `c1716641a34991e728b8f2ac01de7a5ed59c5ed978745c7935f934310f6110ef`.
- MPS model load passed in `2.219s`; no launchd entry or boot auto-start was created.
- Temporary API is loopback-only at `127.0.0.1:19870`, running as the owner account in a foreground PTY session.

## Synthesis evidence

- First Japanese neutral sample passed: external evidence `/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-poc-20260929/phase4/gpt-sovits-neutral-001.json` and corresponding WAV.
- Controlled 8-line Qwen 3.1 vs GPT-SoVITS A/B report: `/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-poc-20260929/phase5/ab-report.json`.
- A/B raw and loudness-normalized files remain outside Git under the same `phase5` directory; the report records the Qwen model as `qwen-audio-3.1-tts-flash`, emotion `default`, and instruction absent.
- Warm benchmark evidence: `/Volumes/Avalon/backups/operation-skuld/kurisu-gpt-sovits-poc-20260929/phase6/warm-benchmark.json`; five requests returned HTTP 200, warm RTF was `0.432–0.552`, and API RSS samples were approximately `1.67–1.77 GiB`.
- Host memory free percentage changed from `51%` before the warm sequence to `32%` afterward; this is viability evidence, not an acceptance verdict.

## Production invariants

- Existing production LaunchAgent `com.amadeus.qwen3-tts` remained running with PID `18387`, engine `ominix`, release `1.7.2`, production port `18792`, and tuner port `18793`.
- Production health remained HTTP 200 with `model=qwen3-tts-1.7b` and `voice=kurisu-v1`.
- Production file hashes still match the Phase 0 baseline: `service.py` `b7c95860801ba0ba0847ad872fba1fce6e1df315edd52d0cf30b09f8217da9c3`, `infra/macos/qwen3-tts-engine.json` `18c43f713421f2592ec5c4048c0ec072abf213cf934dbc51e179f72899886daf`, and `kurisu_style.json` `f3dfbc44619a5ab206e508a8b9ac5afffaf8045e3d87632817143cb0e3048b53`.
- Rollback scope is limited to stopping the temporary PoC process and leaving its external runtime directory; do not stop production TTS or delete shared caches.

## Gate

The PoC is not complete and must not be integrated into `amadeus-tts` yet. The next action is owner listening of the paired normalized files, followed by an explicit character-identity verdict. Only a clear Kurisu win authorizes a separate MLX/OminiX compatibility follow-up.
