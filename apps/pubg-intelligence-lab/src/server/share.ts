import {
  REVIEW_SHARE_TOKEN,
  reviewShareOpen,
  reviewShareTokenHash,
  type NormalizedMatch,
  type ReviewShareRecord,
} from '@agent/pubg-domain';
import { mapDisplayName, type ResearchSquad } from '@agent/pubg-intelligence';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { computeMatchStory } from './match-views.js';
import { clientKey } from './public-access.js';
import { CLIENT_DIST, sendPublic, sendPublicJson } from './public-site.js';
import { requestSnapshotSync } from './refresh.js';
import { type Snapshot } from './snapshot.js';

/**
 * Review share links (`/s/<token>`): one link opens one delivered review and the matches in it, without the
 * password. A share visitor gets a separate cookie that only the whitelisted share routes accept; it never reaches
 * the rest of the API and can never become a full session.
 */
export const SHARE_COOKIE = 'amadeus_intelligence_lab_share';
export const SHARE_LINK_WINDOW_MS = 60_000;
export const SHARE_LINK_MAX_PER_WINDOW = 30;
/** How long an unknown link waits for a snapshot refresh before it is declared invalid (polled every few seconds). */
export const SHARE_SYNC_POLLS = 24;
const SHARE_SYNC_POLL_SECONDS = 5;

interface Revocations { disabled: boolean; tokenHashes: Set<string>; sessionKeys: Set<string> }
let revocationCache: { mtimeMs: number; value: Revocations } | null = null;

/** Owner-side kill switch that works at once, before the Lab revocation reaches the next snapshot. */
function revocations(): Revocations {
  const file = join(process.env.PUBG_INTELLIGENCE_STATE_DIR?.trim() || join(homedir(), '.local', 'share', 'amadeus', 'pubg-intelligence-lab'), 'share-revoked.json');
  const empty: Revocations = { disabled: false, tokenHashes: new Set(), sessionKeys: new Set() };
  let mtimeMs: number;
  try { mtimeMs = statSync(file).mtimeMs; } catch { return empty; }
  if (revocationCache?.mtimeMs === mtimeMs) return revocationCache.value;
  let value = empty;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const strings = (input: unknown) => new Set(Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : []);
    value = { disabled: raw.disabled === true, tokenHashes: strings(raw.tokenHashes), sessionKeys: strings(raw.sessionKeys) };
  } catch {
    // An unreadable revocation file must not open anything: treat it as "all shares off".
    value = { ...empty, disabled: true };
  }
  revocationCache = { mtimeMs, value };
  return value;
}

export function resolveShare(snapshot: Snapshot, token: string | null | undefined, now = new Date()): ReviewShareRecord | null {
  if (!token || !REVIEW_SHARE_TOKEN.test(token)) return null;
  const record = snapshot.shares.get(reviewShareTokenHash(token));
  if (!record || !reviewShareOpen(record, now)) return null;
  const revoked = revocations();
  if (revoked.disabled || revoked.tokenHashes.has(record.tokenHash) || revoked.sessionKeys.has(record.sessionKey)) return null;
  return record;
}

function cookieToken(request: IncomingMessage): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SHARE_COOKIE) return value.join('=');
  }
  return null;
}

export function shareFromCookie(snapshot: Snapshot, request: IncomingMessage, now = new Date()): ReviewShareRecord | null {
  return resolveShare(snapshot, cookieToken(request), now);
}

export function shareCookie(token: string, record: ReviewShareRecord, secure: boolean, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((Date.parse(record.expiresAt) - now) / 1000));
  return `${SHARE_COOKIE}=${token}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

const linkAttempts = new Map<string, number[]>();
function linkRateLimited(request: IncomingMessage, now: number): boolean {
  const key = clientKey(request);
  const recent = (linkAttempts.get(key) ?? []).filter((at) => now - at < SHARE_LINK_WINDOW_MS);
  recent.push(now);
  linkAttempts.set(key, recent);
  if (linkAttempts.size > 5000) linkAttempts.clear();
  return recent.length > SHARE_LINK_MAX_PER_WINDOW;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function shareTitle(record: ReviewShareRecord): { title: string; description: string } {
  try {
    if (record.kind === 'query') {
      const query = JSON.parse(record.presentationJson) as { title?: string; displayText?: string };
      const lines = (query.displayText ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
      return { title: `${query.title ?? 'PUBG 战绩'} · ${record.matchIds.length} 场`, description: lines[1] ?? 'PUBG 战绩查询' };
    }
    const review = JSON.parse(record.presentationJson) as { startAt?: string; matchCount?: number; headline?: string; timezone?: string };
    const date = review.startAt ? new Intl.DateTimeFormat('zh-CN', { timeZone: review.timezone ?? 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).format(new Date(review.startAt)) : '';
    const title = record.kind === 'match' ? `单局复盘 · ${date}` : `时段复盘 · ${date} · ${review.matchCount ?? record.matchIds.length} 场排位`;
    return { title, description: review.headline ?? 'PUBG 小队复盘' };
  } catch {
    return { title: 'PUBG 小队复盘', description: 'PUBG 小队复盘' };
  }
}

function messagePage(title: string, body: string, refresh?: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">${refresh ? `<meta http-equiv="refresh" content="${escapeHtml(refresh)}">` : ''}<title>${escapeHtml(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1112;color:#dce6e2;font:15px/1.6 system-ui,sans-serif;padding:24px;box-sizing:border-box}main{max-width:360px;text-align:center}h1{font-size:19px;margin:0 0 8px}p{color:#93a39e;margin:0}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>`;
}

