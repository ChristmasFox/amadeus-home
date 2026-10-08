#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import tempfile


SOURCE_REPOSITORY = "alibaba-pai/Qwen-Image-2.1-Fun-Acc-LoRAs"
SOURCE_REVISION = "f7545234760e1847cd8e89e52bd951cb0b7e327f"
SOURCE_NAME = "models/Qwen-Image-2.1-Fun-Acc-4Step.safetensors"
SOURCE_BYTES = 345_632_504
SOURCE_SHA256 = "764c56ae94f330b6d06ccc322f95e1b8ce46424ddde5899a15432f95f720d558"
CONFIG_NAME = "models/pdd_config.json"
CONFIG_BYTES = 11_356
CONFIG_SHA256 = "f798c4a8e9225350e9c46be7a60f397df35e6bb90965d64be76d11e51fd41b97"
CONVERTER_REVISION = "qwen-fun-acc-sdcpp-v1"
SIGMAS = [1.0, 0.9169867038726807, 0.7861579060554504, 0.5494909882545471, 0.0]


class ConversionError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_safetensors_header(path: Path) -> tuple[dict, int, int]:
    size = path.stat().st_size
    with path.open("rb") as stream:
        prefix = stream.read(8)
        if len(prefix) != 8:
            raise ConversionError("safetensors_header_short")
        header_size = struct.unpack("<Q", prefix)[0]
        if header_size < 2 or header_size > min(size - 8, 64 * 1024 * 1024):
            raise ConversionError("safetensors_header_size_invalid")
        try:
            header = json.loads(stream.read(header_size))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ConversionError("safetensors_header_invalid") from error
    if not isinstance(header, dict):
        raise ConversionError("safetensors_header_invalid")
    return header, 8 + header_size, size - 8 - header_size


def validate_config(config: dict) -> None:
    if config.get("pdd_num_steps") != 4 or config.get("pdd_block_size") != 1:
        raise ConversionError("pdd_grid_mismatch")
    if config.get("pdd_sigmas") != SIGMAS:
        raise ConversionError("pdd_sigmas_mismatch")
    if config.get("pdd_sampling_precision") != "native_time_fp32_state":
        raise ConversionError("pdd_sampling_precision_mismatch")
    if config.get("pdd_export_format") != "qwenimage21_extracted_prefused_v1":
        raise ConversionError("pdd_export_format_mismatch")
    if not config.get("pdd_inference_only"):
        raise ConversionError("pdd_inference_only_required")
    if config.get("lora_rank") != 64 or float(config.get("lora_alpha", 0)) != 64.0:
        raise ConversionError("pdd_lora_rank_alpha_mismatch")
    targets = config.get("lora_targets")
    if not isinstance(targets, str) or len(targets.split(",")) != 231:
        raise ConversionError("pdd_lora_targets_mismatch")
    full_parameters = config.get("pdd_full_parameters")
    if not isinstance(full_parameters, list) or len(full_parameters) != 65:
        raise ConversionError("pdd_full_parameters_mismatch")
    expected_full = {
        f"transformer_blocks.{index}.attn.norm_{name}.weight"
        for index in range(32)
        for name in ("k", "q")
    } | {"txt_in.text_norm.weight"}
    if set(full_parameters) != expected_full:
        raise ConversionError("pdd_full_parameter_names_mismatch")


def source_tensor_names(config: dict) -> tuple[set[str], set[str]]:
    targets = set(config["lora_targets"].split(","))
    full_parameters = set(config["pdd_full_parameters"]) | {"proj_out.weight"}
    return (
        {f"{target}.lora_{direction}" for target in targets for direction in ("down", "up")},
        full_parameters,
    )


def mapped_name(source_name: str, lora_names: set[str], full_names: set[str]) -> str:
    if source_name in lora_names:
        base, suffix = source_name.rsplit(".lora_", 1)
        return f"lora.model.diffusion_model.{base}.weight.lora_{suffix}"
    if source_name in full_names:
        return f"fun_acc_pdd.model.diffusion_model.{source_name}"
    raise ConversionError(f"unexpected_source_tensor:{source_name}")


