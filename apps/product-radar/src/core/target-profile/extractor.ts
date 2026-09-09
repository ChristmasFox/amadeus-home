import type { ImageSource } from '../matching/image.js';
import type {
  ProfileProvenance,
  ProfileProvenanceSource,
  TargetConstraint,
  TargetHint,
  TargetProfile,
  TargetProfileExtractionInput,
  VisionProfile,
  VisionProfileInput,
  VisionProfileProvider,
} from './model.js';

const FIELD_NAMES = ['brand', 'modelName', 'season', 'category', 'subcategory', 'size', 'minPrice', 'maxPrice'] as const;
type ScalarField = (typeof FIELD_NAMES)[number];

const KNOWN_BRANDS = [
  'Chrome Hearts', 'Yohji Yamamoto', 'Yohji', 'Undercover', 'VISVIM', 'Visvim',
  'Stone Island', '스톤아일랜드', '크롬하츠', '요지 야마모토', '요지', '언더커버', '비즈빔',
] as const;
const CATEGORY_TERMS: Array<[string, string]> = [
  ['羽绒服', '羽绒服'], ['羽绒', '羽绒服'], ['down jacket', 'down jacket'], ['puffer', 'puffer jacket'],
  ['패딩', '패딩'], ['다운 자켓', '다운 자켓'], ['다운', '다운 자켓'], ['夹克', '夹克'], ['hoodie', 'hoodie'],
  ['卫衣', '卫衣'], ['zip hoodie', 'zip hoodie'], ['coat', 'coat'], ['大衣', '大衣'], ['jacket', 'jacket'],
  ['服饰', '服饰'], ['의류', '의류'],
];
const COLOR_TERMS = ['黑色', '黑', 'black', '블랙', '白色', '白', 'white', '红色', 'red', '灰色', '灰', 'gray', 'grey', '蓝色', 'blue', '绿色', 'green', '棕色', 'brown', '米色', 'beige'] as const;
const MATERIAL_TERMS = ['羽绒', 'down', '尼龙', 'nylon', '羊毛', 'wool', '棉', 'cotton', '皮革', 'leather', '캐시미어', 'cashmere'] as const;

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return result || undefined;
}

