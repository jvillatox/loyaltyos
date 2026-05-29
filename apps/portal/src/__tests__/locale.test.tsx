import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import i18n, { bootstrapLocale } from "../lib/i18n";

function renderApp(initialRoute = "/profile") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function login() {
  sessionStorage.setItem("auth-token", "test-token");
  sessionStorage.setItem("member-id", "mem_001");
  sessionStorage.setItem("program-id", "prog_001");
}

// Mock fetch for API calls
const mockFetch = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  void i18n.changeLanguage("en-US");
});

describe("Portal locale resolution", () => {
  it("shows Spanish UI when /auth/me returns locale es-MX", async () => {
    login();
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: "mem_001",
            email: "test@example.com",
            phone: null,
            firstName: "Test",
            lastName: null,
            joinedAt: new Date().toISOString(),
            programId: "prog_001",
            locale: "es-MX",
            program: { defaultLocale: "es-MX", supportedLocales: ["es-MX", "en-US"] },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Mock profile API call
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 200 }));

    // Mock preferences API
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    await bootstrapLocale();

    renderApp();

    // After bootstrap, language should be es-MX
    await waitFor(() => {
      expect(i18n.language).toBe("es-MX");
    });

    // sessionStorage should have the locale
    expect(sessionStorage.getItem("loyaltyos-locale")).toBe("es-MX");
  });

  it("stores locale in sessionStorage when ?lang=en-US is in URL", async () => {
    // Simulate URL with ?lang=en-US
    Object.defineProperty(window, "location", {
      value: { search: "?lang=en-US" },
      writable: true,
    });

    await bootstrapLocale();

    expect(i18n.language).toBe("en-US");
    expect(sessionStorage.getItem("loyaltyos-locale")).toBe("en-US");
  });

  it("falls back to sessionStorage when URL has no lang param", async () => {
    sessionStorage.setItem("loyaltyos-locale", "en-US");

    Object.defineProperty(window, "location", {
      value: { search: "" },
      writable: true,
    });

    await bootstrapLocale();

    expect(i18n.language).toBe("en-US");
  });

  it("defaults to es-MX when nothing matches", async () => {
    Object.defineProperty(window, "location", {
      value: { search: "" },
      writable: true,
    });

    // Mock navigator to return an unsupported locale
    vi.stubGlobal("navigator", { language: "fr-FR" });

    await bootstrapLocale();

    expect(i18n.language).toBe("es-MX");
    expect(sessionStorage.getItem("loyaltyos-locale")).toBe("es-MX");
  });
});

describe("Profile language selector", () => {
  it("calls PATCH /members/me when changing locale while authenticated", async () => {
    login();

    // Mock /auth/me for bootstrap
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: "mem_001",
            locale: "es-MX",
            program: { defaultLocale: "es-MX", supportedLocales: ["es-MX", "en-US"] },
          },
        }),
        { status: 200 },
      ),
    );

    // Profile data
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { email: "test@example.com", firstName: "Test" },
        }),
        { status: 200 },
      ),
    );

    // Preferences
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    await bootstrapLocale();

    const user = userEvent.setup();
    renderApp();

    // Find the language selector and change it (renders in Spanish after bootstrap)
    const select = await screen.findByLabelText("Idioma");
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { locale: "en-US" } }), { status: 200 }),
    );

    await user.selectOptions(select, "en-US");

    // Verify PATCH was called
    await waitFor(() => {
      const patchCalls = mockFetch.mock.calls.filter(
        (call: [string, RequestInit?]) =>
          call[1]?.method === "PATCH" && call[0].includes("/members/me"),
      );
      expect(patchCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
