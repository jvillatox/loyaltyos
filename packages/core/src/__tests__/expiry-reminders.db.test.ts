// Points-expiry reminder scheduling against a real PostgreSQL database (PR C).
// Runs only when TEST_DATABASE_URL is set (migrated LoyaltyOS schema).
import type { ExpiryMode } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { addMonths } from "../expiry.js";
import { PointsService } from "../service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI === "true" && !databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required in CI (database tests must not be skipped)");
}
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!databaseUrl)("PointsService expiry reminders (PostgreSQL)", () => {
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

  async function newMember(options: { expiryMode?: ExpiryMode; expiryMonths?: number } = {}) {
    const organizationId = await ensureOrg();
    const program = await prisma.program.create({
      data: {
        name: `reminder-${String(Date.now())}-${String(Math.random())}`,
        holdDays: 0,
        expiryMode: options.expiryMode ?? "NONE",
        expiryMonths: options.expiryMonths ?? 12,
        organizationId,
      },
    });
    const member = await prisma.member.create({
      data: { programId: program.id, organizationId },
    });
    return { programId: program.id, memberId: member.id };
  }

  const earn = (
    svc: PointsService,
    ids: { memberId: string; programId: string },
    amount: number,
    key: string,
  ) => svc.earn({ ...ids, amount, source: "test", idempotencyKey: key });

  async function accountOf(ids: { memberId: string; programId: string }) {
    return prisma.pointAccount.findFirstOrThrow({ where: ids });
  }

  it("PER_LOT: sends once per (member, expiry date), skipping on the second run", async () => {
    const ids = await newMember({ expiryMode: "PER_LOT", expiryMonths: 3 });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const account = await accountOf(ids);
    const lot = await prisma.pointLot.findFirstOrThrow({ where: { accountId: account.id } });
    await prisma.pointLot.update({
      where: { id: lot.id },
      data: { expiresAt: new Date(Date.now() + 15 * DAY_MS) },
    });

    const send = vi.fn(() => Promise.resolve());
    expect(await svc.remindUpcomingExpiries(ids.programId, new Date(), send)).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: ids.memberId, amount: 100, mode: "PER_LOT" }),
    );

    // A later run within the same window must not re-send.
    expect(await svc.remindUpcomingExpiries(ids.programId, new Date(), send)).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.pointExpiryReminder.count({ where: { programId: ids.programId } })).toBe(1);
  });

  it("PER_LOT: two concurrent runs send exactly one reminder", async () => {
    const ids = await newMember({ expiryMode: "PER_LOT", expiryMonths: 3 });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const account = await accountOf(ids);
    const lot = await prisma.pointLot.findFirstOrThrow({ where: { accountId: account.id } });
    await prisma.pointLot.update({
      where: { id: lot.id },
      data: { expiresAt: new Date(Date.now() + 15 * DAY_MS) },
    });

    const send = vi.fn(() => Promise.resolve());
    const [a, b] = await Promise.all([
      svc.remindUpcomingExpiries(ids.programId, new Date(), send),
      svc.remindUpcomingExpiries(ids.programId, new Date(), send),
    ]);

    expect(a + b).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.pointExpiryReminder.count({ where: { programId: ids.programId } })).toBe(1);
  });

  it("PER_LOT: groups lots sharing one expiry date into a single deadline", async () => {
    const ids = await newMember({ expiryMode: "PER_LOT", expiryMonths: 3 });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `a-${ids.memberId}`);
    await earn(svc, ids, 100, `b-${ids.memberId}`);

    const account = await accountOf(ids);
    const shared = new Date(Date.now() + 15 * DAY_MS);
    await prisma.pointLot.updateMany({
      where: { accountId: account.id },
      data: { expiresAt: shared },
    });

    const send = vi.fn(() => Promise.resolve());
    expect(await svc.remindUpcomingExpiries(ids.programId, new Date(), send)).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: ids.memberId, amount: 200, mode: "PER_LOT" }),
    );
  });

  it("INACTIVITY: reminds at 30 days from max(lastActivityAt, expiryChangedAt) + months", async () => {
    const ids = await newMember({ expiryMode: "INACTIVITY", expiryMonths: 12 });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const account = await accountOf(ids);
    await prisma.pointAccount.update({
      where: { id: account.id },
      data: { lastActivityAt: null },
    });

    const changedAt = new Date("2026-01-01T00:00:00.000Z");
    await prisma.program.update({
      where: { id: ids.programId },
      data: { expiryChangedAt: changedAt },
    });

    // The deadline is addMonths(changedAt, 12); ask from 15 days before it.
    const expiresOn = addMonths(changedAt, 12);
    const now = new Date(expiresOn.getTime() - 15 * DAY_MS);

    const send = vi.fn(() => Promise.resolve());
    expect(await svc.remindUpcomingExpiries(ids.programId, now, send)).toBe(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: ids.memberId,
        amount: 100,
        mode: "INACTIVITY",
        expiresOn,
      }),
    );

    // 45 days before the deadline the window has not opened yet.
    const earlier = new Date(expiresOn.getTime() - 45 * DAY_MS);
    expect(await svc.remindUpcomingExpiries(ids.programId, earlier, send)).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("INACTIVITY: an anchor pushed past the horizon is not reminded", async () => {
    const ids = await newMember({ expiryMode: "INACTIVITY", expiryMonths: 12 });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const account = await accountOf(ids);
    const changedAt = new Date("2026-01-01T00:00:00.000Z");
    await prisma.program.update({
      where: { id: ids.programId },
      data: { expiryChangedAt: changedAt },
    });

    // lastActivityAt later than changedAt pushes the deadline well past 30 days.
    await prisma.pointAccount.update({
      where: { id: account.id },
      data: { lastActivityAt: new Date(changedAt.getTime() + 30 * DAY_MS) },
    });

    const send = vi.fn(() => Promise.resolve());
    const now = new Date(addMonths(changedAt, 12).getTime() - 15 * DAY_MS);
    expect(await svc.remindUpcomingExpiries(ids.programId, now, send)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("NONE: never produces a reminder", async () => {
    const ids = await newMember({ expiryMode: "NONE" });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const send = vi.fn(() => Promise.resolve());
    expect(await svc.remindUpcomingExpiries(ids.programId, new Date(), send)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
