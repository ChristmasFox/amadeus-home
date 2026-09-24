import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readRequiredFile, type AmadeusConfig } from '../config.js';
import { requestFormJson } from '../http.js';
import type { LongbridgeAuthStatus } from './types.js';

export interface PersistedOAuthState {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  tokenType?: string;
}

export interface OAuthStateStore {
  load(): Promise<PersistedOAuthState | undefined>;
  save(state: PersistedOAuthState): Promise<void>;
}

/** Generate the PKCE verifier/challenge pair required by public OAuth clients. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function isState(value: unknown): value is PersistedOAuthState {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.accessToken === 'string' && Boolean(item.accessToken)
    && typeof item.refreshToken === 'string' && Boolean(item.refreshToken)
    && typeof item.expiresAt === 'string' && !Number.isNaN(Date.parse(item.expiresAt));
}

export function fileOAuthStateStore(path: string): OAuthStateStore {
  return {
    async load() {
      try {
        const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
        return isState(value) ? value : undefined;
      } catch { return undefined; }
    },
    async save(state) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, path);
      await chmod(path, 0o600);
    },
  };
}

export function authStatus(state: PersistedOAuthState | undefined, now = new Date()): LongbridgeAuthStatus {
  if (!state) return { status: 'reauth_required', provider: 'longbridge', authMode: 'oauth2', message: 'operator OAuth authorization is required' };
  const expiresAt = Date.parse(state.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { status: 'reauth_required', provider: 'longbridge', authMode: 'oauth2', expiresAt: state.expiresAt, message: 'Longbridge OAuth refresh state is unavailable or expired' };
  }
  return { status: 'ready', provider: 'longbridge', authMode: 'oauth2', expiresAt: state.expiresAt };
}

export class LongbridgeOAuth {
  private statePromise: Promise<PersistedOAuthState | undefined> | undefined;
  private refreshPromise: Promise<PersistedOAuthState | undefined> | undefined;

  constructor(private readonly config: AmadeusConfig, private readonly store: OAuthStateStore = fileOAuthStateStore(config.longbridgeOAuthStateFile)) {}

  async status(): Promise<LongbridgeAuthStatus> {
    return authStatus(await this.state(), new Date());
  }

  async authorizationUrl(redirectUri: string, state: string, codeChallenge?: string): Promise<string> {
    const clientId = await readRequiredFile(this.config.longbridgeClientIdFile, 'Longbridge OAuth client id');
    const url = new URL('/oauth2/authorize', this.config.longbridgeAuthBaseUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    // Longbridge's public-client flow uses PKCE. Confidential clients may omit
    // it, but the operator script always supplies it when starting a flow.
    url.searchParams.set('scope', '3');
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<LongbridgeAuthStatus> {
    if (!code.trim()) throw new Error('Longbridge OAuth authorization code is required');
    const clientId = await readRequiredFile(this.config.longbridgeClientIdFile, 'Longbridge OAuth client id');
    const fields: Record<string, string> = { grant_type: 'authorization_code', client_id: clientId, code: code.trim(), redirect_uri: redirectUri };
    if (codeVerifier) fields.code_verifier = codeVerifier;
    if (this.config.longbridgeClientSecretFile) fields.client_secret = await readRequiredFile(this.config.longbridgeClientSecretFile, 'Longbridge OAuth client secret');
    const payload = await requestFormJson(`${this.config.longbridgeAuthBaseUrl}/oauth2/token`, fields, { includeErrorDetail: false });
    const state = tokenState(payload);
    await this.store.save(state);
    this.statePromise = Promise.resolve(state);
    return authStatus(state);
  }

  async accessToken(): Promise<string> {
    let state = await this.state();
    const expiry = state ? Date.parse(state.expiresAt) : 0;
    if (!state || !Number.isFinite(expiry)) throw new Error('longbridge_oauth_reauthorization_required');
    if (expiry - Date.now() < 120_000) state = await this.refresh(state);
    if (!state) throw new Error('longbridge_oauth_reauthorization_required');
    return state.accessToken;
  }

  async ensureReady(): Promise<LongbridgeAuthStatus> {
    try {
      await this.accessToken();
      return this.statusForCurrentState();
    } catch {
      return this.statusForCurrentState();
    }
  }

  private async statusForCurrentState(): Promise<LongbridgeAuthStatus> {
    return authStatus(await this.state(), new Date());
  }

  private async state(): Promise<PersistedOAuthState | undefined> {
    this.statePromise ??= this.store.load();
    return this.statePromise;
  }

  private async refresh(current: PersistedOAuthState): Promise<PersistedOAuthState | undefined> {
    this.refreshPromise ??= (async () => {
      try {
        const clientId = await readRequiredFile(this.config.longbridgeClientIdFile, 'Longbridge OAuth client id');
        const fields: Record<string, string> = { grant_type: 'refresh_token', client_id: clientId, refresh_token: current.refreshToken };
        if (this.config.longbridgeClientSecretFile) fields.client_secret = await readRequiredFile(this.config.longbridgeClientSecretFile, 'Longbridge OAuth client secret');
        const state = tokenState(await requestFormJson(`${this.config.longbridgeAuthBaseUrl}/oauth2/token`, fields, { includeErrorDetail: false }), current);
        await this.store.save(state);
        this.statePromise = Promise.resolve(state);
        return state;
      } catch { return undefined; }
    })();
    try { return await this.refreshPromise; } finally { this.refreshPromise = undefined; }
  }
}

function tokenState(payload: unknown, previous?: PersistedOAuthState): PersistedOAuthState {
  if (!payload || typeof payload !== 'object') throw new Error('Longbridge OAuth token response is unavailable');
  const value = payload as Record<string, unknown>;
  const accessToken = typeof value.access_token === 'string' ? value.access_token : undefined;
  const refreshToken = typeof value.refresh_token === 'string' ? value.refresh_token : previous?.refreshToken;
  const expiresIn = typeof value.expires_in === 'number' ? value.expires_in : Number(value.expires_in);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('Longbridge OAuth token response is invalid');
  return { accessToken, refreshToken, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), ...(typeof value.token_type === 'string' ? { tokenType: value.token_type } : {}) };
}
