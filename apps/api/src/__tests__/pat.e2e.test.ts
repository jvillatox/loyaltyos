import { hashPassword } from "@loyaltyos/core";
import type { AdminRole } from "@loyaltyos/permissions";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

// Personal access tokens (issue #48, PR B). A token is minted once by an admin
// session, shown exactly once, and thereafter acts as that admin with an
// effective role capped by the owner's current role. These tests exercise the
// full auth stack (session → PAT → admin-session-guard → RBAC).

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = Date.now().toString();
const programId = `prog_pat_${suffix}`;
const otherProgramId = `prog_pat_other_${suffix}`;

let superAdminCookie: string;
let superAdminId: string;
let operatorCookie: string;
let operatorId: string;

interface CreatedToken {
  id: string;
  token: string;
  prefix: string;
}

async function loginAs(email: string, password: string): Promise<string> {
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/admin/login",
    payload: { email, password },
  });
  expect(login.statusCode).toBe(200);
  const c = login.cookies.find((x) => x.name === "loyaltyos_admin_session");
  return `${c?.name}=${c?.value}`;
}

async function createToken(cookie: string, role: AdminRole, name: string): Promise<CreatedToken> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/admin/tokens",
    headers: { cookie },
    payload: { name, role, days: 30 },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as CreatedToken;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.program.create({ data: { id: programId, name: `PAT ${suffix}` } });
  await prisma.program.create({ data: { id: otherProgramId, name: `PAT Other ${suffix}` } });

  const password = `pw-${suffix}`;
  const superAdmin = await prisma.adminUser.create({
    data: {
      email: `pat-super-${suffix}@loyaltyos.dev`,
      name: "PAT Super",
      passwordHash: await hashPassword(password),
      role: "SUPER_ADMIN",
      programId,
    },
  });
  superAdminId = superAdmin.id;
  superAdminCookie = await loginAs(superAdmin.email, password);

  const operator = await prisma.adminUser.create({
    data: {
      email: `pat-op-${suffix}@loyaltyos.dev`,
      name: "PAT Operator",
      passwordHash: await hashPassword(password),
      role: "OPERATOR",
      programId,
    },
  });
  operatorId = operator.id;
  operatorCookie = await loginAs(operator.email, password);
});

afterAll(async () => {
  await prisma.campaign.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.auditLog
    .deleteMany({ where: { programId: { in: [programId, otherProgramId] } } })
    .catch(() => {});
  // Admins cascade their tokens and sessions; delete them before the program.
  await prisma.adminUser
    .deleteMany({ where: { programId: { in: [programId, otherProgramId] } } })
    .catch(() => {});
  await prisma.program
    .deleteMany({ where: { id: { in: [programId, otherProgramId] } } })
    .catch(() => {});
  await app.close();
});

