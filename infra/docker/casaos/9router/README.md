# 9Router Amadeus speech bridges

The staged TTS bridge listens on container loopback `127.0.0.1:20130` and
preserves the single logical `amadeus-tts` connection and model alias. Every
valid request, including the Kurisu emotions (`irritated`, `embarrassed`,
`angry`, `sarcastic`, `soft`, `sad`), tries the authenticated Mac-local Fish
Audio S2 Pro service at `host.docker.internal:18794` first; the local service
turns the emotion into a Fish tag and sanitizes inline `[tags]` in the text.
Operational local failures fall through to Qwen Audio 3.1, then Qwen Audio 3.0;
there the emotion becomes the cloud `instruction` and inline tags are stripped
so the cloud voice never reads them. Local configuration, authentication, and
contract errors fail closed. `AMADEUS_TTS_EMOTIONS_ENABLED=false` restores the
old default-only policy.

Bridge health reports `emotionControlsEnabled=true`, `localProvider=fish-s2-pro-mlx`,
`localModel=Fish-Audio-S2-Pro-8bit`, and the deterministic fallback
order. Logs contain bounded provider/category/timing/size facts only; text,
audio, authorization values, API keys, and model-bound voice IDs are not logged.
The bridge reads protected 9Router secret files and does not own cloud
credentials.

## Gate-Local runtime

`docker-compose.gate-local.yml` is the source definition for the Gate Router
container `pubg-saas-9router`. Install that file as
`/srv/pubg-saas-9router/docker-compose.yml` on `pubg-saas-m2-clean`; keep the
existing protected `9router.env`, `data/`, and individual `secrets/` files in
that directory. Its only network is the external
`pubg-saas-public_egress_internal` network, with HTTP(S) proxy variables set to
`egress-proxy:8080`. It publishes no host ports. The main API and the ASR/TTS
bridge health endpoints are checked from inside the container.

The untracked `/srv/pubg-saas-9router/.env` stores the full source revision as
`NINE_ROUTER_SOURCE_SHA`; Compose forms the immutable image tag
`local/9router-saas:git-<full-sha>`. Build with that same SHA passed as
`--build-arg SOURCE_SHA`, and use Compose project name `9router` so the existing
Gate hostname and state remain stable. The Dockerfile pins upstream 0.5.104 by
digest, applies all five local patches, and retains the ASR/TTS bridges and
launcher. The application env file is
`9router.env`; it stays separate from the non-secret Compose interpolation file.
