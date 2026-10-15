#!/usr/bin/env python3
"""Fail closed unless Gate's PostgreSQL test target is a loopback test database."""

from __future__ import annotations

import ipaddress
import os
import sys
from urllib.parse import unquote, urlsplit


def validate_test_database_url(value: str | None) -> str | None:
    if not value:
        return "missing"
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        parsed.port  # Force validation of malformed/out-of-range ports.
    except ValueError:
        return "malformed"
    if parsed.scheme.lower() not in {"postgres", "postgresql"}:
        return "scheme"
    # libpq-style URI parameters can override connection fields such as host.
    # Gate tests need no URI options, so reject them instead of trying to
    # interpret every driver's precedence rules.
    if parsed.query or parsed.fragment:
        return "query_parameters"
    if not hostname:
        return "host"
    normalized_host = hostname.lower().rstrip(".")
    if normalized_host != "localhost":
        try:
            if not ipaddress.ip_address(normalized_host).is_loopback:
                return "host"
        except ValueError:
            return "host"
    database = unquote(parsed.path.lstrip("/"))
    if not database or "/" in database:
        return "database_name"
    normalized_database = database.lower()
    if normalized_database not in {"test", "testing"} and not normalized_database.endswith(("_test", "_testing")):
        return "database_name"
    return None


def main() -> int:
    error = validate_test_database_url(os.environ.get("PUBG_SAAS_TEST_DATABASE_URL"))
    if error:
        print(f"GATE_TEST_DATABASE=BLOCKED reason={error}", file=sys.stderr)
        return 2
    print("GATE_TEST_DATABASE=SAFE target=loopback test_database=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
