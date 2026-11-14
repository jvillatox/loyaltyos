// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ──────────────────────────────────
//
// The reward/tiers fixtures must be hoisted so the useQuery mock returns a
// stable `data` reference across renders. A fresh object literal every render
// would make `useEffect([existingReward, form])` re-run `form.reset()` forever
// (re-render → new data → reset → re-render), blowing the heap.

const reward = vi.hoisted(() => ({
  id: "reward-1",
  name: "Free Coffee",
  description: null,
  pointsCost: 300,
  stock: null,
  imageUrl: null,
  category: null,
  tierRequired: null,
  isActive: true,
}));

const tiers = vi.hoisted(() => []);

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "reward-1" }),
  Link: ({ children }: { children: React.ReactNode }) => children,
  useNavigate: () => vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "reward") {
      return { data: reward, isLoading: false, isError: false };
    }
    if (queryKey[0] === "tiers") {
      return { data: tiers, isLoading: false, isError: false };
    }
    return { data: null, isLoading: false, isError: false };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  fetchApi: vi.fn(),
}));

// ── Import after mocks ─────────────────────────────

import { RewardsEditorPage } from "../rewards/rewards-editor";

beforeAll(() => {
  globalThis.ResizeObserver = {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
});

describe("rewards-editor — empty category/tier selectors", () => {
  it("opens a reward with no category and no tier without crashing", () => {
    render(<RewardsEditorPage />);

    // Before the fix, the empty-value <SelectItem value=""> rendered by the
    // category and tier selectors threw at render time.
    expect(screen.getByText("Edit Reward")).toBeDefined();
    expect(screen.getByText("Availability")).toBeDefined();
    expect(screen.getByDisplayValue("Free Coffee")).toBeDefined();
  });
});
