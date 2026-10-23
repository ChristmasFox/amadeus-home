import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertValid, validateOwnerNotificationPresentation, type OwnerNotificationPresentation } from '@rine-kit/presentation';

/** The same request surface the amadeus owner notifier uses; in the plugin it is api.runtime.gateway. */
export interface ReportGateway {
  request(method: string, params: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Where one kind of report for one squad goes. Lab builds exactly one from configuration; a multi-tenant host would
 * load these from storage. Delivery never infers a target from chat context.
 */
export interface ReportSubscription {
  id: string;
  tenantId: string;
  squadId: string;
  kind: 'session-review';
  channel: 'whatsapp';
  accountId: string;
  target: string;
  expectedName: string;
  enabled: boolean;
}

export const WHATSAPP_GROUP_JID = /^[0-9]{5,32}(?:-[0-9]{5,32})?@g\.us$/u;

export async function loadReviewSubscription(input: {
  targetFile: string;
  expectedName: string;
  accountId: string;
  squadId: string;
}): Promise<ReportSubscription> {
  const target = (await readFile(input.targetFile, 'utf8')).trim();
  if (!WHATSAPP_GROUP_JID.test(target)) throw new Error('review group target must be a WhatsApp group JID (…@g.us)');
  if (!input.expectedName.trim()) throw new Error('review group expected name is required');
  return {
    id: `whatsapp:${input.accountId}:${target}`,
    tenantId: 'lab',
    squadId: input.squadId,
    kind: 'session-review',
    channel: 'whatsapp',
    accountId: input.accountId,
    target,
    expectedName: input.expectedName.trim(),
    enabled: true,
  };
}

export type TargetCheck =
  | { ok: true; groupName: string }
  | { ok: false; reason: 'tenant_mismatch' | 'target_not_group' | 'bot_not_in_group' | 'group_name_mismatch' | 'directory_unavailable'; groupName?: string; error?: string };

interface ConversationRow {
  channel?: unknown;
  accountId?: unknown;
  kind?: unknown;
  target?: unknown;
  label?: unknown;
  lastSeenAt?: unknown;
}

/** OpenClaw labels groups as "whatsapp:g-<slug of the subject>"; compare both sides in that slug form. */
export function groupSlug(value: string): string {
  return value.normalize('NFKC').replace(/^whatsapp:g-/u, '').trim().toLowerCase().replace(/[\s_]+/gu, '-');
}

/**
 * Checks, right before every send: the subscription belongs to the squad's tenant, the target is a group JID, the bot
 * account has that group in its conversation directory, and the group's current name is the one configured.
 */
export async function checkReviewTarget(gateway: ReportGateway, subscription: ReportSubscription, squadTenantId: string, agentId = 'main'): Promise<TargetCheck> {
  if (subscription.tenantId !== squadTenantId) return { ok: false, reason: 'tenant_mismatch' };
  if (!WHATSAPP_GROUP_JID.test(subscription.target)) return { ok: false, reason: 'target_not_group' };
  let rows: ConversationRow[];
  try {
    // OpenClaw gates conversations.list behind operator.admin; a plugin call without explicit scopes only gets operator.write.
    const response = await gateway.request('conversations.list', { agentId }, { timeoutMs: 15_000, scopes: ['operator.admin'] }) as { conversations?: unknown };
    rows = Array.isArray(response?.conversations) ? response.conversations as ConversationRow[] : [];
  } catch (error) {
    return { ok: false, reason: 'directory_unavailable', error: (error instanceof Error ? error.message : String(error)).slice(0, 200) };
  }
  const group = rows
    .filter((row) => row.channel === 'whatsapp' && row.kind === 'group' && row.accountId === subscription.accountId && row.target === subscription.target)
    .sort((left, right) => Number(right.lastSeenAt ?? 0) - Number(left.lastSeenAt ?? 0))[0];
  if (!group) return { ok: false, reason: 'bot_not_in_group' };
  const groupName = typeof group.label === 'string' ? group.label.replace(/^whatsapp:g-/u, '') : '';
  if (groupSlug(groupName) !== groupSlug(subscription.expectedName)) return { ok: false, reason: 'group_name_mismatch', groupName };
  return { ok: true, groupName };
}

export function reviewIdempotencyKey(sessionKey: string, subscription: ReportSubscription): string {
  return `${sessionKey}:${subscription.id}`;
}

export async function sendReview(gateway: ReportGateway, subscription: ReportSubscription, message: string, idempotencyKey: string): Promise<void> {
  await gateway.request('send', {
    channel: subscription.channel,
    to: subscription.target,
    accountId: subscription.accountId,
    message,
    idempotencyKey,
  }, { timeoutMs: 20_000 });
}

const BLOCK_REASONS: Record<string, string> = {
  tenant_mismatch: '订阅不属于这个小队',
  target_not_group: '配置的目标不是 WhatsApp 群',
  bot_not_in_group: '机器人账号不在这个群里(或目录里没有它)',
  group_name_mismatch: '群名称和配置的不一致',
  directory_unavailable: '暂时查不到群目录(会继续重试,目录恢复后自动补发)',
  delivery_failed: '多次发送失败',
  share_link_unavailable: '没有可用的分享页地址(reviewPageBaseUrl)',
  no_subscription: '没有配置复盘群',
};

/**
 * Tells the owner a review was held back, by queueing a structured event in the amadeus owner outbox; the owner worker
 * delivers it on the fixed owner path. The review itself never goes anywhere else.
 */
export async function queueOwnerBlockedNotice(outboxDir: string, input: { sessionKey: string; reason: string; groupName?: string; error?: string; occurredAt: string }): Promise<void> {
  const presentation: OwnerNotificationPresentation = {
    type: 'owner_notification',
    eventType: 'pubg_session_review_blocked',
    severity: 'warning',
    significance: 'major',
    theme: 'worldline_divergence',
    eventKey: `pubg-session-review-blocked:${input.sessionKey}`,
    source: 'pubg-session-review',
    headline: '⚠ 每日复盘未投递',
    summary: input.reason === 'directory_unavailable'
      ? `${BLOCK_REASONS[input.reason]},这份每日复盘还没有发到任何群。`
      : `${BLOCK_REASONS[input.reason] ?? input.reason},这份每日复盘没有发到任何群。`,
    facts: [
      { label: '原因', value: input.reason, evidenceRefs: ['pubg:session-review'] },
      ...(input.error ? [{ label: '错误', value: input.error, evidenceRefs: ['pubg:session-review'] }] : []),
      ...(input.groupName ? [{ label: '当前群名', value: input.groupName, evidenceRefs: ['openclaw:conversations.list'] }] : []),
    ],
    occurredAt: input.occurredAt,
  };
  const event = { version: 1, ...assertValid(validateOwnerNotificationPresentation(presentation)) };
  await mkdir(outboxDir, { recursive: true, mode: 0o700 });
  const id = createHash('sha256').update(event.eventKey).digest('hex').slice(0, 40);
  for (const suffix of ['pending', 'sent']) {
    try { await readFile(join(outboxDir, `${id}.${suffix}.json`)); return; } catch { /* not queued yet */ }
  }
  const temporary = join(outboxDir, `.${id}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, join(outboxDir, `${id}.pending.json`));
}
