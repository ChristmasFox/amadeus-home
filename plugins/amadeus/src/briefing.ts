import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AmadeusConfig } from './config.js';
import { readOptionalFile } from './config.js';
import { requestJson, requestText } from './http.js';
import { ownerEvent, type OwnerNotifier } from './owner.js';

interface SourceSpec { id: string; name: string; type: string; url: string; topics: string[]; priority: number; enabled: boolean }
interface BriefingConfig {
  timezone: string;
  lookbackHours: { morning: number; evening: number };
  topics: Record<string, string>;
  keywords: Record<string, string[]>;
  topicWeights: Record<string, number>;
  minImportance?: number;
  minRelevance?: number;
  maxCandidateArticles: number;
  maxArticles: number;
  maxTopStories: number;
  llm: { model: string; temperature: number; maxTokens: number; timeoutMs: number };
  reportStyle: { maxSourceErrorsInReport: number; includeSourceLinks: boolean };
}
interface Article { articleId: string; sourceId: string; source: string; title: string; url: string; publishedAt: string; summary: string; topics: string[]; relevance: number; importance: number }
interface BriefingState { runs: Array<{ runKey: string; report: string; completedAt: string; edition: string }>; seen: Record<string, string> }

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return fallback; }
}

function tag(text: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'iu').exec(text);
  return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/giu, '$1').replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim() ?? '';
}

function link(text: string): string {
  const href = new RegExp(`<link\\s+[^>]*href=["']([^"']+)["'][^>]*/?>`, 'iu').exec(text)?.[1];
  return href?.trim() || tag(text, 'link') || tag(text, 'id');
}

function parseFeed(xml: string): Array<{ title: string; url: string; publishedAt: string; summary: string }> {
  const blocks = [...xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/giu)].map((match) => match[0]);
  return blocks.map((block) => ({
    title: tag(block, 'title'),
    url: link(block),
    publishedAt: tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'date'),
    summary: tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'),
  })).filter((item) => item.title && item.url);
}

function parseJsonFeed(value: unknown): Array<{ title: string; url: string; publishedAt: string; summary: string }> {
  const root = Array.isArray(value) ? value : asObject(value);
  const rows = Array.isArray(root) ? root : Array.isArray(root.items) ? root.items : Array.isArray(root.data) ? root.data : [];
  return rows.flatMap((row) => {
    const item = asObject(row);
    const title = String(item.title ?? item.name ?? '').trim();
    const url = String(item.html_url ?? item.url ?? item.link ?? '').trim();
    return title && url ? [{ title, url, publishedAt: String(item.published_at ?? item.publishedAt ?? item.created_at ?? item.updated_at ?? ''), summary: String(item.body ?? item.summary ?? item.description ?? '') }] : [];
  });
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 24); }

function scoreArticle(raw: { title: string; url: string; publishedAt: string; summary: string }, source: SourceSpec, config: BriefingConfig, nowMs: number, lookbackHours: number): Article | undefined {
  const parsed = Date.parse(raw.publishedAt);
  if (Number.isFinite(parsed) && parsed < nowMs - lookbackHours * 3_600_000) return undefined;
  const haystack = `${raw.title} ${raw.summary}`.toLowerCase();
  const topics = source.topics.filter((topic) => (config.keywords[topic] ?? []).some((keyword) => haystack.includes(keyword.toLowerCase())));
  if (!topics.length && source.topics.length) return undefined;
  const relevance = Math.min(10, 3 + topics.reduce((sum, topic) => sum + (config.topicWeights[topic] ?? 1), 0));
  const importance = Math.min(10, 2 + source.priority / 2 + (raw.title.length > 24 ? 1 : 0));
  return { articleId: `${source.id}:${hash(raw.url || raw.title)}`, sourceId: source.id, source: source.name, title: raw.title.slice(0, 320), url: raw.url.slice(0, 1000), publishedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(nowMs).toISOString(), summary: raw.summary.slice(0, 1800), topics, relevance, importance };
}

function fallbackReport(edition: 'morning' | 'evening', articles: Article[], sourceErrors: string[]): string {
  const title = edition === 'morning' ? '☀️ 科技情报早报' : '🌙 科技情报晚报';
  const lines = [title, '', articles.length ? '🔥 今日重点' : '今日暂无达到质量阈值的高价值资讯。'];
  for (const article of articles.slice(0, 12)) lines.push(`- ${article.title}\n  来源：${article.url}`);
  if (sourceErrors.length) lines.push('', `覆盖提醒：${sourceErrors.slice(0, 5).join('；')}`);
  return lines.join('\n');
}

