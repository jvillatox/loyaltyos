/**
 * Shared admin RBAC model.
 *
 * This is the single source of truth for what each admin role may do. The API
 * maps every `/admin/*` route to one `Permission` and enforces it with
 * `can(role, permission)`; the admin UI reads the same model to hide nav items,
 * gate routes, and disable mutating buttons. Keeping both sides on one model
 * prevents the UI and API from drifting apart.
 */

export type AdminRole = "SUPER_ADMIN" | "OPERATOR" | "ANALYST";

export const ADMIN_ROLES: readonly AdminRole[] = ["SUPER_ADMIN", "OPERATOR", "ANALYST"];

/**
 * Coarse capabilities. Read operations (GET, list, stats, count, estimate,
 * lookup, preview, export) share the `read` permission; every other permission
 * covers the mutating operations on a resource.
 */
export type Permission =
  | "read"
  | "members.write"
  | "campaigns.write"
  | "coupons.write"
  | "segments.write"
  | "badges.write"
  | "tiers.write"
  | "rewards.write"
  | "notificationTemplates.write"
  | "giftcardTerms.write"
  | "webhooks.manage"
  | "giftcards.financial"
  | "coalition.write"
  | "program.write"
  | "ai.chat";

const ALL: readonly AdminRole[] = ["SUPER_ADMIN", "OPERATOR", "ANALYST"];
const OPERATOR_PLUS: readonly AdminRole[] = ["SUPER_ADMIN", "OPERATOR"];
const SUPER_ADMIN_ONLY: readonly AdminRole[] = ["SUPER_ADMIN"];

export const PERMISSIONS: Record<Permission, readonly AdminRole[]> = {
  read: ALL,
  "members.write": OPERATOR_PLUS,
  "campaigns.write": OPERATOR_PLUS,
  "coupons.write": OPERATOR_PLUS,
  "segments.write": OPERATOR_PLUS,
  "badges.write": OPERATOR_PLUS,
  "tiers.write": OPERATOR_PLUS,
  "rewards.write": OPERATOR_PLUS,
  "notificationTemplates.write": OPERATOR_PLUS,
  "giftcardTerms.write": OPERATOR_PLUS,
  "webhooks.manage": SUPER_ADMIN_ONLY,
  "giftcards.financial": SUPER_ADMIN_ONLY,
  "coalition.write": SUPER_ADMIN_ONLY,
  "program.write": SUPER_ADMIN_ONLY,
  "ai.chat": ALL,
};

export function can(role: AdminRole | null | undefined, permission: Permission): boolean {
  if (!role) {
    return false;
  }
  return PERMISSIONS[permission].includes(role);
}

export function isAdminRole(value: string): value is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(value);
}
