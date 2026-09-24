#!/usr/bin/env node
/* Operator-only Longbridge OAuth 2 bootstrap. OpenClaw never invokes this. */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { LongbridgeOAuth } from '../plugins/amadeus/dist/src/market/auth.js';

function usage() {
  console.error('Usage: longbridge-oauth-authorize.mjs start [--redirect-uri URI] [--state STATE]');
  console.error('   or: longbridge-oauth-authorize.mjs exchange [--redirect-uri URI] < authorization-code.txt');
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
const config = {
  longbridgeApiBaseUrl: process.env.LONGBRIDGE_API_BASE_URL ?? 'https://openapi.longbridge.com',
  longbridgeAuthBaseUrl: authBaseUrl,
  longbridgeClientIdFile: clientIdFile,
  longbridgeOAuthStateFile: stateFile,
  macHostAgentBaseUrl: 'http://127.0.0.1:18791',
};
const oauth = new LongbridgeOAuth(config);
if (mode === 'start') {
  console.log(await oauth.authorizationUrl(redirectUri, state));
  console.error('Open the URL on Amadeus-M204, approve Longbridge read-only market access, then save only the returned code outside Git.');
  process.exit(0);
}
const code = (await readFile(0, 'utf8')).trim();
if (!code) throw new Error('authorization code was empty');
const status = await oauth.exchangeCode(code, redirectUri);
console.log(`LONGBRIDGE_AUTH=${status.status}`);
