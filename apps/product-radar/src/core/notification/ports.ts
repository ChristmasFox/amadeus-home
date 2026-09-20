import type { RadarEvent } from '../events/events.js';

export interface NotificationMessage {
  event: RadarEvent;
  recipient: string;
  payload?: unknown;
  /** Compatibility only for pre-1.4.2 persisted rows; new producers use payload. */
  text?: string;
}

export interface NotificationChannel {
  readonly id: string;
  readonly recipient: string;
  prepare?(event: RadarEvent, sourceDisplayName: string): NotificationMessage;
  prepareHeartbeat?(event: RadarEvent, payload: unknown, sourceDisplayName: string): NotificationMessage;
  send(message: NotificationMessage): Promise<void>;
}

export interface NotificationSourceLabelResolver {
  displayName(source: string): string;
}
