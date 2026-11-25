#!/bin/sh
set -e

cd /app/apps/api

# Role provisioning and migrations run as the owner role. Prisma reads
# DATABASE_URL from schema.prisma, so we point it at the owner URL for those
# steps; the API then boots with DATABASE_URL set to the app role. When
# MIGRATION_DATABASE_URL is unset this degrades to single-URL mode (owner only).
MIGRATION_URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}"

echo "Running database migrations..."
DATABASE_URL="$MIGRATION_URL" npx prisma migrate deploy

# Provision after migrations: the script grants DML on existing tables and creates
# app_org_for_program(), whose SQL body is validated against the Program table.
echo "Provisioning tenancy database roles..."
node dist/tenancy-provision.js

echo "Starting API server..."
exec node dist/index.js
