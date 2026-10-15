#!/usr/bin/env python3
"""Fail closed when an image is missing its source/version/build labels."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from typing import Any


LABEL_PREFIX = "org.opencontainers.image."
PROVENANCE_LABEL = "com.amadeus.release.provenance"
PROVENANCE_MARKER = "amadeus-product-release-v1"


def validate(labels: Any, revision: str, version: str, build_time: str) -> None:
    if not isinstance(labels, dict):
        raise ValueError("image labels are not an object")
    expected = {
        PROVENANCE_LABEL: PROVENANCE_MARKER,
        LABEL_PREFIX + "revision": revision,
        LABEL_PREFIX + "version": version,
        LABEL_PREFIX + "created": build_time,
    }
    for key, value in expected.items():
        if labels.get(key) != value:
            raise ValueError(f"OCI label mismatch: {key.rsplit('.', 1)[-1]}")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("source revision must be a full lowercase Git SHA")
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", version):
        raise ValueError("product version must be stable SemVer")
    parsed = datetime.fromisoformat(build_time.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("build timestamp must include a timezone")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--build-time", required=True)
    args = parser.parse_args()
    try:
        labels = json.load(sys.stdin)
        validate(labels, args.revision, args.version, args.build_time)
    except (json.JSONDecodeError, ValueError) as error:
        print(f"IMAGE_PROVENANCE_ERROR={error}", file=sys.stderr)
        return 2
    print(f"IMAGE_PROVENANCE=valid revision={args.revision} version={args.version} builtAt={args.build_time}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
