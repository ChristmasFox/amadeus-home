#!/usr/bin/env node
/* Operator-only Longbridge OAuth 2 bootstrap. OpenClaw never invokes this. */
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { LongbridgeOAuth, pkceChallenge } from '../plugins/amadeus/dist/src/market/auth.js';

function usage() {
  console.error('Usage: longbridge-oauth-authorize.mjs start [--redirect-uri URI] [--state STATE]');
  console.error('   or: longbridge-oauth-authorize.mjs exchange < callback-url.txt');
  process.exit(2);
}

const mode = process.argv[2];
if (!mode || !['start', 'exchange'].includes(mode)) usage();
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const redirectUri = arg('--redirect-uri', 'http://127.0.0.1:18792/callback');
const state = arg('--state', randomBytes(18).toString('base64url'));
const clientIdFile = process.env.LONGBRIDGE_CLIENT_ID_FILE ?? '/DATA/AppData/openclaw/secrets/longbridge-client-id';
const authBaseUrl = process.env.LONGBRIDGE_AUTH_BASE_URL ?? 'https://openapi.longbridge.com';
const stateFile = process.env.LONGBRIDGE_OAUTH_STATE_FILE ?? '/DATA/AppData/openclaw/data/longbridge-oauth.json';
const requestFile = process.env.LONGBRIDGE_OAUTH_REQUEST_FILE ?? '/DATA/AppData/openclaw/data/longbridge-oauth-request.json';
const sdkTokenDir = process.env.LONGBRIDGE_SDK_TOKEN_DIR ?? '/DATA/AppData/openclaw/data/longbridge-sdk-home/.longbridge/openapi/tokens';
const config = {
  longbridgeApiBaseUrl: process.env.LONGBRIDGE_API_BASE_URL ?? 'https://openapi.longbridge.com',
  longbridgeAuthBaseUrl: authBaseUrl,
  longbridgeClientIdFile: clientIdFile,
  longbridgeOAuthStateFile: stateFile,
  longbridgeSdkTokenDir: sdkTokenDir,
  macHostAgentBaseUrl: 'http://127.0.0.1:18791',
};
const oauth = new LongbridgeOAuth(config);
if (mode === 'start') {
  const codeVerifier = randomBytes(48).toString('base64url');
  const request = { state, codeVerifier, redirectUri, createdAt: new Date().toISOString() };
  await mkdir(dirname(requestFile), { recursive: true, mode: 0o700 });
  await writeFile(requestFile, `${JSON.stringify(request)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(requestFile, 0o600);
  console.log(await oauth.authorizationUrl(redirectUri, state, pkceChallenge(codeVerifier)));
  console.error('Open the URL on Amadeus-M204, approve read-only market access, then save the complete callback URL outside Git.');
  process.exit(0);
}
let request;
try { request = JSON.parse(await readFile(requestFile, 'utf8')); } catch { throw new Error('Longbridge OAuth start state is unavailable; run start first'); }
if (!request || typeof request !== 'object' || typeof request.state !== 'string' || typeof request.codeVerifier !== 'string' || typeof request.redirectUri !== 'string') {
  throw new Error('Longbridge OAuth start state is invalid');
}
// Node 24 no longer accepts a numeric file descriptor in fs.promises.readFile;
// use the portable stdin device path for the operator-only pipe.
const callback = (await readFile('/dev/stdin', 'utf8')).trim();
if (!callback) throw new Error('callback URL was empty');
let code;
let returnedState;
try {
  const parsed = new URL(callback);
  code = parsed.searchParams.get('code') ?? '';
  returnedState = parsed.searchParams.get('state') ?? '';
} catch {
  throw new Error('paste the complete callback URL, including code and state');
}
if (!code || !returnedState || returnedState !== request.state) throw new Error('Longbridge OAuth callback state did not match');
const status = await oauth.exchangeCode(code, request.redirectUri, request.codeVerifier);
await unlink(requestFile).catch(() => {});
console.log(`LONGBRIDGE_AUTH=${status.status}`);
