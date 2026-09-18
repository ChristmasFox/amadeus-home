import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import type { AmadeusConfig } from './config.js';
import { requestJson } from './http.js';
import { ownerEvent, type OwnerNotifier } from './owner.js';

export type MediaAction = 'scan' | 'preview' | 'execute' | 'cancel';

interface MediaInput {
  action: MediaAction;
  sourceName?: string;
  candidateIndex?: number;
  previewId?: string;
  confirm?: boolean;
}

interface PendingPreview {
  previewId: string;
  createdAt: number;
}

const pending = new Map<string, PendingPreview>();

function sessionKey(context: OpenClawPluginToolContext): string {
  const value = context.sessionKey?.trim() || context.sessionId?.trim();
  if (!value) throw new Error('OpenClaw session identity is unavailable');
  return `openclaw:${value}`;
}

function ownerOnly(context: OpenClawPluginToolContext): void {
  if (context.senderIsOwner !== true) throw new Error('媒体整理只允许 owner 身份执行');
}

function responseMessage(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value ?? '媒体适配器没有返回结果');
  const item = value as Record<string, unknown>;
  return String(item.preview_text ?? item.message ?? item.reason ?? JSON.stringify(value));
}

export async function organizeMedia(
  config: AmadeusConfig,
  input: MediaInput,
  context: OpenClawPluginToolContext,
  notifier: OwnerNotifier,
  signal?: AbortSignal,
): Promise<unknown> {
  const key = sessionKey(context);
  if (input.action === 'cancel') {
    pending.delete(key);
    return { action: 'cancel', cancelled: true, message: '已取消当前整理 Preview，未修改任何媒体文件。' };
  }
  if (input.action === 'scan') {
    const result = await requestJson(`${config.mediaAdapterBaseUrl}/scan`, { method: 'POST', body: { session_key: key }, ...(signal ? { signal } : {}), timeoutMs: 45_000 });
    return { action: 'scan', result, message: responseMessage(result) };
  }
  ownerOnly(context);
  if (input.action === 'preview') {
    const sourceName = input.sourceName?.trim();
    const candidateIndex = input.candidateIndex;
    if (!sourceName && candidateIndex === undefined) throw new Error('preview requires an exact sourceName or candidateIndex from scan');
    const body: Record<string, unknown> = { session_key: key };
    if (sourceName) body.source_name = sourceName;
    else body.candidate_index = candidateIndex;
    const result = await requestJson(`${config.mediaAdapterBaseUrl}/preview`, { method: 'POST', body, ...(signal ? { signal } : {}), timeoutMs: 60_000 });
    const value = result && typeof result === 'object' ? result as Record<string, unknown> : {};
    const previewId = String(value.preview_id ?? '').trim();
    if (previewId && value.success !== false && value.can_execute === true) pending.set(key, { previewId, createdAt: Date.now() });
    else pending.delete(key);
    return { action: 'preview', result, message: responseMessage(result), ...(previewId ? { previewId } : {}) };
  }
  if (input.confirm !== true) throw new Error('execute requires confirm=true after showing the Preview');
  const current = pending.get(key);
  if (!current || Date.now() - current.createdAt > 30 * 60_000) {
    pending.delete(key);
    throw new Error('当前会话没有有效 Preview，请先重新预览');
  }
  if (input.previewId && input.previewId !== current.previewId) throw new Error('previewId does not belong to the current session');
  const result = await requestJson(`${config.mediaAdapterBaseUrl}/execute`, { method: 'POST', body: { preview_id: current.previewId, session_key: key, confirm: true }, ...(signal ? { signal } : {}), timeoutMs: 120_000 });
  const value = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  if (value.success === true) {
    pending.delete(key);
    const notification = await notifier.notify(ownerEvent({
      eventKey: `media-organize:${current.previewId}:completed`,
      source: 'media-organize',
      title: 'Emby 媒体整理完成',
      message: responseMessage(result),
    }));
    return { action: 'execute', result, message: responseMessage(result), notification };
  }
  return { action: 'execute', result, message: responseMessage(result) };
}
