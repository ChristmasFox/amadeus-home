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


# Runtime patch scripts change the deployed OpenClaw image/plugin, so they are Lab changes.
for lab_path in ("scripts/patch-openclaw-whatsapp-image-burst.mjs", "scripts/test-patch-openclaw-whatsapp-image-burst.mjs", "scripts/openclaw-voice-lease.mjs"):
    assert any(lab_path.startswith(prefix) for prefix in auto.LAB_PATH_PREFIXES), lab_path
assert not any("scripts/pubg-saas-version.sh".startswith(prefix) for prefix in auto.LAB_PATH_PREFIXES)

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
        loaded = auto.load_state()
        assert loaded["schema"] == auto.STATE_SCHEMA
        assert loaded["baselineSha"] == state["baselineSha"]
        assert loaded["pending"] is None
        # v1 pending without kind becomes formal on load
        pending_v1 = {"sourceSha": "b" * 40, "releaseSha": "c" * 40, "version": "1.2.3",
                      "createdAt": "t", "attempts": 0, "deployed": False}
        auto.save_state({**state, "pending": pending_v1})
        loaded = auto.load_state()
        assert loaded["pending"]["kind"] == "formal"
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

# Release notes list each first-parent change since the previous release commit.
assert auto.classify_commit("chore(lab): release v1.13.5", "") is None
assert auto.classify_commit("fix(9router): amadeus-image fallback to grok (#28)", "body") == {
    "kind": "fix", "text": "生图路由：amadeus-image fallback to grok（#28）"}
assert auto.classify_commit("Merge pull request #27 from ChristmasFox/claude/active",
                            "fix(lab): allow WhatsApp react\n") == {"kind": "fix", "text": "allow WhatsApp react（#27）"}
assert auto.classify_commit("feat(lab): x", "detail\nRelease-Note: 群聊回复后会自动点表情。\n") == {
    "kind": "feat", "text": "群聊回复后会自动点表情。"}
assert auto.classify_commit("refactor(lab): tidy OpenClaw patch", "")["kind"] == "other"
assert "openclaw" not in auto.classify_commit("refactor(lab): tidy OpenClaw patch", "")["text"].lower()
sample = auto.release_note_body([
    ("feat(lab): staged reactions", ""), ("fix(9router): grok fallback (#28)", ""),
    ("docs(agents): dispatch", ""), ("chore(lab): release v1.13.6", "")], "fallback")
assert sample == ("✨ **新功能**\n- staged reactions\n\n🛠️ **修复**\n- 生图路由：grok fallback（#28）"
                  "\n\n📦 **其它变更**\n- 协作流程：dispatch"), sample
# Chinese summary when no Release-Note trailer; English title on any failure.
zh = lambda subject, body: "群聊里收到回复后会按语境点表情。"
assert auto.classify_commit("feat(lab): react in groups (#30)", "body", zh) == {
    "kind": "feat", "text": "群聊里收到回复后会按语境点表情。（#30）"}
called = []
assert auto.classify_commit("feat(lab): x", "Release-Note: 显式说明。", lambda *a: called.append(a))["text"] == "显式说明。"
assert called == [], "an explicit Release-Note never calls the model"
def boom(subject, body): raise RuntimeError("router down")
assert auto.classify_commit("fix(9router): fallback (#28)", "", boom)["text"] == "生图路由：fallback（#28）"
assert auto.classify_commit("fix(9router): fallback (#28)", "", lambda *a: None)["text"] == "生图路由：fallback（#28）"
class Result:
    def __init__(self, code, out): self.returncode, self.stdout, self.stderr = code, out, ""
seen = {}
def fake_run(args, **kw):
    seen.update(args=args, timeout=kw.get("timeout"), script=kw.get("input"))
    return Result(0, "<think>x</think>\n- “WhatsApp 回复后会自动按语境点表情”\n")
