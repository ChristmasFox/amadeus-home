import type { TargetProfile } from '../../core/target-profile/model.js';
import type { SearchPlan, SearchQuery, SourceSearchPlanner } from '../../core/search/model.js';

const ALIASES: Record<string, string[]> = {
  'chrome hearts': ['크롬하츠'],
  'chromehearts': ['크롬하츠'],
  'yohji yamamoto': ['요지 야마모토'],
  yohji: ['요지 야마모토', '요지'],
  undercover: ['언더커버'],
  visvim: ['비즈빔'],
  'stone island': ['스톤아일랜드'],
  '羽绒服': ['패딩', '다운 자켓'],
  'down jacket': ['다운 자켓'],
  puffer: ['패딩'],
  hoodie: ['후드티'],
  'zip hoodie': ['집업 후드'],
  '黑色': ['블랙'],
  black: ['블랙'],
  white: ['화이트'],
  gray: ['그레이'],
  grey: ['그레이'],
  red: ['레드'],
  '秋冬': ['FW'],
  '春夏': ['SS'],
};

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return normalized || undefined;
}

function uniqueStrings(values: Iterable<unknown>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const item = clean(value);
    if (!item) continue;
    const key = normalizeSearchQuery(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function normalizeSearchQuery(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\-_/]+/gu, ' ').trim();
}

function deduplicateQueries(queries: SearchQuery[]): SearchQuery[] {
  const seen = new Set<string>();
  const result: SearchQuery[] = [];
  for (const query of queries) {
    const text = clean(query.query);
    if (!text) continue;
    const canonicalQuery = normalizeSearchQuery(text);
    if (!canonicalQuery || seen.has(canonicalQuery)) continue;
    seen.add(canonicalQuery);
    result.push({ ...query, query: text, canonicalQuery });
  }
  return result;
}

function selectLayeredQueries(queries: SearchQuery[], limit = 4): SearchQuery[] {
  const unique = deduplicateQueries(queries);
  const selected: SearchQuery[] = [];
  const selectedKeys = new Set<string>();
  const add = (item: SearchQuery | undefined): void => {
    if (!item || selected.length >= limit || selectedKeys.has(item.canonicalQuery)) return;
    selected.push(item);
    selectedKeys.add(item.canonicalQuery);
  };

  // Explicit user terms are kept first. The remaining slots deliberately span
  // specific, medium, and broad coverage instead of being filled by only the
  // most detailed planner candidates.
  for (const item of unique.filter((candidate) => candidate.tier === 'explicit')) add(item);
  const remaining = limit - selected.length;
  const tiers = remaining >= 3 ? ['specific', 'medium', 'broad'] as const
    : remaining === 2 ? ['specific', 'broad'] as const
      : ['specific'] as const;
  for (const tier of tiers) add(unique.find((item) => item.tier === tier));
  for (const item of unique) add(item);
  return selected;
}

function aliases(value: string | undefined): string[] {
  if (!value) return [];
  const normalized = value.toLocaleLowerCase();
  return uniqueStrings([value, ...(ALIASES[normalized] ?? [])]);
}

function localizedAliases(value: string): string[] {
  const values = aliases(value);
  const hasHangul = values.some((item) => /[\uac00-\ud7a3]/u.test(item));
  return hasHangul ? values.filter((item) => !/[\u3400-\u9fff]/u.test(item)) : values;
}

function preferredAlias(value: string): string {
  const values = localizedAliases(value);
  return values.find((item) => /[\uac00-\ud7a3]/u.test(item)) ?? values[0] ?? value;
}

function profileCategories(profile: TargetProfile): string[] {
  const values = [profile.category, profile.subcategory, ...(profile.features ?? [])]
    .filter((value): value is string => Boolean(clean(value)));
  const result: string[] = [];
  for (const value of values) result.push(preferredAlias(value), ...localizedAliases(value));
  const hasDownCategory = result.some((item) => ['羽绒服', 'down jacket', 'puffer jacket', '패딩', '다운 자켓'].includes(item.toLocaleLowerCase()));
  return hasDownCategory ? uniqueStrings(['패딩', '다운 자켓', ...result]) : uniqueStrings(result);
}

