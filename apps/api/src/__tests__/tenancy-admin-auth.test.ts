import { hashPassword } from "@loyaltyos/core";
import type { AdminRole } from "@loyaltyos/permissions";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "../app.js";
import { generateToken } from "../lib/personal-access-token.js";
import { DEFAULT_ORG_ID } from "../lib/tenancy-users.js";
import { createTestAdmin, deleteTestAdmin } from "./helpers/test-admin.js";

// PR 7 — auth now reads the tenancy identity root (docs/design/tenancy.md §7).
// These tests prove `POST /admin/login` authenticates against `User.passwordHash`
// (not the AdminUser mirror), the role + program scope come from the active
// `OrganizationMembership`, a user can switch org/program (persisting the choice
// on the session), deactivating a User/membership blocks the *next* request, a
// cross-program `X-Program-Id` is rejected, a PAT cannot switch org, and the
// `TENANCY_ADMIN_AUTH=legacy` rollback mode still logs in while org endpoints
// return 404. Actual row-level isolation under `TENANCY_RLS=enforce` is covered
// separately in tenancy-rls.db.test.ts.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = Date.now().toString();
const programAId = `prog_taa_${suffix}`;
const programBId = `prog_taa_b_${suffix}`;
const orgTwoId = `org_taa_two_${suffix}`;
const programTwoId = `prog_taa_two_${suffix}`;

