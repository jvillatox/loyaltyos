import { afterEach, describe, expect, it } from "vitest";

import { getTenant, requireTenant, runWithTenant } from "../context.js";
import { TenantContextMissing } from "../errors.js";
import { GLOBAL_MODELS } from "../extension.js";
import { resolveTenantRlsMode } from "../mode.js";

describe("runWithTenant / getTenant / requireTenant", () => {
  it("returns undefined outside a tenant scope", () => {
    expect(getTenant()).toBeUndefined();
  });

  it("propagates context through synchronous calls", () => {
    const seen = runWithTenant({ organizationId: "org_1", programId: "prog_a" }, () => getTenant());
    expect(seen).toEqual({ organizationId: "org_1", programId: "prog_a" });
  });

  it("propagates context across async boundaries", async () => {
    const ctx = { organizationId: "org_2", programId: "prog_b" };
    const seen = await runWithTenant(ctx, async () => {
      await Promise.resolve();
      return getTenant();
    });
    expect(seen).toEqual(ctx);
  });

  it("does not leak context after the scope ends", async () => {
    await runWithTenant({ organizationId: "org_3" }, async () => {
      await Promise.resolve();
      expect(getTenant()?.organizationId).toBe("org_3");
    });
    expect(getTenant()).toBeUndefined();
  });

  it("requireTenant throws outside a scope and returns the context inside", () => {
    expect(() => requireTenant()).toThrow(/no tenant context/i);
    const ctx = { organizationId: "org_4" };
    expect(runWithTenant(ctx, () => requireTenant())).toBe(ctx);
  });
});

describe("resolveTenantRlsMode", () => {
  const original = process.env.TENANCY_RLS;

  afterEach(() => {
    if (original === undefined) delete process.env.TENANCY_RLS;
    else process.env.TENANCY_RLS = original;
  });

  it("defaults to off", () => {
    delete process.env.TENANCY_RLS;
    expect(resolveTenantRlsMode()).toBe("off");
  });

  it("treats unknown values as off", () => {
    process.env.TENANCY_RLS = "banana";
    expect(resolveTenantRlsMode()).toBe("off");
  });

  it("reads audit and enforce case-insensitively", () => {
    process.env.TENANCY_RLS = "AUDIT";
    expect(resolveTenantRlsMode()).toBe("audit");
    process.env.TENANCY_RLS = "Enforce";
    expect(resolveTenantRlsMode()).toBe("enforce");
  });
});

describe("TenantContextMissing", () => {
  it("carries the model name", () => {
    const err = new TenantContextMissing("PointTransaction");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TenantContextMissing");
    expect(err.model).toBe("PointTransaction");
    expect(err.message).toContain("PointTransaction");
  });
});

describe("GLOBAL_MODELS", () => {
  it("lists the §3.2 identity/tenant-root tables", () => {
    expect(GLOBAL_MODELS).toEqual(
      new Set([
        "AdminUser",
        "Organization",
        "User",
        "OrganizationMembership",
        "PersonalAccessToken",
        "Session",
        "AdminSession",
        "MagicLinkToken",
        "MemberSessionToken",
        "ApiKey",
      ]),
    );
  });

  it("does not include tenant-scoped models", () => {
    expect(GLOBAL_MODELS.has("PointTransaction")).toBe(false);
    expect(GLOBAL_MODELS.has("Member")).toBe(false);
    expect(GLOBAL_MODELS.has("Program")).toBe(false);
  });
});
