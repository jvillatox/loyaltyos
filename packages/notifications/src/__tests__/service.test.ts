import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  notificationTemplate: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  notification: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  webhookSubscription: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  member: {
    findUnique: vi.fn(),
  },
}));

vi.mock("@prisma/client", () => ({}));

let NotificationsService: typeof import("../service.js").NotificationsService;

beforeEach(async () => {
  vi.resetAllMocks();
  const mod = await import("../service.js");
  NotificationsService = mod.NotificationsService;
});

function templateRow(overrides = {}) {
  return {
    id: "tpl-1",
    programId: "prog-1",
    name: "Welcome Email",
    channel: "EMAIL" as const,
    subject: "Welcome, {{firstName}}!",
    bodyHtml: "<p>Hi {{firstName}}, you have {{balance}} points.</p>",
    bodyText: null,
    triggerEvent: "registration",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function notificationRow(overrides = {}) {
  return {
    id: "notif-1",
    templateId: "tpl-1",
    memberId: "mem-1",
    channel: "EMAIL" as const,
    status: "PENDING" as const,
    subject: "Welcome, Test!",
    body: "<p>Hi Test, you have 500 points.</p>",
    sentAt: null,
    readAt: null,
    error: null,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Template CRUD ────────────────────────────────────────

describe("NotificationsService.createTemplate", () => {
  it("creates a template", async () => {
    mockPrisma.notificationTemplate.create.mockResolvedValue(templateRow());

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.createTemplate({
      programId: "prog-1",
      name: "Welcome Email",
      channel: "EMAIL",
      subject: "Welcome!",
      triggerEvent: "registration",
    });

    expect(result.name).toBe("Welcome Email");
  });

  it("rejects missing name", async () => {
    const svc = new NotificationsService(mockPrisma as never);
    await expect(
      svc.createTemplate({
        programId: "prog-1",
        name: "",
        channel: "EMAIL",
      }),
    ).rejects.toThrow();
  });
});

describe("NotificationsService.updateTemplate", () => {
  it("updates template fields", async () => {
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(templateRow());
    mockPrisma.notificationTemplate.update.mockResolvedValue(
      templateRow({ subject: "Updated Subject" }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.updateTemplate("tpl-1", {
      subject: "Updated Subject",
    });

    expect(result.subject).toBe("Updated Subject");
  });

  it("throws TemplateNotFoundError", async () => {
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(null);

    const svc = new NotificationsService(mockPrisma as never);
    await expect(svc.updateTemplate("nonexistent", { subject: "Nope" })).rejects.toThrow(
      "Notification template not found",
    );
  });
});

describe("NotificationsService.deleteTemplate", () => {
  it("deletes a template", async () => {
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(templateRow());

    const svc = new NotificationsService(mockPrisma as never);
    await svc.deleteTemplate("tpl-1");

    expect(mockPrisma.notificationTemplate.delete).toHaveBeenCalledWith({
      where: { id: "tpl-1" },
    });
  });
});

describe("NotificationsService.getTemplate", () => {
  it("returns template by id", async () => {
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(templateRow());

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.getTemplate("tpl-1");

    expect(result.id).toBe("tpl-1");
  });
});

describe("NotificationsService.listTemplates", () => {
  it("returns paginated templates", async () => {
    mockPrisma.notificationTemplate.findMany.mockResolvedValue([templateRow()]);
    mockPrisma.notificationTemplate.count.mockResolvedValue(1);

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.listTemplates("prog-1");

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

// ── Notifications ────────────────────────────────────────

describe("NotificationsService.createNotification", () => {
  it("creates a notification", async () => {
    mockPrisma.notification.create.mockResolvedValue(notificationRow());

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.createNotification({
      templateId: "tpl-1",
      memberId: "mem-1",
      channel: "EMAIL",
      subject: "Welcome!",
      body: "<p>Hi Test</p>",
    });

    expect(result.channel).toBe("EMAIL");
    expect(result.status).toBe("PENDING");
  });
});

// ── Trigger ──────────────────────────────────────────────

describe("NotificationsService.sendTrigger", () => {
  it("finds matching templates and creates notifications", async () => {
    mockPrisma.member.findUnique.mockResolvedValue({
      locale: "es-MX",
      program: { defaultLocale: "es-MX" },
    });
    mockPrisma.notificationTemplate.findMany.mockResolvedValue([
      templateRow({ triggerEvent: "registration" }),
    ]);
    mockPrisma.notification.create.mockResolvedValue(notificationRow({ status: "PENDING" }));
    mockPrisma.notification.findFirst.mockResolvedValue(notificationRow({ status: "PENDING" }));
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SENT", sentAt: new Date() }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.sendTrigger("prog-1", "registration", "mem-1", {
      firstName: "Test",
      balance: 500,
    });

    expect(result).toHaveLength(1);
    expect(mockPrisma.notificationTemplate.findMany).toHaveBeenCalledWith({
      where: { programId: "prog-1", triggerEvent: "registration", locale: "es-MX" },
    });
  });

  it("renders template with Handlebars variables", async () => {
    mockPrisma.member.findUnique.mockResolvedValue({
      locale: null,
      program: { defaultLocale: "es-MX" },
    });
    mockPrisma.notificationTemplate.findMany.mockResolvedValue([
      templateRow({
        subject: "Hi {{firstName}}",
        bodyHtml: "You have {{balance}} points and live in {{address.city}}",
        triggerEvent: "registration",
      }),
    ]);
    mockPrisma.notification.create.mockResolvedValue(notificationRow({ status: "PENDING" }));
    mockPrisma.notification.findFirst.mockResolvedValue(notificationRow({ status: "PENDING" }));
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SENT", sentAt: new Date() }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    await svc.sendTrigger("prog-1", "registration", "mem-1", {
      firstName: "Test",
      balance: 500,
      address: { city: "Madrid" },
    });

    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subject: "Hi Test",
          body: "You have 500 points and live in Madrid",
        }),
      }),
    );
  });

  it("returns empty when no templates match", async () => {
    mockPrisma.member.findUnique.mockResolvedValue({
      locale: "es-MX",
      program: { defaultLocale: "es-MX" },
    });
    mockPrisma.notificationTemplate.findMany.mockResolvedValue([]);

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.sendTrigger("prog-1", "unknown_event", "mem-1", {});

    expect(result).toHaveLength(0);
  });

  it("falls back to program.defaultLocale before es-MX", async () => {
    // Member has an unsupported locale; program default is en-US
    mockPrisma.member.findUnique.mockResolvedValue({
      locale: "fr-FR",
      program: { defaultLocale: "en-US" },
    });
    // No templates for fr-FR
    mockPrisma.notificationTemplate.findMany.mockResolvedValueOnce([]);
    // Templates exist for en-US (program default)
    mockPrisma.notificationTemplate.findMany.mockResolvedValueOnce([
      templateRow({ triggerEvent: "registration", locale: "en-US" }),
    ]);
    mockPrisma.notification.create.mockResolvedValue(notificationRow({ status: "PENDING" }));
    mockPrisma.notification.findFirst.mockResolvedValue(notificationRow({ status: "PENDING" }));
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SENT", sentAt: new Date() }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.sendTrigger("prog-1", "registration", "mem-1", {
      firstName: "Test",
      balance: 500,
    });

    expect(result).toHaveLength(1);
    // Should have been called with en-US (program default), not es-MX
    expect(mockPrisma.notificationTemplate.findMany).toHaveBeenCalledWith({
      where: { programId: "prog-1", triggerEvent: "registration", locale: "en-US" },
    });
  });
});