async function reportWithModel(config: AmadeusConfig, briefing: BriefingConfig, edition: 'morning' | 'evening', articles: Article[], sourceErrors: string[], signal?: AbortSignal): Promise<string> {
  const apiKey = await readOptionalFile(config.nineRouterApiKeyFile) ?? process.env.OPENCLAW_9ROUTER_API_KEY?.trim();
  const instruction = edition === 'morning'
    ? '生成简体中文科技情报早报，阅读时间 3 到 5 分钟，结构为今日重点、AI、前端/Web、芯片/硬件、Nasdaq/市场、日本、IT/Infrastructure、今天值得关注。没有内容的栏目省略。'
    : '生成简体中文科技情报晚报，阅读时间 3 到 5 分钟，结构为今天最重要的 3 件事、AI、前端/Web、芯片/硬件、Nasdaq/市场、日本、IT/Infrastructure、重要事件更新、明天值得关注。没有内容的栏目省略。';
  const prompt = `${instruction}\n只依据输入文章，不编造事实、数字、时间或因果；事实和分析分开；每条保留来源链接；没有可靠市场数据时不要推断涨跌原因。来源错误仅用于提示覆盖范围。只输出正文。\n\n${JSON.stringify({ articles, sourceErrors }, null, 2)}`;
  try {
    const response = await requestJson(`${config.nineRouterBaseUrl}/chat/completions`, {
      method: 'POST',
      ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
      body: { model: briefing.llm.model, temperature: briefing.llm.temperature, max_tokens: briefing.llm.maxTokens, stream: false, messages: [{ role: 'system', content: '你是严格依据来源工作的科技与市场简报编辑。' }, { role: 'user', content: prompt }] },
      timeoutMs: briefing.llm.timeoutMs,
      ...(signal ? { signal } : {}),
    });
    const body = asObject(response);
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const first = asObject(choices[0]);
    const message = asObject(first.message);
    const text = String(message.content ?? first.text ?? '').replace(/^```(?:markdown|text)?/iu, '').replace(/```$/u, '').trim();
    if (text) return text.slice(0, 16_000);
  } catch { /* deterministic fallback below */ }
  return fallbackReport(edition, articles, sourceErrors);
}

export async function runBriefing(config: AmadeusConfig, inputEdition: 'auto' | 'morning' | 'evening', deliver: boolean, contextOwner: boolean, notifier: OwnerNotifier, signal?: AbortSignal): Promise<unknown> {
  const [briefing, sources] = await Promise.all([
    loadJson<BriefingConfig>(join(config.briefingConfigDir, 'digest.json'), {
      timezone: 'Asia/Shanghai', lookbackHours: { morning: 18, evening: 14 }, topics: {}, keywords: {}, topicWeights: {}, maxCandidateArticles: 60, maxArticles: 24, maxTopStories: 3, llm: { model: 'cx/gpt-5.6-luna', temperature: 0.1, maxTokens: 2600, timeoutMs: 120_000 }, reportStyle: { maxSourceErrorsInReport: 5, includeSourceLinks: true },
    }),
    loadJson<SourceSpec[]>(join(config.briefingConfigDir, 'sources.json'), []),
  ]);
  const now = new Date();
  const localHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: briefing.timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const edition: 'morning' | 'evening' = inputEdition === 'auto' ? (localHour < 16 ? 'morning' : 'evening') : inputEdition;
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: briefing.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const runKey = `${localDate}:${edition}`;
  const state = await loadJson<BriefingState>(config.briefingStateFile, { runs: [], seen: {} });
  const existing = state.runs.find((run) => run.runKey === runKey);
  if (existing) return { edition, runKey, report: existing.report, skipped: true, reason: 'already-completed' };
  const enabled = sources.filter((source) => source.enabled && source.url);
  const sourceErrors: string[] = [];
  const articles: Article[] = [];
  await Promise.all(enabled.map(async (source) => {
    try {
      const raw = source.type === 'json_api' || source.type === 'market_api'
      ? parseJsonFeed(await requestJson(source.url, { headers: { 'User-Agent': 'amadeus-openclaw-briefing/1.0' }, timeoutMs: 20_000, ...(signal ? { signal } : {}) }))
        : parseFeed(await requestText(source.url, { timeoutMs: 20_000, ...(signal ? { signal } : {}) }));
      for (const item of raw) {
        const article = scoreArticle(item, source, briefing, now.getTime(), briefing.lookbackHours[edition]);
        if (article && !state.seen[article.articleId]) articles.push(article);
      }
    } catch (error) {
      sourceErrors.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 220));
    }
  }));
  const candidates = articles
    .filter((article) => article.importance >= (briefing.minImportance ?? 0) && article.relevance >= (briefing.minRelevance ?? 0))
    .sort((a, b) => (b.importance + b.relevance) - (a.importance + a.relevance))
    .slice(0, briefing.maxCandidateArticles || 60);
  const selected = candidates.slice(0, briefing.maxArticles || 24);
  const report = await reportWithModel(config, briefing, edition, selected, sourceErrors, signal);
  const completedAt = new Date().toISOString();
  const next: BriefingState = {
    runs: [{ runKey, report, completedAt, edition }, ...state.runs].slice(0, 60),
    seen: Object.fromEntries(Object.entries({ ...state.seen, ...Object.fromEntries(selected.map((article) => [article.articleId, completedAt])) }).filter(([, value]) => Date.parse(value) > now.getTime() - 60 * 86_400_000)),
  };
  await mkdir(dirname(config.briefingStateFile), { recursive: true, mode: 0o700 });
  await writeFile(config.briefingStateFile, `${JSON.stringify(next)}\n`, { encoding: 'utf8', mode: 0o600 });
  let notification: unknown;
  if (deliver) {
    if (!contextOwner) throw new Error('briefing delivery requires owner identity when requested interactively');
    notification = await notifier.notify(ownerEvent({ eventKey: `briefing:${runKey}`, source: 'briefing', title: edition === 'morning' ? '科技情报早报' : '科技情报晚报', message: report }));
  }
  return { edition, runKey, report, candidateCount: articles.length, selectedCount: selected.length, sourceErrors, ...(notification === undefined ? {} : { notification }) };
}
