import { createHash, timingSafeEqual } from "node:crypto";

import type { AdminRole } from "@loyaltyos/permissions";
import { isAdminRole, minAdminRole } from "@loyaltyos/permissions";
import {
  resolveOrganizationIdCached,
  resolveTenantRlsMode,
  runWithTenant,
} from "@loyaltyos/tenancy";
import type { AuditActorType, OrganizationMembership } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { prisma } from "../db.js";
import {
  resolveAdminUserByEmail,
  resolveUserByEmail,
  resolveUserIdForAdminUser,
} from "../lib/admin-user-bridge.js";
import type { AuditActor } from "../lib/audit.js";
import { adminAuthMode, adminLucia } from "../lib/auth/admin-lucia.js";
import { lucia } from "../lib/auth/lucia.js";
import { LoyaltyError } from "../lib/errors.js";
import { MEMBER_TOKEN_PREFIX } from "../lib/member-session-token.js";
import { hashToken, PAT_PREFIX } from "../lib/personal-access-token.js";
import {
  resolveDefaultMembership,
  resolveDefaultProgramId,
  validateProgramInMembership,
} from "../lib/tenancy-users.js";

declare module "fastify" {
  interface FastifyRequest {
    programId: string;
    apiKeyScope: string;
    memberId: string | null;
    // Identity-root User.id (PR 7). Set for any authenticated admin (session or
    // PAT); distinct from `adminId` (the legacy AdminUser.id bridge, nullable).
    userId: string | null;
    adminId: string | null;
    adminRole: AdminRole | null;
    // Active organization id resolved from the admin's membership. Null in
    // `legacy` mode where the org is derived from programId instead.
    organizationId: string | null;
    patId: string | null;
    memberTokenReadOnly: boolean;
    actor: AuditActor;
  }
}

function safeTokenEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Resolves the active program for an admin session in `user` mode (rule 8). A
// client-supplied `X-Program-Id` is validated strictly (403 on a program outside
// the membership scope or the active org); otherwise the session's persisted
// program is used when still valid, falling back to the deterministic default.
async function resolveSessionProgramId(
  membership: OrganizationMembership,
  sessionProgramId: string | null,
  headerProgramId: string | undefined,
  preferredProgramId: string | null,
): Promise<string | null> {
  if (headerProgramId) {
    if (!(await validateProgramInMembership(prisma, membership, headerProgramId))) {
      throw new LoyaltyError("FORBIDDEN", 403);
    }
    return headerProgramId;
  }
  if (
    sessionProgramId &&
    (await validateProgramInMembership(prisma, membership, sessionProgramId))
  ) {
    return sessionProgramId;
  }
  return resolveDefaultProgramId(prisma, membership, preferredProgramId);
}

