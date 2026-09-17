import type { RadarEvent } from '../events/events.js';
import { formatNotification } from './formatter.js';
import type { NotificationChannel, NotificationMessage, NotificationSourceLabelResolver } from './ports.js';
import type { SqliteRadarStore } from '../../storage/sqlite.js';
import type { Watch } from '../watch/model.js';

export class NotificationDispatcher {
  private readonly channelsById: Map<string, NotificationChannel>;

  constructor(
    private readonly store: SqliteRadarStore,
    channels: NotificationChannel[],
    private readonly sourceLabels: NotificationSourceLabelResolver,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  }

  get channels(): NotificationChannel[] {
    return [...this.channelsById.values()];
  }

  enqueue(event: RadarEvent): void {
    for (const channel of this.channelsById.values()) {
      const message: NotificationMessage = {
        event,
        text: formatNotification(event, this.sourceLabels.displayName(event.source)),
        recipient: channel.recipient,
      };
      this.store.enqueueNotification(event, channel, message, this.now());
    }
  }

  async dispatch(event: RadarEvent): Promise<void> {
    this.enqueue(event);
    await this.deliverPending();
  }

  enqueueHeartbeat(watch: Watch, periodKey: string, text: string): number {
    const event: RadarEvent = {
      id: `heartbeat:${watch.id}:${periodKey}`,
      eventKey: `heartbeat:${watch.id}:${periodKey}`,
      watchId: watch.id,
      source: watch.source,
      type: 'ProductUpdatedEvent',
      occurredAt: this.now(),
      before: null,
      after: null,
      payload: { heartbeat: true, periodKey },
    };
    let inserted = 0;
    for (const channel of this.channelsById.values()) {
      const message: NotificationMessage = { event, text, recipient: channel.recipient };
      if (this.store.enqueueHeartbeat(watch.id, periodKey, channel, message, this.now())) inserted += 1;
    }
    return inserted;
  }

  async deliverPending(): Promise<void> {
    for (const row of this.store.listPendingNotifications()) {
      const channel = this.channelsById.get(row.channelId);
      if (!channel) continue;
      try {
        await channel.send(row.message);
        this.store.markNotificationSent(row.id, this.now());
      } catch (error) {
        this.store.markNotificationFailed(row.id, error instanceof Error ? error.message : String(error));
      }
    }
    for (const row of this.store.listPendingHeartbeats()) {
      const channel = this.channelsById.get(row.channelId);
      if (!channel) continue;
      try {
        await channel.send(row.message);
        this.store.markHeartbeatSent(row.id, this.now());
      } catch (error) {
        this.store.markHeartbeatFailed(row.id, error instanceof Error ? error.message : String(error));
      }
    }
  }
}
