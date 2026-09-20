import assert from 'node:assert/strict';
import test from 'node:test';
import {
  containsInternalTimeTerms,
  formatDisplayRange,
  formatDisplayTime,
  renderOwnerNotification,
  renderPubgMatchReview,
  renderPubgPeriodReview,
  validateOwnerNotificationPresentation,
  validatePubgMatchReviewPresentation,
  validatePubgPeriodReviewPresentation,
} from '../src/index.js';

test('display time uses Beijing-friendly same-day and cross-day forms', () => {
  const now = '2026-09-20T15:00:00.000Z';
  assert.equal(formatDisplayTime('2026-09-20T15:05:00.000Z', { now }), '23:05');
  assert.equal(formatDisplayTime('2026-09-19T15:05:00.000Z', { now }), '2026-09-19 23:05');
  assert.equal(formatDisplayRange('2026-09-19T22:00:00.000Z', '2026-09-20T22:00:00.000Z', { now }), '2026-09-20 06:00 至 2026-09-21 06:00');
});

test('review contract rejects missing structure and unknown evidence', () => {
  const invalid = validatePubgMatchReviewPresentation({
    type: 'pubg_match_review',
    headline: 'match',
    overview: { placement: 1, kills: 0, assists: null, damage: 10, dbnos: 1, revives: null },
    keyMoments: [], highlights: [], improvements: [], analysis: 'ok',
    dataUpdatedAt: '2026-09-20T15:00:00.000Z', evidenceRefs: ['missing'],
  }, new Set(['known']));
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join('\n'), /unknown evidence/);
  assert.equal(validatePubgMatchReviewPresentation({ type: 'pubg_match_review' }).valid, false);
});

test('owner notification contract is hard validated and rendered deterministically', () => {
  const presentation = {
    type: 'owner_notification' as const,
    eventType: 'test', severity: 'success' as const, eventKey: 'test:1', source: 'test', headline: '测试通知',
    facts: [{ label: '计数', value: 2, evidenceRefs: [] }], summary: '事实摘要',
    dataUpdatedAt: '2026-09-20T15:05:00.000Z', occurredAt: '2026-09-20T15:10:00.000Z', worldLineClosing: true,
  };
  assert.equal(validateOwnerNotificationPresentation(presentation).valid, true);
  const output = renderOwnerNotification(presentation, { now: '2026-09-20T15:10:00.000Z' });
  assert.match(output, /数据更新时间：23:05/u);
  assert.match(output, /El Psy Kongroo\.$/u);
  assert.equal(containsInternalTimeTerms(output), false);
  assert.equal(validateOwnerNotificationPresentation({ ...presentation, facts: [{ label: 'bad', value: { x: 1 }, evidenceRefs: [] }] }).valid, false);
});

test('PUBG renderer preserves null as unknown instead of inventing zero', () => {
  const presentation = {
    type: 'pubg_match_review' as const, headline: '第1局 · Erangel',
    overview: { placement: null, kills: null, assists: 1, damage: 20, dbnos: null, revives: 0 },
    keyMoments: [], highlights: [], improvements: [], analysis: '证据有限',
    dataUpdatedAt: '2026-09-20T15:00:00.000Z', evidenceRefs: [],
  };
  const output = renderPubgMatchReview(presentation, { now: '2026-09-20T15:05:00.000Z' });
  assert.match(output, /排名：未知/u);
  assert.match(output, /击杀：未知/u);
  assert.doesNotMatch(output, /击杀：0/u);
});

test('PUBG period review keeps Domain order and renders cross-day match times', () => {
  const presentation = {
    type: 'pubg_period_review' as const,
    period: { label: '昨天对局' },
    summary: '共 2 场',
    orderedMatches: [
      { matchId: 'm1', label: '第一局', startedAt: '2026-09-19T15:00:00.000Z', placement: 2 },
      { matchId: 'm2', label: '第二局', startedAt: null, placement: null },
    ],
    highlights: [],
    patterns: [],
    analysis: '证据有限',
    dataUpdatedAt: '2026-09-20T15:05:00.000Z',
    evidenceRefs: [],
  };
  assert.equal(validatePubgPeriodReviewPresentation(presentation).valid, true);
  const output = renderPubgPeriodReview(presentation, { now: '2026-09-20T15:05:00.000Z' });
  assert.match(output, /第一局 （2026-09-19 23:00）：第2名/u);
  assert.match(output, /第二局 ：第未知名/u);
  assert.match(output, /数据更新时间：23:05/u);
});