const NO_INDEX = { 'x-robots-tag': 'noindex, nofollow' };

/** GET /s/<token>: checks the link, sets the share cookie and serves the page shell (the client then drops the token from the address bar). */
export function handleShareLink(request: IncomingMessage, response: ServerResponse, snapshot: Snapshot, options: { secure: boolean; now?: Date }): void {
  const now = options.now ?? new Date();
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const token = url.pathname.slice('/s/'.length);
  if ((request.method !== 'GET' && request.method !== 'HEAD') || linkRateLimited(request, now.getTime())) {
    sendPublic(response, 429, messagePage('请稍后再试', '打开得太频繁了。'), 'text/html; charset=utf-8', NO_INDEX);
    return;
  }
  const record = resolveShare(snapshot, token, now);
  if (!record) {
    // A link minted minutes ago may not be in the hourly snapshot yet: refresh it and wait, then give up plainly.
    // Known-but-closed links and malformed ones get the same answer, so the page reveals nothing about tokens.
    const polls = Number(url.searchParams.get('w') ?? '0');
    const knownClosed = REVIEW_SHARE_TOKEN.test(token) && snapshot.shares.has(reviewShareTokenHash(token));
    if (REVIEW_SHARE_TOKEN.test(token) && !knownClosed && Number.isInteger(polls) && polls >= 0 && polls < SHARE_SYNC_POLLS) {
      requestSnapshotSync();
      const next = `${SHARE_SYNC_POLL_SECONDS}; url=/s/${token}?w=${polls + 1}`;
      sendPublic(response, 200, messagePage('正在同步这次复盘…', '复盘刚刚生成,数据还在路上,页面会自动刷新。', next), 'text/html; charset=utf-8', NO_INDEX);
      return;
    }
    sendPublic(response, 404, messagePage('链接无效或已过期', '分享链接 7 天内有效。需要的话请让队友重新发一份。'), 'text/html; charset=utf-8', NO_INDEX);
    return;
  }
  const cookie = shareCookie(token, record, options.secure, now.getTime());
  const shell = resolve(CLIENT_DIST, 'index.html');
  if (!options.secure || !existsSync(shell)) {
    // On the LAN the Vite development server owns the page and its assets; it serves /share itself.
    response.writeHead(302, { location: '/share', 'set-cookie': cookie, 'cache-control': 'no-store', ...NO_INDEX });
    response.end();
    return;
  }
  const { title, description } = shareTitle(record);
  const head = `<meta name="robots" content="noindex,nofollow"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="website">`;
  const html = readFileSync(shell, 'utf8').replace(/<title>[^<]*<\/title>/u, `<title>${escapeHtml(title)}</title>${head}`);
  sendPublic(response, 200, html, 'text/html; charset=utf-8', { 'set-cookie': cookie, ...NO_INDEX });
}

/** The research squad that played a match: the one with the most of its members in it. */
function squadFor(snapshot: Snapshot, match: NormalizedMatch): ResearchSquad {
  const present = new Set(match.players.map((player) => player.accountId));
  return [...snapshot.squads].sort((left, right) => right.memberIds.filter((id) => present.has(id)).length - left.memberIds.filter((id) => present.has(id)).length)[0] ?? snapshot.defaultSquad;
}

interface AliasableStory {
  fights: Array<{ start: number; enemies: Array<{ team: string }> }>;
  downs: Array<{ t: number; attackerTeam: string | null }>;
  enemies: Array<{ id: string; team: string; route: Array<[number, number, number]> }>;
}

