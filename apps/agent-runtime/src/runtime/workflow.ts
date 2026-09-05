import { randomUUID } from 'node:crypto';
import { Mastra } from '@mastra/core';
import { RequestContext } from '@mastra/core/request-context';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { DEFAULT_TEAM, type TeamConfig } from '../config/team.js';
import { applyContextResolution, contextForQuery, contextForReview, emptyContext, type ContextStore, sessionIdForMessage as makeSessionId } from '../context/context-store.js';
import type { DataProvider } from '../data/provider.js';
import type { ResultSetRecord } from '../data/model.js';
import { DeterministicQueryEngine, resultSetFromResult } from '../engine/query-engine.js';
import { buildPresentation } from '../renderers/renderers.js';
import { CanonicalQuerySchema } from '../schema/query.js';
import { buildDeterministicQuery } from '../planner/deterministic-planner.js';
import { CoverageSchema } from '../schema/status.js';
import { resolveQuerySelectors } from '../time/selector-resolver.js';
import { MastraPubgPlanner } from '../planner/mastra-planner.js';
import { IdentityRegistry } from '../platform/core/identity.js';
import { normalizeRuntimeMessage } from '../platform/core/legacy.js';
import { renderForPlatform } from '../platform/core/renderer.js';
import { NormalizedBotMessageSchema } from '../platform/core/contracts.js';
import { classifyPubgRequest, type DomainRouteResult } from './router.js';
import type { RuntimeEnvelope, RuntimeRequest, RuntimeResponse, RuntimeTraceEvent } from './types.js';
import { ReviewSubgraph } from '../review/subgraph.js';
import { callbackDataForToken, createSelectionToken, InMemorySelectionStore, tokenFromCallbackData, type SelectionStore } from '../review/selection-store.js';
import { resultSetForMatchCandidates } from '../review/match-selector.js';
import { TelemetryWorker } from '../review/telemetry.js';
import type { MatchPickerButton } from '../review/types.js';

const RuntimeInputSchema = z.object({
  request: z.record(z.string(), z.unknown()),
  sessionId: z.string(),
  context: z.unknown().nullable(),
  plannedQuery: z.unknown().nullable(),
  resolvedQuery: z.unknown().nullable(),
  resultSet: z.unknown().nullable(),
  data: z.unknown().nullable(),
  result: z.unknown().nullable(),
  rendered: z.string().nullable(),
  trace: z.array(z.record(z.string(), z.unknown())),
}).passthrough();

const RuntimeOutputSchema = z.any();

function addTrace(envelope: RuntimeEnvelope, stage: string, details: Record<string, unknown>): void {
  envelope.trace.push({ stage, at: new Date().toISOString(), details });
}

function toRequest(value: Record<string, unknown>): RuntimeRequest {
  const parsedMessage = NormalizedBotMessageSchema.safeParse(value.message);
  const request: RuntimeRequest = {
    text: String(value.text ?? (parsedMessage.success ? parsedMessage.data.message.text : '') ?? ''),
    platform: String(value.platform ?? 'kook'),
    launcherType: String(value.launcherType ?? 'unknown'),
    launcherId: String(value.launcherId ?? 'unknown'),
    senderId: String(value.senderId ?? 'unknown'),
    providedQuery: value.providedQuery,
  };
  if (parsedMessage.success) request.message = parsedMessage.data;
  if (value.botId) request.botId = String(value.botId);
  if (value.messageId) request.messageId = String(value.messageId);
  if (value.replyToMessageId !== undefined) request.replyToMessageId = value.replyToMessageId === null ? null : String(value.replyToMessageId);
  if (value.queryId) request.queryId = String(value.queryId);
  if (value.now) request.now = String(value.now);
  if (value.callbackData || value.callback_data) request.callbackData = String(value.callbackData ?? value.callback_data);
  if (value.callbackId || value.callback_id) request.callbackId = String(value.callbackId ?? value.callback_id);
  return request;
}

