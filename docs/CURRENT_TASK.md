# Current Task — Amadeus native image completion caption

Date: 2026-10-02 (Asia/Shanghai).

Active Goal: none. `docs/AMADEUS_NATIVE_IMAGE_COMPLETION_CAPTION_GOAL.md` is
complete.

Current live release: **Amadeus 1.8.3** (`VERSION=1.8.3`). The immutable
OpenClaw image is
`local/openclaw-amadeus:git-6bde9f91e5f7-20261002081707` with image ID
`sha256:c05ec704c628bb9a735c07426450735b078aeff947447fb4289505e23d478a7b`.
CasaOS host `nyannyan` is healthy, Gateway registration passed, Product Radar
is healthy, and post-deploy maintenance passed.

The real WhatsApp acceptance task generated one image and produced
`image_completion_caption_ready` with `caption_source=native_completion`.
The typed delivery record contains one `image` provider primitive and no
separate completion text send. The Completion Agent returned one DeliveryEnvelope
v2 text part describing the actual generated image.

Release checkpoint/evidence:
`.agent/checkpoints/2026-10-02-amadeus-1.8.3-native-image-completion-caption-release.md`.

Status: `COMPLETE`.
