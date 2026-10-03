---
name: image-upscale
description: Use the native Amadeus image-upscale capability only for an explicit request to enhance an existing image.
user-invocable: false
---

# On-demand image upscaling

This capability is optional. Do not call it for ordinary image generation, and
do not automatically upscale a newly generated image unless the same user
request explicitly asks for both generation and enhancement.

When the user asks to upscale an existing image, call the single native
`amadeus_image_upscale` capability. Prefer the image in the current reply
context; if the user replied to an older image, that replied image wins over a
newer image. If there is no reply target, use the most recent eligible image in
the current conversation only. Never guess from another conversation.

The default scale is `2`. Preserve an explicit `4` request and keep plain 2x/4x
requests at the exact multiplier dimensions. Interpret an explicit `4K`/`2K`
request as the bounded `resolution` profile (`4k` uses a 3840px long-edge cap;
`2k` uses a 2560px long-edge cap) rather than inventing an arbitrary pixel
count. Preserve an explicit `realistic` or `anime` mode;
otherwise use `auto`. Do not mention
internal filesystem paths, service URLs, model names, or cache locations.

On success, return the derived image through the structured attachment result
and keep visible text concise. On failure, report the bounded failure without
claiming that an image was produced. The original image is immutable and the
result is a derived asset with lineage.
