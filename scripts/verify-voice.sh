#!/usr/bin/env bash
# Offline, no model download, MPS, Docker, or CasaOS mutation.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m unittest discover -s apps/qwen3-tts-service/tests
python3 -m py_compile apps/qwen3-tts-service/service.py
pnpm --filter @agent/amadeus-plugin exec tsx --test tests/voice-reply-prompt.test.ts tests/manifest.test.ts
pnpm --filter @agent/amadeus-plugin typecheck
pnpm verify:openclaw-patch
git diff --check
