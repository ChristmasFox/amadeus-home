#!/usr/bin/env python3
"""Offline fixtures for Lab main-merge release orchestration."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("lab_auto_release", ROOT / "scripts/lab-auto-release.py")
assert spec and spec.loader
auto = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auto)
contract_spec = importlib.util.spec_from_file_location(
    "lab_auto_release_contract", ROOT / "scripts/lab_auto_release_contract.py"
)
assert contract_spec and contract_spec.loader
contract = importlib.util.module_from_spec(contract_spec)
contract_spec.loader.exec_module(contract)



with tempfile.TemporaryDirectory(prefix="lab-auto-release-git-") as temporary:
    repo = Path(temporary)
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "fixture"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "fixture@example.invalid"], check=True)
    source = repo / "source.txt"
    source.write_text("main source\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "source.txt"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "feat(lab): verified source"], check=True)
    source_sha = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], check=True,
                                capture_output=True, text=True).stdout.strip()
    assert auto.release_version_from_commit(repo, source_sha) is None
    release_file = repo / "release.txt"
    release_file.write_text("generated\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "release.txt"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "chore(lab): release v1.10.8"], check=True)
    release_sha = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], check=True,
                                 capture_output=True, text=True).stdout.strip()
    assert auto.release_version_from_commit(repo, release_sha) == "1.10.8"
    assert auto.is_ancestor(repo, source_sha, release_sha)
    assert not auto.is_ancestor(repo, release_sha, source_sha)
    assert auto.lab_source_changes(repo, source_sha, release_sha) == []
    lab_path = repo / "plugins/pubg/release-fixture.ts"
    lab_path.parent.mkdir(parents=True)
    lab_path.write_text("Lab change\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "plugins/pubg/release-fixture.ts"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "feat(pubg): fixture"], check=True)
    lab_sha = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], check=True,
                             capture_output=True, text=True).stdout.strip()
    assert auto.lab_source_changes(repo, release_sha, lab_sha) == ["plugins/pubg/release-fixture.ts"]
    gate_path = repo / "apps/pubg-saas/release-fixture.ts"
    gate_path.parent.mkdir(parents=True)
    gate_path.write_text("Gate change\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "apps/pubg-saas/release-fixture.ts"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "feat(gate): fixture"], check=True)
    gate_sha = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], check=True,
                              capture_output=True, text=True).stdout.strip()
    assert auto.lab_source_changes(repo, lab_sha, gate_sha) == []

with tempfile.TemporaryDirectory(prefix="lab-auto-release-state-") as temporary:
    original = auto.STATE_ROOT
    auto.STATE_ROOT = Path(temporary) / "state"
    try:
        state = {"schema": "lab-main-auto-release/v1", "baselineSha": "a" * 40,
                 "lastProcessedMainSha": "a" * 40, "pending": None}
        auto.save_state(state)
        assert auto.load_state() == state
        assert (auto.STATE_ROOT / "state.json").stat().st_mode & 0o777 == 0o600
        assert auto.STATE_ROOT.stat().st_mode & 0o777 == 0o700
    finally:
        auto.STATE_ROOT = original

with tempfile.TemporaryDirectory(prefix="lab-auto-release-notes-") as temporary:
    notes = Path(temporary) / "RELEASE_NOTES.md"
    auto.write_release_notes(notes, "1.10.8", auto.release_note_summary(["scripts/deploy-openclaw.sh"]))
    body = notes.read_text(encoding="utf-8")
    assert body.startswith("# Amadeus 1.10.8\n")
    assert "发布流程" in body and "openclaw" not in body.lower()
assert auto.release_note_summary(["plugins/pubg/query.ts"]) == "PUBG 查询与比赛数据分析能力更新。"
assert auto.release_note_summary(["apps/pubg-intelligence-lab/src/main.tsx"]) == "PUBG Intelligence Lab 研究体验与证据链更新。"

valid_query = {
    "status": "ok",
    "result": {"meta": {
        "finalAssistantVisibleText": "LAB_STATS_QUERY_OK",
        "toolSummary": {"calls": 1, "failures": 0, "tools": ["pubg_query_stats"]},
    }},
}
assert contract.valid_pubg_stats_smoke(valid_query)
assert not contract.valid_pubg_stats_smoke({**valid_query, "status": "error"})
assert not contract.valid_pubg_stats_smoke({"status": "ok", "result": {"meta": {
    "finalAssistantVisibleText": "LAB_STATS_QUERY_OK",
    "toolSummary": {"calls": 0, "failures": 0, "tools": []},
}}})
assert not contract.valid_pubg_stats_smoke({"status": "ok", "result": {"meta": {
    "finalAssistantVisibleText": "LAB_STATS_QUERY_FAILED",
    "toolSummary": {"calls": 1, "failures": 1, "tools": ["pubg_query_stats"]},
}}})

install_source = (ROOT / "scripts/lab-auto-release.py").read_text(encoding="utf-8")
assert 'timer_root = managed_worktree(root, refresh=True)' in install_source
assert 'str(timer_root / "scripts/lab-auto-release.py")' in install_source
assert '"WorkingDirectory": str(timer_root)' in install_source

runner = (ROOT / "scripts/lab-auto-release.py").read_text(encoding="utf-8")
deploy = (ROOT / "scripts/deploy-openclaw.sh").read_text(encoding="utf-8")
devctl = (ROOT / "scripts/devctl.py").read_text(encoding="utf-8")
release_cli = (ROOT / "scripts/release-cli.sh").read_text(encoding="utf-8")
# Solo-development rule (2026-10-17): GitHub checks never hold a personal Lab release, and a pending deploy retries at once.
assert "checks_for_commit" not in runner
assert "GitHub checks never hold a personal Lab release." in runner
assert "RETRY_SECONDS" not in runner and "MAX_DEPLOY_ATTEMPTS = 3" in runner
assert '"--apply", "--auto-release", "--build-openclaw"' in runner
assert "--auto-release requires LAB_AUTOMATION_VERIFIED_MAIN_SHA" in deploy
assert deploy.index("if ((AUTO_RELEASE)); then\n  build_images_and_preflight\nfi") > deploy.index("print('CHECKPOINT='")
assert "OPENCLAW_CONTAINER_HEALTH=healthy" in deploy
assert "WHATSAPP_HEALTH=linked,running,connected" in deploy
assert "PUBG_STATS_QUERY=passed" in deploy
assert "valid_pubg_stats_smoke" in deploy
assert "AUTO_RELEASE_ROLLBACK=passed" in deploy
assert "restored_health" in deploy and "[[ \"$restored_health\" == healthy ]]" in deploy
assert "lab-auto-enable" not in devctl and "lab-auto-disable" not in devctl
assert "LAB_DEPLOYMENT=AFTER_MAIN_UPDATE ci=not_required release=automatic" in devctl
assert "Lab candidate and manual promotion commands are retired" in release_cli
print("LAB_AUTO_RELEASE_TEST=passed ci-gate=none version=automatic rollback=single-stage")
