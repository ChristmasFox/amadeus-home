import { randomUUID } from 'node:crypto';
import type {
  Action,
  ActionRequest,
  ActionResult,
  AuthorizationIdentityLike,
  DiagnosisResult,
  HealthResult,
  HomeHubQuery,
  ServiceId,
} from '@agent/homehub-domain';
import {
  ActionEngine,
  AuditLogger,
  AuthorizationCore,
  ContextManager,
  DiagnosticEngine,
  HomeHubDomain,
} from '@agent/homehub-domain';
import { MediaOperations, type MediaItem, type MediaOperationPlan } from '../operations/media-operations.js';

type MediaPreview = Awaited<ReturnType<MediaOperations['previewPlan']>>;

export interface HomeHubRequestContext {
  identity: AuthorizationIdentityLike;
  platformUserId: string;
  chatId: string;
  messageId?: string;
}

export interface HomeHubEntryOptions {
  contextManager: ContextManager;
  diagnosticEngine: DiagnosticEngine;
  actionEngine: ActionEngine;
  auditLogger: AuditLogger;
  mediaOperations: MediaOperations;
  authorizationCore?: AuthorizationCore;
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

const CONFIRM_PATTERN = /^(?:确认|确认执行|执行|是|是的|好|行|重启它)$/iu;
const CANCEL_PATTERN = /^(?:取消|算了|不用|不了|no)$/iu;

function sessionIdForChat(platform: string, chatId: string): string {
  return `homehub:${platform}:${chatId}`;
}

function primaryRole(identity: AuthorizationIdentityLike): 'PUBLIC' | 'TRUSTED' | 'ADMIN' {
  if (identity.roles.includes('ADMIN')) return 'ADMIN';
  if (identity.roles.includes('TRUSTED')) return 'TRUSTED';
  return 'PUBLIC';
}

function internalUserId(identity: AuthorizationIdentityLike): string | null {
  return identity.internalUserId ?? identity.internalIdentity?.internalUserId ?? null;
}

export class HomeHubEntry {
  private readonly contextManager: ContextManager;
  private readonly diagnosticEngine: DiagnosticEngine;
  private readonly actionEngine: ActionEngine;
  private readonly auditLogger: AuditLogger;
  private readonly mediaOperations: MediaOperations;
  private readonly authorizationCore: AuthorizationCore;
  private readonly pendingMediaPlans = new Map<string, { plan: MediaOperationPlan; request: ActionRequest }>();

  constructor(options: HomeHubEntryOptions) {
    this.contextManager = options.contextManager;
    this.diagnosticEngine = options.diagnosticEngine;
    this.actionEngine = options.actionEngine;
    this.auditLogger = options.auditLogger;
    this.mediaOperations = options.mediaOperations;
    this.authorizationCore = options.authorizationCore ?? new AuthorizationCore();
  }

  /** Main entry point for HomeHub queries. */
  async handleRequest(
    text: string,
    platform: string,
    userId: string,
    senderId: string,
    requestContext?: HomeHubRequestContext,
  ): Promise<HomeHubResponse> {
    const platformUserId = requestContext?.platformUserId ?? userId;
    const chatId = requestContext?.chatId ?? senderId;
    const identity = requestContext?.identity ?? this.authorizationCore.resolve({ platform, platformUserId });
    const sessionId = sessionIdForChat(platform, chatId);
    const domain = new HomeHubDomain({ userId: platformUserId, platform, sessionId });
    this.contextManager.getContext(sessionId, platformUserId, platform);

    if (CONFIRM_PATTERN.test(text.trim())) {
      return this.confirmPending(sessionId, platform, chatId, platformUserId, identity, domain);
    }
    if (CANCEL_PATTERN.test(text.trim())) {
      return this.cancelPending(sessionId, platform, chatId, platformUserId, identity);
    }

    const query = domain.parseQuery(text);
    switch (query.queryType) {
      case 'diagnosis':
        return this.handleDiagnosisQuery(query, platform, chatId, domain);
      case 'action':
        return this.handleActionQuery(query, platform, chatId, domain, identity);
      case 'history':
        return this.handleHistoryQuery(platformUserId);
      case 'media':
        return this.handleMediaQuery(query, sessionId, platform, chatId, platformUserId, identity);
      case 'status':
      default:
        return this.handleStatusQuery(query, platform, chatId, domain);
    }
  }

