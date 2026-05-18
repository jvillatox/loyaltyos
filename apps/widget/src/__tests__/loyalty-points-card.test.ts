/* eslint-disable @typescript-eslint/no-non-null-assertion */
import "../components/loyalty-points-card.js";

import { elementUpdated, fixture } from "@open-wc/testing";
import { html } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoyaltyPointsCard } from "../components/loyalty-points-card.js";
import type { Balance } from "../types.js";

function mockFetchWithData(data: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("LoyaltyPointsCard", () => {
  it("does not render balance content without auth-token", async () => {
    const el = await fixture<LoyaltyPointsCard>(html`
      <loyalty-points-card program-id="pgm" api-base="http://localhost"></loyalty-points-card>
    `);

    expect(el.shadowRoot!.querySelector("loy-spinner")).toBeNull();
    expect(el.shadowRoot!.querySelector(".balance-grid")).toBeNull();
  });

  it("shows spinner while loading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      ),
    );

    const el = await fixture<LoyaltyPointsCard>(html`
      <loyalty-points-card
        program-id="pgm"
        api-base="http://localhost"
        auth-token="tok"
      ></loyalty-points-card>
    `);

    await elementUpdated(el);

    const spinner = el.shadowRoot!.querySelector("loy-spinner");
    expect(spinner).not.toBeNull();
  });

  it("renders balance stats after fetch succeeds", async () => {
    const balance: Balance = { confirmed: 5000, pending: 1000, total: 6000 };
    const mock = mockFetchWithData(balance);

    const el = await fixture<LoyaltyPointsCard>(html`
      <loyalty-points-card
        program-id="pgm"
        api-base="http://localhost"
        auth-token="tok"
      ></loyalty-points-card>
    `);

    // Wait for the fetch to complete and Lit to re-render
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    expect(mock.mock.calls.length).toBeGreaterThan(0);
    const stats = el.shadowRoot!.querySelectorAll(".stat-value");
    expect(stats.length).toBe(3);
  });

  it("shows error message on fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const el = await fixture<LoyaltyPointsCard>(html`
      <loyalty-points-card
        program-id="pgm"
        api-base="http://localhost"
        auth-token="tok"
      ></loyalty-points-card>
    `);

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    const errorEl = el.shadowRoot!.querySelector("loy-error");
    expect(errorEl).not.toBeNull();
  });

  it("re-fetches on loyaltyos:balance-updated event", async () => {
    const balance: Balance = { confirmed: 5000, pending: 0, total: 5000 };
    const mock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: balance }), { status: 200 }));
    vi.stubGlobal("fetch", mock);

    const el = await fixture<LoyaltyPointsCard>(html`
      <loyalty-points-card
        program-id="pgm"
        api-base="http://localhost"
        auth-token="tok"
      ></loyalty-points-card>
    `);

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    const callsBefore = mock.mock.calls.length;

    window.dispatchEvent(new CustomEvent("loyaltyos:balance-updated"));

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    expect(mock.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