/** Opposing teams become 敌方 A, B, … in the order the squad met them; opposing account ids become opaque. */
export function aliasEnemies<T extends AliasableStory>(story: T): T {
  const order: string[] = [];
  const see = (team: string | null) => { if (team !== null && !order.includes(team)) order.push(team); };
  for (const fight of [...story.fights].sort((left, right) => left.start - right.start)) for (const enemy of fight.enemies) see(enemy.team);
  for (const down of [...story.downs].sort((left, right) => left.t - right.t)) see(down.attackerTeam);
  for (const enemy of [...story.enemies].sort((left, right) => (left.route[0]?.[0] ?? 0) - (right.route[0]?.[0] ?? 0))) see(enemy.team);
  const label = (team: string) => {
    const index = order.indexOf(team);
    return `敌方 ${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) + 1 : ''}`;
  };
  return {
    ...story,
    fights: story.fights.map((fight) => ({ ...fight, enemies: fight.enemies.map((enemy) => ({ ...enemy, team: label(enemy.team) })) })),
    downs: story.downs.map((down) => ({ ...down, attackerTeam: down.attackerTeam === null ? null : label(down.attackerTeam) })),
    enemies: story.enemies.map((enemy, index) => ({ ...enemy, id: `enemy-${index + 1}`, team: label(enemy.team) })),
  };
}

function teamLine(match: NormalizedMatch, squad: ResearchSquad) {
  const members = match.players.filter((player) => squad.memberIds.includes(player.accountId));
  return {
    placement: members[0]?.rank ?? null,
    kills: members.reduce((sum, player) => sum + player.kills, 0),
    knocks: members.reduce((sum, player) => sum + player.dbnos, 0),
    damage: Math.round(members.reduce((sum, player) => sum + player.damage, 0)),
  };
}

/** The share API: the review as delivered, its matches, and each of those matches' story. Nothing else. */
export async function serveShareApi(request: IncomingMessage, response: ServerResponse, snapshot: Snapshot, share: ReviewShareRecord): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method !== 'GET' && request.method !== 'HEAD') { sendPublicJson(response, 405, { error: 'method_not_allowed' }); return; }
  if (url.pathname === '/api/share/view') {
    sendPublicJson(response, 200, {
      kind: share.kind,
      expiresAt: share.expiresAt,
      review: JSON.parse(share.presentationJson) as unknown,
      matches: share.matchIds.map((matchId) => {
        const match = snapshot.byId.get(matchId);
        if (!match) return { matchId, available: false };
        return { matchId, available: true, createdAt: match.createdAt, mapName: match.mapName, mapLabel: mapDisplayName(match.mapName || '未知地图'), durationSeconds: match.duration, ...teamLine(match, squadFor(snapshot, match)) };
      }),
    }, NO_INDEX);
    return;
  }
  const storyRoute = url.pathname.match(/^\/api\/share\/matches\/([^/]+)\/story$/u);
  if (storyRoute) {
    const matchId = decodeURIComponent(storyRoute[1]!);
    const match = share.matchIds.includes(matchId) ? snapshot.byId.get(matchId) : undefined;
    if (!match) { sendPublicJson(response, 404, { error: 'not_in_share' }, NO_INDEX); return; }
    const story = await computeMatchStory(snapshot, squadFor(snapshot, match), match);
    sendPublicJson(response, 200, { ...story, story: story.story ? aliasEnemies(story.story as unknown as AliasableStory) : null }, NO_INDEX);
    return;
  }
  sendPublicJson(response, 404, { error: 'not_found' }, NO_INDEX);
}

const MAP_IMAGE = /^\/api\/maps\/[A-Za-z0-9]+_Main$/u;

/**
 * Routes a request that carries only a share cookie. Returns false for page paths it does not own (the caller shows
 * the login page there); every API path outside the share whitelist is refused here.
 */
export async function handleShareVisitor(
  request: IncomingMessage,
  response: ServerResponse,
  snapshot: Snapshot,
  share: ReviewShareRecord,
  serveStatic: (pathname: string) => void,
  api: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const read = request.method === 'GET' || request.method === 'HEAD';
  if (url.pathname.startsWith('/api/share/')) { await serveShareApi(request, response, snapshot, share); return true; }
  if (read && MAP_IMAGE.test(url.pathname)) { await api(request, response); return true; }
  // Logging in with the password must still work after someone opened a share link in the same browser.
  if (request.method === 'POST' && url.pathname === '/api/login') return false;
  if (url.pathname.startsWith('/api/')) { sendPublicJson(response, 403, { error: 'share_scope' }, NO_INDEX); return true; }
  if (read && (url.pathname === '/share' || url.pathname.startsWith('/assets/'))) { serveStatic(url.pathname === '/share' ? '/index.html' : url.pathname); return true; }
  return false;
}
