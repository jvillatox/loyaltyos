// Tenancy expand-phase behaviour against a real PostgreSQL database
// (docs/design/tenancy.md §4 step 2). Runs only when TEST_DATABASE_URL is set
// (migrated LoyaltyOS schema), like the DDL-level core tests. Proves three
// invariants of this PR's organizationId columns:
//
//  1. backfillOrganizationColumns fills organizationId on Program and every
//     programId child from the default Organization, and is idempotent.
//  2. The composite FK (programId, organizationId) → Program(id, organizationId)
//     rejects a child whose organizationId diverges from its program's.
//  3. moveProgram rewrites Program and all its children to another Organization
//     in one transaction, relying on the DEFERRABLE INITIALLY DEFERRED composite
//     FKs so the intermediate state never trips a constraint.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { backfillOrganizationColumns } from "../lib/tenancy-org.js";
import { moveProgram } from "../lib/tenancy-move-program.js";
import { DEFAULT_ORG_ID } from "../lib/tenancy-users.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("tenancy organizationId columns (PostgreSQL)", () => {
  let prisma: PrismaClient;
  const suffix = Date.now().toString();

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createOrg(id: string): Promise<void> {
    await prisma.organization.upsert({
      where: { id },
      update: {},
      create: { id, name: `Org ${id}` },
    });
  }

  it("backfill fills organizationId on Program and children, idempotently", async () => {
    const programId = `prog_bf_${suffix}`;

    // Expand-phase state: every row created with a NULL organizationId.
    await prisma.program.create({ data: { id: programId, name: `Backfill ${suffix}` } });
    const member = await prisma.member.create({ data: { programId } });
    await prisma.pointAccount.create({ data: { memberId: member.id, programId, balance: 0 } });
    const tier = await prisma.tier.create({ data: { programId, name: "Silver", rank: 1 } });
    await prisma.memberTier.create({ data: { memberId: member.id, tierId: tier.id } });

    const first = await backfillOrganizationColumns(prisma);
    expect(first.organizationId).toBe(DEFAULT_ORG_ID);

    const program = await prisma.program.findUniqueOrThrow({ where: { id: programId } });
    expect(program.organizationId).toBe(DEFAULT_ORG_ID);
    expect(
      (await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).organizationId,
    ).toBe(DEFAULT_ORG_ID);
    expect(
      (await prisma.pointAccount.findUniqueOrThrow({ where: { memberId: member.id } }))
        .organizationId,
    ).toBe(DEFAULT_ORG_ID);
    expect((await prisma.tier.findUniqueOrThrow({ where: { id: tier.id } })).organizationId).toBe(
      DEFAULT_ORG_ID,
    );
    expect(
      (await prisma.memberTier.findFirstOrThrow({ where: { memberId: member.id } })).organizationId,
    ).toBe(DEFAULT_ORG_ID);

    // Re-running is a no-op for Program (no NULL-organizationId rows remain).
    const second = await backfillOrganizationColumns(prisma);
    expect(second.programCount).toBe(0);
    expect(
      (await prisma.program.findUniqueOrThrow({ where: { id: programId } })).organizationId,
    ).toBe(DEFAULT_ORG_ID);
  });

  it("composite FK rejects a child whose organizationId diverges from its program", async () => {
    const orgA = `org_fk_a_${suffix}`;
    const orgB = `org_fk_b_${suffix}`;
    await createOrg(orgA);
    await createOrg(orgB);

    const program = await prisma.program.create({
      data: { id: `prog_fk_${suffix}`, name: `FK ${suffix}`, organizationId: orgA },
    });

    await expect(
      prisma.member.create({ data: { programId: program.id, organizationId: orgB } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("moveProgram moves Program and every child to the target Organization", async () => {
    const orgA = `org_mv_a_${suffix}`;
    const orgB = `org_mv_b_${suffix}`;
    await createOrg(orgA);
    await createOrg(orgB);

    const programId = `prog_mv_${suffix}`;
    await prisma.program.create({
      data: { id: programId, name: `Move ${suffix}`, organizationId: orgA },
    });
    const member = await prisma.member.create({
      data: { programId, organizationId: orgA },
    });
    await prisma.pointAccount.create({
      data: { memberId: member.id, programId, balance: 0, organizationId: orgA },
    });
    const tier = await prisma.tier.create({
      data: { programId, name: "Gold", rank: 1, organizationId: orgA },
    });
    await prisma.memberTier.create({
      data: { memberId: member.id, tierId: tier.id, organizationId: orgA },
    });

    const result = await moveProgram(prisma, programId, orgB);
    expect(result.organizationId).toBe(orgB);

    expect(
      (await prisma.program.findUniqueOrThrow({ where: { id: programId } })).organizationId,
    ).toBe(orgB);
    expect(
      (await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).organizationId,
    ).toBe(orgB);
    expect(
      (await prisma.pointAccount.findUniqueOrThrow({ where: { memberId: member.id } }))
        .organizationId,
    ).toBe(orgB);
    expect((await prisma.tier.findUniqueOrThrow({ where: { id: tier.id } })).organizationId).toBe(
      orgB,
    );
    expect(
      (await prisma.memberTier.findFirstOrThrow({ where: { memberId: member.id } })).organizationId,
    ).toBe(orgB);
  });

  it("rejects cross-org member/account/coupon/reward references", async () => {
    const orgA = `org_xref_a_${suffix}`;
    const orgB = `org_xref_b_${suffix}`;
    await createOrg(orgA);
    await createOrg(orgB);

    const progA = await prisma.program.create({
      data: { id: `prog_xref_a_${suffix}`, name: `XRef A ${suffix}`, organizationId: orgA },
    });
    const progB = await prisma.program.create({
      data: { id: `prog_xref_b_${suffix}`, name: `XRef B ${suffix}`, organizationId: orgB },
    });

    const memberB = await prisma.member.create({
      data: { programId: progB.id, organizationId: orgB },
    });
    const accountMemberB = await prisma.member.create({
      data: { programId: progB.id, organizationId: orgB },
    });
    const accountB = await prisma.pointAccount.create({
      data: { memberId: accountMemberB.id, programId: progB.id, balance: 0, organizationId: orgB },
    });
    const couponA = await prisma.coupon.create({
      data: {
        programId: progA.id,
        organizationId: orgA,
        code: `XREF_${suffix}`,
        mode: "SHARED",
        discountType: "PERCENTAGE",
      },
    });
    const rewardA = await prisma.reward.create({
      data: { programId: progA.id, organizationId: orgA, name: `Reward ${suffix}`, pointsCost: 50 },
    });

    // memberId → Member
    await expect(
      prisma.pointAccount.create({
        data: { memberId: memberB.id, programId: progA.id, balance: 0, organizationId: orgA },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    // accountId → PointAccount
    await expect(
      prisma.pointTransaction.create({
        data: {
          accountId: accountB.id,
          programId: progA.id,
          type: "EARN",
          amount: 10,
          balanceAfter: 10,
          source: "test",
          idempotencyKey: `xref_tx_${suffix}`,
          organizationId: orgA,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    // CouponRedemption.memberId → Member (coupon in org A, member in org B)
    await expect(
      prisma.couponRedemption.create({
        data: { couponId: couponA.id, memberId: memberB.id, organizationId: orgA },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    // RewardRedemption.memberId → Member (reward in org A, member in org B)
    await expect(
      prisma.rewardRedemption.create({
        data: { rewardId: rewardA.id, memberId: memberB.id, pointsSpent: 50, organizationId: orgA },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("deleting a member with events nulls memberId but keeps organizationId", async () => {
    const orgA = `org_sn_member_${suffix}`;
    await createOrg(orgA);
    const programId = `prog_sn_member_${suffix}`;
    await prisma.program.create({
      data: { id: programId, name: `SN Member ${suffix}`, organizationId: orgA },
    });
    const member = await prisma.member.create({ data: { programId, organizationId: orgA } });
    const event = await prisma.event.create({
      data: {
        programId,
        organizationId: orgA,
        memberId: member.id,
        type: "purchase",
        idempotencyKey: `evt_sn_${suffix}`,
      },
    });

    await prisma.member.delete({ where: { id: member.id } });

    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.memberId).toBeNull();
    expect(after.organizationId).toBe(orgA);
  });

  it("deleting a template nulls notification.templateId but keeps organizationId", async () => {
    const orgA = `org_sn_tpl_${suffix}`;
    await createOrg(orgA);
    const programId = `prog_sn_tpl_${suffix}`;
    await prisma.program.create({
      data: { id: programId, name: `SN Tpl ${suffix}`, organizationId: orgA },
    });
    const member = await prisma.member.create({ data: { programId, organizationId: orgA } });
    const template = await prisma.notificationTemplate.create({
      data: { programId, organizationId: orgA, name: `Tpl ${suffix}`, channel: "EMAIL" },
    });
    const notification = await prisma.notification.create({
      data: {
        templateId: template.id,
        memberId: member.id,
        organizationId: orgA,
        channel: "EMAIL",
      },
    });

    await prisma.notificationTemplate.delete({ where: { id: template.id } });

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(after.templateId).toBeNull();
    expect(after.organizationId).toBe(orgA);
  });
});
