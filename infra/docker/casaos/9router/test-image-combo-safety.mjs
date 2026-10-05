#!/usr/bin/env node
import assert from 'node:assert/strict';
import { isImageSafetyFailure, MARKER, patchImageComboSource } from './patch-image-combo-safety.mjs';

assert.equal(isImageSafetyFailure(400, 'content policy violation'), true);
assert.equal(isImageSafetyFailure(403, 'safety refusal'), true);
assert.equal(isImageSafetyFailure(502, 'upstream unavailable'), false);
assert.equal(isImageSafetyFailure(400, 'invalid prompt'), false);
const source = 'let{shouldFallback:i,cooldownMs:j}=(0,d.hk)(b.status,f);';
const patched = patchImageComboSource(source);
assert.match(patched, new RegExp(MARKER));
assert.match(patched, /safety refusal; no fallback/);
assert.equal(patchImageComboSource(patched), patched);
console.log('IMAGE_COMBO_SAFETY_PATCH=passed');
