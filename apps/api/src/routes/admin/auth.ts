import { verifyPassword } from "@loyaltyos/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { resolveAdminUserByEmail } from "../../lib/admin-user-bridge.js";
import { adminAuthMode, adminLucia } from "../../lib/auth/admin-lucia.js";
import { LoyaltyError } from "../../lib/errors.js";
import {
  resolveDefaultMembership,
  resolveDefaultProgramId,
  syncAdminUserToTenancy,
  syncTenancyUserToAdminUser,
  validateProgramInMembership,
} from "../../lib/tenancy-users.js";

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

const updateAdminMeSchema = z.object({
  locale: z.enum(["es-MX", "en-US"]).optional(),
  name: z.string().min(1).optional(),
});

const switchOrganizationSchema = z.object({
  organizationId: z.string().min(1),
  programId: z.string().min(1).optional(),
});

// Placeholder argon2 hash to equalize timing on unknown emails / missing
// passwords (prevents account enumeration).
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$xxxxxxxxxxxxxxxxxxxxxx$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

function legacyNotFound(reply: FastifyReply) {
  return reply.code(404).send({ message: "Not Found", error: "Not Found", statusCode: 404 });
}

export function adminAuthRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  /** POST /admin/login — authenticate an admin user */
  app.post(
    "/admin/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const mode = adminAuthMode();

      if (mode === "legacy") {
        // Rollback flow: authenticate against AdminUser.passwordHash.
        const admin = await prisma.adminUser.findFirst({
          where: { email: body.email, isActive: true },
        });
        const valid = await verifyPassword(admin?.passwordHash ?? DUMMY_HASH, body.password);
        if (!admin || !valid) {
          throw new LoyaltyError("INVALID_CREDENTIALS", 401);
        }

        const lastLoginAt = new Date();
        await prisma.$transaction(async (tx) => {
          await tx.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt } });
          await syncAdminUserToTenancy(tx, { ...admin, lastLoginAt });
        });

        // AdminSession.userId now references User, so the session must be minted
        // against the User mirror of this AdminUser.
        const user = await prisma.user.findUnique({ where: { email: admin.email } });
        if (!user) {
          throw new LoyaltyError("UNAUTHORIZED", 401);
        }

        const session = await adminLucia.createSession(user.id, {});
        const cookie = adminLucia.createSessionCookie(session.id);
        void reply.header("Set-Cookie", cookie.serialize());

        return reply.send({
          data: {
            admin: {
              id: admin.id,
              email: admin.email,
              name: admin.name,
              role: admin.role,
              locale: admin.locale,
            },
          },
        });
      }

      // user mode: authenticate the identity-root User.
      const user = await prisma.user.findFirst({
        where: { email: body.email, status: "ACTIVE" },
      });
      const valid = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, body.password);
      if (!user || !valid) {
        throw new LoyaltyError("INVALID_CREDENTIALS", 401);
      }

      const membership = await resolveDefaultMembership(prisma, { id: user.id, email: user.email });
      if (!membership || membership.status !== "ACTIVE") {
        throw new LoyaltyError("UNAUTHORIZED", 401);
      }
      const adminUser = await resolveAdminUserByEmail(prisma, user.email);
      const programId = await resolveDefaultProgramId(
        prisma,
        membership,
        adminUser?.programId ?? null,
      );

      const lastLoginAt = new Date();
      const mirrorProgramId = programId ?? membership.programIds[0] ?? null;
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { lastLoginAt } });
        if (mirrorProgramId) {
          await syncTenancyUserToAdminUser(tx, {
            user: {
              email: user.email,
              passwordHash: user.passwordHash,
              name: user.name,
              status: user.status,
              locale: user.locale,
              lastLoginAt,
            },
            membership: {
              role: membership.role,
              programIds: membership.programIds,
              status: membership.status,
            },
            programId: mirrorProgramId,
          });
        }
      });

      const memberships = await prisma.organizationMembership.findMany({
        where: { userId: user.id, status: "ACTIVE" },
        include: { organization: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      });

      const session = await adminLucia.createSession(user.id, {
        activeOrganizationId: membership.organizationId,
        activeProgramId: programId,
      });
      const cookie = adminLucia.createSessionCookie(session.id);
      void reply.header("Set-Cookie", cookie.serialize());

      return reply.send({
        data: {
          admin: {
            id: adminUser?.id ?? user.id,
            email: user.email,
            name: user.name,
            role: membership.role,
            locale: user.locale,
          },
          organizationId: membership.organizationId,
          programId,
          organizations: memberships.map((m) => ({
            id: m.organizationId,
            name: m.organization.name,
            role: m.role,
            programIds: m.programIds,
          })),
        },
      });
    },
  );

  /** POST /admin/logout — invalidate admin session */
  app.post("/admin/logout", async (request, reply) => {
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const sessionId = adminLucia.readSessionCookie(cookieHeader);
      if (sessionId) {
        await adminLucia.invalidateSession(sessionId);
      }
    }

    const blankCookie = adminLucia.createBlankSessionCookie();
    void reply.header("Set-Cookie", blankCookie.serialize());
    return reply.send({ ok: true });
  });

  /** GET /admin/organizations — the admin's ACTIVE memberships (404 in legacy). */
  app.get("/admin/organizations", async (request, reply) => {
    if (adminAuthMode() === "legacy") {
      return legacyNotFound(reply);
    }
    const userId = request.userId;
    if (!userId) {
      throw new LoyaltyError("UNAUTHORIZED", 401);
    }

    const memberships = await prisma.organizationMembership.findMany({
      where: { userId, status: "ACTIVE" },
      include: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });

    return reply.send({
      data: memberships.map((m) => ({
        id: m.organizationId,
        name: m.organization.name,
        role: m.role,
        programIds: m.programIds,
      })),
    });
  });

  /** POST /admin/organizations/active — switch org/program (rotates the session). */
  app.post("/admin/organizations/active", async (request, reply) => {
    if (adminAuthMode() === "legacy") {
      return legacyNotFound(reply);
    }
    if (request.patId) {
      throw new LoyaltyError("FORBIDDEN", 403);
    }
    const userId = request.userId;
    if (!userId) {
      throw new LoyaltyError("UNAUTHORIZED", 401);
    }

    const body = switchOrganizationSchema.parse(request.body);
    const membership = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId: body.organizationId } },
    });
    if (!membership || membership.status !== "ACTIVE") {
      throw new LoyaltyError("FORBIDDEN", 403);
    }

    let programId: string | null;
    if (body.programId) {
      if (!(await validateProgramInMembership(prisma, membership, body.programId))) {
        throw new LoyaltyError("FORBIDDEN", 403);
      }
      programId = body.programId;
    } else {
      programId = await resolveDefaultProgramId(prisma, membership, null);
    }

    // Rotate the session: invalidate the current one and issue a fresh one with
    // the new active scope, so the selection is durable across requests.
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const sessionId = adminLucia.readSessionCookie(cookieHeader);
      if (sessionId) {
        await adminLucia.invalidateSession(sessionId);
      }
    }

    const session = await adminLucia.createSession(userId, {
      activeOrganizationId: membership.organizationId,
      activeProgramId: programId,
    });
    const cookie = adminLucia.createSessionCookie(session.id);
    void reply.header("Set-Cookie", cookie.serialize());

    return reply.send({
      data: { organizationId: membership.organizationId, programId },
    });
  });

  /** GET /admin/me — current admin user info */
  app.get("/admin/me", async (request, reply) => {
    const userId = request.userId;
    if (!userId) {
      throw new LoyaltyError("UNAUTHORIZED", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, locale: true },
    });

    if (!user) {
      throw new LoyaltyError("NOT_FOUND", 404);
    }

    return reply.send({
      data: {
        id: request.adminId ?? user.id,
        email: user.email,
        name: user.name,
        role: request.adminRole ?? "",
        locale: user.locale,
        programId: request.programId,
      },
    });
  });

  /** PATCH /admin/me — update current admin user (real session only) */
  app.patch("/admin/me", async (request, reply) => {
    const userId = request.userId;
    if (!userId) {
      throw new LoyaltyError("UNAUTHORIZED", 401);
    }
    // A personal access token must not modify the owner's account.
    if (request.patId) {
      throw new LoyaltyError("FORBIDDEN", 403);
    }

    const body = updateAdminMeSchema.parse(request.body);
    const mode = adminAuthMode();

    if (mode === "legacy") {
      const adminId = request.adminId;
      if (!adminId) {
        throw new LoyaltyError("UNAUTHORIZED", 401);
      }
      const admin = await prisma.$transaction(async (tx) => {
        const updated = await tx.adminUser.update({ where: { id: adminId }, data: body });
        await syncAdminUserToTenancy(tx, updated);
        return updated;
      });
      return reply.send({
        data: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          locale: admin.locale,
          programId: admin.programId,
        },
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: body });
      const membership = await resolveDefaultMembership(tx, { id: user.id, email: user.email });
      const mirrorProgramId = membership?.programIds[0] ?? null;
      if (membership && mirrorProgramId) {
        await syncTenancyUserToAdminUser(tx, {
          user: {
            email: user.email,
            passwordHash: user.passwordHash,
            name: user.name,
            status: user.status,
            locale: user.locale,
            lastLoginAt: user.lastLoginAt,
          },
          membership: {
            role: membership.role,
            programIds: membership.programIds,
            status: membership.status,
          },
          programId: mirrorProgramId,
        });
      }
      return user;
    });

    return reply.send({
      data: {
        id: request.adminId ?? updated.id,
        email: updated.email,
        name: updated.name,
        role: request.adminRole ?? "",
        locale: updated.locale,
        programId: request.programId,
      },
    });
  });

  done();
}
