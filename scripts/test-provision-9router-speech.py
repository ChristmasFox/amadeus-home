#!/usr/bin/env python3
"""Offline contract fixtures; never contacts the live dashboard."""
import importlib.util
from pathlib import Path
import tempfile
import io
import unittest
from unittest.mock import patch, MagicMock
from subprocess import CompletedProcess

spec = importlib.util.spec_from_file_location("speech_routes", Path(__file__).with_name("provision-9router-speech.py"))
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)


class FakeDashboard:
    def __init__(self):
        self.connections = []
        self.aliases = {}
        self.combos = [{"id": "old-combo", "name": "amadeus-asr"}]
        self.writes = []

    def request(self, method, path, body=None):
        if method == "GET":
            if path == "/api/providers": return {"connections": self.connections}
            if path == "/api/models/alias": return {"aliases": self.aliases}
            if path == "/api/combos": return {"combos": self.combos}
        self.writes.append((method, path, body))
        if method == "POST" and path == "/api/providers":
            self.connections.append({"name": body["name"], "provider": body["provider"], "providerSpecificData": body["providerSpecificData"]})
        if method == "PUT" and path == "/api/models/alias": self.aliases[body["alias"]] = body["model"]
        if method == "DELETE": self.combos = []
        return {"success": True}


class ProvisionTest(unittest.TestCase):
    def test_idempotent_tts_and_old_combo_retirement(self):
        api = FakeDashboard()
        self.assertEqual(routes.ensure_connection(api, routes.TTS_PROVIDER, routes.TTS_CONNECTION, "test-only", routes.TTS_URL), "created")
        self.assertEqual(routes.ensure_connection(api, routes.TTS_PROVIDER, routes.TTS_CONNECTION, "test-only", routes.TTS_URL), "existing")
        self.assertEqual(routes.retire_old_combo(api), "retired")
        self.assertEqual(routes.retire_old_combo(api), "absent")
        self.assertEqual(routes.ensure_alias(api, "amadeus-tts", routes.TTS_MODEL), "created")
        self.assertEqual(routes.ensure_alias(api, "amadeus-tts", routes.TTS_MODEL), "existing")
        self.assertEqual(len(api.writes), 3)

    def test_drift_fails_closed(self):
        api = FakeDashboard()
        api.connections = [{"name": routes.TTS_CONNECTION, "provider": routes.TTS_PROVIDER, "providerSpecificData": {"baseUrl": "http://wrong"}}]
        with self.assertRaisesRegex(RuntimeError, "connection_drift"):
            routes.ensure_connection(api, routes.TTS_PROVIDER, routes.TTS_CONNECTION, "test-only", routes.TTS_URL)
        api.aliases["amadeus-asr"] = "wrong/model"
        with self.assertRaisesRegex(RuntimeError, "alias_drift"):
            routes.ensure_alias(api, "amadeus-asr", "selfhosted-stt/model")
        self.assertFalse(api.writes)

    def test_runtime_gate_and_post_alias_restart(self):
        with patch.object(routes.subprocess, "run", return_value=CompletedProcess([], 0)) as run:
            self.assertTrue(routes.runtime_speech_ready("nyannyan"))
            self.assertIn("healthz", run.call_args.args[0][-1])
        with patch.object(routes.subprocess, "run", return_value=CompletedProcess([], 1)):
            self.assertFalse(routes.runtime_speech_ready("nyannyan"))
        http_401 = routes.urllib.error.HTTPError("http://127.0.0.1:20128/v1/models", 401, "unauthorized", {}, None)
        with patch.object(routes.subprocess, "run", side_effect=[CompletedProcess([], 0), CompletedProcess([], 1), CompletedProcess([], 0)]) as run, patch.object(routes.urllib.request, "urlopen", side_effect=http_401), patch.object(routes.time, "sleep"):
            routes.restart_and_verify("nyannyan")
            self.assertEqual(run.call_count, 3)
        with patch.object(routes.subprocess, "run", side_effect=[CompletedProcess([], 0)] + [CompletedProcess([], 1)] * 45), patch.object(routes.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "post_alias_restart"):
                routes.restart_and_verify("nyannyan")

    def test_local_cli_auth_is_protected_and_not_logged(self):
        with patch.object(routes.subprocess, "run", return_value=CompletedProcess([], 0, stdout=b"0123456789abcdef")) as run:
            token = routes.local_cli_token("nyannyan")
            self.assertEqual(token, "0123456789abcdef")
            self.assertIn("docker", run.call_args.args[0])
        with patch.object(routes.subprocess, "run", return_value=CompletedProcess([], 0, stdout=b"invalid")):
            with self.assertRaisesRegex(RuntimeError, "local_cli_token_unavailable"):
                routes.local_cli_token("nyannyan")
        api = routes.Dashboard("http://127.0.0.1:20128", cli_token=token)
        response = MagicMock()
        response.__enter__.return_value = io.BytesIO(b'{"connections":[]}')
        with patch.object(api.opener, "open", return_value=response) as opened:
            self.assertEqual(api.request("GET", "/api/providers"), {"connections": []})
            request = opened.call_args.args[0]
            self.assertEqual(request.get_header("X-9r-cli-token"), token)

    def test_guest_checkpoint_script_compiles_before_any_write(self):
        with patch.object(routes.subprocess, "run", return_value=CompletedProcess([], 0, stdout="BACKUP_CREATED\n")) as run:
            self.assertIn("/DATA/AppData/9router/backups/", routes.backup_live("nyannyan"))
            guest_code = run.call_args.args[0][7]
            compile(guest_code, "<guest-checkpoint>", "exec")

    def test_secret_file_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "key"
            p.write_text("fixture-only")
            p.chmod(0o644)
            with self.assertRaises(ValueError): routes.protected(str(p))
            p.chmod(0o600)
            self.assertEqual(routes.protected(str(p)), "fixture-only")


if __name__ == "__main__": unittest.main()
