#!/usr/bin/env python3
"""Protected loopback 9Router management API client shared by provisioners.

The existing 9Router local CLI auth boundary is used; tokens and provider
credentials are never emitted to stdout, Git, or a checkpoint.
"""
from __future__ import annotations

import http.cookiejar
import json
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request


def protected(path: str) -> str:
    file = Path(path)
    if not file.is_file() or file.stat().st_mode & 0o077:
        raise ValueError("secret_file_missing_or_not_private")
    data = file.read_text().strip()
    if not data:
        raise ValueError("secret_file_empty")
    return data


def local_cli_token(machine: str) -> str:
    # Pinned 0.5.81's getConsistentMachineId("9r-cli-auth") uses the persisted
    # machine-id plus random cli-secret. Derive inside the container; only the
    # short token crosses to this local API client and is never printed.
    code = """const fs=require('node:fs'),crypto=require('node:crypto');
const raw=fs.readFileSync('/app/data/machine-id','utf8').trim();
const secret=fs.readFileSync('/app/data/auth/cli-secret','utf8').trim();
process.stdout.write(crypto.createHash('sha256').update(raw+'9r-cli-auth'+secret).digest('hex').slice(0,16));"""
    result = subprocess.run(["orb", "-m", machine, "-u", "root", "docker", "exec", "9router", "node", "-e", code],
                            capture_output=True, timeout=12, check=True)
    token = result.stdout.decode().strip()
    if not re.fullmatch(r"[a-f0-9]{16}", token):
        raise RuntimeError("local_cli_token_unavailable")
    return token


class Dashboard:
    def __init__(self, base: str, cli_token: str | None = None):
        if base != "http://127.0.0.1:20128":
            raise ValueError("dashboard_must_be_loopback")
        self.base = base
        self.cli_token = cli_token
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, method: str, path: str, body: dict | None = None) -> dict:
        if not path.startswith("/") or path.startswith("//") or "?" in path:
            raise ValueError("dashboard_path_must_be_local")
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"} if data is not None else {}
        if self.cli_token:
            headers["x-9r-cli-token"] = self.cli_token
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=15) as res:
                return json.load(res)
        except urllib.error.HTTPError as exc:
            # Never forward upstream bodies; they may echo a credential.
            raise RuntimeError(f"dashboard_http_{exc.code} route={path}") from None

    def login(self, password: str) -> None:
        self.request("POST", "/api/auth/login", {"password": password})
