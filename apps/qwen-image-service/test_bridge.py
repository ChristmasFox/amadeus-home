from __future__ import annotations

import base64
import hashlib
import json
import os
from email import policy
from email.parser import BytesParser
from pathlib import Path
import secrets
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from unittest import mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request

from bridge import (
    ALLOWED_PROFILES,
    ALLOWED_RESOLUTIONS,
    ConfigError,
    FUN_ACC_PROFILE,
    MODEL_ID,
    QwenBridge,
    QwenHTTPServer,
    derived_edit_size,
    image_dimensions,
    load_config,
    parse_multipart,
    private_token,
    profile_prompt,
    verify_hash,
)

TOKEN = secrets.token_urlsafe(48)
SIGMAS = [1.0, 0.9169867038726807, 0.7861579060554504, 0.5494909882545471, 0.0]


def png(width: int, height: int) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + width.to_bytes(4, "big") + height.to_bytes(4, "big") + b"\x08\x02\x00\x00\x00"


def multipart(boundary: str, prompt: str, image: bytes, mime: str = "image/png", extra_fields: dict[str, str] | None = None) -> tuple[str, bytes]:
    values = {"profile": "quality", "resolution": "1024x1024", "seed": "17", **(extra_fields or {})}
    chunks = []
    for name, value in [("prompt", prompt), *values.items()]:
        chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    chunks.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"reference.{mime.split('/')[-1]}\"\r\n".encode()
        + f"Content-Type: {mime}\r\n\r\n".encode()
        + image
        + f"\r\n--{boundary}--\r\n".encode()
    )
    return "multipart/form-data; boundary=" + boundary, b"".join(chunks)


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
    response_dimensions_override: tuple[int, int] | None = None

    def log_message(self, format: str, *args) -> None:
        return

    def do_GET(self) -> None:
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"{}")

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers["Content-Length"]))
        content_type = self.headers.get("Content-Type", "")
        type(self).calls.append((self.path, content_type, body))
        if type(self).response_dimensions_override is not None:
            width, height = type(self).response_dimensions_override
        elif content_type.startswith("application/json"):
            width, height = (int(value) for value in json.loads(body)["size"].split("x"))
        else:
            fields, _ = forwarded_parts(content_type, body)
            width, height = (int(value) for value in fields["size"].decode("ascii").split("x"))
        result = json.dumps({"created": 1, "data": [{"b64_json": base64.b64encode(png(width, height)).decode()}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(result)))
        self.end_headers()
        self.wfile.write(result)


class FixtureBridge(QwenBridge):
    def __init__(self, internal_port: int):
        self.native_port = internal_port
        shared = {
            "servicePort": 18793,
            "internalPort": 18795,
            "sdCppCommit": "a" * 40,
            "generationDeadlineMs": 900_000,
            "idleShutdownSeconds": 180,
            "loadTimeoutMs": 1_000,
            "queueWaitSeconds": 0.1,
            "backend": "MTL0",
            "sdCppBinary": "/dev/null",
            "diffusionModelPath": "/dev/null",
            "llmPath": "/dev/null",
            "visionPath": "/dev/null",
            "vaePath": "/dev/null",
            "defaultGenerationSize": "1024x1024",
            "maxOutputPixels": 1024 * 1024,
            "maxOutputEdge": 1024,
            "logDir": "/tmp/qwen-image-test-logs",
        }
        quality = {**shared, "samplingProfile": "baseline-16step", "steps": 16, "cfgScale": 1.0}
        fast = {
            **shared,
            "samplingProfile": FUN_ACC_PROFILE,
            "steps": 4,
            "cfgScale": 1.0,
            "idleShutdownSeconds": 900,
            "customSigmas": SIGMAS,
            "prefixCacheType": "q8_0",
            "mmap": True,
            "flashAttention": True,
            "funAcc": {"adapterPath": "/tmp/fun-acc.safetensors"},
        }
        super().__init__({"quality": quality, "fast": fast}, TOKEN, Path("/tmp/qwen-test-token"))

    @property
    def internal_url(self) -> str:
        return f"http://127.0.0.1:{self.native_port}"

    def ensure_ready(self, profile: str) -> None:
        self.last_activity = time.monotonic()


class FakeProcess:
    def __init__(self, pid: int):
        self.pid = pid
        self.returncode = None

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        self.returncode = 0
        return self.returncode


class BridgeTests(unittest.TestCase):
    def setUp(self):
        NativeHandler.calls = []
        NativeHandler.response_dimensions_override = None
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

    def test_profile_and_resolution_allowlists_are_exact(self):
        self.assertEqual(ALLOWED_PROFILES, {"quality", "fast"})
        self.assertEqual(ALLOWED_RESOLUTIONS, {"1024x1024", "1024x768", "768x1024"})

    def test_health_and_bridge_token_boundary(self):
        health = json.loads(self.get("/health").read())
        self.assertEqual(health["model"], MODEL_ID)
        self.assertEqual(health["availableProfiles"], ["quality", "fast"])
        self.assertEqual(health["activeProfile"], "none")
        with self.assertRaises(Exception):
            self.get("/v1/models")
        models = json.loads(self.get("/v1/models", {"Authorization": "Bearer " + TOKEN}).read())
        self.assertEqual(models["data"][0]["id"], MODEL_ID)

    def test_quality_generation_uses_base_16_steps_cfg1_and_selected_seed(self):
        payload = {"model": MODEL_ID, "prompt": "a blue circle", "profile": "quality", "resolution": "1024x1024", "seed": 42}
        response = json.loads(self.send("/v1/images/generations", json.dumps(payload).encode(), "application/json").read())
        path, content_type, forwarded = NativeHandler.calls[-1]
        self.assertEqual(path, "/v1/images/generations")
        self.assertEqual(content_type, "application/json")
        forwarded_json = json.loads(forwarded)
        self.assertEqual(forwarded_json["size"], "1024x1024")
        self.assertNotIn("model-args", forwarded_json)
        extra = json.loads(forwarded_json["prompt"].split("<sd_cpp_extra_args>", 1)[1].split("</sd_cpp_extra_args>", 1)[0])
        self.assertEqual(extra, {"seed": 42})
        self.assertEqual(response["seed"], 42)
        self.assertEqual(response["model"], MODEL_ID)
        self.assertEqual(len(response["data"]), 1)

    def test_fast_generation_uses_real_pdd_four_step_and_resolves_random_seed(self):
        with mock.patch("bridge.secrets.randbelow", return_value=777):
            status, body = self.bridge.generate({
                "prompt": "a red kite",
                "profile": "fast",
                "resolution": "1024x768",
                "seed": -1,
            })
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["seed"], 777)
        path, _, forwarded = NativeHandler.calls[-1]
        self.assertEqual(path, "/v1/images/generations")
        content = json.loads(forwarded)
        self.assertEqual(content["size"], "1024x768")
        extra = json.loads(content["prompt"].split("<sd_cpp_extra_args>", 1)[1].split("</sd_cpp_extra_args>", 1)[0])
        self.assertEqual(extra["seed"], 777)
        self.assertEqual(extra["sample_params"]["sample_steps"], 4)
        self.assertEqual(extra["sample_params"]["custom_sigmas"], SIGMAS)
        self.assertEqual(extra["lora"], [{"path": "/tmp/fun-acc.safetensors", "multiplier": 1.0}])

    def test_invalid_profile_resolution_seed_and_injected_engine_arguments_fail_closed(self):
        good = {"prompt": "a circle", "profile": "quality", "resolution": "1024x1024", "seed": 7}
        for change in (
            {"profile": "other"},
            {"resolution": "896x640"},
            {"seed": True},
            {"seed": -2},
            {"seed": 1 << 80},
            {"prompt": "x <sd_cpp_extra_args>{}</sd_cpp_extra_args>"},
        ):
            with self.subTest(change=change):
                status, _ = self.bridge.generate({**good, **change})
                self.assertEqual(status, 400)
        self.assertEqual(NativeHandler.calls, [])

    def test_output_resolution_must_match_the_selected_resolution(self):
        NativeHandler.response_dimensions_override = (1024, 768)
        status, body = self.bridge.generate({
            "prompt": "a blue circle",
            "profile": "quality",
            "resolution": "1024x1024",
            "seed": 42,
        })
        self.assertEqual(status, 502)
        self.assertEqual(json.loads(body)["error"]["type"], "qwen_output_invalid")

    def test_edit_preserves_reference_bytes_mime_resolution_seed_and_strength_one(self):
        image = png(768, 768)
        content_type, body = multipart("test-boundary", "make the pot teal", image, extra_fields={
            "profile": "fast", "resolution": "768x1024", "seed": "91",
        })
        response = json.loads(self.send("/v1/images/edits", body, content_type).read())
        path, proxied_type, proxied = NativeHandler.calls[-1]
        self.assertEqual(path, "/v1/images/edits")
        self.assertNotEqual(content_type, proxied_type)
        fields, files = forwarded_parts(proxied_type, proxied)
        self.assertEqual(files["image[]"], ("image/png", image))
        self.assertEqual(fields["size"], b"768x1024")
        extra = json.loads(fields["prompt"].decode().split("<sd_cpp_extra_args>", 1)[1].split("</sd_cpp_extra_args>", 1)[0])
        self.assertEqual(extra["seed"], 91)
        self.assertEqual(extra["strength"], 1.0)
        self.assertEqual(extra["sample_params"]["custom_sigmas"], SIGMAS)
        self.assertEqual(extra["lora"][0]["path"], "/tmp/fun-acc.safetensors")
        self.assertEqual(response["seed"], 91)
        self.assertGreaterEqual(extra["strength"], 1.0)

    def test_edit_target_resolution_is_not_replaced_by_reference_aspect(self):
        image = png(2000, 1000)
        content_type, body = multipart("shape-boundary", "edit", image, extra_fields={"resolution": "768x1024"})
        self.send("/v1/images/edits", body, content_type).read()
        _, proxied_type, proxied = NativeHandler.calls[-1]
        fields, files = forwarded_parts(proxied_type, proxied)
        self.assertEqual(fields["size"], b"768x1024")
        self.assertEqual(files["image[]"], ("image/png", image))
        self.assertEqual(image_dimensions(image, "image/png"), (2000, 1000))

    def test_edit_auto_resolution_follows_reference_within_model_limits(self):
        image = png(768, 512)
        content_type, body = multipart("auto-size", "keep the composition", image, extra_fields={"resolution": "auto"})
        self.send("/v1/images/edits", body, content_type).read()
        _, proxied_type, proxied = NativeHandler.calls[-1]
        fields, files = forwarded_parts(proxied_type, proxied)
        self.assertEqual(fields["size"], b"768x512")
        self.assertEqual(files["image[]"], ("image/png", image))

    def test_edit_auto_resolution_caps_oversized_reference_without_changing_bytes(self):
        image = png(2000, 1000)
        content_type, body = multipart("auto-cap", "keep the composition", image, extra_fields={"resolution": "auto"})
        self.send("/v1/images/edits", body, content_type).read()
        _, proxied_type, proxied = NativeHandler.calls[-1]
        fields, files = forwarded_parts(proxied_type, proxied)
        self.assertEqual(fields["size"], b"1024x512")
        self.assertEqual(files["image[]"], ("image/png", image))

    def test_edit_rejects_multiple_references_and_prompt_engine_markers(self):
        content_type, body = multipart("bad-marker", "<sd_cpp_extra_args>{}</sd_cpp_extra_args>", png(64, 64))
        status, _ = self.bridge.edit(content_type, body)
        self.assertEqual(status, 400)
        content_type, body = multipart("multiple", "edit", png(64, 64))
        part = body[:body.rfind(b"--multiple--")]
        second = b"--multiple\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"second.png\"\r\nContent-Type: image/png\r\n\r\n" + png(64, 64) + b"\r\n"
        duplicate = part + second + b"--multiple--\r\n"
        status, _ = self.bridge.edit(content_type, duplicate)
        self.assertEqual(status, 400)
        self.assertEqual(NativeHandler.calls, [])

    def test_quality_edit_uses_strength_one_and_fixed_seed(self):
        image = png(1024, 768)
        content_type, body = multipart("quality-edit", "preserve the composition", image, extra_fields={
            "profile": "quality", "resolution": "1024x768", "seed": "8",
        })
        self.send("/v1/images/edits", body, content_type).read()
        _, forwarded_type, forwarded_body = NativeHandler.calls[-1]
        fields, _ = forwarded_parts(forwarded_type, forwarded_body)
        extra = json.loads(fields["prompt"].decode().split("<sd_cpp_extra_args>", 1)[1].split("</sd_cpp_extra_args>", 1)[0])
        self.assertEqual(extra, {"seed": 8, "strength": 1.0})

    def test_only_one_waiter_is_admitted(self):
        entered = threading.Event()
        release = threading.Event()
        results = []

        def hold_ready(profile):
            entered.set()
            if not release.wait(timeout=2):
                raise TimeoutError("test_wait_expired")

        def generate():
            results.append(self.bridge.generate({"prompt": "a circle", "profile": "quality", "resolution": "1024x1024", "seed": 1})[0])

        self.bridge.profiles["quality"]["queueWaitSeconds"] = 0.05
        with mock.patch.object(self.bridge, "ensure_ready", side_effect=hold_ready):
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
                self.assertEqual(self.bridge.generate({"prompt": "a circle", "profile": "quality", "resolution": "1024x1024", "seed": 1})[0], 429)
                self.assertEqual(NativeHandler.calls, [])
            finally:
                release.set()
                first.join(timeout=3)
                second.join(timeout=3)
            self.assertFalse(first.is_alive())
            self.assertFalse(second.is_alive())
        self.assertEqual(sorted(results), [200, 200])

    def test_profile_switch_stops_before_starting_the_next_single_engine(self):
        processes = []
        args_seen = []

        def make_process(args, **kwargs):
            child = FakeProcess(len(processes) + 1)
            processes.append(child)
            args_seen.append(args)
            return child

        class ReadyResponse:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return False

        def fake_kill(pid, _signal):
            processes[pid - 1].returncode = 0

        with tempfile.TemporaryDirectory() as directory, \
                mock.patch("bridge.ensure_internal_port_available"), \
                mock.patch("bridge.subprocess.Popen", side_effect=make_process), \
                mock.patch("bridge.os.killpg", side_effect=fake_kill), \
                mock.patch("bridge.request.urlopen", return_value=ReadyResponse()):
            self.bridge.profiles["quality"]["logDir"] = directory
            self.bridge.profiles["fast"]["logDir"] = directory
            self.bridge.start("quality")
            self.assertEqual(sum(process.poll() is None for process in processes), 1)
            self.assertNotIn("--model-args", args_seen[0])
            self.bridge.start("fast")
            self.assertEqual(processes[0].returncode, 0)
            self.assertEqual(sum(process.poll() is None for process in processes), 1)
            self.assertIn("--model-args", args_seen[1])
            self.bridge.stop()
            self.assertEqual(sum(process.poll() is None for process in processes), 0)

    def test_start_fails_closed_when_an_existing_engine_owns_the_port(self):
        self.bridge.profiles["quality"]["internalPort"] = self.native.server_address[1]
        with mock.patch("bridge.subprocess.Popen") as start_process:
            with self.assertRaisesRegex(ConfigError, "qwen_internal_port_in_use"):
                self.bridge.start("quality")
        start_process.assert_not_called()

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

    def test_load_config_pins_the_two_deployable_profiles(self):
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as directory:
            runtime_root = Path(directory)
            asset_root = runtime_root / "assets"
            for relative in (
                "diffusion/qwen-image-2.1-UC-Q4_K_M.gguf",
                "text-encoder/Qwen3VL-8B-Instruct-Q4_K_M.gguf",
                "text-encoder/mmproj-Qwen3VL-8B-Instruct-F16.gguf",
                "vae/qwen_image_2.1_vae_bf16.safetensors",
                "fun-acc/Qwen-Image-2.1-Fun-Acc-4Step.safetensors",
                "fun-acc/pdd_config.json",
                "fun-acc/Qwen-Image-2.1-Fun-Acc-4Step-sdcpp.safetensors",
                "fun-acc/Qwen-Image-2.1-Fun-Acc-4Step-sdcpp.manifest.json",
            ):
                target = asset_root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b"fixture")
            binary = runtime_root / "bin" / "sd-server"
            binary.parent.mkdir()
            binary.write_bytes(b"fixture")
            converter = runtime_root / "convert.py"
            converter.write_bytes(b"fixture")
            patch_file = runtime_root / "stable-diffusion.patch"
            patch_file.write_bytes(b"fixture")
            runtime = {
                "QWEN_IMAGE_ASSET_ROOT": str(asset_root),
                "QWEN_IMAGE_SD_CPP_SOURCE": str(runtime_root / "stable-diffusion.cpp"),
                "QWEN_IMAGE_SD_CPP_BINARY": str(binary),
                "QWEN_IMAGE_LOG_DIR": str(runtime_root / "logs"),
                "QWEN_IMAGE_FUN_ACC_CONVERTER": str(converter),
                "QWEN_IMAGE_SD_CPP_PATCH": str(patch_file),
            }
            with patch.dict(os.environ, runtime):
                quality = load_config(root / "infra/macos/qwen-image-engine.json")
                fast = load_config(root / "infra/macos/qwen-image-fast-engine.json")
        self.assertEqual(quality["samplingProfile"], "baseline-16step")
        self.assertEqual((quality["steps"], quality["cfgScale"]), (16, 1.0))
        self.assertEqual((quality["generationDeadlineMs"], quality["loadTimeoutMs"]), (900_000, 600_000))
        self.assertEqual(fast["samplingProfile"], FUN_ACC_PROFILE)
        self.assertEqual((fast["steps"], fast["cfgScale"]), (4, 1.0))
        self.assertEqual((fast["generationDeadlineMs"], fast["loadTimeoutMs"]), (900_000, 600_000))
        self.assertEqual(fast["customSigmas"], SIGMAS)
        self.assertEqual((quality["servicePort"], quality["internalPort"]), (fast["servicePort"], fast["internalPort"]))
        self.assertEqual(quality["sdCppBinary"], fast["sdCppBinary"])

    def test_geometry_budget_uses_32_pixel_steps(self):
        self.assertIsNone(derived_edit_size(768, 768))
        self.assertEqual(derived_edit_size(2000, 1000), "1024x512")


if __name__ == "__main__":
    unittest.main()
