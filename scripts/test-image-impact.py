#!/usr/bin/env python3
"""Synthetic regressions for Docker build-input and workspace dependency impact."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("image_impact", ROOT / "scripts/image-impact.py")
assert SPEC and SPEC.loader
impact = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(impact)


def state(target: str, *paths: str) -> str:
    return impact.classify(ROOT, target, list(paths))[0]


assert state("openclaw", "scripts/patch-openclaw-memory-core.mjs") == "REBUILD"
assert state("openclaw", "plugins/pubg/src/index.ts") == "REBUILD"
assert state("gate", "plugins/pubg/src/index.ts") == "REUSE"
assert state("radar", "plugins/pubg/src/index.ts") == "REUSE"
# Shared presentation/domain now live on npm (@rine-kit/*); in-repo path no longer rebuilds images.
# packages/presentation removed in rine-kit cutover; presentation is now @rine-kit/presentation.
assert state("openclaw", "docs/ARCHITECTURE.md") == "REUSE"
assert state("radar", "docs/ARCHITECTURE.md") == "REUSE"
assert state("gate", "docs/ARCHITECTURE.md") == "REUSE"
assert state("gate", "apps/pubg-saas/src/gateway.ts") == "REBUILD"
assert state("openclaw", "docs/CURRENT_TASK.md") == "REUSE"
assert state("gate", "scripts/new-deploy-note.sh") == "REUSE"
assert state("gate", "pnpm-lock.yaml") == "REBUILD"

with tempfile.TemporaryDirectory(prefix="image-impact-unknown-") as temporary:
    repo = Path(temporary)
    dockerfile = repo / impact.DOCKERFILES["openclaw"]
    dockerfile.parent.mkdir(parents=True)
    dockerfile.write_text("FROM node:24\nCOPY $DYNAMIC_CONTEXT /app\n", encoding="utf-8")
    assert impact.classify(repo, "openclaw", ["scripts/patch-openclaw-memory-core.mjs"])[0] == "UNKNOWN"

sources, understood = impact.copy_sources("--chown=node:node --chmod=0555 scripts/openclaw-voice-*.mjs /opt/")
assert understood and sources == ["scripts/openclaw-voice-*.mjs"]
print("IMAGE_IMPACT_TEST=passed memory_patch=lab plugins=lab npm-shared=reuse docs=reuse unknown=conservative")
