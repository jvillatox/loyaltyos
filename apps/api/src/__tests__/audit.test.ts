import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  auditLog: {
    create: vi.fn(),
  },
}));

vi.mock("../db.js", () => ({
  prisma: mockPrisma,
}));

import { audit } from "../lib/audit.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("audit()", () => {
  it("records actorType=API_KEY and actorId=<apiKey.id> when actor is API_KEY", async () => {
    mockPrisma.auditLog.create.mockResolvedValue({});

    await audit(
      "prog-1",
      { type: "API_KEY", id: "key-1" },
      "CREATE_NOTIFICATION_TEMPLATE",
      "NotificationTemplate",
      "tpl-1",
      { name: "Test" },
    );

    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    const call = mockPrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: {
        actorType: string;
        actorId: string;
        adminUserId: string | null;
        action: string;
        programId: string;
      };
    };
    expect(call.data.actorType).toBe("API_KEY");
    expect(call.data.actorId).toBe("key-1");
    expect(call.data.adminUserId).toBeNull();
    expect(call.data.action).toBe("CREATE_NOTIFICATION_TEMPLATE");
    expect(call.data.programId).toBe("prog-1");
  });

  it("sets adminUserId when actorType is ADMIN_USER (backward compat)", async () => {
    mockPrisma.auditLog.create.mockResolvedValue({});

    await audit(
      "prog-1",
      { type: "ADMIN_USER", id: "admin-99" },
      "UPDATE_WEBHOOK",
      "WebhookSubscription",
      "wh-1",
    );

    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    const call = mockPrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { actorType: string; actorId: string; adminUserId: string | null };
    };
    expect(call.data.actorType).toBe("ADMIN_USER");
    expect(call.data.actorId).toBe("admin-99");
    expect(call.data.adminUserId).toBe("admin-99");
  });

  it("sets adminUserId to null when actorType is API_KEY", async () => {
    mockPrisma.auditLog.create.mockResolvedValue({});

    await audit(
      "prog-1",
      { type: "API_KEY", id: "key-5" },
      "DELETE_WEBHOOK",
      "WebhookSubscription",
      "wh-2",
    );

    const call = mockPrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { adminUserId: string | null };
    };
    expect(call.data.adminUserId).toBeNull();
  });

  it("sets adminUserId to null when actorType is SYSTEM", async () => {
    mockPrisma.auditLog.create.mockResolvedValue({});

    await audit(
      "prog-1",
      { type: "SYSTEM", id: "cron-scheduler" },
      "DELETE_WEBHOOK",
      "WebhookSubscription",
      null,
    );

    const call = mockPrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { actorType: string; actorId: string; adminUserId: string | null };
    };
    expect(call.data.actorType).toBe("SYSTEM");
    expect(call.data.actorId).toBe("cron-scheduler");
    expect(call.data.adminUserId).toBeNull();
  });

  it("passes through entityId as null", async () => {
    mockPrisma.auditLog.create.mockResolvedValue({});

    await audit(
      "prog-1",
      { type: "SYSTEM", id: "system" },
      "DELETE_NOTIFICATION_TEMPLATE",
      "NotificationTemplate",
      null,
    );

    const call = mockPrisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { entityId: string | null };
    };
    expect(call.data.entityId).toBeNull();
  });
});
