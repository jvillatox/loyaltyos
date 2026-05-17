import { createHmac, timingSafeEqual } from "node:crypto";

import type { NotificationProvider, NotificationRow } from "../types.js";

export interface WebhookConfig {
  secret: string;
  url: string;
}

export class WebhookProvider implements NotificationProvider {
  readonly channel = "WEBHOOK" as const;
  private config: WebhookConfig;

  constructor(config: WebhookConfig) {
    this.config = config;
  }

  async send(notification: NotificationRow): Promise<{ success: boolean; error?: string }> {
    try {
      const body = JSON.stringify({
        notificationId: notification.id,
        memberId: notification.memberId,
        subject: notification.subject,
        body: notification.body,
        metadata: notification.metadata,
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = this.sign(body, timestamp);

      const response = await fetch(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LoyaltyOS-Event": "notification.sent",
          "X-LoyaltyOS-Signature": signature,
          "X-LoyaltyOS-Timestamp": timestamp,
        },
        body,
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Webhook responded with ${String(response.status)}: ${await response.text().catch(() => "")}`,
        };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Webhook send failed",
      };
    }
  }

  sign(payload: string, timestamp: string): string {
    const hmac = createHmac("sha256", this.config.secret);
    hmac.update(`${timestamp}.${payload}`);
    return `sha256=${hmac.digest("hex")}`;
  }

  /**
   * Verify a webhook signature. Useful for the receiving end to validate
   * that a webhook was sent by LoyaltyOS.
   */
  static verify(payload: string, signature: string, timestamp: string, secret: string): boolean {
    const hmac = createHmac("sha256", secret);
    hmac.update(`${timestamp}.${payload}`);
    const expected = `sha256=${hmac.digest("hex")}`;
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}

/**
 * Creates a WebhookProvider for a specific webhook subscription.
 * Each subscription has its own URL and secret.
 */
export function createWebhookProvider(subscription: {
  url: string;
  secret: string;
}): WebhookProvider {
  return new WebhookProvider({ url: subscription.url, secret: subscription.secret });
}
