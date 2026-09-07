# Product Radar V0.2 image similarity checkpoint — 2026-09-07

## Implementation

- Similarity Watch is a generic Watch type, independent of Bunjang and chat platform concepts.
- `ImageMatcher` is a core port; the current implementation is a deterministic `sharp`-based perceptual feature matcher.
- Bunjang supplies a public keyword-feed candidate source. Default query is Korean `의류`, capped at 60 candidates per run.
- LangBot extracts Telegram `Image.base64`/URL attachments and creates a similarity proposal. Default threshold is 0.60 and default interval is 120 seconds.
- Reference features are persisted under the Product Radar `/data` volume. The stored Watch target contains `referenceImageId`, not the temporary image URL or base64 payload.

## Deployed verification

- Image: `local/product-radar:git-298f8ee28072`.
- Product Radar and changedetection containers healthy.
- Product Radar `/health`: HTTP 200.
- Product similarity preview: HTTP 200; reference product `424506121`; Bunjang `의류` candidate count 54; no candidate reached 0.60.
- Test Watch `v02-smoke-20260907`: created HTTP 201 with baseline count 54, interval 120 seconds, and zero baseline notifications.
- changedetection Sensor Watch: `time_between_check.seconds=120`, JSON webhook body contained both Radar and Sensor identifiers.
- Product Radar webhook: HTTP 202; successful refetch, one newly seen candidate, zero matches/events/notifications.
- Test Watch paused successfully (`enabled=false`, sensor `paused=true`) and then deleted successfully.
- Final state retains the pre-existing user Product Watch only; no test platform notification was sent.

## Known boundary

V0.2 is a perceptual visual baseline, not a semantic CLIP/SigLIP model and not a full-marketplace crawl. Threshold calibration and a live Telegram image acceptance test remain future work. No login, CAPTCHA bypass, proxy pool, or large-scale scraping was added.
