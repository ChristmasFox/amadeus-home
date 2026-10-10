import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { adaptWorldlineNotification } from '@agent/presentation';
import { configFor, type AmadeusConfig } from '../config.js';
import {
  forgetTrustedInboundReply,
  rememberTrustedInboundReply,
} from '../identity.js';
import { ownerEvent, OwnerNotifier } from '../owner.js';
import { macHostAnomalies } from '../machost.js';
import { readVpsTrafficFuseSnapshotForWorker, trafficFuseWorldlineIntent, type VpsTrafficFuseEvent } from '../vps.js';

export function registerIdentityLifecycle(api: OpenClawPluginApi): void {
  api.on('before_dispatch', (event, hookContext) => {
    const eventMetadata = event as typeof event & {
      senderId?: unknown;
      senderE164?: unknown;
    };
    const hookMetadata = hookContext as typeof hookContext & {
      senderId?: unknown;
      senderE164?: unknown;
    };
    rememberTrustedInboundReply({
      sessionKey: hookContext.sessionKey ?? event.sessionKey,
      channel: hookContext.channelId ?? event.channel,
      accountId: hookContext.accountId,
      conversationId: hookContext.conversationId,
      senderId: hookMetadata.senderId ?? eventMetadata.senderId,
      senderE164: hookMetadata.senderE164 ?? eventMetadata.senderE164,
      replyToSender: hookContext.replyToSender ?? event.replyToSender,
    });
  });
  api.on('agent_end', (_event, hookContext) => {
    forgetTrustedInboundReply(hookContext.sessionKey);
  });
}

export function registerOwnerNotificationWorker(api: OpenClawPluginApi, config = configFor(api)): void {
  let workerTimer: ReturnType<typeof setInterval> | undefined;
  let anomalyTimer: ReturnType<typeof setInterval> | undefined;
  let trafficFuseTimer: ReturnType<typeof setInterval> | undefined;
  const bridgeAnomalies = async (notifier: OwnerNotifier): Promise<void> => {
    const payload = await macHostAnomalies(config);
    if (!payload || typeof payload !== 'object') return;
    const items = (payload as Record<string, unknown>).items;
    if (!Array.isArray(items)) return;
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      if (item.status !== 'active' || typeof item.eventKey !== 'string') continue;
      const severity = item.severity === 'critical' ? 'error' : item.severity === 'warning' ? 'warning' : 'info';
      const significance = item.severity === 'critical' ? 'critical' : item.severity === 'warning' ? 'major' : 'notable';
      try {
        await notifier.notify(ownerEvent({
          type: 'owner_notification',
          eventType: `mac_host_anomaly_${String(item.kind ?? 'unknown')}`,
          severity,
          significance,
          theme: 'worldline_divergence',
          eventKey: `mac-host-anomaly:${item.eventKey}`,
          source: 'mac-host-anomaly',
          headline: '🖥 M204 宿主机异常',
          facts: [
            { label: '异常', value: String(item.summary ?? 'unknown'), evidenceRefs: ['mac-host:/v1/anomalies'] },
            { label: '指标', value: typeof item.metric === 'number' ? item.metric : null, evidenceRefs: ['mac-host:/v1/anomalies'] },
          ],
          summary: String(item.summary ?? '宿主机遥测异常'),
          occurredAt: String(item.observedAt ?? new Date().toISOString()),
        }));
      } catch (error) {
        api.logger.warn(`amadeus mac host anomaly bridge failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  const bridgeTrafficFuse = async (notifier: OwnerNotifier): Promise<void> => {
    const payload = await readVpsTrafficFuseSnapshotForWorker(config);
    if (!payload || typeof payload !== 'object') return;
    const data = (payload as Record<string, unknown>).data;
    if (!data || typeof data !== 'object') return;
    const events = (data as Record<string, unknown>).events;
    if (!Array.isArray(events)) return;
    for (const raw of events) {
      if (!raw || typeof raw !== 'object') continue;
      const event = raw as VpsTrafficFuseEvent;
      if (!event.eventKey || !event.eventType || !event.occurredAt) continue;
      try {
        await notifier.notify(ownerEvent(adaptWorldlineNotification(trafficFuseWorldlineIntent(event))));
      } catch (error) {
        api.logger.warn(`amadeus VPS traffic fuse bridge failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  api.registerService({
    id: 'amadeus-owner-notification-worker',
    async start() {
      if (!config.ownerNotificationDeliveryEnabled) {
        api.logger.info('amadeus owner notification worker disabled by migration-safe runtime policy');
        return;
      }
      const notifier = new OwnerNotifier(api, config);
      await notifier.drain();
      await bridgeAnomalies(notifier);
      await bridgeTrafficFuse(notifier);
      workerTimer = setInterval(() => { void notifier.drain(); }, 5_000);
      anomalyTimer = setInterval(() => { void bridgeAnomalies(notifier); }, 30_000);
      trafficFuseTimer = setInterval(() => { void bridgeTrafficFuse(notifier); }, 60_000);
      workerTimer.unref();
      anomalyTimer.unref();
      trafficFuseTimer.unref();
    },
    stop() {
      if (workerTimer) clearInterval(workerTimer);
      if (anomalyTimer) clearInterval(anomalyTimer);
      if (trafficFuseTimer) clearInterval(trafficFuseTimer);
      workerTimer = undefined;
      anomalyTimer = undefined;
      trafficFuseTimer = undefined;
    },
  });
}
