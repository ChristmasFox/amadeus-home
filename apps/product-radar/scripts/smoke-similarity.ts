import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BunjangSourceAdapter } from '../src/sources/bunjang/adapter.js';
import { PerceptualImageMatcher } from '../src/integrations/images/perceptual-matcher.js';

const productUrl = process.env.BUNJANG_SMOKE_PRODUCT_URL ?? 'https://m.bunjang.co.kr/products/424506121';
const searchQuery = process.env.BUNJANG_SMOKE_SEARCH_QUERY ?? '의류';
const directory = await mkdtemp(join(tmpdir(), 'product-radar-similarity-'));
const adapter = new BunjangSourceAdapter();
try {
  const productTarget = await adapter.validateTarget('product', { productUrl });
  const product = adapter.normalizeProductState(await adapter.fetchProduct(productTarget), { target: productTarget });
  const referenceImageUrl = product.imageUrls[0];
  if (!referenceImageUrl) throw new Error('reference product has no image');
  const searchTarget = await adapter.validateTarget('similarity', { searchQuery });
  const rawCandidates = await adapter.fetchSearchListings(searchTarget);
  const candidates = rawCandidates.map((raw) => adapter.normalizeListing(raw, { target: searchTarget }));
  const matcher = new PerceptualImageMatcher({ dataDir: directory });
  const reference = await matcher.prepareReference({ url: referenceImageUrl });
  const scored = [];
  for (const candidate of candidates) {
    const result = await matcher.match(reference.id, candidate.imageUrls);
    scored.push({ externalId: candidate.externalId, title: candidate.title, score: result.score, comparedImages: result.comparedImages });
  }
  scored.sort((a, b) => b.score - a.score);
  console.log(JSON.stringify({
    reference: { productExternalId: product.externalId, title: product.title, imageUrl: referenceImageUrl },
    searchQuery,
    candidateCount: candidates.length,
    topMatches: scored.slice(0, 5),
    threshold: 0.6,
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
