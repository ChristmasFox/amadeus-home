import { Static, Type } from 'typebox';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import type { OwnerNotificationPresentation } from '@agent/presentation';
import { configFor } from '../../config.js';
import { isTrustedOwnerContext, ownerEventForContext } from '../../owner.js';
import { registerTool } from '../../shared/register-tool.js';

const NotifyOwnerParameters = Type.Object({
  type: Type.Literal('owner_notification'),
  eventType: Type.String({ minLength: 1, maxLength: 128 }),
  severity: Type.Union([Type.Literal('info'), Type.Literal('success'), Type.Literal('warning'), Type.Literal('error')]),
  eventKey: Type.String({ minLength: 1, maxLength: 256 }),
  source: Type.String({ minLength: 1, maxLength: 128 }),
  headline: Type.String({ minLength: 1, maxLength: 200 }),
  facts: Type.Array(Type.Object({
    label: Type.String({ minLength: 1, maxLength: 200 }),
    value: Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
    evidenceRefs: Type.Array(Type.String({ minLength: 1, maxLength: 256 })),
  }, { additionalProperties: false })),
  summary: Type.Optional(Type.String({ maxLength: 16_000 })),
  dataUpdatedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  occurredAt: Type.String({ minLength: 1, maxLength: 64 }),
  worldLineClosing: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export function registerNotification(api: OpenClawPluginApi): void {
  registerTool(api, 'amadeus_notify_owner', 'Send a proactive owner notification to the fixed WhatsApp owner DM. For scheduled reports, use the stable eventKey; manual cron runs are isolated under a separate key and never consume a scheduled key.', NotifyOwnerParameters, async (params, context, notifier) => {
    if (!isTrustedOwnerContext(context)) throw new Error('owner notification requires owner identity');
    return notifier.notify(ownerEventForContext(params as Static<typeof NotifyOwnerParameters> as OwnerNotificationPresentation, context));
  });
}