// eslint-disable-next-line @typescript-eslint/require-await
async function authPluginImpl(app: FastifyInstance): Promise<void> {
  app.decorateRequest("programId", "");
  app.decorateRequest("apiKeyScope", "");
  app.decorateRequest("memberId", null);
  app.decorateRequest("userId", null);
  app.decorateRequest("adminId", null);
  app.decorateRequest("adminRole", null);
  app.decorateRequest("organizationId", null);
  app.decorateRequest("patId", null);
  app.decorateRequest("memberTokenReadOnly", false);
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
        // `adminLucia` shares Lucia's global `Register.Lucia` types, which are
        // derived from the member lucia (lib/auth/lucia.ts) and therefore lack the
        // admin-only fields (`status`, `locale`, `activeOrganizationId`,
        // `activeProgramId`). The adapter targets `User` and persists the admin
        // session attributes, so cast to the admin shape actually returned here.
        const { session, user } = (await adminLucia.validateSession(adminSessionId)) as unknown as {
          session: { activeOrganizationId: string | null; activeProgramId: string | null };
          user: {
            id: string;
            email: string | null;
            name: string | null;
            locale: string | null;
            status: string | null;
          } | null;
        };
        if (user) {
          const email = user.email;
          if (email) {
            const mode = adminAuthMode();
            if (mode === "user") {
              // Per-request verification (no caching): the User is read fresh by
              // validateSession; the membership is read fresh here, so a disabled
              // User/membership or role change takes effect on the next request.
              if (user.status !== "ACTIVE") {
                throw new LoyaltyError("UNAUTHORIZED", 401);
              }

              const activeOrgId = session.activeOrganizationId ?? null;
              const membership = activeOrgId
                ? await prisma.organizationMembership.findUnique({
                    where: {
                      userId_organizationId: { userId: user.id, organizationId: activeOrgId },
                    },
                  })
                : await resolveDefaultMembership(prisma, { id: user.id, email });
              if (!membership || membership.status !== "ACTIVE") {
                throw new LoyaltyError("UNAUTHORIZED", 401);
              }

              const adminUser = await resolveAdminUserByEmail(prisma, email);
              const programId = await resolveSessionProgramId(
                membership,
                session.activeProgramId ?? null,
                request.headers["x-program-id"] as string | undefined,
                adminUser?.programId ?? null,
              );

              request.userId = user.id;
              request.adminId = adminUser?.id ?? null;
              request.adminRole = isAdminRole(membership.role) ? membership.role : null;
              request.organizationId = membership.organizationId;
              request.programId = programId ?? "";
              request.apiKeyScope = "SERVER";
              request.actor = {
                type: "ADMIN_USER",
                id: user.id,
                adminUserId: adminUser?.id ?? null,
              };
              return;
            }

            // legacy: AdminUser is the source of truth (rollback window).
            const adminUser = await resolveAdminUserByEmail(prisma, email);
            if (!adminUser?.isActive) {
              throw new LoyaltyError("UNAUTHORIZED", 401);
            }
            request.userId = user.id;
            request.adminId = adminUser.id;
            request.adminRole = isAdminRole(adminUser.role) ? adminUser.role : null;
            request.organizationId = null;
            request.programId = adminUser.programId;
            request.apiKeyScope = "SERVER";
            request.actor = {
              type: "ADMIN_USER",
              id: user.id,
              adminUserId: adminUser.id,
            };
            return;
          }
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

    // 2b. Personal access token (Authorization: Bearer lopat_…)
    const authorization = request.headers.authorization;
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (bearerToken.startsWith(PAT_PREFIX)) {
      const token = await prisma.personalAccessToken.findUnique({
        where: { tokenHash: hashToken(bearerToken) },
        include: { adminUser: true },
      });

      if (!token || token.revokedAt) {
        throw Object.assign(new Error("Invalid token"), { statusCode: 401 });
      }
      if (token.expiresAt < new Date()) {
        throw Object.assign(new Error("Token has expired"), { statusCode: 401 });
      }
      if (!token.adminUser.isActive) {
        throw Object.assign(new Error("Token owner is inactive"), { statusCode: 401 });
      }

      const tokenProgramId = request.headers["x-program-id"] as string | undefined;
      const mode = adminAuthMode();

      if (mode === "user") {
        // PAT stays bound to the owner's org/program: resolve the owner's User via
        // the email bridge, read the default membership for role/org, and reject
        // any cross-program `X-Program-Id`.
        const ownerUser = await resolveUserByEmail(prisma, token.adminUser.email);
        if (!ownerUser || ownerUser.status !== "ACTIVE") {
          throw new LoyaltyError("UNAUTHORIZED", 401);
        }
        const membership = await resolveDefaultMembership(prisma, {
          id: ownerUser.id,
          email: ownerUser.email,
        });
        if (!membership || membership.status !== "ACTIVE") {
          throw new LoyaltyError("UNAUTHORIZED", 401);
        }
        if (tokenProgramId && tokenProgramId !== token.adminUser.programId) {
          throw new LoyaltyError("FORBIDDEN", 403);
        }

        request.userId = ownerUser.id;
        request.adminId = token.adminUser.id;
        request.adminRole = minAdminRole(token.role, membership.role);
        request.organizationId = membership.organizationId;
        request.programId = token.adminUser.programId;
        request.apiKeyScope = "SERVER";
        request.patId = token.id;
        request.actor = {
          type: "ADMIN_USER",
          id: ownerUser.id,
          patId: token.id,
          adminUserId: token.adminUser.id,
        };
      } else {
        // legacy: PAT bound to owner's AdminUser (unchanged behavior).
        if (tokenProgramId && tokenProgramId !== token.adminUser.programId) {
          throw new LoyaltyError("FORBIDDEN", 403);
        }
        const ownerUserId = await resolveUserIdForAdminUser(prisma, token.adminUser.id);
        request.userId = ownerUserId;
        request.adminId = token.adminUser.id;
        request.adminRole = minAdminRole(token.role, token.adminUser.role);
        request.organizationId = null;
        request.programId = token.adminUser.programId;
        request.apiKeyScope = "SERVER";
        request.patId = token.id;
        request.actor = {
          type: "ADMIN_USER",
          id: token.adminUser.id,
          patId: token.id,
          adminUserId: token.adminUser.id,
        };
      }

      // Avoid a write on every request: refresh lastUsedAt at most once a minute.
      const now = new Date();
      if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() > 60_000) {
        await prisma.personalAccessToken.update({
          where: { id: token.id },
          data: { lastUsedAt: now },
        });
      }
      return;
    }

    // 2c. Member session token (Authorization: Bearer lomem_…)
    if (bearerToken.startsWith(MEMBER_TOKEN_PREFIX)) {
      const token = await prisma.memberSessionToken.findUnique({
        where: { tokenHash: hashToken(bearerToken) },
        include: { member: true },
      });

      if (!token || token.revokedAt !== null || token.member.deletedAt !== null) {
        throw Object.assign(new Error("Invalid token"), { statusCode: 401 });
      }
      if (token.expiresAt < new Date()) {
        throw Object.assign(new Error("Token has expired"), { statusCode: 401 });
      }

      // A token is bound to its member's program; a client must not switch tenants.
      const tokenProgramId = request.headers["x-program-id"] as string | undefined;
      if (tokenProgramId && tokenProgramId !== token.member.programId) {
        throw new LoyaltyError("FORBIDDEN", 403);
      }

      request.memberId = token.member.id;
      request.programId = token.member.programId;
      request.apiKeyScope = "MEMBER";
      request.memberTokenReadOnly = token.readOnly;
      request.actor = { type: "MEMBER", id: token.member.id };
      return;
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

  // Establish the tenant context for the rest of the request lifecycle. This runs
  // as a second `preHandler` hook (after the auth hook above has resolved
  // `request.programId`) so the AsyncLocalStorage context surrounds the route
  // handler. The callback form wraps `done()` in `runWithTenant`, which propagates
  // the context synchronously into the handler and any awaits inside it.
  //
  // Skipped entirely when TENANCY_RLS=off (the default) so there is no per-request
  // query overhead, and for routes without a resolved program (health, auth, …).
  app.addHook("preHandler", (request, _reply, done) => {
    if (resolveTenantRlsMode() === "off") {
      done();
      return;
    }

    // An admin session in `user` mode resolves the org directly from the active
    // membership; otherwise derive it from the program (the pre-context path).
    const organizationId = request.organizationId;
    const programId = request.programId;
    if (organizationId) {
      void runWithTenant({ organizationId, programId: programId || undefined }, () => {
        done();
      });
      return;
    }
    if (!programId) {
      done();
      return;
    }

    // `app_org_for_program` (SECURITY DEFINER) is tried first, so no tenant context
    // is needed to resolve the org; the direct read is only a fallback under `off`.
    // The short in-memory cache (invalidated by tenancy:move-program) absorbs the
    // round-trip on hot paths.
    resolveOrganizationIdCached(prisma, programId)
      .then((resolvedOrganizationId) => {
        void runWithTenant({ organizationId: resolvedOrganizationId, programId }, () => {
          done();
        });
      })
      .catch((error: unknown) => {
        done(error as Error);
      });
  });
}

export const authPlugin = fp(authPluginImpl, { name: "auth" });
export default authPlugin;