def convert_adapter(
    source_path: Path,
    config_path: Path,
    output_path: Path,
    manifest_path: Path,
    enforce_pins: bool = True,
) -> dict:
    if source_path.is_symlink() or config_path.is_symlink():
        raise ConversionError("source_symlink_forbidden")
    source_size = source_path.stat().st_size
    config_size = config_path.stat().st_size
    source_hash = sha256_file(source_path)
    config_hash = sha256_file(config_path)
    if enforce_pins and (source_size != SOURCE_BYTES or source_hash != SOURCE_SHA256):
        raise ConversionError("source_pin_mismatch")
    if enforce_pins and (config_size != CONFIG_BYTES or config_hash != CONFIG_SHA256):
        raise ConversionError("pdd_config_pin_mismatch")
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ConversionError("pdd_config_invalid") from error
    validate_config(config)

    source_header, data_start, data_size = read_safetensors_header(source_path)
    metadata = source_header.pop("__metadata__", {})
    if not isinstance(metadata, dict) or metadata.get("format") != "qwenimage21_extracted_prefused_v1":
        raise ConversionError("source_format_metadata_mismatch")
    lora_names, full_names = source_tensor_names(config)
    expected_names = lora_names | full_names
    actual_names = set(source_header)
    if actual_names != expected_names:
        missing = sorted(expected_names - actual_names)
        extra = sorted(actual_names - expected_names)
        raise ConversionError(f"source_tensor_set_mismatch:missing={len(missing)}:extra={len(extra)}")

    entries = []
    cursor = 0
    for source_name, tensor in sorted(
        source_header.items(), key=lambda item: item[1].get("data_offsets", [0])[0]
    ):
        if not isinstance(tensor, dict):
            raise ConversionError(f"source_tensor_metadata_invalid:{source_name}")
        dtype = tensor.get("dtype")
        shape = tensor.get("shape")
        offsets = tensor.get("data_offsets")
        if dtype != "BF16" or not isinstance(shape, list) or not shape or not isinstance(offsets, list) or len(offsets) != 2:
            raise ConversionError(f"source_tensor_layout_invalid:{source_name}")
        start, end = offsets
        if not isinstance(start, int) or not isinstance(end, int) or start != cursor or end < start or end > data_size:
            raise ConversionError(f"source_tensor_offsets_invalid:{source_name}")
        if source_name.endswith(".lora_down") and (len(shape) != 2 or shape[0] != 64):
            raise ConversionError(f"source_lora_down_shape_invalid:{source_name}")
        if source_name.endswith(".lora_up") and (len(shape) != 2 or shape[1] != 64):
            raise ConversionError(f"source_lora_up_shape_invalid:{source_name}")
        if source_name == "proj_out.weight" and (len(shape) != 3 or shape[0] != 4):
            raise ConversionError("source_pdd_head_shape_invalid")
        target_name = mapped_name(source_name, lora_names, full_names)
        entries.append((source_name, target_name, dict(tensor), start, end))
        cursor = end
    if cursor != data_size:
        raise ConversionError("source_tensor_data_not_contiguous")
    if output_path.exists() or manifest_path.exists():
        raise ConversionError("output_exists")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    output_header = {}
    target_offset = 0
    for _, target_name, tensor, start, end in entries:
        tensor["data_offsets"] = [target_offset, target_offset + end - start]
        output_header[target_name] = tensor
        target_offset += end - start
    converter_hash = sha256_file(Path(__file__).resolve())
    output_header["__metadata__"] = {
        "format": "qwen_image_2_1_fun_acc_sdcpp_v1",
        "source_repository": SOURCE_REPOSITORY,
        "source_revision": SOURCE_REVISION,
        "source_sha256": source_hash,
        "source_bytes": str(source_size),
        "pdd_config_sha256": config_hash,
        "converter_revision": CONVERTER_REVISION,
    }
    header_bytes = json.dumps(output_header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    header_bytes += b" " * ((-len(header_bytes)) % 8)
    output_partial = None
    try:
        with source_path.open("rb") as source, tempfile.NamedTemporaryFile(
            mode="wb", dir=output_path.parent, prefix=output_path.name + ".", suffix=".partial", delete=False
        ) as output:
            output_partial = Path(output.name)
            output.write(struct.pack("<Q", len(header_bytes)))
            output.write(header_bytes)
            for _, _, _, start, end in entries:
                source.seek(data_start + start)
                remaining = end - start
                while remaining:
                    chunk = source.read(min(8 * 1024 * 1024, remaining))
                    if not chunk:
                        raise ConversionError("source_tensor_data_truncated")
                    output.write(chunk)
                    remaining -= len(chunk)
            output.flush()
            os.fsync(output.fileno())
        os.replace(output_partial, output_path)
    except Exception:
        if output_partial is not None:
            output_partial.unlink(missing_ok=True)
        raise

    manifest = {
        "format": "qwen_image_2_1_fun_acc_sdcpp_v1",
        "sourceRepository": SOURCE_REPOSITORY,
        "sourceRevision": SOURCE_REVISION,
        "sourcePath": str(source_path.resolve()),
        "sourceBytes": source_size,
        "sourceSha256": source_hash,
        "pddConfigBytes": config_size,
        "pddConfigSha256": config_hash,
        "pddNumSteps": config["pdd_num_steps"],
        "pddBlockSize": config["pdd_block_size"],
        "customSigmas": config["pdd_sigmas"],
        "loraGroups": len(config["lora_targets"].split(",")),
        "fullParameterCount": len(config["pdd_full_parameters"]),
        "pddHeadCount": 4,
        "tensorCount": len(entries),
        "converterRevision": CONVERTER_REVISION,
        "converterSha256": converter_hash,
        "outputPath": str(output_path.resolve()),
        "outputBytes": output_path.stat().st_size,
        "outputSha256": sha256_file(output_path),
    }
    with manifest_path.open("x", encoding="utf-8") as manifest_file:
        json.dump(manifest, manifest_file, indent=2, sort_keys=True)
        manifest_file.write("\n")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args(argv)
    result = convert_adapter(args.source, args.config, args.output, args.manifest)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ConversionError, OSError) as error:
        print(f"conversion_failed:{error}", file=sys.stderr)
        raise SystemExit(2)