  private resolveServiceId(text: string): ServiceId | undefined {
    const match = SERVICE_KEYWORDS.find(({ keywords }) => keywords.test(text.toLowerCase()));
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
    chatId: string,
    domain: HomeHubDomain,
  ): Promise<HomeHubResponse> {
    const serviceId = query.serviceId ?? this.resolveServiceId(query.text);
    if (serviceId) return this.diagnoseAndRespond(serviceId, platform, chatId, domain, false);
    const health = await this.diagnosticEngine.systemHealth(platform);
    return { success: true, responseType: 'status', message: this.renderSystemHealth(health), data: { health } };
  }

  private async handleDiagnosisQuery(
    query: HomeHubQuery,
    platform: string,
    chatId: string,
    domain: HomeHubDomain,
  ): Promise<HomeHubResponse> {
    let serviceId = query.serviceId ?? this.resolveServiceId(query.text);
    if (!serviceId) {
      const reference = this.contextManager.getContextForReference(sessionIdForChat(platform, chatId));
      serviceId = reference.activeService ?? undefined;
    }
    if (!serviceId) {
      return { success: false, responseType: 'error', message: '无法识别要诊断的服务。可以试试：「Emby 怎么了」或「Telegram 怎么不回复了」。' };
    }
    return this.diagnoseAndRespond(serviceId, platform, chatId, domain, true);
  }

  private async handleMediaQuery(
    query: HomeHubQuery,
    sessionId: string,
    platform: string,
    chatId: string,
    platformUserId: string,
    identity: AuthorizationIdentityLike,
  ): Promise<HomeHubResponse> {
    const target = this.extractMediaTarget(query.text);
    const service = this.actionEngine.getService('emby');
    if (!service) return { success: false, responseType: 'error', message: '媒体整理服务未注册。' };

    const actionId = `action-${randomUUID()}`;
    const request: ActionRequest = {
      serviceId: 'emby',
      action: 'organize_media',
      userId: platformUserId,
      platform,
      platformUserId,
      internalUserId: internalUserId(identity),
      role: primaryRole(identity),
      chatId,
      actionId,
      ...(target ? { target } : {}),
      reason: query.text,
      confirmed: false,
      dryRun: false,
    };
    const decision = this.authorizationCore.authorize({ identity, action: 'organize_media', service, confirmed: false });
    if (!decision.authorized && !decision.requiresConfirmation) {
      const denied = await this.actionEngine.executeAction(request, identity);
      await this.auditLogger.logAction(request, denied, false, identity);
      return { success: false, responseType: 'action', message: denied.result.message, data: { action: denied } };
    }

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
      return { success: false, responseType: 'error', message: `扫描下载项目失败: ${error instanceof Error ? error.message : '未知错误'}` };
    }
    if (items.length === 0) {
      return { success: false, responseType: 'error', message: `未在允许的下载目录中找到「${target}」对应的可整理视频项目。` };
    }
    if (items.length > 1) {
      return { success: false, responseType: 'error', message: `找到多个匹配项目（${items.map((item) => item.title).join('、')}），请改用完整下载路径以避免误整理。` };
    }

