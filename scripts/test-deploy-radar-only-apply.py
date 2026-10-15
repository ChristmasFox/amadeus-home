#!/usr/bin/env python3
"""Synthetic no-runtime coverage for the Product Radar-only apply guard."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HEAD = subprocess.run(
    ["git", "-C", str(ROOT), "rev-parse", "--short=12", "HEAD"],
    check=True,
    capture_output=True,
    text=True,
).stdout.strip()
LEGACY_RADAR_SHA = "f" * 12


def invoke(args: list[str], *, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(ROOT / "scripts/deploy-openclaw.sh"), *args],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


with tempfile.TemporaryDirectory(prefix="radar-apply-guard-") as temporary:
    temp = Path(temporary)
    bin_dir = temp / "bin"
    bin_dir.mkdir()
    profile = temp / "host-profile.env"
    profile.write_text("ORBSTACK_MACHINE=synthetic\n", encoding="utf-8")
    orb_log = temp / "orb.log"
    orb = bin_dir / "orb"
    orb.write_text(
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "last=''\n"
        "for arg in \"$@\"; do last=\"$arg\"; done\n"
        "printf '%s\\n' \"$*\" >> \"$ORB_LOG\"\n"
        "case \"$last\" in\n"
        f"  openclaw) echo 'local/openclaw-amadeus:git-{HEAD}-20261015080000' ;;\n"
        f"  product-radar) echo 'local/product-radar:git-{LEGACY_RADAR_SHA}-20261015080000' ;;\n"
        "  *) exit 2 ;;\n"
        "esac\n",
        encoding="utf-8",
    )
    orb.chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "AMADEUS_HOST_PROFILE": str(profile),
        "ORB_LOG": str(orb_log),
    }

    dry_run = invoke(["--dry-run", "--build-radar"], env=env)
    assert dry_run.returncode == 0, dry_run.stderr
    assert "MODE=dry-run" in dry_run.stdout
    assert "BUILD_MODE=product-radar-only" in dry_run.stdout
    assert "AUTO_SCOPE_PRODUCT_RADAR=build" in dry_run.stdout

    explicit = invoke(["--apply", "--build-radar"], env=env)
    assert explicit.returncode == 2
    assert "Refusing Product Radar-only apply" in explicit.stderr

    automatic = invoke(["--apply", "--build-auto"], env=env)
    assert automatic.returncode == 2, automatic.stderr
    assert "Refusing Product Radar-only apply" in automatic.stderr

    calls = orb_log.read_text(encoding="utf-8").splitlines()
    assert calls
    assert all("docker inspect" in call for call in calls)
    assert all("docker compose" not in call and "docker build" not in call for call in calls)

print("PRODUCT_RADAR_ONLY_APPLY_GUARD=passed dry-run=allowed explicit-apply=blocked auto-apply=blocked runtime-writes=0")
