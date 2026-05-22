---
sidebar_position: 4
title: Multi-Tenancy
---

# Multi-Tenancy

LoyaltyOS supports multiple loyalty programs under a single installation. Each program is a fully isolated tenant with its own members, points, campaigns, and configuration.

## How It Works

Every request to the API must include two headers:

| Header         | Description                              |
| -------------- | ---------------------------------------- |
| `X-API-Key`    | Authenticates the caller to a program    |
| `X-Program-Id` | Scopes the request to a specific program |

The API key is validated first, then the program ID determines which tenant's data to operate on. The program ID is **never** derived from user input — it comes from the API key metadata or an explicit header.

## Data Isolation

All operational tables carry a `programId` column. Queries always filter by the resolved program:

```sql
SELECT * FROM "Member" WHERE "programId" = $1 AND "id" = $2;
```

This pattern ensures:

- No cross-program data leaks
- Each program has its own members, tiers, campaigns, badges, etc.
- API keys can be scoped to specific programs or given cross-program access

## API Key Scopes

| Scope  | Description                                            |
| ------ | ------------------------------------------------------ |
| SERVER | Full access to all API endpoints for the given program |
| CLIENT | Limited to member-self operations (balance, redeem)    |

## Use Cases

- **Agency model** — run loyalty programs for multiple client brands from one deployment
- **Regional programs** — separate programs per country with local rules
- **Testing** — create a sandbox program alongside production for testing changes

## Program Configuration

Each program can configure independently:

- Point rules and multipliers
- Tiers and thresholds
- Campaign schedules
- Coalition provider settings
- Notification templates
- Supported languages

See the Admin UI > Settings for program-level configuration options.
