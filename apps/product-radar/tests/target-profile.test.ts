import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TargetProfileExtractor } from '../src/core/target-profile/extractor.js';
import type { VisionProfileProvider } from '../src/core/target-profile/model.js';

class FakeVisionProvider implements VisionProfileProvider {
  readonly id = 'fake-vision';
  failed = false;
  async analyze() {
    if (this.failed) throw new Error('vision unavailable');
    return {
      brand: 'Unknown Brand', category: 'jacket', colors: ['red'], features: ['hood'],
      detectedText: ['TAG'], confidence: { brand: 0.2, category: 0.8 },
    };
  }
}

test('target profile supports image only with a low-confidence vision fallback', async () => {
  const provider = new FakeVisionProvider();
  const profile = await new TargetProfileExtractor({ provider, now: () => '2026-09-08T00:00:00.000Z' }).extract({ referenceImage: { base64: 'data:image/png;base64,AA==' } });
  assert.equal(profile.provider, 'fake-vision');
  assert.equal(profile.category, 'jacket');
  assert.equal(profile.provenance.brand?.source, 'vision');
  assert.equal(profile.softHints.some((hint) => hint.field === 'category'), true);
  assert.equal(profile.extractedAt, '2026-09-08T00:00:00.000Z');
});

test('explicit user brand and season override conflicting vision inference', async () => {
  const profile = await new TargetProfileExtractor({
    provider: { id: 'fake', analyze: async () => ({ brand: 'Unknown', season: '24SS', category: 'coat' }) },
  }).extract({
    referenceImage: { url: 'https://image.test/item.jpg' },
    userText: '这是 Undercover 18AW 羽绒服，必须黑色',
  });
  assert.equal(profile.brand, 'Undercover');
  assert.equal(profile.season, '18AW');
  assert.equal(profile.category, '羽绒服');
  assert.equal(profile.colors.includes('黑色'), true);
  assert.equal(profile.hardConstraints.some((item) => item.field === 'brand' && item.value === 'Undercover'), true);
  assert.equal(profile.hardConstraints.some((item) => item.field === 'season' && item.value === '18AW'), true);
  assert.equal(profile.softHints.some((item) => item.field === 'brand' && item.value === 'Unknown'), false);
});

test('explicit search terms are retained and hard exclusions stay separate from soft hints', async () => {
  const profile = await new TargetProfileExtractor({ provider: { id: 'fake', analyze: async () => ({ category: 'jacket', colors: ['black'] }) } }).extract({
    userText: '帮我蹲这个，必须有帽子，不要仿品 搜索词：크롬하츠 패딩',
    explicitKeywords: ['크롬하츠 패딩'],
    explicitSearchTerms: ['Chrome Hearts puffer'],
  });
  assert.deepEqual(profile.explicitSearchTerms, ['Chrome Hearts puffer', '크롬하츠 패딩']);
  assert.equal(profile.hardConstraints.some((item) => item.operator === 'not_contains' && item.value === '仿品'), true);
  assert.equal(profile.softHints.some((item) => item.field === 'color' && item.source === 'vision'), true);
});

test('vision provider failure still produces a reasonable user-driven profile', async () => {
  const provider = new FakeVisionProvider();
  provider.failed = true;
  const profile = await new TargetProfileExtractor({ provider }).extract({ userText: 'Yohji 23AW 羽绒服' });
  assert.equal(profile.brand, 'Yohji');
  assert.equal(profile.season, '23AW');
  assert.equal(profile.category, '羽绒服');
  assert.equal(profile.provider, 'fallback');
});
