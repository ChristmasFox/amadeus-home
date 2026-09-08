# Product Radar image + user-text timeout hotfix checkpoint — 2026-09-08

## Symptom

User flow with one image and `帮我盯着这件羽绒服` returned `Product Radar unavailable: TimeoutError`.

## Root cause

Bunjang SearchPlan queries were fetched serially; reference image preparation and Sharp preview scoring happened after search; LangBot plugin HTTP client timeout was 20 seconds. A slow/empty broad query could make the complete preview exceed the plugin timeout even though Product Radar eventually returned partial results.

## Fix

- Preview SearchPlan queries execute concurrently with `Promise.allSettled`.
- Reference feature preparation starts in parallel with search.
- Preview Sharp scoring is bounded to 12 candidates; long-term Feed discovery and Watch matching remain unchanged.
- LangBot Product Radar HTTP client default timeout is 90 seconds and configurable through `PRODUCT_RADAR_HTTP_TIMEOUT_SECONDS` / plugin config.

## Verification

- Runtime image: `local/product-radar:git-49725f014c47`, digest `sha256:77d54cfcd93baf4e728a44ba1dac85742c87b29c0b54e9ea64ccca0c5ed56c53`.
- LangBot plugin task `51`: `INSTALL_READY`; package includes the 90-second client timeout.
- Real public Bunjang down-jacket image `363252234` + `帮我盯着这件羽绒服`: preview HTTP 200 in 18.41s, baseline 49, partial warning only for the unavailable `羽绒服` query, no TimeoutError.
- Temporary end-to-end Watch create: HTTP 201, interval 900s, baseline 494, baseline notifications 0; deleted after smoke.
- Final state: only the pre-existing Product Watch remains; SearchFeed count 0; Product Radar and changedetection healthy.

## Commits

- `169c601` — avoid visual preview timeout on slow search feeds.
- `49725f0` — parallelize and cap similarity preview scoring.
