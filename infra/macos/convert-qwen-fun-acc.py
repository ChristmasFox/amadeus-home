#!/usr/bin/env python3
"""Extract the PDD heads and full-parameter overrides for stable-diffusion.cpp."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import tempfile

SOURCE_REPOSITORY = "alibaba-pai/Qwen-Image-2.1-Fun-Acc-LoRAs"
SOURCE_REVISION = "f7545234760e1847cd8e89e52bd951cb0b7e327f"
SIGMAS = (1.0, 0.9169867038726807, 0.7861579060554504, 0.5494909882545471, 0.0)
LORA_RANK = 64
LORA_PAIR_COUNT = 231
HEAD_NAME = "proj_out.weight"
HEAD_SHAPE = [4, 64, 4096]
HEADER_LIMIT = 8 * 1024 * 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class ConversionError(ValueError):
    pass


def expected_override_names() -> dict[str, tuple[str, list[int]]]:
    names: dict[str, tuple[str, list[int]]] = {
        "fun_acc_proj_out.weight": (HEAD_NAME, HEAD_SHAPE),
        "txt_in.fun_acc_text_norm.weight": ("txt_in.text_norm.weight", [4096]),
    }
    for layer in range(32):
        for kind in ("q", "k"):
            source = f"transformer_blocks.{layer}.attn.norm_{kind}.weight"
            names[f"transformer_blocks.{layer}.attn.fun_acc_norm_{kind}.weight"] = (source, [128])
    return names


def expected_lora_targets() -> set[str]:
    targets = {
        "img_in",
        "modulation.1",
        "norm_out.linear",
        "time_text_embed.timestep_embedder.linear_1",
        "time_text_embed.timestep_embedder.linear_2",
        "txt_in.in_layer",
        "txt_in.out_layer",
    }
    for layer in range(32):
        targets.update(
            {
                f"transformer_blocks.{layer}.attn.to_k",
                f"transformer_blocks.{layer}.attn.to_out.0",
                f"transformer_blocks.{layer}.attn.to_q",
                f"transformer_blocks.{layer}.attn.to_v",
                f"transformer_blocks.{layer}.img_mlp.gate_layer",
                f"transformer_blocks.{layer}.img_mlp.out",
                f"transformer_blocks.{layer}.img_mlp.proj",
            }
        )
    return targets


def read_safetensors_header(stream) -> tuple[dict, int, int]:
    prefix = stream.read(8)
    if len(prefix) != 8:
        raise ConversionError("safetensors_header_truncated")
    header_size = struct.unpack("<Q", prefix)[0]
    if header_size <= 2 or header_size > HEADER_LIMIT:
        raise ConversionError("safetensors_header_size_invalid")
    raw_header = stream.read(header_size)
    if len(raw_header) != header_size:
        raise ConversionError("safetensors_header_truncated")
    try:
        header = json.loads(raw_header)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ConversionError("safetensors_header_invalid") from exc
    if not isinstance(header, dict):
        raise ConversionError("safetensors_header_invalid")
    return header, 8 + header_size, header_size


def validate_header(header: dict, data_bytes: int, expected_lora_pairs: int = LORA_PAIR_COUNT) -> dict[str, tuple[str, dict]]:
    required = expected_override_names()
    actual_lora: dict[str, set[str]] = {}
    actual_special = set()
    for name, entry in header.items():
        if name == "__metadata__":
            continue
        if name in {source for source, _ in required.values()}:
            actual_special.add(name)
        for suffix in (".lora_down", ".lora_up"):
            if name.endswith(suffix):
                actual_lora.setdefault(name[: -len(suffix)], set()).add(suffix)
                break

        offsets = entry.get("data_offsets") if isinstance(entry, dict) else None
        shape = entry.get("shape") if isinstance(entry, dict) else None
        if (not isinstance(offsets, list) or len(offsets) != 2 or
                not all(isinstance(value, int) for value in offsets) or
                offsets[0] < 0 or offsets[1] < offsets[0] or offsets[1] > data_bytes or
                not isinstance(shape, list) or not all(isinstance(value, int) and value > 0 for value in shape)):
            raise ConversionError(f"tensor_metadata_invalid:{name}")

    expected_special = {source for source, _ in required.values()}
    if actual_special != expected_special:
        raise ConversionError("pdd_override_tensor_set_mismatch")
    for output_name, (source_name, shape) in required.items():
        entry = header[source_name]
        if entry.get("dtype") != "BF16" or entry.get("shape") != shape:
            raise ConversionError(f"pdd_override_tensor_invalid:{source_name}")

    expected_targets = expected_lora_targets()
    if set(actual_lora) != expected_targets or any(parts != {".lora_down", ".lora_up"} for parts in actual_lora.values()):
        raise ConversionError("pdd_lora_tensor_set_mismatch")
    if len(actual_lora) != expected_lora_pairs:
        raise ConversionError("pdd_lora_pair_count_mismatch")
    for target in expected_targets:
        down = header[f"{target}.lora_down"]
        up = header[f"{target}.lora_up"]
        if down.get("dtype") != "BF16" or up.get("dtype") != "BF16":
            raise ConversionError(f"pdd_lora_dtype_invalid:{target}")
        down_shape = down.get("shape", [])
        up_shape = up.get("shape", [])
        if len(down_shape) != 2 or len(up_shape) != 2 or down_shape[0] != LORA_RANK or up_shape[1] != LORA_RANK or down_shape[1] != up_shape[0]:
            raise ConversionError(f"pdd_lora_shape_invalid:{target}")

    expected_names = expected_special | {f"{target}.lora_{part}" for target in expected_targets for part in ("down", "up")}
    actual_names = set(header) - {"__metadata__"}
    if actual_names != expected_names:
        raise ConversionError("pdd_adapter_tensor_set_mismatch")
    return {output_name: (source_name, header[source_name]) for output_name, (source_name, _) in required.items()}


def convert_adapter(source: Path, destination: Path, expected_sha256: str | None = None,
                    expected_lora_pairs: int = LORA_PAIR_COUNT) -> dict[str, object]:
    if source.is_symlink() or not source.is_file():
        raise ConversionError("pdd_adapter_source_invalid")
    source_digest = hashlib.sha256()
    with source.open("rb") as stream:
        header, data_start, _ = read_safetensors_header(stream)
        source_bytes = source.stat().st_size
        data_bytes = source_bytes - data_start
        selected = validate_header(header, data_bytes, expected_lora_pairs)
        stream.seek(0)
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            source_digest.update(chunk)
    source_sha256 = source_digest.hexdigest()
    if expected_sha256 is not None and (not SHA256_RE.fullmatch(expected_sha256) or source_sha256 != expected_sha256):
        raise ConversionError("pdd_adapter_source_hash_mismatch")

    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    ordered = sorted(selected.items())
    output_header: dict[str, object] = {
        "__metadata__": {
            "format": "amadeus_qwen_image_2_1_fun_acc_pdd_overlay_v1",
            "source_repository": SOURCE_REPOSITORY,
            "source_revision": SOURCE_REVISION,
            "source_sha256": source_sha256,
            "pdd_num_steps": "4",
            "pdd_block_size": "1",
            "pdd_sigmas": ",".join(str(value) for value in SIGMAS),
            "lora_rank": str(LORA_RANK),
            "lora_alpha": str(LORA_RANK),
        }
    }
    cursor = 0
    for output_name, (_, entry) in ordered:
        data_length = entry["data_offsets"][1] - entry["data_offsets"][0]
        output_header[output_name] = {
            "dtype": entry["dtype"],
            "shape": entry["shape"],
            "data_offsets": [cursor, cursor + data_length],
        }
        cursor += data_length
    encoded_header = json.dumps(output_header, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    if len(encoded_header) > HEADER_LIMIT:
        raise ConversionError("overlay_header_too_large")

    overlay_digest = hashlib.sha256()
    with tempfile.NamedTemporaryFile(prefix=f".{destination.name}.", dir=destination.parent, delete=False) as output:
        temporary_path = Path(output.name)
        os.chmod(temporary_path, 0o600)
        output.write(struct.pack("<Q", len(encoded_header)))
        output.write(encoded_header)
        overlay_digest.update(struct.pack("<Q", len(encoded_header)))
        overlay_digest.update(encoded_header)
        with source.open("rb") as input_stream:
            for output_name, (source_name, entry) in ordered:
                start, end = entry["data_offsets"]
                input_stream.seek(data_start + start)
                remaining = end - start
                while remaining:
                    chunk = input_stream.read(min(8 * 1024 * 1024, remaining))
                    if not chunk:
                        raise ConversionError(f"pdd_adapter_tensor_truncated:{source_name}")
                    output.write(chunk)
                    overlay_digest.update(chunk)
                    remaining -= len(chunk)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary_path, destination)
    os.chmod(destination, 0o600)
    return {
        "sourceBytes": source_bytes,
        "sourceSha256": source_sha256,
        "overlayBytes": destination.stat().st_size,
        "overlaySha256": overlay_digest.hexdigest(),
        "overlayTensorCount": len(selected),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--expected-source-sha256")
    args = parser.parse_args()
    result = convert_adapter(args.source, args.destination, args.expected_source_sha256)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ConversionError as exc:
        raise SystemExit(str(exc)) from exc
