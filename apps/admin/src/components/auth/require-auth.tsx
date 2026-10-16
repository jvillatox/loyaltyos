import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAdminAuth } from "@/lib/auth-context";

export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { admin, loading } = useAdminAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        …
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
