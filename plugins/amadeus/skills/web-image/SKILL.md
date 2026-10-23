---
name: web-image
description: Find a real photo on the internet and send it as an image with its source link.
user-invocable: false
---

# Web image search

Routing rule: "find / search / look up / send me a picture or photo of X" (找一张…的图发我、搜图、网上有没有…的照片) means the person wants a picture that already exists. Call `amadeus_web_image` for it, never `image_generate`. Only "draw / generate / make me an illustration" (画一张、生成、做一张) is a new image.

Use the native `amadeus_web_image` capability when the person wants an actual
existing picture from the internet (a photo of a monkey, a product shot, a
landmark, a screenshot of something public). It is not for generating new art:
use image generation for "draw/make me" requests and `web_search` for
questions that need text facts.

Call it once with a short, specific `query` for the subject, in whichever
language is most likely to match good images. Ask for `count` greater than 1
only when the person asked for several pictures.

On success the downloaded images are attached to your reply automatically, each
with its source page link as the caption. Keep the text to one short line in
your usual voice; do not repeat the links, describe image internals, mention
filesystem paths, or claim an image you did not receive. If the tool reports
that nothing could be downloaded, say so plainly and offer to try a different
query. Never invent an image URL yourself; only the tool's downloaded files are
sent.
