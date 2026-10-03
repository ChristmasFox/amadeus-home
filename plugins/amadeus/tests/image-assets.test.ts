import test from 'node:test';
import assert from 'node:assert/strict';
import { repairInboundReferenceParams } from '../src/image-assets.js';

test('rebinds model-authored inbound staging paths to the current channel path', () => {
  const canonical = '/home/node/.openclaw/workspace/media/inbound/openclaw-staged-abfbb217-c172-4987/input-reference.jpg';
  const malformed = '/home/node/.openclaw/workspace/media/inbound/openclaw-staged-abfbb217c172-4987/input-reference.jpg';
  const repaired = repairInboundReferenceParams({ image: malformed }, canonical);
  assert.deepEqual(repaired, { image: canonical });
});

test('does not rewrite durable generated paths and deduplicates inbound arrays', () => {
  const canonical = '/home/node/.openclaw/workspace/media/inbound/openclaw-staged-current/input-reference.png';
  const malformed = '/home/node/.openclaw/workspace/media/inbound/openclaw-staged-current/input-reference.pngx';
  const durable = '/home/node/.openclaw/media/tool-image-generation/generated.png';
  assert.equal(repairInboundReferenceParams({ image: durable }, canonical), undefined);
  assert.deepEqual(repairInboundReferenceParams({ images: [malformed, '/tmp/other.png', canonical] }, canonical), {
    images: [canonical, '/tmp/other.png'],
  });
});
