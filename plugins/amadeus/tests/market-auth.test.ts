import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AmadeusConfig } from '../src/config.js';
import { authStatus, LongbridgeOAuth, pkceChallenge, type OAuthStateStore, type PersistedOAuthState } from '../src/market/auth.js';

const state: PersistedOAuthState = { accessToken: 'access-token-secret', refreshToken: 'refresh-token-secret', expiresAt: '2030-01-01T00:00:00.000Z' };
const config = { longbridgeApiBaseUrl: 'https://openapi.longbridge.com', longbridgeAuthBaseUrl: 'https://openapi.longbridge.com', longbridgeClientIdFile: '/missing/client-id', longbridgeOAuthStateFile: '/missing/state', macHostAgentBaseUrl: 'http://127.0.0.1:18791' } as AmadeusConfig;

test('OAuth status exposes only deterministic lifecycle state', () => {
  assert.equal(authStatus(undefined).status, 'reauth_required');
  assert.equal(authStatus(state).status, 'ready');
  assert.equal(authStatus({ ...state, expiresAt: '2020-01-01T00:00:00.000Z' }).status, 'reauth_required');
  assert.doesNotMatch(JSON.stringify(authStatus(state)), /access-token-secret|refresh-token-secret/u);
});

test('OAuth operator flow uses the standard S256 PKCE challenge', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('OAuth state store can be reused across service restarts without browser interaction', async () => {
  let persisted: PersistedOAuthState | undefined = state;
  const store: OAuthStateStore = { async load() { return persisted; }, async save(value) { persisted = value; } };
  const oauth = new LongbridgeOAuth(config, store);
  assert.equal((await oauth.status()).status, 'ready');
  assert.equal(await oauth.accessToken(), 'access-token-secret');
  assert.equal((await new LongbridgeOAuth(config, store).status()).status, 'ready');
});
