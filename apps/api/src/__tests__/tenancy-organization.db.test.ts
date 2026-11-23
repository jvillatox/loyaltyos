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
});