    const item = items[0]!;
    try {
      const plan = await this.mediaOperations.createOperationPlan(item);
      const preview = await this.mediaOperations.previewPlan(plan);
      if (!preview.success) return { success: false, responseType: 'error', message: preview.message, data: { media: { items, plan, preview } } };

      this.pendingMediaPlans.set(actionId, { plan, request });
      this.contextManager.setPendingAction(sessionId, request, {
        actionId,
        platform,
        chatId,
        userId: platformUserId,
        platformUserId,
        internalUserId: internalUserId(identity),
        role: primaryRole(identity),
        target,
      });
      return {
        success: true,
        responseType: 'action',
        message: `${preview.message}\n\n目标：${plan.targetPath}\n备份：${plan.backupPath}\n\n仅会处理这个明确下载项目，不会修改已有媒体库文件。回复「确认」执行，或「取消」。`,
        requiresConfirmation: true,
        data: { media: { items, plan, preview } },
      };
    } catch (error) {
      return { success: false, responseType: 'error', message: `媒体整理计划创建失败: ${error instanceof Error ? error.message : '未知错误'}` };
    }
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
    chatId: string,
    domain: HomeHubDomain,
    isDiagnosisQuery: boolean,
  ): Promise<HomeHubResponse> {
    let result: DiagnosisResult;
    try {
      result = serviceId === 'telegram-adapter'
        ? await this.diagnosticEngine.diagnoseTelegramPolling()
        : await this.diagnosticEngine.diagnose(serviceId);
    } catch (error) {
      return { success: false, responseType: 'error', message: `诊断 ${this.displayName(serviceId)} 失败: ${error instanceof Error ? error.message : '未知错误'}` };
    }
    const sessionId = sessionIdForChat(platform, chatId);
    this.contextManager.setLastDiagnosis(sessionId, serviceId, result);
    const message = isDiagnosisQuery ? domain.formatDiagnosisResult(result) : domain.formatHealthForService(result, this.displayName(serviceId));
    const nextActions = result.recommendedActions.map((recommendation) => ({
      label: `${this.actionLabel(recommendation.action)} ${this.displayName(serviceId)}`,
      action: recommendation.action,
      params: { serviceId, reason: recommendation.reason } as Record<string, unknown>,
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
    chatId: string,
    domain: HomeHubDomain,
    identity: AuthorizationIdentityLike,
  ): Promise<HomeHubResponse> {
    const sessionId = sessionIdForChat(platform, chatId);
    const contextRef = this.contextManager.getContextForReference(sessionId);
    let serviceId = query.serviceId ?? this.resolveServiceId(query.text);
    if (!serviceId && contextRef.activeService) serviceId = contextRef.activeService;
    const action = this.resolveAction(query.text) ?? 'restart';

    if (!serviceId || !this.isActionAllowed(serviceId, action)) {
      return { success: false, responseType: 'error', message: `无法执行「${this.actionLabel(action)}」：请明确指定目标服务，或该服务不允许此操作。` };
    }

    const actionId = `action-${randomUUID()}`;
    const request: ActionRequest = {
      serviceId,
      action,
      userId: query.userId,
      platform,
      platformUserId: identity.platformIdentity.platformUserId,
      internalUserId: internalUserId(identity),
      role: primaryRole(identity),
      chatId,
      actionId,
      reason: query.text,
      confirmed: false,
      dryRun: false,
    };
    const service = this.actionEngine.getService(serviceId);
    if (!service) return { success: false, responseType: 'error', message: '目标服务未注册。' };
    const decision = this.authorizationCore.authorize({ identity, action, service, confirmed: false });
    if (!decision.authorized && !decision.requiresConfirmation) {
      const denied = await this.actionEngine.executeAction(request, identity);
      await this.auditLogger.logAction(request, denied, false, identity);
      return { success: false, responseType: 'action', message: denied.result.message, data: { action: denied } };
    }

    if (decision.requiresConfirmation) {
      const preview = await this.actionEngine.executeAction({ ...request, dryRun: true }, identity);
      this.contextManager.setPendingAction(sessionId, request, {
        actionId,
        platform,
        chatId,
        userId: identity.platformIdentity.platformUserId,
        platformUserId: identity.platformIdentity.platformUserId,
        internalUserId: internalUserId(identity),
        role: primaryRole(identity),
      });
      return {
        success: true,
        responseType: 'action',
        message: `⚠️ 确认执行「${this.actionLabel(action)} ${this.displayName(serviceId)}」？\n\n回复「确认」执行，或「取消」。`,
        requiresConfirmation: true,
        data: { action: preview },
      };
    }

    const result = await this.actionEngine.executeAction(request, identity);
    await this.auditLogger.logAction(request, result, result.verification.passed, identity);
    this.contextManager.setLastActionResult(sessionId, result);
    return { success: result.status === 'success', responseType: 'action', message: domain.formatActionResult(result), data: { action: result } };
  }

  private async confirmPending(
    sessionId: string,
    platform: string,
    chatId: string,
    platformUserId: string,
    identity: AuthorizationIdentityLike,
    domain: HomeHubDomain,
  ): Promise<HomeHubResponse> {
    const anyPending = this.contextManager.getContextRecord(sessionId)?.pendingAction ?? null;
    if (!anyPending) return { success: false, responseType: 'error', message: '没有待确认的操作。' };
    const pending = this.contextManager.getPendingForActor(sessionId, {
      platform,
      chatId,
      platformUserId,
      actionId: anyPending.actionId,
    });
    if (!pending) return this.denyForeignConfirmation(anyPending.request, platform, chatId, platformUserId, identity);

    const request = { ...pending.request, confirmed: true, dryRun: false };
    if (request.action === 'organize_media' || request.action === 'organize') {
      const media = this.pendingMediaPlans.get(pending.actionId);
      if (!media) {
        this.contextManager.clearPendingAction(sessionId);
        return { success: false, responseType: 'error', message: '媒体整理 Preview 已失效，请重新生成 Preview。' };
      }
      this.pendingMediaPlans.delete(pending.actionId);
      const result = await this.mediaOperations.executePlan(media.plan);
      const verification = result.success
        ? await this.mediaOperations.verifyPlan(media.plan)
        : { passed: false, message: '执行失败，跳过目标验证', missing: [] };
      const actionResult = this.mediaActionResult(request, result, verification);
      await this.auditLogger.logAction(request, actionResult, actionResult.verification.passed, identity);
      this.contextManager.setLastActionResult(sessionId, actionResult);
      const success = actionResult.status === 'success';
      return {
        success,
        responseType: 'action',
        message: success
          ? `${result.message}\n已执行 ${result.operationsExecuted} 项操作；原始文件备份已保留。`
          : `${result.message}\n验证结果：${verification.message}\n已执行 ${result.operationsExecuted} 项操作；请使用备份目录恢复或人工检查。`,
        data: { action: actionResult },
      };
    }

    const result = await this.actionEngine.executeAction(request, identity);
    await this.auditLogger.logAction(request, result, result.verification.passed, identity);
    this.contextManager.setLastActionResult(sessionId, result);
    return { success: result.status === 'success', responseType: 'action', message: domain.formatActionResult(result), data: { action: result } };
  }

  private async cancelPending(
    sessionId: string,
    platform: string,
    chatId: string,
    platformUserId: string,
    identity: AuthorizationIdentityLike,
  ): Promise<HomeHubResponse> {
    const anyPending = this.contextManager.getContextRecord(sessionId)?.pendingAction ?? null;
    if (!anyPending) return { success: false, responseType: 'error', message: '没有待取消的操作。' };
    const pending = this.contextManager.getPendingForActor(sessionId, {
      platform,
      chatId,
      platformUserId,
      actionId: anyPending.actionId,
    });
    if (!pending) return this.denyForeignConfirmation(anyPending.request, platform, chatId, platformUserId, identity);
    this.pendingMediaPlans.delete(pending.actionId);
    const request = { ...pending.request, confirmed: false, dryRun: false };
    const cancelled = this.cancelledResult(request, '用户取消操作');
    await this.auditLogger.logAction(request, cancelled, false, identity);
    this.contextManager.clearPendingAction(sessionId);
    return { success: true, responseType: 'action', message: '已取消操作，未执行任何变更。' };
  }

  private async denyForeignConfirmation(
    pendingRequest: ActionRequest,
    platform: string,
    chatId: string,
    platformUserId: string,
    identity: AuthorizationIdentityLike,
  ): Promise<HomeHubResponse> {
    const request: ActionRequest = {
      ...pendingRequest,
      userId: platformUserId,
      platform,
      platformUserId,
      chatId,
      actionId: `denied-${randomUUID()}`,
      confirmed: false,
      dryRun: false,
    };
    const denied = this.cancelledResult(request, '此操作绑定到其他用户，当前用户无权确认');
    await this.auditLogger.logAction(request, denied, false, identity);
    return { success: false, responseType: 'action', message: denied.result.message, data: { action: denied } };
  }

  private mediaActionResult(
    request: ActionRequest,
    result: { success: boolean; message: string; operationsExecuted: number },
    verification: { passed: boolean; message: string; missing: string[] },
  ): ActionResult {
    const now = new Date().toISOString();
    const success = result.success && verification.passed;
    return {
      requestId: request.actionId ?? `media-${randomUUID()}`,
      serviceId: 'emby',
      action: request.action === 'organize' ? 'organize' : 'organize_media',
      status: success ? 'success' : 'failed',
      result: {
        success,
        message: success ? result.message : `${result.message}；${verification.message}`,
        output: `operationsExecuted=${result.operationsExecuted}`,
      },
      verification: {
        passed: success,
        checks: [
          { name: 'media_plan_operations', status: result.success ? 'passed' : 'failed', message: result.message },
          { name: 'media_post_execution', status: verification.passed ? 'passed' : 'failed', message: verification.message },
        ],
        message: success ? '媒体整理操作已完成并通过验证' : verification.message,
      },
      timestamp: now,
      executedAt: now,
      verifiedAt: now,
      duration: 0,
    };
  }

  private cancelledResult(request: ActionRequest, message: string): ActionResult {
    const now = new Date().toISOString();
    return {
      requestId: request.actionId ?? `action-${randomUUID()}`,
      serviceId: request.serviceId,
      action: request.action,
      status: 'cancelled',
      result: { success: false, message },
      verification: { passed: false, checks: [], message: 'Authorization failed, action not executed' },
      timestamp: now,
      executedAt: now,
      verifiedAt: now,
      duration: 0,
    };
  }

  private async handleHistoryQuery(userId: string): Promise<HomeHubResponse> {
    const logs = await this.auditLogger.getUserAuditLogs(userId, 10);
    if (!logs.length) return { success: true, responseType: 'status', message: '还没有操作记录。' };
    const lines = ['**最近操作记录:**', ''];
    for (const log of logs) lines.push(`${log.verificationPassed ? '✅' : '❌'} ${new Date(log.timestamp).toISOString()} · ${log.serviceId} · ${log.action}`);
    return { success: true, responseType: 'status', message: lines.join('\n') };
  }

  private renderSystemHealth(health: HealthResult): string {
    const metric = (value: number | null): string => typeof value === 'number' ? `${value.toFixed(1)}%` : '未知';
    const hostMetricStatus = health.host.status === 'unknown'
      ? `未知（${health.host.unknownReason ?? '主机执行器不可用'}）`
      : '可用';
    const lines = [
      '📊 **主机状态**',
      `指标: ${hostMetricStatus}`,
      `CPU: ${metric(health.host.cpu.usage)} | 内存: ${metric(health.host.memory.percentage)}`,
    ];
    for (const disk of health.host.disk) lines.push(`磁盘 ${disk.mount}: ${metric(disk.percentage)}`);
    lines.push('', '📦 **服务状态**');
    const icons: Record<string, string> = { healthy: '✅', degraded: '⚠️', unhealthy: '❌', down: '⛔', unknown: '❓' };
    for (const service of health.services) lines.push(`${icons[service.status] ?? '❓'} ${this.displayName(service.serviceId)} — ${service.message}`);
    if (health.abnormal.length) {
      lines.push('', `⚠️ 异常服务: ${health.abnormal.map((service) => this.displayName(service)).join('、')}`, `诊断: ${health.diagnosis}`);
    } else if (health.summary.unknown > 0) {
      lines.push('', `❓ 有 ${health.summary.unknown} 个服务状态未知。`, `诊断: ${health.diagnosis}`);
    } else {
      lines.push('', '✅ 所有服务运行正常。');
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
      organize_media: '整理媒体',
      organize: '整理媒体',
    };
    return labels[action] ?? action;
  }

  private isActionAllowed(serviceId: ServiceId, action: Action): boolean {
    return this.actionEngine.isAllowed(serviceId, action);
  }
}
