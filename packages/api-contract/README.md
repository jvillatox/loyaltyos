# @loyaltyos/api-contract

The shared contract between the LoyaltyOS API and its MCP server.

Two things live here, and both are the single source of truth:

- **`routes.ts`** — the route manifest. Every `/admin/*` route (and the member
  read routes the MCP exposes) maps a `METHOD /api/v1/...` key to one
  `Permission`. The API's `admin-rbac` plugin and the MCP server's contract test
  both resolve against this map, so a tool can never target a route that is not
  declared here.
- **`schemas.ts`** — the Zod request schemas the API parses from
  `request.body` / `request.query`. The MCP server reuses these exact objects as
  its tool input schemas, so a field the API ignores is impossible to send.

Nothing here depends on Prisma or any `@loyaltyos/*` domain package — only
`@loyaltyos/permissions` (for the `Permission` type) and `zod`. This keeps the
MCP server free of the query-engine dependency.

## Layout

```
packages/api-contract/
├── src/
│   ├── index.ts      # public exports
│   ├── routes.ts     # route manifest (admin + member)
│   └── schemas.ts    # shared request schemas
├── package.json
└── README.md
```
