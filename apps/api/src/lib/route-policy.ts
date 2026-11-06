// M0 point 1 — deny-by-default route policy for non-/admin routes.
//
// Maps a non-admin route (METHOD + resolved url) to the set of principals
// allowed to reach it. Public routes (/healthz, /readyz, /metrics, /api/v1/auth/*)
// are handled by the auth plugin and are not looked up here.
//
// STUB: returns an empty set (deny-by-default). The route-policy tests fail
// until this is populated and enforced in the app's preHandler chain.

export type Principal =
  | "anonymous"
  | "CLIENT"
  | "MEMBER"
  | "SERVER"
  | "ANALYST"
  | "OPERATOR"
  | "SUPER_ADMIN";

export const PRINCIPALS: readonly Principal[] = [
  "anonymous",
  "CLIENT",
  "MEMBER",
  "SERVER",
  "ANALYST",
  "OPERATOR",
  "SUPER_ADMIN",
];

/** Principals allowed to reach `method url`. Empty = deny-by-default. */
export function routePolicy(_method: string, _url: string): readonly Principal[] {
  return [];
}
