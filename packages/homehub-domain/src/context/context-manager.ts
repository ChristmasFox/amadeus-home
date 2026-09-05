import { randomUUID } from 'node:crypto';
import type {
  ActionRequest,
  ActionResult,
  DiagnosisResult,
  HomeHubContext,
  Role,
  ServiceId,
} from '../schema/types.js';
import { ActionRequestSchema } from '../schema/types.js';

export interface ContextManagerOptions {
  persistPath?: string;
  sessionTtl?: number;
}

export interface PendingActionBinding {
  actionId: string;
  platform: string;
  chatId: string;
  userId: string;
  platformUserId: string;
  internalUserId: string | null;
  role: Role;
  target?: string | null;
}

export interface SessionReference {
  activeService: ServiceId | null;
  lastService: ServiceId | null;
  lastActionSuccess: boolean | null;
  hasPendingAction: boolean;
  pendingRequest: ActionRequest | null;
}

/** In-memory session state with exact actor binding for pending confirmations. */
export class ContextManager {
  private readonly contexts: Map<string, HomeHubContext>;
  private readonly options: Required<ContextManagerOptions>;

  constructor(options: ContextManagerOptions = {}) {
    this.contexts = new Map();
    this.options = {
      persistPath: options.persistPath ?? '/DATA/AppData/homehub/contexts',
      sessionTtl: options.sessionTtl ?? 30 * 60 * 1000,
    };
  }

  getContext(sessionId: string, userId: string, platform: string): HomeHubContext {
    let context = this.contexts.get(sessionId);
    if (!context) {
      const now = new Date().toISOString();
      context = {
        sessionId,
        userId,
        platform,
        activeService: null,
        lastDiagnosis: null,
        pendingAction: null,
        lastActionResult: null,
        createdAt: now,
        updatedAt: now,
      };
      this.contexts.set(sessionId, context);
    } else {
      context.updatedAt = new Date().toISOString();
      this.contexts.set(sessionId, context);
    }
    return context;
  }

  getContextRecord(sessionId: string): HomeHubContext | undefined {
    return this.contexts.get(sessionId);
  }

