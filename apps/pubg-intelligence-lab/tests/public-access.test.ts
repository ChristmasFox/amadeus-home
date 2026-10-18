import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { scryptSync, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  isPublicHostname, isPublicRequest, loadPasswordVerifier, loadPublicAccess, login, logout, looksProxied, validSession, LOGIN_MAX_ATTEMPTS, PUBLIC_SESSION_COOKIE,
  type PublicAccess,
} from '../src/server/public-access.js';
import { handlePublic } from '../src/server/public-site.js';
import type { Snapshot } from '../src/server/snapshot.js';

function writeVerifier(directory: string, password: string, mode = 0o600): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const path = join(directory, 'auth.json');
  writeFileSync(path, JSON.stringify({ format: 'amadeus-qwen-image-lab-scrypt-v1', salt: salt.toString('base64'), scrypt: { n: 32768, r: 8, p: 1, dklen: 64 }, digest: digest.toString('base64') }));
  chmodSync(path, mode);
  return path;
}

function fakeRequest(headers: Record<string, string>) {
  return { headers, socket: { remoteAddress: '10.0.0.9' } } as never;
}

test('the verifier must be a private file in the shared scrypt format, and public access needs both settings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pubg-public-'));
  try {
    assert.throws(() => loadPasswordVerifier(writeVerifier(directory, 'secret-pass', 0o644)), /public_auth_file_not_private/u);
    const good = writeVerifier(directory, 'secret-pass');
    assert.equal(loadPasswordVerifier(good).digest.length, 64);
    assert.equal(loadPublicAccess({}, directory), null);
    assert.throws(() => loadPublicAccess({ PUBG_INTELLIGENCE_PUBLIC_HOST: 'pubg.example.com' }, directory), /needs_host_and_auth_file/u);
    assert.throws(() => loadPublicAccess({ PUBG_INTELLIGENCE_PUBLIC_HOST: '192.168.1.5', PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE: good }, directory), /public_host_invalid/u);
    const access = loadPublicAccess({ PUBG_INTELLIGENCE_PUBLIC_HOST: 'PUBG.Example.com', PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE: good }, directory)!;
    assert.equal(access.host, 'pubg.example.com');
    assert.equal(access.origin, 'https://pubg.example.com');
    assert.ok(isPublicHostname('a.b.co') && !isPublicHostname('localhost') && !isPublicHostname('10.0.0.1'));
    assert.ok(isPublicRequest(fakeRequest({ host: 'pubg.example.com' }), access));
    assert.ok(!isPublicRequest(fakeRequest({ host: '192.168.5.3:4179' }), access));
    assert.ok(looksProxied(fakeRequest({ 'x-forwarded-for': '1.2.3.4' })) && !looksProxied(fakeRequest({ host: 'x' })));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('login accepts only the right password, throttles guessing and expires sessions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pubg-public-'));
  try {
    const access: PublicAccess = loadPublicAccess({ PUBG_INTELLIGENCE_PUBLIC_HOST: 'pubg.example.com', PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE: writeVerifier(directory, 'secret-pass') }, directory)!;
    const start = Date.now();
    assert.deepEqual(await login(access, 'a', 'wrong', start), { failed: true });
    assert.deepEqual(await login(access, 'a', 42, start), { failed: true });
    const ok = await login(access, 'b', 'secret-pass', start);
    assert.ok('token' in ok);
    const request = fakeRequest({ cookie: `other=1; ${PUBLIC_SESSION_COOKIE}=${(ok as { token: string }).token}` });
    assert.ok(validSession(access, request, start + 1000));
    assert.ok(!validSession(access, request, start + 13 * 60 * 60 * 1000), 'sessions expire after twelve hours');
    assert.ok(!validSession(access, fakeRequest({ cookie: `${PUBLIC_SESSION_COOKIE}=forged` }), start));
    for (let index = 0; index < LOGIN_MAX_ATTEMPTS; index += 1) await login(access, 'c', 'nope', start);
    const blocked = await login(access, 'c', 'secret-pass', start);
    assert.ok('retryAfter' in blocked, 'the sixth attempt inside a minute is refused even with the right password');
    assert.ok('token' in await login(access, 'c', 'secret-pass', start + 61_000), 'the window slides');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the public scope shows only a login page until a session exists, then serves the app', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pubg-public-'));
  const access = loadPublicAccess({ PUBG_INTELLIGENCE_PUBLIC_HOST: 'pubg.example.com', PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE: writeVerifier(directory, 'secret-pass') }, directory)!;
  const snapshot = {} as Snapshot;
  const server: Server = createServer((request, response) => { void handlePublic(request, response, snapshot, access, async (_request, apiResponse) => { apiResponse.writeHead(200, { 'content-type': 'application/json' }); apiResponse.end('{"api":true}'); }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: string) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { host: 'pubg.example.com', ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
  try {
    const page = await call('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /访问密码/u);
    assert.doesNotMatch(page.body, /secret-pass/u);
    assert.equal((await call('GET', '/api/bootstrap')).status, 401);
    assert.equal((await call('GET', '/assets/anything.js')).status, 401);
    const json = { 'content-type': 'application/json', origin: 'https://pubg.example.com' };
    assert.equal((await call('POST', '/api/login', { ...json, origin: 'https://evil.example' }, JSON.stringify({ password: 'secret-pass' }))).status, 403, 'cross-origin login is refused');
    assert.equal((await call('POST', '/api/login', json, JSON.stringify({ password: 'wrong' }))).status, 401);
    assert.equal((await call('POST', '/api/login', json, JSON.stringify({ password: 'secret-pass', extra: 1 }))).status, 400);
    const good = await call('POST', '/api/login', json, JSON.stringify({ password: 'secret-pass' }));
    assert.equal(good.status, 204);
    const cookie = String(good.headers['set-cookie']);
    assert.match(cookie, /Secure/u);
    assert.match(cookie, /HttpOnly/u);
    assert.match(cookie, /SameSite=Strict/u);
    const session = cookie.split(';')[0]!;
    const app = await call('GET', '/', { cookie: session });
    assert.equal(app.status, 200);
    assert.match(app.body, /<div id="root"/u);
    assert.equal(app.headers['strict-transport-security'], 'max-age=31536000');
    for (const path of ['/assets/../../../package.json', '/%2e%2e/%2e%2e/package.json', '/assets/..%2f..%2f..%2fpackage.json']) {
      const escaped = await call('GET', path, { cookie: session });
      assert.doesNotMatch(escaped.body, /@agent\/pubg-intelligence-lab/u, `path traversal via ${path} must not read files outside the built client`);
    }
    assert.equal((await call('POST', '/api/research', { cookie: session, 'content-type': 'application/json' }, '{}')).status, 403, 'writes from a logged-in session still need the same origin');
    assert.equal((await call('POST', '/api/logout', { cookie: session, origin: 'https://pubg.example.com' })).status, 204);
    assert.equal((await call('GET', '/api/bootstrap', { cookie: session })).status, 401, 'logout ends the session');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a login survives a restart, a logout does not, and changing the password ends every session', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pubg-public-'));
  try {
    const env = (file: string) => ({ PUBG_INTELLIGENCE_PUBLIC_HOST: 'pubg.example.com', PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE: file });
    const file = writeVerifier(directory, 'secret-pass');
    const before = loadPublicAccess(env(file), directory)!;
    const issued = await login(before, 'a', 'secret-pass');
    assert.ok('token' in issued);
    const request = fakeRequest({ cookie: `${PUBLIC_SESSION_COOKIE}=${(issued as { token: string }).token}` });
    assert.equal(statSync(join(directory, 'session-secret')).mode & 0o077, 0, 'the signing secret is private');
    // "Restart": a fresh PublicAccess over the same state directory still accepts the session.
    const after = loadPublicAccess(env(file), directory)!;
    assert.ok(validSession(after, request), 'the session outlives a restart');
    // A tampered expiry or signature is refused.
    const [id, expiry, signed] = (issued as { token: string }).token.split('.');
    assert.ok(!validSession(after, fakeRequest({ cookie: `${PUBLIC_SESSION_COOKIE}=${id}.${Number(expiry) + 1000}.${signed}` })));
    assert.ok(!validSession(after, fakeRequest({ cookie: `${PUBLIC_SESSION_COOKIE}=${id}.${expiry}.${signed}x` })));
    // Logout is remembered across a restart too.
    logout(after, request);
    assert.ok(!validSession(after, request));
    assert.ok(!validSession(loadPublicAccess(env(file), directory)!, request), 'a logged-out token stays dead after a restart');
    // A new password derives a new key, so older sessions die with it.
    const second = await login(loadPublicAccess(env(file), directory)!, 'b', 'secret-pass');
    const secondRequest = fakeRequest({ cookie: `${PUBLIC_SESSION_COOKIE}=${(second as { token: string }).token}` });
    const changed = loadPublicAccess(env(writeVerifier(directory, 'a-different-password')), directory)!;
    assert.ok(!validSession(changed, secondRequest), 'changing the password invalidates existing sessions');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
