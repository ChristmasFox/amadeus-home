"""Owner-local tuner API sharing the resident production engine."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import secrets
import time
import uuid
import wave
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from kurisu_emotion import EMOTION_IDS, normalize_emotion
from kurisu_style import StyleConfigError, compose, load_style, schema, style_hash, validate_options
from service import MAX_AUDIO, MAX_TEXT, TtsBusyError, encode

ROOT = Path(__file__).resolve().parent
UI_ROOT = ROOT / "tuner"
MAX_TUNER_BODY = 96 * 1024
MAX_BATCH = 4
MAX_HISTORY = 200
MAX_HISTORY_BYTES = 512 * 1024 * 1024
LOOPBACK_HOSTS = {"127.0.0.1", "localhost"}


def _safe_id(value: str) -> bool:
    return len(value) <= 80 and bool(value) and all(ch.isalnum() or ch in "-_" for ch in value)


class TunerStorage:
    def __init__(self, root: Path | str | None = None):
        default = Path.home() / "Library/Application Support/Amadeus/speech/tuner"
        self.root = Path(root or os.environ.get("AMADEUS_TTS_TUNER_DIR", str(default))).expanduser()
        self.audio = self.root / "audio"
        self.records = self.root / "history"
        self.proposals = self.root / "proposals"
        for directory in (self.root, self.audio, self.records, self.proposals):
            directory.mkdir(parents=True, exist_ok=True)
            os.chmod(directory, 0o700)

    def _write(self, path: Path, value: Any) -> None:
        temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)

    def record(self, value: dict[str, Any]) -> None:
        self._write(self.records / f"{value['id']}.json", value)
        self.prune()

    def proposal(self, value: dict[str, Any]) -> None:
        self._write(self.proposals / f"{value['id']}.json", value)

    def get_record(self, artifact_id: str) -> dict[str, Any] | None:
        if not _safe_id(artifact_id):
            return None
        path = self.records / f"{artifact_id}.json"
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def list_records(self) -> list[dict[str, Any]]:
        result = []
        for path in sorted(self.records.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
            try:
                result.append(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                continue
            if len(result) >= MAX_HISTORY:
                break
        return result

    def prune(self) -> None:
        paths = sorted(self.records.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
        total = 0
        for index, path in enumerate(paths):
            try:
                total += path.stat().st_size
            except OSError:
                continue
            if index >= MAX_HISTORY or total > MAX_HISTORY_BYTES:
                path.unlink(missing_ok=True)
        # Proposal files are never pruned implicitly; they are the explicit
        # reference boundary for promotion and stale detection.


class TunerServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], production_server):
        super().__init__(address, TunerHandler)
        self.production = production_server
        self.bind_host = address[0]
        configured_hosts = os.environ.get("AMADEUS_TTS_TUNER_ALLOWED_HOSTS", "127.0.0.1,localhost,192.168.5.3")
        self.allowed_hosts = LOOPBACK_HOSTS | {
            item.strip() for item in configured_hosts.split(",") if item.strip()
        }
        self.allowed_origins = {
            f"http://127.0.0.1:{self.server_port}",
            f"http://localhost:{self.server_port}",
            *(f"http://{host}:{self.server_port}" for host in self.allowed_hosts if host not in LOOPBACK_HOSTS),
        }
        self.csrf_nonce = secrets.token_urlsafe(32)
        self.storage = TunerStorage()
        self.started = time.time()

    def status(self) -> dict[str, Any]:
        style = self.production.style
        return {
            "lab": {"status": "ready", "bind": self.bind_host, "port": self.server_port},
            "production": {"status": self.production.state, "port": self.production.server_address[1]},
            "engine": os.environ.get("AMADEUS_TTS_ENGINE", "unknown"),
            "residentModelCount": 1,
            "referenceEmbedding": "cached",
            "model": "qwen3-tts-1.7b",
            "modelRevision": self.production.model_revision,
            "ominixRevision": self.production.ominix_revision,
            "profile": "kurisu-v1",
            "language": "japanese",
            "styleHash": style_hash(style),
            "queue": {"productionWaiting": self.production.inference.production_waiting(), "labWaiting": self.production.inference.lab_waiting(), "running": self.production.inference.running_class},
            "releaseVersion": self.production.release_version,
            "csrfNonce": self.csrf_nonce,
        }


class TunerHandler(BaseHTTPRequestHandler):
    server: TunerServer

    def log_message(self, *_args: object) -> None:
        pass

    def _headers(self, content_type: str, length: int = 0) -> None:
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Security-Policy", "default-src 'self'; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        if length:
            self.send_header("Content-Length", str(length))

    def _json(self, code: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self._headers("application/json; charset=utf-8", len(payload))
        self.end_headers()
        self.wfile.write(payload)

    def _error(self, code: int, category: str) -> None:
        self._json(code, {"error": category})

    def _host_ok(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0]
        return host in self.server.allowed_hosts

    def _mutation_ok(self) -> bool:
        if not self._host_ok():
            self._error(403, "invalid_host")
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in self.server.allowed_origins:
            self._error(403, "invalid_origin")
            return False
        if not secrets.compare_digest(self.headers.get("X-Amadeus-CSRF", ""), self.server.csrf_nonce):
            self._error(403, "csrf_required")
            return False
        return True

    def _body(self) -> dict[str, Any] | None:
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 0 < size <= MAX_TUNER_BODY or "application/json" not in self.headers.get("Content-Type", ""):
            self._error(413, "invalid_request")
            return None
        try:
            value = json.loads(self.rfile.read(size))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._error(400, "invalid_request")
            return None
        if not isinstance(value, dict):
            self._error(400, "invalid_request")
            return None
        return value

    def do_GET(self) -> None:
        if not self._host_ok():
            self._error(403, "invalid_host")
            return
        path = urllib.parse.urlsplit(self.path).path
        if path == "/" or path == "/index.html":
            payload = (UI_ROOT / "index.html").read_bytes()
            self.send_response(200); self._headers("text/html; charset=utf-8", len(payload)); self.end_headers(); self.wfile.write(payload); return
        if path in ("/app.js", "/style.css"):
            payload = (UI_ROOT / path[1:]).read_bytes()
            self.send_response(200); self._headers("text/javascript" if path.endswith("js") else "text/css", len(payload)); self.end_headers(); self.wfile.write(payload); return
        if path == "/api/v1/status": self._json(200, self.server.status()); return
        if path == "/api/v1/config": self._json(200, {"style": self.server.production.style, "styleHash": style_hash(self.server.production.style), "csrfNonce": self.server.csrf_nonce}); return
        if path == "/api/v1/schema": self._json(200, schema()); return
        if path == "/api/v1/history": self._json(200, {"items": self.server.storage.list_records()}); return
        if path.startswith("/api/v1/history/"):
            item = self.server.storage.get_record(path.rsplit("/", 1)[-1]); self._json(200, item or {"error": "not_found"}); return
        if path.startswith("/api/v1/audio/"):
            artifact_id = path.rsplit("/", 1)[-1]
            if not _safe_id(Path(artifact_id).stem): self._error(404, "not_found"); return
            matches = list(self.server.storage.audio.glob(f"{Path(artifact_id).stem}.*"))
            if len(matches) != 1 or matches[0].is_symlink(): self._error(404, "not_found"); return
            payload = matches[0].read_bytes()
            mime = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".opus": "audio/ogg"}.get(matches[0].suffix, "application/octet-stream")
            self.send_response(200); self._headers(mime, len(payload)); self.end_headers(); self.wfile.write(payload); return
        self._error(404, "not_found")

    def do_POST(self) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if not self._mutation_ok(): return
        body = self._body()
        if body is None: return
        if path == "/api/v1/synthesize": self._synthesize(body); return
        if path == "/api/v1/drafts": self._draft(body); return
        if path == "/api/v1/proposals": self._proposal(body); return
        if path == "/api/v1/reload":
            try: self._json(200, {"styleHash": self.server.production.reload_style()})
            except StyleConfigError: self._error(409, "invalid_style_config")
            return
        self._error(404, "not_found")

    def _candidate(self, body: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
        text = body.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT: raise StyleConfigError("invalid_input")
        emotion = normalize_emotion(item.get("emotion", body.get("emotion", "default")))
        baseline = item.get("baseline", body.get("baseline"))
        delta = item.get("delta", item.get("instruct", body.get("delta", body.get("instruct"))))
        if not isinstance(baseline, str) or not baseline.strip() or len(baseline) > 4000: raise StyleConfigError("invalid_baseline")
        if not isinstance(delta, str) or len(delta) > 4000: raise StyleConfigError("invalid_delta")
        options = validate_options(item.get("options", body.get("options", {})))
        effective, _, _ = compose(self.server.production.style, emotion, baseline=baseline, instruct=delta, overrides=options)
        slot = str(item.get("slot", "A"))
        if slot not in {"PROD", "A", "B", "C"}: raise StyleConfigError("invalid_slot")
        return {"slot": slot, "emotion": emotion, "baseline": baseline, "delta": delta, "instruct": effective, "options": options, "styleHash": hashlib.sha256(json.dumps({"baseline": baseline, "delta": delta, "emotion": emotion, "options": options}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()}

    def _synthesize(self, body: dict[str, Any]) -> None:
        items = body.get("candidates")
        if items is None: items = [body]
        if not isinstance(items, list) or not 0 < len(items) <= MAX_BATCH: self._error(400, "batch_limit"); return
        results = []
        for item in items:
            try:
                candidate = self._candidate(body, item)
                if candidate["slot"] == "PROD":
                    candidate["baseline"] = self.server.production.style["baseline"]
                    candidate["delta"] = self.server.production.style["emotions"][candidate["emotion"]]["instruct"]
                    candidate["instruct"], candidate["options"], _ = compose(self.server.production.style, candidate["emotion"])
                started = time.monotonic()
                wav, rate, timing = self.server.production.inference.submit(body["text"], candidate["emotion"], job_class="lab", instruct=candidate["instruct"], options=candidate["options"])
                with wave.open(__import__("io").BytesIO(wav), "rb") as reader:
                    duration_ms = int(reader.getnframes() * 1000 / reader.getframerate())
                fmt = body.get("format", "wav")
                audio, mime = encode(wav, fmt)
                artifact_id = uuid.uuid4().hex
                suffix = ".opus" if fmt == "opus" else f".{fmt}"
                path = self.server.storage.audio / f"{artifact_id}{suffix}"
                path.write_bytes(audio); os.chmod(path, 0o600)
                record = {"id": artifact_id, "createdAt": time.time(), "slot": candidate["slot"], "emotion": candidate["emotion"], "styleHash": candidate["styleHash"], "productionStyleHash": style_hash(self.server.production.style), "textHash": hashlib.sha256(body["text"].encode()).hexdigest(), "textChars": len(body["text"]), "options": candidate["options"], "effectiveInstruct": candidate["instruct"], "format": fmt, "audioUrl": f"/api/v1/audio/{artifact_id}{suffix}", "durationMs": duration_ms, "wallMs": round((time.monotonic() - started) * 1000, 1), "rtf": round(timing.engine_inside_lock_ms / duration_ms, 4) if duration_ms else None, "timing": {"queueWaitMs": timing.queue_wait_ms, "engineMs": timing.engine_inside_lock_ms, "prefillMs": timing.prefill_ms, "generationMs": timing.generation_ms, "decodeMs": timing.decode_ms, "generationFrames": timing.generation_frames}, "note": str(item.get("note", ""))[:500]}
                if os.environ.get("AMADEUS_TTS_TUNER_STORE_TEXT") == "1": record["text"] = body["text"]
                self.server.storage.record(record); results.append(record)
            except TtsBusyError: self._error(503, "tts_busy"); return
            except (ValueError, StyleConfigError, RuntimeError) as exc: self._error(400 if isinstance(exc, (ValueError, StyleConfigError)) else 503, str(exc) if isinstance(exc, StyleConfigError) else "synthesis_failed"); return
        self._json(200, {"results": results})

    def _draft(self, body: dict[str, Any]) -> None:
        if len(json.dumps(body, ensure_ascii=False)) > MAX_TUNER_BODY: self._error(413, "invalid_request"); return
        draft_id = uuid.uuid4().hex
        value = {"id": draft_id, "createdAt": time.time(), "kind": "draft", "productionStyleHash": style_hash(self.server.production.style), "payload": body}
        self.server.storage._write(self.server.storage.root / f"draft-{draft_id}.json", value)
        self._json(201, {"id": draft_id, "productionStyleHash": value["productionStyleHash"]})

    def _proposal(self, body: dict[str, Any]) -> None:
        expected = body.get("expectedProductionStyleHash")
        current = style_hash(self.server.production.style)
        if expected != current: self._error(409, "stale_production_style"); return
        candidate = body.get("candidate")
        if not isinstance(candidate, dict): self._error(400, "invalid_candidate"); return
        try:
            emotion = normalize_emotion(candidate.get("emotion", "default")); baseline = candidate["baseline"]; delta = candidate.get("delta", ""); options = validate_options(candidate.get("generationOverrides", candidate.get("options", {})))
            if not isinstance(baseline, str) or not isinstance(delta, str): raise StyleConfigError("invalid_candidate")
        except (KeyError, ValueError, StyleConfigError): self._error(400, "invalid_candidate"); return
        proposal_id = uuid.uuid4().hex
        proposal = {"id": proposal_id, "createdAt": time.time(), "expectedProductionStyleHash": expected, "candidate": {"emotion": emotion, "baseline": baseline, "delta": delta, "generationOverrides": options}, "experimentId": body.get("experimentId") if _safe_id(str(body.get("experimentId", ""))) else None}
        self.server.storage.proposal(proposal); self._json(201, {"id": proposal_id, "expectedProductionStyleHash": expected})
