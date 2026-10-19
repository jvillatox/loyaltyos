import { describe, expect, it } from "vitest";

import { ADMIN_ROLES, can, PERMISSIONS } from "../index.js";

describe("can", () => {
  it("grants read to every role", () => {
    for (const role of ADMIN_ROLES) {
      expect(can(role, "read")).toBe(true);
    }
  });

  it("grants content writes only to SUPER_ADMIN and OPERATOR", () => {
    for (const role of ADMIN_ROLES) {
      const expected = role !== "ANALYST";
      expect(can(role, "members.write")).toBe(expected);
      expect(can(role, "campaigns.write")).toBe(expected);
      expect(can(role, "giftcardTerms.write")).toBe(expected);
    }
  });

  it("grants sensitive operations only to SUPER_ADMIN", () => {
    expect(can("SUPER_ADMIN", "webhooks.manage")).toBe(true);
    expect(can("SUPER_ADMIN", "giftcards.financial")).toBe(true);
    expect(can("SUPER_ADMIN", "coalition.write")).toBe(true);
    expect(can("SUPER_ADMIN", "program.write")).toBe(true);

    expect(can("OPERATOR", "webhooks.manage")).toBe(false);
    expect(can("OPERATOR", "giftcards.financial")).toBe(false);
    expect(can("OPERATOR", "coalition.write")).toBe(false);
    expect(can("OPERATOR", "program.write")).toBe(false);

    expect(can("ANALYST", "webhooks.manage")).toBe(false);
  });

  it("denies everything to a null or unknown role", () => {
    expect(can(null, "read")).toBe(false);
    expect(can(undefined, "read")).toBe(false);
  });

  it("covers every permission with at least one role", () => {
    for (const [permission, roles] of Object.entries(PERMISSIONS)) {
      expect(roles.length).toBeGreaterThan(0);
      void permission;
    }
  });
});
