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

Current live release remains **Amadeus 1.8.4** (`VERSION=1.8.4`) until this Goal performs an explicit release. Existing release evidence remains:
`.agent/checkpoints/2026-10-02-amadeus-1.8.4-unrestricted-kurisu-caption.md`.

Status: `PLANNED_NOT_APPLIED`.
