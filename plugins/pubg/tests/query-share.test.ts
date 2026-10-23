import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewShareOpen, reviewShareTokenHash, SqlitePubgRepository } from '@rine-kit/pubg-domain';
import { appendQueryShareLink, QUERY_SHARE_MAX_MATCHES } from '../src/query-share.js';

const TEXT = '📊 今日战绩\n场次 3 · 吃鸡 1\n数据更新时间：22:05';
const NOW = new Date('2026-10-19T14:00:00.000Z');

function append(overrides: Partial<Parameters<typeof appendQueryShareLink>[0]> = {}, store = new SqlitePubgRepository(':memory:')) {
  return {
    store,
    ...appendQueryShareLink({
      toolName: 'pubg_query_stats', status: 'ok', matchIds: ['m1', 'm2', 'm2', 'm3'], displayText: TEXT, dataUpdatedAt: '2026-10-19T14:05:00.000Z',
      timezone: 'Asia/Shanghai', squadId: 'squad', shareBaseUrl: 'https://pubg.example.test/', store: () => store, now: NOW, ...overrides,
    }),
  };
}

test('a query answer keeps its text exactly and gains one share link line for its matches', () => {
  const { text, url, store } = append();
  assert.equal(text, `${TEXT}\n\n🔗 ${url}`);
  assert.ok(text.startsWith(`${TEXT}\n\n🔗 https://pubg.example.test/s/`), text);
  const token = text.match(/\/s\/([A-Za-z0-9_-]{22})$/u)?.[1];
  assert.ok(token);
  assert.equal(text.slice(0, TEXT.length), TEXT);
  const share = store.getReviewShare(reviewShareTokenHash(token!))!;
  assert.deepEqual([share.kind, share.matchIds], ['query', ['m1', 'm2', 'm3']]);
  assert.equal(reviewShareOpen(share, NOW), true);
  const presentation = JSON.parse(share.presentationJson);
  assert.deepEqual([presentation.type, presentation.title, presentation.displayText], ['pubg_query_share', '📊 今日战绩', TEXT]);
  assert.ok(!share.presentationJson.includes(token!));
});

test('no link without matches, for errors, for operational tools or 误伤, or without a share origin', () => {
  for (const overrides of [
    { matchIds: [] },
    { matchIds: undefined },
    { status: 'error' },
    { toolName: 'pubg_prefetch_telemetry' },
    { toolName: 'pubg_resolve_players' },
    { toolName: 'pubg_query_team_damage' },
    { shareBaseUrl: undefined },
  ]) assert.deepEqual([append(overrides).text, append(overrides).url], [TEXT, undefined], JSON.stringify(overrides));
});

test('a very wide query shares a bounded set of matches, and a storage failure never breaks the answer', () => {
  const many = Array.from({ length: QUERY_SHARE_MAX_MATCHES + 20 }, (_, index) => `m${index}`);
  const { text, store } = append({ matchIds: many });
  const token = text.match(/\/s\/([A-Za-z0-9_-]{22})$/u)![1]!;
  assert.equal(store.getReviewShare(reviewShareTokenHash(token))!.matchIds.length, QUERY_SHARE_MAX_MATCHES);
  const broken = appendQueryShareLink({
    toolName: 'pubg_query_stats', status: 'ok', matchIds: ['m1'], displayText: TEXT, dataUpdatedAt: null, timezone: 'Asia/Shanghai', squadId: 'squad',
    shareBaseUrl: 'https://pubg.example.test', store: () => { throw new Error('database locked'); }, now: NOW,
  });
  assert.deepEqual(broken, { text: TEXT });
});
