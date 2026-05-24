import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";

// Vitest's Vite SSR transform replaces process.env.DATABASE_URL with the
// value from loaded .env files at compile time, which can be undefined in CI
// even when a CI env var or .env file sets it. Manually parse any .env file
// to ensure DATABASE_URL is always available for the Prisma query engine.
function loadDotEnv() {
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

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
