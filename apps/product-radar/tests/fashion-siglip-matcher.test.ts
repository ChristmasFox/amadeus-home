import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ImageMatchContext, ImageMatchResult, ImageMatcher, ImageSource, PreparedImageReference } from '../src/core/matching/image.js';
import { FashionSiglipImageMatcher } from '../src/integrations/images/fashion-siglip-matcher.js';

class FakeSharpFallback implements ImageMatcher {
  readonly references: ImageSource[] = [];

  async prepareReference(source: ImageSource): Promise<PreparedImageReference> {
    this.references.push(source);
    return { id: 'legacy-reference', contentHash: 'legacy-reference', provider: 'sharp', modelVersion: 'sharp-perceptual-v1' };
  }

  async match(_referenceId: string, candidateImageUrls: string[], context: ImageMatchContext = {}): Promise<ImageMatchResult> {
    return {
      provider: 'sharp',
      modelVersion: 'sharp-perceptual-v1',
      score: candidateImageUrls.length > 0 ? 0.42 : 0,
      comparedImages: candidateImageUrls.length,
      ...(context.threshold === undefined ? {} : { threshold: context.threshold }),
    };
  }
}

function fakeEmbeddingFetch(options: { failEmbeddings?: () => boolean } = {}): typeof fetch {
  return (async (_input, init) => {
    if (options.failEmbeddings?.()) return new Response('unavailable', { status: 503 });
    const payload = JSON.parse(String(init?.body ?? '{}')) as { items?: Array<{ key: string }> };
    const items = (payload.items ?? []).map((item, index) => ({
      key: item.key,
      vector: index % 2 === 0 ? [1, 0] : [0, 1],
      width: 48,
      height: 48,
    }));
    return new Response(JSON.stringify({ items }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

test('FashionSigLIP matcher persists semantic features and ranks candidates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'product-radar-fashion-siglip-'));
  try {
    const fallback = new FakeSharpFallback();
    const matcher = new FashionSiglipImageMatcher({ dataDir: directory, baseUrl: 'http://fashion-siglip:8000', fallback, fetchImpl: fakeEmbeddingFetch() });
    const prepared = await matcher.prepareReference({ base64: `data:image/png;base64,${Buffer.from('reference').toString('base64')}` });
    assert.equal(prepared.provider, 'fashionSigLIP');
    assert.equal(prepared.id, prepared.contentHash);
    assert.equal(fallback.references.length, 1);

    const result = await matcher.match(prepared.id, ['https://image.test/near.jpg', 'https://image.test/different.jpg'], { source: 'bunjang', externalId: 'candidate-1', threshold: 0.6 });
    assert.equal(result.provider, 'fashionSigLIP');
    assert.equal(result.comparedImages, 2);
    assert.equal(result.bestImageUrl, 'https://image.test/near.jpg');
    assert.equal(result.score, 1);
    assert.deepEqual(result.modelUsage, { calls: 1, imagesProcessed: 2, cacheHits: 0 });

    const cached = await matcher.match(prepared.id, ['https://image.test/near.jpg', 'https://image.test/different.jpg'], { source: 'bunjang', externalId: 'candidate-1' });
    assert.deepEqual(cached.modelUsage, { calls: 0, imagesProcessed: 0, cacheHits: 2 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('FashionSigLIP matcher uses Sharp for an existing legacy reference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'product-radar-fashion-siglip-legacy-'));
  try {
    const fallback = new FakeSharpFallback();
    const matcher = new FashionSiglipImageMatcher({ dataDir: directory, baseUrl: 'http://fashion-siglip:8000', fallback, fetchImpl: fakeEmbeddingFetch() });
    const result = await matcher.match('legacy-reference', ['https://image.test/legacy.jpg']);
    assert.equal(result.provider, 'sharp');
    assert.equal(result.score, 0.42);
    assert.equal(result.modelUsage, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('FashionSigLIP outage falls back to Sharp after a new reference was prepared', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'product-radar-fashion-siglip-fallback-'));
  try {
    let fail = false;
    const fallback = new FakeSharpFallback();
    const matcher = new FashionSiglipImageMatcher({ dataDir: directory, baseUrl: 'http://fashion-siglip:8000', fallback, fetchImpl: fakeEmbeddingFetch({ failEmbeddings: () => fail }) });
    const prepared = await matcher.prepareReference({ base64: Buffer.from('reference').toString('base64') });
    fail = true;
    const result = await matcher.match(prepared.id, ['https://image.test/legacy.jpg']);
    assert.equal(result.provider, 'sharp');
    assert.equal(result.score, 0.42);
    assert.deepEqual(result.modelUsage, { calls: 1, imagesProcessed: 0, cacheHits: 0 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
