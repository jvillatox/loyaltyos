import type { NotificationProvider, NotificationRow } from "../types.js";

export interface OneSignalConfig {
  appId: string;
  apiKey: string;
  apiBase?: string;
}

export class OneSignalPushProvider implements NotificationProvider {
  readonly channel = "PUSH" as const;
  private config: { apiBase: string } & Omit<OneSignalConfig, "apiBase">;

  constructor(config: OneSignalConfig) {
    this.config = { ...config, apiBase: config.apiBase ?? "https://onesignal.com" };
  }

  get apiBaseUrl(): string {
    return this.config.apiBase;
  }

  async send(notification: NotificationRow): Promise<{ success: boolean; error?: string }> {
    try {
      const contents = notification.body ?? notification.subject ?? "";
      const headings = notification.subject ? { en: notification.subject } : undefined;

      const payload: Record<string, unknown> = {
        app_id: this.config.appId,
        contents: { en: contents },
        include_external_user_ids: [notification.memberId],
      };

      if (headings) {
        payload.headings = headings;
      }

      // Include metadata as data payload for deep-linking
      const meta = notification.metadata as Record<string, unknown> | undefined;
      if (meta && Object.keys(meta).length > 0) {
        payload.data = meta;
      }

      const response = await fetch(`${this.config.apiBase}/api/v1/notifications`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        return {
          success: false,
          error: `OneSignal responded with ${String(response.status)}: ${errBody}`,
        };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Push notification failed",
      };
    }
  }
}

/** Returns a OneSignal push provider configured from environment variables. */
export function createOneSignalProvider(env = process.env): OneSignalPushProvider | null {
  const appId = env.ONESIGNAL_APP_ID;
  const apiKey = env.ONESIGNAL_API_KEY;

  if (!appId || !apiKey) {
    return null;
  }

  return new OneSignalPushProvider({ appId, apiKey, apiBase: env.ONESIGNAL_API_BASE });
}
