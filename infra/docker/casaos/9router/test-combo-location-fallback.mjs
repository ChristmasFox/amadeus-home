#!/usr/bin/env node
import assert from 'node:assert/strict';
import { MARKER, patchLocationFallbackSource } from './patch-combo-location-fallback.mjs';

const source = 'const retry=[{text:"overloaded",backoff:!0},{status:404,cooldownMs:12e4}];';
const patched = patchLocationFallbackSource(source);
assert.match(patched, new RegExp(MARKER));
assert.match(patched, /user location is not supported/u);
assert.match(patched, /location is not supported for the api/u);
assert.match(patched, /failed_precondition/u);
assert.equal(patchLocationFallbackSource(patched), patched);
assert.throws(() => patchLocationFallbackSource(source.replace('{text:"overloaded",backoff:!0}', '{text:"overloaded",backoff:!0},{text:"overloaded",backoff:!0}')), /combo_location_fallback_anchor_drift/u);
assert.equal(patchLocationFallbackSource('const unrelated={status:404};'), 'const unrelated={status:404};');
console.log('COMBO_LOCATION_FALLBACK_PATCH_0_5_104=passed');
