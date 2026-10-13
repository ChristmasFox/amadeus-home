#!/usr/bin/env python3
"""Verify that a local OCI archive contains both supported SaaS platforms."""

from __future__ import annotations

import argparse
import json
import tarfile
from pathlib import Path


EXPECTED_PLATFORMS = {"linux/amd64", "linux/arm64"}


def verify(archive_path: Path) -> set[str]:
    platforms: set[str] = set()
    visited: set[str] = set()

    with tarfile.open(archive_path, "r") as archive:
        def inspect(descriptor: dict[str, object]) -> None:
            digest = descriptor.get("digest")
            if not isinstance(digest, str) or not digest.startswith("sha256:"):
                raise ValueError("oci_descriptor_digest_invalid")
            digest_hex = digest.removeprefix("sha256:")
            if digest_hex in visited:
                return
            visited.add(digest_hex)

            blob = archive.extractfile(f"blobs/sha256/{digest_hex}")
            if blob is None:
                raise ValueError("oci_descriptor_blob_missing")
            manifest = json.load(blob)

            config_descriptor = manifest.get("config")
            if isinstance(config_descriptor, dict):
                config_digest = config_descriptor.get("digest")
                if not isinstance(config_digest, str) or not config_digest.startswith("sha256:"):
                    raise ValueError("oci_config_digest_invalid")
                config_hex = config_digest.removeprefix("sha256:")
                config_blob = archive.extractfile(f"blobs/sha256/{config_hex}")
                if config_blob is None:
                    raise ValueError("oci_config_blob_missing")
                config = json.load(config_blob)
                os_name = config.get("os")
                architecture = config.get("architecture")
                if isinstance(os_name, str) and isinstance(architecture, str):
                    platforms.add(f"{os_name}/{architecture}")

            children = manifest.get("manifests", [])
            if not isinstance(children, list):
                raise ValueError("oci_manifests_invalid")
            for child in children:
                if not isinstance(child, dict):
                    raise ValueError("oci_child_descriptor_invalid")
                inspect(child)

        index_blob = archive.extractfile("index.json")
        if index_blob is None:
            raise ValueError("oci_index_missing")
        index = json.load(index_blob)
        descriptors = index.get("manifests")
        if not isinstance(descriptors, list) or not descriptors:
            raise ValueError("oci_index_manifests_invalid")
        for descriptor in descriptors:
            if not isinstance(descriptor, dict):
                raise ValueError("oci_index_descriptor_invalid")
            inspect(descriptor)

    missing = EXPECTED_PLATFORMS - platforms
    if missing:
        raise ValueError("oci_platforms_missing:" + ",".join(sorted(missing)))
    return platforms


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    platforms = verify(args.archive)
    print("PUBG_SAAS_OCI_PLATFORMS=" + ",".join(sorted(EXPECTED_PLATFORMS & platforms)))


if __name__ == "__main__":
    main()
