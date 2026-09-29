#!/usr/bin/env python3
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("kurisu_adapter", ROOT / "scripts/kurisu-gpt-sovits-production-adapter.py")
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)

WAV = b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 72
TOKEN = "t" * 48


class UpstreamHandler(BaseHTTPRequestHandler):
    calls = []

    def do_POST(self):
        length = int(self.headers["Content-Length"])
        payload = json.loads(self.rfile.read(length))
        self.calls.append(payload)
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(WAV)))
        self.end_headers()
        self.wfile.write(WAV)

    def log_message(self, *_args):
        return


def start(server):
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return thread


def fetch(url, *, token=None, payload=None):
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, headers=headers, data=json.dumps(payload).encode() if payload is not None else None)
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, response.headers, response.read()
    except HTTPError as error:
        return error.code, error.headers, error.read()


with tempfile.TemporaryDirectory(prefix="kurisu-adapter-test-") as directory:
    root = Path(directory)
    token_file = root / "token"
    token_file.write_text(TOKEN)
    token_file.chmod(0o600)
    reference = root / "reference.wav"
    reference.write_bytes(WAV)
    reference.chmod(0o600)

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    start(upstream)
    upstream_url = f"http://127.0.0.1:{upstream.server_address[1]}/tts"
    config = module.AdapterConfig(TOKEN, upstream_url, reference, module.DEFAULT_PROMPT, ffmpeg_path="/opt/homebrew/bin/ffmpeg")
    adapter = module.AdapterServer(("127.0.0.1", 0), config)
    module.warm_server(adapter)
    start(adapter)
    base_url = f"http://127.0.0.1:{adapter.server_address[1]}"

    status, _, body = fetch(base_url + "/healthz")
    assert status == 200
    assert json.loads(body)["model"] == module.MODEL_ID

    status, _, _ = fetch(base_url + "/v1/models")
    assert status == 401
    status, _, body = fetch(base_url + "/v1/models", token=TOKEN)
    assert status == 200 and json.loads(body)["data"][0]["id"] == module.MODEL_ID
    status, _, body = fetch(base_url + "/v1/voices", token=TOKEN)
    assert status == 200 and json.loads(body)["data"][0]["id"] == module.VOICE_ID

    request_body = {"model": "amadeus-tts", "voice": module.VOICE_ID, "input": "本番 adapter のテストです。", "response_format": "wav", "style": "default"}
    status, headers, body = fetch(base_url + "/v1/audio/speech", token=TOKEN, payload=request_body)
    assert status == 200 and headers["Content-Type"] == "audio/wav" and body.startswith(b"RIFF")
    assert UpstreamHandler.calls[-1]["ref_audio_path"] == str(reference)
    assert UpstreamHandler.calls[-1]["prompt_text"] == module.DEFAULT_PROMPT
    assert UpstreamHandler.calls[-1]["parallel_infer"] is False

    status, _, _ = fetch(base_url + "/v1/audio/speech", token=TOKEN, payload={**request_body, "style": "angry"})
    assert status == 400
    status, _, _ = fetch(base_url + "/v1/audio/speech", token=TOKEN, payload={**request_body, "seed": 42})
    assert status == 400

    adapter.inference_lock.acquire()
    try:
        status, _, body = fetch(base_url + "/v1/audio/speech", token=TOKEN, payload=request_body)
        assert status == 503 and json.loads(body)["error"]["type"] == "tts_busy"
    finally:
        adapter.inference_lock.release()

    adapter.shutdown()
    upstream.shutdown()

print("KURISU_GPT_SOVITS_ADAPTER_TEST=passed")
