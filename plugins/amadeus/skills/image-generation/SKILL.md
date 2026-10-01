---
name: image-generation
description: Use the native image-generation capability when the user's intended deliverable is a newly created image or illustration.
user-invocable: false
---

# New image generation

Interpret the request semantically: when the user wants to receive a newly created image or illustration, call the native `image_generate` capability. Do not rely on fixed trigger phrases, keyword lists, or user knowledge of tool names.

Use the current user's description as the generation prompt. Make at most one `image_generate` call for one current user request. If the user asks only for prompt-writing advice or asks a follow-up question about a prior generation/failure, answer that request with text instead. Do not substitute third-party tool suggestions for an image-generation request.

Let the canonical OpenClaw image-model configuration choose the provider and model; do not specify a provider/model in the tool call or route by style, speed, subject, or other prompt content. This Skill covers new image generation only.

Wait for the tool result. Claim completion only when the generation succeeds and the channel reply path returns the image attachment. Keep visible text concise and never expose base64, raw tool payloads, credentials, or internal service addresses.

When native `image_generate` returns an accepted detached/background task without a generated attachment, the typed image-generation lifecycle coordinator sends the task-start notification to the original requester. Do not echo a second start/“please wait” text in the ordinary final Agent reply, and do not claim the image is already complete. Return a silent DeliveryEnvelope for that accepted interim turn; the later typed success/failure lifecycle owns the corresponding user-visible image or failure result. Never infer this lifecycle from started-receipt prose.

A lifecycle start/failure notification, quoted earlier status, or previous image prompt is not by itself a new image request. Do not automatically repeat `image_generate` after an accepted task, a generation failure, or while answering “what happened/why” about that task. Only make another generation call when the current user request semantically asks for a new image or an explicit new attempt. If the user asks about the failure, explain it in the current user language instead of launching another task.
