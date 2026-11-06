import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

// M0 point 4 — tenant-scoped idempotency. The same idempotency key / txRef used
// in two different programs must produce two independent records, never return
// the other program's data. Today the keys are globally unique, so the second
// program's call resolves (and leaks) the first program's record.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = randomUUID().slice(0, 8);
const progA = `progA_m0id_${suffix}`;
const progB = `progB_m0id_${suffix}`;
const aKey = `ak_${suffix}`;
const bKey = `bk_${suffix}`;

let aMemberId = "";
let bMemberId = "";

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.program.create({ data: { id: progA, name: `M0ID A ${suffix}` } });
  await prisma.program.create({ data: { id: progB, name: `M0ID B ${suffix}` } });

  await prisma.apiKey.create({ data: { programId: progA, key: aKey, scope: "SERVER" } });
  await prisma.apiKey.create({ data: { programId: progB, key: bKey, scope: "SERVER" } });

  const ma = await prisma.member.create({
    data: { email: `m0id-a-${suffix}@loyaltyos.dev`, programId: progA },
  });
  aMemberId = ma.id;
  const mb = await prisma.member.create({
    data: { email: `m0id-b-${suffix}@loyaltyos.dev`, programId: progB },
  });
  bMemberId = mb.id;

  // Coalition configs so accumulate reaches the idempotency check (and creates
  // the local transaction) before failing on the missing adapter.
  await prisma.coalitionConfig.create({
    data: {
      programId: progA,
      provider: "GENERIC",
      endpoint: "https://example.com",
      encryptedCredentials: "x",
      accumulationEnabled: true,
    },
  });
  await prisma.coalitionConfig.create({
    data: {
      programId: progB,
      provider: "GENERIC",
      endpoint: "https://example.com",
      encryptedCredentials: "x",
      accumulationEnabled: true,
    },
  });
});

afterAll(async () => {
  await prisma.coalitionTransaction
    .deleteMany({ where: { account: { programId: { in: [progA, progB] } } } })
    .catch(() => {});
  await prisma.coalitionAccount
    .deleteMany({ where: { programId: { in: [progA, progB] } } })
    .catch(() => {});
  await prisma.coalitionConfig
    .deleteMany({ where: { programId: { in: [progA, progB] } } })
    .catch(() => {});
  await prisma.pointTransaction
    .deleteMany({ where: { account: { memberId: { in: [aMemberId, bMemberId] } } } })
    .catch(() => {});
  await prisma.pointAccount
    .deleteMany({ where: { memberId: { in: [aMemberId, bMemberId] } } })
    .catch(() => {});
  await prisma.event.deleteMany({ where: { programId: { in: [progA, progB] } } }).catch(() => {});
  await prisma.member.deleteMany({ where: { programId: { in: [progA, progB] } } }).catch(() => {});
  await prisma.apiKey.deleteMany({ where: { programId: { in: [progA, progB] } } }).catch(() => {});
  await prisma.program.deleteMany({ where: { id: { in: [progA, progB] } } }).catch(() => {});
  await app.close();
});

const aHeaders = { "x-api-key": aKey, "x-program-id": progA };
const bHeaders = { "x-api-key": bKey, "x-program-id": progB };

describe("M0 idempotency — keys are scoped per program", () => {
  it("events: same key in A and B → two independent events", async () => {
    const key = `evt-${suffix}`;
    const resA = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...aHeaders, "idempotency-key": key },
      payload: { type: "page_view" },
    });
    const resB = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...bHeaders, "idempotency-key": key },
      payload: { type: "page_view" },
    });

    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);

    const idA = (resA.json() as { data: { id: string } }).data.id;
    const idB = (resB.json() as { data: { id: string } }).data.id;
    expect(idB).not.toBe(idA);

    const count = await prisma.event.count({ where: { idempotencyKey: key } });
    expect(count).toBe(2);
  });

  it("points: same key in A and B → two independent transactions", async () => {
    const key = `adj-${suffix}`;
    await app.inject({
      method: "POST",
      url: `/api/v1/members/${aMemberId}/adjust`,
      headers: { ...aHeaders, "idempotency-key": key },
      payload: { amount: 5, reason: "test" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/members/${bMemberId}/adjust`,
      headers: { ...bHeaders, "idempotency-key": key },
      payload: { amount: 5, reason: "test" },
    });

    const count = await prisma.pointTransaction.count({ where: { idempotencyKey: key } });
    expect(count).toBe(2);
  });

  it("coalition: same txRef in A and B → two independent transactions", async () => {
    const txRef = `coal-${suffix}`;
    await app.inject({
      method: "POST",
      url: "/api/v1/coalition/accumulate",
      headers: { ...aHeaders, "idempotency-key": `ik-a-${suffix}` },
      payload: { memberId: aMemberId, externalMemberRef: "ext-a", points: 10, txRef },
    });
    const resB = await app.inject({
      method: "POST",
      url: "/api/v1/coalition/accumulate",
      headers: { ...bHeaders, "idempotency-key": `ik-b-${suffix}` },
      payload: { memberId: bMemberId, externalMemberRef: "ext-b", points: 10, txRef },
    });

    // B must not be served A's transaction as idempotent.
    const bData = resB.json() as { data?: { idempotent?: boolean } };
    expect(bData.data?.idempotent).not.toBe(true);

    const count = await prisma.coalitionTransaction.count({ where: { localTxRef: txRef } });
    expect(count).toBe(2);
  });
});
