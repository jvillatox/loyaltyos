import { hashPassword } from "@loyaltyos/core";
import type { AdminRole } from "@loyaltyos/permissions";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInMemoryMcp, LoyaltyOSClient, type InMemoryMcp } from "@loyaltyos/mcp-server";

import { buildApp } from "../app.js";
import { generateToken } from "../lib/personal-access-token.js";

// Real-API E2E for the MCP server (issue #48, PR B). Boots the actual Fastify
// app against Postgres, mints a personal access token per role, and drives each
// of the 21 MCP tools over an in-memory MCP transport whose handlers make real
// HTTP calls. Verifies the RBAC map end-to-end: reads succeed for every role,
// mutations are 403 for ANALYST, webhooks are SUPER_ADMIN-only, and gift-card /
// coupon codes are masked unless the role may reveal them.
//
// It runs in the default suite (like `pat.e2e.test.ts`) and is also the target
// of the dedicated `test:mcp` script and the `mcp-e2e` CI job, which run it in
// isolation on MCP-related path changes and always on release.

const ROLES: readonly AdminRole[] = ["SUPER_ADMIN", "OPERATOR", "ANALYST"] as const;
const ROLE_SHORT: Record<AdminRole, string> = {
  SUPER_ADMIN: "SUP",
  OPERATOR: "OPR",
  ANALYST: "ANL",
};

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = Date.now().toString();
const programId = `prog_mcp_${suffix}`;

let memberId: string;
let campaignId: string;
let batchId: string;
let giftCardCode: string;
let couponId: string;
let couponCode: string;

const clients: Record<AdminRole, LoyaltyOSClient> = {} as Record<AdminRole, LoyaltyOSClient>;
const mcps: Record<AdminRole, InMemoryMcp> = {} as Record<AdminRole, InMemoryMcp>;

