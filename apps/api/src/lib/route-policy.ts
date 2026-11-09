// M0 point 1 — deny-by-default route policy for non-/admin routes.
//
// Maps a non-admin route (METHOD + resolved url) to the set of principals
// allowed to reach it. "SELF" is not an authn principal: it marks a route where
// the MEMBER principal is allowed only when the `:id` path param equals
// request.memberId. Public routes (/healthz, /readyz, /metrics, /api/v1/auth/*)
// are handled by the auth plugin and are not looked up here.

export type Principal =
  | "anonymous"
  | "CLIENT"
  | "MEMBER"
  | "SERVER"
  | "ANALYST"
  | "OPERATOR"
  | "SUPER_ADMIN";

export type PolicyEntry = Principal | "SELF";

export const PRINCIPALS: readonly Principal[] = [
  "anonymous",
  "CLIENT",
  "MEMBER",
  "SERVER",
  "ANALYST",
  "OPERATOR",
  "SUPER_ADMIN",
];

const ALL: readonly PolicyEntry[] = [
  "CLIENT",
  "MEMBER",
  "SERVER",
  "ANALYST",
  "OPERATOR",
  "SUPER_ADMIN",
];
const MEMBER_SELF: readonly PolicyEntry[] = [
  "MEMBER",
  "SERVER",
  "ANALYST",
  "OPERATOR",
  "SUPER_ADMIN",
];
const READ: readonly PolicyEntry[] = ["SERVER", "ANALYST", "OPERATOR", "SUPER_ADMIN"];
const MUTATE: readonly PolicyEntry[] = ["SERVER", "OPERATOR", "SUPER_ADMIN"];
const REDEEM: readonly PolicyEntry[] = ["MEMBER", "SERVER", "OPERATOR", "SUPER_ADMIN"];
const READ_SELF: readonly PolicyEntry[] = ["SERVER", "ANALYST", "OPERATOR", "SUPER_ADMIN", "SELF"];
const MUTATE_SELF: readonly PolicyEntry[] = ["SERVER", "OPERATOR", "SUPER_ADMIN", "SELF"];

const MEMBER_ME_RE = /^\/api\/v1\/members\/me(?:\/|$)/;

export function routePolicy(method: string, url: string): readonly PolicyEntry[] {
  const m = method.toUpperCase();

  // Member "me" routes are always self-scoped (and match before the :id rules).
  if (MEMBER_ME_RE.test(url)) return MEMBER_SELF;

  if (url === "/api/v1/rewards") return ALL;
  if (url === "/api/v1/rewards/:id") return ALL;
  if (url === "/api/v1/rewards/:id/redeem") return REDEEM;

  if (url === "/api/v1/members") return m === "POST" ? MUTATE : READ;
  if (url === "/api/v1/members/:id") return m === "GET" ? READ_SELF : MUTATE;
  if (url === "/api/v1/members/:id/adjust") return MUTATE;
  if (url === "/api/v1/members/:id/balance") return READ_SELF;
  if (url === "/api/v1/members/:id/transactions") return READ_SELF;
  if (url === "/api/v1/members/:id/badges") return READ_SELF;
  if (url === "/api/v1/members/:id/tier") return READ_SELF;
  if (url === "/api/v1/members/:id/devices" && m === "POST") return MUTATE_SELF;
  if (url === "/api/v1/members/:id/devices/:deviceId" && m === "DELETE") return MUTATE_SELF;
  if (url === "/api/v1/members/:id/preferences") return m === "GET" ? READ_SELF : MUTATE_SELF;
  if (url === "/api/v1/members/:id/coalition/balance") return READ_SELF;
  if (url === "/api/v1/members/:id/coalition/history") return READ_SELF;

  if (url === "/api/v1/events") return MUTATE;

  if (url === "/api/v1/coupons/validate") return MUTATE;
  if (url === "/api/v1/coupons/redeem") return MUTATE;

  if (url === "/api/v1/giftcards/validate") return MUTATE;
  if (url === "/api/v1/giftcards/redeem") return MUTATE;

  if (url === "/api/v1/coalition/accumulate") return MUTATE;
  if (url === "/api/v1/coalition/redeem") return MUTATE;
  if (url === "/api/v1/coalition/convert") return MUTATE;
  if (url === "/api/v1/coalition/reverse") return MUTATE;

  if (url === "/api/v1/stats/dashboard") return READ;

  // No default: an undeclared route is denied for every principal.
  return [];
}
