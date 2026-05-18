import type { NotificationProvider, NotificationRow } from "../types.js";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from: string;
}

export class TwilioSmsProvider implements NotificationProvider {
  readonly channel = "SMS" as const;
  private config: TwilioConfig;

  constructor(config: TwilioConfig) {
    this.config = config;
  }

  async send(notification: NotificationRow): Promise<{ success: boolean; error?: string }> {
    try {
      const meta = notification.metadata as Record<string, string> | undefined;
      const to = meta?.phone;
      if (!to) {
        return { success: false, error: "No phone number in notification metadata" };
      }

      const body = notification.body ?? notification.subject ?? "";

      // Use Twilio REST API directly to avoid SDK dependency issues
      const credentials = Buffer.from(
        `${this.config.accountSid}:${this.config.authToken}`,
      ).toString("base64");

      const formData = new URLSearchParams();
      formData.append("To", to);
      formData.append("From", this.config.from);
      formData.append("Body", body);

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        },
      );

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        return {
          success: false,
          error: `Twilio responded with ${String(response.status)}: ${errBody}`,
        };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "SMS send failed",
      };
    }
  }
}

/** Returns a Twilio SMS provider configured from environment variables. */
export function createTwilioProvider(env = process.env): TwilioSmsProvider | null {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    return null;
  }

  return new TwilioSmsProvider({ accountSid, authToken, from });
}