async function mintPat(adminUserId: string, role: AdminRole, name: string): Promise<string> {
  const { token, tokenHash, prefix } = generateToken();
  await prisma.personalAccessToken.create({
    data: {
      adminUserId,
      name,
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

  await prisma.program.create({ data: { id: programId, name: `MCP E2E ${suffix}` } });

  const password = `pw-${suffix}`;
  const admins: Record<AdminRole, string> = {} as Record<AdminRole, string>;
  for (const role of ROLES) {
    const admin = await prisma.adminUser.create({
      data: {
        email: `mcp-${role.toLowerCase()}-${suffix}@loyaltyos.dev`,
        name: `MCP ${role}`,
        passwordHash: await hashPassword(password),
        role,
        programId,
      },
    });
    admins[role] = admin.id;
  }

  const member = await prisma.member.create({
    data: {
      programId,
      email: `mcp-member-${suffix}@example.com`,
      firstName: "Mcp",
      lastName: "Member",
    },
  });
  memberId = member.id;

  const campaign = await prisma.campaign.create({
    data: { programId, name: `MCP Campaign ${suffix}`, type: "BONUS_POINTS", isActive: false },
  });
  campaignId = campaign.id;

  const termsTemplate = await prisma.termsTemplate.create({
    data: {
      programId,
      name: `MCP Terms ${suffix}`,
      locale: "es-MX",
      body: "Términos de prueba",
      version: 1,
    },
  });

  const batch = await prisma.giftCardBatch.create({
    data: {
      programId,
      name: `MCP Batch ${suffix}`,
      quantity: 1,
      initialAmount: 100,
      currency: "MXN",
      expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      termsTemplateId: termsTemplate.id,
      status: "ready",
      generatedCount: 1,
      createdById: admins.SUPER_ADMIN,
    },
  });
  batchId = batch.id;

  giftCardCode = `GIFTMCP${suffix}`;
  await prisma.giftCard.create({
    data: {
      code: giftCardCode,
      batchId: batch.id,
      initialAmount: 100,
      balance: 100,
      currency: "MXN",
      expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      status: "active",
    },
  });

  const coupon = await prisma.coupon.create({
    data: {
      programId,
      code: `MCPCOUPON${suffix}`,
      mode: "SHARED",
      discountType: "FIXED",
      discountValue: 10,
    },
  });
  couponId = coupon.id;
  couponCode = coupon.code;

  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  for (const role of ROLES) {
    const token = await mintPat(admins[role], role, `mcp-e2e-${role.toLowerCase()}`);
    clients[role] = new LoyaltyOSClient(baseUrl, token);
    mcps[role] = await createInMemoryMcp(clients[role]);
  }
});

afterAll(async () => {
  for (const role of ROLES) {
    await mcps[role]?.close().catch(() => {});
  }
  await app.close().catch(() => {});

  // Delete in FK-safe order: gift cards → batches → terms → the rest.
  await prisma.giftCard.deleteMany({ where: { batchId } }).catch(() => {});
  await prisma.giftCardBatch.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.termsTemplate.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.coupon.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.segment.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.reward.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.campaign.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.member.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.adminUser.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.program.deleteMany({ where: { id: programId } }).catch(() => {});
});

const READ_TOOLS: ReadonlyArray<{ name: string; args: () => Record<string, unknown> }> = [
  { name: "analytics_dashboard", args: () => ({}) },
  { name: "analytics_campaign", args: () => ({ campaignId }) },
  { name: "campaigns_list", args: () => ({}) },
  { name: "campaign_get", args: () => ({ campaignId }) },
  { name: "giftcards_batch_status", args: () => ({ batchId }) },
  { name: "giftcards_lookup", args: () => ({ code: giftCardCode }) },
  { name: "member_get", args: () => ({ memberId }) },
  { name: "members_list", args: () => ({}) },
  { name: "member_points_history", args: () => ({ memberId }) },
  { name: "member_badges", args: () => ({ memberId }) },
  { name: "program_config_get", args: () => ({}) },
  { name: "rewards_catalog", args: () => ({}) },
  { name: "segments_list", args: () => ({}) },
  { name: "segment_preview", args: () => ({}) },
];

const WRITE_TOOLS: ReadonlyArray<{
  name: string;
  args: (role: AdminRole) => Record<string, unknown>;
}> = [
  {
    name: "campaign_create",
    args: (role) => ({ name: `mcp-campaign-${ROLE_SHORT[role]}-${suffix}`, type: "BONUS_POINTS" }),
  },
  { name: "campaign_activate", args: () => ({ campaignId, action: "activate" }) },
  { name: "campaign_pause", args: () => ({ campaignId, action: "pause" }) },
  {
    name: "coupon_create",
    args: (role) => ({
      code: `MCP${ROLE_SHORT[role]}${suffix}`,
      mode: "SHARED",
      discountType: "FIXED",
    }),
  },
  {
    name: "reward_create",
    args: (role) => ({ name: `mcp-reward-${ROLE_SHORT[role]}-${suffix}`, pointsCost: 100 }),
  },
  {
    name: "segment_create",
    args: (role) => ({ name: `mcp-segment-${ROLE_SHORT[role]}-${suffix}`, type: "STATIC" }),
  },
];

describe("MCP read tools return 2xx for every role", () => {
  for (const role of ROLES) {
    it(`all read tools succeed as ${role}`, async () => {
      for (const tool of READ_TOOLS) {
        const res = await mcps[role].callTool(tool.name, tool.args());
        expect(res.isError, `${tool.name} as ${role}: ${res.text}`).toBe(false);
      }
    });
  }
});

describe("MCP mutation tools enforce RBAC", () => {
  for (const role of ["SUPER_ADMIN", "OPERATOR"] as const) {
    it(`all mutations succeed as ${role}`, async () => {
      for (const tool of WRITE_TOOLS) {
        const res = await mcps[role].callTool(tool.name, tool.args(role));
        expect(res.isError, `${tool.name} as ${role}: ${res.text}`).toBe(false);
      }
    });
  }

  it("every mutation is denied (403) for ANALYST", async () => {
    for (const tool of WRITE_TOOLS) {
      const res = await mcps.ANALYST.callTool(tool.name, tool.args("ANALYST"));
      expect(res.isError, `${tool.name} should be denied for ANALYST`).toBe(true);
    }
  });
});

describe("webhooks_list is SUPER_ADMIN-only", () => {
  it("succeeds for SUPER_ADMIN", async () => {
    const res = await mcps.SUPER_ADMIN.callTool("webhooks_list", {});
    expect(res.isError, res.text).toBe(false);
  });

  it("is denied for OPERATOR", async () => {
    const res = await mcps.OPERATOR.callTool("webhooks_list", {});
    expect(res.isError).toBe(true);
  });

  it("is denied for ANALYST", async () => {
    const res = await mcps.ANALYST.callTool("webhooks_list", {});
    expect(res.isError).toBe(true);
  });
});

describe("gift card code masking", () => {
  it("SUPER_ADMIN sees the full code", async () => {
    const res = await mcps.SUPER_ADMIN.callTool("giftcards_lookup", { code: giftCardCode });
    expect(res.isError, res.text).toBe(false);
    const body = JSON.parse(res.text) as { data: { code: string } };
    expect(body.data.code).toBe(giftCardCode);
  });

  it("OPERATOR sees a masked code", async () => {
    const res = await mcps.OPERATOR.callTool("giftcards_lookup", { code: giftCardCode });
    expect(res.isError, res.text).toBe(false);
    const body = JSON.parse(res.text) as { data: { code: string } };
    expect(body.data.code).not.toBe(giftCardCode);
    expect(body.data.code).toContain("•");
    expect(body.data.code.endsWith(giftCardCode.slice(-4))).toBe(true);
  });

  it("ANALYST sees a masked code", async () => {
    const res = await mcps.ANALYST.callTool("giftcards_lookup", { code: giftCardCode });
    expect(res.isError, res.text).toBe(false);
    const body = JSON.parse(res.text) as { data: { code: string } };
    expect(body.data.code).not.toBe(giftCardCode);
    expect(body.data.code).toContain("•");
    expect(body.data.code.endsWith(giftCardCode.slice(-4))).toBe(true);
  });
});

describe("coupon code masking", () => {
  // There is no coupon-read MCP tool, so exercise the same HTTP path the MCP
  // client uses (GET /admin/coupons/:id) directly per role.
  it("SUPER_ADMIN sees the full code", async () => {
    const body = await clients.SUPER_ADMIN.get<{ data: { code: string } }>(
      `/api/v1/admin/coupons/${couponId}`,
    );
    expect(body.data.code).toBe(couponCode);
  });

  it("OPERATOR sees the full code", async () => {
    const body = await clients.OPERATOR.get<{ data: { code: string } }>(
      `/api/v1/admin/coupons/${couponId}`,
    );
    expect(body.data.code).toBe(couponCode);
  });

  it("ANALYST sees a masked code", async () => {
    const body = await clients.ANALYST.get<{ data: { code: string } }>(
      `/api/v1/admin/coupons/${couponId}`,
    );
    expect(body.data.code).not.toBe(couponCode);
    expect(body.data.code).toContain("•");
    expect(body.data.code.endsWith(couponCode.slice(-4))).toBe(true);
  });
});
