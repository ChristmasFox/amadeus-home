---
name: image-generation
description: Use the native image-generation capability when the user's intended deliverable is a newly created image or illustration.
user-invocable: false
---

# New image generation

Interpret the request semantically: when the user wants to receive a newly created image or illustration, call the native `image_generate` capability. Do not rely on fixed trigger phrases, keyword lists, or user knowledge of tool names.

Use the user's description as the generation prompt. If the user asks only for prompt-writing advice, answer with text instead. Do not substitute third-party tool suggestions for an image-generation request.

Let the canonical OpenClaw image-model configuration choose the provider and model; do not specify a provider/model in the tool call or route by style, speed, subject, or other prompt content. This Skill covers new image generation only.

Wait for the tool result. Claim completion only when the generation succeeds and the channel reply path returns the image attachment. Keep visible text concise and never expose base64, raw tool payloads, credentials, or internal service addresses.
