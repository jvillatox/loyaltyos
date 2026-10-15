import { createHash, timingSafeEqual } from "node:crypto";

import type { AuditActorType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { prisma } from "../db.js";
import type { AuditActor } from "../lib/audit.js";
import { adminLucia } from "../lib/auth/admin-lucia.js";
import { lucia } from "../lib/auth/lucia.js";
import { LoyaltyError } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    programId: string;
    apiKeyScope: string;
    memberId: string | null;
    adminId: string | null;
    actor: AuditActor;
  }
}

function safeTokenEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// eslint-disable-next-line @typescript-eslint/require-await
async function authPluginImpl(app: FastifyInstance): Promise<void> {
  app.decorateRequest("programId", "");
  app.decorateRequest("apiKeyScope", "");
  app.decorateRequest("memberId", null);
  app.decorateRequest("adminId", null);
  app.decorateRequest("actor", { type: "SYSTEM" as AuditActorType, id: "anonymous" });

  app.addHook("preHandler", async (request, reply) => {
    // Replace shared default actor with a fresh per-request instance
    request.actor = { type: "SYSTEM" as AuditActorType, id: "anonymous" };

    // Resolved (decoded) route path, not the raw URL — `request.url` preserves
    // %xx encoding, which would let an encoded path skip the whitelist below.
    const path = request.routeOptions.url ?? "";

    // Health/readiness checks are always public (exact match — no prefix).
    if (path === "/healthz" || path === "/readyz") {
      return;
    }

    // Metrics expose per-program business data (leaks across tenants), so they
    // are token-gated in production and hidden entirely when no token is set.
    if (path === "/metrics") {
      const metricsToken = process.env.METRICS_TOKEN;
      if (!metricsToken) {
        if (process.env.NODE_ENV === "production") {
          // Hide /metrics behind a 404. Sending directly (instead of
          // reply.callNotFound()) avoids re-entering this preHandler hook with
          // the 404 route context, where `routeOptions.url` is undefined and the
          // request would fall through to the API-key check and return 401.
          return reply.code(404).send({
            message: `Route ${request.method}:${request.url} not found`,
            error: "Not Found",
            statusCode: 404,
          });
        }
        return; // open in dev/test
      }

      const authHeader = request.headers.authorization;
      const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
      if (bearer && safeTokenEqual(bearer, metricsToken)) {
        return;
      }
      throw Object.assign(new Error("Invalid metrics token"), { statusCode: 401 });
    }

    // Skip auth for public routes (magic link, admin login, etc.)
    if (
      path.startsWith("/api/v1/auth/") ||
      path === "/api/v1/admin/login" ||
      path === "/api/v1/admin/logout"
    ) {
      return;
    }

    // 1. Try admin session first (cookie)
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const adminSessionId = adminLucia.readSessionCookie(cookieHeader);
      if (adminSessionId) {
        const { user: adminUser } = await adminLucia.validateSession(adminSessionId);
        if (adminUser) {
          request.adminId = adminUser.id;
          request.programId = adminUser.programId;
          request.apiKeyScope = "SERVER";
          request.actor = { type: "ADMIN_USER", id: adminUser.id };
          return;
        }
      }
    }

    // 2. Try member session cookie
    if (cookieHeader) {
      const sessionId = lucia.readSessionCookie(cookieHeader);
      if (sessionId) {
        const { session: _session, user } = await lucia.validateSession(sessionId);
        if (user) {
          request.memberId = user.id;
          request.programId = user.programId;
          request.apiKeyScope = "MEMBER";
          request.actor = { type: "MEMBER", id: user.id };
          return;
        }
      }
    }

    // 3. Fall back to API key
    const apiKey = request.headers["x-api-key"] as string | undefined;
    const programId = request.headers["x-program-id"] as string | undefined;

    if (!apiKey) {
      throw Object.assign(new Error("Missing X-API-Key header or valid session"), {
        statusCode: 401,
      });
    }

    const key = await prisma.apiKey.findUnique({
      where: { key: apiKey },
    });

    if (!key?.isActive) {
      throw Object.assign(new Error("Invalid API key"), { statusCode: 401 });
    }

    if (key.expiresAt && key.expiresAt < new Date()) {
      throw Object.assign(new Error("API key has expired"), { statusCode: 401 });
    }

    await prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    // The key is scoped to its own program. A client must not switch tenants by
    // sending a different X-Program-Id than the key's programId.
    if (programId && programId !== key.programId) {
      throw new LoyaltyError("FORBIDDEN", 403);
    }
    request.programId = key.programId;
    request.apiKeyScope = key.scope;
    request.actor = { type: "API_KEY", id: key.id };
  });
}

export const authPlugin = fp(authPluginImpl, { name: "auth" });
export default authPlugin;
