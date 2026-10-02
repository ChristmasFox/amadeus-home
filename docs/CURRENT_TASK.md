# Current Task — Amadeus native image completion caption

Date: 2026-10-02 (Asia/Shanghai).

Active Goal: none. `docs/AMADEUS_NATIVE_IMAGE_COMPLETION_CAPTION_GOAL.md` is
complete.

Current live release: **Amadeus 1.8.4** (`VERSION=1.8.4`). The immutable
OpenClaw image is
`local/openclaw-amadeus:git-808678cdc952-20261002085415` with image ID
`sha256:dc4c9461f1e1ce06db75bba2dab51bf65802bac39bce764f6f88f909580d545a`.
CasaOS host `nyannyan` is healthy, Gateway registration passed, Product Radar
is healthy, and post-deploy maintenance passed.

The real WhatsApp acceptance task generated one image and produced
`image_completion_caption_ready` with `caption_source=native_completion`.
The typed delivery record contains one `image` provider primitive and no
separate completion text send. The Completion Agent returned one DeliveryEnvelope
v2 text part describing the actual generated image. The 1.8.4 follow-up removes
the artificial caption length ceiling and short-caption instruction; Kurisu
chooses the natural wording and length while protocol safety checks remain.

Release checkpoint/evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.4-unrestricted-kurisu-caption.md`.

Status: `COMPLETE`.
