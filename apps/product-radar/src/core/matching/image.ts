export interface ImageSource {
  url?: string;
  base64?: string;
}

export interface PreparedImageReference {
  id: string;
  contentHash: string;
}

export interface ImageMatchResult {
  score: number;
  comparedImages: number;
  bestImageUrl?: string;
}

export interface ImageMatcher {
  prepareReference(source: ImageSource): Promise<PreparedImageReference>;
  match(referenceId: string, candidateImageUrls: string[]): Promise<ImageMatchResult>;
}
