# Stage 1: Prune monorepo to the minimal workspace for @loyaltyos/admin
FROM node:20-alpine AS pruner
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2 prune --scope=@loyaltyos/admin --docker

# Stage 2: Install dependencies and build static assets
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
RUN pnpm turbo build --filter=@loyaltyos/admin

# Stage 3: Serve with nginx + brotli
FROM fholzer/nginx-brotli:latest AS runtime
RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf

# curl needed for HEALTHCHECK
RUN apk add --no-cache curl

RUN addgroup -S app && adduser -S app -G app && \
    chown -R app:app /usr/share/nginx/html && \
    chown -R app:app /var/cache/nginx && \
    chown -R app:app /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R app:app /var/run/nginx.pid

USER app

LABEL org.opencontainers.image.source="https://github.com/jvillatox/loyaltyos"
LABEL org.opencontainers.image.description="LoyaltyOS Admin UI — React dashboard (Vite + shadcn/ui)"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.version="0.5.0-dev"

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:80/ || exit 1