  setActiveService(sessionId: string, serviceId: ServiceId): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    context.activeService = serviceId;
    context.updatedAt = new Date().toISOString();
    this.contexts.set(sessionId, context);
  }

  setLastDiagnosis(sessionId: string, serviceId: ServiceId, result: DiagnosisResult): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    context.lastDiagnosis = { serviceId, result, timestamp: new Date().toISOString() };
    context.activeService = serviceId;
    context.updatedAt = new Date().toISOString();
    this.contexts.set(sessionId, context);
  }

  setPendingAction(sessionId: string, request: ActionRequest, binding?: Partial<PendingActionBinding>): string | null {
    const context = this.contexts.get(sessionId);
    if (!context) return null;
    const parsed = ActionRequestSchema.parse(request);
    const actionId = binding?.actionId ?? parsed.actionId ?? `action-${randomUUID()}`;
    const platformUserId = binding?.platformUserId ?? parsed.platformUserId ?? parsed.userId;
    const userId = binding?.userId ?? platformUserId;
    const platform = binding?.platform ?? parsed.platform;
    const chatId = binding?.chatId ?? parsed.chatId ?? sessionId;
    const internalUserId = binding?.internalUserId ?? parsed.internalUserId ?? null;
    const role = binding?.role ?? parsed.role ?? 'PUBLIC';
    const target = binding?.target ?? parsed.target ?? null;
    const normalizedRequest = {
      ...parsed,
      actionId,
      platformUserId,
      internalUserId,
      role,
      chatId,
    };
    context.pendingAction = {
      actionId,
      platform,
      chatId,
      userId,
      platformUserId,
      internalUserId,
      role,
      target,
      request: normalizedRequest,
      status: 'pending',
      timestamp: new Date().toISOString(),
    };
    context.activeService = normalizedRequest.serviceId;
    context.updatedAt = new Date().toISOString();
    this.contexts.set(sessionId, context);
    return actionId;
  }

  /** Return a pending action only when every confirmation binding matches. */
  getPendingForActor(sessionId: string, binding: Pick<PendingActionBinding, 'platform' | 'chatId' | 'platformUserId' | 'actionId'>): HomeHubContext['pendingAction'] {
    const pending = this.contexts.get(sessionId)?.pendingAction;
    if (!pending) return null;
    if (pending.platform !== binding.platform) return null;
    if (pending.chatId !== binding.chatId) return null;
    if (pending.platformUserId !== binding.platformUserId) return null;
    if (pending.actionId !== binding.actionId) return null;
    return pending;
  }

  setLastActionResult(sessionId: string, result: ActionResult): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    context.lastActionResult = { result, timestamp: new Date().toISOString() };
    context.activeService = result.serviceId;
    context.pendingAction = null;
    context.updatedAt = new Date().toISOString();
    this.contexts.set(sessionId, context);
  }

  clearPendingAction(sessionId: string): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    context.pendingAction = null;
    context.updatedAt = new Date().toISOString();
    this.contexts.set(sessionId, context);
  }

  clearServiceContext(sessionId: string, serviceId?: ServiceId): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    if (serviceId) {
      if (context.activeService === serviceId) context.activeService = null;
      if (context.lastDiagnosis?.serviceId === serviceId) context.lastDiagnosis = null;
      if (context.pendingAction?.request.serviceId === serviceId) context.pendingAction = null;
      if (context.lastActionResult?.result.serviceId === serviceId) context.lastActionResult = null;
    } else {
      context.activeService = null;
      context.lastDiagnosis = null;
      context.pendingAction = null;
      context.lastActionResult = null;
    }
    context.updatedAt = new Date().toISOString();
    this.contexts.set(sessionId, context);
  }

  getContextForReference(sessionId: string): SessionReference {
    const context = this.contexts.get(sessionId);
    if (!context) return { activeService: null, lastService: null, lastActionSuccess: null, hasPendingAction: false, pendingRequest: null };
    return {
      activeService: context.activeService ?? null,
      lastService: context.lastActionResult?.result.serviceId ?? context.lastDiagnosis?.serviceId ?? null,
      lastActionSuccess: context.lastActionResult?.result.result.success ?? null,
      hasPendingAction: context.pendingAction !== null,
      pendingRequest: context.pendingAction?.request ?? null,
    };
  }

  getPending(sessionId: string): {
    request: ActionRequest | null;
    action: string | null;
    status: string | null;
    timestamp: string | null;
  } {
    const pending = this.contexts.get(sessionId)?.pendingAction;
    if (!pending) return { request: null, action: null, status: null, timestamp: null };
    return {
      request: pending.request,
      action: pending.request.action,
      status: pending.status,
      timestamp: pending.timestamp,
    };
  }

  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [sessionId, context] of this.contexts.entries()) {
      if (now - new Date(context.updatedAt).getTime() > this.options.sessionTtl) {
        this.contexts.delete(sessionId);
        cleaned++;
      }
    }
    return cleaned;
  }

  getActiveSessions(): HomeHubContext[] {
    const now = Date.now();
    return Array.from(this.contexts.values()).filter((context) => now - new Date(context.updatedAt).getTime() <= this.options.sessionTtl);
  }

  deleteSession(sessionId: string): boolean {
    return this.contexts.delete(sessionId);
  }

  getSessionCount(): number {
    return this.contexts.size;
  }

  resolveServiceReference(sessionId: string, text: string): ServiceId | null {
    const context = this.getContextForReference(sessionId);
    const lowerText = text.toLowerCase();
    if (/telegram|电报|轮询|polling/.test(lowerText)) return 'telegram-adapter';
    if (/kook/.test(lowerText)) return 'kook-adapter';
    if (/langbot|机器人主/.test(lowerText)) return 'langbot';
    if (/n8n/.test(lowerText)) return 'n8n';
    if (/pubg/.test(lowerText)) return 'mastra-pubg-runtime';
    if (/emby/.test(lowerText)) return 'emby';
    if (/jellyfin/.test(lowerText)) return 'jellyfin';
    if (/redis/.test(lowerText)) return 'redis';
    if (/postgres/.test(lowerText)) return 'postgres';
    if (/qbittorrent|qbit/.test(lowerText)) return 'qbittorrent';
    if (/aria2/.test(lowerText)) return 'aria2';
    if (/glances/.test(lowerText)) return 'glances';
    if (/cloudflare|cloudflared|tunnel/.test(lowerText)) return 'cloudflared';
    if (/它|it|that|刚才那个|刚才的服务/.test(lowerText)) return context.activeService ?? context.lastService;
    return null;
  }
}
