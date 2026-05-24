import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

// DEBUG: trace DATABASE_URL availability in CI
console.error("[db.ts] DATABASE_URL =", process.env.DATABASE_URL ? "SET" : "MISSING");
console.error("[db.ts] NODE_ENV =", process.env.NODE_ENV);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
