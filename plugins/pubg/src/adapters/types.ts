/**
 * Platform-neutral conversation information consumed at the plugin boundary.
 *
 * The PUBG Domain only receives the stable sessionId. Channel-specific fields
 * stay here so another host or channel can add an adapter without changing the
 * Domain or its query semantics.
 */
export interface PubgConversationContext {
  sessionId: string;
  channel: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
  identityContext: IdentityContext;
}

export interface PubgConversationAdapter<RuntimeContext> {
  readonly id: string;
  adapt(runtimeContext: RuntimeContext, requestedSessionId?: string): PubgConversationContext;
}
import type { IdentityContext } from '@agent/identity';
