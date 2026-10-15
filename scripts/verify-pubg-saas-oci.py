#!/usr/bin/env python3
"""Verify that a local OCI archive contains both supported SaaS platforms."""

from __future__ import annotations

import argparse
import json
import tarfile
from pathlib import Path


EXPECTED_PLATFORMS = {"linux/amd64", "linux/arm64"}


def verify(archive_path: Path, expected_labels: dict[str, str] | None = None) -> set[str]:
    platforms: set[str] = set()
    visited: set[str] = set()

    with tarfile.open(archive_path, "r") as archive:
        def inspect(descriptor: dict[str, object]) -> None:
            digest = descriptor.get("digest")
            if not isinstance(digest, str) or not digest.startswith("sha256:"):
                raise ValueError("oci_descriptor_digest_invalid")
            annotations = descriptor.get("annotations")
            annotation_map = annotations if isinstance(annotations, dict) else {}
            # BuildKit emits OCI attestation manifests beside each platform
            # image. They carry provenance, but are not runnable image
            # configs and do not receive the product labels being verified.
            is_attestation = (
                annotation_map.get("vnd.docker.reference.type") == "attestation-manifest"
                or bool(descriptor.get("artifactType"))
            )
            digest_hex = digest.removeprefix("sha256:")
            if digest_hex in visited:
                return
            visited.add(digest_hex)

            blob = archive.extractfile(f"blobs/sha256/{digest_hex}")
            if blob is None:
                raise ValueError("oci_descriptor_blob_missing")
            raw_manifest = blob.read()
            import hashlib

            if hashlib.sha256(raw_manifest).hexdigest() != digest_hex:
                raise ValueError("oci_descriptor_digest_mismatch")
            manifest = json.loads(raw_manifest)

            config_descriptor = manifest.get("config")
            if isinstance(config_descriptor, dict) and not is_attestation:
                config_digest = config_descriptor.get("digest")
                if not isinstance(config_digest, str) or not config_digest.startswith("sha256:"):
                    raise ValueError("oci_config_digest_invalid")
                config_hex = config_digest.removeprefix("sha256:")
                config_blob = archive.extractfile(f"blobs/sha256/{config_hex}")
                if config_blob is None:
                    raise ValueError("oci_config_blob_missing")
                raw_config = config_blob.read()
                if hashlib.sha256(raw_config).hexdigest() != config_hex:
                    raise ValueError("oci_config_digest_mismatch")
                config = json.loads(raw_config)
                os_name = config.get("os")
                architecture = config.get("architecture")
                if isinstance(os_name, str) and isinstance(architecture, str):
                    platforms.add(f"{os_name}/{architecture}")
                if expected_labels is not None:
                    container_config = config.get("config")
                    labels = container_config.get("Labels") if isinstance(container_config, dict) else None
                    if not isinstance(labels, dict):
                        raise ValueError("oci_provenance_labels_missing")
                    for key, expected in expected_labels.items():
                        if labels.get(key) != expected:
                            raise ValueError("oci_provenance_label_mismatch:" + key.rsplit(".", 1)[-1])

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
    parser.add_argument("--expected-revision")
    parser.add_argument("--expected-version")
    parser.add_argument("--expected-build-time")
    args = parser.parse_args()
    expected = None
    supplied = (args.expected_revision, args.expected_version, args.expected_build_time)
    if any(value is not None for value in supplied):
        if not all(supplied):
            parser.error("all three expected provenance labels must be supplied together")
        expected = {
            "com.amadeus.release.provenance": "amadeus-product-release-v1",
            "org.opencontainers.image.revision": args.expected_revision,
            "org.opencontainers.image.version": args.expected_version,
            "org.opencontainers.image.created": args.expected_build_time,
        }
    platforms = verify(args.archive, expected)
    print("PUBG_SAAS_OCI_PLATFORMS=" + ",".join(sorted(EXPECTED_PLATFORMS & platforms)))
    if expected is not None:
        print("PUBG_SAAS_OCI_PROVENANCE=valid")


if __name__ == "__main__":
    main()
