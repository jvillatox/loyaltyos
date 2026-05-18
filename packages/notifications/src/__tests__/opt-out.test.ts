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
    name: "Welcome Email",
    channel: "EMAIL" as const,
    subject: "Welcome!",
    bodyHtml: null,
    bodyText: null,
    triggerEvent: "registration",
    transactional: false,
    fallbackChannel: null,
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
    channel: "SMS" as const,
    status: "PENDING" as const,
    subject: "You earned points!",
    body: "You earned 500 points",
    sentAt: null,
    readAt: null,
    error: null,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

describe("Opt-out logic", () => {
  it("skips notification when member opted out of the channel", async () => {
    // Notification is PENDING for SMS
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: "tpl-1", channel: "SMS" }),
    );
    // Template is NOT transactional
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(
      templateRow({ id: "tpl-1", transactional: false }),
    );
    // Member opted out of SMS
    mockPrisma.memberNotificationPreferences.findUnique.mockResolvedValue({
      optedIn: false,
    });
    // Update to SKIPPED_OPT_OUT
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({
        status: "SKIPPED_OPT_OUT",
        error: "Member opted out of SMS notifications",
      }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    // No enqueue — send directly
    const result = await svc.send("notif-1");

    expect(result.status).toBe("SKIPPED_OPT_OUT");
    expect(mockPrisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED_OPT_OUT",
        }),
      }),
    );
  });

  it("does NOT skip when member has no preference record (defaults to opted in)", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: "tpl-1", channel: "SMS" }),
    );
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(
      templateRow({ id: "tpl-1", transactional: false }),
    );
    // No preference record → defaults to opted in
    mockPrisma.memberNotificationPreferences.findUnique.mockResolvedValue(null);
    // Provider succeeds
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SENT", sentAt: new Date() }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.send("notif-1");

    // Should be SENT (not SKIPPED_OPT_OUT)
    expect(result.status).toBe("SENT");
  });

  it("does NOT skip when member opted in", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: "tpl-1", channel: "EMAIL" }),
    );
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(
      templateRow({ id: "tpl-1", channel: "EMAIL", transactional: false }),
    );
    // Member opted in
    mockPrisma.memberNotificationPreferences.findUnique.mockResolvedValue({
      optedIn: true,
    });
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SENT", sentAt: new Date() }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.send("notif-1");

    expect(result.status).toBe("SENT");
  });

  it("transactional notifications ignore opt-out and are sent", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: "tpl-1", channel: "SMS" }),
    );
    // Transactional template (e.g., auth.magic_link)
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(
      templateRow({ id: "tpl-1", channel: "SMS", transactional: true }),
    );
    // Even though member opted out...
    mockPrisma.memberNotificationPreferences.findUnique.mockResolvedValue({
      optedIn: false,
    });
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SENT", sentAt: new Date() }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.send("notif-1");

    // Transactional → ignores opt-out, sends anyway
    expect(result.status).toBe("SENT");
    // Should NOT have checked preferences (no findUnique call for transactional)
    expect(mockPrisma.memberNotificationPreferences.findUnique).not.toHaveBeenCalled();
  });

  it("enqueues (does not skip) when opted in and queue is configured", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: "tpl-1", channel: "SMS" }),
    );
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(
      templateRow({ id: "tpl-1", transactional: false }),
    );
    mockPrisma.memberNotificationPreferences.findUnique.mockResolvedValue({
      optedIn: true,
    });

    const svc = new NotificationsService(mockPrisma as never);
    let enqueuedId: string | null = null;
    svc.setEnqueue((id) => {
      enqueuedId = id;
      return Promise.resolve();
    });

    const result = await svc.send("notif-1");
    expect(enqueuedId).toBe("notif-1");
    expect(result.status).toBe("PENDING");
  });

  it("skips (does NOT enqueue) when opted out and queue is configured", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: "tpl-1", channel: "SMS" }),
    );
    mockPrisma.notificationTemplate.findFirst.mockResolvedValue(
      templateRow({ id: "tpl-1", transactional: false }),
    );
    mockPrisma.memberNotificationPreferences.findUnique.mockResolvedValue({
      optedIn: false,
    });
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SKIPPED_OPT_OUT" }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    let enqueued = false;
    svc.setEnqueue(() => {
      enqueued = true;
      return Promise.resolve();
    });

    const result = await svc.send("notif-1");
    expect(result.status).toBe("SKIPPED_OPT_OUT");
    expect(enqueued).toBe(false);
  });

  it("skips when notification has no template (safety — no opt-out check, sends normally)", async () => {
    // Notification without templateId
    mockPrisma.notification.findFirst.mockResolvedValue(
      notificationRow({ templateId: null, channel: "EMAIL" }),
    );
    mockPrisma.notification.update.mockResolvedValue(
      notificationRow({ status: "SENT", sentAt: new Date() }),
    );

    const svc = new NotificationsService(mockPrisma as never);
    const result = await svc.send("notif-1");

    // No template → no opt-out check → sent normally
    expect(result.status).toBe("SENT");
  });
});