function effectiveNow(request: RuntimeRequest): Date {
  if (request.now) {
    const parsed = new Date(request.now);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  if (request.message?.timestamp) {
    const parsed = new Date(request.message.timestamp);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}

export interface PubgRuntimeOptions {
  team?: TeamConfig;
  planner?: MastraPubgPlanner;
  provider: DataProvider;
  contextStore: ContextStore;
  engine?: DeterministicQueryEngine;
  identityRegistry?: IdentityRegistry;
  resultSetTtlMs?: number;
  contextTtlMs?: number;
  telemetryWorker?: TelemetryWorker;
  selectionStore?: SelectionStore;
}

export class PubgMastraRuntime {
  readonly workflow: any;
  readonly mastra;
  private readonly team: TeamConfig;
  private readonly planner: MastraPubgPlanner;
  private readonly provider: DataProvider;
  private readonly contextStore: ContextStore;
  private readonly engine: DeterministicQueryEngine;
  private readonly identityRegistry: IdentityRegistry;
  private readonly resultSetTtlMs: number;
  private readonly contextTtlMs: number;
  private readonly reviewSubgraph: ReviewSubgraph;
  private readonly selectionStore: SelectionStore;

  constructor(options: PubgRuntimeOptions) {
    this.team = options.team ?? DEFAULT_TEAM;
    this.planner = options.planner ?? new MastraPubgPlanner({ team: this.team });
    this.provider = options.provider;
    this.contextStore = options.contextStore;
    this.engine = options.engine ?? new DeterministicQueryEngine({ team: this.team, timezone: process.env.PUBG_TIMEZONE ?? 'Asia/Shanghai', businessDayStart: process.env.PUBG_BUSINESS_DAY_START ?? '06:00' });
    this.identityRegistry = options.identityRegistry ?? new IdentityRegistry();
    this.resultSetTtlMs = options.resultSetTtlMs ?? Number(process.env.PUBG_RESULTSET_TTL_MS ?? 24 * 60 * 60 * 1000);
    this.contextTtlMs = options.contextTtlMs ?? Number(process.env.PUBG_CONTEXT_TTL_MS ?? 12 * 60 * 60 * 1000);
    this.reviewSubgraph = options.telemetryWorker
      ? new ReviewSubgraph({ team: this.team, telemetryWorker: options.telemetryWorker })
      : new ReviewSubgraph({ team: this.team });
    this.selectionStore = options.selectionStore ?? new InMemorySelectionStore();

    const planStep = createStep({
      id: 'domain-router-and-planner',
      inputSchema: RuntimeInputSchema,
      outputSchema: RuntimeOutputSchema,
      execute: async ({ inputData }) => {
        const envelope = inputData as unknown as RuntimeEnvelope;
        const request = toRequest(envelope.request as unknown as Record<string, unknown>);
        envelope.request = request;
        envelope.message = normalizeRuntimeMessage(request);
        envelope.identity = this.identityRegistry.resolve(envelope.message);
        envelope.context = await this.contextStore.getContext(envelope.sessionId);
        const queryId = request.queryId ?? `q_${randomUUID()}`;
        const now = effectiveNow(request);
        const route = classifyPubgRequest(request.text, envelope.context);
        addTrace(envelope, 'domain_router', {
          originalText: request.text,
          domain: route.domain,
          route: route.route,
          reason: route.reason,
          contextActive: route.contextActive,
          sessionId: envelope.sessionId,
          platform: envelope.message.platform,
          chatType: envelope.message.chat.type,
          chatId: envelope.message.chat.id,
          platformUserId: envelope.message.user.platformUserId,
          internalUserId: envelope.identity.internalUserId,
          roles: envelope.identity.roles,
        });
        const plannerInput = {
          text: request.text,
          queryId,
          sessionId: envelope.sessionId,
          now,
          context: {
            activeDomain: envelope.context?.activeDomain ?? null,
            lastSelector: envelope.context?.lastSelector ?? null,
            lastResultSetId: envelope.context?.lastResultSetId ?? null,
            lastQuery: envelope.context?.lastQuery ?? null,
            activeMatchId: envelope.context?.activeMatchId ?? null,
            activeMatchOrdinal: envelope.context?.activeMatchOrdinal ?? null,
            activeReviewResultSetId: envelope.context?.activeReviewResultSetId ?? null,
            sourceMatchResultSetId: envelope.context?.sourceMatchResultSetId ?? null,
            pendingMatchSelection: (envelope.context?.references?.pendingMatchSelection as Record<string, unknown> | undefined) ?? null,
          },
        };
        const deterministicBoundary = buildDeterministicQuery({ ...plannerInput, queryId }, this.team);
        let plan;
        const provided = request.providedQuery === undefined
          ? null
          : CanonicalQuerySchema.safeParse(request.providedQuery);
        if (provided?.success) {
          // A supplied plan is still subject to the explicit review boundary;
          // callers cannot route an ordinary report through Telemetry by
          // setting operation=review_match themselves.
          const bounded = provided.data.operation === 'review_match' || deterministicBoundary.operation === 'review_match'
            ? deterministicBoundary
            : provided.data;
          plan = {
            ...bounded,
            queryId,
            reference: { ...bounded.reference, sessionId: envelope.sessionId, planner: 'provided' as const },
          };
          addTrace(envelope, 'planner_input', { source: 'provided', valid: true });
        } else {
          if (request.providedQuery !== undefined) {
            addTrace(envelope, 'planner_input', { source: 'provided', valid: false, fallback: 'planner' });
          }
          plan = await this.planner.plan(plannerInput);
        }
        const planned = CanonicalQuerySchema.parse({ ...plan, reference: { ...plan.reference, sessionId: envelope.sessionId } });
        envelope.plannedQuery = applyContextResolution(planned, envelope.context);
        addTrace(envelope, 'planner', {
          domain: 'pubg',
          originalText: request.text,
          contextInherited: Boolean(envelope.plannedQuery.reference.inheritedFromContext),
          planner: envelope.plannedQuery.reference.planner,
          operation: envelope.plannedQuery.operation,
          selector: envelope.plannedQuery.selector,
        });
        return envelope;
      },
    });

    const resolveStep = createStep({
      id: 'selector-and-context-resolver',
      inputSchema: RuntimeOutputSchema,
      outputSchema: RuntimeOutputSchema,
      execute: async ({ inputData }) => {
        const envelope = inputData as unknown as RuntimeEnvelope;
        if (!envelope.plannedQuery) throw new Error('planner did not produce a query');
        envelope.resolvedQuery = resolveQuerySelectors(envelope.plannedQuery, { now: effectiveNow(envelope.request), timezone: process.env.PUBG_TIMEZONE ?? 'Asia/Shanghai', businessDayStart: process.env.PUBG_BUSINESS_DAY_START ?? '06:00' });
        const selector = envelope.resolvedQuery.selector;
        if (selector.type === 'result_set') envelope.resultSet = await this.contextStore.getResultSet(envelope.sessionId, selector.resultSetId);
        if (selector.type === 'result_set' && !envelope.resultSet) {
          envelope.data = {
            records: [],
            coverage: CoverageSchema.parse({ status: 'INVALID_QUERY', complete: false, failedMatchIds: [], sourceUnavailable: false, freshness: 'unknown' }),
            source: { store: 'result-set', syncInvoked: false, playerApiCalls: 0, matchApiCalls: 0, localMatchCount: 0 },
            diagnostics: { code: 'RESULT_SET_NOT_FOUND' },
          };
        }
        addTrace(envelope, 'selector_resolver', {
          resolvedSelector: envelope.resolvedQuery.selector,
          resultSetId: envelope.resultSet?.id ?? null,
        });
        return envelope;
      },
    });

    const dataStep = createStep({
      id: 'ensure-pubg-data',
      inputSchema: RuntimeOutputSchema,
      outputSchema: RuntimeOutputSchema,
      execute: async ({ inputData }) => {
        const envelope = inputData as unknown as RuntimeEnvelope;
        if (!envelope.resolvedQuery) throw new Error('selector resolver did not produce a query');
        if (!envelope.data && envelope.resultSet && envelope.resultSet.matchIds.length === 0) {
          envelope.data = {
            records: [],
            coverage: envelope.resultSet.coverage,
            source: { ...envelope.resultSet.source, store: 'result-set', syncInvoked: false },
            diagnostics: { resultSetId: envelope.resultSet.id, empty: true },
          };
        }
        if (!envelope.data) {
          const subjectIds = envelope.resolvedQuery.subject.type === 'team' ? this.team.players.map((player) => player.id) : envelope.resolvedQuery.subject.ids;
          const dataRequest = {
            queryId: envelope.resolvedQuery.queryId,
            sessionId: envelope.sessionId,
            subjectIds,
            now: effectiveNow(envelope.request).toISOString(),
            ...(envelope.resultSet ? { resultSetMatchIds: envelope.resultSet.matchIds } : {}),
          };
          const dataQuery = envelope.resultSet
            ? { ...envelope.resolvedQuery, reference: { ...envelope.resolvedQuery.reference, matchIds: envelope.resultSet.matchIds } }
            : envelope.resolvedQuery;
          envelope.data = await this.provider.ensureData(dataQuery, dataRequest);
        }
        addTrace(envelope, 'ensure_data', {
          syncInvoked: envelope.data.source.syncInvoked,
          playerApiCalls: envelope.data.source.playerApiCalls,
          matchApiCalls: envelope.data.source.matchApiCalls,
          localMatchCount: envelope.data.records.length,
          coverage: envelope.data.coverage,
          queryId: envelope.resolvedQuery.queryId,
          sessionId: envelope.sessionId,
        });
        return envelope;
      },
    });

    const executeStep = createStep({
      id: 'deterministic-query-engine',
      inputSchema: RuntimeOutputSchema,
      outputSchema: RuntimeOutputSchema,
      execute: async ({ inputData }) => {
        const envelope = inputData as unknown as RuntimeEnvelope;
        if (!envelope.resolvedQuery || !envelope.data) throw new Error('query/data not ready');
        if (envelope.resolvedQuery.operation === 'review_match') {
          const pendingSelection = envelope.context?.references?.pendingMatchSelection as Record<string, unknown> | undefined;
          const pendingResultSetId = typeof pendingSelection?.resultSetId === 'string'
            ? pendingSelection.resultSetId
            : null;
          const reviewQuery = envelope.resultSet
            ? {
                ...envelope.resolvedQuery,
                reference: { ...envelope.resolvedQuery.reference, matchIds: envelope.resultSet.matchIds },
              }
            : envelope.resolvedQuery;
          envelope.reviewExecution = await this.reviewSubgraph.execute({
            query: reviewQuery,
            data: envelope.data,
            sessionId: envelope.sessionId,
            context: envelope.context,
            now: effectiveNow(envelope.request),
            sourceMatchResultSetId: envelope.context?.sourceMatchResultSetId
              ?? pendingResultSetId,
          });
          envelope.result = envelope.reviewExecution.result;
          addTrace(envelope, 'operation_router', { operation: 'review_match', target: 'ReviewSubgraph', telemetryDeferredUntilUniqueMatch: true });
          const reviewResult = envelope.result;
          addTrace(envelope, 'review_subgraph', {
            status: reviewResult.status,
            candidateCount: envelope.reviewExecution.candidates.length,
            selectedMatchId: envelope.reviewExecution.selected?.match.matchId ?? null,
            telemetryRequested: reviewResult.diagnostics.telemetryRequested ?? false,
            diagnostics: reviewResult.diagnostics,
          });
          return envelope;
        }
        const query = envelope.resultSet
          ? { ...envelope.resolvedQuery, reference: { ...envelope.resolvedQuery.reference, matchIds: envelope.resultSet.matchIds } }
          : envelope.resolvedQuery;
        envelope.result = this.engine.execute(
          query,
          envelope.data.records,
          envelope.data.coverage,
          envelope.data.source,
          envelope.resultSet ? { resultSetMatchIds: envelope.resultSet.matchIds } : {},
        );
        addTrace(envelope, 'query_engine', {
          status: envelope.result.status,
          selectedMatchCount: envelope.result.evidence.matchIds.length,
          calculation: envelope.result.evidence.calculation,
        });
        return envelope;
      },
    });

    const renderStep = createStep({
      id: 'resultset-and-renderer',
      inputSchema: RuntimeOutputSchema,
      outputSchema: RuntimeOutputSchema,
      execute: async ({ inputData }) => {
        const envelope = inputData as unknown as RuntimeEnvelope;
        if (!envelope.result || !envelope.plannedQuery || !envelope.resolvedQuery) throw new Error('result not ready');
        if (envelope.result.status === 'MATCH_SELECTION_REQUIRED' && envelope.reviewExecution) {
          const candidateResultSet = resultSetForMatchCandidates(
            envelope.resolvedQuery,
            envelope.sessionId,
            envelope.reviewExecution.candidates,
            envelope.result.coverage,
            envelope.result.source,
            this.resultSetTtlMs,
          );
          await this.contextStore.setResultSet(candidateResultSet);
          const buttons: MatchPickerButton[] = [];
          for (const candidate of envelope.reviewExecution.candidates) {
            const token = createSelectionToken();
            const record = {
              token,
              platform: envelope.message.platform,
              chatId: envelope.message.chat.id,
              sessionId: envelope.sessionId,
              matchId: candidate.match.matchId,
              resultSetId: candidateResultSet.id,
              ordinal: candidate.ordinal,
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + this.resultSetTtlMs).toISOString(),
              query: envelope.resolvedQuery,
            };
            await this.selectionStore.set(record);
            const marker = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'][candidate.ordinal - 1] ?? String(candidate.ordinal);
            buttons.push({
              text: `${marker} ${candidate.match.mapName}${candidate.row.bestRank === 1 ? '🍗' : ''}`,
              callbackData: callbackDataForToken(token),
              ordinal: candidate.ordinal,
            });
          }
          envelope.resultSet = candidateResultSet;
          envelope.result.resultSetId = candidateResultSet.id;
          envelope.result.matchPicker = {
            selectorLabel: envelope.resolvedQuery.selector.label ?? '指定范围',
            candidateCount: envelope.reviewExecution.candidates.length,
            candidates: envelope.reviewExecution.candidates,
            buttons,
          };
          await this.contextStore.setContext(contextForReview(
            envelope.plannedQuery,
            candidateResultSet.id,
            envelope.sessionId,
            this.contextTtlMs,
            {
              sourceSelector: envelope.resolvedQuery.selector,
              pendingMatchSelection: {
                resultSetId: candidateResultSet.id,
                candidateCount: envelope.reviewExecution.candidates.length,
                expiresAt: candidateResultSet.expiresAt,
                sourceSelector: envelope.resolvedQuery.selector,
              },
            },
          ));
        } else if (envelope.result.review) {
          envelope.resultSet = resultSetFromResult(envelope.result, envelope.resolvedQuery, envelope.sessionId, this.resultSetTtlMs);
          envelope.result.resultSetId = envelope.resultSet.id;
          envelope.result.review.activeReviewResultSetId = envelope.resultSet.id;
          await this.contextStore.setResultSet(envelope.resultSet);
          await this.contextStore.setContext(contextForReview(
            envelope.plannedQuery,
            envelope.resultSet.id,
            envelope.sessionId,
            this.contextTtlMs,
            {
              sourceSelector: envelope.plannedQuery.reference.selectorExplicit
                ? ((envelope.context?.references?.pendingMatchSelection as Record<string, unknown> | undefined)?.sourceSelector as typeof envelope.resolvedQuery.selector | undefined)
                  ?? envelope.resolvedQuery.selector
                : envelope.context?.lastSelector ?? envelope.resolvedQuery.selector,
              activeMatchId: envelope.result.review.match.matchId,
              activeMatchOrdinal: envelope.result.review.match.ordinal,
              activeReviewResultSetId: envelope.resultSet.id,
              sourceMatchResultSetId: envelope.result.review.sourceMatchResultSetId ?? envelope.context?.sourceMatchResultSetId ?? null,
            },
          ));
        } else if (envelope.result.status !== 'INVALID_QUERY' && envelope.result.status !== 'UNKNOWN_PLAYER' && envelope.result.status !== 'UNSUPPORTED_CAPABILITY') {
          envelope.resultSet = resultSetFromResult(envelope.result, envelope.resolvedQuery, envelope.sessionId, this.resultSetTtlMs);
          envelope.result.resultSetId = envelope.resultSet.id;
          await this.contextStore.setResultSet(envelope.resultSet);
          const nextContext = contextForQuery(envelope.plannedQuery, envelope.resultSet.id, envelope.sessionId, this.contextTtlMs);
          if (envelope.context?.activeMatchId) {
            nextContext.activeMatchId = envelope.context.activeMatchId;
            nextContext.activeMatchOrdinal = envelope.context.activeMatchOrdinal ?? null;
            nextContext.activeReviewResultSetId = envelope.context.activeReviewResultSetId ?? null;
            nextContext.sourceMatchResultSetId = envelope.context.sourceMatchResultSetId ?? null;
          }
          await this.contextStore.setContext(nextContext);
        }
        envelope.presentation = buildPresentation(envelope.result, envelope.resolvedQuery);
        envelope.botResponse = renderForPlatform(envelope.presentation, envelope.message);
        envelope.rendered = envelope.botResponse.messages
          .filter((message) => message.type === 'text' && typeof message.text === 'string')
          .map((message) => message.text as string)
          .join('\n\n');
        addTrace(envelope, 'renderer', {
          renderer: envelope.resolvedQuery.presentation.renderer ?? `${envelope.resolvedQuery.operation}_renderer`,
          platform: envelope.message.platform,
          messageCount: envelope.botResponse.messages.length,
          resultSetId: envelope.resultSet?.id ?? null,
        });
        return envelope;
      },
    });

    this.workflow = createWorkflow({
      id: 'pubg-query-runtime-v3',
      description: 'Mastra runtime for PUBG planning, context, data freshness, deterministic query and rendering',
      inputSchema: RuntimeInputSchema,
      outputSchema: RuntimeOutputSchema,
      steps: [planStep, resolveStep, dataStep, executeStep, renderStep],
    }).then(planStep).then(resolveStep).then(dataStep).then(executeStep).then(renderStep).commit();
    this.mastra = new Mastra({
      workflows: { pubgQueryRuntime: this.workflow },
    });
  }

  async handle(request: RuntimeRequest): Promise<RuntimeResponse> {
    const normalizedMessage = normalizeRuntimeMessage(request);
    if (request.callbackData || normalizedMessage.callback?.data) return this.handleCallback(request, normalizedMessage);
    const currentSessionId = makeSessionId(normalizedMessage, 'pubg');
    const initialIdentity = this.identityRegistry.resolve(normalizedMessage);
    const envelope: RuntimeEnvelope = {
      request: { ...request, text: normalizedMessage.message.text, message: normalizedMessage },
      sessionId: currentSessionId,
      context: null,
      plannedQuery: null,
      resolvedQuery: null,
      resultSet: null,
      data: null,
      result: null,
      rendered: null,
      message: normalizedMessage,
      identity: initialIdentity,
      presentation: null,
      botResponse: null,
      trace: [],
    };
    const requestContext = new RequestContext();
    requestContext.setRaw('sessionId', currentSessionId);
    requestContext.setRaw('platform', normalizedMessage.platform);
    requestContext.setRaw('chatType', normalizedMessage.chat.type);
    requestContext.setRaw('chatId', normalizedMessage.chat.id);
    requestContext.setRaw('platformUserId', normalizedMessage.user.platformUserId);
    requestContext.setRaw('internalUserId', initialIdentity.internalUserId);
    const workflowRun = await this.workflow.createRun({ runId: `run_${request.queryId ?? randomUUID()}` });
    const run = await workflowRun.start({ inputData: envelope, requestContext });
    if (run.status !== 'success' || !run.result) {
      return {
        response: '⚠️ PUBG Query Runtime 执行失败。',
        messages: [{ type: 'text', text: '⚠️ PUBG Query Runtime 执行失败。' }],
        normalizedMessage,
        identity: normalizedMessage.user,
        presentation: null,
        query: envelope.plannedQuery,
        resolvedQuery: envelope.resolvedQuery,
        status: 'INVALID_QUERY',
        resultSetId: null,
        coverage: null,
        source: null,
        data: null,
        evidence: null,
        trace: envelope.trace,
      };
    }
    const result = run.result as RuntimeEnvelope;
    return {
      response: result.rendered ?? '⚠️ PUBG Query Runtime 没有生成回复。',
      messages: result.botResponse?.messages ?? [{ type: 'text', text: result.rendered ?? '⚠️ PUBG Query Runtime 没有生成回复。' }],
      normalizedMessage: result.message,
      identity: result.identity?.platformIdentity ?? result.message.user,
      presentation: result.presentation,
      query: result.plannedQuery,
      resolvedQuery: result.resolvedQuery,
      status: result.result?.status ?? 'INVALID_QUERY',
      resultSetId: result.resultSet?.id ?? null,
      coverage: result.result?.coverage ?? null,
      source: result.result?.source ?? null,
      data: result.result?.data ?? null,
      evidence: result.result?.evidence ?? null,
      trace: result.trace,
    };
  }

  private async handleCallback(request: RuntimeRequest, normalizedMessage: RuntimeEnvelope['message']): Promise<RuntimeResponse> {
    const trace: RuntimeTraceEvent[] = [];
    const callbackData = request.callbackData ?? normalizedMessage.callback?.data ?? '';
    const token = tokenFromCallbackData(callbackData);
    const identity = this.identityRegistry.resolve(normalizedMessage);
    const invalidResponse = (text: string): RuntimeResponse => ({
      response: text,
      messages: [{ type: 'text', text }],
      normalizedMessage,
      identity: identity.platformIdentity,
      presentation: null,
      query: null,
      resolvedQuery: null,
      status: 'INVALID_QUERY',
      resultSetId: null,
      coverage: null,
      source: null,
      data: null,
      evidence: null,
      callbackAnswer: { text, showAlert: true },
      trace,
    });
    if (!token) return invalidResponse('⚠️ 这个复盘选择无效或已失效。');
    const now = effectiveNow(request);
    const selection = await this.selectionStore.resolve(token, { platform: normalizedMessage.platform, chatId: normalizedMessage.chat.id, now });
    addTrace({ trace } as RuntimeEnvelope, 'callback_selection', { token, valid: Boolean(selection), platform: normalizedMessage.platform, chatId: normalizedMessage.chat.id });
    if (!selection) return invalidResponse('⚠️ 这个复盘选择无效、已过期，或不属于当前群聊。');

    const sessionId = makeSessionId(normalizedMessage, 'pubg');
    const callbackQuery = CanonicalQuerySchema.parse({
      ...selection.query,
      queryId: request.queryId ?? `callback_${randomUUID()}`,
      selector: { type: 'result_set', resultSetId: selection.resultSetId, label: `第${selection.ordinal}场` },
      matchSelector: { type: 'active_match' },
      reference: {
        ...selection.query.reference,
        sessionId,
        selectorExplicit: true,
        useResultSet: false,
        inheritedFromContext: false,
        matchIds: [selection.matchId],
        planner: 'provided',
      },
    });
    const subjectIds = callbackQuery.subject.type === 'team' ? this.team.players.map((player) => player.id) : callbackQuery.subject.ids;
    const data = await this.provider.ensureData(callbackQuery, {
      queryId: callbackQuery.queryId,
      sessionId,
      subjectIds,
      resultSetMatchIds: [selection.matchId],
      now: now.toISOString(),
    });
    const previousContext = await this.contextStore.getContext(sessionId);
    const execution = await this.reviewSubgraph.execute({
      query: callbackQuery,
      data,
      sessionId,
      context: { ...(previousContext ?? emptyContext(sessionId)), activeMatchId: selection.matchId },
      now,
      sourceMatchResultSetId: selection.resultSetId,
      selection,
    });
    const result = execution.result;
    let resultSet: ResultSetRecord | null = null;
    if (result.review) {
      resultSet = resultSetFromResult(result, callbackQuery, sessionId, this.resultSetTtlMs);
      result.resultSetId = resultSet.id;
      result.review.activeReviewResultSetId = resultSet.id;
      await this.contextStore.setResultSet(resultSet);
      await this.contextStore.setContext(contextForReview(callbackQuery, resultSet.id, sessionId, this.contextTtlMs, {
        sourceSelector: selection.query.selector,
        activeMatchId: result.review.match.matchId,
        activeMatchOrdinal: result.review.match.ordinal,
        activeReviewResultSetId: resultSet.id,
        sourceMatchResultSetId: selection.resultSetId,
      }));
    }
    const presentation = buildPresentation(result, callbackQuery);
    const botResponse = renderForPlatform(presentation, normalizedMessage);
    const rendered = botResponse.messages.filter((item) => item.type === 'text' && typeof item.text === 'string').map((item) => item.text as string).join('\n\n');
    trace.push({ stage: 'review_callback_resume', at: new Date().toISOString(), details: { matchId: selection.matchId, ordinal: selection.ordinal, telemetryOnlyAfterResolution: true } });
    return {
      response: rendered,
      messages: botResponse.messages,
      normalizedMessage,
      identity: identity.platformIdentity,
      presentation,
      query: callbackQuery,
      resolvedQuery: callbackQuery,
      status: result.status,
      resultSetId: resultSet?.id ?? null,
      coverage: result.coverage,
      source: result.source,
      data: result.data,
      evidence: result.evidence,
      callbackAnswer: { text: `已选择第${selection.ordinal}场` },
      trace,
    };
  }

  async route(request: RuntimeRequest): Promise<DomainRouteResult & { sessionId: string }> {
    const normalizedMessage = normalizeRuntimeMessage(request);
    const currentSessionId = makeSessionId(normalizedMessage, 'pubg');
    const context = await this.contextStore.getContext(currentSessionId);
    return { ...classifyPubgRequest(request.text, context), sessionId: currentSessionId };
  }
}
