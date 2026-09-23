#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT_DIR" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
config = json.loads((root / "integrations/openclaw/openclaw.json.example").read_text())
session = config.get("session")
assert session == {
    "dmScope": "per-account-channel-peer",
    "groupScope": "per-group",
}
assert config.get("tools", {}).get("sessions", {}).get("visibility") == "self"
script = (root / "scripts/deploy-openclaw.sh").read_text()
assert "dmScope=per-account-channel-peer" in script
assert "groupScope=per-group" in script
assert "assert_release_version_advanced" in script
assert 'ACCEPTANCE_KEY="amadeus-release:$AMADEUS_VERSION"' in script
assert "Owner release notification remained pending after 30 seconds." in script
workspace_rules = (root / "integrations/openclaw/workspace-seed/AGENTS.seed.md").read_text()
assert "Never use the shared `main` session for open DMs" in workspace_rules
print("OPENCLAW_SESSION_ISOLATION_TEST=passed")
PY
