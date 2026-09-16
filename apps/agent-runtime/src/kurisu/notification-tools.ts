import { z } from 'zod';

import { notificationChannelSchema, notificationResultTypeSchema, notificationSourceSchema, NotificationPreferenceStore, NotificationWorker } from './notifications.js';
import type { TrustedExecutionContext } from './contracts.js';
import { evidence, failure, ok, type ToolDefinition, ToolRegistry } from './tools.js';

const preferenceSource = z.union([notificationSourceSchema, z.literal('all')]);
const preferenceResultType = z.union([notificationResultTypeSchema, z.literal('all')]);
const preferenceChannel = z.union([notificationChannelSchema, z.literal('all')]);

export const notificationPreferenceSetInputSchema = z.object({
  source: preferenceSource,
  resultType: preferenceResultType,
  channel: preferenceChannel,
  action: z.enum(['mute', 'allow']),
  until: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: z.string().trim().min(1).max(64).default('Asia/Shanghai'),
  reference: z.string().trim().max(256).optional(),
}).strict();

export const notificationPreferenceForgetInputSchema = z.object({
  source: preferenceSource.optional(),
  resultType: preferenceResultType.optional(),
  channel: preferenceChannel.optional(),
}).strict();

export const notificationDeliveryRetryInputSchema = z.object({
  deliveryId: z.string().trim().min(1).max(256),
}).strict();

/** Register user-scoped notification preference reads and explicit updates. */
export function registerNotificationPreferenceTools(registry: ToolRegistry, preferences: NotificationPreferenceStore, notifications?: NotificationWorker): void {
  registry.register({
    name: 'kurisu.notifications.preference.get',
    version: '1.0.0',
    description: 'Read durable notification preferences for the authenticated user.',
    risk: 'read',
    timeoutMs: 5_000,
    idempotency: 'optional',
    reconciliation: 'not_applicable',
    inputSchema: z.object({}).strict(),
    jsonSchema: z.toJSONSchema(z.object({}).strict()),
    handler: async (_input, context) => getPreferences(preferences, context),
  });
  registry.register({
    name: 'kurisu.notifications.preference.set',
    version: '1.0.0',
    description: 'Set one explicit, time-bounded notification preference; source and channel remain separate.',
    risk: 'write',
    timeoutMs: 5_000,
    idempotency: 'required',
    reconciliation: 'not_applicable',
    inputSchema: notificationPreferenceSetInputSchema,
    jsonSchema: z.toJSONSchema(notificationPreferenceSetInputSchema),
    handler: async (input, context) => setPreference(preferences, input, context),
  });
  registry.register({
    name: 'kurisu.notifications.preference.forget',
    version: '1.0.0',
    description: 'Forget matching durable notification preferences for the authenticated user.',
    risk: 'write',
    timeoutMs: 5_000,
    idempotency: 'required',
    reconciliation: 'not_applicable',
    inputSchema: notificationPreferenceForgetInputSchema,
    jsonSchema: z.toJSONSchema(notificationPreferenceForgetInputSchema),
    handler: async (input, context) => forgetPreference(preferences, input, context),
  });
  if (notifications) {
    registry.register({
      name: 'kurisu.notifications.delivery.retry',
      version: '1.0.0',
      description: 'Requeue one failed or uncertain notification delivery owned by the authenticated user.',
      risk: 'write',
      timeoutMs: 5_000,
      idempotency: 'required',
      reconciliation: 'not_applicable',
      inputSchema: notificationDeliveryRetryInputSchema,
      jsonSchema: z.toJSONSchema(notificationDeliveryRetryInputSchema),
      handler: async (input, context) => retryDelivery(notifications, input, context),
    });
  }
}

async function retryDelivery(notifications: NotificationWorker, input: unknown, context: TrustedExecutionContext) {
  const parsed = notificationDeliveryRetryInputSchema.parse(input);
  const delivery = notifications.retryDelivery(parsed.deliveryId, context.principalKey, context.now);
  if (!delivery) return failure('DELIVERY_NOT_RETRYABLE_OR_NOT_FOUND', 'delivery is not retryable or is outside the authenticated principal scope', false);
  return ok({ delivery }, [evidence('kurisu.notifications', 'failed or uncertain delivery was explicitly requeued')]);
}

async function getPreferences(preferences: NotificationPreferenceStore, context: TrustedExecutionContext) {
  return ok({ rules: preferences.list(context.principalKey, context.now) }, [evidence('kurisu.preferences', 'principal-scoped notification preferences were read')]);
}

async function setPreference(preferences: NotificationPreferenceStore, input: unknown, context: TrustedExecutionContext) {
  const parsed = notificationPreferenceSetInputSchema.parse(input);
  const ruleInput = {
    source: parsed.source,
    resultType: parsed.resultType,
    channel: parsed.channel,
    action: parsed.action,
    timezone: parsed.timezone,
    ...(parsed.until !== undefined ? { until: parsed.until } : {}),
    ...(parsed.reference !== undefined ? { reference: parsed.reference } : {}),
  };
  const rule = preferences.setRule(context.principalKey, ruleInput, context.now);
  return ok({ rule }, [evidence('kurisu.preferences', 'explicit user preference was durably recorded')]);
}

async function forgetPreference(preferences: NotificationPreferenceStore, input: unknown, context: TrustedExecutionContext) {
  const parsed = notificationPreferenceForgetInputSchema.parse(input);
  if (!parsed.source && !parsed.resultType && !parsed.channel) return failure('PREFERENCE_SELECTOR_REQUIRED', 'forget requires at least one preference dimension', false);
  const selector = {
    ...(parsed.source !== undefined ? { source: parsed.source } : {}),
    ...(parsed.resultType !== undefined ? { resultType: parsed.resultType } : {}),
    ...(parsed.channel !== undefined ? { channel: parsed.channel } : {}),
  };
  const removed = preferences.forget(context.principalKey, selector, context.now);
  return ok({ removed }, [evidence('kurisu.preferences', 'matching user preferences were forgotten')]);
}
