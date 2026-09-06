import { randomUUID } from 'node:crypto';
import {
  AuthorizationCore,
  AuditLogger,
  ActionEngine,
  ContextManager,
  DiagnosticEngine,
  RuntimeExecutorManager,
  ServiceIdSchema,
} from '@agent/homehub-domain';
import { HomeHubEntry, type HomeHubResponse } from '../homehub/entry/homehub-entry.js';
import { MediaOperations } from '../homehub/operations/media-operations.js';
import { identityMappingsFromEnvironment } from '../config/identity.js';
import { IdentityRegistry } from '../platform/core/identity.js';
import { normalizeRuntimeMessage } from '../platform/core/legacy.js';
import { renderForPlatform } from '../platform/core/renderer.js';
import { PresentationModelSchema, type BotResponse, type NormalizedBotMessage, type PresentationModel } from '../platform/core/contracts.js';
import { parseHomeHubCallback, homeHubCallbackData } from '../homehub/confirmation.js';
import type { RuntimeRequest, RuntimeTraceEvent } from './types.js';

export interface HomeHubRuntimeResponse {
  queryId: string;
  domain: 'homehub';
  status: 'success' | 'error';
  response: string;
  responseType: 'status' | 'diagnosis' | 'action' | 'error';
  requiresConfirmation?: boolean;
  pendingActionId?: string;
  messages: BotResponse['messages'];
  callbackAnswer?: { text: string; showAlert?: boolean } | null;
  nextActions?: Array<{ label: string; action: string; params: Record<string, unknown> }>;
  data?: Record<string, unknown>;
  trace: RuntimeTraceEvent[];
  timestamp: string;
  processingTimeMs: number;
}

export interface HomeHubRuntimeOptions {
  /** Deprecated compatibility fields; no host hop is performed. */
  orbHost?: string;
  orbUser?: string;
  casaosAppsPath?: string;
  auditLogPath?: string;
  contextPath?: string;
  identityRegistry?: IdentityRegistry;
  execution?: RuntimeExecutorManager;
  executorManager?: RuntimeExecutorManager;
}

export class HomeHubRuntime {
  private readonly contextManager: ContextManager;
  private readonly diagnosticEngine: DiagnosticEngine;
  private readonly actionEngine: ActionEngine;
  private readonly auditLogger: AuditLogger;
  private readonly mediaOperations: MediaOperations;
  private readonly homeHubEntry: HomeHubEntry;
  private readonly identityRegistry: IdentityRegistry;

  constructor(options: HomeHubRuntimeOptions = {}) {
    this.identityRegistry = options.identityRegistry ?? new IdentityRegistry(identityMappingsFromEnvironment());
    const execution = options.executorManager ?? options.execution ?? new RuntimeExecutorManager();
    const authorizationCore: AuthorizationCore = this.identityRegistry.authorizationCore;

    this.contextManager = new ContextManager({
      persistPath: options.contextPath ?? '/DATA/AppData/homehub/contexts',
      sessionTtl: 30 * 60 * 1000,
    });
    this.diagnosticEngine = new DiagnosticEngine({
      execution,
      casaosAppsPath: options.casaosAppsPath ?? '/var/lib/casaos/apps',
    });
    this.actionEngine = new ActionEngine({
      execution,
      casaosAppsPath: options.casaosAppsPath ?? '/var/lib/casaos/apps',
      autoVerify: true,
      authorizationCore,
    });
    this.auditLogger = new AuditLogger({
      logPath: options.auditLogPath ?? '/DATA/AppData/homehub/audit',
      maxFileSize: 10 * 1024 * 1024,
      maxFiles: 10,
    });
    this.mediaOperations = new MediaOperations({
      downloadsPaths: ['/Volumes/Avalon/downloads/complete', '/Volumes/Avalon/downloads'],
      libraryPaths: {
        movies: '/Volumes/Avalon/media/movies',
        tv: '/Volumes/Avalon/media/tv',
      },
      backupPath: '/Volumes/Avalon/backups/media-organizer',
    });
    this.homeHubEntry = new HomeHubEntry({
      contextManager: this.contextManager,
      diagnosticEngine: this.diagnosticEngine,
      actionEngine: this.actionEngine,
      auditLogger: this.auditLogger,
      mediaOperations: this.mediaOperations,
      authorizationCore,
    });
  }

