#!/usr/bin/env python3
"""Authenticated prompt-only amadeus-image transport smoke from OpenClaw.

A real paid image request requires --apply. Binary/base64 stays in the remote
process memory and is discarded; only bounded content-safe metadata is printed.
This is a transport check, not real Agent selection or group-channel delivery.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import subprocess

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESIRED = ROOT / "infra/9router/model-capabilities.json"
IMAGE_TIMEOUT_SECONDS = 600

SMOKE = r'''
(async () => {
  const key = process.env.OPENCLAW_9ROUTER_API_KEY?.trim();
  if (!key) throw new Error('AUTH_MISSING');
  const response = await fetch('http://9router:20128/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'amadeus-image', prompt: 'A simple blue geometric circle on a clean white background, no text.', n: 1, size: '1024x1024' }),
    signal: AbortSignal.timeout(600000),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.data) || payload.data.length !== 1) throw new Error('IMAGE_COUNT_INVALID');
  const item = payload.data[0];
  let encoded = typeof item.b64_json === 'string' ? item.b64_json : '';
  if (!encoded && typeof item.url === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/i.test(item.url)) {
    encoded = item.url.slice(item.url.indexOf(',') + 1);
  }
  if (!encoded || encoded.length > 30000000) throw new Error('NO_BOUNDED_INLINE_IMAGE');
  const bytes = Buffer.from(encoded, 'base64');
  const kind = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpeg'
    : bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'webp' : '';
  if (!kind || bytes.length < 1000) throw new Error('IMAGE_BYTES_INVALID');
  console.log(JSON.stringify({ status: 'passed', model: 'amadeus-image', items: 1, format: kind, bytes: bytes.length }));
})().catch((error) => { const safe = /^(?:HTTP_\d+|AUTH_MISSING|IMAGE_COUNT_INVALID|NO_BOUNDED_INLINE_IMAGE|IMAGE_BYTES_INVALID)$/.test(error.message) ? error.message : 'FAILED'; console.error('IMAGE_SMOKE=' + safe); process.exitCode = 1; });
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="send one real paid image request; default is plan-only")
    parser.add_argument("--machine", default="nyannyan")
    args = parser.parse_args()
    desired = json.loads(DESIRED.read_text())["image"]
    if desired["name"] != "amadeus-image" or desired["models"] != ["cx/gpt-image-2.5-sunburst"]:
        raise SystemExit("desired image Combo no longer matches the pinned smoke")
    if not args.apply:
        print("MODE=dry-run; no authenticated image request")
        print("NETWORK_CONTEXT=openclaw container -> 9router:20128; model=amadeus-image; prompt-only new image")
        return
    since = datetime.now(timezone.utc).isoformat()
    result = subprocess.run(
        ["orb", "-m", args.machine, "-u", "root", "docker", "exec", "openclaw", "node", "-e", SMOKE],
        capture_output=True, text=True, timeout=IMAGE_TIMEOUT_SECONDS + 60,
    )
    if result.returncode:
        diagnostic = result.stderr.strip().splitlines()[-1:] or ["unknown"]
        raise SystemExit("authenticated image smoke failed: " + diagnostic[0])
    try:
        evidence = json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        raise SystemExit("authenticated image smoke did not return content-safe evidence") from None
    if evidence.get("status") != "passed" or evidence.get("model") != "amadeus-image" or evidence.get("items") != 1:
        raise SystemExit("authenticated image smoke evidence invalid")
    print("IMAGE_SMOKE=passed")
    print("IMAGE_FORMAT=" + evidence["format"])
    print("IMAGE_BYTES=" + str(evidence["bytes"]))
    logs = subprocess.run(
        ["orb", "-m", args.machine, "-u", "root", "docker", "logs", "--since", since, "9router"],
        capture_output=True, text=True, timeout=30,
    )
    output = logs.stdout + logs.stderr if logs.returncode == 0 else ""
    first = 'Trying model 1/1: cx/gpt-image-2.5-sunburst' in output
    first_ok = 'Model cx/gpt-image-2.5-sunburst succeeded' in output
    print("FIRST_BACKEND_ATTEMPT=" + ("observed" if first else "unverified"))
    print("FIRST_BACKEND_SUCCESS=" + ("observed" if first_ok else "unverified"))
    print("GENERATED_MEDIA=memory_only_not_retained")


if __name__ == "__main__":
    main()
