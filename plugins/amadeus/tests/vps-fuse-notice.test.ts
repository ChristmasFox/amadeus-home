import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWorldlineNotification } from '@rine-kit/presentation';
import { describeCoverage, describeSource, formatGb, formatPercent, formatRate, formatShanghai, trafficFuseNoticeIntent, type FuseNoticeInput } from '../src/vps-fuse-notice.js';

const base: FuseNoticeInput = {
  eventKey: 'vps-daily-fuse:2026-10-30:warning', eventType: 'warning', day: '2026-10-30',
  observedBytes: 46_354_489_691, warningThresholdBytes: 40_000_000_000, capThresholdBytes: 50_000_000_000,
  remainingHeadroomBytes: 3_645_510_309, coverage: 'partial_coverage', coverageStartedAt: '2026-10-29T16:00:06Z',
  sourceStatus: 'provider_confirmed', dataUpdatedAt: '2026-10-30T06:49:30Z', rateBitsPerSecond: null,
  nextRecoveryAt: null, normalEgressRestored: null, occurredAt: '2026-10-30T06:49:30Z',
};
const render = (event: FuseNoticeInput) => renderWorldlineNotification(trafficFuseNoticeIntent(event), { timezone: 'Asia/Shanghai' });

test('numbers are GB with two decimals, percentages and Mbps/kbps', () => {
  assert.equal(formatGb(46_354_489_691), '46.35 GB');
  assert.equal(formatGb(50_000_000_000), '50 GB');
  assert.equal(formatGb(0), '0 GB');
  assert.equal(formatGb(123_456_000_000), '123.5 GB');
  assert.equal(formatGb(null), '未知');
  assert.equal(formatPercent(46_354_489_691, 50_000_000_000), '93%');
  assert.equal(formatPercent(3_645_510_309, 50_000_000_000), '7.3%');
  assert.equal(formatPercent(1, 0), null);
  assert.equal(formatRate(2_000_000), '2 Mbps');
  assert.equal(formatRate(1_500_000), '1.5 Mbps');
  assert.equal(formatRate(256_000), '256 kbps');
});

test('times are Shanghai YYYY-MM-DD HH:mm, never ISO/UTC', () => {
  assert.equal(formatShanghai('2026-10-30T16:00:00Z'), '2026-10-31 00:00');
  assert.equal(formatShanghai('2026-10-30T06:49:30Z'), '2026-10-30 14:49');
  assert.equal(formatShanghai('garbage'), null);
  assert.equal(formatShanghai(null), null);
});

test('enum states become Chinese explanations', () => {
  assert.match(describeSource('provider_confirmed'), /服务商/u);
  assert.match(describeSource('local_wan_estimate'), /估算/u);
  assert.match(describeSource('unknown'), /未确认/u);
  assert.equal(describeCoverage('partial_coverage', '2026-10-29T16:00:06Z'), '今天统计不完整：从 2026-10-30 00:00 开始计入，更早的流量没有算进来');
  assert.match(describeCoverage('partial_coverage', null), /今天统计不完整/u);
  assert.equal(describeCoverage('complete'), '今天的统计完整');
});

test('warning, engaged, released and failure notices lead with what happened and carry no raw enums or ISO strings', () => {
  const warning = render(base);
  const engaged = render({ ...base, eventKey: 'x:engaged', eventType: 'engaged', observedBytes: 51_065_367_573, remainingHeadroomBytes: 0, rateBitsPerSecond: 2_000_000, nextRecoveryAt: '2026-10-30T16:00:00Z', dataUpdatedAt: '2026-10-30T07:49:30Z', occurredAt: '2026-10-30T07:49:31Z' });
  const released = render({ ...base, eventKey: 'x:released', eventType: 'released', observedBytes: 52_670_517_607, remainingHeadroomBytes: 0, normalEgressRestored: true, dataUpdatedAt: '2026-10-30T09:08:26Z', occurredAt: '2026-10-30T09:08:35Z' });
  const failed = render({ ...base, eventKey: 'x:apply-failed', eventType: 'apply-failed', observedBytes: 50_100_000_000, remainingHeadroomBytes: 0 });
  assert.match(warning.split('\n')[0]!, /VPS 流量预警/u);
  assert.match(warning, /已用 46\.35 GB/u);
  assert.match(warning, /占预警线 116%，占熔断线 93%/u);
  assert.match(warning, /预警 40 GB · 熔断 50 GB/u);
  assert.match(warning, /距熔断线余量：3\.65 GB（7\.3%）/u);
  assert.match(warning, /统计范围：今天统计不完整：从 2026-10-30 00:00 开始计入/u);
  assert.match(warning, /数据更新：2026-10-30 14:49/u);
  assert.match(engaged.split('\n')[0]!, /VPS 已限速/u);
  assert.match(engaged, /限速到 2 Mbps/u);
  assert.match(engaged, /距熔断线余量：已用尽（超出 1\.07 GB）/u);
  assert.match(engaged, /2026-10-31 00:00（上海时间，当天午夜自动解除）/u);
  assert.match(released.split('\n')[0]!, /VPS 限速已解除/u);
  assert.match(released, /出口已确认恢复正常/u);
  assert.match(failed.split('\n')[0]!, /VPS 限速未能生效/u);
  for (const text of [warning, engaged, released, failed]) {
    assert.doesNotMatch(text, /partial_coverage|provider_confirmed|local_wan_estimate|\d{4}-\d{2}-\d{2}T|\bZ\b|\d{9,}/u, text);
    assert.doesNotMatch(text, /bit\/s|字节/u);
  }
  assert.equal(trafficFuseNoticeIntent({ ...base, eventType: 'released', normalEgressRestored: true }).worldLineClosing, true);
});
