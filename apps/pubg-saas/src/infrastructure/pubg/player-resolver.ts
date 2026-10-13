import { PubgApiClient, PubgApiError } from '@agent/pubg-domain/core';
import type { PublicPubgAdmission } from './request-limiter.js';

export interface ResolvedPubgPlayer { accountId: string; name: string; }
export interface PubgNameResolution {
  players: ResolvedPubgPlayer[];
  missingNames: string[];
  ambiguousNames: string[];
}
export interface PublicPubgPlayerResolverPort {
  resolveNames(shard: string, names: string[], signal?: AbortSignal): Promise<PubgNameResolution>;
}

export function validatePublicPubgShard(shard: string): string {
  if (!['steam', 'kakao', 'psn', 'xbox'].includes(shard)) throw new Error('public_pubg_shard_invalid');
  return shard;
}

/** Uses the shared API implementation with independent public credentials and
 * a mandatory public admission controller. No private team/plugin is loaded. */
export class PublicPubgPlayerResolver implements PublicPubgPlayerResolverPort {
  private readonly client: PubgApiClient;
  constructor(options: { apiKey: string; admission: PublicPubgAdmission; fetcher?: typeof fetch }) {
    if (!options.apiKey.trim()) throw new Error('public_pubg_api_key_missing');
    const fetcher = options.fetcher ?? fetch;
    this.client = new PubgApiClient({
      apiKey: options.apiKey, baseUrl: 'https://api.pubg.com', maxRetries: 0, timeoutMs: 15_000,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        if (url.origin !== 'https://api.pubg.com' || !/^\/shards\/(steam|kakao|psn|xbox)\/players$/u.test(url.pathname)) throw new Error('public_pubg_endpoint_invalid');
        try { await options.admission.acquire(init?.signal ?? undefined); }
        catch (error) {
          if (error instanceof Error && error.message === 'public_pubg_lookup_rate_limited') throw new PubgApiError('rate_limited', 'Public PUBG admission busy', false);
          throw error;
        }
        const response = await fetcher(url, { ...init, redirect: 'error' });
        await options.admission.observe(response.headers, response.status);
        return response;
      },
    });
  }

  async resolveNames(shard: string, names: string[], signal?: AbortSignal): Promise<PubgNameResolution> {
    validatePublicPubgShard(shard);
    if (!Array.isArray(names) || names.length < 1 || names.length > 4
      || names.some(name => typeof name !== 'string' || !name.trim() || name.length > 100 || /[,\u0000-\u001f]/u.test(name))
      || new Set(names.map(name => name.trim().toLowerCase())).size !== names.length) throw new Error('public_pubg_names_invalid');
    const requested = names.map(name => name.trim());
    let entries: Array<Record<string, unknown>>;
    try { entries = await this.client.discoverPlayers(shard, [], requested, signal); }
    catch (error) {
      if (error instanceof PubgApiError && error.code === 'not_found') return { players: [], missingNames: requested, ambiguousNames: [] };
      if (error instanceof PubgApiError && error.code === 'rate_limited') throw new Error('public_pubg_lookup_rate_limited');
      if (error instanceof Error && error.message === 'public_pubg_lookup_rate_limited') throw error;
      // Shared client may normalize fetch/admission failures into PubgApiError;
      // never pass upstream details or credential values to user messages.
      throw new Error('public_pubg_lookup_unavailable');
    }
    const players: ResolvedPubgPlayer[] = [], missingNames: string[] = [], ambiguousNames: string[] = [];
    for (const name of requested) {
      const matches = entries.filter(entry => entry.type === 'player' && entry.attributes && typeof entry.attributes === 'object'
        && typeof (entry.attributes as { name?: unknown }).name === 'string'
        && ((entry.attributes as { name: string }).name).toLowerCase() === name.toLowerCase());
      const unique = new Map<string, ResolvedPubgPlayer>();
      for (const entry of matches) {
        if (typeof entry.id !== 'string' || !/^account\.[A-Za-z0-9_-]{1,128}$/u.test(entry.id)) throw new Error('public_pubg_lookup_invalid_response');
        const apiName = (entry.attributes as { name: string }).name;
        if (!apiName.trim() || apiName.length > 100) throw new Error('public_pubg_lookup_invalid_response');
        unique.set(entry.id, { accountId: entry.id, name: apiName });
      }
      if (!unique.size) missingNames.push(name);
      else if (unique.size > 1) ambiguousNames.push(name);
      else players.push([...unique.values()][0]!);
    }
    if (new Set(players.map(player => player.accountId)).size !== players.length) throw new Error('public_pubg_lookup_invalid_response');
    return { players, missingNames, ambiguousNames };
  }
}
