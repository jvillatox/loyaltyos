import { hashPassword } from "@loyaltyos/core";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { createAdminUser } from "../admin-create.js";
import { DEFAULT_ORG_ID } from "../lib/tenancy-users.js";
import { deleteTestAdmin } from "./helpers/test-admin.js";

// Covers the `admin:create` CLI path (PR 2, docs/design/tenancy.md §4). Creating
// an admin from the command line creates the identity root User + membership and
// mirrors an AdminUser in the same transaction, and a forced sync failure rolls
// the whole identity back so no orphaned admin survives the CLI.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = Date.now().toString();

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;
});

afterAll(async () => {
  await app.close();
});

describe("createAdminUser", () => {
  it("mirrors an admin into User + OrganizationMembership in one transaction", async () => {
    const email = `cli-${suffix}@loyaltyos.dev`;
    const passwordHash = await hashPassword("pw-cli");

    try {
      const admin = await prisma.$transaction((tx) =>
        createAdminUser(tx, {
          email,
          name: "CLI Admin",
          role: "OPERATOR",
          programId: "prog_dev",
          passwordHash,
        }),
      );

      expect(admin.email).toBe(email);
      expect(admin.role).toBe("OPERATOR");

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      expect(user?.name).toBe("CLI Admin");
      expect(user?.status).toBe("ACTIVE");
      expect(user?.passwordHash).toBe(passwordHash);

      const membership = await prisma.organizationMembership.findUnique({
        where: { userId_organizationId: { userId: user!.id, organizationId: DEFAULT_ORG_ID } },
      });
      expect(membership).not.toBeNull();
      expect(membership?.role).toBe("OPERATOR");
      expect(membership?.programIds).toEqual(["prog_dev"]);
      expect(membership?.status).toBe("ACTIVE");
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });

  it("rolls back the AdminUser when the tenancy sync fails", async () => {
    const email = `cli-rollback-${suffix}@loyaltyos.dev`;
    const passwordHash = await hashPassword("pw-cli-rollback");

    await expect(
      prisma.$transaction((tx) =>
        createAdminUser(
          tx,
          {
            email,
            name: "CLI Rollback",
            role: "ANALYST",
            programId: "prog_dev",
            passwordHash,
          },
          async () => {
            throw new Error("forced sync failure");
          },
        ),
      ),
    ).rejects.toThrow("forced sync failure");

    const admin = await prisma.adminUser.findUnique({ where: { email } });
    expect(admin).toBeNull();
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });
});
