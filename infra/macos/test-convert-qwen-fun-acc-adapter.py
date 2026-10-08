from __future__ import annotations

import json
from pathlib import Path
import struct
import tempfile
import unittest

import importlib.util


MODULE_PATH = Path(__file__).with_name("convert-qwen-fun-acc-adapter.py")
SPEC = importlib.util.spec_from_file_location("qwen_fun_acc_converter", MODULE_PATH)
converter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(converter)


def write_fixture(path: Path, tensors: dict[str, tuple[list[int], bytes]]) -> None:
    header = {"__metadata__": {"format": "qwenimage21_extracted_prefused_v1"}}
    cursor = 0
    payload = bytearray()
    for name, (shape, raw) in tensors.items():
        header[name] = {"dtype": "BF16", "shape": shape, "data_offsets": [cursor, cursor + len(raw)]}
        cursor += len(raw)
        payload.extend(raw)
    encoded = json.dumps(header, separators=(",", ":")).encode()
    encoded += b" " * ((-len(encoded)) % 8)
    path.write_bytes(struct.pack("<Q", len(encoded)) + encoded + payload)


def fixture_config() -> dict:
    return {
        "pdd_num_steps": 4,
        "pdd_block_size": 1,
        "pdd_sigmas": converter.SIGMAS,
        "pdd_sampling_precision": "native_time_fp32_state",
        "pdd_export_format": "qwenimage21_extracted_prefused_v1",
        "pdd_inference_only": True,
        "lora_rank": 64,
        "lora_alpha": 64.0,
        "lora_targets": ",".join(
            [f"transformer_blocks.{index}.attn.to_q" for index in range(231)]
        ),
        "pdd_full_parameters": [
            f"transformer_blocks.{index}.attn.norm_{name}.weight"
            for index in range(32)
            for name in ("k", "q")
        ] + ["txt_in.text_norm.weight"],
    }


class ConverterTests(unittest.TestCase):
    def test_maps_lora_and_pdd_tensors_without_changing_payloads(self):
        config = fixture_config()
        tensors = {}
        targets = config["lora_targets"].split(",")
        for index, target in enumerate(targets):
            tensors[f"{target}.lora_down"] = ([64, 1], bytes([index % 256, 1]) * 64)
            tensors[f"{target}.lora_up"] = ([1, 64], bytes([index % 256, 2]) * 64)
        for index, name in enumerate(config["pdd_full_parameters"]):
            length = 4096 if name == "txt_in.text_norm.weight" else 128
            tensors[name] = ([length], bytes([index % 256, 3]) * length)
        tensors["proj_out.weight"] = ([4, 1, 1], b"\x05\x06" * 4)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.safetensors"
            config_path = root / "pdd_config.json"
            output = root / "converted.safetensors"
            manifest = root / "manifest.json"
            write_fixture(source, tensors)
            config_path.write_text(json.dumps(config))

            result = converter.convert_adapter(source, config_path, output, manifest, enforce_pins=False)

            header, data_start, _ = converter.read_safetensors_header(output)
            self.assertEqual(result["tensorCount"], 528)
            self.assertEqual(
                len(set(header) - {"__metadata__"}),
                528,
            )
            with output.open("rb") as stream:
                source_lora, source_full = converter.source_tensor_names(config)
                sampled_names = list(tensors)[:4] + ["proj_out.weight"]
                for name in sampled_names:
                    _, expected = tensors[name]
                    mapped = converter.mapped_name(
                        name,
                        source_lora,
                        source_full,
                    )
                    start, end = header[mapped]["data_offsets"]
                    stream.seek(data_start + start)
                    self.assertEqual(stream.read(end - start), expected)

    def test_rejects_nonofficial_sigma_grid(self):
        config = fixture_config()
        config["pdd_sigmas"] = [1.0, 0.75, 0.5, 0.25, 0.0]
        with self.assertRaisesRegex(converter.ConversionError, "pdd_sigmas_mismatch"):
            converter.validate_config(config)


if __name__ == "__main__":
    unittest.main()
