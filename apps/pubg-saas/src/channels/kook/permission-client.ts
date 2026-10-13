interface KookApiEnvelope<T> {
  code: number;
  data: T;
}

interface GuildView {
  id?: string;
  user_id?: string;
}

interface GuildMember {
  id?: string;
  roles?: unknown[];
}

interface GuildRole {
  role_id?: unknown;
  permissions?: unknown;
}

interface PagedData<T> {
  items?: T[];
  meta?: { page_total?: unknown };
}

export interface KookPermissionClientOptions {
  token: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxRolePages?: number;
}

function requiredId(value: string, label: string): string {
  const id = value.trim();
  if (!id) throw new Error(`kook_${label}_required`);
  return id;
}

function parseEnvelope<T>(value: unknown): KookApiEnvelope<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('kook_permission_response_invalid');
  const candidate = value as Record<string, unknown>;
  if (candidate.code !== 0 || !('data' in candidate)) throw new Error('kook_permission_api_rejected');
  return { code: 0, data: candidate.data as T };
}

function parseId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return null;
}

function parsePermissions(value: unknown): bigint | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

/** Checks current KOOK guild ownership/admin roles through the official HTTP API.
 * No gateway-provided role list is accepted and no authorization result is cached. */
export class KookPermissionClient {
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRolePages: number;
  private readonly apiBase = 'https://www.kookapp.cn/api/v3';

  constructor(options: KookPermissionClientOptions) {
    this.token = requiredId(options.token, 'token');
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxRolePages = options.maxRolePages ?? 20;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) throw new Error('kook_timeout_invalid');
    if (!Number.isSafeInteger(this.maxRolePages) || this.maxRolePages < 1 || this.maxRolePages > 100) {
      throw new Error('kook_role_page_limit_invalid');
    }
  }

  private async get<T>(path: string, query: Record<string, string>): Promise<T> {
    const url = new URL(`${this.apiBase}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        headers: { Authorization: `Bot ${this.token}`, Accept: 'application/json', 'Cache-Control': 'no-cache' },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new Error('kook_permission_api_unavailable');
    }
    if (!response.ok) throw new Error(`kook_permission_api_http_${response.status}`);
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error('kook_permission_response_invalid'); }
    return parseEnvelope<T>(body).data;
  }

  private async getRolePermissions(guildId: string): Promise<Map<string, bigint>> {
    const permissions = new Map<string, bigint>();
    let pageTotal = 1;
    for (let page = 1; page <= pageTotal; page += 1) {
      if (page > this.maxRolePages) throw new Error('kook_permission_roles_unbounded');
      const data = await this.get<PagedData<GuildRole>>('guild-role/list', {
        guild_id: guildId,
        page: String(page),
        page_size: '50',
      });
      if (!Array.isArray(data.items) || !data.meta) throw new Error('kook_permission_roles_invalid');
      const total = Number(data.meta.page_total);
      if (!Number.isSafeInteger(total) || total < 1 || total > this.maxRolePages) {
        throw new Error('kook_permission_roles_unbounded');
      }
      pageTotal = total;
      for (const role of data.items) {
        const roleId = parseId(role.role_id);
        const bits = parsePermissions(role.permissions);
        if (!roleId || bits === null) throw new Error('kook_permission_roles_invalid');
        if (permissions.has(roleId)) throw new Error('kook_permission_roles_invalid');
        permissions.set(roleId, bits);
      }
    }
    return permissions;
  }

  /** Returns true only for the current guild owner or a user with the KOOK
   * Administrator permission bit. All HTTP/API errors fail closed by throwing. */
  async isGuildAdmin(guildIdInput: string, userIdInput: string): Promise<boolean> {
    const guildId = requiredId(guildIdInput, 'guild_id');
    const userId = requiredId(userIdInput, 'user_id');
    const guild = await this.get<GuildView>('guild/view', { guild_id: guildId });
    if (parseId(guild.id) !== guildId) throw new Error('kook_permission_guild_invalid');
    const ownerId = parseId(guild.user_id);
    if (!ownerId) throw new Error('kook_permission_guild_invalid');
    if (ownerId === userId) return true;

    const memberPage = await this.get<PagedData<GuildMember>>('guild/user-list', {
      guild_id: guildId,
      filter_user_id: userId,
      page: '1',
      page_size: '1',
    });
    if (!Array.isArray(memberPage.items)) throw new Error('kook_permission_member_invalid');
    const matches = memberPage.items.filter((item) => parseId(item.id) === userId);
    if (!matches.length) return false;
    if (matches.length !== 1) throw new Error('kook_permission_member_invalid');
    const member = matches[0]!;
    if (!Array.isArray(member.roles)) throw new Error('kook_permission_member_invalid');
    const memberRoles = new Set(member.roles.map(parseId).filter((id): id is string => id !== null));
    const rolePermissions = await this.getRolePermissions(guildId);
    const administratorBit = 1n;
    return [...memberRoles].some((roleId) => ((rolePermissions.get(roleId) ?? 0n) & administratorBit) !== 0n);
  }
}
