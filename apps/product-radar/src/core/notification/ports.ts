import type { RadarEvent } from '../events/events.js';

export interface NotificationMessage {
  event: RadarEvent;
  text: string;
  recipient: string;
}

export interface NotificationChannel {
  readonly id: string;
  readonly recipient: string;
  send(message: NotificationMessage): Promise<void>;
}

export interface NotificationSourceLabelResolver {
  displayName(source: string): string;
}
