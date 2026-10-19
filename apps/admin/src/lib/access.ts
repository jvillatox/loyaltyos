import type { Permission } from "@loyaltyos/permissions";
import { can, isAdminRole } from "@loyaltyos/permissions";

import { useAdminAuth } from "@/lib/auth-context";

/**
 * True when the current admin holds the given permission. Reads the same
 * permission model the API enforces, so the UI cannot drift from the backend.
 */
export function usePermission(permission: Permission): boolean {
  const { admin } = useAdminAuth();
  const role = admin?.role ?? "";
  return can(isAdminRole(role) ? role : null, permission);
}
