# LoyaltyOS MCP Server

MCP (Model Context Protocol) server that exposes LoyaltyOS functionality as AI tools.
Lets Claude, OpenAI agents, and any MCP-compatible system manage a loyalty program
programmatically.

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

| Variable             | Default                 | Description                                  |
| -------------------- | ----------------------- | -------------------------------------------- |
| `MCP_TRANSPORT`      | `stdio`                 | Transport mode: `stdio` or `sse`             |
| `MCP_SERVER_PORT`    | `3010`                  | HTTP port when running in SSE mode           |
| `MCP_API_KEY`        | —                       | API key that MCP clients use to authenticate |
| `MCP_RATE_LIMIT_RPM` | `100`                   | Max tool calls per minute                    |
| `LOYALTYOS_API_URL`  | `http://localhost:3002` | Internal URL to the LoyaltyOS REST API       |
| `LOYALTYOS_API_KEY`  | —                       | API key to call the LoyaltyOS API            |

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

| Tool                    | Description                                                                     |
| ----------------------- | ------------------------------------------------------------------------------- |
| `member_get`            | Get a member's full profile including tier, point balance, and activity summary |
| `members_list`          | List members with optional filters (tier, inactivity, balance, search)          |
| `member_points_history` | Get point transaction history for a member                                      |
| `member_adjust_points`  | Manually adjust a member's point balance (requires audit note)                  |
| `member_badges`         | Get all badges earned by a member, with optional progress tracking              |

### Campaigns

| Tool                | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `campaign_create`   | Create a campaign (bonus points, spend-and-get, frequency, milestone, etc.) |
| `campaigns_list`    | List campaigns with optional status filter                                  |
| `campaign_get`      | Get campaign details and performance stats                                  |
| `campaign_activate` | Activate a draft or paused campaign                                         |
| `campaign_pause`    | Pause an active campaign                                                    |

### Segments

| Tool              | Description                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| `segment_create`  | Create a dynamic customer segment based on behavioral and profile rules |
| `segments_list`   | List all segments with current member counts                            |
| `segment_preview` | Preview how many members match rules before creating a segment          |

### Analytics

| Tool                  | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| `analytics_dashboard` | Get main program KPIs: active members, points issued, redemption rate |
| `analytics_campaign`  | Get detailed performance metrics for a specific campaign              |

### Coupons

| Tool            | Description                                |
| --------------- | ------------------------------------------ |
| `coupon_create` | Create a coupon or batch of unique coupons |

### Rewards

| Tool                      | Description                                              |
| ------------------------- | -------------------------------------------------------- |
| `rewards_catalog`         | Browse the loyalty rewards catalog with optional filters |
| `reward_create`           | Add a new item to the rewards catalog                    |
| `reward_redemption_stats` | Get redemption statistics for a reward or all rewards    |

### Coalition

| Tool                   | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| `coalition_balance`    | Get a member's balance in the external coalition system (e.g. Apprecio) |
| `coalition_accumulate` | Send points to the coalition system on behalf of a member               |
| `coalition_convert`    | Convert a member's LoyaltyOS points into coalition points               |

### Program

| Tool                 | Description                                                                |
| -------------------- | -------------------------------------------------------------------------- |
| `program_config_get` | Get the current loyalty program configuration (tiers, rules, integrations) |
| `webhooks_list`      | List configured webhooks for the loyalty program                           |

## MCP Resources

The server exposes read-only resources that agents can browse as reference data:

| Resource URI                   | Description                                           |
| ------------------------------ | ----------------------------------------------------- |
| `loyaltyos://program/overview` | Program summary: KPIs, active members, tier structure |
| `loyaltyos://campaigns/active` | All currently running campaigns with rules and stats  |
| `loyaltyos://tiers/config`     | Tier names, thresholds, and benefits in table format  |

Resources return formatted markdown for easy reading by AI agents.

## Tool Input/Output Examples

### member_get

```
Input:  { "memberId": "mem_abc123" }
Output: { "id": "mem_abc123", "email": "alice@example.com", "name": "Alice", "tier": "gold", "pointBalance": 1500, ... }
```

### members_list

```
Input:  { "tier": "gold", "inactiveDays": 30, "limit": 10 }
Output: { "members": [...], "total": 42, "hasMore": true }
```

### campaign_create

```
Input:  { "name": "Double Points Weekend", "type": "bonus_points", "startDate": "2024-06-01T00:00:00Z", "rules": { "multiplier": 2 } }
Output: { "campaignId": "cam_xyz", "status": "draft", "estimatedReach": 5000 }
```

### segment_preview

```
Input:  { "rules": [{ "field": "inactiveDays", "operator": "gte", "value": 60 }] }
Output: { "estimatedCount": 1250, "sampleMembers": [{ "id": "mem_1", "name": "Bob", ... }] }
```

### analytics_dashboard

```
Input:  { "period": "30d" }
Output: { "activeMembers": 50000, "pointsIssued": 250000, "redemptionRate": 0.35, "topCampaigns": [...], "period": "30d" }
```

### coalition_convert

```
Input:  { "memberId": "mem_1", "ownPoints": 1000 }
Output: { "deductedOwnPoints": 1000, "creditedCoalitionPoints": 1000, "conversionRate": 1.0, "newOwnBalance": 500, "newCoalitionBalance": 2500 }
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

- **API Key Authentication**: All MCP client connections must include a valid `MCP_API_KEY`
  in the `Authorization: Bearer <key>` header (SSE mode) or as an env var (stdio mode).
- **Rate Limiting**: Configurable via `MCP_RATE_LIMIT_RPM` (default: 100 requests per minute per API key).
- **Audit Trail**: All mutations (`member_adjust_points`, `campaign_create`, etc.) require
  descriptive notes and support idempotency keys for safe retries.

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
