---
sidebar_position: 1
title: REST API
---

# REST API Reference

All endpoints require `X-API-Key` and `X-Program-Id` headers. Full OpenAPI spec at `/docs` when the API is running.

## Health

| Method | Endpoint   | Description                |
| ------ | ---------- | -------------------------- |
| `GET`  | `/healthz` | Liveness check             |
| `GET`  | `/readyz`  | Readiness probe (DB+Redis) |
| `GET`  | `/metrics` | Prometheus metrics         |

## Stats & Members

| Method | Endpoint                           | Description                     |
| ------ | ---------------------------------- | ------------------------------- |
| `GET`  | `/api/v1/stats/dashboard`          | KPI aggregates                  |
| `GET`  | `/api/v1/members`                  | List members (paginated)        |
| `POST` | `/api/v1/members`                  | Create a member                 |
| `GET`  | `/api/v1/members/:id`              | Get member by ID                |
| `GET`  | `/api/v1/members/:id/balance`      | Get member point balance        |
| `GET`  | `/api/v1/members/:id/transactions` | Get member transaction history  |
| `POST` | `/api/v1/members/:id/adjust`       | Adjust points (Idempotency-Key) |
| `POST` | `/api/v1/events`                   | Ingest an event                 |

## Campaigns

| Method | Endpoint                           | Description              |
| ------ | ---------------------------------- | ------------------------ |
| `GET`  | `/api/v1/admin/campaigns`          | List campaigns           |
| `POST` | `/api/v1/admin/campaigns`          | Create a campaign        |
| `POST` | `/api/v1/admin/campaigns/estimate` | Estimate campaign impact |

## Coupons

| Method | Endpoint                         | Description                |
| ------ | -------------------------------- | -------------------------- |
| `GET`  | `/api/v1/admin/coupons`          | List coupons               |
| `POST` | `/api/v1/admin/coupons/generate` | Bulk generate coupon codes |

## Segments

| Method | Endpoint                          | Description                   |
| ------ | --------------------------------- | ----------------------------- |
| `GET`  | `/api/v1/admin/segments`          | List segments                 |
| `POST` | `/api/v1/admin/segments`          | Create a segment              |
| `POST` | `/api/v1/admin/segments/estimate` | Estimate segment member count |

## Badges & Tiers

| Method  | Endpoint                      | Description                    |
| ------- | ----------------------------- | ------------------------------ |
| `GET`   | `/api/v1/admin/badges`        | List badges (with type filter) |
| `POST`  | `/api/v1/admin/badges`        | Create a badge                 |
| `GET`   | `/api/v1/admin/tiers`         | List tiers (ordered by rank)   |
| `POST`  | `/api/v1/admin/tiers`         | Create a tier                  |
| `PATCH` | `/api/v1/admin/tiers/reorder` | Reorder tier ranks             |

## Rewards

| Method | Endpoint                     | Description                            |
| ------ | ---------------------------- | -------------------------------------- |
| `GET`  | `/api/v1/rewards`            | List rewards (paginated, with filters) |
| `POST` | `/api/v1/admin/rewards`      | Create a reward                        |
| `POST` | `/api/v1/rewards/:id/redeem` | Redeem a reward (Idempotency-Key)      |

## Auth

| Method | Endpoint              | Description             |
| ------ | --------------------- | ----------------------- |
| `POST` | `/api/v1/auth/login`  | Request magic link      |
| `GET`  | `/api/v1/auth/verify` | Verify magic-link token |

## Notifications

| Method | Endpoint                               | Description       |
| ------ | -------------------------------------- | ----------------- |
| `GET`  | `/api/v1/admin/notification-templates` | List templates    |
| `POST` | `/api/v1/admin/notification-templates` | Create a template |
| `GET`  | `/api/v1/admin/webhooks`               | List webhooks     |
| `POST` | `/api/v1/admin/webhooks`               | Create a webhook  |

## Coalition

| Method   | Endpoint                                 | Description                               |
| -------- | ---------------------------------------- | ----------------------------------------- |
| `POST`   | `/api/v1/coalition/accumulate`           | Accumulate coalition points               |
| `POST`   | `/api/v1/coalition/redeem`               | Redeem coalition points                   |
| `POST`   | `/api/v1/coalition/convert`              | Convert own points to coalition           |
| `POST`   | `/api/v1/coalition/reverse`              | Reverse a coalition transaction           |
| `GET`    | `/api/v1/members/:id/coalition/balance`  | Get member's external coalition balance   |
| `GET`    | `/api/v1/members/:id/coalition/history`  | Get member's external coalition history   |
| `GET`    | `/api/v1/admin/coalition/config`         | Get coalition configuration               |
| `PUT`    | `/api/v1/admin/coalition/config`         | Update coalition configuration            |
| `POST`   | `/api/v1/admin/coalition/healthcheck`    | Test coalition adapter connection         |
| `POST`   | `/api/v1/admin/coalition/link`           | Link member to external coalition account |
| `DELETE` | `/api/v1/admin/coalition/link/:memberId` | Unlink member from coalition account      |
| `GET`    | `/api/v1/admin/coalition/links`          | List linked coalition accounts            |
| `GET`    | `/api/v1/admin/coalition/transactions`   | List coalition transactions               |
| `POST`   | `/api/v1/admin/coalition/reconciliation` | Run coalition reconciliation              |
