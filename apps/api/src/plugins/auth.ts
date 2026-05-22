import type { AuditActorType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { prisma } from "../db.js";
import type { AuditActor } from "../lib/audit.js";
import { adminLucia } from "../lib/auth/admin-lucia.js";
import { lucia } from "../lib/auth/lucia.js";

declare module "fastify" {
  interface FastifyRequest {
    programId: string;
    apiKeyScope: string;
    memberId: string | null;
    adminId: string | null;
    actor: AuditActor;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
async function authPluginImpl(app: FastifyInstance): Promise<void> {
  app.decorateRequest("programId", "");
  app.decorateRequest("apiKeyScope", "");
  app.decorateRequest("memberId", null);
  app.decorateRequest("adminId", null);
  app.decorateRequest("actor", { type: "SYSTEM" as AuditActorType, id: "anonymous" });

  app.addHook("onRequest", async (request) => {
    // Replace shared default actor with a fresh per-request instance
    request.actor = { type: "SYSTEM" as AuditActorType, id: "anonymous" };

    // Skip auth for public routes (magic link, admin login, etc.)
    if (
      request.url.startsWith("/api/v1/auth/") ||
      request.url.startsWith("/api/v1/admin/login") ||
      request.url.startsWith("/api/v1/admin/logout")
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
          request.actor = { type: "ADMIN_USER", id: user.id };
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

    request.programId = programId ?? key.programId;
    request.apiKeyScope = key.scope;
    request.actor = { type: "API_KEY", id: key.id };
  });
}

export const authPlugin = fp(authPluginImpl, { name: "auth" });
export default authPlugin;
