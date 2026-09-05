import type { HomeHubQuery, HealthResult, DiagnosisResult, ActionResult, ServiceId, ActionRequest, Action } from '@agent/homehub-domain';
import { HomeHubDomain, DiagnosticEngine, ActionEngine, ContextManager, AuditLogger } from '@agent/homehub-domain';
import { MediaOperations, type MediaItem, type MediaOperationPlan } from '../operations/media-operations.js';

type MediaPreview = Awaited<ReturnType<MediaOperations['previewPlan']>>;

export interface HomeHubEntryOptions {
  contextManager: ContextManager;
  diagnosticEngine: DiagnosticEngine;
  actionEngine: ActionEngine;
  auditLogger: AuditLogger;
  mediaOperations: MediaOperations;
}

export interface HomeHubResponse {
  success: boolean;
  responseType: 'status' | 'diagnosis' | 'action' | 'error';
  message: string;
  data?: {
    health?: HealthResult;
    diagnosis?: DiagnosisResult;
    action?: ActionResult;
    media?: {
      items: MediaItem[];
      plan?: MediaOperationPlan;
      preview?: MediaPreview;
    };
  };
  requiresConfirmation?: boolean;
  nextActions?: Array<{ label: string; action: string; params: Record<string, unknown> }>;
}

const SERVICE_KEYWORDS: Array<{ serviceId: ServiceId; keywords: RegExp }> = [
  { serviceId: 'langbot', keywords: /langbot|机器人|主程序/ },
  { serviceId: 'telegram-adapter', keywords: /telegram|电报|tg|poller|polling|轮询/ },
  { serviceId: 'kook-adapter', keywords: /kook|开黑啦|kooc/ },
  { serviceId: 'mastra-pubg-runtime', keywords: /pubg.*runtime|查询引擎|战绩服务/ },
  { serviceId: 'n8n', keywords: /n8n|workflow|工作流/ },
  { serviceId: 'postgres', keywords: /postgres|postgresql|pg数据库/ },
  { serviceId: 'redis', keywords: /redis|缓存服务/ },
  { serviceId: 'emby', keywords: /emby|媒体服务/ },
  { serviceId: 'jellyfin', keywords: /jellyfin/ },
  { serviceId: 'qbittorrent', keywords: /qbittorrent|qbit|种子/ },
  { serviceId: 'aria2', keywords: /aria2/ },
  { serviceId: 'glances', keywords: /glances/ },
  { serviceId: 'cloudflared', keywords: /cloudflare|cloudflared|tunnel|隧道/ },
];

export class HomeHubEntry {
  private readonly contextManager: ContextManager;
  private readonly diagnosticEngine: DiagnosticEngine;
  private readonly actionEngine: ActionEngine;
  private readonly auditLogger: AuditLogger;
  private readonly mediaOperations: MediaOperations;
  private readonly pendingMediaPlans = new Map<string, MediaOperationPlan>();

  constructor(options: HomeHubEntryOptions) {
    this.contextManager = options.contextManager;
    this.diagnosticEngine = options.diagnosticEngine;
    this.actionEngine = options.actionEngine;
    this.auditLogger = options.auditLogger;
    this.mediaOperations = options.mediaOperations;
  }

  /**
   * Main entry point for HomeHub queries
   */
  async handleRequest(
    text: string,
    platform: string,
    userId: string,
    senderId: string
  ): Promise<HomeHubResponse> {
    const sessionId = `session-${senderId}`;
    const domain = new HomeHubDomain({ userId, platform, sessionId });
    this.contextManager.getContext(sessionId, userId, platform);

    const pendingMediaPlan = this.pendingMediaPlans.get(sessionId);
    if (pendingMediaPlan && /^(?:确认|确认执行|执行|是|是的|好|行)$/i.test(text.trim())) {
      return this.executePendingMedia(sessionId, pendingMediaPlan);
    }
    if (pendingMediaPlan && /^(?:取消|算了|不用|不了|no)$/i.test(text.trim())) {
      this.pendingMediaPlans.delete(sessionId);
      return { success: true, responseType: 'action', message: '已取消媒体整理，下载目录和媒体库均未修改。' };
    }

    const query = domain.parseQuery(text);

    switch (query.queryType) {
      case 'diagnosis':
        return await this.handleDiagnosisQuery(query, platform, senderId, domain);
      case 'action':
        return await this.handleActionQuery(query, platform, senderId, domain);
      case 'history':
        return await this.handleHistoryQuery(userId, domain);
      case 'media':
        return await this.handleMediaQuery(query, sessionId);
      case 'status':
      default:
        return await this.handleStatusQuery(query, platform, senderId, domain);
    }
  }

