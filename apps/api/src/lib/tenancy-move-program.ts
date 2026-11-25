import { invalidateOrganizationCache } from "@loyaltyos/tenancy";
import { Prisma, PrismaClient } from "@prisma/client";

import { PARENT_CHILD_TABLES, PROGRAM_TABLES } from "./tenancy-org.js";

// Moves a Program — and every row that carries its `organizationId` — to a different
// Organization in a single transaction (docs/design/tenancy.md §4 step 2). The
// composite FKs are DEFERRABLE INITIALLY DEFERRED precisely so this rewrite of
// Program and all its children does not transiently violate them: the FK checks are
// all deferred to COMMIT, by which point every table points at the target org.

const ident = (name: string): Prisma.Sql => Prisma.raw(`"${name}"`);

export interface MoveProgramResult {
  programId: string;
  organizationId: string;
  counts: Record<string, number>;
}

export async function moveProgram(
  db: PrismaClient,
  programId: string,
  targetOrganizationId: string,
): Promise<MoveProgramResult> {
  const result = await db.$transaction(async (tx) => {
    const [program, target] = await Promise.all([
      tx.program.findUnique({
        where: { id: programId },
        select: { id: true, organizationId: true },
      }),
      tx.organization.findUnique({
        where: { id: targetOrganizationId },
        select: { id: true },
      }),
    ]);

    if (!program) {
      throw new Error(`Cannot move program: Program "${programId}" not found.`);
    }
    if (!target) {
      throw new Error(`Cannot move program: Organization "${targetOrganizationId}" not found.`);
    }

    const counts: Record<string, number> = {};

    // programId tables first, then the child tables that derive from them, then
    // Program itself. Order does not affect FK enforcement (deferred), but it keeps
    // each child table's parent consistent before the child reads it.
    for (const table of PROGRAM_TABLES) {
      counts[table] = await tx.$executeRaw`
        UPDATE ${ident(table)} SET "organizationId" = ${targetOrganizationId}
        WHERE "programId" = ${programId}
      `;
    }
    for (const { table, parentColumn, parentTable } of PARENT_CHILD_TABLES) {
      counts[table] = await tx.$executeRaw`
        UPDATE ${ident(table)} SET "organizationId" = ${targetOrganizationId}
        WHERE ${ident(parentColumn)} IN (
          SELECT "id" FROM ${ident(parentTable)} WHERE "programId" = ${programId}
        )
      `;
    }
    counts.Program = await tx.$executeRaw`
      UPDATE "Program" SET "organizationId" = ${targetOrganizationId}
      WHERE "id" = ${programId}
    `;

    return { programId, organizationId: targetOrganizationId, counts };
  });

  // The program → org mapping changed, so evict the in-memory resolver cache
  // (packages/tenancy). The CLI runs in its own process, so this clears only the
  // in-process cache; the short TTL bounds the API process's staleness.
  invalidateOrganizationCache(programId);

  return result;
}
