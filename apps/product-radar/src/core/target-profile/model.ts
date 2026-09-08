import type { ImageSource } from '../matching/image.js';

export type ProfileProvenanceSource = 'user' | 'vision' | 'ocr' | 'inferred' | 'fallback';

export interface ProfileProvenance {
  source: ProfileProvenanceSource;
  confidence?: number;
}

export type TargetConstraintOperator = 'equals' | 'contains' | 'not_contains' | 'gte' | 'lte';

export interface TargetConstraint {
  field: string;
  operator: TargetConstraintOperator;
  value: string | number | string[];
  source: ProfileProvenanceSource;
  confidence?: number;
}

export interface TargetHint {
  field: string;
  value: string | number | string[];
  source: ProfileProvenanceSource;
  confidence?: number;
}

export interface VisionProfile {
  provider?: string;
  brand?: string;
  modelName?: string;
  season?: string;
  category?: string;
  subcategory?: string;
  colors?: string[];
  materials?: string[];
  features?: string[];
  detectedText?: string[];
  size?: string;
  minPrice?: number;
  maxPrice?: number;
  includeKeywords?: string[];
  excludeKeywords?: string[];
  userHints?: string[];
  explicitSearchTerms?: string[];
  confidence?: Partial<Record<keyof VisionProfile, number>>;
}

export interface VisionProfileInput {
  referenceImage?: ImageSource;
  userText?: string;
  explicitKeywords?: string[];
  explicitSearchTerms?: string[];
}

export interface VisionProfileProvider {
  readonly id: string;
  analyze(input: VisionProfileInput): Promise<VisionProfile>;
}

export interface TargetProfile {
  brand?: string;
  modelName?: string;
  season?: string;
  category?: string;
  subcategory?: string;
  colors: string[];
  materials: string[];
  features: string[];
  detectedText: string[];
  userHints: string[];
  hardConstraints: TargetConstraint[];
  softHints: TargetHint[];
  explicitSearchTerms: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  size?: string;
  minPrice?: number;
  maxPrice?: number;
  provider: string;
  extractedAt: string;
  provenance: Record<string, ProfileProvenance>;
}

export interface TargetProfileExtractionInput extends VisionProfileInput {
  /** A previously analyzed provider result, supplied by a platform adapter such as LangBot. */
  visionProfile?: VisionProfile;
  visionProvider?: string;
}
