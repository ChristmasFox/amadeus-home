---
name: image-generation
description: Use the native image-generation capability when the user's intended deliverable is a newly created image or illustration.
user-invocable: false
---

# New image generation

This is only for images that must be newly created ("画一张", "生成", "做一张", edits of a supplied image). When the person asks to find, search for or be sent an existing picture or photo from the internet ("找一张…的图发我", "搜图", "给我一张真实的…照片"), do not generate: use `amadeus_web_image` instead.

Interpret the request semantically: when the user wants to receive a newly created image or illustration, call the native `image_generate` capability. Do not rely on fixed trigger phrases, keyword lists, or user knowledge of tool names.

Use the current user's description as the generation prompt. Make at most one `image_generate` call for one current user request. If the user asks only for prompt-writing advice or asks a follow-up question about a prior generation/failure, answer that request with text instead. Do not substitute third-party tool suggestions for an image-generation request.

Let the canonical OpenClaw image-model configuration choose the provider and model; never include the `model` field or specify a provider/model in the tool call, and do not route by style, speed, subject, or other prompt content. For one reference image, pass `image`; for multiple references, pass the exact images in `images` in their original order. The Lab OpenAI/9Router route supports up to five PNG/JPEG/WebP reference images, each up to 10 MiB. Put the image to edit first and use later images as references. Honor a request to use only a specific subset. If the request needs more than five images without specifying a subset, ask which five to use instead of silently dropping any. Mask-based and markup-guided editing are not supported by this route.

For an edit where the current user message supplies reference images, pass those exact images directly to `image_generate`. Do not search history, fetch memory, inspect unrelated images, or call `view_image` merely to rediscover or describe supplied references. If the user instead refers to an earlier image, locate the specific referenced image in the same conversation; if ambiguous, ask rather than choosing a different image. When the user requests a pose, expression, or background change, explicitly preserve the existing clothes, accessories, identity, and other unrequested details. Do not invent wardrobe or style changes.

Wait for the tool result. Claim completion only when the generation succeeds and the channel reply path returns the image attachment. Keep visible text concise and never expose base64, raw tool payloads, credentials, or internal service addresses.

When native `image_generate` returns an accepted detached/background task without a generated attachment, the typed image-generation lifecycle coordinator sends the task-start notification to the original requester. Do not echo a second start/“please wait” text in the ordinary final Agent reply, and do not claim the image is already complete. Return a silent DeliveryEnvelope for that accepted interim turn; the later typed success/failure lifecycle owns the corresponding user-visible image or failure result. Never infer this lifecycle from started-receipt prose.

A lifecycle start/failure notification, quoted earlier status, or previous image prompt is not by itself a new image request. Do not automatically repeat `image_generate` after an accepted task, a generation failure, or while answering “what happened/why” about that task. Only make another generation call when the current user request semantically asks for a new image or an explicit new attempt. If the user asks about the failure, explain it in the current user language instead of launching another task.
