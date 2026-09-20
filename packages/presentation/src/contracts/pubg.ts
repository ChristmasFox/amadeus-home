export interface PresentationTextItem {
  text: string;
  evidenceRefs: string[];
}

export interface PubgMatchReviewOverview {
  placement: number | null;
  kills: number | null;
  assists: number | null;
  damage: number | null;
  dbnos: number | null;
  revives: number | null;
}

export interface PubgMatchReviewPresentation {
  type: 'pubg_match_review';
  headline: string;
  overview: PubgMatchReviewOverview;
  keyMoments: PresentationTextItem[];
  highlights: PresentationTextItem[];
  improvements: PresentationTextItem[];
  analysis: string;
  dataUpdatedAt: string;
  evidenceRefs: string[];
}

export interface PubgPeriodReviewMatch {
  matchId: string;
  label: string;
  startedAt: string | null;
  placement: number | null;
}

export interface PubgPeriodReviewPresentation {
  type: 'pubg_period_review';
  period: {
    label: string;
    displayDate?: string;
  };
  summary: string;
  orderedMatches: PubgPeriodReviewMatch[];
  highlights: PresentationTextItem[];
  patterns: PresentationTextItem[];
  analysis: string;
  dataUpdatedAt: string;
  evidenceRefs: string[];
}
