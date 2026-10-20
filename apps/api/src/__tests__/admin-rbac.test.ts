import { buildTools } from "@loyaltyos/ai";
import { hashPassword } from "@loyaltyos/core";
import { maskCode as maskCouponCode } from "@loyaltyos/coupons";
import { maskCode } from "@loyaltyos/giftcards";
import { ADMIN_ROLES, can } from "@loyaltyos/permissions";
import type { AdminRole, Permission } from "@loyaltyos/permissions";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { ADMIN_ROUTE_PERMISSIONS, ADMIN_SELF_SERVICE_PATHS } from "../lib/permissions.js";
import { createInjectLoopbackFetch, toolDefsForRole } from "../routes/admin/ai.js";

// Role-based access control (issue #32, PR B). Three things are proven here:
//
// 1. Every admin route in the permission map enforces its permission for each
//    of the three roles — a denied role gets 403, an allowed role passes the
//    gate (the request may still fail validation downstream, but never with
//    403/401 from the RBAC layer).
// 2. On non-admin routes (members, events, …) an admin session is usable, but
//    ANALYST is read-only — mutating methods return 403.
// 3. The AI companion's loopback carries the admin's session, so an ANALYST who
//    somehow forces a mutating tool still gets a 403 from the underlying route.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = Date.now().toString();
const programId = `prog_rbac_${suffix}`;
const termsTemplateId = `tt_rbac_${suffix}`;
const giftCardBatchId = `gcb_rbac_${suffix}`;
const giftCardId = `gc_rbac_${suffix}`;
const giftCardCode = `RBAC${suffix}`;
const couponId = `cp_rbac_${suffix}`;
const couponCode = `COUPON${suffix}`;
const cookies = {} as Record<AdminRole, string>;
const adminEmails = {} as Record<AdminRole, string>;
const adminIds = {} as Record<AdminRole, string>;

async function loginAs(role: AdminRole): Promise<string> {
  const email = `rbac-${role.toLowerCase()}-${suffix}@loyaltyos.dev`;
  adminEmails[role] = email;
  const password = `pw-${suffix}`;
  const admin = await prisma.adminUser.create({
    data: {
      email,
      name: `RBAC ${role}`,
      passwordHash: await hashPassword(password),
      role,
      programId,
    },
  });
  adminIds[role] = admin.id;
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/admin/login",
    payload: { email, password },
  });
  expect(login.statusCode).toBe(200);
  const c = login.cookies.find((x) => x.name === "loyaltyos_admin_session");
  return `${c?.name}=${c?.value}`;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.program.create({ data: { id: programId, name: `RBAC ${suffix}` } });
  for (const role of ADMIN_ROLES) {
    cookies[role] = await loginAs(role);
  }

  const superAdminId = adminIds.SUPER_ADMIN;
  if (!superAdminId) {
    throw new Error("SUPER_ADMIN id missing after login");
  }

  await prisma.termsTemplate.create({
    data: { id: termsTemplateId, programId, name: `Terms ${suffix}`, body: "terms" },
  });
  await prisma.giftCardBatch.create({
    data: {
      id: giftCardBatchId,
      programId,
      name: `Batch ${suffix}`,
      quantity: 1,
      initialAmount: 100,
      currency: "USD",
      expirationDate: new Date(Date.now() + 86_400_000),
      termsTemplateId,
      status: "ready",
      createdById: superAdminId,
    },
  });
  await prisma.giftCard.create({
    data: {
      id: giftCardId,
      code: giftCardCode,
      batchId: giftCardBatchId,
      initialAmount: 100,
      balance: 50,
      currency: "USD",
      expirationDate: new Date(Date.now() + 86_400_000),
      status: "active",
    },
  });
  await prisma.coalitionConfig.create({
    data: {
      programId,
      provider: "GENERIC",
      endpoint: "https://example.com",
      encryptedCredentials: "encrypted-secret-blob",
    },
  });
  await prisma.coupon.create({
    data: {
      id: couponId,
      programId,
      code: couponCode,
      mode: "SHARED",
      discountType: "PERCENTAGE",
      discountValue: 10,
    },
  });
});

