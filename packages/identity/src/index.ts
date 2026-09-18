import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

export type AliasScope = 'global' | 'group';
export type AliasSource = 'preset' | 'confirmed' | 'observed';
export type ChannelIdentitySource = 'preset' | 'confirmed' | 'platform';

export interface IdentityContext {
  channel?: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
  mentions?: TrustedChannelIdentity[];
  replySender?: TrustedChannelIdentity;
}

export interface TrustedChannelIdentity {
  channel?: string;
  accountId?: string;
  conversationId?: string;
  platformUserId: string;
}

export interface PersonRecord {
  personId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface AliasRecord {
  aliasId: string;
  personId: string;
  alias: string;
  scope: AliasScope;
  scopeId?: string;
  source: AliasSource;
  confidence: number;
  evidenceSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelIdentityRecord {
  channel: string;
  accountId?: string;
  platformUserId: string;
  personId: string;
  source: ChannelIdentitySource;
  confidence: number;
  conversationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalAccountRecord {
  accountId: string;
  personId: string;
  provider: string;
  externalId: string;
  label?: string;
  source: Exclude<AliasSource, 'observed'>;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersonSnapshot extends PersonRecord {
  aliases: AliasRecord[];
  channelIdentities: ChannelIdentityRecord[];
  externalAccounts: ExternalAccountRecord[];
}

export type IdentityResolutionStatus = 'resolved' | 'unbound' | 'ambiguous' | 'candidate' | 'not_found';
export type IdentityResolutionPath =
  | 'platform'
  | 'owner-confirmed-binding'
  | 'group-alias'
  | 'global-alias'
  | 'learned-candidate'
  | 'person'
  | 'unbound';

export interface IdentityResolutionCandidate {
  alias: AliasRecord;
  person: PersonSnapshot;
}

export interface IdentityResolution {
  status: IdentityResolutionStatus;
  reliable: boolean;
  resolutionPath: IdentityResolutionPath;
  person?: PersonSnapshot;
  channelIdentity?: ChannelIdentityRecord;
  unboundIdentity?: TrustedChannelIdentity;
  candidates?: IdentityResolutionCandidate[];
  reason?: string;
}

export type IdentityReference =
  | { type: 'self' }
  | { type: 'alias'; alias: string; scope?: AliasScope }
  | { type: 'person'; personId: string }
  | { type: 'mention'; index: number }
  | { type: 'reply_sender' };

export interface IdentityPresetAccount {
  provider: string;
  externalId: string;
  label?: string;
}

export interface IdentityPreset {
  personId?: string;
  displayName: string;
  aliases?: string[];
  externalAccounts?: IdentityPresetAccount[];
}

export interface AddAliasInput {
  personId: string;
  alias: string;
  scope: AliasScope;
  scopeId?: string;
  source: AliasSource;
  confidence?: number;
  evidenceSummary?: string;
}

export interface BindChannelInput {
  personId: string;
  identity: TrustedChannelIdentity;
  source?: Extract<ChannelIdentitySource, 'confirmed' | 'preset'>;
  confidence?: number;
}

export interface LinkAccountInput {
  personId: string;
  provider: string;
  externalId: string;
  label?: string;
  source?: Exclude<AliasSource, 'observed'>;
  confidence?: number;
}

export interface IdentityStoreOptions {
  presetsFile?: string;
  now?: () => Date;
}

interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase };

const SOURCE_RANK: Record<AliasSource, number> = { observed: 1, preset: 2, confirmed: 3 };
const CHANNEL_SOURCE_RANK: Record<ChannelIdentitySource, number> = { platform: 1, preset: 2, confirmed: 3 };
const EXTERNAL_SOURCE_RANK: Record<Exclude<AliasSource, 'observed'>, number> = { preset: 1, confirmed: 2 };

function clean(value: unknown, label: string, maxLength: number): string {
  const normalized = String(value ?? '').replace(/[\u0000\r\n]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!normalized) throw new Error(`${label}_required`);
  if (normalized.length > maxLength) throw new Error(`${label}_too_long`);
  return normalized;
}

function optionalClean(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).replace(/[\u0000\r\n]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw new Error('identity_value_too_long');
  return normalized;
}

function key(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function boundedConfidence(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new Error('identity_confidence_invalid');
  return Math.min(Math.max(value, 0), 1);
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function normalizedChannel(value: unknown): string {
  return clean(value, 'channel', 64).toLocaleLowerCase();
}

function optionalScopeId(value: unknown): string | undefined {
  return optionalClean(value, 256);
}

function rowText(row: Record<string, unknown>, name: string, fallback = ''): string {
  return typeof row[name] === 'string' ? row[name] as string : row[name] === undefined || row[name] === null ? fallback : String(row[name]);
}

function rowNumber(row: Record<string, unknown>, name: string, fallback = 0): number {
  const result = Number(row[name]);
  return Number.isFinite(result) ? result : fallback;
}

function rowOptional(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name];
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

function parsePresetFile(path: string): IdentityPreset[] {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`identity_presets_unreadable:${path}`, { cause: error });
  }
  const rows: unknown[] | undefined = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).persons)
    ? (value as Record<string, unknown>).persons as unknown[]
    : undefined;
  if (!rows) throw new Error('identity_presets_invalid');
  return rows.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('identity_preset_invalid');
    const source = item as Record<string, unknown>;
    const accountsValue = source.externalAccounts ?? source.accounts;
    const accounts = Array.isArray(accountsValue) ? accountsValue.map((account) => {
      if (!account || typeof account !== 'object' || Array.isArray(account)) throw new Error('identity_preset_account_invalid');
      const row = account as Record<string, unknown>;
      const result: IdentityPresetAccount = {
        provider: clean(row.provider, 'identity_provider', 128),
        externalId: clean(row.externalId ?? row.id, 'identity_external_id', 256),
      };
      const label = optionalClean(row.label, 256);
      if (label) result.label = label;
      return result;
    }) : [];
    const aliases = Array.isArray(source.aliases) ? source.aliases.map((alias) => clean(alias, 'identity_alias', 128)) : [];
    const personId = optionalClean(source.personId ?? source.id, 128);
    return {
      ...(personId ? { personId } : {}),
      displayName: clean(source.displayName ?? source.name, 'identity_display_name', 128),
      ...(aliases.length ? { aliases } : {}),
      ...(accounts.length ? { externalAccounts: accounts } : {}),
    };
  });
}

