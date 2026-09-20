import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import type { AmadeusConfig } from './config.js';
import { requestJson } from './http.js';
import { isTrustedOwnerContext, ownerEvent, type OwnerNotifier } from './owner.js';

function healthy(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.statusCode === undefined ? true : Number(item.statusCode) >= 200 && Number(item.statusCode) < 300;
}

async function probe(url: string): Promise<{ ok: boolean; data?: unknown }> {
  try {
    const data = await requestJson(url, { timeoutMs: 8_000 });
    return { ok: healthy(data), data };
  }
  catch { return { ok: false }; }
}

export async function homelabStatus(config: AmadeusConfig, context: OpenClawPluginToolContext, notifier: OwnerNotifier, notifyOwner: boolean, signal?: AbortSignal): Promise<unknown> {
  const quicklook = await requestJson(config.homeLabGlancesUrl, { ...(signal ? { signal } : {}), timeoutMs: 10_000 }).catch(() => ({}));
  const uptimeRaw = await requestJson(config.homeLabUptimeUrl, { ...(signal ? { signal } : {}), timeoutMs: 10_000 }).catch(() => ({}));
  const serviceUrls: Record<string, string> = {
    OpenClaw: 'http://openclaw:18789/healthz',
    ProductRadar: `${config.homeLabBaseUrl}:5315/health`,
    Changedetection: `${config.homeLabBaseUrl}:5000/`,
    Immich: `${config.homeLabBaseUrl}:2283/api/server/ping`,
    Emby: `${config.homeLabBaseUrl}:8096/emby/system/info/public`,
    qBittorrent: `${config.homeLabBaseUrl}:8080/`,
    OpenWrt: 'http://192.168.5.1/',
  };
  const services: Record<string, boolean> = {};
  await Promise.all(Object.entries(serviceUrls).map(async ([name, url]) => { services[name] = (await probe(url)).ok; }));
  const quick = quicklook && typeof quicklook === 'object' ? quicklook as Record<string, unknown> : {};
  const uptime = typeof uptimeRaw === 'string' ? uptimeRaw : uptimeRaw && typeof uptimeRaw === 'object' ? JSON.stringify(uptimeRaw) : '未知';
  const lines = [
    '🖥 HomeLab Status',
    '',
    '⚙️ CPU',
    `使用率：${Number(quick.cpu ?? 0).toFixed(1)}%`,
    `核心：${String(quick.cpu_log_core ?? quick.cpu_cores ?? 'N/A')}`,
    '',
    '🧠 Memory',
    `RAM：${Number(quick.mem ?? 0).toFixed(1)}%`,
    '',
    '🐳 Services',
    ...Object.entries(services).map(([name, ok]) => `${ok ? '✅' : '❌'} ${name}`),
    '',
    '⏱ Uptime',
    uptime.slice(0, 300),
  ];
  const text = lines.join('\n');
  let notification: unknown;
  if (notifyOwner) {
    if (!isTrustedOwnerContext(context)) throw new Error('owner notification requires owner identity');
    const occurredAt = new Date().toISOString();
    notification = await notifier.notify(ownerEvent({
      type: 'owner_notification',
      eventType: 'homelab_status',
      severity: Object.values(services).every(Boolean) ? 'success' : 'warning',
      eventKey: `homelab-status:${occurredAt.slice(0, 16)}`,
      source: 'homelab-status',
      headline: 'HomeLab 状态',
      facts: Object.entries(services).map(([name, ok]) => ({ label: name, value: ok, evidenceRefs: [] })),
      summary: text,
      occurredAt,
    }));
  }
  return { text, services, ...(notification === undefined ? {} : { notification }) };
}
