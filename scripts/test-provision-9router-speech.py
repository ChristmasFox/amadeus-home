#!/usr/bin/env python3
"""Offline contract fixtures; never contacts the live dashboard."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

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

    def test_secret_file_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "key"
            p.write_text("fixture-only")
            p.chmod(0o644)
            with self.assertRaises(ValueError): routes.protected(str(p))
            p.chmod(0o600)
            self.assertEqual(routes.protected(str(p)), "fixture-only")


if __name__ == "__main__": unittest.main()
