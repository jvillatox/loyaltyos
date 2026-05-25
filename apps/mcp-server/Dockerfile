# Stage 1: Prune monorepo to the minimal workspace for @loyaltyos/mcp-server
FROM node:20-alpine AS pruner
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2 prune --scope=@loyaltyos/mcp-server --docker

# Stage 2: Install dependencies and build
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
RUN pnpm turbo build --filter=@loyaltyos/mcp-server

# Wipe node_modules and reinstall production-only
RUN rm -rf node_modules && \
    node -e "const p=require('./package.json'); delete p.scripts.prepare; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))" && \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# Remove dev-only workspace packages
RUN rm -rf \
    node_modules/.pnpm/@loyaltyos+config-eslint* \
    node_modules/.pnpm/@loyaltyos+config-prettier* \
    node_modules/.pnpm/typescript@* \
    node_modules/.pnpm/eslint@* \
    node_modules/.pnpm/@eslint* \
    node_modules/.pnpm/eslint-* \
    node_modules/.pnpm/@typescript-eslint* \
    node_modules/@loyaltyos/config-eslint \
    node_modules/@loyaltyos/config-prettier \
    node_modules/typescript \
    node_modules/eslint

# Prune bloat from production node_modules
RUN find node_modules -name '*.d.ts' -delete && \
    find node_modules -name '*.map' -delete && \
    find node_modules -name '*.md' -delete && \
    find node_modules -type d \( -name '__tests__' -o -name 'test' -o -name 'tests' \) -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d \( -name 'docs' -o -name 'examples' -o -name 'example' \) -exec rm -rf {} + 2>/dev/null || true

# Stage 3: Runtime
FROM node:20-alpine AS runtime
RUN apk add --no-cache curl && \
    addgroup -S loyaltyos && adduser -S loyaltyos -G loyaltyos

USER loyaltyos
WORKDIR /app

COPY --from=builder --chown=loyaltyos:loyaltyos /app/node_modules ./node_modules
COPY --from=builder --chown=loyaltyos:loyaltyos /app/apps/mcp-server/dist ./apps/mcp-server/dist
COPY --from=builder --chown=loyaltyos:loyaltyos /app/apps/mcp-server/package.json ./apps/mcp-server/

LABEL org.opencontainers.image.source="https://github.com/jvillatox/loyaltyos"
LABEL org.opencontainers.image.description="LoyaltyOS MCP Server — AI tools for loyalty program management"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.version="0.5.0-dev"

ENV NODE_ENV=production
ENV MCP_TRANSPORT=sse
ENV MCP_SERVER_PORT=3010

EXPOSE 3010

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3010/health || exit 1

CMD ["node", "apps/mcp-server/dist/src/index.js"]
