import type { CanonicalQuery } from '../schema/query.js';
import type { DataLayerResult, ResultSetRecord, SessionContextRecord, StructuredResult } from '../data/model.js';
import type { BotResponse, NormalizedBotMessage, PlatformIdentity, PresentationModel } from '../platform/core/contracts.js';
import type { ResolvedIdentity } from '../platform/core/identity.js';
import type { ReviewExecution } from '../review/types.js';
import type { WhoAmIInfo } from '../platform/core/whoami.js';

export interface RuntimeRequest {
  text: string;
  message?: NormalizedBotMessage;
  botId?: string;
  messageId?: string;
  replyToMessageId?: string | null;
  platform?: string;
  launcherType?: string;
  launcherId?: string;
  senderId?: string;
  queryId?: string;
  now?: string;
  providedQuery?: unknown;
  callbackData?: string;
  callbackId?: string;
}

export interface RuntimeTraceEvent {
  stage: string;
  at: string;
  details: Record<string, unknown>;
}

export interface RuntimeEnvelope {
  request: RuntimeRequest;
  sessionId: string;
  context: SessionContextRecord | null;
  plannedQuery: CanonicalQuery | null;
  resolvedQuery: CanonicalQuery | null;
  resultSet: ResultSetRecord | null;
  data: DataLayerResult | null;
  result: StructuredResult | null;
  rendered: string | null;
  message: NormalizedBotMessage;
  identity: ResolvedIdentity | null;
  presentation: PresentationModel | null;
  botResponse: BotResponse | null;
  reviewExecution?: ReviewExecution | null;
  trace: RuntimeTraceEvent[];
}

export interface RuntimeResponse {
  response: string;
  messages: BotResponse['messages'];
  normalizedMessage: NormalizedBotMessage;
  identity: PlatformIdentity;
  presentation: PresentationModel | null;
  query: CanonicalQuery | null;
  resolvedQuery: CanonicalQuery | null;
  status: StructuredResult['status'] | 'INVALID_QUERY';
  resultSetId: string | null;
  coverage: StructuredResult['coverage'] | null;
  source: StructuredResult['source'] | null;
  data: StructuredResult['data'] | null;
  evidence: StructuredResult['evidence'] | null;
  callbackAnswer?: { text: string; showAlert?: boolean } | null;
  trace: RuntimeTraceEvent[];
}

export interface WhoAmIRuntimeResponse {
  queryId: string;
  domain: 'homehub';
  status: 'success';
  response: string;
  messages: BotResponse['messages'];
  normalizedMessage: NormalizedBotMessage;
  identity: PlatformIdentity;
  presentation: PresentationModel;
  data: WhoAmIInfo;
  trace: RuntimeTraceEvent[];
}
