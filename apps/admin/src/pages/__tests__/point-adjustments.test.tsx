// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ──────────────────────────────────

const state = vi.hoisted(() => ({
  canApprove: true,
  adminId: "super-1",
  items: [] as Record<string, unknown>[],
}));

const mockInvalidateQueries = vi.hoisted(() => vi.fn());

vi.mock("@/lib/access", () => ({
  usePermission: (permission: string) =>
    permission === "members.adjust.approve" ? state.canApprove : true,
}));

vi.mock("@/lib/auth-context", () => ({
  useAdminAuth: () => ({
    admin: {
      id: state.adminId,
      email: "admin@loyaltyos.dev",
      name: "Admin",
      role: state.canApprove ? "SUPER_ADMIN" : "OPERATOR",
      locale: null,
      programId: "program-1",
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === "point-adjustments") {
      return {
        data: {
          items: state.items,
          total: state.items.length,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        },
        isLoading: false,
        isError: false,
      };
    }
    return { data: null, isLoading: false, isError: false };
  },
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// ── Import after mocks ─────────────────────────────

import { PointAdjustmentsPage } from "../point-adjustments";

function makeItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "req-1",
    programId: "program-1",
    memberId: "member-1",
    amount: 150,
    reasonCategory: "OTHER",
    comment: "needs approval",
    requestedById: "operator-1",
    requestedByType: "ADMIN_USER",
    status: "PENDING",
    decidedById: null,
    decidedAt: null,
    decisionComment: null,
    transactionId: null,
    idempotencyKey: "key-1",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    member: {
      id: "member-1",
      email: "member@loyaltyos.dev",
      firstName: "Ada",
      lastName: "Lovelace",
      externalId: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  state.canApprove = true;
  state.adminId = "super-1";
  state.items = [];
});

afterEach(() => {
  cleanup();
});

describe("point-adjustments list — approve/reject gating", () => {
  it("a SUPER_ADMIN sees approve/reject on another admin's PENDING request", () => {
    state.items = [makeItem()];
    render(<PointAdjustmentsPage />);

    expect(screen.getByText("pointAdjustments.approve")).toBeDefined();
    expect(screen.getByText("pointAdjustments.reject")).toBeDefined();
  });

  it("a SUPER_ADMIN does not see buttons on their own PENDING request", () => {
    state.adminId = "operator-1";
    state.items = [makeItem({ requestedById: "operator-1" })];
    render(<PointAdjustmentsPage />);

    expect(screen.queryByText("pointAdjustments.approve")).toBeNull();
    expect(screen.queryByText("pointAdjustments.reject")).toBeNull();
  });

  it("an OPERATOR without approval permission sees no approve/reject buttons", () => {
    state.canApprove = false;
    state.items = [makeItem()];
    render(<PointAdjustmentsPage />);

    expect(screen.queryByText("pointAdjustments.approve")).toBeNull();
    expect(screen.queryByText("pointAdjustments.reject")).toBeNull();
    expect(screen.queryByText("common.actions")).toBeNull();
  });

  it("a PENDING request expiring soon shows the expiry warning", () => {
    state.items = [makeItem({ expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })];
    render(<PointAdjustmentsPage />);

    expect(screen.getByText("pointAdjustments.expiryWarning")).toBeDefined();
  });
});
