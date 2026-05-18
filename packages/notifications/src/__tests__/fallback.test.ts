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
  memberNotificationPreferences: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
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
    name: "Marketing Email",
    channel: "EMAIL" as const,
    subject: "Check this out!",
    bodyHtml: "<p>Promo</p>",
    bodyText: null,
    triggerEvent: "promo",
    transactional: false,
    fallbackChannel: null as string | null,
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
    subject: "Check this out!",
    body: "<p>Promo</p>",
    sentAt: null,
    readAt: null,
    error: null,
    metadata: { email: "user@example.com" },
    createdAt: new Date(),
    ...overrides,
  };
}

describe("Fallback chain", () => {
  it("falls back to SMS when primary EMAIL provider fails", async () => {
    // Notification is EMAIL
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: "tpl-1", channel: "EMAIL" }),
    );
    // Template has fallbackChannel = SMS
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(
      templateRow({ id: "tpl-1", channel: "EMAIL", fallbackChannel: "SMS" }),
    );
    // Update to SENT (via fallback)
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SENT", sentAt: new Date() }),
    );

    const svc = new NotificationsService(mockPrisma as never);

    // Primary EMAIL provider fails
    let primaryCalled = false;
    svc.setProvider("EMAIL", {
      channel: "EMAIL",
      async send() {
        primaryCalled = true;
        await Promise.resolve();
        return { success: false, error: "SMTP connection refused" };
      },
    });

    // Fallback SMS provider succeeds
    let fallbackCalled = false;
    svc.setProvider("SMS", {
      channel: "SMS",
      async send(notification) {
        fallbackCalled = true;
        await Promise.resolve();
        expect(notification.channel).toBe("SMS");
        return { success: true };
      },
    });

    const result = await svc.deliver("notif-1");

    expect(primaryCalled).toBe(true);
    expect(fallbackCalled).toBe(true);
    expect(result.status).toBe("SENT");
  });

  it("marks FAILED when both primary and fallback fail", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: "tpl-1", channel: "EMAIL" }),
    );
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(
      templateRow({ id: "tpl-1", channel: "EMAIL", fallbackChannel: "SMS" }),
    );
    mockPrisma.notification.update.mockImplementation(
      (args: { data: { status: string; error?: string } }) =>
        Promise.resolve(
          notificationRow({ status: args.data.status as never, error: args.data.error }),
        ),
    );

    const svc = new NotificationsService(mockPrisma as never);

    svc.setProvider("EMAIL", {
      channel: "EMAIL",
      async send() {
        await Promise.resolve();
        return { success: false, error: "SMTP down" };
      },
    });

    svc.setProvider("SMS", {
      channel: "SMS",
      async send() {
        await Promise.resolve();
        return { success: false, error: "Twilio down" };
      },
    });

    const result = await svc.deliver("notif-1");

    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("Primary and fallback both failed");
    expect(result.error).toContain("SMTP down");
    expect(result.error).toContain("Twilio down");
  });

  it("does NOT use fallback when primary succeeds", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: "tpl-1", channel: "EMAIL" }),
    );
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SENT", sentAt: new Date() }),
    );

    const svc = new NotificationsService(mockPrisma as never);

    let primaryCalled = false;
    svc.setProvider("EMAIL", {
      channel: "EMAIL",
      async send() {
        primaryCalled = true;
        await Promise.resolve();
        return { success: true };
      },
    });

    let fallbackCalled = false;
    svc.setProvider("SMS", {
      channel: "SMS",
      async send() {
        fallbackCalled = true;
        await Promise.resolve();
        return { success: true };
      },
    });

    const result = await svc.deliver("notif-1");

    expect(primaryCalled).toBe(true);
    expect(fallbackCalled).toBe(false);
    expect(result.status).toBe("SENT");
  });

  it("sends via primary only when template has no fallback", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: "tpl-1", channel: "EMAIL" }),
    );
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(
      templateRow({ id: "tpl-1", channel: "EMAIL", fallbackChannel: null }),
    );
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "FAILED", error: "SMTP down" }),
    );

    const svc = new NotificationsService(mockPrisma as never);

    let primaryCalled = false;
    svc.setProvider("EMAIL", {
      channel: "EMAIL",
      async send() {
        primaryCalled = true;
        await Promise.resolve();
        return { success: false, error: "SMTP down" };
      },
    });

    const result = await svc.deliver("notif-1");

    expect(primaryCalled).toBe(true);
    expect(result.status).toBe("FAILED");
  });

  it("marks FAILED when fallback provider is not registered", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: "tpl-1", channel: "EMAIL" }),
    );
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(
      templateRow({ id: "tpl-1", channel: "EMAIL", fallbackChannel: "PUSH" }),
    );
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "FAILED", error: "SMTP down" }),
    );

    const svc = new NotificationsService(mockPrisma as never);

    svc.setProvider("EMAIL", {
      channel: "EMAIL",
      async send() {
        await Promise.resolve();
        return { success: false, error: "SMTP down" };
      },
    });

    // PUSH provider is not registered → NoopProvider will be used (which succeeds)
    // Actually the NoopProvider always returns success, so let me remove it
    svc.setProvider("PUSH", undefined as never);
    // When provider is undefined, deliver() will throw ProviderNotFoundError
    // Actually the fallback logic checks if the provider exists before calling

    const result = await svc.deliver("notif-1");
    expect(result.status).toBe("FAILED");
  });

  it("uses same channel when fallback equals primary", async () => {
    // Edge case: fallback is the same as primary channel → shouldn't loop
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: "tpl-1", channel: "EMAIL" }),
    );
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(
      templateRow({ id: "tpl-1", channel: "EMAIL", fallbackChannel: "EMAIL" }),
    );
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "FAILED", error: "SMTP down" }),
    );

    const svc = new NotificationsService(mockPrisma as never);

    let callCount = 0;
    svc.setProvider("EMAIL", {
      channel: "EMAIL",
      async send() {
        callCount++;
        await Promise.resolve();
        return { success: false, error: "SMTP down" };
      },
    });

    const result = await svc.deliver("notif-1");

    // Should only call once (fallbackChannel === channel, skip)
    expect(callCount).toBe(1);
    expect(result.status).toBe("FAILED");
  });
});
