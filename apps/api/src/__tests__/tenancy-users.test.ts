import { hashPassword } from "@loyaltyos/core";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import {
  assertUniqueAdminEmails,
  backfillTenancyUsers,
  DEFAULT_ORG_ID,
  syncAdminUserToTenancy,
} from "../lib/tenancy-users.js";

// Tenancy mirror (PR 2, docs/design/tenancy.md §4). These tests prove the
// compatibility path: every AdminUser write is mirrored into User +
// OrganizationMembership in the same transaction, the backfill is idempotent,
// duplicate emails are rejected loudly, and admin login / PATCH /admin/me keep
// working while staying in sync. Existing admin-auth.test.ts and pat.e2e.test.ts
// already cover login + personal access token regression unchanged.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = Date.now().toString();

async function cleanupAdmin(email: string): Promise<void> {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (admin) {
    await prisma.adminSession.deleteMany({ where: { userId: admin.id } }).catch(() => {});
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.organizationMembership.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  await prisma.adminUser.deleteMany({ where: { email } }).catch(() => {});
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;
});

afterAll(async () => {
  await app.close();
});

describe("syncAdminUserToTenancy", () => {
  it("mirrors an AdminUser into a User and OrganizationMembership", async () => {
    const email = `sync-${suffix}@loyaltyos.dev`;
    const admin = await prisma.adminUser.create({
      data: {
        email,
        name: "Sync Test",
        passwordHash: await hashPassword("pw-sync"),
        role: "OPERATOR",
        programId: "prog_dev",
      },
    });

    try {
      await syncAdminUserToTenancy(prisma, admin);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      expect(user?.name).toBe("Sync Test");
      expect(user?.status).toBe("ACTIVE");
      expect(user?.passwordHash).toBe(admin.passwordHash);

      const membership = await prisma.organizationMembership.findUnique({
        where: { userId_organizationId: { userId: user!.id, organizationId: DEFAULT_ORG_ID } },
      });
      expect(membership).not.toBeNull();
      expect(membership?.role).toBe("OPERATOR");
      expect(membership?.programIds).toEqual(["prog_dev"]);
    } finally {
      await cleanupAdmin(email);
    }
  });

  it("reflects an isActive=false AdminUser as a DISABLED user/membership", async () => {
    const email = `inactive-${suffix}@loyaltyos.dev`;
    const admin = await prisma.adminUser.create({
      data: {
        email,
        name: "Inactive Test",
        passwordHash: await hashPassword("pw-inactive"),
        role: "ANALYST",
        programId: "prog_dev",
        isActive: false,
      },
    });

    try {
      await syncAdminUserToTenancy(prisma, admin);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user?.status).toBe("DISABLED");
      const membership = await prisma.organizationMembership.findUnique({
        where: { userId_organizationId: { userId: user!.id, organizationId: DEFAULT_ORG_ID } },
      });
      expect(membership?.status).toBe("DISABLED");
    } finally {
      await cleanupAdmin(email);
    }
  });

  it("updates the membership role when the AdminUser role changes", async () => {
    const email = `role-${suffix}@loyaltyos.dev`;
    const admin = await prisma.adminUser.create({
      data: {
        email,
        name: "Role Test",
        passwordHash: await hashPassword("pw-role"),
        role: "OPERATOR",
        programId: "prog_dev",
      },
    });

    try {
      await syncAdminUserToTenancy(prisma, admin);
      const updated = await prisma.adminUser.update({
        where: { id: admin.id },
        data: { role: "ANALYST" },
      });
      await syncAdminUserToTenancy(prisma, updated);

      const user = await prisma.user.findUnique({ where: { email } });
      const membership = await prisma.organizationMembership.findUnique({
        where: { userId_organizationId: { userId: user!.id, organizationId: DEFAULT_ORG_ID } },
      });
      expect(membership?.role).toBe("ANALYST");
    } finally {
      await cleanupAdmin(email);
    }
  });
});

describe("backfillTenancyUsers", () => {
  it("is idempotent: two runs produce the same records", async () => {
    const email = `backfill-${suffix}@loyaltyos.dev`;
    await prisma.adminUser.create({
      data: {
        email,
        name: "Backfill Test",
        passwordHash: await hashPassword("pw-backfill"),
        role: "OPERATOR",
        programId: "prog_dev",
      },
    });

    try {
      const first = await backfillTenancyUsers(prisma);
      const second = await backfillTenancyUsers(prisma);

      expect(second.userCount).toBe(first.userCount);
      expect(second.membershipCount).toBe(first.membershipCount);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      const memberships = await prisma.organizationMembership.findMany({
        where: { userId: user!.id, organizationId: DEFAULT_ORG_ID },
      });
      expect(memberships).toHaveLength(1);
    } finally {
      await cleanupAdmin(email);
    }
  });
});

describe("duplicate AdminUser email handling", () => {
  it("rejects a second AdminUser with the same email (P2002)", async () => {
    const email = `dup-${suffix}@loyaltyos.dev`;
    const admin = await prisma.adminUser.create({
      data: {
        email,
        name: "Duplicate Test",
        passwordHash: await hashPassword("pw-dup"),
        role: "OPERATOR",
        programId: "prog_dev",
      },
    });

    try {
      await expect(
        prisma.adminUser.create({
          data: {
            email,
            name: "Duplicate Test 2",
            passwordHash: await hashPassword("pw-dup-2"),
            role: "ANALYST",
            programId: "prog_dev",
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    } finally {
      await cleanupAdmin(email);
    }
  });

  it("assertUniqueAdminEmails fails with a clear message on duplicates", () => {
    expect(() =>
      assertUniqueAdminEmails(["a@loyaltyos.dev", "b@loyaltyos.dev", "a@loyaltyos.dev"]),
    ).toThrowError(/duplicate AdminUser email "a@loyaltyos.dev"/);
  });

  it("assertUniqueAdminEmails passes on unique emails", () => {
    expect(() => assertUniqueAdminEmails(["a@loyaltyos.dev", "b@loyaltyos.dev"])).not.toThrow();
  });
});

describe("admin auth stays in sync with the mirror", () => {
  it("POST /admin/login mirrors lastLoginAt to the User", async () => {
    const email = `login-sync-${suffix}@loyaltyos.dev`;
    const password = "pw-login-sync";
    await prisma.adminUser.create({
      data: {
        email,
        name: "Login Sync",
        passwordHash: await hashPassword(password),
        role: "OPERATOR",
        programId: "prog_dev",
      },
    });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        payload: { email, password },
      });
      expect(res.statusCode).toBe(200);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      expect(user?.lastLoginAt).not.toBeNull();
    } finally {
      await cleanupAdmin(email);
    }
  });

  it("PATCH /admin/me mirrors a name change to the User", async () => {
    const email = `patch-sync-${suffix}@loyaltyos.dev`;
    const password = "pw-patch-sync";
    await prisma.adminUser.create({
      data: {
        email,
        name: "Before",
        passwordHash: await hashPassword(password),
        role: "OPERATOR",
        programId: "prog_dev",
      },
    });

    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        payload: { email, password },
      });
      expect(login.statusCode).toBe(200);
      const cookie = login.cookies.find((c) => c.name === "loyaltyos_admin_session");

      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/me",
        headers: { cookie: `${cookie?.name}=${cookie?.value}` },
        payload: { name: "After" },
      });
      expect(res.statusCode).toBe(200);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user?.name).toBe("After");
    } finally {
      await cleanupAdmin(email);
    }
  });
});
