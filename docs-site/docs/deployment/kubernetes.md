---
sidebar_position: 1
title: Kubernetes
---

# Kubernetes Deployment

Production-ready Helm chart for deploying LoyaltyOS on Kubernetes.

## Prerequisites

- Kubernetes 1.25+
- Helm 3.12+
- [Bitnami chart repository](https://charts.bitnami.com/bitnami) (for PostgreSQL and Redis sub-charts)
- Optional: cert-manager (for TLS), Prometheus Operator (for ServiceMonitor), External Secrets Operator (for secret management)

## Quick Start

### 1. Add the Bitnami repository and update dependencies

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm dependency update infra/k8s/helm/loyaltyos
```

### 2. Lint the chart

```bash
helm lint infra/k8s/helm/loyaltyos
```

### 3. Dry-run to verify generated manifests

```bash
helm template loyaltyos infra/k8s/helm/loyaltyos --debug
```

### 4. Install on a local cluster

```bash
cat > my-values.yaml <<EOF
postgresql:
  auth:
    password: "dev-password-123"
redis:
  auth:
    password: "dev-redis-123"
api:
  env:
    JWT_SECRET: "dev-jwt-secret-at-least-32-chars!!"
    API_KEY_SALT: "dev-salt"
    KMS_MASTER_KEY: "0000000000000000000000000000000000000000000000000000000000000001"
EOF

helm install loyaltyos infra/k8s/helm/loyaltyos -f my-values.yaml
```

### 5. Wait for migrations and pods

```bash
kubectl wait --for=condition=complete job/loyaltyos-migrations --timeout=120s
kubectl get pods -w
```

## Architecture

```
                    ┌──────────────┐
                    │   Ingress    │
                    │ (nginx/ALB)  │
                    └──┬───┬───┬───┘
                       │   │   │
          ┌────────────┘   │   └────────────┐
          ▼                ▼                ▼
   ┌────────────┐  ┌────────────┐  ┌────────────┐
   │  API Pods  │  │ Admin Pod  │  │Portal Pod  │
   │  (HPA 2+)  │  │  (nginx)   │  │  (nginx)   │
   └─────┬──────┘  └────────────┘  └────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌───────┐   ┌──────────────┐
│PostgreSQL│ │ Redis │   │BullMQ Worker │
│(subchart)│ │(subchart)│ │  (separate   │
└────────┘ └───────┘   │   scaling)   │
                        └──────────────┘
```

## Components

| Component     | Kind              | Scaling       | Description                               |
| ------------- | ----------------- | ------------- | ----------------------------------------- |
| API           | Deployment + HPA  | 2–10 replicas | Fastify server, auto-scales on CPU/memory |
| Admin         | Deployment        | 1 replica     | React SPA served via nginx+brotli         |
| Portal        | Deployment        | 1 replica     | Customer-facing portal via nginx+brotli   |
| BullMQ Worker | Deployment        | 2 replicas    | Background job processor                  |
| Migrations    | Job (Helm hook)   | run-once      | Prisma migrate deploy                     |
| PostgreSQL    | StatefulSet (sub) | 1 replica     | Bitnami PostgreSQL 16.x                   |
| Redis         | StatefulSet (sub) | 1 replica     | Bitnami Redis 7.x                         |

## Key Toggles

| Value                               | Default | Description                      |
| ----------------------------------- | ------- | -------------------------------- |
| `api.enabled`                       | `true`  | Deploy the API server            |
| `admin.enabled`                     | `true`  | Deploy the Admin dashboard       |
| `portal.enabled`                    | `true`  | Deploy the Customer Portal       |
| `bullmqWorker.enabled`              | `true`  | Deploy the BullMQ worker         |
| `api.autoscaling.enabled`           | `true`  | Enable HPA for the API           |
| `ingress.enabled`                   | `false` | Create API Ingress               |
| `networkPolicy.enabled`             | `true`  | Restrict pod-to-pod traffic      |
| `monitoring.serviceMonitor.enabled` | `true`  | Create Prometheus ServiceMonitor |
| `externalSecrets.enabled`           | `false` | Use External Secrets Operator    |

## Using External Databases

```yaml
postgresql:
  enabled: false
redis:
  enabled: false

externalDatabase:
  enabled: true
  host: my-rds-instance.aws.com
  port: 5432
  user: loyaltyos
  password: "secure-password"
  database: loyaltyos
  ssl: true

externalRedis:
  enabled: true
  host: my-elasticache.aws.com
  port: 6379
  password: "redis-password"
```

## Local Development with kind

```bash
kind create cluster --name loyaltyos

# Install ingress-nginx
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

# Install with ingress enabled
helm install loyaltyos infra/k8s/helm/loyaltyos \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=api.loyaltyos.local
```

## Troubleshooting

```bash
# Migrations job logs
kubectl logs job/loyaltyos-migrations

# Test DB connectivity
kubectl port-forward svc/loyaltyos-postgresql 5432:5432
psql -h localhost -U loyaltyos -d loyaltyos

# Check HPA status
kubectl get hpa loyaltyos-api

# Check Prometheus metrics
kubectl port-forward svc/loyaltyos-api 3002:3002
curl http://localhost:3002/metrics
```