// ── Send / Deliver ───────────────────────────────────────

describe("NotificationsService.send", () => {
  it("sends notification via provider and marks SENT", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(notificationRow({ status: "PENDING" }));
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SENT", sentAt: new Date() }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.send("notif-1");

    expect(result.status).toBe("SENT");
  });

  it("throws NotificationNotFoundError", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(null);

    const svc = new NotificationsService(mockPrisma as never);
    await expect(svc.send("nonexistent")).rejects.toThrow("Notification not found");
  });

  it("uses custom provider when registered", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(notificationRow({ status: "PENDING" }));
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SENT", sentAt: new Date() }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    let called = false;
    svc.setProvider("EMAIL", {
      channel: "EMAIL",
      async send() {
        called = true;
        await Promise.resolve();
        return { success: true };
      },
    });

    await svc.send("notif-1");
    expect(called).toBe(true);
  });

  it("enqueues when enqueueFn is set instead of delivering directly", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(notificationRow({ status: "PENDING" }));

    const svc = new NotificationsService(mockPrisma as never);
    let enqueuedId: string | null = null;
    svc.setEnqueue((id) => {
      enqueuedId = id;
      return Promise.resolve();
    });

    const result = await svc.send("notif-1");
    expect(enqueuedId).toBe("notif-1");
    expect(result.status).toBe("PENDING"); // not yet delivered
  });
});