  private resolveServiceId(text: string): ServiceId | undefined {
    const lowerText = text.toLowerCase();
    const match = SERVICE_KEYWORDS.find(({ keywords }) => keywords.test(lowerText));
    return match?.serviceId;
  }

  private resolveAction(text: string): Action | undefined {
    const lowerText = text.toLowerCase();
    if (/重启|restart/.test(lowerText)) return 'restart';
    if (/启动|start/.test(lowerText)) return 'start';
    if (/停止|stop/.test(lowerText)) return 'stop';
    if (/检查|check|日志/.test(lowerText)) return 'check';
    return undefined;
  }

  private async handleStatusQuery(
    query: HomeHubQuery,
    platform: string,
    senderId: string,
    domain: HomeHubDomain
  ): Promise<HomeHubResponse> {
    const serviceId = query.serviceId ?? this.resolveServiceId(query.text);
    if (serviceId) {
      return this.diagnoseAndRespond(serviceId, platform, senderId, domain, false);
    }
    // Overall status: gather health for registry services
    const health = await this.diagnosticEngine.systemHealth(platform);
    const message = this.renderSystemHealth(health);
    return { success: true, responseType: 'status', message, data: { health } };
  }

  private async handleDiagnosisQuery(
    query: HomeHubQuery,
    platform: string,
    senderId: string,
    domain: HomeHubDomain
  ): Promise<HomeHubResponse> {
    let serviceId = query.serviceId ?? this.resolveServiceId(query.text);
    if (!serviceId) {
      // Try to resolve from context active service
      const reference = this.contextManager.getContextForReference(`session-${senderId}`);
      if (reference.activeService) serviceId = reference.activeService as ServiceId;
    }
    if (!serviceId) {
      return {
        success: false,
        responseType: 'error',
        message: '无法识别要诊断的服务。可以试试："Emby 怎么了"、"Telegram 怎么不回复了"。',
      };
    }
    return this.diagnoseAndRespond(serviceId, platform, senderId, domain, true);
  }

