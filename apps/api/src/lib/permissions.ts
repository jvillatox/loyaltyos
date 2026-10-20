import type { Permission } from "@loyaltyos/permissions";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * The single source of truth for admin-route authorization. Every `/admin/*`
 * route maps to one `Permission`; the `admin-rbac` plugin looks the route up by
 * its resolved `METHOD /api/v1/admin/...` key and checks the caller's role with
 * `can(role, permission)`. A route that is registered but missing from this map
 * is denied for everyone (deny-by-default), and the RBAC test suite fails.
 *
 * `login`, `logout`, and `me` are intentionally absent: they are handled by the
 * auth plugin (login/logout are public) and the plugin special-cases `me` for
 * any authenticated admin.
 */
const ADMIN_ROUTE_ENTRIES: readonly (readonly [HttpMethod, string, Permission])[] = [
  // tiers
  ["POST", "/api/v1/admin/tiers", "tiers.write"],
  ["GET", "/api/v1/admin/tiers", "read"],
  ["GET", "/api/v1/admin/tiers/stats", "read"],
  ["GET", "/api/v1/admin/tiers/:id", "read"],
  ["GET", "/api/v1/admin/tiers/:id/benefits", "read"],
  ["PATCH", "/api/v1/admin/tiers/:id", "tiers.write"],
  ["DELETE", "/api/v1/admin/tiers/:id", "tiers.write"],
  ["PATCH", "/api/v1/admin/tiers/reorder", "tiers.write"],
  // coupons
  ["POST", "/api/v1/admin/coupons", "coupons.write"],
  ["POST", "/api/v1/admin/coupons/generate", "coupons.write"],
  ["GET", "/api/v1/admin/coupons", "read"],
  ["GET", "/api/v1/admin/coupons/:id", "read"],
  ["PATCH", "/api/v1/admin/coupons/:id", "coupons.write"],
  ["DELETE", "/api/v1/admin/coupons/:id", "coupons.write"],
  ["GET", "/api/v1/admin/coupons/:id/stats", "read"],
  // notification templates + notifications + webhooks
  ["GET", "/api/v1/admin/notification-templates", "read"],
  ["POST", "/api/v1/admin/notification-templates", "notificationTemplates.write"],
  ["GET", "/api/v1/admin/notification-templates/:id", "read"],
  ["PATCH", "/api/v1/admin/notification-templates/:id", "notificationTemplates.write"],
  ["DELETE", "/api/v1/admin/notification-templates/:id", "notificationTemplates.write"],
  ["POST", "/api/v1/admin/notification-templates/:id/preview", "read"],
  ["POST", "/api/v1/admin/notification-templates/:id/test-send", "notificationTemplates.write"],
  ["GET", "/api/v1/admin/notifications", "read"],
  ["GET", "/api/v1/admin/webhooks", "webhooks.manage"],
  ["POST", "/api/v1/admin/webhooks", "webhooks.manage"],
  ["GET", "/api/v1/admin/webhooks/:id", "webhooks.manage"],
  ["PATCH", "/api/v1/admin/webhooks/:id", "webhooks.manage"],
  ["DELETE", "/api/v1/admin/webhooks/:id", "webhooks.manage"],
  // badges
  ["POST", "/api/v1/admin/badges", "badges.write"],
  ["GET", "/api/v1/admin/badges", "read"],
  ["GET", "/api/v1/admin/badges/stats", "read"],
  ["GET", "/api/v1/admin/badges/:id", "read"],
  ["PATCH", "/api/v1/admin/badges/:id", "badges.write"],
  ["DELETE", "/api/v1/admin/badges/:id", "badges.write"],
  // rewards
  ["POST", "/api/v1/admin/rewards", "rewards.write"],
  ["GET", "/api/v1/admin/rewards", "read"],
  ["GET", "/api/v1/admin/rewards/:id", "read"],
  ["PATCH", "/api/v1/admin/rewards/:id", "rewards.write"],
  ["DELETE", "/api/v1/admin/rewards/:id", "rewards.write"],
  ["POST", "/api/v1/admin/rewards/:id/archive", "rewards.write"],
  ["POST", "/api/v1/admin/rewards/:id/publish", "rewards.write"],
  ["POST", "/api/v1/admin/rewards/:id/restock", "rewards.write"],
  // programs
  ["GET", "/api/v1/admin/programs/:id", "read"],
  ["PATCH", "/api/v1/admin/programs/:id", "program.write"],
  // campaigns
  ["POST", "/api/v1/admin/campaigns", "campaigns.write"],
  ["GET", "/api/v1/admin/campaigns", "read"],
  ["GET", "/api/v1/admin/campaigns/:id", "read"],
  ["PATCH", "/api/v1/admin/campaigns/:id", "campaigns.write"],
  ["DELETE", "/api/v1/admin/campaigns/:id", "campaigns.write"],
  ["POST", "/api/v1/admin/campaigns/estimate", "read"],
  ["POST", "/api/v1/admin/campaigns/:id/estimate", "read"],
  ["POST", "/api/v1/admin/campaigns/:id/lifecycle", "campaigns.write"],
  // segments
  ["POST", "/api/v1/admin/segments", "segments.write"],
  ["GET", "/api/v1/admin/segments", "read"],
  ["POST", "/api/v1/admin/segments/estimate", "read"],
  ["GET", "/api/v1/admin/segments/:id", "read"],
  ["PATCH", "/api/v1/admin/segments/:id", "segments.write"],
  ["DELETE", "/api/v1/admin/segments/:id", "segments.write"],
  ["GET", "/api/v1/admin/segments/:id/count", "read"],
  ["GET", "/api/v1/admin/segments/:id/members", "read"],
  ["POST", "/api/v1/admin/segments/:id/members", "segments.write"],
  ["DELETE", "/api/v1/admin/segments/:id/members", "segments.write"],
  // coalition
  ["POST", "/api/v1/admin/coalition/link", "coalition.write"],
  ["DELETE", "/api/v1/admin/coalition/link/:memberId", "coalition.write"],
  ["GET", "/api/v1/admin/coalition/links", "read"],
  ["GET", "/api/v1/admin/coalition/capabilities", "read"],
  ["GET", "/api/v1/admin/coalition/transactions", "read"],
  ["POST", "/api/v1/admin/coalition/reconciliation", "coalition.write"],
  ["GET", "/api/v1/admin/coalition/config", "read"],
  ["PUT", "/api/v1/admin/coalition/config", "coalition.write"],
  ["POST", "/api/v1/admin/coalition/healthcheck", "read"],
  // giftcards
  ["POST", "/api/v1/admin/giftcards/batches", "giftcards.financial"],
  ["GET", "/api/v1/admin/giftcards/batches", "read"],
  ["GET", "/api/v1/admin/giftcards/batches/:id", "read"],
  ["POST", "/api/v1/admin/giftcards/batches/:id/cancel", "giftcards.financial"],
  ["GET", "/api/v1/admin/giftcards/batches/:id/export", "giftcards.codes.reveal"],
  ["POST", "/api/v1/admin/giftcards/refund", "giftcards.financial"],
  ["POST", "/api/v1/admin/giftcards/cancel", "giftcards.financial"],
  ["POST", "/api/v1/admin/giftcards/transactions", "read"],
  ["POST", "/api/v1/admin/giftcards/terms", "giftcardTerms.write"],
  ["GET", "/api/v1/admin/giftcards/terms", "read"],
  ["GET", "/api/v1/admin/giftcards/terms/:id", "read"],
  ["PATCH", "/api/v1/admin/giftcards/terms/:id", "giftcardTerms.write"],
  ["DELETE", "/api/v1/admin/giftcards/terms/:id", "giftcardTerms.write"],
  ["POST", "/api/v1/admin/giftcards/lookup", "read"],
  ["GET", "/api/v1/admin/giftcards/cards/:id", "read"],
  ["POST", "/api/v1/admin/giftcards/redeem", "giftcards.financial"],
  ["GET", "/api/v1/admin/giftcards/batches/:id/cards", "read"],
  ["GET", "/api/v1/admin/giftcards/metrics", "read"],
  // ai companion
  ["POST", "/api/v1/admin/ai/chat", "ai.chat"],
];

/** Full inventory of admin routes (method, resolved path). */
export const ADMIN_ROUTES: readonly (readonly [HttpMethod, string])[] = ADMIN_ROUTE_ENTRIES.map(
  ([method, path]) => [method, path] as const,
);

/** Route lookup map keyed by `"METHOD /api/v1/admin/..."`. */
export const ADMIN_ROUTE_PERMISSIONS: Readonly<Record<string, Permission>> = Object.freeze(
  Object.fromEntries(
    ADMIN_ROUTE_ENTRIES.map(([method, path, permission]) => [`${method} ${path}`, permission]),
  ),
);

export function permissionForAdminRoute(method: string, path: string): Permission | undefined {
  return ADMIN_ROUTE_PERMISSIONS[`${method} ${path}`];
}

/** Admin routes reachable without a permission entry (any authenticated admin). */
export const ADMIN_SELF_SERVICE_PATHS: ReadonlySet<string> = new Set([
  "/api/v1/admin/me",
  "/api/v1/admin/login",
  "/api/v1/admin/logout",
]);
