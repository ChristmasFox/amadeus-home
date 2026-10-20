import {
  clearedCookie,
  clientKey,
  login,
  LOGIN_PAGE,
  loginCookie,
  logout,
  MAX_LOGIN_BYTES,
  type PublicAccess,
  validSession,
} from './public-access.js';
import { type Snapshot } from './snapshot.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.map': 'application/json',
};
export const CLIENT_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/client');

export function publicHeaders(contentType: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'strict-transport-security': 'max-age=31536000',
    'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ...extra,
  };
}

export function sendPublic(response: ServerResponse, status: number, body: Buffer | string, contentType: string, extra: Record<string, string> = {}): void {
  const payload = typeof body === 'string' ? Buffer.from(body) : body;
  response.writeHead(status, publicHeaders(contentType, { 'content-length': String(payload.length), ...extra }));
  response.end(payload);
}

export function sendPublicJson(response: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void {
  sendPublic(response, status, JSON.stringify(value), 'application/json; charset=utf-8', extra);
}

/** Serves the built client for an authenticated public visitor; the Vite dev server is never exposed publicly. */
export function servePublicStatic(response: ServerResponse, pathname: string): void {
  const requested = pathname === '/' || pathname === '/index.html' ? '/index.html' : pathname;
  const target = resolve(CLIENT_DIST, `.${requested}`);
  const inside = target === CLIENT_DIST || target.startsWith(`${CLIENT_DIST}/`);
  const isAsset = requested.startsWith('/assets/');
  let file = inside && existsSync(target) && statSync(target).isFile() ? target : null;
  // Unknown paths fall back to the single-page app shell, but a missing asset is a plain 404.
  if (!file && !isAsset && !requested.startsWith('/api/')) file = resolve(CLIENT_DIST, 'index.html');
  if (!file || !existsSync(file)) { sendPublicJson(response, 404, { error: 'not_found' }); return; }
  const extension = file.slice(file.lastIndexOf('.'));
  // Vite names every built asset by its content hash, so a browser (and the CDN) may keep it for good; the page
  // shell itself stays no-store and points at the current names.
  const cache = isAsset && /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/u.test(requested) ? { 'cache-control': 'public, max-age=31536000, immutable' } : {};
  sendPublic(response, 200, readFileSync(file), PUBLIC_CONTENT_TYPES[extension] ?? 'application/octet-stream', cache);
}

export async function readLimitedBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** The authenticated API, injected so this module does not depend on the server that wires it in. */
export type ApiHandler = (request: IncomingMessage, response: ServerResponse, snapshot: Snapshot) => Promise<void>;

export async function handlePublic(request: IncomingMessage, response: ServerResponse, snapshot: Snapshot, access: PublicAccess, api: ApiHandler): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const method = request.method ?? 'GET';
  const sameOrigin = request.headers.origin === access.origin;
  if (method === 'POST' && url.pathname === '/api/login') {
    if (!sameOrigin) { sendPublicJson(response, 403, { error: 'same_origin_required' }); return; }
    if (!/^application\/json\b/iu.test(request.headers['content-type'] ?? '')) { sendPublicJson(response, 404, { error: 'not_found' }); return; }
    const body = await readLimitedBody(request, MAX_LOGIN_BYTES);
    if (!body) { sendPublicJson(response, 413, { error: 'login_payload_too_large' }); return; }
    let password: unknown;
    try {
      const payload: unknown = JSON.parse(body.toString('utf8'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).join() !== 'password') throw new Error('shape');
      password = (payload as { password: unknown }).password;
    } catch { sendPublicJson(response, 400, { error: 'login_payload_invalid' }); return; }
    const result = await login(access, clientKey(request), password);
    if ('retryAfter' in result) { sendPublicJson(response, 429, { error: 'login_rate_limited' }, { 'retry-after': String(result.retryAfter) }); return; }
    if ('failed' in result) { sendPublicJson(response, 401, { error: 'login_failed' }); return; }
    response.writeHead(204, publicHeaders('application/json', { 'set-cookie': loginCookie(result.token) }));
    response.end();
    return;
  }
  if (!validSession(access, request)) {
    if (method === 'GET' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/assets/')) { sendPublic(response, 200, LOGIN_PAGE, 'text/html; charset=utf-8'); return; }
    sendPublicJson(response, 401, { error: 'login_required' });
    return;
  }
  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin) { sendPublicJson(response, 403, { error: 'same_origin_required' }); return; }
  if (method === 'POST' && url.pathname === '/api/logout') {
    logout(access, request);
    response.writeHead(204, publicHeaders('application/json', { 'set-cookie': clearedCookie }));
    response.end();
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    await api(request, response, snapshot);
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') { sendPublicJson(response, 405, { error: 'method_not_allowed' }); return; }
  servePublicStatic(response, url.pathname);
}