assert auto.summarize_commit_zh("feat(lab): auto react", "body", run=fake_run) == "WhatsApp 回复后会自动按语境点表情。"
assert seen["args"][-4:] == ["-i", "openclaw", "node", "-"] and seen["timeout"] == auto.SUMMARY_TIMEOUT_SECONDS
assert "OPENCLAW_9ROUTER_API_KEY" in seen["script"] and "9router:20128" in seen["script"]
def timeout_run(args, **kw): raise subprocess.TimeoutExpired(args, kw.get("timeout"))
assert auto.summarize_commit_zh("feat(lab): x", "", run=timeout_run) is None
assert auto.summarize_commit_zh("feat(lab): x", "", run=lambda *a, **k: Result(1, "")) is None
assert auto.summarize_commit_zh("feat(lab): x", "", run=lambda *a, **k: Result(0, "English only")) is None
now = [0.0]
limited = auto.budgeted(lambda s, b: "中文。", budget_seconds=10, clock=lambda: now[0])
assert limited("a", "") == "中文。"; now[0] = 11; assert limited("a", "") is None
body = auto.release_note_body([("feat(lab): a", ""), ("fix(lab): b", "")], "x", boom)
assert body == "✨ **新功能**\n- a\n\n🛠️ **修复**\n- b", body
assert auto.release_note_body([("chore(lab): release v1.0.0", "")], "Lab 发布流程与运行可靠性更新。") == \
    "- Lab 发布流程与运行可靠性更新。"
with tempfile.TemporaryDirectory(prefix="lab-auto-release-range-") as temporary:
    repo = Path(temporary)
    run = lambda *a: subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, text=True).stdout
    run("init", "-q"); run("config", "user.email", "t@t"); run("config", "user.name", "t")
    for message in ("feat(lab): old", "chore(lab): release v1.0.0", "feat(lab): new thing", "fix(lab): bug"):
        run("commit", "-q", "--allow-empty", "-m", message)
    # Formal boundary is the lab/v* tag (not every release chore on main).
    release_sha = run("rev-parse", "HEAD~2").strip()  # chore(lab): release v1.0.0
    run("tag", "-a", "lab/v1.0.0", release_sha, "-m", "Lab 1.0.0")
    tip = run("rev-parse", "HEAD").strip()
    assert auto.latest_formal_tag(repo) == "lab/v1.0.0"
    assert [s for s, _ in auto.release_commits(repo, tip)] == ["feat(lab): new thing", "fix(lab): bug"]
    run("commit", "-q", "--allow-empty", "-m", "chore(lab): release v1.0.1")
    assert [s for s, _ in auto.release_commits(repo, run("rev-parse", "HEAD").strip())] == [
        "feat(lab): new thing", "fix(lab): bug"]
    notes = repo / "RELEASE_NOTES.md"
    auto.write_release_notes(notes, "1.0.1", auto.release_note_body(auto.release_commits(repo, tip), "x"))
    assert notes.read_text(encoding="utf-8").startswith("# Amadeus 1.0.1\n\n✨ **新功能**\n- new thing\n")

