export type ReplyModality = 'default' | 'voice';

// This registry is intentionally turn keyed. The runtime patch reads the same
// name when it decides whether marker recovery is allowed for a typed turn.
export const REPLY_MODALITY_RUNS_GLOBAL = '__amadeusReplyModalityRuns20260928';
const REPLY_MODALITY_TTL_MS = 120_000;

type ReplyModalityRecord = {
  modality: ReplyModality;
  runId?: string;
  sessionKey?: string;
  expiresAt: number;
};

type ReplyTurnContext = {
  runId?: unknown;
  sessionKey?: unknown;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function registry(): Map<string, ReplyModalityRecord> {
  const globals = globalThis as Record<string, unknown>;
  const existing = globals[REPLY_MODALITY_RUNS_GLOBAL];
  if (existing instanceof Map) return existing as Map<string, ReplyModalityRecord>;
  const created = new Map<string, ReplyModalityRecord>();
  globals[REPLY_MODALITY_RUNS_GLOBAL] = created;
  return created;
}

function keysFor(context: ReplyTurnContext): string[] {
  const runId = asString(context.runId);
  const sessionKey = asString(context.sessionKey);
  return [
    runId ? `run:${runId}` : undefined,
    sessionKey ? `session:${sessionKey}` : undefined,
  ].filter((key): key is string => Boolean(key));
}

function hasResponseAction(text: string): boolean {
  return /(?:回答|回复|告诉|说|解释|读|念|播报|答えて|返事して|教えて|説明して|answer|reply|respond|tell|explain)/iu.test(text);
}

function hasVoiceOutputPhrase(text: string): boolean {
  return /(?:用|以|通过)\s*(?:语音|声音|音频|语音消息|voice|audio)\s*(?:回答|回复|告诉|说|解释|读|念|播报)/iu.test(text)
    || /(?:回答|回复|告诉|说|解释|读|念|播报)\s*(?:我|一下|我一下)?\s*(?:用|以|通过)\s*(?:语音|声音|音频|语音消息|voice|audio)/iu.test(text)
    || /(?:音声|ボイス|音声メッセージ)で\s*(?:答えて|返事して|教えて|説明して)/iu.test(text)
    || /(?:answer|reply|respond|tell|explain)\s+(?:me\s+)?(?:by|with|in)\s+(?:a\s+)?(?:voice|audio)\b/iu.test(text)
    || /(?:voice|audio)\s+(?:reply|response)\b/iu.test(text);
}

function isFeatureDiscussion(text: string): boolean {
  return /(?:怎么|如何|什么|为什么|原理|实现|设置|开启|关闭|配置|支持|能不能|可以不可以|介绍|区别|怎么做|如何做|どう|なに|何|仕組み|実装|設定|対応|できますか|how|what|why|implement|configure|support)/iu.test(text)
    && /(?:语音|声音|音频|语音消息|tts|voice|audio|音声|ボイス)/iu.test(text);
}

function isTranslationRequest(text: string): boolean {
  return /(?:翻译|翻成|译成|译为|转换成|翻訳|translate|translation)/iu.test(text)
    && /(?:中文|汉语|普通话|日文|日语|日本語|英文|英语|Chinese|Japanese|English)/iu.test(text);
}

/**
 * Classifies a typed request from its action and output slots. A lone mention
 * of voice/TTS is never enough: feature questions and translation requests
 * stay on the normal text modality.
 */
export function classifyTypedReplyModality(prompt: unknown): ReplyModality {
  const text = typeof prompt === 'string' ? prompt.normalize('NFKC').trim() : '';
  if (!text || isTranslationRequest(text)) return 'default';
  if (isFeatureDiscussion(text) && !hasVoiceOutputPhrase(text)) return 'default';
  if (hasResponseAction(text) && hasVoiceOutputPhrase(text)) return 'voice';
  return 'default';
}

export function setReplyModalityForTurn(context: ReplyTurnContext, modality: ReplyModality): void {
  const runId = asString(context.runId);
  const sessionKey = asString(context.sessionKey);
  const now = Date.now();
  const record: ReplyModalityRecord = {
    modality,
    expiresAt: now + REPLY_MODALITY_TTL_MS,
    ...(runId ? { runId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
  };
  const target = registry();
  for (const key of keysFor(context)) target.set(key, record);
}

export function clearReplyModalityForTurn(context: ReplyTurnContext): void {
  const target = registry();
  for (const key of keysFor(context)) target.delete(key);
}

export function getReplyModalityForTurn(context: ReplyTurnContext): ReplyModality {
  const target = registry();
  for (const key of keysFor(context)) {
    const record = target.get(key);
    if (!record) continue;
    if (record.expiresAt <= Date.now()) {
      target.delete(key);
      continue;
    }
    return record.modality === 'voice' ? 'voice' : 'default';
  }
  return 'default';
}
