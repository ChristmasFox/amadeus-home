import type { WorldlineNotificationIntent } from '@rine-kit/presentation';

/** Human-readable owner notice for the VPS daily traffic fuse (numbers in GB / Mbps, Shanghai time, Chinese states). */

const TIMEZONE = 'Asia/Shanghai';
const GB = 1_000_000_000; // the fuse thresholds are decimal: 50_000_000_000 bytes = 50 GB

export type FuseEventType = 'warning' | 'engaged' | 'released' | 'apply-failed' | 'release-failed';

export interface FuseNoticeInput {
  eventKey: string;
  eventType: FuseEventType;
  day: string;
  observedBytes: number | null;
  warningThresholdBytes: number | null;
  capThresholdBytes: number | null;
  remainingHeadroomBytes: number | null;
  coverage: 'complete' | 'partial_coverage' | 'unknown';
  coverageStartedAt?: string | null;
  sourceStatus: 'provider_confirmed' | 'local_wan_estimate' | 'unknown';
  dataUpdatedAt: string | null;
  rateBitsPerSecond: number | null;
  nextRecoveryAt: string | null;
  normalEgressRestored: boolean | null;
  occurredAt: string | null;
}

export function formatGb(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '未知';
  const gb = value / GB;
  return `${(gb >= 100 ? gb.toFixed(1) : gb.toFixed(2)).replace(/\.?0+$/u, '')} GB`;
}

export function formatPercent(part: number | null, whole: number | null): string | null {
  if (part === null || whole === null || whole <= 0 || part < 0) return null;
  const percent = (part / whole) * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

export function formatRate(bitsPerSecond: number | null): string {
  if (bitsPerSecond === null || !Number.isFinite(bitsPerSecond) || bitsPerSecond < 0) return '未知';
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(2).replace(/\.?0+$/u, '')} Mbps`;
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

/** YYYY-MM-DD HH:mm in Shanghai time; never a raw ISO string or timestamp. */
export function formatShanghai(iso: string | null | undefined): string | null {
  if (typeof iso !== 'string' || !Number.isFinite(Date.parse(iso))) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function clock(iso: string | null | undefined): string | null {
  const full = formatShanghai(iso);
  return full ? full.slice(11) : null;
}

export function describeSource(source: FuseNoticeInput['sourceStatus']): string {
  if (source === 'provider_confirmed') return '以服务商流量计数为准（已确认）';
  if (source === 'local_wan_estimate') return '本机网卡估算，尚未得到服务商确认';
  return '数据来源暂未确认';
}

export function describeCoverage(coverage: FuseNoticeInput['coverage'], startedAt?: string | null): string {
  if (coverage === 'complete') return '今天的统计完整';
  if (coverage === 'partial_coverage') {
    const from = formatShanghai(startedAt);
    return from ? `今天统计不完整：从 ${from} 开始计入，更早的流量没有算进来` : '今天统计不完整：只计入了监控开始之后的流量';
  }
  return '统计完整性未知';
}

const HEADLINES: Record<FuseEventType, string> = {
  warning: 'VPS 流量预警',
  engaged: 'VPS 已限速',
  released: 'VPS 限速已解除',
  'apply-failed': 'VPS 限速未能生效',
  'release-failed': 'VPS 解除限速失败',
};

function summary(event: FuseNoticeInput): string {
  const used = formatGb(event.observedBytes);
  const recover = formatShanghai(event.nextRecoveryAt);
  switch (event.eventType) {
    case 'warning':
      return `${event.day} 的 VPS 出口流量已到预警线：已用 ${used}，距熔断线还剩 ${formatGb(event.remainingHeadroomBytes)}；到熔断线会自动限速。`;
    case 'engaged':
      return `${event.day} 的 VPS 出口流量达到熔断线（已用 ${used}），整台 VPS 的对外出口已限速到 ${formatRate(event.rateBitsPerSecond)}（SSH 管理通道保留）。${recover ? `预计 ${recover} 恢复。` : ''}`;
    case 'released':
      return event.normalEgressRestored === true
        ? '限速已解除，出口已确认恢复正常。'
        : '已尝试解除限速，但还没有确认出口恢复。';
    case 'apply-failed':
      return `流量已到熔断线（已用 ${used}），但限速规则没有被确认生效，系统会按固定周期重试。`;
    default:
      return '到点后解除限速的操作没有得到确认，出口可能仍被限速，系统会继续重试。';
  }
}

export function trafficFuseNoticeIntent(event: FuseNoticeInput): WorldlineNotificationIntent {
  const isRelease = event.eventType === 'released';
  const isFailure = event.eventType === 'apply-failed' || event.eventType === 'release-failed';
  const cap = event.capThresholdBytes;
  const warning = event.warningThresholdBytes;
  const facts: WorldlineNotificationIntent['facts'] = [];
  const add = (label: string, value: string | null) => {
    if (value) facts.push({ label, value, evidenceRefs: ['vps-traffic-fuse:notice'] });
  };
  const usedShare = [formatPercent(event.observedBytes, warning) && `占预警线 ${formatPercent(event.observedBytes, warning)}`,
    formatPercent(event.observedBytes, cap) && `占熔断线 ${formatPercent(event.observedBytes, cap)}`].filter(Boolean).join('，');
  if (!isRelease) {
    add('今日已用', `${formatGb(event.observedBytes)}${usedShare ? `（${usedShare}）` : ''}`);
    add('阈值', `预警 ${formatGb(warning)} · 熔断 ${formatGb(cap)}`);
    const over = event.observedBytes !== null && cap !== null && event.observedBytes >= cap;
    const remaining = formatPercent(event.remainingHeadroomBytes, cap);
    add('距熔断线余量', over
      ? `已用尽（超出 ${formatGb(event.observedBytes! - cap!)}）`
      : `${formatGb(event.remainingHeadroomBytes)}${remaining ? `（${remaining}）` : ''}`);
  }
  if (event.eventType === 'engaged' || (event.rateBitsPerSecond !== null && !isRelease)) add('出口限速', formatRate(event.rateBitsPerSecond));
  add('数据来源', describeSource(event.sourceStatus));
  add('统计范围', describeCoverage(event.coverage, event.coverageStartedAt));
  add('数据更新', formatShanghai(event.dataUpdatedAt));
  const recovery = formatShanghai(event.nextRecoveryAt);
  if (!isRelease && !isFailure) add('恢复时间', recovery ? `${recovery}（上海时间，当天午夜自动解除）` : event.eventType === 'warning' ? '未限速，无需恢复' : null);
  return {
    type: 'worldline_notification_intent',
    eventType: `vps_daily_fuse_${event.eventType}`,
    kind: isRelease ? 'source_recovered' : isFailure ? 'dependency_failure' : event.eventType === 'engaged' ? 'network_degraded' : 'status_changed',
    severity: isRelease ? 'success' : isFailure ? 'error' : 'warning',
    significance: isFailure ? 'critical' : event.eventType === 'engaged' ? 'major' : 'notable',
    eventKey: event.eventKey,
    source: 'vps-traffic-fuse',
    headline: HEADLINES[event.eventType],
    summary: summary(event),
    facts,
    // The renderer would print this as HH:mm without a date, so the dated value lives in the facts above.
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    ...(isRelease ? { worldLineClosing: true } : {}),
  };
}
