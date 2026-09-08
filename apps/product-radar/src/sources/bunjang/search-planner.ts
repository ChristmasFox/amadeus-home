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

export function normalizeSearchQuery(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\-_/]+/gu, ' ').trim();
}

function uniqueQueries(queries: SearchQuery[]): SearchQuery[] {
  const seen = new Set<string>();
  const result: SearchQuery[] = [];
  for (const query of queries) {
    const text = clean(query.query);
    if (!text) continue;
    const canonicalQuery = normalizeSearchQuery(text);
    if (seen.has(canonicalQuery)) continue;
    seen.add(canonicalQuery);
    result.push({ ...query, query: text, canonicalQuery });
    if (result.length >= 4) break;
  }
  return result;
}

function aliases(value: string | undefined): string[] {
  if (!value) return [];
  const normalized = value.toLocaleLowerCase();
  return [value, ...(ALIASES[normalized] ?? [])].filter((item, index, list) => list.findIndex((candidate) => normalizeSearchQuery(candidate) === normalizeSearchQuery(item)) === index);
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
  const values = [profile.category, profile.subcategory, ...profile.features].filter((value): value is string => Boolean(clean(value)));
  const result: string[] = [];
  for (const value of values) result.push(preferredAlias(value), ...localizedAliases(value));
  if (result.some((item) => ['羽绒服', 'down jacket', 'puffer jacket', '패딩', '다운 자켓'].includes(item.toLocaleLowerCase()))) {
    result.push('패딩', '다운 자켓');
  }
  return [...new Set(result.map((value) => clean(value)).filter((value): value is string => Boolean(value)))];
}

function profileBrands(profile: TargetProfile): string[] {
  const values = [profile.brand, ...profile.userHints.filter((hint) => /brand|品牌/iu.test(hint))].filter((value): value is string => Boolean(clean(value)));
  const result: string[] = [];
  for (const value of values) result.push(preferredAlias(value), ...localizedAliases(value));
  return [...new Set(result.map((value) => clean(value)).filter((value): value is string => Boolean(value)))];
}

function profileColors(profile: TargetProfile): string[] {
  return profile.colors.flatMap((value) => [preferredAlias(value), ...localizedAliases(value)]);
}

export class BunjangSearchPlanner implements SourceSearchPlanner {
  readonly source = 'bunjang';

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  plan(profile: TargetProfile): SearchPlan {
    const queries: SearchQuery[] = [];
    for (const explicit of profile.explicitSearchTerms) {
      queries.push({ query: explicit, canonicalQuery: normalizeSearchQuery(explicit), tier: 'explicit', source: 'user' });
    }
    const brands = profileBrands(profile);
    const categories = profileCategories(profile);
    const seasons = profile.season ? aliases(profile.season) : [];
    const colors = profileColors(profile);
    const primaryBrand = brands[0];
    const primaryCategory = categories[0];
    const primarySeason = seasons[0];
    const primaryColor = colors[0];

    const secondaryCategory = categories[1];
    const secondaryBrand = brands[1];
    if (primaryBrand && primarySeason && primaryCategory) {
      queries.push({ query: `${primaryBrand} ${primarySeason} ${primaryCategory}`, canonicalQuery: '', tier: 'specific', source: 'planner' });
      if (secondaryCategory) queries.push({ query: `${primaryBrand} ${primarySeason} ${secondaryCategory}`, canonicalQuery: '', tier: 'specific', source: 'planner' });
    }
    if (primaryBrand && primaryCategory) {
      queries.push({ query: `${primaryBrand} ${primaryCategory}`, canonicalQuery: '', tier: 'medium', source: 'planner' });
    } else if (primaryBrand && primarySeason) {
      queries.push({ query: `${primaryBrand} ${primarySeason}`, canonicalQuery: '', tier: 'medium', source: 'planner' });
    }
    if (primaryColor && primaryCategory) {
      queries.push({ query: `${primaryColor} ${primaryCategory}`, canonicalQuery: '', tier: 'medium', source: 'inferred' });
    }
    if (secondaryBrand && primarySeason && secondaryCategory) {
      queries.push({ query: `${secondaryBrand} ${primarySeason} ${secondaryCategory}`, canonicalQuery: '', tier: 'medium', source: 'planner' });
    }
    if (primaryCategory) {
      for (const category of categories.slice(0, 2)) queries.push({ query: category, canonicalQuery: '', tier: 'broad', source: 'inferred' });
    }
    if (queries.length === 0) queries.push({ query: '의류', canonicalQuery: '', tier: 'broad', source: 'inferred' });
    return { source: this.source, queries: uniqueQueries(queries), generatedAt: this.now(), ...(profile.provider ? { profileProvider: profile.provider } : {}) };
  }
}
