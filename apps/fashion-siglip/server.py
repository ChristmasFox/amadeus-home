"""Small HTTP worker for local FashionSigLIP image embeddings.

The service deliberately exposes only image embedding. Product Radar owns
watch state, thresholds, cache identity, and fallback behavior.
"""

from __future__ import annotations

import base64
import json
import os
import threading
import urllib.request
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from typing import Any

from PIL import Image, ImageFile

ImageFile.LOAD_TRUNCATED_IMAGES = True

MODEL_ID = os.environ.get("FASHION_SIGLIP_MODEL_ID", "Marqo/marqo-fashionSigLIP")
MODEL_VERSION = os.environ.get("FASHION_SIGLIP_MODEL_VERSION", MODEL_ID)
REQUESTED_DEVICE = os.environ.get("FASHION_SIGLIP_DEVICE", "mps").lower()
HOST = os.environ.get("FASHION_SIGLIP_BIND", "127.0.0.1")
PORT = int(os.environ.get("FASHION_SIGLIP_PORT", "8000"))
MAX_IMAGE_BYTES = int(os.environ.get("FASHION_SIGLIP_MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))
MAX_REQUEST_BYTES = int(os.environ.get("FASHION_SIGLIP_MAX_REQUEST_BYTES", str(32 * 1024 * 1024)))
IMAGE_TIMEOUT_SECONDS = float(os.environ.get("FASHION_SIGLIP_IMAGE_TIMEOUT_SECONDS", "20"))
THREADS = max(1, int(os.environ.get("FASHION_SIGLIP_THREADS", "2")))


@dataclass
class EmbeddedImage:
    key: str
    image: Image.Image
    width: int
    height: int


class ModelRuntime:
    def __init__(self) -> None:
        self.model: Any = None
        self.preprocess: Any = None
        self.device = "cpu"
        self.dimension = 0
        self.lock = threading.Lock()

    def load(self) -> None:
        import open_clip
        import torch

        if REQUESTED_DEVICE == "mps" and torch.backends.mps.is_available():
            self.device = "mps"
        else:
            self.device = "cpu"
            torch.set_num_threads(THREADS)
        model, _, preprocess = open_clip.create_model_and_transforms(
            f"hf-hub:{MODEL_ID}",
            device=self.device,
        )
        model.eval()
        self.model = model
        self.preprocess = preprocess
        visual = model.visual
        # open_clip's HF-backed TimmModel exposes the projected image width on
        # the trunk for Marqo FashionSigLIP, while some OpenCLIP variants use
        # visual.output_dim. Keep both forms provider-agnostic.
        self.dimension = int(
            getattr(visual, "output_dim", 0)
            or getattr(getattr(visual, "trunk", None), "num_features", 0)
        )
        if self.dimension <= 0:
            raise RuntimeError("FashionSigLIP model did not expose an image embedding dimension")

    def embed(self, images: list[EmbeddedImage]) -> list[list[float]]:
        import torch

        if self.model is None or self.preprocess is None:
            raise RuntimeError("FashionSigLIP model is not ready")
        batch = torch.stack([self.preprocess(item.image) for item in images]).to(self.device)
        with self.lock, torch.inference_mode():
            embeddings = self.model.encode_image(batch, normalize=True)
        return embeddings.detach().cpu().tolist()


runtime = ModelRuntime()


def _decode_base64(value: str) -> bytes:
    encoded = value.split(",", 1)[1] if "," in value else value
    data = base64.b64decode(encoded, validate=False)
    if not data:
        raise ValueError("imageBase64 is empty")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("image is too large")
    return data


def _download(url: str) -> bytes:
    if not url:
        raise ValueError("imageUrl is empty")
    request = urllib.request.Request(
        url,
        headers={"Accept": "image/*", "User-Agent": "ProductRadar-FashionSigLIP/1.0"},
    )
    with urllib.request.urlopen(request, timeout=IMAGE_TIMEOUT_SECONDS) as response:
        declared = int(response.headers.get("Content-Length", "0") or "0")
        if declared > MAX_IMAGE_BYTES:
            raise ValueError("image is too large")
        data = response.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("image is too large")
    return data


def _load_image(item: dict[str, Any]) -> EmbeddedImage:
    key = item.get("key")
    if not isinstance(key, str) or not key:
        raise ValueError("item.key is required")
    image_base64 = item.get("imageBase64")
    if image_base64 is not None:
        if not isinstance(image_base64, str):
            raise ValueError("imageBase64 must be a string")
        data = _decode_base64(image_base64)
    else:
        image_url = item.get("imageUrl")
        if not isinstance(image_url, str):
            raise ValueError("imageUrl is required when imageBase64 is absent")
        data = _download(image_url)
    with Image.open(BytesIO(data)) as decoded:
        image = decoded.convert("RGB")
    width, height = image.size
    return EmbeddedImage(key=key, image=image, width=width, height=height)


def embed_items(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        raise ValueError("items must be an array")
    if len(items) > 64:
        raise ValueError("too many items")

    loaded: list[EmbeddedImage] = []
    results: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            results.append({"key": "", "error": "item must be an object"})
            continue
        try:
            loaded.append(_load_image(item))
            results.append({"key": loaded[-1].key})
        except Exception as error:  # One bad marketplace image must not fail the batch.
            key = item.get("key") if isinstance(item.get("key"), str) else ""
            results.append({"key": key, "error": str(error)})

    if loaded:
        vectors = runtime.embed(loaded)
        vector_by_key = {item.key: (item, vector) for item, vector in zip(loaded, vectors)}
        for result in results:
            item_and_vector = vector_by_key.get(result["key"])
            if item_and_vector is None:
                continue
            item, vector = item_and_vector
            result.update({"vector": vector, "width": item.width, "height": item.height})
    return results


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "ProductRadarFashionSigLIP/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        # Avoid writing image URLs and request bodies to container logs.
        print(f"fashion-siglip: {format % args}", flush=True)

    def _send(self, status: int, payload: Any) -> None:
        body = _json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        ready = runtime.model is not None
        self._send(
            HTTPStatus.OK if ready else HTTPStatus.SERVICE_UNAVAILABLE,
            {
                "status": "ok" if ready else "starting",
                "provider": "fashionSigLIP",
                "modelId": MODEL_ID,
                "modelVersion": MODEL_VERSION,
                "dimension": runtime.dimension,
                "device": runtime.device,
            },
        )

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in ("/embed", "/embed-batch"):
            self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        if runtime.model is None:
            self._send(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "model is starting"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0") or "0")
            if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
                raise ValueError("request body is missing or too large")
            body = self.rfile.read(content_length)
            payload = json.loads(body)
            items = payload.get("items") if isinstance(payload, dict) else None
            results = embed_items(items)
            self._send(
                HTTPStatus.OK,
                {
                    "provider": "fashionSigLIP",
                    "modelId": MODEL_ID,
                    "modelVersion": MODEL_VERSION,
                    "dimension": runtime.dimension,
                    "device": runtime.device,
                    "items": results,
                },
            )
        except Exception as error:
            self._send(HTTPStatus.BAD_REQUEST, {"error": str(error)})


def main() -> None:
    runtime.load()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        f"FashionSigLIP ready provider=fashionSigLIP model={MODEL_ID} "
        f"version={MODEL_VERSION} dimension={runtime.dimension} device={runtime.device} host={HOST} port={PORT}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
