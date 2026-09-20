import { Static, Type } from 'typebox';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { adaptWorldlineNotification, type OwnerNotificationPresentation, type WorldlineNotificationIntent } from '@agent/presentation';
import { configFor } from '../../config.js';
import { isTrustedOwnerContext, ownerEventForContext } from '../../owner.js';
import { registerTool } from '../../shared/register-tool.js';

const FactParameters = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 200 }),
  value: Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
  evidenceRefs: Type.Array(Type.String({ minLength: 1, maxLength: 256 })),
}, { additionalProperties: false });

const LinkParameters = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 200 }),
  url: Type.String({ minLength: 1, maxLength: 2_000 }),
  evidenceRefs: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }))),
}, { additionalProperties: false });

const OwnerPresentationParameters = Type.Object({
  type: Type.Literal('owner_notification'),
  eventType: Type.String({ minLength: 1, maxLength: 128 }),
  severity: Type.Union([Type.Literal('info'), Type.Literal('success'), Type.Literal('warning'), Type.Literal('error')]),
  significance: Type.Union([Type.Literal('minor'), Type.Literal('notable'), Type.Literal('major'), Type.Literal('critical')]),
  theme: Type.Union([
    Type.Literal('worldline_observation'), Type.Literal('worldline_divergence'), Type.Literal('worldline_convergence'),
    Type.Literal('dmail'), Type.Literal('reading_steiner'), Type.Literal('attractor_field'), Type.Literal('rounder_activity'),
    Type.Literal('sern_alert'), Type.Literal('ibn_5100'), Type.Literal('time_leap'), Type.Literal('operation_skuld'),
  ]),
  eventKey: Type.String({ minLength: 1, maxLength: 256 }),
  source: Type.String({ minLength: 1, maxLength: 128 }),
  headline: Type.String({ minLength: 1, maxLength: 200 }),
  facts: Type.Array(FactParameters),
  links: Type.Optional(Type.Array(LinkParameters)),
  summary: Type.Optional(Type.String({ maxLength: 16_000 })),
  dataUpdatedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  occurredAt: Type.String({ minLength: 1, maxLength: 64 }),
  worldLineClosing: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const WorldlineIntentParameters = Type.Object({
  type: Type.Literal('worldline_notification_intent'),
  eventType: Type.String({ minLength: 1, maxLength: 128 }),
  kind: Type.String({ minLength: 1, maxLength: 128 }),
  severity: Type.Union([Type.Literal('info'), Type.Literal('success'), Type.Literal('warning'), Type.Literal('error')]),
  significance: Type.Union([Type.Literal('minor'), Type.Literal('notable'), Type.Literal('major'), Type.Literal('critical')]),
  eventKey: Type.String({ minLength: 1, maxLength: 256 }),
  source: Type.String({ minLength: 1, maxLength: 128 }),
  headline: Type.Optional(Type.String({ maxLength: 200 })),
  facts: Type.Array(FactParameters),
  links: Type.Optional(Type.Array(LinkParameters)),
  summary: Type.Optional(Type.String({ maxLength: 16_000 })),
  dataUpdatedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  occurredAt: Type.String({ minLength: 1, maxLength: 64 }),
  worldLineClosing: Type.Optional(Type.Boolean()),
  correlation: Type.Optional(Type.Object({
    fingerprint: Type.Optional(Type.String({ maxLength: 256 })),
    occurrenceCount: Type.Optional(Type.Integer({ minimum: 1 })),
    windowMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
  }, { additionalProperties: false })),
  operation: Type.Optional(Type.Object({
    code: Type.Optional(Type.String({ maxLength: 128 })),
    phase: Type.Optional(Type.String({ maxLength: 128 })),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

const NotifyOwnerParameters = Type.Union([OwnerPresentationParameters, WorldlineIntentParameters]);
type NotifyOwnerInput = Static<typeof NotifyOwnerParameters>;

export function registerNotification(api: OpenClawPluginApi): void {
  registerTool(api, 'amadeus_notify_owner', 'Queue a validated structured owner notification or deterministic worldline intent through the canonical owner outbox. For scheduled reports, use the stable eventKey; manual cron runs are isolated under a separate key and never consume a scheduled key.', NotifyOwnerParameters, async (params, context, notifier) => {
    if (!isTrustedOwnerContext(context)) throw new Error('owner notification requires owner identity');
    const input = params as NotifyOwnerInput;
    const presentation: OwnerNotificationPresentation = input.type === 'worldline_notification_intent'
      ? adaptWorldlineNotification(input as WorldlineNotificationIntent)
      : input as OwnerNotificationPresentation;
    return notifier.notify(ownerEventForContext(presentation, context));
  });
}
