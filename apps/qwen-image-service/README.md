# Qwen Image Service

This Mac-only service is the authenticated local boundary for Qwen-Image-2.1
generation and single-reference edits. It proxies only the two OpenAI image
endpoints, binds both bridge and `sd-server` to loopback, validates pinned
asset/runtime hashes before listening, permits one running generation plus
one bounded waiter, and shuts down the Metal model after three idle minutes.

The model and runtime files remain under `/Volumes/Avalon/models` and are not
stored in Git. Their pinned repository revisions, byte counts and SHA-256
values live in `infra/macos/qwen-image-engine.json` and the active Goal.

Run `infra/macos/manage-qwen-image.sh --dry-run` to inspect the intended local
setup. All LaunchAgent mutations require `--apply`; start and restart also
require the `Amadeus-M204` host. The manager refuses to start while the Krea
LaunchAgent is loaded. Uninstall preserves model files and the Qwen token.

The bridge applies the measured 16-step/CFG-6 setup and a 600-second image
request deadline. Edits default to strength 0.9, retain the exact uploaded
reference bytes and MIME type, and derive safe 32-pixel-aligned canvas geometry
from the reference rather than imposing a portrait default.
