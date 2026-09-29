#!/usr/bin/env python3
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("voice_provision", ROOT / "scripts/provision-qwen-audio-tts-voice.py")
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)


class FakeResponse:
    def __init__(self, payload, status=200):
        self.status = status
        self.headers = {"x-request-id": "request-secret-not-logged"}
        self.payload = json.dumps(payload).encode()

    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self, _limit=-1): return self.payload


class ProvisionTest(unittest.TestCase):
    def write_secret(self, path, value):
        path.write_text(value + "\n")
        path.chmod(0o600)

    def test_dry_run_is_offline_and_pins_official_model(self):
        self.assertEqual(routes.TARGET_MODEL, "qwen-audio-3.0-tts-flash")
        self.assertEqual(routes.ENROLLMENT_MODEL, "voice-enrollment")
        routes.validate_endpoint(routes.DEFAULT_ENDPOINT)
        with self.assertRaises(ValueError):
            routes.validate_endpoint("https://evil.example/api/v1/services/audio/tts/customization")

    def test_duration_uses_macos_afinfo_when_ffprobe_is_unavailable(self):
        sample = Path("/tmp/operator-sample.wav")
        with patch.object(routes.subprocess, "check_output", side_effect=[OSError("ffprobe missing"), "estimated duration: 12.500 sec"]):
            self.assertEqual(routes.probe_duration(sample), 12.5)

    def test_authorized_46_second_sample_is_within_official_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            sample = Path(tmp) / "sample.wav"
            sample.write_bytes(b"R" * 4096)
            sample.chmod(0o600)
            with patch.object(routes, "probe_duration", return_value=46.0):
                _, duration, _ = routes.validate_reference(sample, ROOT)
            self.assertEqual(duration, 46.0)

    def test_guest_key_reader_uses_protected_uid_file(self):
        completed = type("Completed", (), {"stdout": "sk-" + "x" * 40})()
        with patch.object(routes.subprocess, "run", return_value=completed) as run:
            value = routes.protected_guest_read("nyannyan", "/DATA/AppData/9router/secrets/asr-upstream-api-key")
        self.assertTrue(value.startswith("sk-"))
        command = run.call_args.args[0]
        self.assertNotIn(value, command)
        self.assertEqual(command[:5], ["orb", "-m", "nyannyan", "-u", "root"])

    def test_create_writes_only_protected_id_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            key, url_file, audio, voice, manifest = (root / name for name in ("key", "url", "sample.wav", "voice", "manifest.json"))
            self.write_secret(key, "k" * 40)
            self.write_secret(url_file, "https://operator.example/sample.wav")
            audio.write_bytes(b"RIFF" + b"x" * 4096); audio.chmod(0o600)
            def opener(request, timeout):
                body = json.loads(request.data.decode())
                self.assertEqual(body["model"], "voice-enrollment")
                self.assertEqual(body["input"]["target_model"], routes.TARGET_MODEL)
                self.assertEqual(body["input"]["action"], "create_voice")
                self.assertEqual(body["input"]["max_prompt_audio_length"], 30.0)
                self.assertNotIn("k" * 40, request.data.decode())
                return FakeResponse({"output": {"voice_id": "qwen-audio-3.0-tts-flash-kurisu-123"}})
            args = type("Args", (), {
                "endpoint": routes.DEFAULT_ENDPOINT, "api_key_file": str(key), "voice_id_file": str(voice),
                "manifest_file": str(manifest), "reference_audio": str(audio), "audio_url_file": str(url_file), "prefix": "kurisu",
            })()
            with patch.object(routes.subprocess, "check_output", return_value="12.5\n"), patch.object(routes, "urlopen", opener):
                # post_json's default opener is bound at definition time, so pass the fake directly.
                original = routes.post_json
                routes.post_json = lambda endpoint, api_key, payload, **kwargs: original(endpoint, api_key, payload, opener=opener)
                try:
                    routes.apply(args)
                finally:
                    routes.post_json = original
            self.assertEqual(voice.read_text().strip(), "qwen-audio-3.0-tts-flash-kurisu-123")
            self.assertEqual(voice.stat().st_mode & 0o777, 0o600)
            saved = json.loads(manifest.read_text())
            self.assertEqual(saved["targetModel"], routes.TARGET_MODEL)
            self.assertNotIn("voiceId", saved)

    def test_existing_voice_is_queried_and_never_created_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            key, voice, manifest = (root / name for name in ("key", "voice", "manifest.json"))
            self.write_secret(key, "k" * 40)
            self.write_secret(voice, "qwen-audio-3.0-tts-flash-kurisu-123")
            calls = []
            def opener(request, timeout):
                body = json.loads(request.data.decode()); calls.append(body)
                self.assertEqual(body["input"]["action"], "query_voice")
                return FakeResponse({"output": {"status": "OK", "target_model": routes.TARGET_MODEL}})
            args = type("Args", (), {
                "endpoint": routes.DEFAULT_ENDPOINT, "api_key_file": str(key), "voice_id_file": str(voice),
                "manifest_file": str(manifest), "reference_audio": None, "audio_url_file": None, "prefix": "kurisu",
            })()
            original = routes.post_json
            routes.post_json = lambda endpoint, api_key, payload, **kwargs: original(endpoint, api_key, payload, opener=opener)
            try:
                routes.apply(args)
            finally:
                routes.post_json = original
            self.assertEqual(len(calls), 1)
            self.assertEqual(json.loads(manifest.read_text())["voiceIdSha256"], routes.digest(voice.read_text().strip()))


if __name__ == "__main__":
    unittest.main()
