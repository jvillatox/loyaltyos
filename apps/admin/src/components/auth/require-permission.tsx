import type { Permission } from "@loyaltyos/permissions";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { usePermission } from "@/lib/access";

/**
 * Redirects to /forbidden when the current admin lacks the permission. Wrap
 * write-only routes (create/edit/issue) so an ANALYST who lands on the URL
 * directly gets a clear "Sin permiso" page instead of a broken form.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}): JSX.Element {
  const allowed = usePermission(permission);

  if (!allowed) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
}
