import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TargetProfileExtractor } from '../src/core/target-profile/extractor.js';
import { BunjangSearchPlanner, normalizeSearchQuery } from '../src/sources/bunjang/search-planner.js';

test('Bunjang planner creates localized layered queries for brand season category', async () => {
  const profile = await new TargetProfileExtractor().extract({ userText: '帮我蹲 Yohji 23AW 这件羽绒服' });
  const plan = new BunjangSearchPlanner(() => '2026-09-08T00:00:00.000Z').plan(profile);
  const queries = plan.queries.map((item) => item.query);
  assert.equal(queries.some((query) => query.includes('요지 야마모토') && query.includes('23AW') && query.includes('패딩')), true);
  assert.equal(queries.some((query) => query.includes('패딩') || query.includes('다운 자켓')), true);
  assert.equal(queries.includes('羽绒服'), false);
  assert.equal(queries.every((query) => query !== '의류'), true);
  assert.equal(plan.queries.length <= 4, true);
});

test('user search terms remain in the plan and duplicate canonical queries are removed', () => {
  const profile = {
    colors: [], materials: [], features: [], detectedText: [], userHints: [], hardConstraints: [], softHints: [],
    explicitSearchTerms: ['스톤아일랜드 패딩', ' 스톤아일랜드   패딩 '], includeKeywords: [], excludeKeywords: [], provider: 'test', extractedAt: '2026-09-08T00:00:00.000Z', provenance: {},
  };
  const plan = new BunjangSearchPlanner().plan(profile);
  assert.equal(plan.queries[0]?.query, '스톤아일랜드 패딩');
  assert.equal(plan.queries.filter((item) => item.canonicalQuery === normalizeSearchQuery('스톤아일랜드 패딩')).length, 1);
});

test('category-only fallback is broader than a permanent generic 의류 query', () => {
  const profile = {
    category: '패딩', colors: [], materials: [], features: [], detectedText: [], userHints: [], hardConstraints: [], softHints: [], explicitSearchTerms: [], includeKeywords: [], excludeKeywords: [], provider: 'fallback', extractedAt: '2026-09-08T00:00:00.000Z', provenance: {},
  };
  const queries = new BunjangSearchPlanner().plan(profile).queries.map((item) => item.query);
  assert.equal(queries.includes('패딩'), true);
  assert.equal(queries.includes('의류'), false);
});

test('planner keeps user terms, model detail, and layered broad coverage within four queries', () => {
  const profile = {
    brand: 'Yohji Yamamoto', modelName: 'Y-3A-01', season: '23AW', category: '羽绒服',
    colors: [], materials: [], features: [], detectedText: [], userHints: [], hardConstraints: [], softHints: [],
    userSearchTerms: ['我说的原词'], explicitSearchTerms: ['我说的原词'], includeKeywords: [], excludeKeywords: [],
    provider: 'gpt-5.6-luna', extractedAt: '2026-09-09T00:00:00.000Z', provenance: {},
  };
  const plan = new BunjangSearchPlanner().plan(profile);
  assert.equal(plan.queries[0]?.query, '我说的原词');
  assert.equal(plan.queries.some((item) => item.query.includes('Y-3A-01')), true);
  assert.equal(plan.queries.some((item) => item.tier === 'specific'), true);
  assert.equal(plan.queries.some((item) => item.tier === 'medium'), true);
  assert.equal(plan.queries.some((item) => item.tier === 'broad' && item.query === '패딩'), true);
  assert.equal(plan.queries.length <= 4, true);
});