// Each login consumes a slot in the `/admin/login` rate limit (max 5/min, keyed
// by IP). Assign a unique remoteAddress per login so tests never trip the limit.
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.20.${ipCounter}.1`;
}

async function loginAs(email: string, password: string): Promise<string> {
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/admin/login",
    remoteAddress: nextIp(),
    payload: { email, password },
  });
  expect(login.statusCode).toBe(200);
  const c = login.cookies.find((x) => x.name === "loyaltyos_admin_session");
  return `${c?.name}=${c?.value}`;
}

async function mintPat(adminUserId: string, role: AdminRole): Promise<string> {
  const { token, tokenHash, prefix } = generateToken();
  await prisma.personalAccessToken.create({
    data: {
      adminUserId,
      name: `taa-pat-${suffix}`,
      tokenHash,
      prefix,
      role,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.organization.create({
    data: { id: orgTwoId, name: `TAA Org Two ${suffix}` },
  });
  await prisma.program.create({
    data: { id: programAId, name: `TAA Program A ${suffix}`, organizationId: DEFAULT_ORG_ID },
  });
  await prisma.program.create({
    data: { id: programBId, name: `TAA Program B ${suffix}`, organizationId: DEFAULT_ORG_ID },
  });
  await prisma.program.create({
    data: { id: programTwoId, name: `TAA Program Two ${suffix}`, organizationId: orgTwoId },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  // FK-safe order: audit logs (composite FK on programId) and campaigns first,
  // then the programs, then the second organization.
  await prisma.auditLog
    .deleteMany({ where: { programId: { in: [programAId, programBId, programTwoId] } } })
    .catch(() => {});
  await prisma.campaign
    .deleteMany({ where: { programId: { in: [programAId, programBId, programTwoId] } } })
    .catch(() => {});
  await prisma.program
    .deleteMany({ where: { id: { in: [programAId, programBId, programTwoId] } } })
    .catch(() => {});
  await prisma.organization.deleteMany({ where: { id: orgTwoId } }).catch(() => {});
  await app.close();
});

describe("login reads the identity User", () => {
  it("authenticates against User.passwordHash, not the AdminUser mirror", async () => {
    const email = `taa-userhash-${suffix}@loyaltyos.dev`;
    const { user } = await createTestAdmin(prisma, {
      email,
      password: "original-pw",
      role: "OPERATOR",
      programId: programAId,
    });

    try {
      // Rewrite only the User's password hash; the AdminUser mirror keeps the
      // original. A login against the mirror would accept "original-pw".
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword("new-pw") },
      });

      const stale = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        remoteAddress: nextIp(),
        payload: { email, password: "original-pw" },
      });
      expect(stale.statusCode).toBe(401);

      const fresh = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        remoteAddress: nextIp(),
        payload: { email, password: "new-pw" },
      });
      expect(fresh.statusCode).toBe(200);
      expect(fresh.json().data.admin.email).toBe(email);

      // The session belongs to the User (not the AdminUser id).
      const session = await prisma.adminSession.findFirst({ where: { userId: user.id } });
      expect(session).not.toBeNull();
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });

  it("resolves the role from the active membership", async () => {
    const email = `taa-role-${suffix}@loyaltyos.dev`;
    const { membership } = await createTestAdmin(prisma, {
      email,
      password: "pw-role",
      role: "OPERATOR",
      programId: programAId,
    });

    try {
      await prisma.organizationMembership.update({
        where: { id: membership.id },
        data: { role: "SUPER_ADMIN" },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        remoteAddress: nextIp(),
        payload: { email, password: "pw-role" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.admin.role).toBe("SUPER_ADMIN");
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });

  it("rejects a disabled User at login", async () => {
    const email = `taa-disabled-login-${suffix}@loyaltyos.dev`;
    const { user } = await createTestAdmin(prisma, {
      email,
      password: "pw-disabled",
      role: "OPERATOR",
      programId: programAId,
    });

    try {
      await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        remoteAddress: nextIp(),
        payload: { email, password: "pw-disabled" },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });
});

describe("per-request verification (no cached role/status)", () => {
  it("a disabled membership blocks the next request", async () => {
    const email = `taa-disabled-req-${suffix}@loyaltyos.dev`;
    const { membership } = await createTestAdmin(prisma, {
      email,
      password: "pw-req",
      role: "OPERATOR",
      programId: programAId,
    });

    try {
      const cookie = await loginAs(email, "pw-req");
      const before = await app.inject({
        method: "GET",
        url: "/api/v1/admin/campaigns",
        headers: { cookie },
      });
      expect(before.statusCode).toBe(200);

      await prisma.organizationMembership.update({
        where: { id: membership.id },
        data: { status: "DISABLED" },
      });

      const after = await app.inject({
        method: "GET",
        url: "/api/v1/admin/campaigns",
        headers: { cookie },
      });
      expect(after.statusCode).toBe(401);
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });

  it("a role change takes effect on the next request", async () => {
    const email = `taa-demote-${suffix}@loyaltyos.dev`;
    const { membership } = await createTestAdmin(prisma, {
      email,
      password: "pw-demote",
      role: "OPERATOR",
      programId: programAId,
    });

    try {
      const cookie = await loginAs(email, "pw-demote");
      const before = await app.inject({
        method: "POST",
        url: "/api/v1/admin/campaigns",
        headers: { cookie },
        payload: { name: `taa-campaign-${suffix}`, type: "BONUS_POINTS" },
      });
      expect(before.statusCode).toBe(201);

      await prisma.organizationMembership.update({
        where: { id: membership.id },
        data: { role: "ANALYST" },
      });

      const after = await app.inject({
        method: "POST",
        url: "/api/v1/admin/campaigns",
        headers: { cookie },
        payload: { name: `taa-campaign-denied-${suffix}`, type: "BONUS_POINTS" },
      });
      expect(after.statusCode).toBe(403);
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });
});

describe("org/program selection", () => {
  it("defaults to the legacy AdminUser's org and switches to a second membership", async () => {
    const email = `taa-switch-${suffix}@loyaltyos.dev`;
    const { user } = await createTestAdmin(prisma, {
      email,
      password: "pw-switch",
      role: "OPERATOR",
      programId: programAId,
    });

    try {
      await prisma.organizationMembership.create({
        data: {
          userId: user.id,
          organizationId: orgTwoId,
          role: "OPERATOR",
          programIds: [programTwoId],
          status: "ACTIVE",
        },
      });

      const login = await app.inject({
        method: "POST",
        url: "/api/v1/admin/login",
        remoteAddress: nextIp(),
        payload: { email, password: "pw-switch" },
      });
      expect(login.statusCode).toBe(200);
      // Rule 7: the default org is the membership containing the AdminUser's
      // program (org_default), not the second (older-created) membership.
      expect(login.json().data.organizationId).toBe(DEFAULT_ORG_ID);
      expect(login.json().data.programId).toBe(programAId);
      const cookie = login.cookies.find((c) => c.name === "loyaltyos_admin_session");

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/organizations",
        headers: { cookie: `${cookie?.name}=${cookie?.value}` },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data).toHaveLength(2);

      const switched = await app.inject({
        method: "POST",
        url: "/api/v1/admin/organizations/active",
        headers: { cookie: `${cookie?.name}=${cookie?.value}` },
        payload: { organizationId: orgTwoId, programId: programTwoId },
      });
      expect(switched.statusCode).toBe(200);
      expect(switched.json().data).toEqual({
        organizationId: orgTwoId,
        programId: programTwoId,
      });
      const newCookie = switched.cookies.find((c) => c.name === "loyaltyos_admin_session");

      const me = await app.inject({
        method: "GET",
        url: "/api/v1/admin/me",
        headers: { cookie: `${newCookie?.name}=${newCookie?.value}` },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().data.programId).toBe(programTwoId);
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });

  it("rejects a switch to a non-membership org (403)", async () => {
    const email = `taa-switch-denied-${suffix}@loyaltyos.dev`;
    await createTestAdmin(prisma, {
      email,
      password: "pw-switch-denied",
      role: "OPERATOR",
      programId: programAId,
    });

    try {
      const cookie = await loginAs(email, "pw-switch-denied");
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/organizations/active",
        headers: { cookie },
        payload: { organizationId: orgTwoId },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });
});

describe("program scope", () => {
  it("rejects a cross-program X-Program-Id (403)", async () => {
    const email = `taa-scope-${suffix}@loyaltyos.dev`;
    await createTestAdmin(prisma, {
      email,
      password: "pw-scope",
      role: "OPERATOR",
      programId: programAId,
    });

    try {
      const cookie = await loginAs(email, "pw-scope");
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/campaigns",
        headers: { cookie, "x-program-id": programBId },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });
});

describe("/admin/me", () => {
  it("reflects the membership role and active program", async () => {
    const email = `taa-me-${suffix}@loyaltyos.dev`;
    const { admin } = await createTestAdmin(prisma, {
      email,
      password: "pw-me",
      role: "OPERATOR",
      programId: programAId,
    });

    try {
      const cookie = await loginAs(email, "pw-me");
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/me",
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data as {
        id: string;
        email: string;
        name: string;
        role: string;
        locale: string;
        programId: string;
      };
      expect(data.id).toBe(admin.id);
      expect(data.email).toBe(email);
      expect(data.role).toBe("OPERATOR");
      expect(data.programId).toBe(programAId);
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });
});

describe("a PAT cannot switch org/program", () => {
  it("POST /admin/organizations/active is 403 for a PAT", async () => {
    const email = `taa-pat-switch-${suffix}@loyaltyos.dev`;
    const { admin } = await createTestAdmin(prisma, {
      email,
      password: "pw-pat-switch",
      role: "OPERATOR",
      programId: programAId,
    });

    try {
      const token = await mintPat(admin.id, "OPERATOR");
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/organizations/active",
        headers: { authorization: `Bearer ${token}` },
        payload: { organizationId: DEFAULT_ORG_ID },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });
});

describe("legacy mode (TENANCY_ADMIN_AUTH=legacy)", () => {
  it("logs in against the AdminUser and serves org endpoints 404", async () => {
    vi.stubEnv("TENANCY_ADMIN_AUTH", "legacy");
    const email = `taa-legacy-${suffix}@loyaltyos.dev`;
    await createTestAdmin(prisma, {
      email,
      password: "pw-legacy",
      role: "OPERATOR",
      programId: programAId,
    });

    try {
      const cookie = await loginAs(email, "pw-legacy");

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/organizations",
        headers: { cookie },
      });
      expect(list.statusCode).toBe(404);

      const switchRes = await app.inject({
        method: "POST",
        url: "/api/v1/admin/organizations/active",
        headers: { cookie },
        payload: { organizationId: DEFAULT_ORG_ID },
      });
      expect(switchRes.statusCode).toBe(404);
    } finally {
      await deleteTestAdmin(prisma, email);
    }
  });
});
