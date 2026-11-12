import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { hashToken } from "../lib/personal-access-token.js";
import { cleanupExpiredMemberTokens } from "../workers/member-session-tokens.js";

// Member session tokens (issue #58). A SERVER-key holder mints a short-lived,
// read-only `lomem_…` bearer token for a member; the widget uses it to call the
// API on the member's behalf without the merchant ever shipping the SERVER key
// to the browser.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = randomUUID().slice(0, 8);
const programId = `prog_mst_${suffix}`;
const otherProgramId = `prog_mst_other_${suffix}`;
const serverKey = `sk_mst_${suffix}`;
const clientKey = `ck_mst_${suffix}`;

let memberId: string;
let otherMemberId: string;

function serverHeaders(program = programId): Record<string, string> {
  return { "x-api-key": serverKey, "x-program-id": program };
}

function clientHeaders(): Record<string, string> {
  return { "x-api-key": clientKey, "x-program-id": programId };
}

async function issueToken(id = memberId): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/members/${id}/session-token`,
    headers: serverHeaders(),
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { data: { token: string } }).data.token;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.program.create({ data: { id: programId, name: `MST ${suffix}` } });
  await prisma.program.create({ data: { id: otherProgramId, name: `MST Other ${suffix}` } });
  await prisma.apiKey.create({ data: { programId, key: serverKey, scope: "SERVER" } });
  await prisma.apiKey.create({ data: { programId, key: clientKey, scope: "CLIENT" } });

  const member = await prisma.member.create({
    data: { email: `mst-${suffix}@loyaltyos.dev`, programId },
  });
  memberId = member.id;
  const other = await prisma.member.create({
    data: { email: `mst-other-${suffix}@loyaltyos.dev`, programId: otherProgramId },
  });
  otherMemberId = other.id;
});

afterAll(async () => {
  await prisma.memberSessionToken
    .deleteMany({ where: { programId: { in: [programId, otherProgramId] } } })
    .catch(() => {});
  await prisma.auditLog
    .deleteMany({ where: { programId: { in: [programId, otherProgramId] } } })
    .catch(() => {});
  await prisma.member
    .deleteMany({ where: { id: { in: [memberId, otherMemberId] } } })
    .catch(() => {});
  await prisma.apiKey
    .deleteMany({ where: { programId: { in: [programId, otherProgramId] } } })
    .catch(() => {});
  await prisma.program
    .deleteMany({ where: { id: { in: [programId, otherProgramId] } } })
    .catch(() => {});
  await app.close();
});

describe("issuance", () => {
  it("issues a lomem_ token via a SERVER key", async () => {
    const token = await issueToken();
    expect(token.startsWith("lomem_")).toBe(true);
    expect(token.length).toBeGreaterThan("lomem_".length + 16);
  });

  it("returns expiresAt and memberId alongside the token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/session-token`,
      headers: serverHeaders(),
    });
    const { data } = res.json() as { data: { token: string; expiresAt: string; memberId: string } };
    expect(data.memberId).toBe(memberId);
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(data.token.startsWith("lomem_")).toBe(true);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("rejects a CLIENT key with 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/session-token`,
      headers: clientHeaders(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a missing credential with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/session-token`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for a member in another program", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${otherMemberId}/session-token`,
      headers: serverHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects ttlSeconds above the 3600 cap", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/session-token`,
      headers: serverHeaders(),
      payload: { ttlSeconds: 3601 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("authentication", () => {
  it("allows a valid token to read its own member (GET 200)", async () => {
    const token = await issueToken();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects an expired token with 401", async () => {
    const token = await issueToken();
    await prisma.memberSessionToken.update({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a revoked token with 401", async () => {
    const token = await issueToken();
    await prisma.memberSessionToken.update({
      where: { tokenHash: hashToken(token) },
      data: { revokedAt: new Date() },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a cross-tenant X-Program-Id with 403", async () => {
    const token = await issueToken();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members/me",
      headers: { authorization: `Bearer ${token}`, "x-program-id": otherProgramId },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("read-only enforcement", () => {
  it("allows GET but denies a mutation (POST redeem → 403)", async () => {
    const token = await issueToken();
    const read = await app.inject({
      method: "GET",
      url: "/api/v1/members/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: "POST",
      url: "/api/v1/rewards/does-not-matter/redeem",
      headers: { authorization: `Bearer ${token}` },
      payload: { rewardId: "x", memberId, idempotencyKey: `mst-${suffix}` },
    });
    expect(write.statusCode).toBe(403);
  });
});

describe("widget calls", () => {
  it("serves all four widget endpoints with a member token", async () => {
    const token = await issueToken();
    const auth = { authorization: `Bearer ${token}` };

    const balance = await app.inject({
      method: "GET",
      url: "/api/v1/members/me/balance",
      headers: auth,
    });
    const badges = await app.inject({
      method: "GET",
      url: "/api/v1/members/me/badges",
      headers: auth,
    });
    const tier = await app.inject({ method: "GET", url: "/api/v1/members/me/tier", headers: auth });
    const rewards = await app.inject({
      method: "GET",
      url: "/api/v1/rewards?isActive=true&pageSize=3&page=1",
      headers: auth,
    });

    expect(balance.statusCode).toBe(200);
    expect(badges.statusCode).toBe(200);
    expect(tier.statusCode).toBe(200);
    expect(rewards.statusCode).toBe(200);
  });
});

describe("revocation", () => {
  it("DELETE /session-tokens revokes all active tokens for the member", async () => {
    const token = await issueToken();
    const before = await app.inject({
      method: "GET",
      url: "/api/v1/members/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/members/${memberId}/session-tokens`,
      headers: serverHeaders(),
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/members/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe("cleanup", () => {
  it("deletes tokens dead for >24h and keeps fresh ones", async () => {
    const expiredHash = `expired-${suffix}`;
    const revokedHash = `revoked-${suffix}`;
    const freshHash = `fresh-${suffix}`;

    await prisma.memberSessionToken.create({
      data: {
        memberId,
        programId,
        tokenHash: expiredHash,
        readOnly: true,
        expiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });
    await prisma.memberSessionToken.create({
      data: {
        memberId,
        programId,
        tokenHash: revokedHash,
        readOnly: true,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        revokedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });
    await prisma.memberSessionToken.create({
      data: {
        memberId,
        programId,
        tokenHash: freshHash,
        readOnly: true,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await cleanupExpiredMemberTokens();

    expect(
      await prisma.memberSessionToken.findUnique({ where: { tokenHash: expiredHash } }),
    ).toBeNull();
    expect(
      await prisma.memberSessionToken.findUnique({ where: { tokenHash: revokedHash } }),
    ).toBeNull();
    expect(
      await prisma.memberSessionToken.findUnique({ where: { tokenHash: freshHash } }),
    ).not.toBeNull();
  });
});
