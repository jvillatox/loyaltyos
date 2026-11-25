import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProgramOrgResolver } from "../resolver.js";
import {
  invalidateOrganizationCache,
  resolveOrganizationId,
  resolveOrganizationIdCached,
} from "../resolver.js";

function mockDb(organizationId = "org_1"): ProgramOrgResolver {
  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ organizationId }]),
    program: {
      findUnique: vi.fn().mockResolvedValue({ organizationId }),
    },
  };
}

afterEach(() => {
  invalidateOrganizationCache();
});

describe("resolveOrganizationIdCached", () => {
  it("serves repeated lookups from the in-memory cache (no extra round-trip)", async () => {
    const db = mockDb("org_1");

    await expect(resolveOrganizationIdCached(db, "prog_1")).resolves.toBe("org_1");
    await expect(resolveOrganizationIdCached(db, "prog_1")).resolves.toBe("org_1");

    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(db.program.findUnique).not.toHaveBeenCalled();
  });

  it("re-queries after the TTL expires", async () => {
    const db = mockDb("org_1");

    // ttlMs = 0 → expiresAt is now, so the entry is always stale.
    await resolveOrganizationIdCached(db, "prog_1", 0);
    await resolveOrganizationIdCached(db, "prog_1", 0);

    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it("invalidates a single program", async () => {
    const db = mockDb("org_1");

    await resolveOrganizationIdCached(db, "prog_1");
    invalidateOrganizationCache("prog_1");
    await resolveOrganizationIdCached(db, "prog_1");

    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it("clears the whole cache with no argument", async () => {
    const db = mockDb("org_1");

    await resolveOrganizationIdCached(db, "prog_1");
    await resolveOrganizationIdCached(db, "prog_2");
    invalidateOrganizationCache();
    await resolveOrganizationIdCached(db, "prog_1");
    await resolveOrganizationIdCached(db, "prog_2");

    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(4);
  });

  it("falls back to a direct Program read when app_org_for_program is not provisioned", async () => {
    const db = {
      $queryRawUnsafe: vi
        .fn()
        .mockRejectedValue(new Error('function "app_org_for_program" does not exist')),
      program: {
        findUnique: vi.fn().mockResolvedValue({ organizationId: "org_1" }),
      },
    };

    await expect(resolveOrganizationIdCached(db, "prog_1")).resolves.toBe("org_1");
    expect(db.program.findUnique).toHaveBeenCalledWith({
      where: { id: "prog_1" },
      select: { organizationId: true },
    });
  });
});

describe("resolveOrganizationId", () => {
  it("resolves via the SECURITY DEFINER function without touching Program", async () => {
    const db = mockDb("org_1");

    await expect(resolveOrganizationId(db, "prog_1")).resolves.toBe("org_1");
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("app_org_for_program"),
      "prog_1",
    );
    expect(db.program.findUnique).not.toHaveBeenCalled();
  });
});
