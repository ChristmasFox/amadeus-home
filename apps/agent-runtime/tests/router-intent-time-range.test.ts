import assert from 'node:assert/strict';
import test from 'node:test';
import { isPubgText } from '../src/planner/deterministic-planner.js';
import { classifyPubgRequest } from '../src/runtime/router.js';

function activePubgContext() {
  return {
    schemaVersion: 3 as const,
    sessionId: 'router-time-range',
    activeDomain: 'pubg' as const,
    lastQuery: null,
    lastSelector: null,
    lastResultSetId: null,
    lastSubject: null,
    references: {},
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

test('TimeRange is a PUBG parameter only after positive domain intent', () => {
  assert.equal(classifyPubgRequest('昨天战绩', null).domain, 'pubg');
  assert.equal(classifyPubgRequest('昨天战绩', null).reason, 'explicit_pubg_signal');

  assert.equal(classifyPubgRequest('昨天', null).route, 'pass');
  assert.equal(classifyPubgRequest('前天', null).route, 'pass');
  assert.equal(classifyPubgRequest('最近 7 天', null).route, 'pass');
  assert.equal(classifyPubgRequest('上周', null).route, 'pass');
  assert.equal(isPubgText('昨天'), false);
  assert.equal(isPubgText('昨天战绩'), true);
});

test('PUBG context accepts a valid short time follow-up', () => {
  const result = classifyPubgRequest('前天呢？', activePubgContext());
  assert.equal(result.domain, 'pubg');
  assert.equal(result.reason, 'active_pubg_follow_up');

  const dated = classifyPubgRequest('8月20号呢？', activePubgContext());
  assert.equal(dated.domain, 'pubg');
  assert.equal(dated.reason, 'active_pubg_follow_up');
});

test('hardware timing text with a date does not enter PUBG', () => {
  const result = classifyPubgRequest('昨天超的是CL30, tRCD 36, tRP 36, tRAS 80', null);
  assert.equal(result.domain, 'unknown');
  assert.equal(result.route, 'pass');
  assert.equal(result.reason, 'no_domain_signal');

  // An active PUBG session does not turn a long technical sentence into a
  // follow-up merely because it starts with a date token.
  const activeResult = classifyPubgRequest('昨天超的是CL30, tRCD 36, tRP 36, tRAS 80', activePubgContext());
  assert.equal(activeResult.domain, 'unknown');
  assert.equal(activeResult.route, 'pass');
});

test('HomeHub intent wins over a relative date', () => {
  const result = classifyPubgRequest('昨天 Emby 挂了吗', null);
  assert.equal(result.domain, 'homehub');
  assert.equal(result.route, 'mandatory');
  assert.equal(result.reason, 'homehub_diagnosis');
});
