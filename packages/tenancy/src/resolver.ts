// Resolves a program's organization before tenant context exists
// (docs/design/tenancy.md §2.5). The primary path is the SECURITY DEFINER function
// `app_org_for_program`, which runs as its owner (BYPASSRLS) and can read Program
// with no context, returning only the organizationId. When the function has not
// been provisioned (TENANCY_RLS=off, the default), it falls back to a direct
// Program read.
export interface ProgramOrgResolver {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
  program: {
    findUnique: (args: {
      where: { id: string };
      select: { organizationId: true };
    }) => Promise<{ organizationId: string | null } | null>;
  };
}

export async function resolveOrganizationId(
  db: ProgramOrgResolver,
  programId: string,
): Promise<string> {
  try {
    const rows = await db.$queryRawUnsafe<{ organizationId: string | null }[]>(
      `SELECT public.app_org_for_program($1) AS "organizationId"`,
      programId,
    );
    const viaFunction = rows[0]?.organizationId;
    if (viaFunction) return viaFunction;
  } catch {
    // `app_org_for_program` is not provisioned — fall through to the direct read,
    // which is valid while RLS is off (Program is not yet locked down).
  }

  const program = await db.program.findUnique({
    where: { id: programId },
    select: { organizationId: true },
  });
  if (!program?.organizationId) {
    throw new Error(`Program "${programId}" has no organizationId (run tenancy:backfill first)`);
  }
  return program.organizationId;
}

// Program → org rarely changes, so a short in-memory cache absorbs the round-trip
// on hot pre-context paths (magic link, widget). `invalidateOrganizationCache` is
// called by tenancy:move-program when a program changes org; the TTL is the
// backstop for a move done by the CLI in a separate process (which cannot reach
// this process's cache), and bounds any staleness in a multi-instance deployment.
export const ORG_CACHE_TTL_MS = 30_000;

interface CachedOrganizationId {
  organizationId: string;
  expiresAt: number;
}

const organizationIdCache = new Map<string, CachedOrganizationId>();

export function invalidateOrganizationCache(programId?: string): void {
  if (programId === undefined) {
    organizationIdCache.clear();
    return;
  }
  organizationIdCache.delete(programId);
}

export async function resolveOrganizationIdCached(
  db: ProgramOrgResolver,
  programId: string,
  ttlMs: number = ORG_CACHE_TTL_MS,
): Promise<string> {
  const now = Date.now();
  const cached = organizationIdCache.get(programId);
  if (cached && cached.expiresAt > now) {
    return cached.organizationId;
  }

  const organizationId = await resolveOrganizationId(db, programId);
  organizationIdCache.set(programId, { organizationId, expiresAt: now + ttlMs });
  return organizationId;
}
