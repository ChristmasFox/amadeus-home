export type OwnerNotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export interface OwnerNotificationFact {
  label: string;
  value: string | number | boolean | null;
  evidenceRefs: string[];
}

export interface OwnerNotificationPresentation {
  type: 'owner_notification';
  eventType: string;
  severity: OwnerNotificationSeverity;
  eventKey: string;
  source: string;
  headline: string;
  facts: OwnerNotificationFact[];
  summary?: string;
  dataUpdatedAt?: string;
  occurredAt: string;
  worldLineClosing?: boolean;
}