describe("NotificationsService.deliver", () => {
  it("delivers via provider and marks SENT on success", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(notificationRow({ status: "PENDING" }));
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SENT", sentAt: new Date() }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.deliver("notif-1");

    expect(result.status).toBe("SENT");
  });

  it("marks FAILED on provider error", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(notificationRow({ status: "PENDING" }));
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "FAILED", error: "send failed" }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    svc.setProvider("EMAIL", {
      channel: "EMAIL",
      async send() {
        await Promise.resolve();
        return { success: false, error: "send failed" };
      },
    });

    const result = await svc.deliver("notif-1");
    expect(result.status).toBe("FAILED");
  });

  it("throws ProviderNotFoundError for unregistered channel", async () => {
    // Create a notification with a channel that has no provider
    const svc = new NotificationsService(mockPrisma as never);
    // Remove the default NoopProvider for IN_APP
    svc.setProvider("IN_APP", undefined as never);

    mockPrisma.notification.findFirst.mockResolvedValue(notificationRow({ channel: "IN_APP" }));

    await expect(svc.deliver("notif-1")).rejects.toThrow("No provider registered");
  });

  it("throws NotificationNotFoundError", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(null);

    const svc = new NotificationsService(mockPrisma as never);
    await expect(svc.deliver("nonexistent")).rejects.toThrow("Notification not found");
  });
});

// ── Status ───────────────────────────────────────────────

describe("NotificationsService.markRead", () => {
  it("marks notification as READ", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(notificationRow());
    mockPrisma.notification.update.mockResolvedValue(notificationRow({ status: "READ" }));

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.markRead("notif-1");

    expect(result.status).toBe("READ");
  });
});

