#!/usr/bin/env python3
"""Lab web_search must default to the private SearXNG provider, not DuckDuckGo."""

from __future__ import annotations

import json
import re
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

example = json.loads((ROOT / "integrations/openclaw/openclaw.json.example").read_text())
assert example["tools"]["web"]["search"]["provider"] == "searxng"
assert "searxng" in example["plugins"]["allow"]
assert "duckduckgo" not in example["plugins"]["allow"]
assert example["plugins"]["entries"]["searxng"]["config"]["webSearch"]["baseUrl"] == "http://searxng:8080"

prepare = (ROOT / "scripts/openclaw_prepare.py").read_text()
assert 'search["provider"] = "searxng"' in prepare and "duckduckgo" not in prepare
deploy = (ROOT / "scripts/deploy-openclaw.sh").read_text()
assert "must be searxng" in deploy and "must be duckduckgo" not in deploy

compose = (ROOT / "infra/docker/casaos/openclaw/docker-compose.example.yml").read_text()
for line in re.findall(r"^\s+(?:NO_PROXY|no_proxy):.*$", compose, re.M):
    assert ",searxng," in line, line

sx = (ROOT / "infra/docker/casaos/searxng/docker-compose.example.yml").read_text()
assert "ports:" not in sx, "SearXNG must not publish a host port"
assert "amadeus_network" in sx
settings = (ROOT / "infra/docker/casaos/searxng/settings.yml").read_text()
assert "- json" in settings and "limiter: false" in settings

with tarfile.open(ROOT / "integrations/openclaw/vendor/openclaw-searxng-plugin-2026.9.4.tar.gz") as tar:
    manifest = json.load(tar.extractfile("package/openclaw.plugin.json"))
assert manifest["id"] == "searxng"
print("openclaw web_search searxng config ok")