function profileBrands(profile: TargetProfile): string[] {
  const values = [profile.brand, ...(profile.userHints ?? []).filter((hint) => /brand|品牌/iu.test(hint))]
    .filter((value): value is string => Boolean(clean(value)));
  const result: string[] = [];
  for (const value of values) result.push(preferredAlias(value), ...localizedAliases(value));
  return uniqueStrings(result);
}

function profileColors(profile: TargetProfile): string[] {
  return uniqueStrings((profile.colors ?? []).flatMap((value) => [preferredAlias(value), ...localizedAliases(value)]));
}

function profileMaterials(profile: TargetProfile): string[] {
  return uniqueStrings(profile.materials ?? []);
}

function compose(parts: Array<string | undefined>): string | undefined {
  const values = uniqueStrings(parts);
  return values.length > 0 ? values.join(' ') : undefined;
}

function query(queryText: string | undefined, tier: SearchQuery['tier'], source: SearchQuery['source']): SearchQuery | undefined {
  return queryText === undefined ? undefined : { query: queryText, canonicalQuery: '', tier, source };
}

export class BunjangSearchPlanner implements SourceSearchPlanner {
  readonly source = 'bunjang';

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  plan(profile: TargetProfile): SearchPlan {
    const queries: SearchQuery[] = [];
    const userTerms = uniqueStrings(profile.userSearchTerms ?? []);
    const otherExplicitTerms = uniqueStrings((profile.explicitSearchTerms ?? []).filter((term) => {
      const key = normalizeSearchQuery(term);
      return !userTerms.some((userTerm) => normalizeSearchQuery(userTerm) === key);
    }));
    for (const term of userTerms) {
      const item = query(term, 'explicit', 'user');
      if (item) queries.push(item);
    }
    for (const term of otherExplicitTerms) {
      const item = query(term, 'explicit', 'user');
      if (item) queries.push(item);
    }

    const brands = profileBrands(profile);
    const categories = profileCategories(profile);
    const seasons = aliases(clean(profile.season));
    const colors = profileColors(profile);
    const materials = profileMaterials(profile);
    const modelName = clean(profile.modelName);
    const primaryBrand = brands[0];
    const primaryCategory = categories[0];
    const primarySeason = seasons[0];
    const primaryColor = colors[0];
    const primaryMaterial = materials[0];
    const includeKeyword = uniqueStrings(profile.includeKeywords ?? [])[0];

    // Keep the source plan small, but make each layer useful. The selector
    // below guarantees one specific, one medium, and one broad query whenever
    // the profile contains enough information for those layers.
    for (const category of categories.slice(0, 2)) {
      const item = query(compose([primaryBrand, modelName, primarySeason, category, includeKeyword]), 'specific', 'planner');
      if (item) queries.push(item);
      const seasonal = query(compose([primaryBrand, primarySeason, category]), 'specific', 'planner');
      if (seasonal) queries.push(seasonal);
      const model = query(compose([modelName, primarySeason, category]), 'specific', 'planner');
      if (model) queries.push(model);
    }

    const mediumCandidates = [
      compose([primaryBrand, modelName, primaryCategory]),
      compose([primaryBrand, primaryCategory]),
      compose([primaryBrand, primarySeason]),
      compose([modelName, primaryCategory]),
      primaryColor && primaryCategory ? compose([primaryColor, primaryCategory]) : undefined,
      primaryMaterial && primaryCategory ? compose([primaryMaterial, primaryCategory]) : undefined,
    ];
    for (const [index, candidate] of mediumCandidates.entries()) {
      const item = query(candidate, 'medium', index >= 4 ? 'inferred' : 'planner');
      if (item) queries.push(item);
    }

    for (const category of categories.slice(0, 2)) {
      const item = query(category, 'broad', 'inferred');
      if (item) queries.push(item);
    }
    if (categories.length === 0) {
      for (const candidate of [primaryMaterial, primaryColor, clean(profile.features?.[0]), includeKeyword, modelName, primaryBrand, primarySeason]) {
        const item = query(candidate, 'broad', 'inferred');
        if (item) queries.push(item);
      }
    }
    if (queries.length === 0) queries.push({ query: '패션', canonicalQuery: '', tier: 'broad', source: 'inferred' });

    return {
      source: this.source,
      queries: selectLayeredQueries(queries),
      generatedAt: this.now(),
      ...(profile.provider ? { profileProvider: profile.provider } : {}),
    };
  }
}
