import { createTenantPrismaClient, resolveTenantRlsMode } from "@loyaltyos/tenancy";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";

import { getBusinessMetrics } from "./lib/business-metrics.js";

// Vitest's Vite SSR transform replaces process.env.DATABASE_URL with the
// value from loaded .env files at compile time, which can be undefined in CI
// even when a CI env var or .env file sets it. Manually parse any .env file
// to ensure DATABASE_URL is always available for the Prisma query engine.
export function loadDotEnv() {
  const candidates = [resolve(".env"), resolve("apps/api/.env")];
  for (const path of candidates) {
    try {
      const content = readFileSync(path, "utf-8");
      for (const line of content.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0 && !line.startsWith("#")) {
          const key = line.slice(0, eq).trim();
          const value = line.slice(eq + 1).trim();
          if (key && value && !process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    } catch {
      // file doesn't exist — fine
    }
  }
}

loadDotEnv();

const globalForPrisma = globalThis as unknown as {
  basePrisma: PrismaClient | undefined;
  prisma: PrismaClient | undefined;
};

const basePrisma =
  globalForPrisma.basePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

// Wrap the client with the tenancy extension (docs/design/tenancy.md §2.2). The
// mode is read lazily per query so TENANCY_RLS is honored at runtime; under the
// default `off` this is behaviorally transparent. `onMissingContext` is only
// invoked under `audit`.
export const prisma =
  globalForPrisma.prisma ??
  createTenantPrismaClient(basePrisma, {
    mode: resolveTenantRlsMode,
    onMissingContext: (model, operation) => {
      console.warn(
        `[tenancy] tenant-scoped query on "${model}" (${operation}) ran without tenant context`,
      );
      try {
        getBusinessMetrics().tenantMissingContextTotal.inc({ model });
      } catch {
        // metrics not initialized yet — the warning above still fires.
      }
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.basePrisma = basePrisma;
  globalForPrisma.prisma = prisma;
}
