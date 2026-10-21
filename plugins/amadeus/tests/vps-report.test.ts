import assert from 'node:assert/strict';
import test from 'node:test';
import { progressBar, renderVpsReport, type VpsReportInput } from '../src/vps-report.js';

const account = (accountId: string, total: number) => ({ accountId, totalsComplete: true, totalMonitoredBytes: total, knownMonitoredBytes: total });
const input: VpsReportInput = {
  live: { status: 'partial', live: { state: 'running', cpuThrottled: null } },
  usage: { status: 'ok', usage: { usedBytes: 88_689_600_868, totalBytes: 1_073_741_824_000, remainingBytes: 985_052_223_132, usedPercent: 8.259862742200493, resetAt: '2026-11-17T09:39:14.000Z', deltaSincePreviousSampleBytes: 92_214_195, counterReset: false }, checkedAt: '2026-10-21T02:17:06.272Z' },
  system: { status: 'ok', system: { uptimeSeconds: 319_544, loadAverage: { oneMinute: 0.24, fiveMinutes: 0.05, fifteenMinutes: 0.02 }, memory: { totalBytes: 1_073_373_184, usedBytes: 344_834_048 }, rootFilesystem: { sizeBytes: 19_540_049_920, usedBytes: 2_071_572_480, usedPercent: 12 } } },
  services: { status: 'ok', services: ['Caddy', 'Xray', 'Hysteria2', 'frps'].map((name) => ({ name, healthy: true })) },
  overview: {
    status: 'partial',
    data: {
      monitoringStartedAt: '2026-10-17T12:27:16.000Z',
      accounts: [account('Labmem001', 2_573_490_736), account('Labmem002', 3_900_000_000), account('Labmem003', 0), { accountId: 'Labmem004', totalsComplete: false, totalMonitoredBytes: null, knownMonitoredBytes: 5_000_000_000 }],
      legacy: { totalMonitoredBytes: 0 },
      reportWindow: { seconds: 43_200, startAt: '2026-10-20T14:16:20.000Z', endAt: '2026-10-21T02:16:20.000Z', providerBytes: 6_058_572_019, providerComplete: true, providerSampleCount: 720, subscriptionBytes: 2_936_271_736, subscriptionComplete: true, legacyBytes: null, legacyComplete: false, otherServiceBytes: 3_122_300_283, otherServiceStatus: 'uncalibrated', topAccount: { accountId: 'M204-Net-Core', windowBytes: 1_804_904_968 } },
      reconciliation: { status: 'uncalibrated' },
      sources: { provider: { status: 'ok' }, xray: { status: 'ok' } },
      security: { hysteriaAuth: { authFailuresWindow: 233, authRateLimitedWindow: 0 }, realityFallback: { windowTotalBytes: 44_672 }, signals: [{ code: 'reality_fallback_traffic', value: 44_672, threshold: 1024 }] },
    },
  },
  fuse: { status: 'ok', data: { state: 'NORMAL', effectiveBytes: 3_221_225_472, warningThresholdBytes: 42_949_672_960, capThresholdBytes: 53_687_091_200, coverage: 'complete', sourceStatus: 'provider_confirmed', rateBitsPerSecond: null, nextRecoveryAt: '2026-10-21T16:00:00.000Z' } },
};

/** Every bold span is followed by a space, a newline or the end, as the WhatsApp client requires. */
function boldSpansAreSpaced(text: string): boolean {
  return text.split('\n').every((line) => line.split('**').every((part, index) => index === 0 || index % 2 === 1 || part === '' || /^\s/u.test(part)));
}

test('the progress bar fills in tenths and never shows a non-zero share as empty', () => {
  assert.equal(progressBar(62), '▓▓▓▓▓▓░░░░');
  assert.equal(progressBar(8.26), '▓░░░░░░░░░');
  assert.equal(progressBar(0.3), '▓░░░░░░░░░');
  assert.equal(progressBar(0), '░░░░░░░░░░');
  assert.equal(progressBar(100), '▓▓▓▓▓▓▓▓▓▓');
  assert.equal(progressBar(null), '░░░░░░░░░░');
});

