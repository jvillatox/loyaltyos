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

# Save generated prisma client (contains the query engine and generated types).
# The engine was downloaded by `prisma generate` respecting binaryTargets.
RUN PRISMA_PKG_DIR=$(find node_modules/.pnpm -maxdepth 1 -name '@prisma+client@*' -type d | head -1) && \
    cp -r "$PRISMA_PKG_DIR/node_modules/.prisma" /tmp/prisma-client

# Wipe node_modules and reinstall production-only.
# --ignore-scripts skips the prisma postinstall which would download all platform
# engines (~31 MB). The prisma CLI auto-downloads the schema-engine on first
# `prisma migrate deploy` at container startup (entrypoint.sh).
RUN rm -rf node_modules && \
    node -e "const p=require('./package.json'); delete p.scripts.prepare; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))" && \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# Restore generated prisma client into the freshly installed @prisma/client
RUN PRISMA_PKG_DIR=$(find node_modules/.pnpm -maxdepth 1 -name '@prisma+client@*' -type d | head -1) && \
    mkdir -p "$PRISMA_PKG_DIR/node_modules" && \
    cp -r /tmp/prisma-client "$PRISMA_PKG_DIR/node_modules/.prisma" && \
    rm -rf /tmp/prisma-client

# Remove dev-only workspace packages and their transitive dependencies.
# config-eslint / config-prettier are pulled in by turbo prune.
# Their transitive deps (typescript, eslint, @typescript-eslint, @unrs, etc.)
# are installed even with --prod because they are workspace package dependencies.
RUN rm -rf \
    node_modules/.pnpm/@loyaltyos+config-eslint* \
    node_modules/.pnpm/@loyaltyos+config-prettier* \
    node_modules/.pnpm/typescript@* \
    node_modules/.pnpm/eslint@* \
    node_modules/.pnpm/@eslint* \
    node_modules/.pnpm/eslint-* \
    node_modules/.pnpm/@typescript-eslint* \
    node_modules/.pnpm/@unrs* \
    node_modules/.pnpm/es-abstract@* \
    node_modules/@loyaltyos/config-eslint \
    node_modules/@loyaltyos/config-prettier \
    node_modules/typescript \
    node_modules/eslint \
    node_modules/@eslint \
    node_modules/@eslint-community \
    node_modules/@typescript-eslint \
    node_modules/eslint-import-context \
    node_modules/eslint-import-resolver-node \
    node_modules/eslint-import-resolver-typescript \
    node_modules/eslint-module-utils \
    node_modules/eslint-plugin-import \
    node_modules/eslint-plugin-simple-import-sort \
    node_modules/eslint-scope \
    node_modules/eslint-visitor-keys \
    node_modules/eslint-config-prettier

# Prune bloat from production node_modules:
# - .d.ts files (keep @prisma/client — needed for generated client types)
# - .map files
# - .md files
# - test directories
# - docs / examples directories
RUN find node_modules -name '*.d.ts' -not -path '*@prisma/client*' -delete && \
    find node_modules -name '*.map' -delete && \
    find node_modules -name '*.md' -not -path '*@prisma/client*' -delete && \
    find node_modules -type d \( -name '__tests__' -o -name 'test' -o -name 'tests' \) -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d \( -name 'docs' -o -name 'examples' -o -name 'example' \) -exec rm -rf {} + 2>/dev/null || true

# Stage 3: Runtime
FROM node:20-alpine AS runtime
RUN apk add --no-cache curl && \
    addgroup -S loyaltyos && adduser -S loyaltyos -G loyaltyos

USER loyaltyos
WORKDIR /app

# Copy production node_modules
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

LABEL org.opencontainers.image.source="https://github.com/jvillatox/loyaltyos"
LABEL org.opencontainers.image.description="LoyaltyOS API — REST API server (Fastify + Prisma)"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.version="0.5.0-dev"

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT_API=3002

EXPOSE 3002

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3002/healthz || exit 1

ENTRYPOINT ["/entrypoint.sh"]
