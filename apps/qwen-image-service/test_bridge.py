from __future__ import annotations

import base64
import hashlib
import json
from email import policy
from email.parser import BytesParser
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest import mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request

from bridge import (
    MODEL_ID,
    QwenBridge,
    QwenHTTPServer,
    derived_edit_size,
    image_dimensions,
    parse_multipart,
    private_token,
    verify_hash,
)

TOKEN = "t" * 48


def png(width: int, height: int) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + width.to_bytes(4, "big") + height.to_bytes(4, "big") + b"\x08\x02\x00\x00\x00"


def multipart(boundary: str, prompt: str, image: bytes, mime: str = "image/png", name: str = "image[]") -> tuple[str, bytes]:
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nlocal/qwen-image-2.1-uncensored\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\n{prompt}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"reference.{mime.split('/')[-1]}\"\r\n"
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + image + f"\r\n--{boundary}--\r\n".encode()
    return "multipart/form-data; boundary=" + boundary, body

def forwarded_parts(content_type: str, body: bytes) -> tuple[dict[str, bytes], dict[str, tuple[str, bytes]]]:
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("ascii")
    message = BytesParser(policy=policy.default).parsebytes(header + body)
    fields = {}
    files = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        payload = part.get_payload(decode=True)
        if part.get_filename() is None:
            fields[name] = payload
        else:
            files[name] = (part.get_content_type(), payload)
    return fields, files


