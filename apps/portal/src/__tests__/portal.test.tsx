import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import i18n from "../lib/i18n";

function renderApp(initialRoute = "/") {
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

describe("Portal", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.__LOYALTYOS_CONFIG__ = undefined;
    void i18n.changeLanguage("en-US");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders home page with bottom navigation", () => {
    renderApp();
    expect(screen.getByRole("heading", { name: "Home" })).toBeDefined();
    expect(screen.getByRole("navigation")).toBeDefined();
  });

  it("shows sign in prompt when not authenticated on home", () => {
    renderApp();
    const elements = screen.getAllByText("Sign In");
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("has 5 nav links when authenticated", () => {
    login();
    renderApp();
    const nav = screen.getByRole("navigation");
    const links = nav.querySelectorAll("a");
    expect(links.length).toBe(5);
  });

  it("profile page renders login form when not authenticated", () => {
    window.__LOYALTYOS_CONFIG__ = { programId: "prog_001" };
    renderApp("/profile");
    expect(screen.getByLabelText("Email")).toBeDefined();
    expect(screen.getByRole("button", { name: /Send Magic Link/i })).toBeDefined();
  });

  it("profile page shows an error when no program is configured", () => {
    renderApp("/profile");
    expect(screen.getByText(/not configured with a program/i)).toBeDefined();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("login sends the runtime-configured program id, not prog_001", async () => {
    window.__LOYALTYOS_CONFIG__ = { programId: "prog_acme" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({ data: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp("/profile");
    await userEvent.type(screen.getByLabelText("Email"), "carlos@example.com");
    await userEvent.click(screen.getByRole("button", { name: /Send Magic Link/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/auth/magic-link",
        expect.objectContaining({
          headers: expect.objectContaining({ "X-Program-Id": "prog_acme" }),
        }),
      );
    });
  });

  it("profile page shows sign out when authenticated", () => {
    login();
    renderApp("/profile");
    expect(screen.getByText(/Sign Out/i)).toBeDefined();
  });

  it("theme toggle buttons exist on profile page", () => {
    renderApp("/profile");
    expect(screen.getByRole("radio", { name: /Light/i })).toBeDefined();
    expect(screen.getByRole("radio", { name: /Dark/i })).toBeDefined();
  });

  it("language selector changes value", async () => {
    renderApp("/profile");
    const select = screen.getByRole("combobox", { name: /Language/ });
    await userEvent.selectOptions(select, "es-MX");
    expect(screen.getByRole("combobox", { name: /Idioma/ })).toBeDefined();
  });

  it("rewards page redirects to profile when not authenticated", () => {
    renderApp("/rewards");
    expect(screen.getByRole("heading", { name: "Profile" })).toBeDefined();
  });

  it("badges page redirects to profile when not authenticated", () => {
    renderApp("/badges");
    expect(screen.getByRole("heading", { name: "Profile" })).toBeDefined();
  });

  it("transactions page redirects to profile when not authenticated", () => {
    renderApp("/transactions");
    expect(screen.getByRole("heading", { name: "Profile" })).toBeDefined();
  });

  it("handles unknown routes with redirect to home", () => {
    renderApp("/nonexistent");
    expect(screen.getByRole("heading", { name: "Home" })).toBeDefined();
  });

  it("home page hides sign in prompt when authenticated", () => {
    login();
    renderApp();
    const signInElements = screen.queryAllByText("Sign In");
    expect(signInElements.length).toBe(0);
  });

  it("logout clears session", () => {
    login();
    renderApp("/profile");
    const logoutBtn = screen.getByText(/Sign Out/i);
    logoutBtn.click();
    expect(sessionStorage.getItem("auth-token")).toBeNull();
  });
});
