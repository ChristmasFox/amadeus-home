#!/usr/bin/env python3
import importlib.util
import json
import pathlib
import tempfile
import unittest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "devctl.py"
spec = importlib.util.spec_from_file_location("devctl", MODULE_PATH)
devctl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(devctl)


class DevctlContracts(unittest.TestCase):
    def test_gate_only_never_lab_deploys(self):
        self.assertEqual(devctl.scope_kind(["apps/pubg-saas/src/gateway.ts"]), (False, True, "not-affected"))

    def test_shared_domain_requires_both_products(self):
        self.assertEqual(devctl.scope_kind(["packages/pubg-domain/src/index.ts"]), (True, True, "eligible"))

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

    def test_unknown_scope_blocks_deploy(self):
        self.assertEqual(devctl.scope_kind(["plugins/pubg/src/index.ts", "misc/unowned.ts"])[2],
                         "mixed-or-unknown-scope")

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
