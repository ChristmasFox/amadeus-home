# 9Router Amadeus speech bridges

The staged TTS bridge listens on container loopback `127.0.0.1:20130` and
preserves the single logical `amadeus-tts` connection and model alias. A
normal/default request attempts the authenticated Mac-local Qwen3-TTS MLX
service at `host.docker.internal:18794` first. Operational local failures may
fall through to Qwen Audio 3.1, then Qwen Audio 3.0. Explicit non-default styles
skip local MLX and use the cloud instruction-capable path. Local configuration,
authentication, and contract errors fail closed. No GPT-SoVITS or OminiX
provider remains in the bridge.

Bridge health reports `localProvider=qwen3-tts-mlx`,
`localModel=Qwen3-TTS-12Hz-1.7B-Base-8bit`, and the deterministic fallback
order. Logs contain bounded provider/category/timing/size facts only; text,
audio, authorization values, API keys, and model-bound voice IDs are not logged.
The bridge reads protected 9Router secret files and does not own cloud
credentials.
