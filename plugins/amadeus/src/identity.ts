import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import {
  IdentityStore,
  type AliasScope,
  type IdentityContext,
  type TrustedChannelIdentity,
} from '@agent/identity';
import type { AmadeusConfig } from './config.js';

export type IdentityResolveReference = 'self' | 'alias' | 'person' | 'mention' | 'reply_sender';
export type IdentityMutationTarget = 'current_sender' | 'mention' | 'reply_sender';

export interface IdentityResolveInput {
  reference: IdentityResolveReference;
  alias?: string;
  personId?: string;
  scope?: AliasScope;
  mentionIndex?: number;
}

export interface IdentityGetPersonInput {
  personId?: string;
  displayName?: string;
}

export interface IdentityBindChannelInput {
  personId: string;
  target?: IdentityMutationTarget;
  mentionIndex?: number;
}

export interface IdentityAddAliasInput {
  personId: string;
  alias: string;
  scope: AliasScope;
  source: 'confirmed' | 'observed';
  confidence?: number;
  evidenceSummary?: string;
}

export interface IdentityLinkAccountInput {
  personId: string;
  provider: string;
  externalId: string;
  label?: string;
}

export interface IdentityListCandidatesInput {
  scope?: AliasScope;
}

export interface IdentityConfirmCandidateInput {
  candidateId: string;
}

const stores = new Map<string, IdentityStore>();

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function identityStore(config: AmadeusConfig): IdentityStore {
  const key = `${config.identityDatabasePath}\u0000${config.identityPresetsFile ?? ''}`;
  const existing = stores.get(key);
  if (existing) return existing;
  const store = new IdentityStore(config.identityDatabasePath, config.identityPresetsFile ? { presetsFile: config.identityPresetsFile } : {});
  stores.set(key, store);
  return store;
}

