// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ──────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn());
const mockFetchApi = vi.hoisted(() => vi.fn());
const mockInvalidateQueries = vi.hoisted(() => vi.fn());

// Must use function form to access hoisted values at call time
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ id: "card-uuid-123" }),
  useSearchParams: () => [new URLSearchParams()],
}));

vi.mock("@/lib/api-client", () => ({
  fetchApi: mockFetchApi,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({
    queryKey,
    queryFn,
    enabled,
  }: {
    queryKey: string[];
    queryFn: () => unknown;
    enabled: boolean;
  }) => {
    if (enabled) {
      void queryFn();
    }
    if (queryKey[0] === "giftcard-detail") {
      return {
        data: {
          id: "card-uuid-123",
          code: "SECRET-CODE-123",
          batchId: "batch-1",
          initialAmount: 500,
          balance: 200,
          currency: "USD",
          expirationDate: "2026-12-31",
          status: "active",
          activatedAt: "2026-01-01",
          lastRedemptionAt: null,
        },
        isLoading: false,
      };
    }
    if (queryKey[0] === "giftcard-transactions") {
      return {
        data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
      };
    }
    return { data: null, isLoading: false };
  },
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// ── Import after mocks ─────────────────────────────

import { CardDetailPage } from "../card-detail";

afterEach(() => {
  cleanup();
});

describe("V12-4.1 — card-detail uses opaque :id route", () => {
  it("d) fetches card by /admin/giftcards/cards/:id, not by code", async () => {
    mockFetchApi.mockClear();

    render(<CardDetailPage />);

    await waitFor(() => {
      const calls = mockFetchApi.mock.calls.flat() as string[];
      const detailCall = calls.find((c) => c.includes("/admin/giftcards/cards/"));
      expect(detailCall).toBe("/admin/giftcards/cards/card-uuid-123");
    });
  });

  it("d) rendered DOM contains the code from the API response body", async () => {
    render(<CardDetailPage />);

    const codeElement = await screen.findByText("SECRET-CODE-123");
    expect(codeElement).toBeDefined();
  });

  it("d) window.location.pathname does NOT contain a gift card code", () => {
    expect(window.location.pathname).not.toContain("SECRET-CODE-123");
  });

  it("e) search-then-navigate calls navigate with opaque id, not code", async () => {
    mockNavigate.mockClear();
    mockFetchApi.mockClear();

    // Mock lookup: returns card with opaque id for code search
    mockFetchApi.mockImplementation((url: string) => {
      if (url === "/admin/giftcards/lookup") {
        return Promise.resolve({ id: "card-xyz-789", code: "ABCD-EFGH" });
      }
      if (url.includes("/admin/giftcards/cards/")) {
        return Promise.resolve({
          id: "card-xyz-789",
          code: "ABCD-EFGH",
          batchId: "batch-1",
          initialAmount: 500,
          balance: 200,
          currency: "USD",
          expirationDate: "2026-12-31",
          status: "active",
          activatedAt: null,
          lastRedemptionAt: null,
        });
      }
      return Promise.resolve(null);
    });

    render(<CardDetailPage />);

    // Type code in search box using fireEvent
    const searchInputs = screen.getAllByPlaceholderText("giftcards.searchPlaceholder");
    fireEvent.change(searchInputs[0], { target: { value: "ABCD-EFGH" } });

    // Click search button
    const searchButton = screen.getByText("giftcards.search");
    fireEvent.click(searchButton);

    // Verify navigation used the opaque id, not the code
    await waitFor(() => {
      const navCalls = mockNavigate.mock.calls.flat() as string[];
      const cardNav = navCalls.find((c) => c.startsWith("/giftcards/cards/"));
      expect(cardNav).toBeDefined();
      expect(cardNav).toContain("card-xyz-789");
      expect(cardNav).not.toContain("ABCD-EFGH");
    });
  });
});
