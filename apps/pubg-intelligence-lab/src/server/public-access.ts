import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';

/**
 * Optional password-only access for a public hostname. The page itself stays LAN-only; a request is "public" only when
 * its Host header is the operator-configured hostname, and then every route except the login page needs a session.
 * The verifier is the same salted scrypt format the Image Lab uses, kept outside Git in a mode-0600 file, so one
 * password opens both and no plaintext is ever stored here.
 */
export const PUBLIC_SESSION_COOKIE = 'amadeus_intelligence_lab_session';
export const PUBLIC_SESSION_SECONDS = 12 * 60 * 60;
export const LOGIN_WINDOW_SECONDS = 60;
export const LOGIN_MAX_ATTEMPTS = 5;
/** Ceiling across all clients, so a distributed guesser cannot pin the CPU on scrypt. */
export const LOGIN_GLOBAL_MAX_ATTEMPTS = 40;
export const MAX_LOGIN_BYTES = 8 * 1024;
const VERIFIER_FORMAT = 'amadeus-qwen-image-lab-scrypt-v1';
const SCRYPT_PARAMS = { n: 32768, r: 8, p: 1, dklen: 64 } as const;

export interface PasswordVerifier {
  salt: Buffer;
  digest: Buffer;
}

export interface PublicAccess {
  host: string;
  origin: string;
  verifier: PasswordVerifier;
  /**
   * Sessions are signed tokens (`id.expiry.signature`), not server memory, so a restart (the page restarts whenever
   * the data refreshes) does not log anyone out. The signing key is derived from a persistent secret and the password
   * verifier, so changing the password invalidates every session. Logged-out tokens are remembered in `revoked`.
   */
  key: Buffer;
  revoked: Map<string, number>;
  revokedFile: string;
  attempts: Map<string, number[]>;
  globalAttempts: number[];
}

function assertPrivateFile(path: string, error: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error(error);
}

export function loadPasswordVerifier(path: string): PasswordVerifier {
  assertPrivateFile(path, 'public_auth_file_not_private');
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    data = parsed as Record<string, unknown>;
  } catch {
    throw new Error('public_auth_verifier_invalid');
  }
  const params = data.scrypt as Record<string, unknown> | undefined;
  if (data.format !== VERIFIER_FORMAT || typeof data.salt !== 'string' || typeof data.digest !== 'string'
    || !params || params.n !== SCRYPT_PARAMS.n || params.r !== SCRYPT_PARAMS.r || params.p !== SCRYPT_PARAMS.p || params.dklen !== SCRYPT_PARAMS.dklen) {
    throw new Error('public_auth_format_invalid');
  }
  const salt = Buffer.from(data.salt, 'base64');
  const digest = Buffer.from(data.digest, 'base64');
  if (salt.length < 16 || salt.length > 64 || digest.length !== SCRYPT_PARAMS.dklen) throw new Error('public_auth_verifier_invalid');
  return { salt, digest };
}

export function isPublicHostname(value: string): boolean {
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251})$/u.test(value)) return false;
  if (value === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)) return false;
  return value.includes('.');
}

function loadSessionSecret(stateDirectory: string): Buffer {
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const file = join(stateDirectory, 'session-secret');
  if (!existsSync(file)) {
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    try { renameSync(temporary, file); } catch { /* another process created it first */ }
  }
  assertPrivateFile(file, 'session_secret_not_private');
  const secret = readFileSync(file, 'utf8').trim();
  if (secret.length < 32) throw new Error('session_secret_invalid');
  return Buffer.from(secret, 'utf8');
}

function loadRevoked(file: string): Map<string, number> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const now = Date.now();
    return new Map(Object.entries(parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {}).filter(([, expires]) => typeof expires === 'number' && expires > now));
  } catch {
    return new Map();
  }
}

/** Builds the public scope from the environment; null (public disabled) unless both a host and a verifier are configured. */
export function loadPublicAccess(env: NodeJS.ProcessEnv, stateDirectory: string): PublicAccess | null {
  const host = env.PUBG_INTELLIGENCE_PUBLIC_HOST?.trim().toLowerCase();
  const authFile = env.PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE?.trim();
  if (!host && !authFile) return null;
  if (!host || !authFile) throw new Error('public_access_needs_host_and_auth_file');
  if (!isPublicHostname(host)) throw new Error('public_host_invalid');
  const verifier = loadPasswordVerifier(authFile);
  const revokedFile = join(stateDirectory, 'session-revoked.json');
  return {
    host,
    origin: `https://${host}`,
    verifier,
    key: createHmac('sha256', loadSessionSecret(stateDirectory)).update(verifier.digest).digest(),
    revoked: loadRevoked(revokedFile),
    revokedFile,
    attempts: new Map(),
    globalAttempts: [],
  };
}

export function hostOf(request: IncomingMessage): string {
  return (request.headers.host ?? '').toLowerCase();
}

export function isPublicRequest(request: IncomingMessage, access: PublicAccess | null): boolean {
  return access !== null && hostOf(request) === access.host;
}

/** Traffic relayed by the public proxy carries these headers; it must never be served as a LAN request. */
export function looksProxied(request: IncomingMessage): boolean {
  return request.headers['x-forwarded-for'] !== undefined || request.headers['cf-connecting-ip'] !== undefined
    || request.headers['x-forwarded-host'] !== undefined;
}

/** The visitor behind the proxy chain when present (only trusted for rate limiting, never for access decisions). */
export function clientKey(request: IncomingMessage): string {
  const forwarded = request.headers['cf-connecting-ip'] ?? request.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first && first.length <= 64 ? first : (request.socket.remoteAddress ?? 'unknown');
}

