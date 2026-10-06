# Current Task — Qwen-Image-2.1 Uncensored edit-first local fallback

Date: 2026-10-06 (Asia/Shanghai).

Active Goal: `docs/AMADEUS_QWEN_IMAGE_2_1_UNCENSORED_EDIT_FALLBACK_GOAL.md`.

Superseded Goal: `docs/AMADEUS_KREA2_NSFW_LOCAL_FALLBACK_GOAL.md`.

## Objective

- keep `cx/gpt-image-2.5` as the primary image backend;
- keep 9Router's active image Combo primary-only;
- replace the paused Krea2 local fallback with `abenzerps/Qwen-Image-2.1-Uncensored-GGUF` using `qwen-image-2.1-UC-Q4_K_M.gguf`;
- make single-reference image editing the P0 local fallback capability;
- use Qwen3-VL-8B GGUF + verified mmproj/`--llm_vision` + `qwen_image_2.1_vae_bf16.safetensors`;
- route eligible failed reference edits to the protected local `/v1/images/edits` path without dropping the reference image;
- preserve the existing Asset Registry -> native task_completion -> Completion Agent -> exactly one WhatsApp image+caption lifecycle;
- keep Gemini image generation absent;
- retire active Krea service/env/token/source plumbing only after Qwen candidate acceptance.

## Current live baseline

Current live release is **Amadeus 1.9.5** (`VERSION=1.9.5`).

The previous Krea2 candidate exceeded the 600-second local image deadline and was paused by the operator. Runtime was restored to the pre-candidate OpenClaw/9Router checkpoints. The normal 9Router/GPT image route is active, WhatsApp is healthy, the local Krea bridge is stopped, and `infra/9router/model-capabilities.json` currently contains only `cx/gpt-image-2.5`.

The Krea candidate and rollback evidence remain historical:

```text
.agent/checkpoints/2026-10-06-amadeus-krea2-local-fallback-candidate.md
.agent/checkpoints/2026-10-06-amadeus-krea2-local-fallback-paused.md
```

## P0 acceptance boundary

A prompt-only local generation is not sufficient.

The new Goal must prove a real WhatsApp **single-reference edit** where:

```text
GPT Image primary -> eligible operational failure
Qwen-Image-2.1 Uncensored local fallback -> /v1/images/edits
reference bytes preserved -> edited image returned
Asset Registry -> Completion Agent
exactly one WhatsApp image + natural Kurisu caption
```

Safety/policy refusals remain terminal and must not trigger the uncensored local fallback.

Status: `PLANNED_NOT_APPLIED`.
