---
sidebar_position: 2
title: Data Model
---

# Data Model

Entity-relationship overview of the LoyaltyOS database. See `apps/api/prisma/schema.prisma` for the authoritative source.

## Core Entities

### Program

The top-level tenant. Every entity belongs to exactly one Program. A single installation can host multiple independent loyalty programs.

### Member

A customer enrolled in a loyalty program. Uniquely identified by `(programId, externalId)`. Members have a 1:1 `PointAccount`, can belong to multiple segments, earn badges, and receive notifications.

### PointAccount

1:1 with Member. Tracks `balance` (confirmed spendable points), `pendingBalance` (earned but not yet settled), `totalEarned`, and `totalRedeemed` since account creation.

### PointTransaction (Ledger)

**Immutable.** Every point movement creates a row here. Types:

- `EARN` — points accumulated from an event or campaign
- `REDEEM` — points spent on a reward or coupon
- `EXPIRE` — points that reached their expiration date
- `REVERSE` — contra-entry that negates a previous transaction (never delete)
- `ADJUST` — manual admin adjustment (always creates an AuditLog)
- `CONVERT_OUT` — points converted to an external coalition program
- `CONVERT_IN` — points converted from an external coalition program

Key design properties:

- `idempotencyKey` is unique — replaying the same key returns the existing result
- Reversals point to the original via `reversedFromId` / `reversedById`
- `expiresAt` set at earn time; the expire worker sweeps past-due rows

### Tier

Named loyalty levels (Bronze, Silver, Gold, etc.) per program. Each tier has a `rank` (ascending) and `minPoints` threshold. Benefits stored as JSON.

### MemberTier

Tracks tier changes for a member. `upgradedAt` / `downgradedAt` pair records the time window the member held that tier.

## Engagement Entities

### Campaign

Marketing campaigns that influence point earning. Types: `BONUS_POINTS`, `SPEND_AND_GET`, `FREQUENCY`, `MILESTONE`, `REFERRAL`, `BIRTHDAY`, `ANNIVERSARY`, `FLASH_SALE`, `TIER_UPGRADE_BONUS`. Supports A/B testing via `CampaignVariant` child records.

### CampaignVariant

A split-test branch of a campaign. `trafficPct` controls what share of the audience sees this variant.

### Segment

A member audience — either `STATIC` (list of member IDs) or `DYNAMIC` (JSON rule set). Used to target campaigns and communications.

### Coupon

Discount codes with flexible modes: `SHARED` (one code for all), `INDIVIDUAL` (unique per member), `LIMITED` (first N uses). Discount types: `PERCENTAGE`, `FIXED`, `FREE_PRODUCT`, `FREE_SHIPPING`, `EXTRA_POINTS`, `EXPERIENCE`.

### CouponRedemption

Logs each coupon use. Linked to the coupon and the member who redeemed it.

## Gamification Entities

### Reward

Catalog items members can exchange points for. Has `pointsCost`, optional `stock` tracking, and optional `tierRequired` gating.

### RewardRedemption

Logs each reward claim — how many points were spent, by whom, and when.

### Badge

Visual achievements. Types: `ACHIEVEMENT`, `STATUS`, `TEMPORAL`, `COLLECTIBLE`, `SOCIAL`. Can be part of a series (`seriesId`, `seriesPosition`).

### MemberBadge

Tracks a specific member's progress toward a badge. `progress` goes from 0 to 100; `unlockedAt` is set when the badge is earned.

## Communication Entities

### NotificationTemplate

Reusable message templates per program. Supports HTML and plain-text bodies. Associated with a `triggerEvent` for automatic sending.

### Notification

Individual message sent to a member. Tracks delivery `status` (PENDING → SENT/FAILED, optionally READ). Supports EMAIL, SMS, PUSH, IN_APP, and WEBHOOK channels.

## Coalition Entities

### CoalitionAccount

Links a Member to their external coalition account (e.g. Puntos Apprecio). Tracks `externalId`, `externalBalance`, and `lastSyncedAt`.

### CoalitionTransaction

Mirrors cross-system point movements. References the local `PointTransaction` via `localTxRef` and the external system's transaction ID via `externalTxRef`.

## Administration Entities

### AdminUser

Users of the Admin UI. Roles: `SUPER_ADMIN`, `OPERATOR`, `ANALYST`. Authenticated via Lucia Auth.

### ApiKey

Server-side or client-side API keys. Scopes: `SERVER` (full system access) or `CLIENT` (limited to member-self operations).

### WebhookSubscription

Outbound webhook registrations. Specifies a URL, a list of event types, and a signing secret.

### AuditLog

Immutable admin action trail. Every manual adjustment, configuration change, and member merge creates a row with the acting admin, entity affected, diff, and reason.

### Event

Inbound event queue. External systems emit events with an `idempotencyKey`. Events are processed asynchronously and marked `processed`.

## Multi-Tenant Design

All operational tables carry `programId`. Queries always filter by program. The Program scope is determined from the API key or `X-Program-Id` header, not from user input.
