# LoyaltyOS MCP Server

MCP (Model Context Protocol) server that exposes LoyaltyOS functionality as AI tools.
Lets Claude, OpenAI agents, and any MCP-compatible system manage a loyalty program
programmatically.

Every tool is declared against a shared route manifest (`@loyaltyos/api-contract`) so
its method, path, permission, and request schema are verified to match the LoyaltyOS
API. The contract test fails CI if a tool targets a route the API does not expose or
sends a field the API ignores.

## Quick Start

```bash
# From the monorepo root
pnpm install

# Copy environment
cp apps/mcp-server/.env.example apps/mcp-server/.env

# Run in stdio mode (for Claude Code CLI)
cd apps/mcp-server && pnpm dev

# Run in SSE mode (for remote agents)
cd apps/mcp-server && pnpm dev:sse
```

## Environment Variables

| Variable             | Default                 | Description                            |
| -------------------- | ----------------------- | -------------------------------------- |
| `MCP_TRANSPORT`      | `stdio`                 | Transport mode: `stdio` or `sse`       |
| `MCP_SERVER_PORT`    | `3010`                  | HTTP port when running in SSE mode     |
| `MCP_RATE_LIMIT_RPM` | `100`                   | Max tool calls per minute              |
| `LOYALTYOS_API_URL`  | `http://localhost:3002` | Internal URL to the LoyaltyOS REST API |
| `LOYALTYOS_API_KEY`  | —                       | API key to call the LoyaltyOS API      |

## Claude Code Integration

