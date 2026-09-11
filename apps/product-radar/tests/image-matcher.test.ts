import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { PerceptualImageMatcher } from '../src/integrations/images/perceptual-matcher.js';

async function solid(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 48, height: 48, channels: 3, background: color } }).png().toBuffer();
}

test('perceptual matcher persists a reference feature and ranks visually similar images', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'product-radar-image-'));
  try {
    const reference = await solid({ r: 20, g: 20, b: 20 });
    const near = await solid({ r: 28, g: 28, b: 28 });
    const different = await solid({ r: 220, g: 220, b: 220 });
    const imageMap = new Map<string, Buffer>([['https://image.test/near.png', near], ['https://image.test/different.png', different]]);
    const matcher = new PerceptualImageMatcher({
      dataDir: directory,
      fetchImpl: async (input) => new Response(new Uint8Array(imageMap.get(String(input)) ?? Buffer.alloc(0))),
    });
    const prepared = await matcher.prepareReference({ base64: `data:image/png;base64,${reference.toString('base64')}` });
    assert.equal(prepared.id, prepared.contentHash);
    const result = await matcher.match(prepared.id, ['https://image.test/near.png', 'https://image.test/different.png']);
    assert.equal(result.comparedImages, 2);
    assert.equal(result.bestImageUrl, 'https://image.test/near.png');
    assert.ok(result.score > 0.6);
    const positive = await matcher.match(prepared.id, ['https://image.test/near.png'], { threshold: 0.6 });
    const negative = await matcher.match(prepared.id, ['https://image.test/different.png'], { threshold: 0.6 });
    assert.ok((positive.score ?? 0) >= 0.6);
    assert.ok((negative.score ?? 0) < 0.6);
    const files = await (await import('node:fs/promises')).readdir(join(directory, 'image-features'));
    assert.ok(files.length >= 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
