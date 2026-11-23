// Tenancy write-path helper (docs/design/tenancy.md §4). During the expand phase
// `organizationId` is nullable, but every §3.1 write must populate it so new rows
// are consistent before the contract phase sets NOT NULL. `organizationId` is fully
// determined by `programId` (via the composite FK `(programId, organizationId) →
// Program`), so this resolves it from the program. Fails loudly if the program has
// no organizationId yet (backfill must run first).

export interface ProgramOrgReader {
  program: {
    findUnique(args: {
      where: { id: string };
      select: { organizationId: true };
    }): Promise<{ organizationId: string | null } | null>;
  };
}

export async function deriveOrganizationId(
  db: ProgramOrgReader,
  programId: string,
): Promise<string> {
  const program = await db.program.findUnique({
    where: { id: programId },
    select: { organizationId: true },
  });
  return requireOrganizationId(program, `Program "${programId}"`);
}

// Extracts `organizationId` from an already-read parent row, failing loudly when it
// is still NULL. Used by the §3.1 child tables that have no `programId` (e.g.
// MemberTier → Member, GiftCard → GiftCardBatch): the caller reads the parent with
// `select: { organizationId: true }` and passes the row here.
export function requireOrganizationId(
  row: { organizationId: string | null } | null,
  label: string,
): string {
  if (!row?.organizationId) {
    throw new Error(`${label} has no organizationId (run tenancy:backfill first)`);
  }
  return row.organizationId;
}
