import json
import importlib.util
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEVCTL_PATH = ROOT / "scripts/devctl.py"
DEVCTL_SPEC = importlib.util.spec_from_file_location("devctl_gate_authorization", DEVCTL_PATH)
DEVCTL = importlib.util.module_from_spec(DEVCTL_SPEC)
DEVCTL_SPEC.loader.exec_module(DEVCTL)
FIELDS = (
    "GATE_LOCAL_INSTANCE_ID",
    "GATE_LOCAL_BOT_ACCOUNT_ID",
    "GATE_LOCAL_ORBSTACK_MACHINE",
    "GATE_LOCAL_BACKUP_ROOT",
    "GATE_LOCAL_AGE_RECIPIENTS_FILE",
    "GATE_LOCAL_AGE_IDENTITY_FILE",
    "GATE_LOCAL_NOTIFICATION_HOOK",
)


class GateAutoAuthorizationCli(unittest.TestCase):
    def config(self, root: pathlib.Path) -> dict[str, str]:
        home = root / "home"
        home.mkdir()
        backup = root / "backup"
        backup.mkdir(mode=0o700)
        backup.chmod(0o700)
        recipients = root / "recipients.txt"
        recipients.write_text("recipient fixture\n", encoding="utf-8")
        identity = root / "identity.agekey"
        identity.write_text("identity fixture\n", encoding="utf-8")
        identity.chmod(0o600)
        notification = root / "gate-notify-fixture"
        notification.write_text("#!/bin/sh\ncat >/dev/null\n", encoding="utf-8")
        notification.chmod(0o700)
        return {
            "HOME": str(home),
            "GATE_LOCAL_INSTANCE_ID": "gate-local-fixture",
            "GATE_LOCAL_BOT_ACCOUNT_ID": "fixture-bot-01",
            "GATE_LOCAL_ORBSTACK_MACHINE": "gate-ci-fixture",
            "GATE_LOCAL_BACKUP_ROOT": str(backup),
            "GATE_LOCAL_AGE_RECIPIENTS_FILE": str(recipients),
            "GATE_LOCAL_AGE_IDENTITY_FILE": str(identity),
            "GATE_LOCAL_NOTIFICATION_HOOK": str(notification),
        }

    def run_devctl(self, home_env: dict[str, str], *args: str) -> subprocess.CompletedProcess:
        environment = os.environ.copy()
        for field in FIELDS:
            environment.pop(field, None)
        environment.update(home_env)
        return subprocess.run(
            [os.environ.get("PYTHON", "python3"), str(ROOT / "scripts/devctl.py"), "configure", *args], cwd=ROOT,
            env=environment, capture_output=True, text=True, check=False,
        )

    def test_noninteractive_enable_writes_indefinite_default_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.config(pathlib.Path(directory))
            result = self.run_devctl(env, "gate-auto-enable")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("GATE_AUTO_ENABLED=true", result.stdout)
            policy_path = pathlib.Path(env["HOME"]) / ".config/amadeus/gate-local-auto-approval.json"
            policy = json.loads(policy_path.read_text(encoding="utf-8"))
            self.assertEqual(
                policy["riskCategories"],
                ["reversible_app_candidate", "backward_compatible_schema", "destructive_schema_warning"],
            )
            self.assertEqual(policy["repositoryCommonDir"],
                             subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--path-format=absolute",
                                             "--git-common-dir"], check=True, capture_output=True,
                                            text=True).stdout.strip())
            self.assertNotIn("expiresAt", policy)
            self.assertEqual(policy_path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(policy_path.parent.stat().st_mode & 0o777, 0o700)

    def test_gate_status_allows_paused_m2_without_clearance_record(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.config(pathlib.Path(directory))
            enabled = self.run_devctl(env, "gate-auto-enable")
            self.assertEqual(enabled.returncode, 0, enabled.stdout + enabled.stderr)
            status = self.run_devctl(env, "status")
            self.assertEqual(status.returncode, 0, status.stdout + status.stderr)
            self.assertIn("GATE_AUTO_STATUS=enabled", status.stdout)
            self.assertIn("GATE_AUTO_REASON=ready_for_candidate_preflight", status.stdout)
            self.assertIn("GATE_M2_CLEARANCE_SCOPE=formal-release-only", status.stdout)
            self.assertFalse((pathlib.Path(env["HOME"]) / ".config/amadeus/gate-local-m2-clearance.json").exists())

    def test_noninteractive_enable_without_external_configuration_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            home = pathlib.Path(directory) / "home"
            home.mkdir()
            env = {"HOME": str(home)}
            result = self.run_devctl(env, "gate-auto-enable")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("GATE_LOCAL_INSTANCE_ID", result.stderr)
            self.assertFalse((home / ".config/amadeus/gate-local-auto-approval.json").exists())

    def test_m2_revoke_removes_only_clearance(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.config(pathlib.Path(directory))
            state_dir = pathlib.Path(env["HOME"]) / ".config/amadeus"
            state_dir.mkdir(mode=0o700, parents=True)
            approval = state_dir / "gate-local-auto-approval.json"
            approval.write_text('{"schema":"gate-local-auto-approval/v1"}\n', encoding="utf-8")
            approval.chmod(0o600)
            clearance = state_dir / "gate-local-m2-clearance.json"
            clearance.write_text('{"schema":"gate-local-m2-clearance/v1"}\n', encoding="utf-8")
            clearance.chmod(0o600)
            result = self.run_devctl(env, "gate-m2-revoke")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue(approval.is_file())
            self.assertFalse(clearance.exists())

    def test_gate_auto_disable_revokes_both_indefinite_records(self):
        with tempfile.TemporaryDirectory() as directory:
            home = pathlib.Path(directory) / "home"
            state_dir = home / ".config/amadeus"
            state_dir.mkdir(mode=0o700, parents=True)
            approval = state_dir / "gate-local-auto-approval.json"
            approval.write_text('{"approvedAt":"2026-10-01T00:00:00Z"}\n', encoding="utf-8")
            approval.chmod(0o600)
            clearance = state_dir / "gate-local-m2-clearance.json"
            clearance.write_text('{"clearedAt":"2026-10-15T00:00:00Z"}\n', encoding="utf-8")
            clearance.chmod(0o600)
            result = self.run_devctl({"HOME": str(home)}, "gate-auto-disable")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertFalse(approval.exists())
            self.assertFalse(clearance.exists())

    def test_m2_clearance_document_has_no_expiry(self):
        document = DEVCTL.gate_m2_clearance_document(
            {"instanceId": "gate-local-fixture", "botAccountId": "fixture-bot-01"},
            "m2-acceptance-fixture-01",
        )
        self.assertEqual(document["acceptanceEvidenceRef"], "m2-acceptance-fixture-01")
        self.assertNotIn("expiresAt", document)


if __name__ == "__main__":
    unittest.main()
