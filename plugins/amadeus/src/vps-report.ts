/**
 * The VPS morning/evening card sent to the owner's WhatsApp, rendered in code from the six read-only VPS tools.
 *
 * Same conventions as the M204 card (homelab-report.ts): Markdown that OpenClaw re-renders for WhatsApp, `**bold**` on
 * the key figures with a space after each span, emoji outside the markers, binary units from shared/units, Shanghai
 * time, Chinese wording. Unknown, stale or incomplete values stay visible as such and are never filled with zero.
 */
import { adaptWorldlineNotification } from '@rine-kit/presentation';
import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import type { AmadeusConfig } from './config.js';
import { isGroupContext } from './machost.js';
import { isTrustedOwnerContext, ownerEventForContext, type OwnerNotifier } from './owner.js';
import { formatBytes } from './shared/units.js';
import { getVpsLiveStatus, getVpsServices, getVpsSubscriptionOverview, getVpsSystemStatus, getVpsTrafficFuseStatus, getVpsUsage } from './vps.js';

type Row = Record<string, unknown>;

const REPORT_TIMEZONE = 'Asia/Shanghai';
const BAR_CELLS = 10;

export interface VpsReportInput {
  live: unknown;
  usage: unknown;
  system: unknown;
  services: unknown;
  overview: unknown;
  fuse: unknown;
}

export interface VpsReportCard {
  text: string;
  conclusion: string;
  attention: string[];
  failed: boolean;
}

