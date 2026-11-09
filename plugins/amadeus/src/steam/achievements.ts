import type { AchievementDefinition, AchievementState, Unknown } from './client.js';

/** The three achievement endpoints, so tools and the poller can run against a fake in tests. */
export interface AchievementClient {
  playerAchievements(steamId: string, appId: string): Promise<Unknown<AchievementState[]>>;
  achievementSchema(appId: string): Promise<AchievementDefinition[]>;
  achievementPercentages(appId: string): Promise<Map<string, number>>;
}

export interface AchievementView {
  apiName: string;
  /** Hidden achievements keep their name and description back until the person has unlocked them. */
  name?: string;
  description?: string;
  hidden: boolean;
  unlocked: boolean;
  unlockedAt?: string;
  /** Share of all players who unlocked it, in percent; absent when Steam does not say. */
  globalPercent?: number;
}

interface CatalogEntry { at: number; definitions: Map<string, AchievementDefinition>; percent: Map<string, number> }

const SCHEMA_TTL_MS = 24 * 3_600_000;
const PERCENT_TTL_MS = 6 * 3_600_000;

/** Names, descriptions and global rarity per game, cached so a follow-up question or a poll tick costs nothing extra. */
export class AchievementCatalog {
  private readonly schemas = new Map<string, { at: number; definitions: Map<string, AchievementDefinition> }>();
  private readonly percents = new Map<string, { at: number; percent: Map<string, number> }>();

  constructor(private readonly client: Pick<AchievementClient, 'achievementSchema' | 'achievementPercentages'>, private readonly now: () => number = Date.now) {}

  /** A failed lookup only loses the extra detail (names or rarity); it never blocks the answer. */
  async lookup(appId: string): Promise<CatalogEntry> {
    const now = this.now();
    let schema = this.schemas.get(appId);
    if (!schema || now - schema.at > SCHEMA_TTL_MS) {
      try { schema = { at: now, definitions: new Map((await this.client.achievementSchema(appId)).map((entry) => [entry.apiName, entry])) }; } catch { schema = schema ?? { at: now - SCHEMA_TTL_MS + 60_000, definitions: new Map() }; }
      this.schemas.set(appId, schema);
    }
    let percent = this.percents.get(appId);
    if (!percent || now - percent.at > PERCENT_TTL_MS) {
      try { percent = { at: now, percent: await this.client.achievementPercentages(appId) }; } catch { percent = percent ?? { at: now - PERCENT_TTL_MS + 60_000, percent: new Map() }; }
      this.percents.set(appId, percent);
    }
    return { at: now, definitions: schema.definitions, percent: percent.percent };
  }
}

export function viewOf(state: AchievementState, catalog: CatalogEntry): AchievementView {
  const definition = catalog.definitions.get(state.apiName);
  const hidden = definition?.hidden ?? false;
  const shown = state.achieved || !hidden;
  const name = state.name ?? definition?.name;
  const description = state.description ?? definition?.description;
  const percent = catalog.percent.get(state.apiName);
  return {
    apiName: state.apiName, hidden, unlocked: state.achieved,
    ...(shown && name ? { name } : {}),
    ...(shown && description ? { description } : {}),
    ...(state.unlockedAt ? { unlockedAt: new Date(state.unlockedAt).toISOString() } : {}),
    ...(percent !== undefined ? { globalPercent: percent } : {}),
  };
}

export type AchievementMode = 'summary' | 'rarest' | 'recent' | 'missing';

/** The answer for one person and one game: counts plus the slice the mode asks for (unlocked ones never include locked secrets). */
export function summariseAchievements(states: AchievementState[], catalog: CatalogEntry, mode: AchievementMode, limit: number): Record<string, unknown> {
  const views = states.map((state) => viewOf(state, catalog));
  const unlocked = views.filter((view) => view.unlocked);
  const locked = views.filter((view) => !view.unlocked);
  const byRarity = (a: AchievementView, b: AchievementView): number => (a.globalPercent ?? 101) - (b.globalPercent ?? 101);
  const byRecent = (a: AchievementView, b: AchievementView): number => (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? '');
  const total = views.length;
  const base = { total, unlocked: unlocked.length, completionPercent: total ? Math.round((unlocked.length / total) * 1000) / 10 : 0, hiddenLocked: locked.filter((view) => view.hidden).length };
  if (mode === 'rarest') return { ...base, rarestUnlocked: [...unlocked].sort(byRarity).slice(0, limit) };
  if (mode === 'recent') return { ...base, recentlyUnlocked: [...unlocked].sort(byRecent).slice(0, limit) };
  // The easiest ones still missing: highest global unlock rate first; secret ones are not spelled out.
  if (mode === 'missing') return { ...base, easiestMissing: locked.filter((view) => !view.hidden).sort((a, b) => byRarity(b, a)).slice(0, limit) };
  return { ...base, rarestUnlocked: [...unlocked].sort(byRarity).slice(0, Math.min(3, limit)), recentlyUnlocked: [...unlocked].sort(byRecent).slice(0, Math.min(3, limit)) };
}
