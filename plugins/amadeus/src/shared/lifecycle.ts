import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor, type AmadeusConfig } from '../config.js';
import {
  forgetTrustedInboundReply,
  rememberTrustedInboundReply,
} from '../identity.js';
import { OwnerNotifier } from '../owner.js';

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
  api.registerService({
    id: 'amadeus-owner-notification-worker',
    async start() {
      if (!config.ownerNotificationDeliveryEnabled) {
        api.logger.info('amadeus owner notification worker disabled by migration-safe runtime policy');
        return;
      }
      const notifier = new OwnerNotifier(api, config);
      await notifier.drain();
      workerTimer = setInterval(() => { void notifier.drain(); }, 5_000);
      workerTimer.unref();
    },
    stop() {
      if (workerTimer) clearInterval(workerTimer);
      workerTimer = undefined;
    },
  });
}
