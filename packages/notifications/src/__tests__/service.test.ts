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
      where: { programId: "prog-1", triggerEvent: "registration" },
    });
  });

  it("renders template variables", async () => {
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
    mockPrisma.notificationTemplate.findMany.mockResolvedValue([]);

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.sendTrigger("prog-1", "unknown_event", "mem-1", {});

    expect(result).toHaveLength(0);
  });
});

// ── Send ─────────────────────────────────────────────────

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

// ── Renderer ─────────────────────────────────────────────

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
});

// ── Providers ────────────────────────────────────────────

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
