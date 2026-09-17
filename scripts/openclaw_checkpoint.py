#!/usr/bin/env python3
"""Create a non-secret rollback checkpoint for the OpenClaw PUBG switch."""

import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> None:
    checkpoint = Path(sys.argv[1])
    sources = [Path(value) for value in sys.argv[2:]]
    target_names = [
        "openclaw-compose.before.yml",
        "legacy-pubg-compose.yml",
        "legacy-openclaw-compose.yml",
        "product-radar-compose.before.yml",
        "langbot.db",
        "n8n.database.sqlite",
        "legacy-state.json",
        "legacy-features.json",
        "new-pubg.sqlite.before",
    ]
    if len(sources) != len(target_names):
        raise SystemExit("checkpoint source count mismatch")
    checkpoint.mkdir(parents=True, exist_ok=False)
    for source, name in zip(sources, target_names):
        if source.is_file():
            shutil.copy2(source, checkpoint / name)

    containers = {}
    for name in ["langbot", "n8n", "pubg-query-engine-v3", "big-bear-openclaw", "openclaw"]:
        try:
            containers[name] = subprocess.check_output(
                ["docker", "inspect", "--format", "{{.State.Running}}", name],
                text=True,
            ).strip()
        except subprocess.CalledProcessError:
            containers[name] = "absent"

    metadata = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "checkpointId": checkpoint.name,
        "containers": containers,
        "note": "Credential files are intentionally excluded.",
    }
    (checkpoint / "checkpoint.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n"
    )
    print("CHECKPOINT=" + str(checkpoint))


if __name__ == "__main__":
    main()
