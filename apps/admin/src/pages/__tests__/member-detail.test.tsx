// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ──────────────────────────────────

const state = vi.hoisted(() => ({ canWrite: true }));
const mockInvalidateQueries = vi.hoisted(() => vi.fn());
const mockFetchApi = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ requestId: "req-1", status: "PENDING" }),
);

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "member-1" }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/lib/access", () => ({
  usePermission: (permission: string) => (permission === "members.write" ? state.canWrite : true),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "member") {
      return {
        data: {
          id: "member-1",
          email: "ada@loyaltyos.dev",
          phone: null,
          firstName: "Ada",
          lastName: "Lovelace",
          metadata: null,
          tags: [],
          joinedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        isLoading: false,
        isError: false,
      };
    }
    if (queryKey[0] === "member-balance") {
      return { data: { confirmed: 100, pending: 0, total: 100 }, isLoading: false };
    }
    if (queryKey[0] === "member-transactions") {
      return {
        data: { items: [], total: 0, page: 1, pageSize: 10, totalPages: 0 },
        isLoading: false,
      };
    }
    return { data: null, isLoading: false, isError: false };
  },
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock("@/lib/api-client", () => ({
  fetchApi: mockFetchApi,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// ── Import after mocks ─────────────────────────────

import { MemberDetailPage } from "../member-detail";

beforeAll(() => {
  globalThis.ResizeObserver = {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as typeof ResizeObserver;
  vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" });
});

afterEach(() => {
  cleanup();
  mockFetchApi.mockClear();
  state.canWrite = true;
});

describe("member-detail — adjust points", () => {
  it("renders the adjust button for a user with members.write", () => {
    render(<MemberDetailPage />);
    expect(screen.getByRole("button", { name: "pointAdjustments.dialog.title" })).toBeDefined();
  });

  it("hides the adjust button for a user without members.write", () => {
    state.canWrite = false;
    render(<MemberDetailPage />);
    expect(screen.queryByRole("button", { name: "pointAdjustments.dialog.title" })).toBeNull();
  });

  it("shows 'Enviado para aprobación' when the request returns PENDING (202)", async () => {
    render(<MemberDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "pointAdjustments.dialog.title" }));
    fireEvent.change(screen.getByLabelText("pointAdjustments.dialog.amount"), {
      target: { value: "150" },
    });
    fireEvent.change(screen.getByLabelText("pointAdjustments.dialog.comment"), {
      target: { value: "needs approval" },
    });
    const form = screen
      .getByRole("button", { name: "pointAdjustments.dialog.submit" })
      .closest("form");
    if (!form) {
      throw new Error("adjust form not found");
    }
    fireEvent.submit(form);

    expect(await screen.findByText("pointAdjustments.dialog.sentForApproval")).toBeDefined();
    expect(mockFetchApi).toHaveBeenCalledWith(
      "/members/member-1/adjust",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          amount: 150,
          reasonCategory: "CUSTOMER_SERVICE",
          comment: "needs approval",
        }),
      }),
    );
  });
});