afterAll(async () => {
  // Gift card rows reference an admin (createdById) and a terms template, so
  // they must be removed before the admins/terms they point at.
  await prisma.giftCard.deleteMany({ where: { batchId: giftCardBatchId } }).catch(() => {});
  await prisma.giftCardBatch.deleteMany({ where: { id: giftCardBatchId } }).catch(() => {});
  await prisma.termsTemplate.deleteMany({ where: { id: termsTemplateId } }).catch(() => {});

  for (const role of ADMIN_ROLES) {
    const email = adminEmails[role];
    if (email) {
      const admin = await prisma.adminUser.findUnique({ where: { email } });
      if (admin) {
        await prisma.adminSession.deleteMany({ where: { userId: admin.id } }).catch(() => {});
        await prisma.adminUser.delete({ where: { id: admin.id } }).catch(() => {});
      }
    }
  }
  await prisma.coalitionConfig.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.coupon.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.event.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.program.delete({ where: { id: programId } }).catch(() => {});
  await app.close();
});

describe("route catalog coverage: every admin route has a permission entry", () => {
  const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

  it("no /admin route is missing from the permission map", () => {
    const uncovered = app.routeCatalog
      .filter((r) => r.url.startsWith("/api/v1/admin/"))
      .filter((r) => METHODS.has(r.method))
      .filter((r) => !ADMIN_SELF_SERVICE_PATHS.has(r.url))
      .map((r) => `${r.method} ${r.url}`)
      .filter((key) => !(key in ADMIN_ROUTE_PERMISSIONS));

    expect(uncovered).toEqual([]);
  });
});

describe("RBAC: every admin route honors its permission for each role", () => {
  const entries = Object.entries(ADMIN_ROUTE_PERMISSIONS) as Array<[string, Permission]>;

  for (const [key, permission] of entries) {
    const sep = key.indexOf(" ");
    const method = key.slice(0, sep);
    const path = key.slice(sep + 1);
    const url = path.replace(/:\w+/g, "x");

    for (const role of ADMIN_ROLES) {
      const allowed = can(role, permission);
      it(`${method} ${path} as ${role} → ${allowed ? "passes RBAC" : "403"}`, async () => {
        const res = await app.inject({
          method,
          url,
          headers: { cookie: cookies[role] },
          payload: method === "GET" || method === "DELETE" ? undefined : {},
        });
        if (allowed) {
          expect(res.statusCode).not.toBe(403);
          expect(res.statusCode).not.toBe(401);
        } else {
          expect(res.statusCode).toBe(403);
        }
      });
    }
  }
});

