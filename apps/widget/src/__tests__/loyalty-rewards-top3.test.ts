/* eslint-disable @typescript-eslint/no-non-null-assertion */
import "../components/loyalty-rewards-top3.js";

import { fixture } from "@open-wc/testing";
import { html } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoyaltyRewardsTop3 } from "../components/loyalty-rewards-top3.js";

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("LoyaltyRewardsTop3", () => {
  it("unwraps the paginated { items } envelope and renders reward cards", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              items: [
                { id: "r1", name: "Free Coffee", pointsCost: 300, imageUrl: null },
                { id: "r2", name: "Movie Ticket", pointsCost: 500, imageUrl: null },
              ],
              total: 2,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const el = await fixture<LoyaltyRewardsTop3>(html`
      <loyalty-rewards-top3
        program-id="pgm"
        api-base="http://localhost"
        auth-token="tok"
      ></loyalty-rewards-top3>
    `);

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    expect(el.shadowRoot!.querySelectorAll(".reward-card").length).toBe(2);
  });

  it("shows the empty state when there are no rewards", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [], total: 0 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const el = await fixture<LoyaltyRewardsTop3>(html`
      <loyalty-rewards-top3
        program-id="pgm"
        api-base="http://localhost"
        auth-token="tok"
      ></loyalty-rewards-top3>
    `);

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("loy-empty")).not.toBeNull();
  });
});
