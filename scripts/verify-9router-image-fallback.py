#!/usr/bin/env python3
"""Read-only synthetic faults in the exact live 9Router image Combo helper.

No production provider connection, Combo, quota, credential, image payload, or
source file is mutated. This is a fixture of the compiled route path, not a
claim of a live provider failure; pair it with a real amadeus-image smoke.
"""
from __future__ import annotations

import argparse
import json
import subprocess

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESIRED = ROOT / "infra/9router/model-capabilities.json"

FIXTURE = r'''
(async () => {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const models = JSON.parse(process.argv[1]);
  const routePath = '/app/.next/server/app/api/v1/images/generations/route.js';
  const routeSource = fs.readFileSync(routePath, 'utf8');
  assert.ok(routeSource.includes('(0,l.Pr)({body:b,models:r,handleSingleModel:'), 'image route must call Combo helper');
  assert.ok(routeSource.includes('comboName:n,comboStrategy:c'), 'image route must pass per-Combo strategy');
  const route = require(routePath);
  await route.routeModule._lazyUserland.waitUntilLoaded();
  const webpack = require('/app/.next/server/webpack-runtime.js');
  const runCombo = webpack(18910).Pr;
  assert.equal(typeof runCombo, 'function');
  const logicalRequest = { model: 'amadeus-image', prompt: 'synthetic fixture only' };
  const log = { info() {}, warn() {} };
  const image = new Response(JSON.stringify({ created: 1, data: [{ url: 'https://example.invalid/synthetic.png' }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  const failure = (status, message) => new Response(JSON.stringify({ error: { message } }),
    { status, headers: { 'Content-Type': 'application/json' } });
  async function runCase(handler) {
    const calls = [];
    const result = await runCombo({
      body: logicalRequest, models, comboName: 'amadeus-image', comboStrategy: 'fallback', log,
      handleSingleModel: async (body, model) => {
        assert.equal(body, logicalRequest, 'one logical OpenClaw request is retained across internal attempts');
        calls.push(model);
        return handler(model);
      },
    });
    return { calls, result };
  }
  const first = await runCase(() => image.clone());
  assert.equal(first.result.status, 200);
  assert.deepEqual(first.calls, [models[0]], 'healthy first model must not round-robin');
  const primaryUnavailable = await runCase(() => failure(429, 'quota exceeded'));
  assert.equal(primaryUnavailable.result.status, 429);
  assert.deepEqual(primaryUnavailable.calls, models, 'native router keeps one primary; OpenClaw owns local fallback');
  const validation = routeSource.indexOf('Missing required field: prompt');
  const comboLookup = routeSource.indexOf('let r=await (0,g.d_)(n);if(r)');
  assert.ok(validation > 0 && comboLookup > validation,
    'request-scoped missing-prompt 400 must be returned before Combo dispatch');
  // Pinned 9Router's provider-response classifier currently defaults to
  // shouldFallback=true, even for a provider-sourced HTTP 400. This is not
  // misreported as a non-fallback case; only router-level validation rejects
  // the malformed request before attempting either model.
  const upstream400 = await runCase(() => failure(400, 'invalid prompt'));
  assert.deepEqual(upstream400.calls, models);
  assert.equal(upstream400.result.status, 400);
  const safety = await runCase(() => failure(400, 'content policy violation'));
  assert.deepEqual(safety.calls, [models[0]], 'safety refusal must terminate before the OpenClaw local fallback');
  assert.equal(safety.result.status, 400);
  const unavailable = await runCase(() => failure(503, 'capacity unavailable'));
  assert.equal(unavailable.result.ok, false);
  assert.deepEqual(unavailable.calls, models);
  assert.ok((await unavailable.result.json()).error?.message, 'both unavailable return a structured error');
  console.log('NATIVE_9ROUTER_SINGLE_PRIMARY=passed');
  console.log('OPENCLAW_LOCAL_FALLBACK_OWNER=declared');
  console.log('SAFETY_REFUSAL_NO_LOCAL_FALLBACK=passed');
})().catch(() => { console.error('EXACT_IMAGE_COMBO_FALLBACK_PATH=failed'); process.exitCode = 1; });
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--machine", default="nyannyan")
    args = parser.parse_args()
    desired = json.loads(DESIRED.read_text())["image"]
    if desired != {
        "name": "amadeus-image", "kind": "image", "strategy": "fallback",
        "models": ["cx/gpt-image-2.5-sunburst", "cx/gpt-image-2.5-flare", "cx/gpt-image-2.5"],
    }:
        raise SystemExit("desired image chain differs from this pinned acceptance fixture")
    result = subprocess.run(
        ["orb", "-m", args.machine, "-u", "root", "docker", "exec", "9router", "node", "-e", FIXTURE, json.dumps(desired["models"])],
        capture_output=True, text=True, timeout=45,
    )
    lines = result.stdout.strip().splitlines()
    if result.returncode or lines != ["NATIVE_9ROUTER_SINGLE_PRIMARY=passed",
                                     "OPENCLAW_LOCAL_FALLBACK_OWNER=declared",
                                     "SAFETY_REFUSAL_NO_LOCAL_FALLBACK=passed"]:
        raise SystemExit("exact live 9Router image Combo fixture failed (no provider/account state was changed)")
    print("\n".join(lines))
    print("LIVE_FAULT_INJECTION=not_performed; provider/account state untouched")


if __name__ == "__main__":
    main()
