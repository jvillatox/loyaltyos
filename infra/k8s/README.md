# LoyaltyOS — Kubernetes Deployment

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

### 4. Install on a local cluster (kind / k3d / minikube)

```bash
# Create a values override
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
    RESEND_API_KEY: "re_placeholder"
    TWILIO_ACCOUNT_SID: "AC_placeholder"
    TWILIO_AUTH_TOKEN: "placeholder"
EOF

helm install loyaltyos infra/k8s/helm/loyaltyos -f my-values.yaml
```

### 5. Wait for migrations and pods

```bash
# Watch the migrations job
kubectl wait --for=condition=complete job/loyaltyos-migrations --timeout=120s

# Watch pods
kubectl get pods -w
```

## Local Development with kind

```bash
# Create a kind cluster
kind create cluster --name loyaltyos

# Install ingress-nginx
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

# Enable ingress
cat > kind-values.yaml <<EOF
ingress:
  enabled: true
  hosts:
    - host: api.loyaltyos.local
      paths:
        - path: /
          pathType: Prefix
          port: 3002
adminIngress:
  enabled: true
  hosts:
    - host: admin.loyaltyos.local
      paths:
        - path: /
          pathType: Prefix
          port: 80
portalIngress:
  enabled: true
  hosts:
    - host: portal.loyaltyos.local
      paths:
        - path: /
          pathType: Prefix
          port: 80
EOF

helm install loyaltyos infra/k8s/helm/loyaltyos -f kind-values.yaml
```

## Local Development with k3d

```bash
k3d cluster create loyaltyos --servers 1 --agents 2

# k3d comes with Traefik, no extra ingress controller needed
helm install loyaltyos infra/k8s/helm/loyaltyos
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

| Component     | Kind              | Scaling       | Description                                    |
| ------------- | ----------------- | ------------- | ---------------------------------------------- |
| API           | Deployment + HPA  | 2–10 replicas | Fastify server, auto-scales on CPU/memory      |
| Admin         | Deployment        | 1 replica     | React SPA served via nginx+brotli              |
| Portal        | Deployment        | 1 replica     | Customer-facing portal via nginx+brotli        |
| BullMQ Worker | Deployment        | 2 replicas    | Background job processor, independently scaled |
| Migrations    | Job (Helm hook)   | run-once      | Prisma migrate deploy, runs pre-upgrade        |
| PostgreSQL    | StatefulSet (sub) | 1 replica     | Bitnami PostgreSQL 16.x                        |
| Redis         | StatefulSet (sub) | 1 replica     | Bitnami Redis 7.x                              |

## Configuration

### Key toggles

| Value                               | Default | Description                          |
| ----------------------------------- | ------- | ------------------------------------ |
| `api.enabled`                       | `true`  | Deploy the API server                |
| `admin.enabled`                     | `true`  | Deploy the Admin dashboard           |
| `portal.enabled`                    | `true`  | Deploy the Customer Portal           |
| `bullmqWorker.enabled`              | `true`  | Deploy the BullMQ worker             |
| `migrations.enabled`                | `true`  | Run DB migrations on install/upgrade |
| `api.autoscaling.enabled`           | `true`  | Enable HPA for the API               |
| `api.pdb.enabled`                   | `true`  | Enable PodDisruptionBudget           |
| `ingress.enabled`                   | `false` | Create API Ingress                   |
| `adminIngress.enabled`              | `false` | Create Admin Ingress                 |
| `portalIngress.enabled`             | `false` | Create Portal Ingress                |
| `networkPolicy.enabled`             | `true`  | Restrict pod-to-pod traffic          |
| `serviceAccount.create`             | `true`  | Create dedicated ServiceAccount      |
| `rbac.create`                       | `true`  | Create RBAC rules                    |
| `monitoring.enabled`                | `true`  | Enable monitoring endpoints          |
| `monitoring.serviceMonitor.enabled` | `true`  | Create Prometheus ServiceMonitor     |
| `postgresql.enabled`                | `true`  | Deploy PostgreSQL sub-chart          |
| `redis.enabled`                     | `true`  | Deploy Redis sub-chart               |
| `externalSecrets.enabled`           | `false` | Use External Secrets Operator        |

### Using external databases

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

### Configuring coalition providers

```yaml
api:
  coalition:
    providers:
      - programId: "prog_abc123"
        provider: APPRECIO
        endpoint: https://apiv2.dcanje.mx/api
        publicToken: "pub_token"
        privateToken: "priv_token"
        identifierType: email
        timeoutMs: 10000
```

### Production secrets (External Secrets Operator)

```yaml
externalSecrets:
  enabled: true
  secretStoreRef:
    kind: ClusterSecretStore
    name: aws-secrets-manager
  keys:
    - secretKey: JWT_SECRET
      remoteRef:
        key: /loyaltyos/production/jwt-secret
    - secretKey: API_KEY_SALT
      remoteRef:
        key: /loyaltyos/production/api-key-salt
    - secretKey: KMS_MASTER_KEY
      remoteRef:
        key: /loyaltyos/production/kms-master-key
```

## Troubleshooting

### Migrations job fails

```bash
kubectl logs job/loyaltyos-migrations
# Common issues: DATABASE_URL misconfigured, network policy blocking egress
```

### API can't connect to PostgreSQL

```bash
kubectl port-forward svc/loyaltyos-postgresql 5432:5432
psql -h localhost -U loyaltyos -d loyaltyos
```

### Check HPA status

```bash
kubectl get hpa loyaltyos-api
```

### Check Prometheus metrics

```bash
kubectl port-forward svc/loyaltyos-api 3002:3002
curl http://localhost:3002/metrics
```