function deriveDigest(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(Buffer.from(password, 'utf8'), salt, SCRYPT_PARAMS.dklen, { N: SCRYPT_PARAMS.n, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, maxmem: 128 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(derived));
  });
}

export type LoginResult = { token: string } | { retryAfter: number } | { failed: true };

export async function login(access: PublicAccess, client: string, password: unknown, now = Date.now()): Promise<LoginResult> {
  const windowMs = LOGIN_WINDOW_SECONDS * 1000;
  const recent = (access.attempts.get(client) ?? []).filter((stamp) => now - stamp < windowMs);
  access.globalAttempts = access.globalAttempts.filter((stamp) => now - stamp < windowMs);
  if (recent.length >= LOGIN_MAX_ATTEMPTS) return { retryAfter: Math.max(1, Math.ceil((windowMs - (now - recent[0]!)) / 1000)) };
  if (access.globalAttempts.length >= LOGIN_GLOBAL_MAX_ATTEMPTS) return { retryAfter: Math.max(1, Math.ceil((windowMs - (now - access.globalAttempts[0]!)) / 1000)) };
  recent.push(now);
  access.attempts.set(client, recent);
  access.globalAttempts.push(now);
  let valid = false;
  if (typeof password === 'string' && password.length >= 1 && password.length <= 4096) {
    const candidate = await deriveDigest(password, access.verifier.salt);
    valid = timingSafeEqual(candidate, access.verifier.digest);
  }
  if (!valid) {
    // A short, growing pause makes online guessing slower without holding the event loop.
    await new Promise((resolve) => setTimeout(resolve, Math.min(recent.length * 250, 1500)));
    return { failed: true };
  }
  access.attempts.delete(client);
  return { token: signToken(access, randomBytes(16).toString('base64url'), now + PUBLIC_SESSION_SECONDS * 1000) };
}

function signature(access: PublicAccess, body: string): string {
  return createHmac('sha256', access.key).update(body).digest('base64url');
}

function signToken(access: PublicAccess, id: string, expires: number): string {
  const body = `${id}.${expires}`;
  return `${body}.${signature(access, body)}`;
}

/** The token's id when its signature is genuine and it has not expired, else null. */
function verifyToken(access: PublicAccess, token: string, now: number): { id: string; expires: number } | null {
  const [id, expiry, signed, extra] = token.split('.');
  if (!id || !expiry || !signed || extra !== undefined || !/^\d{1,15}$/u.test(expiry)) return null;
  const expected = Buffer.from(signature(access, `${id}.${expiry}`));
  const actual = Buffer.from(signed);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const expires = Number(expiry);
  return expires > now ? { id, expires } : null;
}

export function sessionToken(request: IncomingMessage): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === PUBLIC_SESSION_COOKIE) return rest.join('=') || null;
  }
  return null;
}

export function validSession(access: PublicAccess, request: IncomingMessage, now = Date.now()): boolean {
  const token = sessionToken(request);
  const verified = token ? verifyToken(access, token, now) : null;
  return verified !== null && !access.revoked.has(verified.id);
}

export function logout(access: PublicAccess, request: IncomingMessage, now = Date.now()): void {
  const token = sessionToken(request);
  const verified = token ? verifyToken(access, token, now) : null;
  if (!verified) return;
  access.revoked.set(verified.id, verified.expires);
  for (const [id, expires] of access.revoked) if (expires <= now) access.revoked.delete(id);
  try {
    const temporary = `${access.revokedFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(Object.fromEntries(access.revoked)), { mode: 0o600 });
    renameSync(temporary, access.revokedFile);
  } catch {
    // The revocation still holds for this process; only its survival across a restart is lost.
  }
}

export const loginCookie = (token: string): string => `${PUBLIC_SESSION_COOKIE}=${token}; Path=/; Max-Age=${PUBLIC_SESSION_SECONDS}; Secure; HttpOnly; SameSite=Strict`;
export const clearedCookie = `${PUBLIC_SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;

export const LOGIN_PAGE = Buffer.from(`<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>PUBG Intelligence Lab 登录</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1112;color:#e8efed;font:16px system-ui,-apple-system,sans-serif}
.card{width:min(380px,calc(100% - 40px));padding:30px;border:1px solid #233131;border-radius:18px;background:#101819;box-sizing:border-box}
h1{font-size:20px;margin:0 0 8px}p{color:#758785;font-size:13px;line-height:1.6}
input,button{box-sizing:border-box;width:100%;border-radius:10px;padding:12px;font:inherit}
input{margin:16px 0;background:#0b1112;color:#e8efed;border:1px solid #2c3d3d}
button{border:0;background:#b8f277;color:#14200c;font-weight:700;cursor:pointer}
#error{min-height:20px;color:#ee998d;font-size:12px}
</style>
<main class="card"><h1>PUBG Intelligence Lab</h1><p>输入访问密码以打开战绩研究页面。</p>
<form id="login"><label for="password">访问密码</label><input id="password" type="password" autocomplete="current-password" required autofocus><button>登录</button></form>
<div id="error" role="status"></div></main>
<script>
document.getElementById("login").addEventListener("submit",async e=>{
  e.preventDefault();const error=document.getElementById("error");error.textContent="";
  try{
    const response=await fetch("/api/login",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:document.getElementById("password").value})});
    if(response.status===401){error.textContent="密码不正确，请检查后重试。";return}
    if(response.status===429){error.textContent="尝试次数过多，请稍后再试。";return}
    if(!response.ok){error.textContent="登录服务返回 HTTP "+response.status+"，请稍后重试。";return}
    location.replace("/");
  }catch{error.textContent="无法连接登录服务，请检查网络后重试。"}
});
</script>
</html>`, 'utf8');