function unique(values: Iterable<unknown>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const item = clean(value);
    if (!item) continue;
    const key = item.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function confidenceOf(vision: VisionProfile, field: keyof VisionProfile): number | undefined {
  const value = vision.confidence?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function provenance(source: ProfileProvenanceSource, confidence?: number): ProfileProvenance {
  return confidence === undefined ? { source } : { source, confidence };
}

function addConstraint(target: TargetConstraint[], field: string, operator: TargetConstraint['operator'], value: TargetConstraint['value'], source: ProfileProvenanceSource, confidence?: number): void {
  target.push({ field, operator, value, source, ...(confidence === undefined ? {} : { confidence }) });
}

function addHint(target: TargetHint[], field: string, value: TargetHint['value'], source: ProfileProvenanceSource, confidence?: number): void {
  target.push({ field, value, source, ...(confidence === undefined ? {} : { confidence }) });
}

function textParts(text: string): string[] {
  return text.normalize('NFKC').split(/[，,。.!！?？;；\n]+/u).map((part) => part.trim()).filter(Boolean);
}

function matchKnownBrand(text: string): string | undefined {
  const lower = text.toLocaleLowerCase();
  return [...KNOWN_BRANDS].sort((a, b) => b.length - a.length).find((brand) => lower.includes(brand.toLocaleLowerCase()));
}

function matchTerm(text: string, terms: readonly string[]): string | undefined {
  const lower = text.toLocaleLowerCase();
  return [...terms].sort((a, b) => b.length - a.length).find((term) => lower.includes(term.toLocaleLowerCase()));
}

function parseSeason(text: string): string | undefined {
  const match = /\b((?:19|20)?\d{2}\s*(?:AW|SS|FW|春夏|秋冬)|(?:AW|SS|FW)\s*\d{2})\b/iu.exec(text);
  return match?.[1]?.replace(/\s+/gu, '').toUpperCase();
}

function parseNumber(value: string): number | undefined {
  const normalized = value.replaceAll(',', '').trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

interface UserSignals {
  values: Partial<Record<ScalarField, string | number>>;
  colors: string[];
  materials: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  userSearchTerms: string[];
  explicitSearchTerms: string[];
  hardConstraints: TargetConstraint[];
  userHints: string[];
}

function parseUserSignals(text: string, explicitKeywords: string[] = [], explicitSearchTerms: string[] = []): UserSignals {
  const values: UserSignals['values'] = {};
  const colors: string[] = [];
  const materials: string[] = [];
  const includes = [...explicitKeywords];
  const excludes: string[] = [];
  const searchTerms = [...explicitSearchTerms];
  const hardConstraints: TargetConstraint[] = [];
  const userHints: string[] = [];
  const normalized = text.normalize('NFKC');

  const brand = matchKnownBrand(normalized);
  if (brand) {
    values.brand = brand;
    addConstraint(hardConstraints, 'brand', 'equals', brand, 'user');
  }
  const season = parseSeason(normalized);
  if (season) {
    values.season = season;
    addConstraint(hardConstraints, 'season', 'equals', season, 'user');
  }
  const category = matchTerm(normalized, CATEGORY_TERMS.map(([term]) => term));
  if (category) {
    values.category = CATEGORY_TERMS.find(([term]) => term.toLocaleLowerCase() === category.toLocaleLowerCase())?.[1] ?? category;
    addConstraint(hardConstraints, 'category', 'equals', values.category, 'user');
  }
  const color = matchTerm(normalized, COLOR_TERMS);
  if (color) {
    colors.push(color);
    addConstraint(hardConstraints, 'color', 'equals', color, 'user');
  }
  const material = matchTerm(normalized, MATERIAL_TERMS);
  if (material) {
    materials.push(material);
    addConstraint(hardConstraints, 'material', 'equals', material, 'user');
  }

  const model = /(?:型号|款号|model|item)\s*[:：]?\s*([\w-]+)/iu.exec(normalized);
  if (model?.[1]) {
    values.modelName = model[1];
    addConstraint(hardConstraints, 'modelName', 'equals', model[1], 'user');
  }

  const explicitPrice = /(?:价格|预算|价位|不超过|最多|最高|under|below|less than|up to)\s*[:：]?\s*[¥￥₩$]?\s*([\d,.]+)/iu.exec(normalized);
  const minPrice = /(?:至少|最低|不低于|above|over|from)\s*[:：]?\s*[¥￥₩$]?\s*([\d,.]+)/iu.exec(normalized);
  if (explicitPrice?.[1]) {
    const value = parseNumber(explicitPrice[1]);
    if (value !== undefined) {
      values.maxPrice = value;
      addConstraint(hardConstraints, 'maxPrice', 'lte', value, 'user');
    }
  }
  if (minPrice?.[1]) {
    const value = parseNumber(minPrice[1]);
    if (value !== undefined) {
      values.minPrice = value;
      addConstraint(hardConstraints, 'minPrice', 'gte', value, 'user');
    }
  }

  for (const part of textParts(normalized)) {
    const include = /(?:必须|只要|包含|关键词|include)\s*[:：]?\s*(.+)$/iu.exec(part);
    if (include?.[1]) {
      const values = include[1].split(/[、,，/\s]+/u).filter(Boolean);
      includes.push(...values);
      for (const item of values) addConstraint(hardConstraints, 'keywords', 'contains', item, 'user');
    }
    const exclude = /(?:不要|排除|不含|exclude)\s*[:：]?\s*(.+)$/iu.exec(part);
    if (exclude?.[1]) {
      excludes.push(...exclude[1].split(/[、,，/\s]+/u));
      for (const item of exclude[1].split(/[、,，/\s]+/u)) {
        if (clean(item)) addConstraint(hardConstraints, 'keywords', 'not_contains', clean(item)!, 'user');
      }
    }
    const explicitQuery = /(?:搜索词|搜索|search(?: term)?|query)\s*[:：]?\s*(.+)$/iu.exec(part);
    if (explicitQuery?.[1]) searchTerms.push(explicitQuery[1]);
  }

  const hasHard = hardConstraints.length > 0;
  if (!hasHard && text.trim()) userHints.push(text.trim());
  return {
    values,
    colors: unique(colors),
    materials: unique(materials),
    includeKeywords: unique(includes),
    excludeKeywords: unique(excludes),
    userSearchTerms: unique(searchTerms),
    explicitSearchTerms: unique(searchTerms),
    hardConstraints,
    userHints: unique(userHints),
  };
}

function visionValue<T>(vision: VisionProfile | undefined, field: keyof VisionProfile): T | undefined {
  if (!vision) return undefined;
  return vision[field] as T | undefined;
}

function mergeScalar(
  field: ScalarField,
  user: UserSignals,
  vision: VisionProfile | undefined,
  profile: Partial<TargetProfile>,
  sources: Record<string, ProfileProvenance>,
): void {
  const explicit = user.values[field];
  if (explicit !== undefined) {
    (profile as Record<string, unknown>)[field] = explicit;
    sources[field] = provenance('user');
    return;
  }
  const candidate = clean(visionValue<unknown>(vision, field));
  if (candidate) {
    const confidence = confidenceOf(vision ?? {}, field);
    (profile as Record<string, unknown>)[field] = candidate;
    sources[field] = provenance('vision', confidence);
  }
}

function mergeArray(
  field: 'colors' | 'materials' | 'features' | 'detectedText' | 'includeKeywords' | 'excludeKeywords' | 'explicitSearchTerms',
  userValues: string[],
  visionValues: string[] | undefined,
  vision: VisionProfile | undefined,
  profile: Partial<TargetProfile>,
  sources: Record<string, ProfileProvenance>,
): void {
  const values = unique([...userValues, ...(visionValues ?? [])]);
  (profile as Record<string, unknown>)[field] = values;
  if (userValues.length > 0) sources[field] = provenance('user');
  else if (values.length > 0) sources[field] = provenance(field === 'detectedText' ? 'ocr' : 'vision', confidenceOf(vision ?? {}, field));
}

export class FallbackVisionProfileProvider implements VisionProfileProvider {
  readonly id = 'fallback';

  async analyze(_input: VisionProfileInput): Promise<VisionProfile> {
    return {};
  }
}

export interface TargetProfileExtractorOptions {
  provider?: VisionProfileProvider;
  now?: () => string;
}

export class TargetProfileExtractor {
  private readonly provider: VisionProfileProvider;
  private readonly now: () => string;

  constructor(options: TargetProfileExtractorOptions = {}) {
    this.provider = options.provider ?? new FallbackVisionProfileProvider();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async extract(input: TargetProfileExtractionInput): Promise<TargetProfile> {
    const user = parseUserSignals(input.userText ?? '', input.explicitKeywords, input.explicitSearchTerms);
    let vision = input.visionProfile;
    let provider = input.visionProvider ?? (vision ? this.provider.id : 'fallback');
    if (!vision && (input.referenceImage !== undefined || input.userText?.trim())) {
      try {
        vision = await this.provider.analyze(input);
        provider = this.provider.id;
      } catch {
        vision = undefined;
        provider = 'fallback';
      }
    }

    const profile: Partial<TargetProfile> = {
      colors: [], materials: [], features: [], detectedText: [], userHints: user.userHints, userSearchTerms: [],
      hardConstraints: [...user.hardConstraints], softHints: [], explicitSearchTerms: [], includeKeywords: [], excludeKeywords: [],
      provider, extractedAt: this.now(), provenance: {},
    };
    const sources = profile.provenance!;
    for (const field of FIELD_NAMES) mergeScalar(field, user, vision, profile, sources);
    mergeArray('colors', user.colors, vision?.colors, vision, profile, sources);
    mergeArray('materials', user.materials, vision?.materials, vision, profile, sources);
    mergeArray('features', [], vision?.features, vision, profile, sources);
    mergeArray('detectedText', [], vision?.detectedText, vision, profile, sources);
    // Keep the user's search wording distinct from provider-derived terms. The
    // multimodal LangBot boundary can supply this field directly; the core
    // extractor must not let visual text silently become a user constraint.
    profile.userSearchTerms = user.userSearchTerms;
    if (user.userSearchTerms.length > 0) sources.userSearchTerms = provenance('user');
    mergeArray('explicitSearchTerms', user.explicitSearchTerms, vision?.explicitSearchTerms, vision, profile, sources);
    mergeArray('includeKeywords', user.includeKeywords, vision?.includeKeywords, vision, profile, sources);
    mergeArray('excludeKeywords', user.excludeKeywords, vision?.excludeKeywords, vision, profile, sources);

    const size = clean(user.values.size) ?? clean(vision?.size);
    if (size) {
      profile.size = size;
      sources.size = user.values.size ? provenance('user') : provenance('vision', confidenceOf(vision ?? {}, 'size'));
    }
    const minPrice = typeof user.values.minPrice === 'number' ? user.values.minPrice : vision?.minPrice;
    const maxPrice = typeof user.values.maxPrice === 'number' ? user.values.maxPrice : vision?.maxPrice;
    if (minPrice !== undefined) {
      profile.minPrice = minPrice;
      sources.minPrice = user.values.minPrice !== undefined ? provenance('user') : provenance('vision', confidenceOf(vision ?? {}, 'minPrice'));
      if (!user.values.minPrice) addHint(profile.softHints!, 'minPrice', minPrice, 'vision', confidenceOf(vision ?? {}, 'minPrice'));
    }
    if (maxPrice !== undefined) {
      profile.maxPrice = maxPrice;
      sources.maxPrice = user.values.maxPrice !== undefined ? provenance('user') : provenance('vision', confidenceOf(vision ?? {}, 'maxPrice'));
      if (!user.values.maxPrice) addHint(profile.softHints!, 'maxPrice', maxPrice, 'vision', confidenceOf(vision ?? {}, 'maxPrice'));
    }

    for (const field of ['brand', 'modelName', 'season', 'category', 'subcategory', 'size'] as const) {
      const value = profile[field];
      if (value === undefined) continue;
      const source = sources[field]?.source ?? 'inferred';
      const confidence = sources[field]?.confidence;
      if (source === 'user') continue;
      addHint(profile.softHints!, field, value, source, confidence);
    }
    for (const color of profile.colors ?? []) {
      if (!user.colors.includes(color)) addHint(profile.softHints!, 'color', color, 'vision', confidenceOf(vision ?? {}, 'colors'));
    }
    for (const material of profile.materials ?? []) {
      if (!user.materials.includes(material)) addHint(profile.softHints!, 'material', material, 'vision', confidenceOf(vision ?? {}, 'materials'));
    }
    for (const feature of profile.features ?? []) addHint(profile.softHints!, 'feature', feature, 'vision', confidenceOf(vision ?? {}, 'features'));

    // Explicit user information always wins over a conflicting provider result.
    for (const field of ['brand', 'modelName', 'season', 'category', 'subcategory', 'size'] as const) {
      const value = user.values[field];
      if (value !== undefined) {
        profile.hardConstraints!.push({ field, operator: 'equals', value, source: 'user' });
      }
    }
    return profile as TargetProfile;
  }
}

export { parseUserSignals };