function baseContext(context: OpenClawPluginToolContext): IdentityContext {
  const delivery = context.deliveryContext;
  const channel = text(context.messageChannel ?? delivery?.channel);
  const accountId = text(delivery?.accountId ?? context.agentAccountId);
  const conversationId = text(context.nativeChannelId ?? delivery?.to ?? delivery?.threadId);
  const senderId = text(context.requesterSenderId);
  const result: IdentityContext = {
    ...(channel ? { channel } : {}),
    ...(accountId ? { accountId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(senderId ? { senderId } : {}),
  };
  const binding = object(context.toolBindings?.identity);
  const rawMentions = binding?.mentions ?? binding?.mentionedUsers;
  const mentions = Array.isArray(rawMentions)
    ? rawMentions.flatMap((item) => {
      const row = object(item);
      const platformUserId = text(row?.platformUserId ?? row?.userId ?? row?.jid ?? row?.id);
      if (!platformUserId) return [];
      const mentionChannel = text(row?.channel) ?? channel;
      const mentionAccountId = text(row?.accountId) ?? accountId;
      const mentionConversationId = text(row?.conversationId) ?? conversationId;
      const mention: TrustedChannelIdentity = {
        platformUserId,
        ...(mentionChannel ? { channel: mentionChannel } : {}),
        ...(mentionAccountId ? { accountId: mentionAccountId } : {}),
        ...(mentionConversationId ? { conversationId: mentionConversationId } : {}),
      };
      return [mention];
    })
    : [];
  if (mentions.length) result.mentions = mentions;
  const reply = object(binding?.replySender ?? binding?.quotedSender);
  const replyUserId = text(reply?.platformUserId ?? reply?.userId ?? reply?.jid ?? reply?.id);
  if (replyUserId) {
    const replyChannel = text(reply?.channel) ?? channel;
    const replyAccountId = text(reply?.accountId) ?? accountId;
    const replyConversationId = text(reply?.conversationId) ?? conversationId;
    result.replySender = {
      platformUserId: replyUserId,
      ...(replyChannel ? { channel: replyChannel } : {}),
      ...(replyAccountId ? { accountId: replyAccountId } : {}),
      ...(replyConversationId ? { conversationId: replyConversationId } : {}),
    };
  }
  return result;
}

function trustedTarget(context: OpenClawPluginToolContext, target: IdentityMutationTarget, mentionIndex?: number): TrustedChannelIdentity {
  const current = baseContext(context);
  if (target === 'current_sender') {
    if (!current.channel || !current.senderId) throw new Error('trusted_sender_metadata_unavailable');
    return {
      channel: current.channel,
      ...(current.accountId ? { accountId: current.accountId } : {}),
      ...(current.conversationId ? { conversationId: current.conversationId } : {}),
      platformUserId: current.senderId,
    };
  }
  if (target === 'reply_sender') {
    if (!current.replySender) throw new Error('trusted_reply_sender_metadata_unavailable');
    return current.replySender;
  }
  if (mentionIndex === undefined || !Number.isInteger(mentionIndex) || mentionIndex < 0) throw new Error('mention_index_required');
  const mention = current.mentions?.[mentionIndex];
  if (!mention) throw new Error('trusted_mention_metadata_unavailable');
  return mention;
}

function requireOwner(context: OpenClawPluginToolContext): void {
  if (context.senderIsOwner !== true) throw new Error('identity_mutation_requires_owner_confirmation');
}

function referenceFor(input: IdentityResolveInput) {
  if (input.reference === 'self') return { type: 'self' as const };
  if (input.reference === 'person') return { type: 'person' as const, personId: input.personId ?? (() => { throw new Error('person_id_required'); })() };
  if (input.reference === 'alias') return {
    type: 'alias' as const,
    alias: input.alias ?? (() => { throw new Error('alias_required'); })(),
    ...(input.scope ? { scope: input.scope } : {}),
  };
  if (input.reference === 'reply_sender') return { type: 'reply_sender' as const };
  if (input.mentionIndex === undefined || !Number.isInteger(input.mentionIndex) || input.mentionIndex < 0) throw new Error('mention_index_required');
  return { type: 'mention' as const, index: input.mentionIndex };
}

export function identityContextFromOpenClaw(context: OpenClawPluginToolContext): IdentityContext {
  return baseContext(context);
}

export async function identityResolve(config: AmadeusConfig, input: IdentityResolveInput, context: OpenClawPluginToolContext): Promise<unknown> {
  return identityStore(config).resolve(referenceFor(input), baseContext(context));
}

export async function identityGetPerson(config: AmadeusConfig, input: IdentityGetPersonInput): Promise<unknown> {
  const store = identityStore(config);
  const person = input.personId
    ? store.getPerson(input.personId)
    : input.displayName
      ? store.findPersonByDisplayName(input.displayName)
      : undefined;
  return person ? { status: 'resolved', person } : { status: 'not_found', reason: 'person_not_found' };
}

export async function identityBindChannel(config: AmadeusConfig, input: IdentityBindChannelInput, context: OpenClawPluginToolContext): Promise<unknown> {
  requireOwner(context);
  const target = input.target ?? 'current_sender';
  const binding = identityStore(config).bindChannel({
    personId: input.personId,
    identity: trustedTarget(context, target, input.mentionIndex),
    source: 'confirmed',
    confidence: 1,
  });
  return { status: 'bound', binding, person: identityStore(config).getPerson(input.personId) };
}

export async function identityAddAlias(config: AmadeusConfig, input: IdentityAddAliasInput, context: OpenClawPluginToolContext): Promise<unknown> {
  if (input.source === 'confirmed') requireOwner(context);
  if (input.source === 'observed' && input.scope !== 'group') throw new Error('observed_alias_requires_group_scope');
  const current = baseContext(context);
  const alias = identityStore(config).addAlias({
    personId: input.personId,
    alias: input.alias,
    scope: input.scope,
    ...(input.scope === 'group' ? { scopeId: current.conversationId } : {}),
    source: input.source,
    ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
    ...(input.evidenceSummary ? { evidenceSummary: input.evidenceSummary } : {}),
  });
  return { status: input.source === 'confirmed' ? 'confirmed' : 'candidate', alias, person: identityStore(config).getPerson(input.personId) };
}

export async function identityLinkAccount(config: AmadeusConfig, input: IdentityLinkAccountInput, context: OpenClawPluginToolContext): Promise<unknown> {
  requireOwner(context);
  const account = identityStore(config).linkAccount({
    personId: input.personId,
    provider: input.provider,
    externalId: input.externalId,
    ...(input.label ? { label: input.label } : {}),
    source: 'confirmed',
    confidence: 1,
  });
  return { status: 'linked', account, person: identityStore(config).getPerson(input.personId) };
}

export async function identityListCandidates(config: AmadeusConfig, input: IdentityListCandidatesInput, context: OpenClawPluginToolContext): Promise<unknown> {
  const current = baseContext(context);
  const candidates = identityStore(config).listCandidates({ ...(input.scope ? { scope: input.scope } : {}), context: current });
  return { status: 'ok', candidates };
}

export async function identityConfirmCandidate(config: AmadeusConfig, input: IdentityConfirmCandidateInput, context: OpenClawPluginToolContext): Promise<unknown> {
  requireOwner(context);
  const alias = identityStore(config).confirmCandidate(input.candidateId);
  return { status: 'confirmed', alias, person: identityStore(config).getPerson(alias.personId) };
}
