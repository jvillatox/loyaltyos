import type { NotificationChannel, NotificationProvider, NotificationRow } from "./types.js";

export type { NotificationProvider } from "./types.js";

export class NoopProvider implements NotificationProvider {
  readonly channel: NotificationChannel;

  constructor(channel: NotificationChannel) {
    this.channel = channel;
  }

  send(_notification: NotificationRow): Promise<{ success: boolean; error?: string }> {
    return Promise.resolve({ success: true });
  }
}

export class LogProvider implements NotificationProvider {
  readonly channel: NotificationChannel;

  constructor(channel: NotificationChannel) {
    this.channel = channel;
  }

  send(notification: NotificationRow): Promise<{ success: boolean; error?: string }> {
    console.log(
      `[Notifications][${notification.channel}] id=${notification.id} subject=${notification.subject ?? "(none)"}`,
    );
    return Promise.resolve({ success: true });
  }
}
