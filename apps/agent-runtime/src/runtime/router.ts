import type { SessionContextRecord } from '../data/model.js';

export interface DomainRouteResult {
  domain: 'pubg' | 'homehub' | 'unknown';
  route: 'mandatory' | 'pass';
  reason: string;
  contextActive: boolean;
}

const EXPLICIT_PUBG_SIGNAL = /PUBG|绝地求生|吃鸡|战绩|KD|K\/D|击杀|杀人|人头|伤害|助攻|倒地|击倒|救援|扶人|复盘|分析这把|这把|上一把|下一把|火箭筒|开车|吃鸡|排名|名次|场均|几把|多少场|最近\s*\d+\s*(?:场|把|局)|最近\s*\d+\s*天|上周|前天|昨天|昨日|昨晚|今天|今日|谁最强|谁最菜|谁最拉|拉完了|发挥最好|状态最好|表现最好|整活|离谱|内鬼|打队友|撞人|闪光弹|拳击|队伤|队友伤害|乘车|旅游团|有什么节目/u;
const FOLLOW_UP_SIGNAL = /^(?:昨天|昨日|前天|大前天|今天|今日|昨晚|刚才|那|这|其中|他|他们|上一场|那场|哪一把|哪把|谁|跟|和|比较|对比|怎么样|如何|呢|多少|几把|最强|最菜|最拉|拉完了|整活|离谱|内鬼|打队友|撞人|闪光弹|拳击|队伤|队友伤害|乘车|旅游团|节目|(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号)?|\d{4}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,2}|晚上|昨天晚上).{0,48}$/u;
const MATCH_SELECTION_INPUT = /^(?:\d{1,3}|[①②③④⑤⑥⑦⑧⑨⑩]|第\s*(?:\d{1,3}|[一二两三四五六七八九十]+)\s*(?:场|把|局)?)$/u;

// HomeHub signals. Use service/infrastructure words so generic queries like
// "帮我查天气" are not captured. PUBG queries stay on the PUBG router.
const HOMEHUB_STATUS_SIGNAL = /(?:服务器|主机|系统|服务状态|哪些服务|服务挂了|服务状态|整体状态|家里服务器|服务器怎么样|内存还剩|磁盘还剩|最吃内存|用了多少|cpu|内存|磁盘|健康状态|emby正常|n8n.*打不开|打不开)/i;
const HOMEHUB_SERVICE_REFERENCE = /(?:langbot|telegram|tg|电报|kook|pubg|mastra|n8n|postgres|redis|emby|jellyfin|qbittorrent|qbit|aria2|glances|cloudflare|tunnel|cloudflared)/i;
const HOMEHUB_ACTION_SIGNAL = /(?:重启|启动|停止|restart|start|stop|fix|修复|恢复|重新启动)/i;
const HOMEHUB_DIAGNOSIS_SIGNAL = /(?:为什么|怎么|故障|诊断|异常|出问题|挂了吗|挂了|不回复|不响应|不回|打不开|连不上|diagnose|troubleshoot)/i;
const HOMEHUB_HISTORY_SIGNAL = /(?:日志|历史记录|操作记录|最近操作|audit)/i;
const HOMEHUB_MEDIA_SIGNAL = /(?:整理|刮削|改名|下载好了|下载目录|emby.*识别|媒体整理)/i;

function hasValidPendingSelection(context: SessionContextRecord | null): boolean {
  const pending = context?.references?.pendingMatchSelection;
  if (!pending || typeof pending !== 'object') return false;
  const expiresAt = (pending as Record<string, unknown>).expiresAt;
  const expires = Date.parse(String(expiresAt ?? ''));
  return Number.isFinite(expires) && expires > Date.now();
}

function isServiceMention(text: string): boolean {
  return HOMEHUB_SERVICE_REFERENCE.test(text);
}

function hasValidHomeHubContext(context: SessionContextRecord | null): boolean {
  return context?.activeDomain === 'homehub';
}

function homeHubActionRequest(text: string): boolean {
  return HOMEHUB_ACTION_SIGNAL.test(text) && (isServiceMention(text) || hasShortActionContext(text));
}

function homeHubDiagnosisRequest(text: string): boolean {
  return HOMEHUB_DIAGNOSIS_SIGNAL.test(text) && isServiceMention(text);
}

function homeHubStatusRequest(text: string): boolean {
  // e.g. "家里服务器怎么样", "哪些服务挂了", "Emby 正常吗"
  if (HOMEHUB_STATUS_SIGNAL.test(text)) return true;
  return isServiceMention(text) && /(?:正常吗|怎么了|怎么样|状态|情况|还好吗)/.test(text);
}

function hasShortActionContext(text: string): boolean {
  // "重启它" / "再看一下日志" style should only route to HomeHub when
  // context is already homehub (handled separately) or action word precedes
  // a homehub term.
  return HOMEHUB_ACTION_SIGNAL.test(text);
}

export function classifyPubgRequest(text: string, context: SessionContextRecord | null): DomainRouteResult {
  const normalized = String(text ?? '').trim();
  const contextActive = context?.activeDomain === 'pubg';
  const homehubContextActive = hasValidHomeHubContext(context);
  const routeResult = (reason: string, isContextActive: boolean): DomainRouteResult => ({
    domain: 'homehub', route: 'mandatory', reason, contextActive: isContextActive,
  });

  // 1. Explicit service-level actions and diagnosis
  if (homeHubActionRequest(normalized) && isServiceMention(normalized)) {
    return routeResult('homehub_action', homehubContextActive);
  }
  if (homeHubDiagnosisRequest(normalized)) {
    return routeResult('homehub_diagnosis', homehubContextActive);
  }
  if (homeHubStatusRequest(normalized)) {
    return routeResult('homehub_status', homehubContextActive);
  }
  if (HOMEHUB_MEDIA_SIGNAL.test(normalized)) {
    return routeResult('homehub_media', homehubContextActive);
  }
  if (HOMEHUB_HISTORY_SIGNAL.test(normalized) && isServiceMention(normalized)) {
    return routeResult('homehub_history', homehubContextActive);
  }

  // 2. HomeHub follow-up while a homehub session is active
  if (homehubContextActive && /^(?:重启|启动|停止|确认|取消|是|好|行|可以|算了|那|它|刚才|上次|再|重新|检查|看)/i.test(normalized)) {
    return routeResult('homehub_follow_up', true);
  }

  // 3. PUBG routing unchanged
  if (EXPLICIT_PUBG_SIGNAL.test(normalized)) {
    return { domain: 'pubg', route: 'mandatory', reason: 'explicit_pubg_signal', contextActive };
  }
  if (hasValidPendingSelection(context) && MATCH_SELECTION_INPUT.test(normalized)) {
    return { domain: 'pubg', route: 'mandatory', reason: 'pending_match_selection', contextActive };
  }
  if (contextActive && FOLLOW_UP_SIGNAL.test(normalized)) {
    return { domain: 'pubg', route: 'mandatory', reason: 'active_pubg_follow_up', contextActive };
  }
  return { domain: 'unknown', route: 'pass', reason: 'no_domain_signal', contextActive };
}

export function classifyRequest(text: string, context: SessionContextRecord | null): DomainRouteResult {
  return classifyPubgRequest(text, context);
}