test('the VPS card is grouped, Chinese, bar-led and in one unit system', () => {
  const card = renderVpsReport(input);
  const text = card.text;
  for (const title of ['📊 **流量套餐**', '🕛 **近 12 小时**', '👥 **账号累计**', '🖥️ **主机**', '🛡️ **熔断与安全**', '🔎 **数据状态**']) assert.ok(text.includes(title), title);
  assert.ok(text.includes('▓░░░░░░░░░ **8.3%** · 已用 **82.60 GiB** / 1000.00 GiB'));
  assert.ok(text.includes('• 剩余 917.40 GiB · 重置日 **11-17** 17:39'));
  assert.ok(text.includes('• 较上次采样 +88 MiB'));
  assert.ok(text.includes('🕛 **近 12 小时** （10-20 22:16 – 10-21 10:16，采样 720 次）'));
  assert.ok(text.includes('• 整机 **5.64 GiB** · 订阅账号 2.73 GiB'));
  assert.ok(text.includes('未归因残差（未校准）2.91 GiB'));
  assert.ok(text.includes('• 增长最多：M204-Net-Core 1.68 GiB'));
  assert.ok(text.includes('• Labmem001 2.40 GiB\n• Labmem002 3.63 GiB\n• Labmem003 0 B\n• Labmem004 ≥ 4.66 GiB（不完整）'));
  assert.ok(text.includes('• 运行 3 天 16 小时 · 负载 0.24 / 0.05 / 0.02'));
  assert.ok(text.includes('• 内存 已用 329 MiB / 1024 MiB（32%）'));
  assert.ok(text.includes('• 服务 ✅ Caddy、Xray、Hysteria2、frps 全部运行'));
  assert.ok(text.includes('（CPU 限速状态未知）'));
  assert.ok(text.includes('• 熔断状态 **正常** · 服务商确认，覆盖完整'));
  assert.ok(text.includes('• Hysteria2 认证失败 233 次 · 被限流 0 次 · Reality 回落流量 44 KiB'));
  assert.ok(text.includes('观察到可疑信号：Reality 回落流量 44 KiB，超过阈值 1 KiB'));
  assert.ok(text.includes('整机与代理归因的对账：未校准'));
  assert.doesNotMatch(text, /\bGB\b|\bMB\b|\bB\)|UTC|CST|uncalibrated|partial|liveStatus|providerBytes|null|undefined/u);
  assert.equal(boldSpansAreSpaced(text), true);
  assert.ok(text.length < 2_800, `${text.length} characters`);
  assert.equal(card.failed, false);
});

test('failures and incomplete data stay visible and change the conclusion', () => {
  const degraded = renderVpsReport({
    ...input,
    usage: { status: 'ok', usage: { ...(input.usage as { usage: object }).usage, usedPercent: 83.4, usedBytes: 895_000_000_000, counterReset: false } },
    services: { status: 'ok', services: [{ name: 'Caddy', healthy: true }, { name: 'Xray', healthy: false }] },
    fuse: { status: 'error', data: null },
    live: { status: 'error' },
  });
  assert.match(degraded.conclusion, /^⚠️ 需要关注：.*套餐已用 83\.4%.*Xray 未运行/u);
  assert.ok(degraded.text.includes('• ⚠️ 熔断数据暂时读取失败，不能当作没有限速'));
  assert.ok(degraded.text.includes('✅ Caddy ⚠️ **Xray** 异常'));
  assert.ok(degraded.text.includes('KiwiVM：⚠️ 状态未知'));
  const notInstalled = renderVpsReport({ ...input, fuse: { status: 'stale', error: { code: 'TRAFFIC_FUSE_UNAVAILABLE' }, data: null } });
  assert.ok(notInstalled.text.includes('• 流量熔断：⚠️ **尚未在 VPS 上启用**（没有快照），目前没有日流量保护'));
  assert.equal(notInstalled.text.includes('入口流量可能已被计费'), false);
  const down = renderVpsReport({ ...input, usage: { status: 'error' }, system: { status: 'error' }, overview: { status: 'error' }, services: { status: 'error' }, fuse: { status: 'error' }, live: { status: 'error' } });
  assert.equal(down.failed, true);
  assert.match(down.text, /^\*\*结论：\*\* ❌ 多项数据读取失败/u);
  assert.ok(down.text.includes('• ⚠️ 套餐用量暂时读取失败'));
  assert.doesNotMatch(down.text, /0\.0%|\b0 B\b/u);
});
