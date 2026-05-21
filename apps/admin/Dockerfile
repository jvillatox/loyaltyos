# Stage 1: Build static assets
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Copy root tsconfig (admin tsconfig extends ../../tsconfig.base.json)
COPY tsconfig.base.json /tsconfig.base.json

# Copy full source
COPY apps/admin/ .

# Remove workspace-only devDependencies
RUN sed -i '/@loyaltyos\/config-eslint/d' package.json && \
    sed -i '/@loyaltyos\/config-prettier/d' package.json

RUN pnpm install --no-frozen-lockfile
RUN pnpm add -D @types/node
RUN pnpm build

# Stage 2: Serve with nginx
FROM nginx:alpine AS runtime
RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /app/dist /usr/share/nginx/html
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf

RUN addgroup -S app && adduser -S app -G app && \
    chown -R app:app /usr/share/nginx/html && \
    chown -R app:app /var/cache/nginx && \
    chown -R app:app /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R app:app /var/run/nginx.pid

USER app

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:80/ || exit 1