describe("ANALYST is read-only on non-admin routes", () => {
  it("ANALYST can read members", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members",
      headers: { cookie: cookies.ANALYST },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("ANALYST cannot POST /events (403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { cookie: cookies.ANALYST, "idempotency-key": `evt-an-${suffix}` },
      payload: { type: "purchase" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("ANALYST cannot create a member (403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/members",
      headers: { cookie: cookies.ANALYST },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("OPERATOR can POST /events (not 403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { cookie: cookies.OPERATOR, "idempotency-key": `evt-op-${suffix}` },
      payload: { type: "purchase" },
    });
    expect(res.statusCode).not.toBe(403);
  });
});

describe("AI companion: an ANALYST cannot force a mutating tool", () => {
  it("toolDefsForRole hides mutating tools from ANALYST", () => {
    const names = ["create_campaign", "create_segment", "create_coupon", "get_member"];
    const toolDefs = names.map((name) => ({ name, description: "", parameters: {} }));
    const visible = toolDefsForRole("ANALYST", toolDefs).map((t) => t.name);
    expect(visible).toContain("get_member");
    expect(visible).not.toContain("create_campaign");
    expect(visible).not.toContain("create_segment");
    expect(visible).not.toContain("create_coupon");
  });

  it("create_coupon over an ANALYST loopback rejects (403)", async () => {
    const loopback = createInjectLoopbackFetch(app, cookies.ANALYST);
    const tools = buildTools({ fetch: loopback, baseUrl: "http://localhost/api/v1" });
    const createCoupon = tools.find((t) => t.name === "create_coupon")!;
    await expect(
      createCoupon.handler({ mode: "SHARED", discountType: "PERCENTAGE", discountValue: 10 }),
    ).rejects.toThrow();
  });

  it("create_coupon over a SUPER_ADMIN loopback succeeds", async () => {
    const loopback = createInjectLoopbackFetch(app, cookies.SUPER_ADMIN);
    const tools = buildTools({ fetch: loopback, baseUrl: "http://localhost/api/v1" });
    const createCoupon = tools.find((t) => t.name === "create_coupon")!;
    const result = await createCoupon.handler({
      code: `RBAC${suffix}`,
      mode: "SHARED",
      discountType: "PERCENTAGE",
      discountValue: 10,
    });
    const created = JSON.parse(result) as { id: string; programId: string };
    expect(created.id).toBeTruthy();
    expect(created.programId).toBe(programId);
  });
});

describe("gift card codes: reveal is SUPER_ADMIN-only and masking is server-side", () => {
  // The route-catalog test above already proves OPERATOR and ANALYST get 403 on
  // the export route (it maps to giftcards.codes.reveal). Here we assert the
  // SUPER_ADMIN side: the export streams and carries the full code.
  it("SUPER_ADMIN can export batch codes (200)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/giftcards/batches/${giftCardBatchId}/export?format=csv`,
      headers: { cookie: cookies.SUPER_ADMIN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(giftCardCode);
  });

  it("ANALYST sees a masked code in card detail", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/giftcards/cards/${giftCardId}`,
      headers: { cookie: cookies.ANALYST },
    });
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { code: string } };
    expect(data.code).toBe(maskCode(giftCardCode));
    expect(data.code).not.toBe(giftCardCode);
  });

  it("OPERATOR sees a masked code in the batch card list", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/giftcards/batches/${giftCardBatchId}/cards`,
      headers: { cookie: cookies.OPERATOR },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { items: Array<{ code: string }> } };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.code).toBe(maskCode(giftCardCode));
    expect(body.data.items[0]?.code).not.toBe(giftCardCode);
  });

  it("OPERATOR sees a masked code from lookup", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/giftcards/lookup",
      headers: { cookie: cookies.OPERATOR },
      payload: { code: giftCardCode },
    });
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { code: string } };
    expect(data.code).toBe(maskCode(giftCardCode));
  });

  it("SUPER_ADMIN sees the full code in card detail", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/giftcards/cards/${giftCardId}`,
      headers: { cookie: cookies.SUPER_ADMIN },
    });
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { code: string } };
    expect(data.code).toBe(giftCardCode);
  });
});

describe("coupon codes: only OPERATOR+ may reveal, ANALYST is masked", () => {
  it("ANALYST sees a masked code in the coupon list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/coupons",
      headers: { cookie: cookies.ANALYST },
    });
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as {
      data: { items: Array<{ id: string; code: string }> };
    };
    const coupon = data.items.find((c) => c.id === couponId);
    expect(coupon?.code).toBe(maskCouponCode(couponCode));
    expect(coupon?.code).not.toBe(couponCode);
  });

  it("ANALYST sees a masked code in coupon detail", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/coupons/${couponId}`,
      headers: { cookie: cookies.ANALYST },
    });
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { code: string } };
    expect(data.code).toBe(maskCouponCode(couponCode));
    expect(data.code).not.toBe(couponCode);
  });

  it("ANALYST sees a masked code in coupon stats", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/coupons/${couponId}/stats`,
      headers: { cookie: cookies.ANALYST },
    });
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { code: string } };
    expect(data.code).toBe(maskCouponCode(couponCode));
    expect(data.code).not.toBe(couponCode);
  });

  it("OPERATOR sees the full code in coupon detail", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/coupons/${couponId}`,
      headers: { cookie: cookies.OPERATOR },
    });
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { code: string } };
    expect(data.code).toBe(couponCode);
  });

  it("SUPER_ADMIN sees the full code in coupon detail", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/coupons/${couponId}`,
      headers: { cookie: cookies.SUPER_ADMIN },
    });
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { code: string } };
    expect(data.code).toBe(couponCode);
  });
});

describe("coalition config: credentials are write-only", () => {
  it("GET /admin/coalition/config returns hasCredentials, never encryptedCredentials", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/coalition/config",
      headers: { cookie: cookies.SUPER_ADMIN },
    });
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as {
      data: { hasCredentials: boolean; encryptedCredentials?: string };
    };
    expect(data.hasCredentials).toBe(true);
    expect(data.encryptedCredentials).toBeUndefined();
    expect(res.body).not.toContain("encrypted-secret-blob");
  });

  it("PUT /admin/coalition/config returns hasCredentials, never encryptedCredentials", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/coalition/config",
      headers: { cookie: cookies.SUPER_ADMIN },
      payload: {
        provider: "GENERIC",
        endpoint: "https://example.com",
        credentials: { publicToken: "pub", privateToken: "priv" },
        conversionRate: 1,
        minConversionPoints: 500,
      },
    });
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as {
      data: { hasCredentials: boolean; encryptedCredentials?: string };
    };
    expect(data.hasCredentials).toBe(true);
    expect(data.encryptedCredentials).toBeUndefined();
    expect(res.body).not.toContain("encryptedCredentials");
  });
});
