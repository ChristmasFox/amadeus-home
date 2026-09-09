#!/usr/bin/env python3

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("kook_watchdog.py")
SPEC = importlib.util.spec_from_file_location("kook_watchdog", SCRIPT)
assert SPEC and SPEC.loader
WATCHDOG = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = WATCHDOG
SPEC.loader.exec_module(WATCHDOG)


class KookWatchdogTests(unittest.TestCase):
    def setUp(self):
        self.config = WATCHDOG.make_config(
            {
                "KOOK_WATCHDOG_TOKEN_FILE": "/tmp/token",
                "KOOK_WATCHDOG_STATE_FILE": "/tmp/state.json",
                "KOOK_WATCHDOG_LOCK_FILE": "/tmp/lock",
                "KOOK_WATCHDOG_COMPOSE_DIR": "/tmp/langbot",
            }
        )

    def test_classifies_online_and_offline_payloads(self):
        online = WATCHDOG.classify_payload(
            {"code": 0, "data": {"online": True}}, 200
        )
        offline = WATCHDOG.classify_payload(
            {"code": 0, "data": {"online": False}}, 200
        )
        self.assertEqual(online.kind, "online")
        self.assertEqual(offline.kind, "offline")

    def test_rejects_credential_and_api_errors_without_calling_restart(self):
        credential = WATCHDOG.classify_payload(
            {"code": 401, "message": "unauthorized"}, 200
        )
        api_error = WATCHDOG.classify_payload(
            {"code": 500, "message": "server error"}, 200
        )
        self.assertEqual(credential.kind, "credential_invalid")
        self.assertEqual(api_error.kind, "api_error")

    def test_restart_requires_three_consecutive_offline_probes(self):
        state = WATCHDOG.default_state()
        state["consecutive_offline"] = 2
        self.assertEqual(
            WATCHDOG.restart_decision(state, 1000, self.config, "running"),
            "threshold",
        )
        state["consecutive_offline"] = 3
        self.assertEqual(
            WATCHDOG.restart_decision(state, 1000, self.config, "running"),
            "restart",
        )

    def test_restart_is_rate_limited_and_exhausted(self):
        state = WATCHDOG.default_state()
        state["consecutive_offline"] = 3
        state["last_restart_at"] = 900.0
        state["restart_history"] = [900.0]
        self.assertEqual(
            WATCHDOG.restart_decision(state, 1000, self.config, "running"),
            "cooldown",
        )
        state["last_restart_at"] = 0.0
        state["restart_history"] = [100.0, 200.0, 300.0]
        self.assertEqual(
            WATCHDOG.restart_decision(state, 1000, self.config, "running"),
            "exhausted",
        )

    def test_non_running_container_is_never_restarted(self):
        state = WATCHDOG.default_state()
        state["consecutive_offline"] = 3
        self.assertEqual(
            WATCHDOG.restart_decision(state, 1000, self.config, "exited"),
            "container_not_running",
        )

    def test_state_is_atomic_and_mode_restricted(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "monitoring" / "state.json"
            state = WATCHDOG.default_state()
            state["last_result"] = "online"
            WATCHDOG.save_state(state_path, state)
            self.assertEqual(WATCHDOG.load_state(state_path)["last_result"], "online")
            self.assertEqual(state_path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(state_path.parent.stat().st_mode & 0o777, 0o700)
            json.loads(state_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
