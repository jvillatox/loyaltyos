import { PERMISSIONS } from "@loyaltyos/permissions";
import { describe, expect, it } from "vitest";

import { ADMIN_ROUTE_ENTRIES, MEMBER_ROUTE_ENTRIES, routePermission } from "../routes.js";
import { campaignCreateBodySchema, rewardCreateBodySchema } from "../schemas.js";

describe("route manifest", () => {
  it("has no duplicate method+path entries", () => {
    const keys = ADMIN_ROUTE_ENTRIES.map(([method, path]) => `${method} ${path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only references known permissions", () => {
    const entries = [...ADMIN_ROUTE_ENTRIES, ...MEMBER_ROUTE_ENTRIES];
    for (const [, , permission] of entries) {
      expect(Object.keys(PERMISSIONS)).toContain(permission);
    }
  });

  it("resolves admin and member routes to their permission", () => {
    expect(routePermission("GET", "/api/v1/admin/campaigns")).toBe("read");
    expect(routePermission("POST", "/api/v1/admin/campaigns")).toBe("campaigns.write");
    expect(routePermission("GET", "/api/v1/members/:id")).toBe("read");
    expect(routePermission("GET", "/api/v1/admin/webhooks")).toBe("webhooks.manage");
  });
});

describe("request schemas", () => {
  it("parses a valid campaign create body", () => {
    const result = campaignCreateBodySchema.safeParse({
      name: "Double Points",
      type: "BONUS_POINTS",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a campaign body missing a required field", () => {
    expect(campaignCreateBodySchema.safeParse({ name: "x" }).success).toBe(false);
  });

  it("parses a valid reward create body", () => {
    const result = rewardCreateBodySchema.safeParse({
      name: "Free coffee",
      pointsCost: 500,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a reward body with a non-integer pointsCost", () => {
    expect(rewardCreateBodySchema.safeParse({ name: "x", pointsCost: 10.5 }).success).toBe(false);
  });
});
