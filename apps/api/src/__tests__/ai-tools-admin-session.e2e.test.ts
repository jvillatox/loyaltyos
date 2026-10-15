import type { PrismaClient } from "@prisma/client";
import { buildTools } from "@loyaltyos/ai";
import { hashPassword } from "@loyaltyos/core";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { createInjectLoopbackFetch } from "../routes/admin/ai.js";

// Regression tests for the AI-companion breakage introduced by the
// admin-session guard (PR #42). The AI tools in packages/ai call /admin/*
// routes over a loopback fetch. Before the fix, that loopback authenticated
// with `LOYALTYOS_API_KEY` (an API key), which the guard now rejects (403) for
// every /admin route — even though the operator who triggered the tool has a
// valid admin session. The loopback must carry the operator's session cookie
// instead, so tools run with the identity of the admin who made the request.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = Date.now().toString();
const programAId = `prog_ai_${suffix}`;
const programBId = `prog_ai_b_${suffix}`;

let adminEmail: string;
let adminCookie: string;
let serverKeyValue: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.program.create({ data: { id: programAId, name: `AI Authz ${suffix}` } });
  await prisma.program.create({ data: { id: programBId, name: `AI Authz B ${suffix}` } });

  // A SERVER-scope internal key, mimicking LOYALTYOS_API_KEY. The guard rejects
  // it on /admin routes regardless of scope.
  const serverKey = await prisma.apiKey.create({
    data: {
      programId: programAId,
      key: `ai-server-${suffix}`,
      scope: "SERVER",
      name: "ai-internal",
    },
  });
  serverKeyValue = serverKey.key;

  const password = `pw-${suffix}`;
  adminEmail = `ai-admin-${suffix}@loyaltyos.dev`;
  await prisma.adminUser.create({
    data: {
      email: adminEmail,
      name: "AI Admin",
      passwordHash: await hashPassword(password),
      role: "SUPER_ADMIN",
      programId: programAId,
    },
  });

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/admin/login",
    payload: { email: adminEmail, password },
  });
  expect(login.statusCode).toBe(200);
  const sessionCookie = login.cookies.find((c) => c.name === "loyaltyos_admin_session");
  adminCookie = `${sessionCookie?.name}=${sessionCookie?.value}`;
});

afterAll(async () => {
  await prisma.campaign
    .deleteMany({ where: { programId: { in: [programAId, programBId] } } })
    .catch(() => {});
  await prisma.apiKey.deleteMany({ where: { programId: programAId } }).catch(() => {});
  const admin = await prisma.adminUser.findUnique({ where: { email: adminEmail } });
  if (admin) {
    await prisma.adminSession.deleteMany({ where: { userId: admin.id } }).catch(() => {});
    await prisma.adminUser.delete({ where: { id: admin.id } }).catch(() => {});
  }
  await prisma.program
    .deleteMany({ where: { id: { in: [programAId, programBId] } } })
    .catch(() => {});
  await app.close();
});

// Loopback that authenticates with an API key, replicating the pre-fix
// createLoopbackFetch in routes/admin/ai.ts.
function apiKeyLoopback(apiKey: string, programId: string): typeof globalThis.fetch {
  return async (url, init) => {
    const parsed = new URL(url);
    const res = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST",
      url: `${parsed.pathname}${parsed.search}`,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-Program-Id": programId,
        ...((init?.headers as Record<string, string>) ?? {}),
      },
      payload: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(res.body, { status: res.statusCode });
  };
}

describe("admin-session guard breaks the API-key loopback", () => {
  it("the API-key loopback returns 403 on /admin routes even with a valid admin session", async () => {
    const loopback = apiKeyLoopback(serverKeyValue, programAId);
    const res = await loopback("http://localhost/api/v1/admin/campaigns", { method: "GET" });
    expect(res.status).toBe(403);
  });

  it("create_campaign over the API-key loopback rejects despite a valid admin session", async () => {
    const tools = buildTools({
      fetch: apiKeyLoopback(serverKeyValue, programAId),
      baseUrl: "http://localhost/api/v1",
    });
    const createCampaign = tools.find((t) => t.name === "create_campaign")!;

    await expect(
      createCampaign.handler({ name: `should-fail-${suffix}`, type: "BONUS_POINTS" }),
    ).rejects.toThrow();
  });
});

describe("cookie loopback runs tools with the admin's session", () => {
  it("read tool returns 200 with the admin cookie", async () => {
    const loopback = createInjectLoopbackFetch(app, adminCookie);
    const res = await loopback("http://localhost/api/v1/admin/campaigns", { method: "GET" });
    expect(res.status).toBe(200);

    const tools = buildTools({ fetch: loopback, baseUrl: "http://localhost/api/v1" });
    const listCampaigns = tools.find((t) => t.name === "list_campaigns")!;
    await expect(listCampaigns.handler({})).resolves.toBeTypeOf("string");
  });

  it("create_campaign returns 201 and creates in the admin's program", async () => {
    const loopback = createInjectLoopbackFetch(app, adminCookie);

    const rawRes = await loopback("http://localhost/api/v1/admin/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: `ai-raw-${suffix}`, type: "BONUS_POINTS" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(rawRes.status).toBe(201);

    const tools = buildTools({ fetch: loopback, baseUrl: "http://localhost/api/v1" });
    const createCampaign = tools.find((t) => t.name === "create_campaign")!;
    const result = await createCampaign.handler({
      name: `ai-tool-${suffix}`,
      type: "BONUS_POINTS",
    });
    const created = JSON.parse(result) as { id: string; programId: string };
    expect(created.programId).toBe(programAId);

    const row = await prisma.campaign.findUnique({ where: { id: created.id } });
    expect(row).not.toBeNull();
    expect(row!.programId).toBe(programAId);
  });

  it("an admin of program A cannot create a campaign in program B", async () => {
    const tools = buildTools({
      fetch: createInjectLoopbackFetch(app, adminCookie),
      baseUrl: "http://localhost/api/v1",
    });
    const createCampaign = tools.find((t) => t.name === "create_campaign")!;

    const result = await createCampaign.handler({
      name: `ai-cross-${suffix}`,
      type: "BONUS_POINTS",
    });
    const created = JSON.parse(result) as { programId: string };
    expect(created.programId).toBe(programAId);
    expect(created.programId).not.toBe(programBId);
  });
});