valid_query = {
    "status": "ok",
    "result": {"meta": {
        "finalAssistantVisibleText": "LAB_STATS_QUERY_OK",
        "toolSummary": {"calls": 1, "failures": 0, "tools": ["pubg_query_stats"]},
    }},
}
# Scoped smokes: only domains the diff can affect are exercised; an unknown base runs everything.
assert contract.smoke_scope(None) == {"pubg": True, "voice": True}
assert contract.smoke_scope(["plugins/amadeus/skills/voice-reply/SKILL.md", "apps/qwen3-tts-service/service.py"]) == {"pubg": False, "voice": True}
assert contract.smoke_scope(["infra/docker/casaos/9router/tts-bridge.mjs"]) == {"pubg": False, "voice": True}
assert contract.smoke_scope(["scripts/deploy-openclaw.sh", "infra/macos/README.md", "docs/x.md"]) == {"pubg": False, "voice": False}
assert contract.smoke_scope(["plugins/pubg/src/index.ts"]) == {"pubg": True, "voice": False}
assert contract.smoke_scope(["pnpm-lock.yaml"], "+ '@rine-kit/pubg-domain': 0.1.6")["pubg"]
assert not contract.smoke_scope(["pnpm-lock.yaml"], "+ lodash: 4.17.21")["pubg"]
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
assert '"--apply", "--candidate", "--openclaw-only", "--build-openclaw"' in runner
assert '"--apply", "--auto-release", "--build-openclaw"' in runner
assert "prepare_candidate" in runner and "formal_release" in runner
assert "candidate_on_main_formal_on_approval" in runner
assert "--candidate requires LAB_AUTOMATION_VERIFIED_MAIN_SHA" in deploy
assert "--auto-release requires LAB_AUTOMATION_VERIFIED_MAIN_SHA" in deploy
assert "Lab candidate deployment is retired" not in deploy
assert deploy.index("if ((AUTO_RELEASE || CANDIDATE)); then\n  build_images_and_preflight\nfi") > deploy.index("print('CHECKPOINT='")
assert "OPENCLAW_CONTAINER_HEALTH=healthy" in deploy
assert "WHATSAPP_HEALTH=linked,running,connected" in deploy
assert "poll (up to ~60s) before" in deploy, "WhatsApp health waits for reconnect"
assert "scripts/lab_release_smoke.py" in deploy, "post-switch smokes run through the scoped smoke driver"
smoke = (ROOT / "scripts/lab_release_smoke.py").read_text()
assert "PUBG_STATS_QUERY=passed" in smoke and "valid_pubg_stats_smoke" in smoke
assert "CHAT_SMOKE=passed" in smoke and "VOICE_SMOKE=passed" in smoke and "ATTEMPTS = 3" in smoke
assert "LAB_SMOKE_BASE_SHA" in runner and "live_release_sha" in runner
assert "AUTO_RELEASE_ROLLBACK=passed" in deploy
assert "restored_health" in deploy and "[[ \"$restored_health\" == healthy ]]" in deploy
assert "[[ \"$restored_health\" == starting ]] || break" in deploy, "rollback waits out Docker's starting state"
assert "PUBG_STATS_QUERY=retry" in smoke
assert "lab-auto-enable" not in devctl and "lab-auto-disable" not in devctl
assert "LAB_DEPLOYMENT=AFTER_MAIN_UPDATE ci=not_required candidate=automatic formal=on_approval" in devctl
assert "Lab candidate and manual promotion commands are retired" in release_cli
print("LAB_AUTO_RELEASE_TEST=passed ci-gate=none candidate=automatic formal=on_approval rollback=single-stage")


# The main checkout's dependencies are kept in step with its lockfile (a stale install crash-looped the PUBG site).
with tempfile.TemporaryDirectory(prefix="lab-deps-sync-") as temporary:
    main_tree = Path(temporary) / "main"
    subprocess.run(["git", "init", "-q", str(main_tree)], check=True)
    subprocess.run(["git", "-C", str(main_tree), "config", "user.name", "fixture"], check=True)
    subprocess.run(["git", "-C", str(main_tree), "config", "user.email", "fixture@example.invalid"], check=True)
    (main_tree / "scripts").mkdir()
    (main_tree / "scripts/sync-main-deps.sh").write_text("#!/usr/bin/env bash\necho DEPS_SYNC=installed root=$4\n")
    (main_tree / "README").write_text("x\n")
    subprocess.run(["git", "-C", str(main_tree), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(main_tree), "commit", "-qm", "init"], check=True)
    release_tree = Path(temporary) / "release"
    subprocess.run(["git", "-C", str(main_tree), "worktree", "add", "-q", "--detach", str(release_tree)], check=True)
    # from a linked worktree, "the main checkout" is still the primary one
    assert auto.main_worktree(release_tree).resolve() == main_tree.resolve()
    seen: list[list[str]] = []
    real_run = subprocess.run

    def fake_run(args, **kwargs):
        if args[0] == "git":  # only the install script is faked
            return real_run(args, **kwargs)
        seen.append(list(args))
        return subprocess.CompletedProcess(args, 0, stdout="DEPS_SYNC=installed root=x\n")

    with patch.object(auto.subprocess, "run", fake_run):
        auto.sync_main_tree_dependencies(release_tree)
    assert len(seen) == 1, seen
    assert seen[0][0] == "bash" and seen[0][1].endswith("scripts/sync-main-deps.sh")
    assert "--restart" in seen[0] and "com.amadeus.pubg-intelligence-lab" in seen[0]
    assert Path(seen[0][-1]).resolve() == main_tree.resolve()

    def failing_run(args, **kwargs):
        if args[0] == "git":
            return real_run(args, **kwargs)
        return subprocess.CompletedProcess(args, 1, stdout="pnpm exploded\n")

    with patch.object(auto.subprocess, "run", failing_run):
        auto.sync_main_tree_dependencies(release_tree)  # reported, never raised: a release is not blocked by it
print("Lab main-tree dependency sync fixtures passed")
