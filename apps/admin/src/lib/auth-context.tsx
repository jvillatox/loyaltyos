import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { AdminUser } from "@/lib/api-client";
import { adminLogin, adminLogout, fetchAdminMe, setOnUnauthorized } from "@/lib/api-client";

interface AdminAuthValue {
  admin: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on load. If there is no valid session cookie, /admin/me
  // returns 401 and we stay unauthenticated (the route guard then redirects).
  useEffect(() => {
    let cancelled = false;
    void fetchAdminMe()
      .then((me) => {
        if (!cancelled) setAdmin(me);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A 401 on any API call clears the session and redirects to /login.
  useEffect(() => {
    setOnUnauthorized(() => {
      setAdmin(null);
      navigate("/login", { replace: true });
    });
    return () => {
      setOnUnauthorized(null);
    };
  }, [navigate]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await adminLogin(email, password);
    if (result.ok) {
      const me = await fetchAdminMe();
      setAdmin(me);
    }
    return result;
  }, []);

  const logout = useCallback(async () => {
    await adminLogout();
    setAdmin(null);
    navigate("/login", { replace: true });
  }, [navigate]);

  const value = useMemo(() => ({ admin, loading, login, logout }), [admin, loading, login, logout]);

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth must be used within an AdminAuthProvider");
  }
  return ctx;
}
