/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-non-null-assertion */

import "../components/loyalty-points-card.js";

import { fixture } from "@open-wc/testing";
import { html } from "lit";
import { describe, expect, it, vi } from "vitest";

import type { LoyaltyPointsCard } from "../components/loyalty-points-card.js";
import type { Balance } from "../types.js";

function mockFetchWithData(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

describe("LoyaltyPointsCard", () => {
  it("shows spinner while loading", async () => {
    // never resolve so it stays loading
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
        api-key="key1"
        api-url="http://localhost"
        program-id="pgm"
        member-id="mem"
      ></loyalty-points-card>
    `);

    const spinner = el.shadowRoot!.querySelector("loy-spinner");
    expect(spinner).not.toBeNull();
  });

  it("renders balance stats on success", async () => {
    const balance: Balance = { confirmed: 5000, pending: 1000, total: 6000 };
    mockFetchWithData(balance);

    const el = await fixture<LoyaltyPointsCard>(html`
      <loyalty-points-card
        api-key="key1"
        api-url="http://localhost"
        program-id="pgm"
        member-id="mem"
      ></loyalty-points-card>
    `);

    // Wait for fetch to resolve and re-render
    await new Promise((r) => setTimeout(r, 10));
    await el.updateComplete;

    const stats = Array.from(el.shadowRoot!.querySelectorAll(".stat-value"));
    expect(stats.length).toBe(3);
    expect(stats[0]!.textContent.trim()).toBe("+5,000 pts");
    expect(stats[1]!.textContent.trim()).toBe("+1,000 pts");
    expect(stats[2]!.textContent.trim()).toBe("+6,000 pts");
  });

  it("shows error message on fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const el = await fixture<LoyaltyPointsCard>(html`
      <loyalty-points-card
        api-key="key1"
        api-url="http://localhost"
        program-id="pgm"
        member-id="mem"
      ></loyalty-points-card>
    `);

    // Wait for fetch to reject and re-render
    await new Promise((r) => setTimeout(r, 10));
    await el.updateComplete;

    const errorEl = el.shadowRoot!.querySelector("loy-error");
    expect(errorEl).not.toBeNull();
    expect(errorEl!.getAttribute("message")).toBe("Network error");
  });

  it("re-fetches on widget:redeemed event", async () => {
    const balance: Balance = { confirmed: 5000, pending: 0, total: 5000 };
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: balance }), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const el = await fixture<LoyaltyPointsCard>(html`
      <loyalty-points-card
        api-key="key1"
        api-url="http://localhost"
        program-id="pgm"
        member-id="mem"
      ></loyalty-points-card>
    `);

    await new Promise((r) => setTimeout(r, 10));
    await el.updateComplete;

    const callsBefore = mockFetch.mock.calls.length;

    // Dispatch the redeemed event
    el.dispatchEvent(new CustomEvent("widget:redeemed", { bubbles: true, composed: true }));

    await new Promise((r) => setTimeout(r, 10));
    await el.updateComplete;

    expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
