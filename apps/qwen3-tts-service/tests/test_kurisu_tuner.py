import http.client
import io
import json
import sys
import tempfile
import threading
import time
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service
from kurisu_style import EMOTION_SET, StyleConfigError, load_style, schema, style_hash, validate_options
from tuner import TunerServer, TunerStorage


class TunableFake:
    def __init__(self):
        self.calls = []
        self.entered = threading.Event()
        self.release = threading.Event()

    def synthesize_timed(self, text, emotion="default", *, instruct=None, options=None):
        self.calls.append({"text": text, "emotion": emotion, "instruct": instruct, "options": options})
        self.entered.set()
        if text == "lab-one":
            self.release.wait(1)
        output = io.BytesIO()
        with wave.open(output, "wb") as writer:
            writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(24000); writer.writeframes(b"\0\0" * 2400)
        return output.getvalue(), 24000, service.SynthesisTiming(0, 1, 1, 2, prefill_ms=0.1, generation_ms=0.8, decode_ms=0.1, generation_frames=12)


class StyleTest(unittest.TestCase):
    def test_canonical_config_has_all_emotions_and_real_controls(self):
        style = load_style()
        self.assertEqual(set(style["emotions"]), set(EMOTION_SET))
        self.assertEqual({c["id"] for c in schema()["controls"]}, {"temperature", "top_k", "top_p", "max_new_tokens", "seed", "speed_factor", "repetition_penalty"})
        self.assertEqual(len(style_hash(style)), 64)

    def test_option_bounds_are_server_side(self):
        with self.assertRaises(StyleConfigError): validate_options({"temperature": 3})
        with self.assertRaises(StyleConfigError): validate_options({"top_k": "50"})


class PriorityTest(unittest.TestCase):
    def test_production_is_selected_between_lab_samples(self):
        server = service.SpeechServer(("127.0.0.1", 0), "x" * 32)
        engine = TunableFake(); server.engine = engine; server.state = "ready"
        first = threading.Thread(target=lambda: server.inference.submit("lab-one", job_class="lab", instruct="lab", options={}))
        first.start(); self.assertTrue(engine.entered.wait(1))
        second = threading.Thread(target=lambda: server.inference.submit("lab-two", job_class="lab", instruct="lab", options={}))
        second.start(); time.sleep(0.03)
        production = threading.Thread(target=lambda: server.inference.submit("prod"))
        production.start(); time.sleep(0.03)
        engine.release.set(); first.join(1); production.join(1); second.join(1)
        self.assertGreaterEqual(len(engine.calls), 3)
        self.assertEqual(engine.calls[1]["text"], "prod")
        server.server_close()


class TunerApiTest(unittest.TestCase):
    def setUp(self):
        self.production = service.SpeechServer(("127.0.0.1", 0), "x" * 32)
        self.production.engine = TunableFake(); self.production.state = "ready"
        self.server = TunerServer(("127.0.0.1", 0), self.production)
        self.server.storage = TunerStorage(Path(tempfile.mkdtemp()))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.production.server_close()

    def request(self, method, path, body=None, csrf=None, origin=None, host=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        headers = {"Content-Type": "application/json"}
        if csrf: headers["X-Amadeus-CSRF"] = csrf
        if origin: headers["Origin"] = origin
        if host: headers["Host"] = host
        conn.request(method, path, json.dumps(body).encode() if body is not None else None, headers)
        response = conn.getresponse(); result = response.status, response.read(); conn.close(); return result

    def test_owner_lan_host_is_allowed_and_unexpected_host_is_rejected(self):
        code, _ = self.request("GET", "/api/v1/status", host="192.168.5.3:18793")
        self.assertEqual(code, 200)
        code, _ = self.request("GET", "/api/v1/status", host="unexpected.example")
        self.assertEqual(code, 403)

    def test_mutations_require_nonce_and_production_rejects_lab_fields(self):
        code, payload = self.request("POST", "/api/v1/drafts", {})
        self.assertEqual(code, 403); self.assertIn(b"csrf_required", payload)
        code, config = self.request("GET", "/api/v1/config")
        nonce = json.loads(config)["csrfNonce"]
        code, _ = self.request("POST", "/api/v1/drafts", {"x": 1}, nonce, "http://evil.invalid")
        self.assertEqual(code, 403)


if __name__ == "__main__": unittest.main()
