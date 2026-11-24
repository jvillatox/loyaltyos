// Program-level point hold (issue #34) against a real PostgreSQL database.
// Runs only when TEST_DATABASE_URL is set (migrated LoyaltyOS schema).
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PointsService } from "../service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!databaseUrl)("PointsService hold days (PostgreSQL)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function ensureOrg(): Promise<string> {
    await prisma.organization.upsert({
      where: { id: "org_default" },
      update: {},
      create: { id: "org_default", name: "Default" },
    });
    return "org_default";
  }

  async function newProgram(holdDays: number) {
    const organizationId = await ensureOrg();
    return prisma.program.create({
      data: {
        name: `hold-${String(Date.now())}-${String(Math.random())}`,
        holdDays,
        organizationId,
      },
    });
  }

  async function newMember(holdDays: number) {
    const program = await newProgram(holdDays);
    const member = await prisma.member.create({
      data: { programId: program.id, organizationId: program.organizationId },
    });
    return { programId: program.id, memberId: member.id };
  }

  it("sends points to pending for a held program and immediate for holdDays=0", async () => {
    const held = await newMember(10);
    const immediate = await newMember(0);
    const svc = new PointsService(prisma);

    await svc.earn({
      ...held,
      amount: 100,
      source: "test",
      idempotencyKey: `held-${held.memberId}`,
    });
    await svc.earn({
      ...immediate,
      amount: 100,
      source: "test",
      idempotencyKey: `immediate-${immediate.memberId}`,
    });

    const heldBalance = await svc.balance(held.memberId, held.programId);
    expect(heldBalance.confirmed).toBe(0);
    expect(heldBalance.pendingBalance).toBe(100);
    expect(heldBalance.nextAvailableAt).toBeInstanceOf(Date);

    const immediateBalance = await svc.balance(immediate.memberId, immediate.programId);
    expect(immediateBalance.confirmed).toBe(100);
    expect(immediateBalance.pendingBalance).toBe(0);
    expect(immediateBalance.nextAvailableAt).toBeNull();
  });

  it("settles only the due program when the clock advances past its hold", async () => {
    const short = await newMember(1);
    const long = await newMember(5);
    const svc = new PointsService(prisma);

    await svc.earn({
      ...short,
      amount: 100,
      source: "test",
      idempotencyKey: `short-${short.memberId}`,
    });
    await svc.earn({
      ...long,
      amount: 100,
      source: "test",
      idempotencyKey: `long-${long.memberId}`,
    });

    const twoDaysLater = new Date(Date.now() + 2 * DAY_MS);
    expect(await svc.settlePending(short.programId, twoDaysLater)).toBe(1);
    expect(await svc.settlePending(long.programId, twoDaysLater)).toBe(0);

    expect((await svc.balance(short.memberId, short.programId)).confirmed).toBe(100);
    expect((await svc.balance(long.memberId, long.programId)).pendingBalance).toBe(100);
  });

  it("does not duplicate settlement when the job runs twice in parallel", async () => {
    const ids = await newMember(1);
    const svc = new PointsService(prisma);
    await svc.earn({ ...ids, amount: 100, source: "test", idempotencyKey: `seed-${ids.memberId}` });

    const twoDaysLater = new Date(Date.now() + 2 * DAY_MS);
    const [a, b] = await Promise.all([
      svc.settlePending(ids.programId, twoDaysLater),
      svc.settlePending(ids.programId, twoDaysLater),
    ]);

    expect(a + b).toBe(1);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(100);
    expect((await svc.balance(ids.memberId, ids.programId)).pendingBalance).toBe(0);
  });

  it("keeps already-earned points frozen when the program holdDays changes", async () => {
    const ids = await newMember(10);
    const svc = new PointsService(prisma);
    await svc.earn({ ...ids, amount: 100, source: "test", idempotencyKey: `seed-${ids.memberId}` });

    const originalBalance = await svc.balance(ids.memberId, ids.programId);
    expect(originalBalance.pendingBalance).toBe(100);
    const originalRelease = originalBalance.nextAvailableAt?.getTime();

    // Lower the program's hold to 0 after the earn.
    await prisma.program.update({ where: { id: ids.programId }, data: { holdDays: 0 } });

    // The already-earned points still respect their frozen release time.
    await svc.settlePending(ids.programId, new Date());
    expect((await svc.balance(ids.memberId, ids.programId)).pendingBalance).toBe(100);
    expect((await svc.balance(ids.memberId, ids.programId)).nextAvailableAt?.getTime()).toBe(
      originalRelease,
    );

    // A new earn is immediate under the new holdDays=0.
    await svc.earn({ ...ids, amount: 50, source: "test", idempotencyKey: `later-${ids.memberId}` });
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(50);
    expect((await svc.balance(ids.memberId, ids.programId)).pendingBalance).toBe(100);
  });

  it("settles frozen points when the clock passes the frozen release time", async () => {
    const ids = await newMember(2);
    const svc = new PointsService(prisma);
    await svc.earn({ ...ids, amount: 100, source: "test", idempotencyKey: `seed-${ids.memberId}` });

    const threeDaysLater = new Date(Date.now() + 3 * DAY_MS);
    expect(await svc.settlePending(ids.programId, threeDaysLater)).toBe(1);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(100);
  });
});