describe("NotificationsService.getMemberNotifications", () => {
  it("returns paginated notifications for member", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([notificationRow()]);
    mockPrisma.notification.count.mockResolvedValue(1);

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.getMemberNotifications("mem-1");

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

// ── Webhook CRUD ─────────────────────────────────────────

describe("NotificationsService.createWebhook", () => {
  it("creates a webhook subscription", async () => {
    const wh = {
      id: "wh-1",
      programId: "prog-1",
      url: "https://example.com/webhook",
      events: ["points.earned"],
      secret: "whsec_1234567890123456",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.webhookSubscription.create.mockResolvedValue(wh);

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.createWebhook({
      programId: "prog-1",
      url: "https://example.com/webhook",
      events: ["points.earned"],
      secret: "whsec_1234567890123456",
    });

    expect(result.url).toBe("https://example.com/webhook");
  });
});

describe("NotificationsService.getWebhook", () => {
  it("returns webhook by id", async () => {
    const wh = {
      id: "wh-1",
      programId: "prog-1",
      url: "https://example.com/webhook",
      events: ["points.earned"],
      secret: "whsec_1234567890123456",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.webhookSubscription.findFirst.mockResolvedValue(wh);

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.getWebhook("wh-1");

    expect(result.id).toBe("wh-1");
  });

  it("throws when webhook not found", async () => {
    mockPrisma.webhookSubscription.findFirst.mockResolvedValue(null);

    const svc = new NotificationsService(mockPrisma as never);
    await expect(svc.getWebhook("nonexistent")).rejects.toThrow("Webhook not found");
  });
});

describe("NotificationsService.listWebhooks", () => {
  it("returns paginated webhooks", async () => {
    const wh = {
      id: "wh-1",
      programId: "prog-1",
      url: "https://example.com/webhook",
      events: ["points.earned"],
      secret: "whsec_1234567890123456",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.webhookSubscription.findMany.mockResolvedValue([wh]);
    mockPrisma.webhookSubscription.count.mockResolvedValue(1);

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.listWebhooks("prog-1");

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

describe("NotificationsService.updateWebhook", () => {
  it("updates webhook fields", async () => {
    const wh = {
      id: "wh-1",
      programId: "prog-1",
      url: "https://example.com/webhook",
      events: ["points.earned"],
      secret: "whsec_1234567890123456",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.webhookSubscription.findFirst.mockResolvedValue(wh);
    mockPrisma.webhookSubscription.update.mockResolvedValue({
      ...wh,
      url: "https://new.example.com/webhook",
    });

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.updateWebhook("wh-1", { url: "https://new.example.com/webhook" });

    expect(result.url).toBe("https://new.example.com/webhook");
  });
});

describe("NotificationsService.deleteWebhook", () => {
  it("deletes a webhook", async () => {
    const wh = {
      id: "wh-1",
      programId: "prog-1",
      url: "https://example.com/webhook",
      events: ["points.earned"],
      secret: "whsec_1234567890123456",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.webhookSubscription.findFirst.mockResolvedValue(wh);

    const svc = new NotificationsService(mockPrisma as never);
    await svc.deleteWebhook("wh-1");

    expect(mockPrisma.webhookSubscription.delete).toHaveBeenCalledWith({
      where: { id: "wh-1" },
    });
  });
});

describe("NotificationsService.listNotifications", () => {
  it("returns paginated admin notifications", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([notificationRow()]);
    mockPrisma.notification.count.mockResolvedValue(1);

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.listNotifications("prog-1");

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

// ── Renderer: Handlebars ─────────────────────────────────

import { render } from "../renderer.js";

describe("render", () => {
  it("replaces simple variables", () => {
    const result = render("Hello {{name}}", { name: "World" });
    expect(result).toBe("Hello World");
  });

  it("replaces multiple variables", () => {
    const result = render("{{greeting}}, {{name}}!", {
      greeting: "Hi",
      name: "Test",
    });
    expect(result).toBe("Hi, Test!");
  });

  it("replaces nested paths", () => {
    const result = render("City: {{address.city}}", {
      address: { city: "Madrid" },
    });
    expect(result).toBe("City: Madrid");
  });

  it("replaces missing variables with empty string", () => {
    const result = render("Hello {{missing}}", {});
    expect(result).toBe("Hello ");
  });

  it("returns original string when no variables", () => {
    const result = render("No variables here", {});
    expect(result).toBe("No variables here");
  });

  it("converts numbers to strings", () => {
    const result = render("You have {{points}} points", { points: 500 });
    expect(result).toBe("You have 500 points");
  });

  // Handlebars-specific: block helpers
  it("supports {{#if}} truthy block", () => {
    const tpl = "{{#if member.currentTier}}Tier: {{member.currentTier}}{{else}}No tier{{/if}}";
    expect(render(tpl, { member: { currentTier: "Gold" } })).toBe("Tier: Gold");
  });

  it("supports {{#if}} falsy block (else branch)", () => {
    const tpl = "{{#if member.currentTier}}Tier: {{member.currentTier}}{{else}}No tier{{/if}}";
    expect(render(tpl, { member: {} })).toBe("No tier");
  });

  it("supports {{#unless}}", () => {
    const tpl = "{{#unless optedOut}}You are subscribed{{else}}Unsubscribed{{/unless}}";
    expect(render(tpl, { optedOut: false })).toBe("You are subscribed");
    expect(render(tpl, { optedOut: true })).toBe("Unsubscribed");
  });

  it("supports {{#each}} with array", () => {
    const tpl = "Items:{{#each items}} {{name}}:{{price}}{{/each}}";
    const result = render(tpl, {
      items: [
        { name: "Coffee", price: 5 },
        { name: "Tea", price: 3 },
      ],
    });
    expect(result).toBe("Items: Coffee:5 Tea:3");
  });

  it("supports {{#each}} with empty array (else branch)", () => {
    const tpl = "{{#each items}}Has items{{else}}No items{{/each}}";
    expect(render(tpl, { items: [] })).toBe("No items");
  });

  it("supports {{#each}} with @index, @first, @last data", () => {
    const tpl = "{{#each items}}{{#unless @first}}, {{/unless}}{{@index}}:{{name}}{{/each}}";
    const result = render(tpl, {
      items: [{ name: "A" }, { name: "B" }, { name: "C" }],
    });
    expect(result).toBe("0:A, 1:B, 2:C");
  });

  it("supports {{eq}} helper", () => {
    const tpl = '{{#if (eq status "active")}}Active{{else}}Inactive{{/if}}';
    expect(render(tpl, { status: "active" })).toBe("Active");
    expect(render(tpl, { status: "inactive" })).toBe("Inactive");
  });

  it("supports {{neq}} helper", () => {
    const tpl = '{{#if (neq type "banned")}}Allowed{{else}}Blocked{{/if}}';
    expect(render(tpl, { type: "normal" })).toBe("Allowed");
    expect(render(tpl, { type: "banned" })).toBe("Blocked");
  });

  // Sandbox
  it("blocks constructor access in templates", () => {
    const result = render("{{constructor}}", {});
    expect(result).toBe("");
  });

  it("blocks __proto__ access in templates", () => {
    const result = render("{{__proto__}}", {});
    expect(result).toBe("");
  });

  it("blocks require access in templates", () => {
    const result = render("{{require}}", {});
    expect(result).toBe("");
  });

  it("blocks process access in templates", () => {
    const result = render("{{process}}", {});
    expect(result).toBe("");
  });

  it("blocks global access in templates", () => {
    const result = render("{{global}}", {});
    expect(result).toBe("");
  });

  it("HTML-escapes by default", () => {
    const result = render("Hello {{name}}", { name: "<script>alert('xss')</script>" });
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>");
  });
});

// ── Providers: Noop / Log ────────────────────────────────

import { LogProvider, NoopProvider } from "../provider.js";

describe("NoopProvider", () => {
  it("returns success", async () => {
    const p = new NoopProvider("EMAIL");
    const result = await p.send(notificationRow() as never);
    expect(result.success).toBe(true);
  });
});

describe("LogProvider", () => {
  it("logs and returns success", async () => {
    const p = new LogProvider("SMS");
    const result = await p.send(notificationRow({ channel: "SMS" }) as never);
    expect(result.success).toBe(true);
  });
});

// ── Providers: SMTP ──────────────────────────────────────

import { createSmtpProvider, type SmtpConfig, SmtpProvider } from "../providers/smtp.js";

const mockSendMail = vi.fn();
const mockCreateTransport = vi.fn();

vi.mock("nodemailer", () => ({
  createTransport: (...args: unknown[]) => {
    mockCreateTransport(...args);
    return { sendMail: mockSendMail };
  },
}));

describe("SmtpProvider", () => {
  beforeEach(() => {
    mockSendMail.mockReset();
    mockCreateTransport.mockReset();
  });

  const config: SmtpConfig = {
    host: "smtp.example.com",
    port: 587,
    user: "testuser",
    pass: "testpass",
    from: "noreply@example.com",
  };

  it("creates transport with provided config", () => {
    new SmtpProvider(config);
    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: { user: "testuser", pass: "testpass" },
    });
  });

  it("uses secure: true for port 465", () => {
    new SmtpProvider({ ...config, port: 465 });
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });

  it("omits auth when user is not provided", () => {
    new SmtpProvider({ host: "localhost", port: 1025, from: "noreply@example.com" });
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
  });

  it("sends email with correct parameters", async () => {
    mockSendMail.mockResolvedValue({ messageId: "<abc123@example.com>" });

    const provider = new SmtpProvider(config);
    const result = await provider.send(
      notificationRow({
        channel: "EMAIL",
        subject: "Welcome!",
        body: "<p>Hello</p>",
        metadata: { email: "user@example.com" },
      }) as never,
    );

    expect(result.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "user@example.com",
      subject: "Welcome!",
      html: "<p>Hello</p>",
    });
  });

  it("returns failure on sendMail error", async () => {
    mockSendMail.mockRejectedValue(new Error("Connection refused"));

    const provider = new SmtpProvider(config);
    const result = await provider.send(
      notificationRow({
        channel: "EMAIL",
        metadata: { email: "user@example.com" },
      }) as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Connection refused");
  });

  it("handles missing subject gracefully", async () => {
    mockSendMail.mockResolvedValue({});

    const provider = new SmtpProvider(config);
    await provider.send(
      notificationRow({
        channel: "EMAIL",
        subject: null,
        metadata: { email: "user@example.com" },
      }) as never,
    );

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: "" }));
  });
});

describe("createSmtpProvider", () => {
  it("reads from environment variables", () => {
    createSmtpProvider({
      SMTP_HOST: "mail.example.com",
      SMTP_PORT: "2525",
      SMTP_USER: "envuser",
      SMTP_PASS: "envpass",
      SMTP_FROM: "from-env@example.com",
    });

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: "mail.example.com",
      port: 2525,
      secure: false,
      auth: { user: "envuser", pass: "envpass" },
    });
  });

  it("uses defaults when env vars are missing", () => {
    createSmtpProvider({});
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "localhost",
        port: 1025,
      }),
    );
  });
});

// ── Providers: Webhook ───────────────────────────────────

import { createWebhookProvider, WebhookProvider } from "../providers/webhook.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("WebhookProvider", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const config = {
    url: "https://partner.example.com/webhooks",
    secret: "whsec_supersecret32bytes_key!",
  };

  it("signs payload with HMAC-SHA256", () => {
    const provider = new WebhookProvider(config);
    const sig = provider.sign("test-payload", "1234567890");
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("sends signed POST request", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

    const provider = new WebhookProvider(config);
    const result = await provider.send(
      notificationRow({
        id: "notif-xyz",
        memberId: "mem-1",
        channel: "WEBHOOK",
        subject: "Test Event",
        body: "Body content",
        metadata: { key: "value" },
      }) as never,
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://partner.example.com/webhooks");
    expect(init.method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-LoyaltyOS-Event"]).toBe("notification.sent");
    expect(headers["X-LoyaltyOS-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(headers["X-LoyaltyOS-Timestamp"]).toBeTruthy();

    const body = JSON.parse(init.body as string);
    expect(body.notificationId).toBe("notif-xyz");
    expect(body.subject).toBe("Test Event");
  });

  it("returns failure on non-2xx response", async () => {
    mockFetch.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

    const provider = new WebhookProvider(config);
    const result = await provider.send(
      notificationRow({
        channel: "WEBHOOK",
        metadata: {},
      }) as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
  });

  it("returns failure on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network unreachable"));

    const provider = new WebhookProvider(config);
    const result = await provider.send(
      notificationRow({
        channel: "WEBHOOK",
        metadata: {},
      }) as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network unreachable");
  });
});

describe("WebhookProvider.verify", () => {
  const secret = "whsec_test_secret_12345";

  it("verifies a valid signature", () => {
    const payload = JSON.stringify({ event: "points.earned", points: 500 });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const provider = new WebhookProvider({ url: "https://example.com/webhook", secret });
    const signature = provider.sign(payload, timestamp);

    const valid = WebhookProvider.verify(payload, signature, timestamp, secret);
    expect(valid).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const payload = JSON.stringify({ event: "points.earned", points: 500 });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const valid = WebhookProvider.verify(payload, "sha256_" + "a".repeat(64), timestamp, secret);
    expect(valid).toBe(false);
  });

  it("rejects tampered payload", () => {
    const payload = JSON.stringify({ event: "points.earned" });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const provider = new WebhookProvider({ url: "https://example.com/webhook", secret });
    const signature = provider.sign(payload, timestamp);

    const valid = WebhookProvider.verify(
      JSON.stringify({ event: "points.spent" }),
      signature,
      timestamp,
      secret,
    );
    expect(valid).toBe(false);
  });

  it("rejects wrong timestamp", () => {
    const payload = JSON.stringify({ event: "points.earned" });
    const timestamp = "1715900000";

    const provider = new WebhookProvider({ url: "https://example.com/webhook", secret });
    const signature = provider.sign(payload, timestamp);

    const valid = WebhookProvider.verify(payload, signature, "9999999999", secret);
    expect(valid).toBe(false);
  });
});

describe("createWebhookProvider", () => {
  it("creates a provider from a subscription object", () => {
    const provider = createWebhookProvider({
      url: "https://partner.example.com/webhooks",
      secret: "whsec_abc123",
    });
    expect(provider).toBeInstanceOf(WebhookProvider);
    expect(provider.channel).toBe("WEBHOOK");
  });
});

// ── Providers: Twilio SMS ─────────────────────────────────

import { createTwilioProvider, TwilioSmsProvider } from "../providers/twilio.js";

describe("TwilioSmsProvider", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const config = {
    accountSid: "AC_test_sid",
    authToken: "test_auth_token",
    from: "+1234567890",
  };

  it("has channel SMS", () => {
    const provider = new TwilioSmsProvider(config);
    expect(provider.channel).toBe("SMS");
  });

  it("sends SMS with correct parameters", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }));

    const provider = new TwilioSmsProvider(config);
    const result = await provider.send(
      notificationRow({
        channel: "SMS",
        subject: "Welcome!",
        body: "Hello Carlos, you earned 100 points",
        metadata: { phone: "+521234567890" },
      }) as never,
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toContain("api.twilio.com");
    expect(url).toContain("AC_test_sid");
    expect(init.method).toBe("POST");
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("AC_test_sid:test_auth_token").toString("base64")}`,
    );
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const body = init.body as string;
    expect(body).toContain("To=%2B521234567890");
    expect(body).toContain("From=%2B1234567890");
  });

  it("uses body text as SMS content", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 201 }));

    const provider = new TwilioSmsProvider(config);
    await provider.send(
      notificationRow({
        channel: "SMS",
        subject: null,
        body: "Plain text SMS body",
        metadata: { phone: "+521234567890" },
      }) as never,
    );

    const body = mockFetch.mock.calls[0][1].body as string;
    expect(body).toContain("Body=Plain+text+SMS+body");
  });

  it("falls back to subject when body is missing", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 201 }));

    const provider = new TwilioSmsProvider(config);
    await provider.send(
      notificationRow({
        channel: "SMS",
        subject: "Subject as fallback",
        body: null,
        metadata: { phone: "+521234567890" },
      }) as never,
    );

    const body = mockFetch.mock.calls[0][1].body as string;
    expect(body).toContain("Body=Subject+as+fallback");
  });

  it("returns failure when phone is missing", async () => {
    const provider = new TwilioSmsProvider(config);
    const result = await provider.send(
      notificationRow({
        channel: "SMS",
        metadata: {},
      }) as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("No phone number");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns failure on non-2xx response", async () => {
    mockFetch.mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    const provider = new TwilioSmsProvider(config);
    const result = await provider.send(
      notificationRow({
        channel: "SMS",
        metadata: { phone: "+521234567890" },
      }) as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns failure on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network unreachable"));

    const provider = new TwilioSmsProvider(config);
    const result = await provider.send(
      notificationRow({
        channel: "SMS",
        metadata: { phone: "+521234567890" },
      }) as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network unreachable");
  });

  it("uses custom apiBase when configured", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }));

    const provider = new TwilioSmsProvider({
      ...config,
      apiBase: "https://sandbox.twilio.com",
    });
    await provider.send(
      notificationRow({
        channel: "SMS",
        metadata: { phone: "+521234567890" },
      }) as never,
    );

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("sandbox.twilio.com");
    expect(url).not.toContain("api.twilio.com");
  });

  it("defaults apiBase to https://api.twilio.com", () => {
    const provider = new TwilioSmsProvider(config);
    expect(provider.apiBaseUrl).toBe("https://api.twilio.com");
  });
});

describe("createTwilioProvider", () => {
  it("returns a provider when all env vars are set", () => {
    const provider = createTwilioProvider({
      TWILIO_ACCOUNT_SID: "AC_env_sid",
      TWILIO_AUTH_TOKEN: "env_token",
      TWILIO_PHONE_NUMBER: "+1555000111",
    });
    expect(provider).toBeInstanceOf(TwilioSmsProvider);
    expect(provider?.channel).toBe("SMS");
  });

  it("returns null when account SID is missing", () => {
    const provider = createTwilioProvider({
      TWILIO_AUTH_TOKEN: "env_token",
      TWILIO_PHONE_NUMBER: "+1555000111",
    });
    expect(provider).toBeNull();
  });

  it("returns null when auth token is missing", () => {
    const provider = createTwilioProvider({
      TWILIO_ACCOUNT_SID: "AC_env_sid",
      TWILIO_PHONE_NUMBER: "+1555000111",
    });
    expect(provider).toBeNull();
  });

  it("returns null when phone number is missing", () => {
    const provider = createTwilioProvider({
      TWILIO_ACCOUNT_SID: "AC_env_sid",
      TWILIO_AUTH_TOKEN: "env_token",
    });
    expect(provider).toBeNull();
  });

  it("passes TWILIO_API_BASE through to the provider", () => {
    const provider = createTwilioProvider({
      TWILIO_ACCOUNT_SID: "AC_env_sid",
      TWILIO_AUTH_TOKEN: "env_token",
      TWILIO_PHONE_NUMBER: "+1555000111",
      TWILIO_API_BASE: "https://twilio-mock.local",
    });
    expect(provider).toBeInstanceOf(TwilioSmsProvider);
    expect(provider?.apiBaseUrl).toBe("https://twilio-mock.local");
  });
});

// ── Providers: OneSignal Push ─────────────────────────────

import { createOneSignalProvider, OneSignalPushProvider } from "../providers/onesignal.js";

describe("OneSignalPushProvider", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const config = {
    appId: "test-app-id-1234",
    apiKey: "os_api_key_xyz",
  };

  it("has channel PUSH", () => {
    const provider = new OneSignalPushProvider(config);
    expect(provider.channel).toBe("PUSH");
  });

  it("sends push notification with correct parameters", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ id: "notif-os-1" }), { status: 200 }),
    );

    const provider = new OneSignalPushProvider(config);
    const result = await provider.send(
      notificationRow({
        channel: "PUSH",
        memberId: "mem-42",
        subject: "Points Earned!",
        body: "You just earned 500 points",
        metadata: { deeplink: "loyaltyos://home" },
      }) as never,
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://onesignal.com/api/v1/notifications");
    expect(init.method).toBe("POST");
    expect(headers.Authorization).toBe("Basic os_api_key_xyz");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.app_id).toBe("test-app-id-1234");
    expect(body.contents.en).toBe("You just earned 500 points");
    expect(body.headings.en).toBe("Points Earned!");
    expect(body.include_external_user_ids).toEqual(["mem-42"]);
    expect(body.data.deeplink).toBe("loyaltyos://home");
  });

  it("omits headings when subject is missing", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

    const provider = new OneSignalPushProvider(config);
    await provider.send(
      notificationRow({
        channel: "PUSH",
        memberId: "mem-1",
        subject: null,
        body: "Body only notification",
      }) as never,
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.headings).toBeUndefined();
    expect(body.contents.en).toBe("Body only notification");
  });

  it("uses subject as body when body is missing", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

    const provider = new OneSignalPushProvider(config);
    await provider.send(
      notificationRow({
        channel: "PUSH",
        memberId: "mem-1",
        subject: "Subject only",
        body: null,
      }) as never,
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.contents.en).toBe("Subject only");
  });

  it("omits data when metadata is empty", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

    const provider = new OneSignalPushProvider(config);
    await provider.send(
      notificationRow({
        channel: "PUSH",
        memberId: "mem-1",
        metadata: {},
      }) as never,
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.data).toBeUndefined();
  });

  it("returns failure on non-2xx response", async () => {
    mockFetch.mockResolvedValue(new Response("Bad Request", { status: 400 }));

    const provider = new OneSignalPushProvider(config);
    const result = await provider.send(
      notificationRow({
        channel: "PUSH",
        memberId: "mem-1",
      }) as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("400");
  });

  it("returns failure on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Connection timeout"));

    const provider = new OneSignalPushProvider(config);
    const result = await provider.send(
      notificationRow({
        channel: "PUSH",
        memberId: "mem-1",
      }) as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Connection timeout");
  });

  it("uses custom apiBase when configured", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ id: "notif-1" }), { status: 200 }));

    const provider = new OneSignalPushProvider({
      ...config,
      apiBase: "https://onesignal-mock.local",
    });
    await provider.send(
      notificationRow({
        channel: "PUSH",
        memberId: "mem-1",
      }) as never,
    );

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://onesignal-mock.local/api/v1/notifications");
    expect(url).not.toContain("onesignal.com");
  });

  it("defaults apiBase to https://onesignal.com", () => {
    const provider = new OneSignalPushProvider(config);
    expect(provider.apiBaseUrl).toBe("https://onesignal.com");
  });
});

describe("createOneSignalProvider", () => {
  it("returns a provider when all env vars are set", () => {
    const provider = createOneSignalProvider({
      ONESIGNAL_APP_ID: "env-app-id",
      ONESIGNAL_API_KEY: "env-api-key",
    });
    expect(provider).toBeInstanceOf(OneSignalPushProvider);
    expect(provider?.channel).toBe("PUSH");
  });

  it("returns null when app ID is missing", () => {
    const provider = createOneSignalProvider({
      ONESIGNAL_API_KEY: "env-api-key",
    });
    expect(provider).toBeNull();
  });

  it("returns null when API key is missing", () => {
    const provider = createOneSignalProvider({
      ONESIGNAL_APP_ID: "env-app-id",
    });
    expect(provider).toBeNull();
  });

  it("returns null when no env vars are set", () => {
    const provider = createOneSignalProvider({});
    expect(provider).toBeNull();
  });

  it("passes ONESIGNAL_API_BASE through to the provider", () => {
    const provider = createOneSignalProvider({
      ONESIGNAL_APP_ID: "env-app-id",
      ONESIGNAL_API_KEY: "env-api-key",
      ONESIGNAL_API_BASE: "https://onesignal-mock.local",
    });
    expect(provider).toBeInstanceOf(OneSignalPushProvider);
    expect(provider?.apiBaseUrl).toBe("https://onesignal-mock.local");
  });
});