class NativeHandler(BaseHTTPRequestHandler):
    calls: list[tuple[str, str, bytes]] = []

    def log_message(self, format: str, *args) -> None:
        return

    def do_GET(self) -> None:
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"{}")

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers["Content-Length"]))
        type(self).calls.append((self.path, self.headers.get("Content-Type", ""), body))
        result = json.dumps({"created": 1, "data": [{"b64_json": base64.b64encode(png(32, 32)).decode()}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(result)))
        self.end_headers()
        self.wfile.write(result)


class FixtureBridge(QwenBridge):
    def __init__(self, internal_port: int):
        config = {
            "servicePort": 0,
            "internalPort": internal_port,
            "sdCppCommit": "a" * 40,
            "generationDeadlineMs": 600_000,
            "idleShutdownSeconds": 0,
            "loadTimeoutMs": 1_000,
            "steps": 16,
            "cfgScale": 6.0,
            "backend": "MTL0",
            "sdCppBinary": "/dev/null",
            "diffusionModelPath": "/dev/null",
            "llmPath": "/dev/null",
            "visionPath": "/dev/null",
            "vaePath": "/dev/null",
            "defaultGenerationSize": "768x768",
            "logDir": "/tmp/qwen-image-test-logs",
        }
        super().__init__(config, TOKEN, Path("/tmp/qwen-test-token"))

    def ensure_ready(self) -> None:
        self.last_activity = 0


class BridgeTests(unittest.TestCase):
    def setUp(self):
        NativeHandler.calls = []
        self.native = ThreadingHTTPServer(("127.0.0.1", 0), NativeHandler)
        self.native_thread = threading.Thread(target=self.native.serve_forever, daemon=True)
        self.native_thread.start()
        self.bridge = FixtureBridge(self.native.server_address[1])
        self.server = QwenHTTPServer(("127.0.0.1", 0), self.bridge)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.native.shutdown()
        self.native.server_close()

    def get(self, path: str, headers: dict | None = None):
        return request.urlopen(request.Request(self.base + path, headers=headers or {}))

    def send(self, path: str, body: bytes, content_type: str, headers: dict | None = None):
        return request.urlopen(request.Request(
            self.base + path,
            data=body,
            method="POST",
            headers={"Content-Type": content_type, "Authorization": "Bearer " + TOKEN, **(headers or {})},
        ))

    def test_health_is_public_but_models_require_bearer(self):
        health = json.loads(self.get("/health").read())
        self.assertEqual(health["model"], MODEL_ID)
        self.assertTrue(health["referenceEdits"])
        with self.assertRaises(Exception):
            self.get("/v1/models")
        models = json.loads(self.get("/v1/models", {"Authorization": "Bearer " + TOKEN}).read())
        self.assertEqual(models["data"][0]["id"], MODEL_ID)

    def test_generation_uses_benchmark_size_and_one_output(self):
        body = json.dumps({"model": MODEL_ID, "prompt": "a blue circle", "n": 1}).encode()
        response = json.loads(self.send("/v1/images/generations", body, "application/json").read())
        path, content_type, forwarded = NativeHandler.calls[-1]
        self.assertEqual(path, "/v1/images/generations")
        self.assertEqual(content_type, "application/json")
        self.assertEqual(json.loads(forwarded)["size"], "768x768")
        self.assertEqual(response["model"], MODEL_ID)
        self.assertEqual(len(response["data"]), 1)

    def test_edit_preserves_exact_reference_bytes_and_mime(self):
        image = png(768, 768)
        content_type, body = multipart("test-boundary", "make the pot teal", image)
        response = json.loads(self.send("/v1/images/edits", body, content_type).read())
        path, proxied_type, proxied = NativeHandler.calls[-1]
        self.assertEqual(path, "/v1/images/edits")
        self.assertNotEqual(content_type, proxied_type)
        fields, files = forwarded_parts(proxied_type, proxied)
        self.assertEqual(files["image[]"], ("image/png", image))
        self.assertEqual(fields["model"], b"sd-cpp-local")
        self.assertIn(b'"denoising_strength":0.9', fields["prompt"])
        self.assertEqual(response["model"], MODEL_ID)

    def test_edit_scales_canvas_geometry_without_changing_reference(self):
        image = png(2000, 1000)
        content_type, body = multipart("large-boundary", "edit", image)
        self.send("/v1/images/edits", body, content_type).read()
        _, proxied_type, proxied = NativeHandler.calls[-1]
        fields, files = forwarded_parts(proxied_type, proxied)
        self.assertEqual(fields["size"], b"1024x512")
        self.assertEqual(files["image[]"], ("image/png", image))
        self.assertEqual(image_dimensions(image, "image/png"), (2000, 1000))

    def test_invalid_or_multiple_references_fail_closed(self):
        content_type, invalid_model = multipart("bad-model", "edit", png(64, 64))
        invalid_model = invalid_model.replace(b"local/qwen-image-2.1-uncensored", b"untrusted/model", 1)
        with self.assertRaisesRegex(ValueError, "edit_model_unsupported"):
            parse_multipart(content_type, invalid_model)
        content_type, body = multipart("bad-boundary", "edit", png(64, 64), name="image")
        _, body = multipart("bad-boundary", "edit", png(64, 64))
        second = multipart("bad-boundary", "edit", png(64, 64))[1]
        second_part = second[second.find(b"--bad-boundary\r\n", 1):second.rfind(b"--bad-boundary--")]
        duplicate = body[:body.rfind(b"--bad-boundary--")] + second_part + body[body.rfind(b"--bad-boundary--"):]
        with self.assertRaises(Exception):
            self.send("/v1/images/edits", duplicate, content_type)
        self.assertEqual(NativeHandler.calls, [])

    def test_generation_rejects_prompt_only_payload_with_reference_fields(self):
        body = json.dumps({"prompt": "edit", "images": ["data:image/png;base64,AA=="]}).encode()
        with self.assertRaises(Exception):
            self.send("/v1/images/generations", body, "application/json")
        self.assertEqual(NativeHandler.calls, [])

    def test_geometry_budget_uses_32_pixel_steps(self):
        self.assertIsNone(derived_edit_size(768, 768))
        self.assertEqual(derived_edit_size(2000, 1000), "1024x512")
        width, height = (int(value) for value in derived_edit_size(913, 2048).split("x"))
        self.assertEqual(width % 32, 0)
        self.assertEqual(height % 32, 0)
        self.assertLessEqual(width * height, 768 * 1024)

    def test_hash_and_private_token_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "asset"
            model.write_bytes(b"pinned")
            verify_hash(model, hashlib.sha256(b"pinned").hexdigest(), 6)
            with self.assertRaisesRegex(RuntimeError, "asset_hash"):
                verify_hash(model, "0" * 64, 6)
            token = Path(directory) / "token"
            token.write_text(TOKEN)
            token.chmod(0o644)
            with self.assertRaisesRegex(RuntimeError, "not_private"):
                private_token(token)
            token.chmod(0o600)
            self.assertEqual(private_token(token), TOKEN)

    def test_load_timeout_stops_child_without_holding_state_lock(self):
        self.bridge.config["loadTimeoutMs"] = 0
        with tempfile.TemporaryDirectory() as directory:
            self.bridge.config["logDir"] = directory
            with mock.patch("bridge.subprocess.Popen"), mock.patch.object(self.bridge, "stop") as stop:
                stop.side_effect = lambda: self.assertFalse(self.bridge.lock.locked())
                with self.assertRaisesRegex(TimeoutError, "qwen_runtime_load_timeout"):
                    self.bridge.start()
                stop.assert_called_once()

    def test_idle_monitor_preserves_active_generation(self):
        self.bridge.child = mock.Mock()
        self.bridge.child.poll.return_value = None
        self.bridge.last_activity = 0
        with mock.patch.object(self.bridge.stop_event, "wait", side_effect=[False, True]), mock.patch.object(self.bridge, "stop") as stop:
            with self.bridge.active_generation:
                self.bridge._idle_monitor()
            stop.assert_not_called()
        with mock.patch.object(self.bridge.stop_event, "wait", side_effect=[False, True]), mock.patch.object(self.bridge, "stop") as stop:
            self.bridge._idle_monitor()
            stop.assert_called_once()

    def test_only_one_generation_and_one_waiter_are_admitted(self):
        entered = threading.Event()
        release = threading.Event()
        results = []

        def hold_ready():
            entered.set()
            if not release.wait(timeout=2):
                raise TimeoutError("test_wait_expired")

        def generate():
            results.append(self.bridge.generate({"prompt": "a blue circle"})[0])

        with mock.patch.object(self.bridge, "ensure_ready", side_effect=hold_ready), mock.patch("bridge.QUEUE_WAIT_SECONDS", 0.05):
            first = threading.Thread(target=generate)
            second = threading.Thread(target=generate)
            first.start()
            self.assertTrue(entered.wait(timeout=2))
            second.start()
            try:
                deadline = time.monotonic() + 2
                while self.bridge.slots._value != 0 and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertEqual(self.bridge.slots._value, 0)
                self.assertEqual(self.bridge.generate({"prompt": "a blue circle"})[0], 429)
                self.assertEqual(NativeHandler.calls, [])
            finally:
                release.set()
                first.join(timeout=3)
                second.join(timeout=3)
            self.assertFalse(first.is_alive())
            self.assertFalse(second.is_alive())
        self.assertEqual(sorted(results), [200, 200])
        self.assertEqual(len(NativeHandler.calls), 2)


if __name__ == "__main__":
    unittest.main()
