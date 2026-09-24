import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AmadeusConfig } from '../src/config.js';
import { authStatus, LongbridgeOAuth, pkceChallenge, type OAuthStateStore, type PersistedOAuthState } from '../src/market/auth.js';

const state: PersistedOAuthState = { accessToken: 'fixture-a', refreshToken: 'fixture-r', expiresAt: '2030-01-01T00:00:00.000Z' };
const config = { longbridgeApiBaseUrl: 'https://openapi.longbridge.com', longbridgeAuthBaseUrl: 'https://openapi.longbridge.com', longbridgeClientIdFile: '/missing/client-id', longbridgeOAuthStateFile: '/missing/state', macHostAgentBaseUrl: 'http://127.0.0.1:18791' } as AmadeusConfig;

test('OAuth status exposes only deterministic lifecycle state', () => {
  assert.equal(authStatus(undefined).status, 'reauth_required');
  assert.equal(authStatus(state).status, 'ready');
  assert.equal(authStatus({ ...state, expiresAt: '2020-01-01T00:00:00.000Z' }).status, 'reauth_required');
  assert.doesNotMatch(JSON.stringify(authStatus(state)), /fixture-a|fixture-r/u);
});

test('OAuth operator flow uses the standard S256 PKCE challenge', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('OAuth state store can be reused across service restarts without browser interaction', async () => {
  let persisted: PersistedOAuthState | undefined = state;
  const store: OAuthStateStore = { async load() { return persisted; }, async save(value) { persisted = value; } };
  const oauth = new LongbridgeOAuth(config, store);
  assert.equal((await oauth.status()).status, 'ready');
  assert.equal(await oauth.accessToken(), 'fixture-a');
  assert.equal((await new LongbridgeOAuth(config, store).status()).status, 'ready');
});

test('OAuth imports the official SDK token cache without exposing token values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amadeus-longbridge-sdk-'));
  const clientIdFile = join(directory, 'client-id');
  const sdkTokenDir = join(directory, 'tokens');
  await writeFile(clientIdFile, 'client-id-example\n', { mode: 0o600 });
  await mkdir(sdkTokenDir, { recursive: true, mode: 0o700 });
  await writeFile(join(sdkTokenDir, 'client-id-example'), JSON.stringify({
    client_id: 'client-id-example',
    access_token: 'sdk-a',
    refresh_token: 'sdk-r',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }), { mode: 0o600 });
  let persisted: PersistedOAuthState | undefined;
  const store: OAuthStateStore = { async load() { return persisted; }, async save(value) { persisted = value; } };
  const oauth = new LongbridgeOAuth({ ...config, longbridgeClientIdFile: clientIdFile, longbridgeSdkTokenDir: sdkTokenDir }, store);
  assert.equal((await oauth.status()).status, 'ready');
  assert.equal(await oauth.accessToken(), 'sdk-a');
  assert.equal(persisted?.refreshToken, 'sdk-r');
  assert.doesNotMatch(JSON.stringify(await oauth.status()), /sdk-a|sdk-r/u);
});