function row(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bytes(value: unknown): string {
  const number = finite(value);
  return number === null || number < 0 ? '未知' : formatBytes(number);
}

function stamp(iso: unknown, withDate = true): string | null {
  if (typeof iso !== 'string' || !Number.isFinite(Date.parse(iso))) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TIMEZONE, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return withDate ? `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}` : `${parts.hour}:${parts.minute}`;
}

/** ▓ for the used share, ░ for the rest; a non-zero share always fills at least one cell. */
export function progressBar(percent: number | null): string {
  if (percent === null) return '░'.repeat(BAR_CELLS);
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = clamped > 0 ? Math.max(1, Math.round(clamped / 100 * BAR_CELLS)) : 0;
  return '▓'.repeat(filled) + '░'.repeat(BAR_CELLS - filled);
}

function duration(seconds: unknown): string {
  const total = finite(seconds);
  if (total === null || total < 0) return '未知';
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`;
}

function fixed(value: unknown, digits: number): string {
  const number = finite(value);
  return number === null ? '未知' : number.toFixed(digits);
}

function sharePercent(part: unknown, whole: unknown): string {
  const a = finite(part);
  const b = finite(whole);
  return a === null || b === null || b <= 0 ? '未知' : `${Math.round(a / b * 100)}%`;
}

const FUSE_STATE: Record<string, string> = {
  INIT: '初始化中', NORMAL: '正常', WARNED: '已预警', PROTECTING: '保护中', CAPPED: '已限速', DEGRADED: '数据降级',
  APPLY_FAILED: '限速失败', RELEASING: '解除中', RELEASE_FAILED: '解除失败',
};
const FUSE_BAD = new Set(['PROTECTING', 'CAPPED', 'DEGRADED', 'APPLY_FAILED', 'RELEASING', 'RELEASE_FAILED']);
const FUSE_SOURCE: Record<string, string> = { provider_confirmed: '服务商确认', local_wan_estimate: '本机出口估算', unknown: '来源未知' };
const FUSE_COVERAGE: Record<string, string> = { complete: '覆盖完整', partial_coverage: '覆盖不完整', unknown: '覆盖未知' };

function unavailable(result: Row): boolean {
  return result.status === 'error' || result.status === 'stale' || result.status === undefined;
}

export function renderVpsReport(input: VpsReportInput): VpsReportCard {
  const live = row(input.live);
  const usageResult = row(input.usage);
  const systemResult = row(input.system);
  const servicesResult = row(input.services);
  const overviewResult = row(input.overview);
  const fuseResult = row(input.fuse);
  const attention: string[] = [];
  const sections: string[][] = [];

  // 📊 whole-plan traffic
  const usage = row(usageResult.usage);
  const usedPercent = finite(usage.usedPercent);
  if (unavailable(usageResult) || usedPercent === null) {
    attention.push('流量套餐数据不可用');
    sections.push(['📊 **流量套餐**', '• ⚠️ 套餐用量暂时读取失败，沿用的是最近一次成功读数或无数据']);
  } else {
    if (usedPercent >= 80) attention.push(`套餐已用 ${usedPercent.toFixed(1)}%`);
    const reset = stamp(usage.resetAt);
    const delta = finite(usage.deltaSincePreviousSampleBytes);
    sections.push([
      '📊 **流量套餐**',
      `${progressBar(usedPercent)} **${usedPercent.toFixed(1)}%** · 已用 **${bytes(usage.usedBytes)}** / ${bytes(usage.totalBytes)}`,
      `• 剩余 ${bytes(usage.remainingBytes)} · 重置日 **${reset ? reset.slice(0, 5) : '未知'}**${reset ? ` ${reset.slice(6)}` : ''}`,
      `• 较上次采样 ${usage.counterReset === true ? '计数器已重置' : delta === null ? '未知' : `+${formatBytes(delta)}`}`,
    ]);
  }

  // 🕛 last 12 hours
  const overview = row(overviewResult.data);
  const window = row(overview.reportWindow);
  const hours = (finite(window.seconds) ?? 43_200) / 3_600;
  if (unavailable(overviewResult) && !Object.keys(window).length) {
    attention.push('订阅监控数据不可用');
    sections.push([`🕛 **近 ${hours} 小时**`, '• ⚠️ 订阅监控暂时读取失败']);
  } else {
    const span = `${stamp(window.startAt) ?? '?'} – ${stamp(window.endAt) ?? '?'}`;
    const samples = finite(window.providerSampleCount);
    const provider = window.providerComplete === true ? `**${bytes(window.providerBytes)}**` : '窗口数据不完整';
    const subscription = window.subscriptionComplete === true ? bytes(window.subscriptionBytes) : '窗口数据不完整';
    const lines = [`🕛 **近 ${hours} 小时** （${span}${samples === null ? '' : `，采样 ${samples} 次`}）`, `• 整机 ${provider} · 订阅账号 ${subscription}`];
    if (window.otherServiceBytes !== null && window.otherServiceBytes !== undefined) {
      lines.push(`• 未归因残差（${window.otherServiceStatus === 'uncalibrated' ? '未校准' : '已校准'}）${bytes(window.otherServiceBytes)}，仅为整机减订阅账号之差，不是精确的服务计量`);
    } else {
      lines.push('• 未归因残差：窗口数据不完整，未知');
    }
    if (window.legacyComplete === true && (finite(window.legacyBytes) ?? 0) > 0) lines.push(`• 已下线账号 ${bytes(window.legacyBytes)}`);
    const top = row(window.topAccount);
    if (typeof top.accountId === 'string') lines.push(`• 增长最多：${top.accountId} ${bytes(top.windowBytes)}`);
    sections.push(lines);
  }

  // 👥 monitored totals per account
  const accounts = Array.isArray(overview.accounts) ? overview.accounts.map(row) : [];
  if (accounts.length) {
    const labels = accounts.map((account) => {
      const total = account.totalsComplete === true ? bytes(account.totalMonitoredBytes) : `≥ ${bytes(account.knownMonitoredBytes)}（不完整）`;
      return `${String(account.accountId)} ${total}`;
    });
    const since = stamp(overview.monitoringStartedAt);
    const legacy = row(overview.legacy);
    const lines = [`👥 **账号累计** （${since ? `自监控起点 ${since}` : '自监控起点'}）`, ...labels.map((label) => `• ${label}`)];
    if ((finite(legacy.totalMonitoredBytes) ?? 0) > 0) lines.push(`• 已下线账号历史用量 ${bytes(legacy.totalMonitoredBytes)}`);
    sections.push(lines);
  }

  // 🖥️ host
  const system = row(systemResult.system);
  const memory = row(system.memory);
  const root = row(system.rootFilesystem);
  const load = row(system.loadAverage);
  const serviceList = Array.isArray(servicesResult.services) ? servicesResult.services.map(row) : [];
  const liveInfo = row(live.live);
  const hostLines: string[] = ['🖥️ **主机**'];
  if (unavailable(systemResult) && !Object.keys(system).length) {
    attention.push('主机状态不可用');
    hostLines.push('• ⚠️ 系统状态读取失败（SSH 探针无数据）');
  } else {
    hostLines.push(`• 运行 ${duration(system.uptimeSeconds)} · 负载 ${fixed(load.oneMinute, 2)} / ${fixed(load.fiveMinutes, 2)} / ${fixed(load.fifteenMinutes, 2)}`);
    hostLines.push(`• 内存 已用 ${bytes(memory.usedBytes)} / ${bytes(memory.totalBytes)}（${sharePercent(memory.usedBytes, memory.totalBytes)}）`);
    const rootPercent = finite(root.usedPercent);
    if (rootPercent !== null && rootPercent >= 85) attention.push(`根分区已用 ${rootPercent}%`);
    hostLines.push(`• 根分区 已用 ${bytes(root.usedBytes)} / ${bytes(root.sizeBytes)}（${rootPercent === null ? '未知' : `${Math.round(rootPercent)}%`}）`);
  }
  if (liveInfo.state !== undefined && liveInfo.state !== 'running') attention.push(`VPS 状态：${String(liveInfo.state)}`);
  hostLines.push(`• KiwiVM：${liveInfo.state === 'running' ? '✅ 运行中' : liveInfo.state === undefined ? '⚠️ 状态未知' : `⚠️ ${String(liveInfo.state)}`}${liveInfo.cpuThrottled === null || liveInfo.cpuThrottled === undefined ? '（CPU 限速状态未知）' : liveInfo.cpuThrottled === true ? '（⚠️ CPU 被限速）' : ''}`);
  if (unavailable(servicesResult) && !serviceList.length) {
    attention.push('服务状态不可用');
    hostLines.push('• ⚠️ 核心服务状态读取失败');
  } else {
    const good = serviceList.filter((service) => service.healthy === true).map((service) => String(service.name));
    const bad = serviceList.filter((service) => service.healthy !== true).map((service) => String(service.name));
    if (bad.length) attention.push(`${bad.join('、')} 未运行`);
    hostLines.push(`• 服务 ${good.length && !bad.length ? `✅ ${good.join('、')} 全部运行` : `${good.length ? `✅ ${good.join('、')} ` : ''}⚠️ **${bad.join('、')}** 异常`}`);
  }
  sections.push(hostLines);

  // 🛡️ daily fuse and security
  const fuse = row(fuseResult.data);
  const security = row(overview.security);
  const auth = row(security.hysteriaAuth);
  const reality = row(security.realityFallback);
  const safety: string[] = ['🛡️ **熔断与安全**'];
  if (typeof fuse.state === 'string') {
    const state = fuse.state;
    if (FUSE_BAD.has(state)) attention.push(`流量熔断：${FUSE_STATE[state] ?? state}`);
    const watched = finite(fuse.effectiveBytes);
    safety.push(`• 上海日 **${bytes(watched)}** · 预警 ${bytes(fuse.warningThresholdBytes)} / 熔断 ${bytes(fuse.capThresholdBytes)}`);
    const next = stamp(fuse.nextRecoveryAt);
    safety.push(`• 熔断状态 ${FUSE_BAD.has(state) ? '⚠️ ' : ''}**${FUSE_STATE[state] ?? state}** · ${FUSE_SOURCE[String(fuse.sourceStatus)] ?? '来源未知'}，${FUSE_COVERAGE[String(fuse.coverage)] ?? '覆盖未知'}${finite(fuse.rateBitsPerSecond) !== null && state === 'CAPPED' ? ` · 限速 ${fixed((finite(fuse.rateBitsPerSecond) ?? 0) / 1_000_000, 1)} Mbit/s` : ''}${next && FUSE_BAD.has(state) ? ` · 恢复于 ${next}` : ''}`);
    safety.push('• Linux 出口限速不能保证服务商计费不超过阈值（入口流量可能已被计费）');
  } else if (row(fuseResult.error).code === 'TRAFFIC_FUSE_UNAVAILABLE') {
    safety.push('• 流量熔断：⚠️ **尚未在 VPS 上启用**（没有快照），目前没有日流量保护');
  } else {
    safety.push('• ⚠️ 熔断数据暂时读取失败，不能当作没有限速');
  }
  if (finite(auth.authFailuresWindow) !== null || finite(reality.windowTotalBytes) !== null) {
    safety.push(`• Hysteria2 认证失败 ${fixed(auth.authFailuresWindow, 0)} 次 · 被限流 ${fixed(auth.authRateLimitedWindow, 0)} 次 · Reality 回落流量 ${bytes(reality.windowTotalBytes)}`);
  }
  const signals = Array.isArray(security.signals) ? security.signals.map(row) : [];
  for (const signal of signals) {
    if (signal.code === 'reality_fallback_traffic') safety.push(`• ⚠️ 观察到可疑信号：Reality 回落流量 ${bytes(signal.value)}，超过阈值 ${bytes(signal.threshold)}（仅为信号，不代表入侵）`);
    else safety.push(`• ⚠️ 观察到可疑信号：${String(signal.code ?? '未知')}`);
  }
  sections.push(safety);

  // 🔎 data quality
  const sources = row(overview.sources);
  const bad = Object.entries(sources).filter(([, source]) => row(source).status !== 'ok').map(([name]) => name);
  const reconciliation = row(overview.reconciliation);
  const quality: string[] = ['🔎 **数据状态**'];
  quality.push(bad.length ? `• ⚠️ 监控来源异常或过期：${bad.join('、')}` : '• 订阅监控各来源均为最新');
  quality.push(reconciliation.status === 'uncalibrated' || reconciliation.status === undefined
    ? '• 整机与代理归因的对账：未校准，二者关系未知，不判断是否异常'
    : `• 整机与代理归因的对账：${String(reconciliation.status)}`);
  sections.push(quality);

  const failed = unavailable(usageResult) && unavailable(systemResult);
  const conclusion = failed
    ? '❌ 多项数据读取失败'
    : attention.length ? `⚠️ 需要关注：${attention.join('；')}` : '✅ 运行正常';
  const text = [`**结论：** ${conclusion}`, ...sections.flatMap((section) => ['', ...section])].join('\n');
  return { text, conclusion, attention, failed };
}

async function settle(call: () => Promise<unknown>): Promise<unknown> {
  try { return await call(); } catch (error) { return { status: 'error', error: { message: error instanceof Error ? error.message : String(error) } }; }
}

export async function vpsReport(
  config: AmadeusConfig,
  context: OpenClawPluginToolContext,
  notifier: OwnerNotifier,
  notifyOwner: boolean,
  reportPeriod?: 'morning' | 'evening',
  signal?: AbortSignal,
): Promise<unknown> {
  if ((notifyOwner || reportPeriod) && (isGroupContext(context) || !isTrustedOwnerContext(context))) {
    throw new Error('VPS owner notification requires direct owner authorization');
  }
  const [live, usage, system, services, overview, fuse] = await Promise.all([
    settle(() => getVpsLiveStatus(config, signal)),
    settle(() => getVpsUsage(config, signal)),
    settle(() => getVpsSystemStatus(config, signal)),
    settle(() => getVpsServices(config, signal)),
    settle(() => getVpsSubscriptionOverview(config, context, signal)),
    settle(() => getVpsTrafficFuseStatus(config, context, signal)),
  ]);
  const card = renderVpsReport({ live, usage, system, services, overview, fuse });
  let notification: unknown;
  if (notifyOwner) {
    const occurredAt = new Date().toISOString();
    const period = reportPeriod ?? 'manual';
    const eventKey = reportPeriod ? `vps-report:${occurredAt.slice(0, 10)}:${reportPeriod}` : `vps-report:manual:${occurredAt}:evening`;
    const healthy = !card.failed && !card.attention.length;
    const checkedAt = row(usage).checkedAt;
    notification = await notifier.notify(ownerEventForContext(adaptWorldlineNotification({
      type: 'worldline_notification_intent',
      eventType: reportPeriod ? `vps_report_${period}` : 'vps_report_manual',
      kind: healthy ? 'scheduled_report' : 'status_changed',
      severity: healthy ? 'success' : card.failed ? 'error' : 'warning',
      significance: healthy ? 'notable' : card.failed ? 'critical' : 'major',
      eventKey,
      source: 'vps-report',
      headline: reportPeriod === 'morning' ? '☁️ VPS 晨间报告' : reportPeriod === 'evening' ? '☁️ VPS 晚间报告' : '☁️ VPS 状态报告',
      facts: [],
      summary: card.text,
      ...(typeof checkedAt === 'string' ? { dataUpdatedAt: checkedAt } : {}),
      occurredAt,
    }), context));
  }
  return { text: card.text, conclusion: card.conclusion, ...(notification === undefined ? {} : { notification }) };
}
