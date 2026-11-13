// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GiftCardMetrics } from "@/types";

import { DashboardPage } from "../dashboard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("recharts", () => ({
  Bar: () => null,
  BarChart: () => null,
  CartesianGrid: () => null,
  ResponsiveContainer: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("dashboard gift card API contract", () => {
  it.each([0, 1234])("renders the backend active count %i without crashing", async (active) => {
    // Same field names as GET /admin/giftcards/metrics. No activeCards alias.
    const metrics = {
      active,
      outstandingBalance: 0,
      outstandingBalances: [
        { programId: "program-1", currency: "PEN", total: 100 },
        { programId: "program-1", currency: "USD", total: 20 },
      ],
    } satisfies GiftCardMetrics;

    const mockFetch = vi.fn((url: string) => {
      const data = url.endsWith("/admin/giftcards/metrics")
        ? metrics
        : {
            activeMembers: 0,
            totalPointsIssued: 0,
            totalPointsRedeemed: 0,
            redemptionRatio: 0,
            recentTransactions: 0,
          };
      return Promise.resolve(
        new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={client}>
        <DashboardPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(`${active.toLocaleString()} giftcards.cards`)).toBeDefined();
    expect(screen.getByText("dashboard.title")).toBeDefined();
    expect(mockFetch.mock.calls.map(([url]) => url)).toContain("/api/v1/admin/giftcards/metrics");
    // This card is a count, not a sum of balances in different currencies.
    expect(screen.queryByText("120 giftcards.cards")).toBeNull();
    client.clear();
  });
});
