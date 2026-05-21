# Stage 1: Prune monorepo to the minimal workspace for @loyaltyos/api
FROM node:20-alpine AS pruner
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2 prune --scope=@loyaltyos/api --docker

# Stage 2: Install dependencies and build
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Install all dependencies (including devDependencies for build)
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
RUN cd apps/api && npx prisma generate
RUN pnpm turbo build --filter=@loyaltyos/api

# Install production-only dependencies
RUN pnpm install --frozen-lockfile --prod

# Stage 3: Runtime
FROM node:20-alpine AS runtime
RUN apk add --no-cache curl && \
    addgroup -S loyaltyos && adduser -S loyaltyos -G loyaltyos

USER loyaltyos
WORKDIR /app

# Copy production node_modules (replaces dev-inclusive node_modules)
COPY --from=builder --chown=loyaltyos:loyaltyos /app/node_modules ./node_modules

# Copy built API
COPY --from=builder --chown=loyaltyos:loyaltyos /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=loyaltyos:loyaltyos /app/apps/api/package.json ./apps/api/
COPY --from=builder --chown=loyaltyos:loyaltyos /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=loyaltyos:loyaltyos /app/apps/api/prisma ./apps/api/prisma

# Copy built workspace packages (API depends on them at runtime)
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/core/package.json ./packages/core/
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/campaigns/dist ./packages/campaigns/dist
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/campaigns/package.json ./packages/campaigns/
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/coupons/dist ./packages/coupons/dist
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/coupons/package.json ./packages/coupons/
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/segments/dist ./packages/segments/dist
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/segments/package.json ./packages/segments/
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/notifications/dist ./packages/notifications/dist
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/notifications/package.json ./packages/notifications/
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/badges/dist ./packages/badges/dist
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/badges/package.json ./packages/badges/
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/rewards/dist ./packages/rewards/dist
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/rewards/package.json ./packages/rewards/
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/coalition/dist ./packages/coalition/dist
COPY --from=builder --chown=loyaltyos:loyaltyos /app/packages/coalition/package.json ./packages/coalition/

COPY apps/api/entrypoint.sh /entrypoint.sh
USER root
RUN chmod +x /entrypoint.sh
USER loyaltyos

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT_API=3002

EXPOSE 3002

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3002/healthz || exit 1

ENTRYPOINT ["/entrypoint.sh"]
