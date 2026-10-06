# Current Task — Wild Krea-2 Turbo NSFW local image fallback

Date: 2026-10-06 (Asia/Shanghai).

Active Goal: `docs/AMADEUS_KREA2_NSFW_LOCAL_FALLBACK_GOAL.md`.

Objective:

- keep `cx/gpt-image-2.5` as the primary image backend;
- deploy `ModdiAdam/Wild_Krea-2-turbo_NSFW` using `Wild_Krea-2-turbo_NSFW-Q4_1.gguf` on the Mac mini 24GB through a pinned `stable-diffusion.cpp` Metal runtime;
- use the local Krea2 backend as the only image fallback after acceptance;
- remove `ag/gemini-3.1-flash-image` from active image desired state;
- extend the image-specific generation deadline to support real local fallback latency;
- preserve the Amadeus 1.8.4 `image_generate -> Asset Registry -> native task_completion -> Completion Agent -> one WhatsApp image+caption` lifecycle.

Important compatibility gate: the Wild Krea model card and upstream `stable-diffusion.cpp` Krea2 documentation describe different VAE/component pairings. The exact transformer + Qwen3-VL 4B + VAE combination must be proven by direct local smoke before any production route switch.

Reference-image requests must not silently degrade to prompt-only generation. Until a real local edit path is proven, a failed GPT Image reference request must terminate cleanly rather than use the text-to-image Krea fallback incorrectly.

Current live release is **Amadeus 1.9.5** (`VERSION=1.9.5`). The Krea2 source
changes are deployed in a candidate OpenClaw image and the active 9Router image
Combo has one primary (`cx/gpt-image-2.5`); the local fallback is owned by the
OpenClaw provider boundary because stock 9Router 0.5.91 cannot dispatch a
dynamic image backend. The candidate deployment and protected rollback evidence
are recorded in
`.agent/checkpoints/2026-10-06-amadeus-krea2-local-fallback-candidate.md`.

Status: `CANDIDATE_DEPLOYED_AWAITING_REAL_WHATSAPP_FALLBACK_ACCEPTANCE`.
