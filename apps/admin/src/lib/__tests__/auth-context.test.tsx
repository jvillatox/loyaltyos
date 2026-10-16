// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockFetchAdminMe = vi.hoisted(() => vi.fn());
const mockAdminLogin = vi.hoisted(() => vi.fn());
const mockAdminLogout = vi.hoisted(() => vi.fn());
const mockSetOnUnauthorized = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({
  fetchAdminMe: mockFetchAdminMe,
  adminLogin: mockAdminLogin,
  adminLogout: mockAdminLogout,
  setOnUnauthorized: mockSetOnUnauthorized,
}));

import { RequireAuth } from "../../components/auth/require-auth";
import { AdminAuthProvider, useAdminAuth } from "../auth-context";

const ADMIN = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  role: "SUPER_ADMIN",
  locale: "es-MX",
  programId: "prog-1",
};

function SessionProbe(): JSX.Element {
  const { admin, loading } = useAdminAuth();
  if (loading) return <div>loading</div>;
  if (admin) return <div>admin:{admin.id}</div>;
  return <div>no-session</div>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AdminAuthProvider", () => {
  it("restores the session from /admin/me on load", async () => {
    mockFetchAdminMe.mockResolvedValue(ADMIN);

    render(
      <MemoryRouter>
        <AdminAuthProvider>
          <SessionProbe />
        </AdminAuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("admin:admin-1")).toBeTruthy();
  });
});

describe("RequireAuth", () => {
  it("redirects to /login when there is no session", async () => {
    mockFetchAdminMe.mockResolvedValue(null);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AdminAuthProvider>
          <Routes>
            <Route path="/login" element={<div>login-page</div>} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <div>protected</div>
                </RequireAuth>
              }
            />
          </Routes>
        </AdminAuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("login-page")).toBeTruthy();
    expect(screen.queryByText("protected")).toBeNull();
  });

  it("renders children when the session is valid", async () => {
    mockFetchAdminMe.mockResolvedValue(ADMIN);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AdminAuthProvider>
          <Routes>
            <Route path="/login" element={<div>login-page</div>} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <div>protected</div>
                </RequireAuth>
              }
            />
          </Routes>
        </AdminAuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("protected")).toBeTruthy();
  });
});
