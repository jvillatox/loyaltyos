import type { Transporter } from "nodemailer";
import { createTransport } from "nodemailer";

import type { NotificationProvider, NotificationRow } from "../types.js";

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

export class SmtpProvider implements NotificationProvider {
  readonly channel = "EMAIL" as const;
  private transporter: Transporter;
  private from: string;

  constructor(config: SmtpConfig) {
    this.from = config.from;
    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.pass ?? "" } : undefined,
    });
  }

  async send(notification: NotificationRow): Promise<{ success: boolean; error?: string }> {
    try {
      const meta = notification.metadata as Record<string, string> | undefined;
      await this.transporter.sendMail({
        from: this.from,
        to: meta?.email ?? "",
        subject: notification.subject ?? "",
        html: notification.body ?? undefined,
      });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "SMTP send failed",
      };
    }
  }
}

/** Returns an SMTP provider configured from environment variables. */
export function createSmtpProvider(env = process.env): SmtpProvider {
  return new SmtpProvider({
    host: env.SMTP_HOST ?? "localhost",
    port: Number(env.SMTP_PORT) || 1025,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM ?? "noreply@loyaltyos.dev",
  });
}
