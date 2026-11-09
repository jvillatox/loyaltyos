import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { coalitionService } from "../lib/coalition-setup.js";

// M0 point 5 — coalition accumulate/redeem/convert must not auto-retry on a
// timeout / 5xx. A transient failure should surface immediately and leave the
// transaction pending-reconcile, not fire the adapter three times. Today
// `callWithRetry` retries (attempts: 3), so a simulated timeout triggers three
// adapter calls.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = randomUUID().slice(0, 8);
const programId = `prog_m0c_${suffix}`;

let memberId = "";
let adapterCalls = 0;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.program.create({ data: { id: programId, name: `M0C ${suffix}` } });

  const member = await prisma.member.create({
    data: { email: `m0c-member-${suffix}@loyaltyos.dev`, programId },
  });
  memberId = member.id;

  coalitionService.registerAdapter({
    name: "TIMEOUT_PROVIDER",
    timeoutMs: 10000,
    capabilities: {
      accumulate: true,
      redeem: true,
      convert: true,
      reverseTransaction: false,
      historyQuery: false,
    },
    healthcheck: async () => ({ ok: true }),
    getBalance: async () => 0,
    accumulate: async () => {
      adapterCalls += 1;
      throw new Error("ETIMEDOUT: connection timed out");
    },
  });

  await prisma.coalitionConfig.create({
    data: {
      programId,
      provider: "TIMEOUT_PROVIDER",
      endpoint: "https://example.invalid",
      encryptedCredentials: "x",
      accumulationEnabled: true,
    },
  });
});

afterAll(async () => {
  await prisma.coalitionTransaction
    .deleteMany({ where: { account: { programId } } })
    .catch(() => {});
  await prisma.coalitionAccount.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.coalitionConfig.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.member.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.program.delete({ where: { id: programId } }).catch(() => {});
  await app.close();
});

describe("M0 coalition — no auto-retry on transient failure", () => {
  it("a simulated timeout calls the adapter exactly once", async () => {
    await expect(
      coalitionService.accumulate({
        programId,
        memberId,
        externalMemberRef: "ext-1",
        points: 10,
        txRef: `tx-retry-${suffix}`,
      }),
    ).rejects.toThrow();

    expect(adapterCalls).toBe(1);
  });
});
