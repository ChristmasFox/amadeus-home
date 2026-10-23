#!/usr/bin/env python3
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "devctl.py"
spec = importlib.util.spec_from_file_location("devctl", MODULE_PATH)
devctl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(devctl)


class DevctlContracts(unittest.TestCase):
    def test_gate_only_never_lab_deploys(self):
        self.assertEqual(devctl.scope_kind(["apps/pubg-saas/src/gateway.ts"]), (False, True, "not-affected"))

    def test_identity_package_is_shared_and_gets_affected_checks(self):
        path = "packages/identity/src/index.ts"
        self.assertEqual(devctl.scope_kind([path]), (True, True, "eligible"))
        self.assertEqual(devctl.affected_package(path), ("packages/identity/", "@agent/identity"))
        self.assertEqual(devctl.typechecks_for_task([path])[0][1],
                         ["pnpm", "--filter", "@agent/identity", "typecheck"])

    def test_workspace_persona_requires_candidate(self):
        self.assertEqual(devctl.scope_kind(["integrations/openclaw/workspace/SOUL.md"])[2], "eligible")

    def test_skill_instruction_requires_candidate(self):
        self.assertEqual(devctl.scope_kind(["plugins/amadeus/skills/skill/SKILL.md"])[2], "eligible")

    def test_legacy_goal_restrictions_still_block_runtime(self):
        with tempfile.TemporaryDirectory(dir=devctl.ROOT) as folder:
            path = pathlib.Path(folder) / "legacy.md"
            path.write_text("未经操作者明确授权不得部署 Lab 容器", encoding="utf-8")
            relative = path.relative_to(devctl.ROOT).as_posix()
            self.assertTrue(devctl.goal_blocks_deploy({"goalPath": relative}))
            path.write_text("# Feature\nImplement and test memory.", encoding="utf-8")
            self.assertFalse(devctl.goal_blocks_deploy({"goalPath": relative}))

    def test_doc_only_no_lab_candidate(self):
        self.assertEqual(devctl.scope_kind(["docs/RELEASE_ENGINEERING.md"])[2], "not-affected")

    def test_sensitive_change_requires_review_even_with_lab_code(self):
        paths = ["plugins/amadeus/src/index.ts", "scripts/deploy-openclaw.sh"]
        self.assertEqual(devctl.scope_kind(paths)[2], "requires-separate-review")

    def test_radar_only_is_not_safe_in_existing_release_path(self):
        self.assertEqual(devctl.scope_kind(["apps/product-radar/src/main.ts"])[2],
                         "radar-only-requires-review")

    def test_affected_typechecks_are_not_entire_suite(self):
        commands = devctl.typechecks_for_task(["apps/pubg-saas/src/gateway.ts",
                                               "packages/identity/src/index.ts"])
        self.assertEqual({x[0] for x in commands},
                         {"typecheck:@agent/pubg-saas", "typecheck:@agent/identity"})
        self.assertFalse(any(" test" in " ".join(x[1]) for x in commands))

    def test_changed_test_file_uses_one_targeted_runner(self):
        selected = devctl.tests_for_task(["apps/pubg-saas/tests/message-adapter.test.ts"])
        self.assertEqual(selected[0][1][:5],
                         ["pnpm", "--filter", "@agent/pubg-saas", "exec", "tsx"])

    def test_unknown_scope_blocks_deploy(self):
        self.assertEqual(devctl.scope_kind(["plugins/pubg/src/index.ts", "misc/unowned.ts"])[2],
                         "mixed-or-unknown-scope")

    def test_scope_includes_deleted_files_after_commit(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            def run(*args):
                return subprocess.run(["git", "-C", str(root), *args],
                                      check=True, capture_output=True, text=True).stdout.strip()
            run("init", "-q")
            run("config", "user.email", "fixture@example.invalid")
            run("config", "user.name", "Fixture")
            target = root / "plugins" / "pubg" / "src" / "removed.ts"
            target.parent.mkdir(parents=True)
            target.write_text("old", encoding="utf-8")
            run("add", ".")
            run("commit", "-qm", "fixture")
            baseline = run("rev-parse", "HEAD")
            target.unlink()
            with mock.patch.object(devctl, "ROOT", root):
                self.assertIn("plugins/pubg/src/removed.ts", devctl.scope_paths(baseline))

    def test_evidence_is_private_and_atomic(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "data.json"
            devctl.protected_write(p, {"goalPath": "docs/g.md", "checks": {"edit": "abc"}})
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
            self.assertEqual(devctl.safe_read(p)["checks"]["edit"], "abc")
            p.write_text(json.dumps({"checks": {}}))
            self.assertRaises(SystemExit, devctl.safe_read, p) if p.stat().st_mode & 0o077 else None

    def test_fingerprint_responds_to_file_mutation(self):
        self.assertNotEqual(devctl.checksum(b"one"), devctl.checksum(b"two"))


if __name__ == "__main__":
    unittest.main()
