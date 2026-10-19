# @loyaltyos/permissions

Shared admin RBAC model for LoyaltyOS.

- `AdminRole` — `"SUPER_ADMIN" | "OPERATOR" | "ANALYST"`.
- `PERMISSIONS` — maps each `Permission` to the roles allowed to perform it.
- `can(role, permission)` — the single decision function used by both the API
  (`admin-rbac` plugin) and the admin UI (nav/routes/buttons).

The API maps each `/admin/*` route to a `Permission` in
`apps/api/src/lib/permissions.ts`. The admin UI reads this same model so the
two sides never drift apart.
