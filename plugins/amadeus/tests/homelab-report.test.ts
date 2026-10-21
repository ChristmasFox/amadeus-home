import assert from 'node:assert/strict';
import test from 'node:test';
import { renderHomelabReport, socPowerReliable } from '../src/homelab-report.js';
import { capacityGiB, formatBytes, formatCapacity, withByteText } from '../src/shared/units.js';

const host = {
  status: 'ok',
  cpu: { utilizationPercent: 14.6 },
  memory: { usedPercent: 63.3, pressure: 'normal', total: '24.00 GB', used: '15.20 GB', swap: { total: '9.00 GB', used: '8.00 GB' } },
  disks: {
    internal: { mounted: true, total: '460.38 GB', used: '328.40 GB', free: '131.98 GB', usedPercent: 71.3 },
    avalon: { mounted: true, total: '7.28 TB', used: '7.10 TB', free: '179.62 GB', usedPercent: 97.6 },
  },
  power: { status: 'ok', cpuPowerMw: 0, gpuPowerMw: 102.6, anePowerMw: 0, socPowerMw: 102.6, powerWatts: 0.103 },
  history: {
    windowStart: '2026-10-20T16:00:00Z',
    metrics: {
      cpu: { avg: 15.782, p95: 20.9, max: 34.8, maxAt: '2026-10-20T22:06:10Z' },
      swap: { delta: '-514.81 MB' },
      powerWatts: { avg: 0.106, p95: 0.11, max: 0.185 },
    },
  },
};
const input = { host, unavailable: false, conclusion: '✅ 正常', services: { OpenClaw: true, Immich: true, Changedetection: true }, routerOk: true, anomalies: [] };

test('capacities are relabelled as binary units with fixed precision', () => {
  assert.equal(capacityGiB('15.20 GB'), 15.2);
  assert.equal(capacityGiB('7.28 TB'), 7.28 * 1024);
  assert.equal(formatCapacity(capacityGiB('460.38 GB')), '460.38 GiB');
  assert.equal(formatCapacity(capacityGiB('7.10 TB')), '7.10 TiB');
  assert.equal(formatCapacity(capacityGiB('-514.81 MB')), '-515 MiB');
  assert.equal(formatCapacity(capacityGiB(25769803776)), '24.00 GiB');
  assert.equal(formatCapacity(null), '未知');
  assert.equal(formatBytes(58_044_108_755), '54.06 GiB');
  assert.equal(formatBytes(1_073_741_824_000), '1000.00 GiB');
  assert.equal(formatBytes(763_977_080), '729 MiB');
  assert.equal(formatBytes(0), '0 B');
});

test('byte counters gain an agreed text next to the number and nothing else changes', () => {
  const input = { usage: { usedBytes: 88_597_386_673, usedPercent: 8.25, resetAt: 'x', nested: [{ windowBytes: 735_401_761 }, { windowBytes: null }] }, history: { points: [{ totalBytes: 226_945_024 }] } };
  const out = withByteText(input) as unknown as { usage: Record<string, unknown> & { nested: Array<Record<string, unknown>> }; history: unknown };
  assert.equal(out.usage.usedBytesText, '82.51 GiB');
  assert.equal(out.usage.nested[0]?.windowBytesText, '701 MiB');
  assert.equal('windowBytesText' in (out.usage.nested[1] ?? {}), false);
  assert.deepEqual(out.history, input.history);
  assert.equal(out.usage.usedPercent, 8.25);
  assert.equal(withByteText('plain'), 'plain');
});

test('the M204 card is Chinese, grouped, and uses one unit system', () => {
  const text = renderHomelabReport(input);
  assert.match(text, /^\*\*结论：\*\* ✅ 正常\n/u);
  for (const title of ['💻 **宿主机**', '💾 **存储**', '🧩 **服务**', '🔍 **异常**']) assert.ok(text.includes(title), title);
  assert.ok(text.includes('• CPU：**14.6%** · 今日均值 15.8% · P95 20.9% · 峰值 34.8%（10-21 06:06）'));
  assert.ok(text.includes('• 内存：**15.20 GiB** / 24.00 GiB（63%） · 压力正常'));
  assert.ok(text.includes('• 交换：8.00 GiB / 9.00 GiB，较今日 00:00 减少 515 MiB'));
  assert.ok(text.includes('• Avalon：已用 7.10 TiB / 7.28 TiB（98%） · 剩余 **179.62 GiB** ⚠️ 空间紧张'));
  assert.ok(text.includes('• Macintosh HD：已用 328.40 GiB / 460.38 GiB（71%） · 剩余 **131.98 GiB**'));
  assert.ok(text.includes('• ✅ OpenClaw、Immich、Changedetection'));
  assert.ok(text.includes('• ✅ 路由器（OpenWrt 独立入口）可达'));
  assert.doesNotMatch(text, /\bGB\b|\bTB\b|\bMB\b|Pressure|Swap|avg|p95|OpenWrt（独立 endpoint）/u);
  assert.doesNotMatch(text, /\*\*[^*\n]+\*\*[^\s]/u);
});

test('an SoC power reading whose CPU column is a constant zero is not reported as power', () => {
  const power = host.power;
  assert.equal(socPowerReliable(power, 14.6), false);
  const text = renderHomelabReport(input);
  assert.ok(text.includes('⚡ 功耗：**暂无可靠数据**'));
  assert.doesNotMatch(text, /103 mW|0\.1 W|106 mW/u);
  assert.equal(socPowerReliable({ ...power, cpuPowerMw: 1850, socPowerMw: 2400 }, 14.6), true);
  assert.equal(socPowerReliable({ ...power, cpuPowerMw: 0 }, 0.5), true);
  assert.equal(socPowerReliable({ status: 'unavailable' }, 14.6), false);
  const good = renderHomelabReport({ ...input, host: { ...host, power: { ...power, cpuPowerMw: 1850, socPowerMw: 2400 } } });
  assert.ok(good.includes('SoC 约 **2.40 W** · 今日均值 106 mW · 峰值 185 mW（仅 SoC 估算，非整机）'));
});

test('failures stay visible: dead services, an unreachable router, anomalies, unmounted disks, no telemetry', () => {
  const text = renderHomelabReport({
    ...input,
    conclusion: '⚠️ 需要关注',
    services: { OpenClaw: true, qBittorrent: false },
    routerOk: false,
    anomalies: [{ summary: 'Swap 持续上升' }],
    host: { ...host, disks: { ...host.disks, avalon: { mounted: false } } },
  });
  assert.ok(text.includes('• ⚠️ **qBittorrent** 无响应'));
  assert.ok(text.includes('• ⚠️ 路由器（OpenWrt 独立入口）**无响应**'));
  assert.ok(text.includes('• Swap 持续上升'));
  assert.ok(text.includes('• Avalon：**未挂载**'));
  const down = renderHomelabReport({ ...input, host: { status: 'unavailable' }, unavailable: true, conclusion: '❌ 宿主机遥测不可用' });
  assert.ok(down.includes('• 宿主机遥测暂不可用'));
});
