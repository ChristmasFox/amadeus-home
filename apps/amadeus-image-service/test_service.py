from __future__ import annotations

import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from service import AssetStore, ServiceError, inspect_image


def png(width: int, height: int, color: bytes = b"\xff\x00\x00") -> bytes:
    raw = b"".join(b"\x00" + color * width for _ in range(height))

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


class FakeEngine:
    name = "fake-accelerated-test"

    def readiness(self):
        return {"status": "ready", "engine": self.name, "accelerator": "test"}

    def upscale(self, source: Path, destination: Path, scale: int, mode: str) -> None:
        data = source.read_bytes()
        _, width, height = inspect_image(data, "image/png")
        destination.write_bytes(png(width * scale, height * scale, b"\x00\xff\x00" if mode == "anime" else b"\x00\x00\xff"))


class AssetServiceTests(unittest.TestCase):
    def test_png_registry_and_traversal_defense(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AssetStore(directory, engine=FakeEngine())
            asset = store.register(png(3, 2), "image/png", "generated", {"conversationId": "session-a"})
            self.assertTrue(asset.image_id.startswith("img_"))
            self.assertEqual((asset.width, asset.height), (3, 2))
            self.assertEqual(store.path_for(asset.storage_key).read_bytes(), png(3, 2))
            with self.assertRaises(ServiceError):
                store.path_for("../escape.png")
            with self.assertRaises(ServiceError):
                store.get("img_00000000000000000000000000000000")

    def test_reply_precedes_recent_image(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AssetStore(directory, engine=FakeEngine())
            older = store.register(png(2, 2), "image/png", "generated", {"conversationId": "session-a", "messageId": "old-message"})
            newer = store.register(png(2, 2), "image/png", "generated", {"conversationId": "session-a", "messageId": "new-message"})
            self.assertEqual(store.resolve(conversation_id="session-a", reply_message_id="old-message").image_id, older.image_id)
            self.assertEqual(store.resolve(conversation_id="session-a").image_id, newer.image_id)

    def test_recent_resolution_is_conversation_scoped(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AssetStore(directory, engine=FakeEngine())
            first = store.register(png(2, 2), "image/png", "generated", {"conversationId": "session-a"})
            store.register(png(2, 2), "image/png", "generated", {"conversationId": "session-b"})
            self.assertEqual(store.resolve(conversation_id="session-a").image_id, first.image_id)
            with self.assertRaises(ServiceError):
                store.resolve(conversation_id="session-c")

    def test_upscale_preserves_original_and_records_lineage(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AssetStore(directory, engine=FakeEngine())
            original = store.register(png(4, 3), "image/png", "generated", {"conversationId": "session-a", "styleHint": "anime"})
            derived = store.upscale(original.image_id, None, None, 2, "auto")
            self.assertEqual(derived.parent_image_id, original.image_id)
            self.assertEqual((derived.width, derived.height), (8, 6))
            self.assertEqual(derived.transform["profile"], "anime")
            self.assertEqual(store.get(original.image_id).storage_key, original.storage_key)
            self.assertNotEqual(derived.storage_key, original.storage_key)

    def test_omitted_multiplier_defaults_to_4_and_explicit_2_remains_2(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AssetStore(directory, engine=FakeEngine())
            original = store.register(png(4, 3), "image/png", "generated")
            default = store.upscale(original.image_id, None, None, None, "auto")
            self.assertEqual((default.width, default.height), (16, 12))
            self.assertEqual(default.transform["scale"], 4)
            two = store.upscale(original.image_id, None, None, 2, "auto")
            self.assertEqual((two.width, two.height), (8, 6))
            self.assertEqual(two.transform["scale"], 2)

    def test_default_4x_respects_output_pixel_limit_without_2x_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AssetStore(directory, engine=FakeEngine(), max_output_pixels=100)
            original = store.register(png(4, 4), "image/png", "generated")
            with self.assertRaises(ServiceError) as rejected:
                store.upscale(original.image_id, None, None, None, "auto")
            self.assertEqual(rejected.exception.code, "image_output_limit_exceeded")

    def test_4k_resolution_profile_caps_long_edge(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AssetStore(directory, engine=FakeEngine())
            original = store.register(png(640, 960), "image/png", "generated")
            derived = store.upscale(original.image_id, None, None, None, "realistic", "4k")
            self.assertEqual((derived.width, derived.height), (2560, 3840))
            self.assertEqual(derived.transform["scale"], 4)
            self.assertEqual(derived.transform["resolution"], "4k")

    def test_bounds_and_invalid_types_fail_closed(self):
        with self.assertRaises(ServiceError):
            inspect_image(b"not-an-image", "image/png")
        with tempfile.TemporaryDirectory() as directory:
            store = AssetStore(directory, engine=FakeEngine())
            original = store.register(png(2, 2), "image/png", "generated")
            with self.assertRaises(ServiceError):
                store.upscale(original.image_id, None, None, 3, "auto")
            with self.assertRaises(ServiceError):
                store.upscale(original.image_id, None, None, 2, "watercolor")


if __name__ == "__main__":
    unittest.main()