  private async handleMediaQuery(query: HomeHubQuery, sessionId: string): Promise<HomeHubResponse> {
    const target = this.extractMediaTarget(query.text);
    if (!target) {
      return {
        success: false,
        responseType: 'error',
        message: '请明确指定要整理的下载项目名称或完整路径（仅支持 /Volumes/Avalon/downloads 下的项目）。未指定具体项目时不会扫描或修改任何文件。',
      };
    }

    let items: MediaItem[];
    try {
      items = await this.mediaOperations.scanDownloads(target);
    } catch (error) {
      return {
        success: false,
        responseType: 'error',
        message: `扫描下载项目失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }

    if (items.length === 0) {
      return {
        success: false,
        responseType: 'error',
        message: `未在允许的下载目录中找到「${target}」对应的可整理视频项目。`,
      };
    }
    if (items.length > 1) {
      return {
        success: false,
        responseType: 'error',
        message: `找到多个匹配项目（${items.map((item) => item.title).join('、')}），请改用完整下载路径以避免误整理。`,
      };
    }

    const item = items[0]!;
    try {
      const plan = await this.mediaOperations.createOperationPlan(item);
      const preview = await this.mediaOperations.previewPlan(plan);
      if (!preview.success) {
        return {
          success: false,
          responseType: 'error',
          message: preview.message,
          data: { media: { items, plan, preview } },
        };
      }

      this.pendingMediaPlans.set(sessionId, plan);
      return {
        success: true,
        responseType: 'action',
        message: `${preview.message}\n\n目标：${plan.targetPath}\n备份：${plan.backupPath}\n\n仅会处理这个明确下载项目，不会修改已有媒体库文件。回复「确认」执行，或「取消」。`,
        requiresConfirmation: true,
        data: { media: { items, plan, preview } },
      };
    } catch (error) {
      return {
        success: false,
        responseType: 'error',
        message: `媒体整理计划创建失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  private async executePendingMedia(sessionId: string, plan: MediaOperationPlan): Promise<HomeHubResponse> {
    this.pendingMediaPlans.delete(sessionId);
    const result = await this.mediaOperations.executePlan(plan);
    return {
      success: result.success,
      responseType: 'action',
      message: result.success
        ? `${result.message}\n已执行 ${result.operationsExecuted} 项操作；原始文件备份已保留。`
        : `${result.message}\n已执行 ${result.operationsExecuted} 项操作；请使用备份目录恢复或人工检查。`,
    };
  }

  private extractMediaTarget(text: string): string | undefined {
    const explicitPath = text.match(/\/Volumes\/Avalon\/downloads(?:\/complete)?\/[^\s"'“”‘’，。！？]+/i)?.[0];
    if (explicitPath) return explicitPath.replace(/[，。！？]+$/u, '');

    const quoted = text.match(/["“”‘’']([^"“”‘’']{2,})["“”‘’']/u)?.[1]?.trim();
    if (quoted) return quoted;

    const candidate = text
      .replace(/(?:请|帮我|把|下载好了的(?:媒体|项目)?|下载好了|下载目录|下载项目|媒体整理|整理|刮削|改名|让|使|被|被?emby识别|emby识别)/giu, ' ')
      .replace(/[，。！？、:：]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (candidate.length >= 2 && !/^(?:一下|电影|电视剧|动漫|媒体|项目|的|这个|该|的媒体|的项目|emby)$/iu.test(candidate)) return candidate;
    return undefined;
  }

  private async diagnoseAndRespond(
    serviceId: ServiceId,
    platform: string,
    senderId: string,
    domain: HomeHubDomain,
    isDiagnosisQuery: boolean
  ): Promise<HomeHubResponse> {
    const sessionId = `session-${senderId}`;
    const serviceName = this.displayName(serviceId);

    let result: DiagnosisResult;
    try {
      if (serviceId === 'telegram-adapter') {
        result = await this.diagnosticEngine.diagnoseTelegramPolling();
      } else {
        result = await this.diagnosticEngine.diagnose(serviceId);
      }
    } catch (error) {
      return {
        success: false,
        responseType: 'error',
        message: `诊断 ${serviceName} 失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }

    // Record diagnosis context
    this.contextManager.setLastDiagnosis(sessionId, serviceId, result);

    // Build message
    const message = isDiagnosisQuery
      ? domain.formatDiagnosisResult(result)
      : domain.formatHealthForService(result, serviceName);

    const nextActions = result.recommendedActions.map((rec) => ({
      label: `${this.actionLabel(rec.action)} ${serviceName}`,
      action: rec.action,
      params: { serviceId, reason: rec.reason } as Record<string, unknown>,
    }));

    return {
      success: true,
      responseType: isDiagnosisQuery ? 'diagnosis' : 'status',
      message,
      data: { diagnosis: result },
      ...(nextActions.length ? { nextActions } : {}),
    };
  }

  private async handleActionQuery(
    query: HomeHubQuery,
    platform: string,
    senderId: string,
    domain: HomeHubDomain
  ): Promise<HomeHubResponse> {
    const sessionId = `session-${senderId}`;
    const contextRef = this.contextManager.getContextForReference(sessionId);

    // Service from explicit text, then context active service
    let serviceId = query.serviceId ?? this.resolveServiceId(query.text);
    if (!serviceId && contextRef.activeService) {
      serviceId = contextRef.activeService as ServiceId;
    }

    // Action
    const action = this.resolveAction(query.text) ?? 'restart';

    // Confirmation of a pending action?
    if (contextRef.hasPendingAction && /确认|确认执行|是|是的|好|行|重启它|执行/.test(query.text)) {
      return this.executePending(sessionId, domain);
    }
    if (contextRef.hasPendingAction && /取消|算了|不用|不了|no|stop/.test(query.text)) {
      this.contextManager.clearServiceContext(sessionId);
      return { success: true, responseType: 'action', message: '已取消操作。' };
    }

    if (!serviceId || !this.isActionAllowed(serviceId, action)) {
      return {
        success: false,
        responseType: 'error',
        message: `无法执行「${this.actionLabel(action)}」：请明确指定目标服务，或该服务不允许此操作。`,
      };
    }

    const request: ActionRequest = {
      serviceId,
      action,
      userId: query.userId,
      platform: query.platform,
      reason: query.text,
      skipConfirmation: false,
      dryRun: true,
    };

    // Dry run first to decide confirmation
    const dryRun = await this.actionEngine.executeAction(request);
    const confirmationRequired = dryRun.verification.passed
      ? !this.isLowRisk(serviceId)
      : true;

    if (confirmationRequired) {
      this.contextManager.setPendingAction(sessionId, { ...request, dryRun: false });
      const serviceName = this.displayName(serviceId);
      return {
        success: true,
        responseType: 'action',
        message: `⚠️ 确认执行「${this.actionLabel(action)} ${serviceName}」？\n\n回复「确认」执行，或「取消」。`,
        requiresConfirmation: true,
        data: { action: dryRun },
      };
    }

    const result = await this.actionEngine.executeAction({ ...request, dryRun: false });
    await this.auditLogger.logAction(request, result, result.verification.passed);
    this.contextManager.setLastActionResult(sessionId, result);
    return {
      success: result.status === 'success',
      responseType: 'action',
      message: domain.formatActionResult(result),
      data: { action: result },
    };
  }

  private async executePending(sessionId: string, domain: HomeHubDomain): Promise<HomeHubResponse> {
    const pending = this.contextManager.getPending(sessionId);
    if (!pending?.request) {
      return { success: false, responseType: 'error', message: '没有待确认的操作。' };
    }
    const request = pending.request;
    const result = await this.actionEngine.executeAction(request);
    await this.auditLogger.logAction(request, result, result.verification.passed);
    this.contextManager.setLastActionResult(sessionId, result);
    return {
      success: result.status === 'success',
      responseType: 'action',
      message: domain.formatActionResult(result),
      data: { action: result },
    };
  }

  private async handleHistoryQuery(userId: string, domain: HomeHubDomain): Promise<HomeHubResponse> {
    const logs = await this.auditLogger.getUserAuditLogs(userId, 10);
    if (!logs.length) {
      return { success: true, responseType: 'status', message: '还没有操作记录。' };
    }
    const lines = ['**最近操作记录:**', ''];
    for (const log of logs) {
      const ok = log.verificationPassed ? '✅' : '❌';
      const when = new Date(log.timestamp).toISOString();
      lines.push(`${ok} ${when} · ${log.serviceId} · ${log.action}`);
    }
    return { success: true, responseType: 'status', message: lines.join('\n') };
  }

  private renderSystemHealth(health: HealthResult): string {
    const lines: string[] = [];
    lines.push('📊 **主机状态**');
    lines.push(`CPU: ${health.host.cpu.usage.toFixed(1)}% | 内存: ${health.host.memory.percentage.toFixed(1)}%`);
    for (const disk of health.host.disk) {
      lines.push(`磁盘 ${disk.mount}: ${disk.percentage.toFixed(1)}%`);
    }
    lines.push('');
    lines.push('📦 **服务状态**');
    const icons: Record<string, string> = { healthy: '✅', degraded: '⚠️', unhealthy: '❌', unknown: '❓' };
    for (const service of health.services) {
      lines.push(`${icons[service.status] ?? '❓'} ${this.displayName(service.serviceId)} — ${service.message}`);
    }
    if (health.abnormal.length) {
      lines.push('');
      lines.push(`⚠️ 异常服务: ${health.abnormal.map((s) => this.displayName(s)).join('、')}`);
      lines.push(`诊断: ${health.diagnosis}`);
    } else {
      lines.push('');
      lines.push('✅ 所有服务运行正常。');
    }
    return lines.join('\n');
  }

  private displayName(serviceId: ServiceId): string {
    const names: Record<ServiceId, string> = {
      langbot: 'LangBot',
      'telegram-adapter': 'Telegram',
      'kook-adapter': 'KOOK',
      'mastra-pubg-runtime': 'PUBG Runtime',
      n8n: 'n8n',
      postgres: 'Postgres',
      redis: 'Redis',
      emby: 'Emby',
      jellyfin: 'Jellyfin',
      qbittorrent: 'qBittorrent',
      aria2: 'aria2',
      glances: 'Glances',
      cloudflared: 'Cloudflare Tunnel',
    };
    return names[serviceId] ?? serviceId;
  }

  private actionLabel(action: Action): string {
    const labels: Record<Action, string> = {
      start: '启动',
      restart: '重启',
      stop: '停止',
      check: '检查',
      cleanup: '清理',
      rotate_logs: '轮转日志',
    };
    return labels[action] ?? action;
  }

  private isLowRisk(serviceId: ServiceId): boolean {
    return ['telegram-adapter', 'kook-adapter', 'redis', 'qbittorrent', 'aria2', 'glances', 'cloudflared'].includes(serviceId);
  }

  private isActionAllowed(serviceId: ServiceId, action: Action): boolean {
    return this.actionEngine.isAllowed(serviceId, action);
  }
}