describe("PAT lifecycle (session-only)", () => {
  it("mints a token shown exactly once", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tokens",
      headers: { cookie: superAdminCookie },
      payload: { name: `mint-${suffix}`, role: "ANALYST", days: 30 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { token: string; prefix: string; tokenHash?: string } };
    expect(body.data.token.startsWith("lopat_")).toBe(true);
    expect(body.data.prefix).toBe(body.data.token.slice("lopat_".length).slice(0, 8));
    expect(body.data.tokenHash).toBeUndefined();
  });

  it("lists prefix and metadata but never the raw token", async () => {
    const created = await createToken(superAdminCookie, "ANALYST", `list-${suffix}`);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/tokens",
      headers: { cookie: superAdminCookie },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: Array<{ id: string; prefix: string; token?: string }> };
    const row = data.find((t) => t.id === created.id);
    expect(row).toBeDefined();
    expect(row?.prefix).toBe(created.prefix);
    expect(row?.token).toBeUndefined();
    expect(res.body).not.toContain(created.token);
  });

  it("revokes a token so it can no longer authenticate", async () => {
    const created = await createToken(superAdminCookie, "ANALYST", `revoke-${suffix}`);
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/tokens/${created.id}`,
      headers: { cookie: superAdminCookie },
    });
    expect(del.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/campaigns",
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("PAT authentication", () => {
  it("authenticates an admin route", async () => {
    const created = await createToken(superAdminCookie, "OPERATOR", `auth-${suffix}`);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/campaigns",
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects an unknown token with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/campaigns",
      headers: { authorization: "Bearer lopat_doesnotexist0000000000000000" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an expired token with 401", async () => {
    const created = await createToken(superAdminCookie, "OPERATOR", `expired-${suffix}`);
    await prisma.personalAccessToken.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/campaigns",
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a token whose owner was deactivated with 401", async () => {
    const password = `pw-inactive-${suffix}`;
    const admin = await prisma.adminUser.create({
      data: {
        email: `pat-inactive-${suffix}@loyaltyos.dev`,
        name: "PAT Inactive",
        passwordHash: await hashPassword(password),
        role: "OPERATOR",
        programId,
      },
    });
    const cookie = await loginAs(admin.email, password);
    const created = await createToken(cookie, "OPERATOR", `inactive-${suffix}`);

    await prisma.adminUser.update({ where: { id: admin.id }, data: { isActive: false } });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/campaigns",
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("PAT lastUsedAt throttle", () => {
  it("refreshes lastUsedAt at most once a minute", async () => {
    const created = await createToken(superAdminCookie, "OPERATOR", `lastused-${suffix}`);

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/admin/campaigns",
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(first.statusCode).toBe(200);
    const afterFirst = await prisma.personalAccessToken.findUnique({ where: { id: created.id } });
    expect(afterFirst?.lastUsedAt).not.toBeNull();

    const second = await app.inject({
      method: "GET",
      url: "/api/v1/admin/campaigns",
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(second.statusCode).toBe(200);
    const afterSecond = await prisma.personalAccessToken.findUnique({ where: { id: created.id } });
    expect(afterSecond?.lastUsedAt?.getTime()).toBe(afterFirst?.lastUsedAt?.getTime());
  });
});

describe("PAT role enforcement", () => {
  it("ANALYST token is read-only", async () => {
    const created = await createToken(superAdminCookie, "ANALYST", `analyst-${suffix}`);
    const read = await app.inject({
      method: "GET",
      url: "/api/v1/admin/campaigns",
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns",
      headers: { authorization: `Bearer ${created.token}` },
      payload: { name: `analyst-blocked-${suffix}`, type: "BONUS_POINTS" },
    });
    expect(write.statusCode).toBe(403);
  });

  it("OPERATOR token may write", async () => {
    const created = await createToken(superAdminCookie, "OPERATOR", `operator-${suffix}`);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns",
      headers: { authorization: `Bearer ${created.token}` },
      payload: { name: `operator-created-${suffix}`, type: "BONUS_POINTS" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("a token may not out-rank its owner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tokens",
      headers: { cookie: operatorCookie },
      payload: { name: `outrank-${suffix}`, role: "SUPER_ADMIN", days: 30 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("effective role is capped by the owner's current role", async () => {
    const created = await createToken(operatorCookie, "OPERATOR", `cap-${suffix}`);
    // Demote the owner; the token must degrade with them, not stay OPERATOR.
    await prisma.adminUser.update({ where: { id: operatorId }, data: { role: "ANALYST" } });

    const write = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns",
      headers: { authorization: `Bearer ${created.token}` },
      payload: { name: `cap-blocked-${suffix}`, type: "BONUS_POINTS" },
    });
    expect(write.statusCode).toBe(403);
  });
});

describe("a PAT cannot manage tokens or its owner", () => {
  it("cannot list tokens", async () => {
    const created = await createToken(superAdminCookie, "OPERATOR", `no-list-${suffix}`);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/tokens",
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("cannot create tokens", async () => {
    const created = await createToken(superAdminCookie, "OPERATOR", `no-create-${suffix}`);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tokens",
      headers: { authorization: `Bearer ${created.token}` },
      payload: { name: `nested-${suffix}`, role: "ANALYST", days: 30 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("cannot revoke tokens", async () => {
    const created = await createToken(superAdminCookie, "OPERATOR", `no-revoke-${suffix}`);
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/tokens/${created.id}`,
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("cannot update its owner's profile (/admin/me)", async () => {
    const created = await createToken(superAdminCookie, "OPERATOR", `no-me-${suffix}`);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/me",
      headers: { authorization: `Bearer ${created.token}` },
      payload: { name: "Hijacked" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PAT tenant isolation", () => {
  it("rejects a cross-tenant X-Program-Id with 403", async () => {
    const created = await createToken(superAdminCookie, "OPERATOR", `tenant-${suffix}`);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/campaigns",
      headers: {
        authorization: `Bearer ${created.token}`,
        "x-program-id": otherProgramId,
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("no tokenHash leaks from /admin/tokens", () => {
  it("POST response carries the raw token but never tokenHash", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tokens",
      headers: { cookie: superAdminCookie },
      payload: { name: `nohash-post-${suffix}`, role: "ANALYST", days: 30 },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data as { token: string; tokenHash?: string };
    expect(data.token.startsWith("lopat_")).toBe(true);
    expect(data.tokenHash).toBeUndefined();
    expect(res.body).not.toContain("tokenHash");
  });

  it("GET response never includes tokenHash", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/tokens",
      headers: { cookie: superAdminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("tokenHash");
  });

  it("DELETE returns { id, revoked } and never tokenHash (idempotent on re-revoke)", async () => {
    const created = await createToken(superAdminCookie, "ANALYST", `nohash-del-${suffix}`);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/tokens/${created.id}`,
      headers: { cookie: superAdminCookie },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ data: { id: created.id, revoked: true } });
    expect(del.body).not.toContain("tokenHash");

    const delAgain = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/tokens/${created.id}`,
      headers: { cookie: superAdminCookie },
    });
    expect(delAgain.statusCode).toBe(200);
    expect(delAgain.json()).toEqual({ data: { id: created.id, revoked: false } });
    expect(delAgain.body).not.toContain("tokenHash");
  });
});

describe("DELETE /admin/tokens authorization", () => {
  it("returns 404 for a token owned by another program", async () => {
    const password = `pw-other-${suffix}`;
    const otherAdmin = await prisma.adminUser.create({
      data: {
        email: `pat-other-${suffix}@loyaltyos.dev`,
        name: "PAT Other Admin",
        passwordHash: await hashPassword(password),
        role: "SUPER_ADMIN",
        programId: otherProgramId,
      },
    });
    const otherCookie = await loginAs(otherAdmin.email, password);
    const created = await createToken(otherCookie, "ANALYST", `other-program-${suffix}`);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/tokens/${created.id}`,
      headers: { cookie: superAdminCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when a non-SUPER_ADMIN revokes another admin's token in the same program", async () => {
    // A prior test demoted the operator to ANALYST; restore them to OPERATOR so
    // the scenario is a same-program peer (still not SUPER_ADMIN).
    await prisma.adminUser.update({ where: { id: operatorId }, data: { role: "OPERATOR" } });
    const created = await createToken(superAdminCookie, "ANALYST", `other-admin-${suffix}`);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/tokens/${created.id}`,
      headers: { cookie: operatorCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PAT on non-admin and member routes", () => {
  it("ANALYST token is 403 on POST /events", async () => {
    const created = await createToken(superAdminCookie, "ANALYST", `analyst-events-${suffix}`);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { authorization: `Bearer ${created.token}` },
      payload: { type: "purchase" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("ANALYST token is 403 on POST /members", async () => {
    const created = await createToken(superAdminCookie, "ANALYST", `analyst-members-${suffix}`);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/members",
      headers: { authorization: `Bearer ${created.token}` },
      payload: { email: `pat-member-${suffix}@example.com` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a PAT cannot be used on member (portal) routes", async () => {
    const created = await createToken(superAdminCookie, "OPERATOR", `member-route-${suffix}`);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members/me",
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