  async handle(request: RuntimeRequest): Promise<HomeHubRuntimeResponse> {
    const queryId = request.queryId ?? `hh_${randomUUID()}`;
    const startTime = Date.now();
    try {
      const message = normalizeRuntimeMessage(request);
      const identity = this.identityRegistry.resolve(message);
      const text = message.message.text || request.text || '';
      const callback = parseHomeHubCallback(message.callback?.data ?? request.callbackData);
      const response = callback
        ? await this.homeHubEntry.handleCallback(
            callback.action,
            callback.actionId,
            message.platform,
            message.user.platformUserId,
            message.chat.id,
            identity,
          )
        : await this.homeHubEntry.handleRequest(
            text,
            message.platform,
            message.user.platformUserId,
            message.chat.id,
            {
              identity,
              platformUserId: message.user.platformUserId,
              chatId: message.chat.id,
              messageId: message.message.id,
            },
          );
      const botResponse = this.renderResponse(response, message);
      return this.runtimeResponse(queryId, startTime, response, botResponse, {
        text,
        platform: message.platform,
        chatId: message.chat.id,
        platformUserId: message.user.platformUserId,
        internalUserId: identity.internalUserId,
        role: identity.role,
        callbackAction: callback?.action ?? null,
        callbackActionId: callback?.actionId ?? null,
        responseType: response.responseType,
        success: response.success,
      });
    } catch (error) {
      return {
        queryId,
        domain: 'homehub',
        status: 'error',
        response: `HomeHub 处理失败: ${error instanceof Error ? error.message : '未知错误'}`,
        responseType: 'error',
        messages: [],
        callbackAnswer: null,
        data: { error: error instanceof Error ? error.message : String(error) },
        trace: [{
          stage: 'homehub_error',
          at: new Date().toISOString(),
          details: { error: error instanceof Error ? error.message : String(error), text: request.text },
        }],
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  private runtimeResponse(
    queryId: string,
    startTime: number,
    response: HomeHubResponse,
    botResponse: BotResponse,
    traceDetails: Record<string, unknown>,
  ): HomeHubRuntimeResponse {
    return {
      queryId,
      domain: 'homehub',
      status: response.success ? 'success' : 'error',
      response: response.message,
      responseType: response.responseType,
      messages: botResponse.messages,
      callbackAnswer: null,
      ...(response.requiresConfirmation !== undefined ? { requiresConfirmation: response.requiresConfirmation } : {}),
      ...(response.pendingActionId ? { pendingActionId: response.pendingActionId } : {}),
      ...(response.nextActions ? { nextActions: response.nextActions } : {}),
      ...(response.data ? { data: response.data as Record<string, unknown> } : {}),
      trace: [{ stage: 'homehub_processing', at: new Date().toISOString(), details: traceDetails }],
      timestamp: new Date().toISOString(),
      processingTimeMs: Date.now() - startTime,
    };
  }

  private renderResponse(response: HomeHubResponse, message: NormalizedBotMessage): BotResponse {
    const inlineKeyboard = response.pendingActionId
      ? [
          { text: '✅ 确认', callbackData: homeHubCallbackData('confirm', response.pendingActionId) },
          { text: '❌ 取消', callbackData: homeHubCallbackData('cancel', response.pendingActionId) },
        ]
      : [];
    const presentation: PresentationModel = PresentationModelSchema.parse({
      version: 1,
      type: `homehub_${response.responseType}`,
      title: 'HomeHub',
      sections: [{ type: 'text', text: response.message }],
      fallbackText: response.message,
      metadata: {
        ...(inlineKeyboard.length ? { inlineKeyboard } : {}),
        responseType: response.responseType,
        requiresConfirmation: response.requiresConfirmation ?? false,
      },
    });
    return renderForPlatform(presentation, message);
  }

  /** Return the live HomeHub service inventory for an internal status probe. */
  async status() {
    return this.diagnosticEngine.systemHealth();
  }

  /**
   * Read-only authorization decision endpoint used by platform plugins. It
   * resolves identity from the normalized platform user ID before evaluating
   * the shared policy; it never executes an action.
   */
  authorize(
    request: RuntimeRequest,
    serviceIdValue: string,
    action: string,
    confirmed = false,
  ): Record<string, unknown> {
    const message = normalizeRuntimeMessage(request);
    const identity = this.identityRegistry.resolve(message);
    const serviceId = ServiceIdSchema.safeParse(serviceIdValue);
    const service = serviceId.success ? this.actionEngine.getService(serviceId.data) : undefined;
    const decision = service
      ? this.identityRegistry.authorizationCore.authorize({ identity, action, service, confirmed })
      : {
          authorized: false,
          requiresConfirmation: false,
          role: identity.role,
          action,
          reason: 'Service not found in registry',
        };
    return {
      ...decision,
      platform: message.platform,
      platformUserId: message.user.platformUserId,
      chatId: message.chat.id,
      internalUser: identity.internalUserId ?? 'unbound',
    };
  }

  classify(text: string): boolean {
    const normalized = String(text ?? '').trim();
    const signal = /(?:服务器|主机|系统状态|服务状态|哪些服务|挂了|状态|服务|重启|启动|停止|诊断|日志|操作记录|整理|刮削|telegram|tg|kook|langbot|n8n|emby|jellyfin|postgres|redis|qbittorrent|aria2|glances|cloudflared|pubg.*服务|恢复正常)/i;
    const confirmation = /^(?:确认|确认执行|执行|是|是的|好|行|重启它|取消|算了|不用|不了|no)$/iu.test(normalized);
    return signal.test(normalized) || confirmation;
  }

  healthCheck(): { status: 'healthy' | 'degraded'; components: Record<string, string> } {
    const components: Record<string, string> = {
      contextManager: 'healthy',
      diagnosticEngine: 'healthy',
      actionEngine: 'healthy',
      auditLogger: 'healthy',
      authorizationCore: 'healthy',
      executor: 'configured',
    };
    let status: 'healthy' | 'degraded' = 'healthy';
    try {
      this.contextManager.getActiveSessions();
    } catch {
      components.contextManager = 'unhealthy';
      status = 'degraded';
    }
    return { status, components };
  }

  async cleanup(): Promise<number> {
    return this.contextManager.cleanupExpiredSessions();
  }

  async getAuditLogs(userId: string, limit: number = 20) {
    return this.auditLogger.getUserAuditLogs(userId, limit);
  }

  getActiveSessionsCount(): number {
    return this.contextManager.getSessionCount();
  }

  /** Stop background audit flushing when an embedding process is shutting down. */
  stop(): void {
    this.auditLogger.stop();
  }
}
