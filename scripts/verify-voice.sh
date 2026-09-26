#!/usr/bin/env bash
# Offline, no model download, MPS, Docker, or CasaOS mutation.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m unittest discover -s apps/qwen3-tts-service/tests
python3 -m py_compile apps/qwen3-tts-service/*.py infra/macos/render-qwen3-tts-plist.py infra/macos/verify-qwen3-mlx-assets.py scripts/audit-qwen-b-reference.py
python3 scripts/test-audit-qwen-b-reference.py
bash -n infra/macos/manage-qwen3-tts.sh scripts/prepare-mlx-tts-poc.sh
plutil -lint infra/macos/com.amadeus.qwen3-tts.plist.example
pnpm --filter @agent/amadeus-plugin exec tsx --test tests/voice-reply-prompt.test.ts tests/manifest.test.ts
pnpm --filter @agent/amadeus-plugin typecheck
pnpm verify:openclaw-patch
git diff --check
