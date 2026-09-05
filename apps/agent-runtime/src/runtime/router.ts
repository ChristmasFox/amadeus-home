import type { SessionContextRecord } from '../data/model.js';

export interface DomainRouteResult {
  domain: 'pubg' | 'unknown';
  route: 'mandatory' | 'pass';
  reason: 'explicit_pubg_signal' | 'active_pubg_follow_up' | 'pending_match_selection' | 'no_pubg_signal';
  contextActive: boolean;
}

const EXPLICIT_PUBG_SIGNAL = /PUBG|绝地求生|吃鸡|战绩|KD|K\/D|击杀|杀人|人头|伤害|助攻|倒地|击倒|救援|扶人|复盘|分析这把|这把|上一把|下一把|火箭筒|开车|吃鸡|排名|名次|场均|几把|多少场|最近\s*\d+\s*(?:场|把|局)|最近\s*\d+\s*天|上周|前天|昨天|昨日|昨晚|今天|今日|谁最强|谁最菜|谁最拉|拉完了|发挥最好|状态最好|表现最好|整活|离谱|内鬼|打队友|撞人|闪光弹|拳击|队伤|队友伤害|乘车|旅游团|有什么节目/u;
const FOLLOW_UP_SIGNAL = /^(?:昨天|昨日|前天|大前天|今天|今日|昨晚|刚才|那|这|其中|他|他们|上一场|那场|哪一把|哪把|谁|跟|和|比较|对比|怎么样|如何|呢|多少|几把|最强|最菜|最拉|拉完了|整活|离谱|内鬼|打队友|撞人|闪光弹|拳击|队伤|队友伤害|乘车|旅游团|节目|(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号)?|\d{4}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,2}|晚上|昨天晚上).{0,48}$/u;
const MATCH_SELECTION_INPUT = /^(?:\d{1,3}|[①②③④⑤⑥⑦⑧⑨⑩]|第\s*(?:\d{1,3}|[一二两三四五六七八九十]+)\s*(?:场|把|局)?)$/u;

function hasValidPendingSelection(context: SessionContextRecord | null): boolean {
  const pending = context?.references?.pendingMatchSelection;
  if (!pending || typeof pending !== 'object') return false;
  const expiresAt = (pending as Record<string, unknown>).expiresAt;
  const expires = Date.parse(String(expiresAt ?? ''));
  return Number.isFinite(expires) && expires > Date.now();
}

export function classifyPubgRequest(text: string, context: SessionContextRecord | null): DomainRouteResult {
  const normalized = String(text ?? '').trim();
  const contextActive = context?.activeDomain === 'pubg';
  if (EXPLICIT_PUBG_SIGNAL.test(normalized)) {
    return { domain: 'pubg', route: 'mandatory', reason: 'explicit_pubg_signal', contextActive };
  }
  if (hasValidPendingSelection(context) && MATCH_SELECTION_INPUT.test(normalized)) {
    return { domain: 'pubg', route: 'mandatory', reason: 'pending_match_selection', contextActive };
  }
  if (contextActive && FOLLOW_UP_SIGNAL.test(normalized)) {
    return { domain: 'pubg', route: 'mandatory', reason: 'active_pubg_follow_up', contextActive };
  }
  return { domain: 'unknown', route: 'pass', reason: 'no_pubg_signal', contextActive };
}
