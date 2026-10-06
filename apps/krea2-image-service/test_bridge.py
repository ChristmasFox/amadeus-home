from __future__ import annotations

import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib import request

from bridge import KreaBridge, KreaHTTPServer, MODEL_ID, private_token


class FixtureBridge(KreaBridge):
    def __init__(self, token: str):
        super().__init__({"servicePort": 0, "internalPort": 1, "sdCppCommit": "fixture", "idleShutdownSeconds": 0}, token, Path("/tmp/fixture-token"))
        self.calls: list[dict] = []

    def generate(self, payload: dict) -> tuple[int, bytes]:
        self.calls.append(payload)
        return 200, json.dumps({"created": 1, "data": [{"b64_json": "a" * 1000}]}).encode()


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.bridge = FixtureBridge("t" * 48)
        self.server = KreaHTTPServer(("127.0.0.1", 0), self.bridge)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def get(self, path: str, headers: dict | None = None):
        return request.urlopen(request.Request(self.base + path, headers=headers or {}))

    def post(self, payload: dict, headers: dict | None = None):
        body = json.dumps(payload).encode()
        return request.urlopen(request.Request(self.base + "/v1/images/generations", data=body, method="POST", headers={"Content-Type": "application/json", **(headers or {})}))

    def test_health_is_bounded_and_models_require_bearer(self):
        health = json.loads(self.get("/health").read())
        self.assertEqual(health["model"], MODEL_ID)
        self.assertFalse(health["referenceEdits"])
        with self.assertRaises(Exception):
            self.get("/v1/models")
        models = json.loads(self.get("/v1/models", {"Authorization": "Bearer " + "t" * 48}).read())
        self.assertEqual(models["data"][0]["id"], MODEL_ID)

    def test_generation_is_one_bounded_prompt_and_rewrites_model(self):
        response = self.post({"model": MODEL_ID, "prompt": "a blue circle", "size": "1024x1024", "n": 1}, {"Authorization": "Bearer " + "t" * 48})
        self.assertEqual(json.loads(response.read())["data"][0]["b64_json"], "a" * 1000)
        self.assertEqual(self.bridge.calls[0]["model"], MODEL_ID)
        self.assertEqual(self.bridge.calls[0]["output_format"], "png")

    def test_reference_request_fails_closed(self):
        with self.assertRaises(Exception):
            self.post({"prompt": "edit", "images": ["data:image/png;base64,AAAA"]}, {"Authorization": "Bearer " + "t" * 48})

    def test_private_token_requires_mode_600(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "token"
            path.write_text("x" * 48)
            path.chmod(0o644)
            with self.assertRaisesRegex(RuntimeError, "not_private"):
                private_token(path)
            path.chmod(0o600)
            self.assertEqual(private_token(path), "x" * 48)


if __name__ == "__main__":
    unittest.main()
