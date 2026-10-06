# Amadeus Krea2 local fallback candidate — 2026-10-06

Status: candidate deployed; real WhatsApp forced-fallback acceptance remains open.

## Source and runtime

- Wild repository revision: `0ab4fdb1f0b72f2acb31a9d4281ec7544843c606`
- `Wild_Krea-2-turbo_NSFW-Q4_1.gguf`: 8017614144 bytes,
  `ada3127ed4b784b47a1bd0f45d370515520394181009a3d430a6389c9260c3c8`
- Qwen3-VL-4B Q4_K_M revision:
  `1cd86afb9a95c410a6038ab3b40d8b578c892266`, 2497281664 bytes,
  `66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a`
- Wan2.1 VAE revision:
  `123acf1cc74bccbb9bfff8ac1ee72edc08c2341d`, 253815318 bytes,
  `2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b`
- stable-diffusion.cpp Metal commit:
  `3f8527a46c54ecf4cb4ed6003da8e8982283c73c`

The exact transformer + Qwen3-VL + Wan2.1 VAE combination passed direct
1024x1024 generation. The local service and bridge use Metal, eight validated
Turbo steps, CFG 0, concurrency 1, queue capacity 1, and a 600000 ms deadline.

## Deployment evidence

- Candidate OpenClaw image:
  `local/openclaw-amadeus:git-2290e8926b70-20261006100001`
- Candidate 9Router image:
  `local/9router:git-2290e8926b70-20261006T095859Z`
- Krea bridge health: `ready`, loopback-only, authenticated, reference edits
  disabled.
- Primary smoke: passed through live 9Router, PNG, 818180 bytes, first backend
  `cx/gpt-image-2.5` succeeded.
- Protected rollback checkpoint:
  `/Volumes/Avalon/backups/operation-skuld/amadeus-model-capability/amadeus-image-preapply-20261006T095850Z-70815.json`
- Deployment checkpoints:
  `/DATA/AppData/9router/backups/router-upgrade-20261006T095859Z` and
  `/DATA/AppData/openclaw/backups/amadeus-openclaw-20261006100422`

## Acceptance boundary

Synthetic primary 503 runs proved the local fallback HTTP response and one
Asset Registry claim. A real owner WhatsApp reference-image request reached the
active lifecycle but the Codex primary returned 502 for entitlement; the local
text-to-image fallback correctly did not run for that reference request. One
real owner WhatsApp text-to-image request with a deliberately unavailable
primary is still required to prove the final image bubble, natural caption,
native task completion, and exactly one image primitive. Until that evidence is
recorded, this candidate must not be version-bumped or marked complete.

Focused source tests and `pnpm check:secrets` passed before this checkpoint;
the complete release test gate remains for the final release after acceptance.
