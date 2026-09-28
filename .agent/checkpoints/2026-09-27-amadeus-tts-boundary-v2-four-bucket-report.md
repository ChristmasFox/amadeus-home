# Amadeus TTS Boundary V2 — Four-Bucket Report Checkpoint

Date: 2026-09-27 local. Goal `docs/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_GOAL.md` is paused at the owner's request for only the 25/50/100/150 report. This checkpoint records a report from an already stopped run; it does not authorize further synthesis.

## Evidence

- Protected source root: `/Volumes/Avalon/backups/operation-skuld/qwen3-tts/boundary-rebaseline-v2-safe-25-200-2026-09` (private root/evidence).
- Matrix stopped at the owner's request after 99 persisted client rows. Buckets 25, 50, 100, and 150 each have 20/20 successful rows (10 A + 10 B). Bucket 200 has 19/19 persisted rows and remains incomplete; an A-200 service success without durable client timing is excluded. No synthesis was submitted after stop.
- Verified representative MP3/text/metadata pairs for 25/50/100/150 remain outside Git; the listening index and metadata hashes were validated before extraction.
- The filtered report and JSON contain only the four requested buckets: `docs/reports/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_25_50_100_150_2026_09.md` and `docs/reports/data/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_25_50_100_150_2026_09.json`.
- Production TTS configuration remained unchanged; no restart or deployment occurred. No output-length recommendation is made.
- The separate V2 primary run's B-250 110-second watchdog boundary remains intact. This extract does not complete the broader 25–600 Goal.

The full Goal is paused/incomplete; future work must explicitly resume it and preserve all prior roots.