Add to your Claude Code MCP configuration (`~/.claude/claude_desktop_config.json` or project `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "loyaltyos": {
      "command": "node",
      "args": ["apps/mcp-server/dist/src/index.js"],
      "cwd": "/path/to/loyaltyos",
      "env": {
        "MCP_TRANSPORT": "stdio",
        "LOYALTYOS_API_URL": "http://localhost:3002",
        "LOYALTYOS_API_KEY": "your-internal-api-key"
      }
    }
  }
}
```

## Remote Agent Integration (SSE)

When running in SSE mode, the server exposes an HTTP endpoint at `POST /mcp`:

```bash
MCP_TRANSPORT=sse MCP_SERVER_PORT=3010 pnpm dev:sse
```

Connect remote agents to `http://localhost:3010/mcp`.

## Tool Reference

### Members

| Tool                    | Description                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| `member_get`            | Get a member's profile by id (balance, tier, activity metadata)    |
| `members_list`          | List members with optional search and pagination (page/pageSize)   |
| `member_points_history` | Get a member's point transaction history, paginated                |
| `member_badges`         | Get all badges earned by a member, including locked badge progress |

### Campaigns

| Tool                | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| `campaign_create`   | Create a campaign (bonus points, spend-and-get, frequency, …)    |
| `campaigns_list`    | List campaigns with optional pagination and active-status filter |
| `campaign_get`      | Get a campaign's full configuration by id                        |
| `campaign_activate` | Activate a draft or paused campaign (POST …/lifecycle)           |
| `campaign_pause`    | Pause an active campaign (POST …/lifecycle)                      |

### Segments

| Tool              | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `segment_create`  | Create a static or dynamic customer segment                           |
| `segments_list`   | List all segments with their current member counts                    |
| `segment_preview` | Estimate how many members match rules (POST /admin/segments/estimate) |

### Coupons

| Tool            | Description                                          |
| --------------- | ---------------------------------------------------- |
| `coupon_create` | Create a coupon (percentage, fixed, free product, …) |

### Rewards

| Tool              | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `rewards_catalog` | List the rewards catalog with category/active/point-cost/tier filters |
| `reward_create`   | Add a new item to the rewards catalog                                 |

### Gift cards

| Tool                     | Description                                                             |
| ------------------------ | ----------------------------------------------------------------------- |
| `giftcards_batch_status` | Get a gift card batch's status and details                              |
| `giftcards_lookup`       | Look up a gift card by code (masked unless the caller may reveal codes) |

### Program

| Tool                 | Description                                                               |
| -------------------- | ------------------------------------------------------------------------- |
| `program_config_get` | Get the program config (composes /admin/me → /admin/programs/:id + tiers) |
| `webhooks_list`      | List configured webhooks for the loyalty program                          |

## Removed tools

The following tools were removed because they move money/points without a server-side
confirmation step, or their target endpoint does not exist yet. They may return once
the corresponding confirmation mechanism or endpoint is in place.

| Removed tool              | Reason                                                                     |
| ------------------------- | -------------------------------------------------------------------------- |
| `member_adjust_points`    | Mutates a member balance; blocked until a server-owned confirmation exists |
| `giftcards_create_batch`  | Creates gift cards with value (`giftcards.financial`); needs confirmation  |
| `giftcards_redeem`        | Redeems gift card value (`giftcards.financial`); needs confirmation        |
| `coalition_accumulate`    | Sends points to an external coalition; needs confirmation                  |
| `coalition_convert`       | Converts points across systems; needs confirmation                         |
| `coalition_balance`       | No admin read endpoint exists to query an external coalition balance       |
| `reward_redemption_stats` | Endpoint does not exist in the API                                         |
| `analytics_dashboard`     | `/admin/stats/dashboard` is a new endpoint landing in a follow-up PR       |
| `analytics_campaign`      | `/admin/campaigns/:id/stats` is a new endpoint landing in a follow-up PR   |

## MCP Resources

The server exposes read-only resources that agents can browse as reference data:

| Resource URI                   | Description                                         |
| ------------------------------ | --------------------------------------------------- |
| `loyaltyos://campaigns/active` | All currently active campaigns with type and budget |

Resources return formatted markdown for easy reading by AI agents.

## Tool Input/Output Examples

### member_get

```
Input:  { "memberId": "mem_abc123" }
Output: { "data": { "id": "mem_abc123", "email": "alice@example.com", ... } }
```

### members_list

```
Input:  { "search": "alice", "page": 1, "pageSize": 20 }
Output: { "data": { "items": [...], "total": 42, "page": 1, "pageSize": 20 } }
```

### campaign_create

```
Input:  { "name": "Double Points Weekend", "type": "BONUS_POINTS", "multiplier": 2 }
Output: { "data": { "id": "cam_xyz", "name": "Double Points Weekend", ... } }
```

### segment_preview

```
Input:  { "rules": { "all": [{ "field": "totalSpend", "gte": 100 }] } }
Output: { "data": { "estimatedCount": 1250 } }
```

## Error Codes

All tools return structured errors via `McpToolError`:

| Code             | HTTP Mapping | Description                              |
| ---------------- | ------------ | ---------------------------------------- |
| `NOT_FOUND`      | 404          | Resource does not exist                  |
| `VALIDATION`     | 400          | Invalid input or business rule violation |
| `UNAUTHORIZED`   | 401/403      | Missing or invalid API key               |
| `UPSTREAM_ERROR` | 500/502      | LoyaltyOS API or external system error   |

## Rate Limiting

In SSE mode, the server enforces rate limiting via an in-memory sliding window:

- **Default:** 100 tool calls per minute
- **Configurable:** Set `MCP_RATE_LIMIT_RPM` env var
- **Error:** Returns a `UPSTREAM_ERROR` with `retryAfterSec` hint when exceeded

Stdio mode (single client) does not apply rate limiting.

## Security

- **API Key Authentication**: The MCP server calls the LoyaltyOS API with the
  `LOYALTYOS_API_KEY` value in the `X-API-Key` header. The API key is scoped to a
  single program, so the server cannot switch tenants.
- **No client-side money movement**: tools that create or redeem value were removed
  until a server-owned confirmation mechanism is in place.
- **Rate Limiting**: Configurable via `MCP_RATE_LIMIT_RPM` (default: 100 requests per minute).

## Architecture

```
MCP Client (Claude / OpenAI / Custom Agent)
    │
    │  MCP Protocol (stdio or HTTP/SSE)
    │
    ▼
apps/mcp-server (this app)
    │  Zod validation on all tool inputs
    │  McpToolError → structured error codes
    │  Rate limiting (SSE mode)
    │
    ▼
apps/api (LoyaltyOS REST API on port 3002)
    │  Fastify + Prisma + PostgreSQL
    │
    ▼
PostgreSQL / Redis
```