function parseScope(scope: unknown): AliasScope {
  if (scope !== 'global' && scope !== 'group') throw new Error('identity_scope_invalid');
  return scope;
}

function parseAliasSource(source: unknown): AliasSource {
  if (source !== 'preset' && source !== 'confirmed' && source !== 'observed') throw new Error('identity_alias_source_invalid');
  return source;
}

function personIdForPreset(preset: IdentityPreset): string {
  return preset.personId ?? stableId('person', key(preset.displayName));
}

export class IdentityStore {
  readonly db: SqliteDatabase;
  private readonly now: () => Date;
  private presetFingerprint: string | undefined;

  constructor(readonly filename = ':memory:', options: IdentityStoreOptions = {}) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.now = options.now ?? (() => new Date());
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    this.migrate();
    if (options.presetsFile) this.refreshPresets(options.presetsFile);
  }

  close(): void {
    this.db.close();
  }

  refreshPresets(presetsFile: string): boolean {
    let fingerprint: string | undefined;
    try {
      const stats = statSync(presetsFile);
      fingerprint = `${stats.mtimeMs}:${stats.size}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`identity_presets_unreadable:${presetsFile}`, { cause: error });
      this.presetFingerprint = undefined;
      return false;
    }
    if (fingerprint === this.presetFingerprint) return false;
    this.seedPresets(parsePresetFile(presetsFile));
    this.presetFingerprint = fingerprint;
    return true;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS persons (
        person_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        display_name_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS channel_identities (
        channel TEXT NOT NULL,
        account_id TEXT NOT NULL DEFAULT '',
        platform_user_id TEXT NOT NULL,
        person_id TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('preset', 'confirmed', 'platform')),
        confidence REAL NOT NULL,
        conversation_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel, account_id, platform_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_identity_channel_person ON channel_identities(person_id);
      CREATE TABLE IF NOT EXISTS aliases (
        alias_id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        alias TEXT NOT NULL,
        alias_key TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('global', 'group')),
        scope_id TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL CHECK (source IN ('preset', 'confirmed', 'observed')),
        confidence REAL NOT NULL,
        evidence_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (person_id, alias_key, scope, scope_id)
      );
      CREATE INDEX IF NOT EXISTS idx_identity_alias_lookup ON aliases(alias_key, scope, scope_id, source);
      CREATE TABLE IF NOT EXISTS external_accounts (
        account_id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        external_key TEXT NOT NULL,
        label TEXT,
        source TEXT NOT NULL CHECK (source IN ('preset', 'confirmed')),
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (provider, external_key)
      );
      CREATE INDEX IF NOT EXISTS idx_identity_external_person ON external_accounts(person_id);
    `);
  }

  private ensurePerson(personId: string, displayName: string): PersonRecord {
    const id = clean(personId, 'person_id', 128);
    const name = clean(displayName, 'identity_display_name', 128);
    const timestamp = nowIso(this.now);
    const sameName = this.db.prepare('SELECT person_id FROM persons WHERE display_name_key = ? AND person_id <> ?').get(key(name), id);
    if (sameName) throw new Error('identity_display_name_conflict');
    this.db.prepare('INSERT OR IGNORE INTO persons (person_id, display_name, display_name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name, key(name), timestamp, timestamp);
    const existing = this.db.prepare('SELECT * FROM persons WHERE person_id = ?').get(id);
    if (existing && rowText(existing, 'display_name') !== name) {
      const conflictingName = this.db.prepare('SELECT person_id FROM persons WHERE display_name_key = ? AND person_id <> ?').get(key(name), id);
      if (conflictingName) throw new Error('identity_display_name_conflict');
      this.db.prepare('UPDATE persons SET display_name = ?, display_name_key = ?, updated_at = ? WHERE person_id = ?').run(name, key(name), timestamp, id);
    }
    return this.getPersonRecord(id)!;
  }

  private getPersonRecord(personId: string): PersonRecord | undefined {
    const row = this.db.prepare('SELECT * FROM persons WHERE person_id = ?').get(personId);
    if (!row) return undefined;
    return {
      personId: rowText(row, 'person_id'),
      displayName: rowText(row, 'display_name'),
      createdAt: rowText(row, 'created_at'),
      updatedAt: rowText(row, 'updated_at'),
    };
  }

  private requirePerson(personId: string): PersonRecord {
    const person = this.getPersonRecord(clean(personId, 'person_id', 128));
    if (!person) throw new Error('identity_person_not_found');
    return person;
  }

  private aliasFromRow(row: Record<string, unknown>): AliasRecord {
    const scope = parseScope(rowText(row, 'scope'));
    const scopeId = rowOptional(row, 'scope_id');
    const evidenceSummary = rowOptional(row, 'evidence_summary');
    return {
      aliasId: rowText(row, 'alias_id'),
      personId: rowText(row, 'person_id'),
      alias: rowText(row, 'alias'),
      scope,
      ...(scopeId ? { scopeId } : {}),
      source: parseAliasSource(rowText(row, 'source')),
      confidence: rowNumber(row, 'confidence'),
      ...(evidenceSummary ? { evidenceSummary } : {}),
      createdAt: rowText(row, 'created_at'),
      updatedAt: rowText(row, 'updated_at'),
    };
  }

  private channelFromRow(row: Record<string, unknown>): ChannelIdentityRecord {
    const accountId = rowOptional(row, 'account_id');
    const conversationId = rowOptional(row, 'conversation_id');
    const source = rowText(row, 'source');
    if (source !== 'preset' && source !== 'confirmed' && source !== 'platform') throw new Error('identity_channel_source_invalid');
    return {
      channel: rowText(row, 'channel'),
      ...(accountId ? { accountId } : {}),
      platformUserId: rowText(row, 'platform_user_id'),
      personId: rowText(row, 'person_id'),
      source,
      confidence: rowNumber(row, 'confidence'),
      ...(conversationId ? { conversationId } : {}),
      createdAt: rowText(row, 'created_at'),
      updatedAt: rowText(row, 'updated_at'),
    };
  }

  private externalFromRow(row: Record<string, unknown>): ExternalAccountRecord {
    const label = rowOptional(row, 'label');
    const source = rowText(row, 'source');
    if (source !== 'preset' && source !== 'confirmed') throw new Error('identity_external_source_invalid');
    return {
      accountId: rowText(row, 'account_id'),
      personId: rowText(row, 'person_id'),
      provider: rowText(row, 'provider'),
      externalId: rowText(row, 'external_id'),
      ...(label ? { label } : {}),
      source,
      confidence: rowNumber(row, 'confidence'),
      createdAt: rowText(row, 'created_at'),
      updatedAt: rowText(row, 'updated_at'),
    };
  }

  getPerson(personId: string): PersonSnapshot | undefined {
    const person = this.getPersonRecord(clean(personId, 'person_id', 128));
    if (!person) return undefined;
    return this.snapshot(person);
  }

  findPersonByDisplayName(displayName: string): PersonSnapshot | undefined {
    const row = this.db.prepare('SELECT person_id FROM persons WHERE display_name_key = ?').get(key(clean(displayName, 'identity_display_name', 128)));
    return row ? this.getPerson(String(row.person_id)) : undefined;
  }

  private snapshot(person: PersonRecord): PersonSnapshot {
    const aliases = this.db.prepare('SELECT * FROM aliases WHERE person_id = ? ORDER BY scope, alias_key').all(person.personId).map((row) => this.aliasFromRow(row));
    const channelIdentities = this.db.prepare('SELECT * FROM channel_identities WHERE person_id = ? ORDER BY channel, account_id, platform_user_id').all(person.personId).map((row) => this.channelFromRow(row));
    const externalAccounts = this.db.prepare('SELECT * FROM external_accounts WHERE person_id = ? ORDER BY provider, external_key').all(person.personId).map((row) => this.externalFromRow(row));
    return { ...person, aliases, channelIdentities, externalAccounts };
  }

  private upsertAlias(input: AddAliasInput): AliasRecord {
    const personId = clean(input.personId, 'person_id', 128);
    this.requirePerson(personId);
    const alias = clean(input.alias, 'identity_alias', 128);
    const scope = parseScope(input.scope);
    const scopeId = scope === 'group' ? clean(input.scopeId, 'identity_scope_id', 256) : '';
    const source = parseAliasSource(input.source);
    const confidence = boundedConfidence(input.confidence, source === 'confirmed' || source === 'preset' ? 1 : 0.5);
    const evidenceSummary = optionalClean(input.evidenceSummary, 512);
    const aliasId = stableId('alias', `${personId}\u0000${scope}\u0000${scopeId}\u0000${key(alias)}`);
    const timestamp = nowIso(this.now);
    this.db.prepare('INSERT OR IGNORE INTO aliases (alias_id, person_id, alias, alias_key, scope, scope_id, source, confidence, evidence_summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(aliasId, personId, alias, key(alias), scope, scopeId, source, confidence, evidenceSummary ?? null, timestamp, timestamp);
    const existing = this.db.prepare('SELECT * FROM aliases WHERE alias_id = ?').get(aliasId);
    if (!existing) throw new Error('identity_alias_write_failed');
    const existingSource = parseAliasSource(rowText(existing, 'source'));
    const finalSource = SOURCE_RANK[source] >= SOURCE_RANK[existingSource] ? source : existingSource;
    const finalConfidence = Math.max(confidence, rowNumber(existing, 'confidence'));
    const finalEvidence = evidenceSummary ?? rowOptional(existing, 'evidence_summary') ?? null;
    this.db.prepare('UPDATE aliases SET alias = ?, source = ?, confidence = ?, evidence_summary = ?, updated_at = ? WHERE alias_id = ?').run(alias, finalSource, finalConfidence, finalEvidence, timestamp, aliasId);
    return this.aliasFromRow(this.db.prepare('SELECT * FROM aliases WHERE alias_id = ?').get(aliasId)!);
  }

  addAlias(input: AddAliasInput): AliasRecord {
    return this.upsertAlias(input);
  }

  bindChannel(input: BindChannelInput): ChannelIdentityRecord {
    const personId = clean(input.personId, 'person_id', 128);
    this.requirePerson(personId);
    const channel = normalizedChannel(input.identity.channel);
    const platformUserId = clean(input.identity.platformUserId, 'platform_user_id', 256);
    const accountId = optionalClean(input.identity.accountId, 128) ?? '';
    const conversationId = optionalClean(input.identity.conversationId, 256) ?? '';
    const source = input.source ?? 'confirmed';
    if (source !== 'confirmed' && source !== 'preset') throw new Error('identity_channel_source_invalid');
    const confidence = boundedConfidence(input.confidence, source === 'confirmed' || source === 'preset' ? 1 : 0.5);
    const timestamp = nowIso(this.now);
    const existingBeforeWrite = this.db.prepare('SELECT * FROM channel_identities WHERE channel = ? AND account_id = ? AND platform_user_id = ?').get(channel, accountId, platformUserId);
    this.db.prepare('INSERT OR IGNORE INTO channel_identities (channel, account_id, platform_user_id, person_id, source, confidence, conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(channel, accountId, platformUserId, personId, source, confidence, conversationId, timestamp, timestamp);
    const existing = this.db.prepare('SELECT * FROM channel_identities WHERE channel = ? AND account_id = ? AND platform_user_id = ?').get(channel, accountId, platformUserId);
    if (existing && rowText(existing, 'person_id') !== personId) throw new Error('identity_channel_already_bound');
    if (!existing) throw new Error('identity_channel_write_failed');
    const existingSource = rowText(existing, 'source');
    if (!(existingSource in CHANNEL_SOURCE_RANK)) throw new Error('identity_channel_source_invalid');
    const finalSource = CHANNEL_SOURCE_RANK[source] >= CHANNEL_SOURCE_RANK[existingSource as ChannelIdentitySource] ? source : existingSource as ChannelIdentitySource;
    const finalConversationId = conversationId || rowOptional(existing, 'conversation_id') || '';
    this.db.prepare('UPDATE channel_identities SET source = ?, confidence = ?, conversation_id = ?, updated_at = ? WHERE channel = ? AND account_id = ? AND platform_user_id = ?').run(finalSource, Math.max(confidence, rowNumber(existing, 'confidence'), rowNumber(existingBeforeWrite ?? {}, 'confidence')), finalConversationId, timestamp, channel, accountId, platformUserId);
    return this.channelFromRow(this.db.prepare('SELECT * FROM channel_identities WHERE channel = ? AND account_id = ? AND platform_user_id = ?').get(channel, accountId, platformUserId)!);
  }

  linkAccount(input: LinkAccountInput): ExternalAccountRecord {
    const personId = clean(input.personId, 'person_id', 128);
    this.requirePerson(personId);
    const provider = clean(input.provider, 'identity_provider', 128).toLocaleLowerCase();
    const externalId = clean(input.externalId, 'identity_external_id', 256);
    const externalKey = key(externalId);
    const source = input.source ?? 'confirmed';
    if (source !== 'confirmed' && source !== 'preset') throw new Error('identity_external_source_invalid');
    const confidence = boundedConfidence(input.confidence, 1);
    const label = optionalClean(input.label, 256);
    const accountId = stableId('external', `${provider}\u0000${externalKey}`);
    const timestamp = nowIso(this.now);
    const existingBeforeWrite = this.db.prepare('SELECT * FROM external_accounts WHERE provider = ? AND external_key = ?').get(provider, externalKey);
    this.db.prepare('INSERT OR IGNORE INTO external_accounts (account_id, person_id, provider, external_id, external_key, label, source, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(accountId, personId, provider, externalId, externalKey, label ?? null, source, confidence, timestamp, timestamp);
    const existing = this.db.prepare('SELECT * FROM external_accounts WHERE provider = ? AND external_key = ?').get(provider, externalKey);
    if (existing && rowText(existing, 'person_id') !== personId) throw new Error('identity_external_already_bound');
    if (!existing) throw new Error('identity_external_write_failed');
    const existingSource = rowText(existing, 'source');
    if (!(existingSource in EXTERNAL_SOURCE_RANK)) throw new Error('identity_external_source_invalid');
    const finalSource = EXTERNAL_SOURCE_RANK[source] >= EXTERNAL_SOURCE_RANK[existingSource as Exclude<AliasSource, 'observed'>] ? source : existingSource as Exclude<AliasSource, 'observed'>;
    this.db.prepare('UPDATE external_accounts SET external_id = ?, label = ?, source = ?, confidence = ?, updated_at = ? WHERE account_id = ?').run(externalId, label ?? rowOptional(existing, 'label') ?? null, finalSource, Math.max(confidence, rowNumber(existing, 'confidence'), rowNumber(existingBeforeWrite ?? {}, 'confidence')), timestamp, accountId);
    return this.externalFromRow(this.db.prepare('SELECT * FROM external_accounts WHERE account_id = ?').get(accountId)!);
  }

  private channelKey(identity: TrustedChannelIdentity): { channel: string; accountId: string; platformUserId: string } {
    return {
      channel: normalizedChannel(identity.channel),
      accountId: optionalClean(identity.accountId, 128) ?? '',
      platformUserId: clean(identity.platformUserId, 'platform_user_id', 256),
    };
  }

  private currentIdentity(context: IdentityContext): TrustedChannelIdentity | undefined {
    if (!context.channel || !context.senderId) return undefined;
    return {
      channel: context.channel,
      ...(context.accountId ? { accountId: context.accountId } : {}),
      ...(context.conversationId ? { conversationId: context.conversationId } : {}),
      platformUserId: context.senderId,
    };
  }

  private findChannel(identity: TrustedChannelIdentity): ChannelIdentityRecord | undefined {
    const target = this.channelKey(identity);
    const row = this.db.prepare('SELECT * FROM channel_identities WHERE channel = ? AND account_id = ? AND platform_user_id = ?').get(target.channel, target.accountId, target.platformUserId);
    return row ? this.channelFromRow(row) : undefined;
  }

  private resolutionForChannel(identity: TrustedChannelIdentity, path: IdentityResolutionPath = 'platform'): IdentityResolution {
    const channelIdentity = this.findChannel(identity);
    if (!channelIdentity) {
      return {
        status: 'unbound',
        reliable: false,
        resolutionPath: 'unbound',
        unboundIdentity: identity,
        reason: 'trusted_channel_identity_is_not_bound',
      };
    }
    const person = this.getPerson(channelIdentity.personId);
    if (!person) return { status: 'unbound', reliable: false, resolutionPath: 'unbound', reason: 'bound_person_is_missing' };
    const resolutionPath: IdentityResolutionPath = channelIdentity.source === 'confirmed' ? 'owner-confirmed-binding' : path;
    return { status: 'resolved', reliable: true, resolutionPath, person, channelIdentity };
  }

  private aliasesFor(alias: string, scope: AliasScope, scopeId = ''): AliasRecord[] {
    const rows = this.db.prepare('SELECT * FROM aliases WHERE alias_key = ? AND scope = ? AND scope_id = ? ORDER BY confidence DESC, alias_id').all(key(alias), scope, scopeId);
    return rows.map((row) => this.aliasFromRow(row));
  }

  private resolutionForAliases(alias: string, scope: AliasScope | undefined, context: IdentityContext): IdentityResolution {
    const groupId = optionalScopeId(context.conversationId);
    const scopes: Array<{ scope: AliasScope; scopeId: string; path: Extract<IdentityResolutionPath, 'group-alias' | 'global-alias' | 'learned-candidate'> }> = [];
    if (scope === undefined || scope === 'group') {
      if (groupId) scopes.push({ scope: 'group', scopeId: groupId, path: 'group-alias' });
    }
    if (scope === undefined || scope === 'global') scopes.push({ scope: 'global', scopeId: '', path: 'global-alias' });
    const observedCandidates: IdentityResolutionCandidate[] = [];
    for (const candidateScope of scopes) {
      const matches = this.aliasesFor(alias, candidateScope.scope, candidateScope.scopeId);
      const authoritative = matches.filter((item) => item.source !== 'observed');
      if (authoritative.length === 1) {
        const match = authoritative[0]!;
        const person = this.getPerson(match.personId);
        if (person) return { status: 'resolved', reliable: true, resolutionPath: candidateScope.path, person };
      }
      if (authoritative.length > 1) {
        return {
          status: 'ambiguous',
          reliable: false,
          resolutionPath: candidateScope.path,
          candidates: authoritative.flatMap((item) => {
            const person = this.getPerson(item.personId);
            return person ? [{ alias: item, person }] : [];
          }),
          reason: 'multiple_confirmed_people_match_alias',
        };
      }
      if (matches.length) {
        observedCandidates.push(...matches.flatMap((item) => {
            const person = this.getPerson(item.personId);
            return person ? [{ alias: item, person }] : [];
          }));
      }
    }
    if (observedCandidates.length) return { status: 'candidate', reliable: false, resolutionPath: 'learned-candidate', candidates: observedCandidates, reason: 'observed_alias_requires_confirmation' };
    return { status: 'not_found', reliable: false, resolutionPath: 'unbound', reason: 'alias_not_found' };
  }

  resolve(reference: IdentityReference, context: IdentityContext = {}): IdentityResolution {
    if (reference.type === 'self') {
      const current = this.currentIdentity(context);
      return current ? this.resolutionForChannel(current) : { status: 'unbound', reliable: false, resolutionPath: 'unbound', reason: 'trusted_sender_metadata_unavailable' };
    }
    if (reference.type === 'person') {
      const person = this.getPerson(reference.personId);
      return person ? { status: 'resolved', reliable: true, resolutionPath: 'person', person } : { status: 'not_found', reliable: false, resolutionPath: 'unbound', reason: 'person_not_found' };
    }
    if (reference.type === 'alias') return this.resolutionForAliases(reference.alias, reference.scope, context);
    if (reference.type === 'reply_sender') {
      return context.replySender ? this.resolutionForChannel(context.replySender) : { status: 'unbound', reliable: false, resolutionPath: 'unbound', reason: 'trusted_reply_sender_metadata_unavailable' };
    }
    const mention = context.mentions?.[reference.index];
    return mention ? this.resolutionForChannel(mention) : { status: 'unbound', reliable: false, resolutionPath: 'unbound', reason: 'trusted_mention_metadata_unavailable' };
  }

  listCandidates(options: { scope?: AliasScope; scopeId?: string; context?: IdentityContext } = {}): IdentityResolutionCandidate[] {
    const context = options.context ?? {};
    const scope = options.scope;
    const scopeId = scope === 'group'
      ? clean(options.scopeId ?? context.conversationId, 'identity_scope_id', 256)
      : options.scope === 'global' ? '' : undefined;
    const rows = scope
      ? this.db.prepare('SELECT * FROM aliases WHERE source = ? AND scope = ? AND scope_id = ? ORDER BY confidence DESC, alias_key').all('observed', scope, scopeId ?? '')
      : context.conversationId
        ? this.db.prepare("SELECT * FROM aliases WHERE source = 'observed' AND ((scope = 'group' AND scope_id = ?) OR scope = 'global') ORDER BY confidence DESC, alias_key").all(context.conversationId)
        : this.db.prepare("SELECT * FROM aliases WHERE source = 'observed' AND scope = 'global' ORDER BY confidence DESC, alias_key").all();
    return rows.flatMap((row) => {
      const alias = this.aliasFromRow(row);
      const person = this.getPerson(alias.personId);
      return person ? [{ alias, person }] : [];
    });
  }

  confirmCandidate(candidateId: string): AliasRecord {
    const id = clean(candidateId, 'identity_candidate_id', 128);
    const row = this.db.prepare('SELECT * FROM aliases WHERE alias_id = ?').get(id);
    if (!row) throw new Error('identity_candidate_not_found');
    const timestamp = nowIso(this.now);
    this.db.prepare('UPDATE aliases SET source = ?, confidence = ?, updated_at = ? WHERE alias_id = ?').run('confirmed', 1, timestamp, id);
    return this.aliasFromRow(this.db.prepare('SELECT * FROM aliases WHERE alias_id = ?').get(id)!);
  }

  seedPresets(presets: IdentityPreset[]): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const preset of presets) {
        const personId = personIdForPreset(preset);
        this.ensurePerson(personId, preset.displayName);
        this.upsertAlias({ personId, alias: preset.displayName, scope: 'global', source: 'preset', confidence: 1 });
        for (const alias of preset.aliases ?? []) this.upsertAlias({ personId, alias, scope: 'global', source: 'preset', confidence: 1 });
        for (const account of preset.externalAccounts ?? []) this.linkAccount({ personId, ...account, source: 'preset', confidence: 1 });
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
