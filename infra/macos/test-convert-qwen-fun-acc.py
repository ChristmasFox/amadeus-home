import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

MODULE_PATH = Path(__file__).with_name("convert-qwen-fun-acc.py")
SPEC = importlib.util.spec_from_file_location("convert_qwen_fun_acc", MODULE_PATH)
CONVERTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONVERTER)


def write_fixture(path: Path) -> dict[str, bytes]:
    tensors = {}
    for output_name, (source_name, shape) in CONVERTER.expected_override_names().items():
        size = 2
        for dim in shape:
            size *= dim
        tensors[source_name] = {
            "dtype": "BF16",
            "shape": shape,
            "data_offsets": [0, size],
        }
    for target in CONVERTER.expected_lora_targets():
        tensors[f"{target}.lora_down"] = {"dtype": "BF16", "shape": [64, 64], "data_offsets": [0, 8192]}
        tensors[f"{target}.lora_up"] = {"dtype": "BF16", "shape": [64, 64], "data_offsets": [0, 8192]}
    encoded = json.dumps(tensors, separators=(",", ":"), sort_keys=True).encode()
    cursor = 0
    payload = bytearray()
    for entry in tensors.values():
        length = entry["data_offsets"][1] - entry["data_offsets"][0]
        entry["data_offsets"] = [cursor, cursor + length]
        payload.extend(b"\0" * length)
        cursor += length
    encoded = json.dumps(tensors, separators=(",", ":"), sort_keys=True).encode()
    path.write_bytes(struct.pack("<Q", len(encoded)) + encoded + payload)
    return {name: b"\0" * (entry["data_offsets"][1] - entry["data_offsets"][0]) for name, entry in tensors.items()}


class FunAccConverterTests(unittest.TestCase):
    def test_extracts_only_exact_pdd_heads_and_overrides_deterministically(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.safetensors"
            output = root / "overlay.safetensors"
            write_fixture(source)
            first = CONVERTER.convert_adapter(source, output, expected_lora_pairs=231)
            first_bytes = output.read_bytes()
            second = CONVERTER.convert_adapter(source, output, expected_lora_pairs=231)
            self.assertEqual(first, second)
            self.assertEqual(first["overlayTensorCount"], 66)
            self.assertEqual(first["sourceSha256"], hashlib.sha256(source.read_bytes()).hexdigest())
            header_size = struct.unpack("<Q", first_bytes[:8])[0]
            header = json.loads(first_bytes[8 : 8 + header_size])
            self.assertEqual(set(header) - {"__metadata__"}, set(CONVERTER.expected_override_names()))
            self.assertEqual(
                header["__metadata__"]["pdd_sigmas"],
                ",".join(str(value) for value in CONVERTER.SIGMAS),
            )
            self.assertEqual(hashlib.sha256(first_bytes).hexdigest(), second["overlaySha256"])

    def test_rejects_missing_lora_pair_or_wrong_output_head_shape(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.safetensors"
            output = root / "overlay.safetensors"
            write_fixture(source)
            raw = source.read_bytes()
            header_size = struct.unpack("<Q", raw[:8])[0]
            header = json.loads(raw[8 : 8 + header_size])
            del header["img_in.lora_up"]
            encoded = json.dumps(header, separators=(",", ":"), sort_keys=True).encode()
            source.write_bytes(struct.pack("<Q", len(encoded)) + encoded + raw[8 + header_size :])
            with self.assertRaisesRegex(CONVERTER.ConversionError, "pdd_lora_tensor_set_mismatch"):
                CONVERTER.convert_adapter(source, output, expected_lora_pairs=231)

            write_fixture(source)
            raw = source.read_bytes()
            header_size = struct.unpack("<Q", raw[:8])[0]
            header = json.loads(raw[8 : 8 + header_size])
            header["proj_out.weight"]["shape"] = [4, 63, 4096]
            encoded = json.dumps(header, separators=(",", ":"), sort_keys=True).encode()
            source.write_bytes(struct.pack("<Q", len(encoded)) + encoded + raw[8 + header_size :])
            with self.assertRaisesRegex(CONVERTER.ConversionError, "pdd_override_tensor_invalid:proj_out.weight"):
                CONVERTER.convert_adapter(source, output, expected_lora_pairs=231)


if __name__ == "__main__":
    unittest.main()
