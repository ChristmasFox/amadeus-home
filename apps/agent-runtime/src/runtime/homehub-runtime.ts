import { randomUUID } from 'node:crypto';
import { DiagnosticEngine, ActionEngine, ContextManager, AuditLogger } from '@agent/homehub-domain';
import { HomeHubEntry, type HomeHubResponse } from '../homehub/entry/homehub-entry.js';
import { MediaOperations } from '../homehub/operations/media-operations.js';
import type { RuntimeRequest, RuntimeTraceEvent } from './types.js';

export interface HomeHubRuntimeResponse {
  queryId: string;
  domain: 'homehub';
  status: 'success' | 'error';
  response: string;
  responseType: 'status' | 'diagnosis' | 'action' | 'error';
  requiresConfirmation?: boolean;
  nextActions?: Array<{ label: string; action: string; params: Record<string, unknown> }>;
  data?: Record<string, unknown>;
  trace: RuntimeTraceEvent[];
  timestamp: string;
  processingTimeMs: number;
}

export interface HomeHubRuntimeOptions {
  orbHost?: string;
  orbUser?: string;
  casaosAppsPath?: string;
  auditLogPath?: string;
  contextPath?: string;
}

export class HomeHubRuntime {
  private readonly contextManager: ContextManager;
  private readonly diagnosticEngine: DiagnosticEngine;
  private readonly actionEngine: ActionEngine;
  private readonly auditLogger: AuditLogger;
  private readonly mediaOperations: MediaOperations;
  private readonly homeHubEntry: HomeHubEntry;

  constructor(options: HomeHubRuntimeOptions = {}) {
    // Initialize HomeHub components
    this.contextManager = new ContextManager({
      persistPath: options.contextPath ?? '/DATA/AppData/homehub/contexts',
      sessionTtl: 30 * 60 * 1000, // 30 minutes
    });

    this.diagnosticEngine = new DiagnosticEngine({
      orbHost: options.orbHost ?? 'ubuntu',
      orbUser: options.orbUser ?? 'root',
      casaosAppsPath: options.casaosAppsPath ?? '/var/lib/casaos/apps',
    });

    this.actionEngine = new ActionEngine({
      orbHost: options.orbHost ?? 'ubuntu',
      orbUser: options.orbUser ?? 'root',
      casaosAppsPath: options.casaosAppsPath ?? '/var/lib/casaos/apps',
      autoVerify: true,
    });

    this.auditLogger = new AuditLogger({
      logPath: options.auditLogPath ?? '/DATA/AppData/homehub/audit',
      maxFileSize: 10 * 1024 * 1024, // 10MB
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
    });
  }

  /**
   * Handle HomeHub request
   */
  async handle(request: RuntimeRequest): Promise<HomeHubRuntimeResponse> {
    const queryId = request.queryId ?? `hh_${randomUUID()}`;
    const startTime = Date.now();

    try {
      const text = request.text ?? '';
      const platform = request.platform ?? 'kook';
      const userId = request.senderId ?? 'unknown';

      // Handle the request via the HomeHub entry
      const response = await this.homeHubEntry.handleRequest(
        text,
        platform,
        userId,
        userId
      );

      const runtimeResponse: HomeHubRuntimeResponse = {
        queryId,
        domain: 'homehub',
        status: response.success ? 'success' : 'error',
        response: response.message,
        responseType: response.responseType,
        ...(response.requiresConfirmation !== undefined ? { requiresConfirmation: response.requiresConfirmation } : {}),
        ...(response.nextActions ? { nextActions: response.nextActions } : {}),
        ...(response.data ? { data: response.data as Record<string, unknown> } : {}),
        trace: [{
          stage: 'homehub_processing',
          at: new Date().toISOString(),
          details: {
            text,
            platform,
            responseType: response.responseType,
            success: response.success,
          },
        }],
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      };
      return runtimeResponse;
    } catch (error) {
      return {
        queryId,
        domain: 'homehub',
        status: 'error',
        response: `HomeHub 处理失败: ${error instanceof Error ? error.message : '未知错误'}`,
        responseType: 'error',
        data: { error: error instanceof Error ? error.message : String(error) },
        trace: [{
          stage: 'homehub_error',
          at: new Date().toISOString(),
          details: {
            error: error instanceof Error ? error.message : String(error),
            text: request.text,
          },
        }],
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Route classification for HomeHub signals
   */
  classify(text: string): boolean {
    const normalized = String(text ?? '').trim();
    // Public gateway helper: mirrors the runtime router's HomeHub signal rules
    const signal = /(?:服务器|主机|系统状态|服务状态|哪些服务|挂了|状态|服务|重启|启动|停止|诊断|日志|操作记录|整理|刮削|telegram|tg|kook|langbot|n8n|emby|jellyfin|postgres|redis|qbittorrent|aria2|glances|cloudflared|pubg.*服务|恢复正常)/i;
    return signal.test(normalized);
  }

  /**
   * Health check for HomeHub runtime
   */
  healthCheck(): { status: 'healthy' | 'degraded'; components: Record<string, string> } {
    const components: Record<string, string> = {
      contextManager: 'healthy',
      diagnosticEngine: 'healthy',
      actionEngine: 'healthy',
      auditLogger: 'healthy',
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

  /**
   * Cleanup expired sessions
   */
  async cleanup(): Promise<number> {
    return this.contextManager.cleanupExpiredSessions();
  }

  /**
   * Get audit logs for a user
   */
  async getAuditLogs(userId: string, limit: number = 20) {
    return this.auditLogger.getUserAuditLogs(userId, limit);
  }

  /**
   * Get active sessions count
   */
  getActiveSessionsCount(): number {
    return this.contextManager.getSessionCount();
  }
}
