import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

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
    void i18n.changeLanguage("en");
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
    renderApp("/profile");
    expect(screen.getByLabelText("Email")).toBeDefined();
    expect(screen.getByRole("button", { name: /Send Magic Link/i })).toBeDefined();
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
    await userEvent.selectOptions(select, "es");
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
