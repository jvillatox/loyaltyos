import { adminRoleRank } from "@loyaltyos/permissions";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { LoyaltyError } from "../../lib/errors.js";
import { generateToken, MAX_TOKEN_DAYS } from "../../lib/personal-access-token.js";

const createTokenSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.enum(["SUPER_ADMIN", "OPERATOR", "ANALYST"]),
  days: z.number().int().min(1).max(MAX_TOKEN_DAYS),
});

const tokenSelect = {
  id: true,
  name: true,
  prefix: true,
  role: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
  adminUserId: true,
} as const;

export function adminTokensRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // A token must never mint or revoke another token. These routes require a real
  // admin session; a PAT request arrives with `request.patId` set and is rejected.
  app.addHook("preHandler", (request, _reply, done) => {
    if (request.patId) {
      done(new LoyaltyError("FORBIDDEN", 403));
      return;
    }
    done();
  });

  /** POST /admin/tokens — create a personal access token (shown once) */
  app.post("/admin/tokens", async (request, reply) => {
    const adminId = request.adminId;
    const ownerRole = request.adminRole;
    if (!adminId || !ownerRole) {
      throw new LoyaltyError("UNAUTHORIZED", 401);
    }

    const body = createTokenSchema.parse(request.body);

    // A token may never out-rank its owner.
    if (adminRoleRank(body.role) > adminRoleRank(ownerRole)) {
      throw new LoyaltyError("FORBIDDEN", 403);
    }

    const { token, tokenHash, prefix } = generateToken();
    const expiresAt = new Date(Date.now() + body.days * 24 * 60 * 60 * 1000);

    const created = await prisma.personalAccessToken.create({
      data: {
        adminUserId: adminId,
        name: body.name,
        tokenHash,
        prefix,
        role: body.role,
        expiresAt,
      },
      select: tokenSelect,
    });

    await audit(request.programId, request.actor, "OTHER", "personal_access_token", created.id, {
      action: "token.create",
      name: body.name,
      role: body.role,
    });

    return reply.status(201).send({ data: { ...created, token } });
  });

  /** GET /admin/tokens — list tokens (own for everyone, whole program for SUPER_ADMIN) */
  app.get("/admin/tokens", async (request, reply) => {
    const adminId = request.adminId;
    const ownerRole = request.adminRole;
    if (!adminId || !ownerRole) {
      throw new LoyaltyError("UNAUTHORIZED", 401);
    }

    const where =
      ownerRole === "SUPER_ADMIN"
        ? { adminUser: { programId: request.programId } }
        : { adminUserId: adminId };

    const tokens = await prisma.personalAccessToken.findMany({
      where,
      select: { ...tokenSelect, adminUser: { select: { email: true } } },
      orderBy: { createdAt: "desc" },
    });

    return reply.send({ data: tokens });
  });

  /** DELETE /admin/tokens/:id — revoke a token (own, or any in program for SUPER_ADMIN) */
  app.delete("/admin/tokens/:id", async (request, reply) => {
    const adminId = request.adminId;
    const ownerRole = request.adminRole;
    if (!adminId || !ownerRole) {
      throw new LoyaltyError("UNAUTHORIZED", 401);
    }

    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);

    const token = await prisma.personalAccessToken.findUnique({
      where: { id },
      select: {
        adminUserId: true,
        revokedAt: true,
        adminUser: { select: { programId: true } },
      },
    });

    // A token from another program is indistinguishable from one that does not
    // exist, so a caller cannot probe for the existence of other tenants' tokens.
    if (!token || token.adminUser.programId !== request.programId) {
      throw new LoyaltyError("NOT_FOUND", 404);
    }

    const canRevoke = token.adminUserId === adminId || ownerRole === "SUPER_ADMIN";
    if (!canRevoke) {
      throw new LoyaltyError("FORBIDDEN", 403);
    }

    if (token.revokedAt) {
      return reply.send({ data: { id, revoked: false } });
    }

    await prisma.personalAccessToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    await audit(request.programId, request.actor, "OTHER", "personal_access_token", id, {
      action: "token.revoke",
    });

    return reply.send({ data: { id, revoked: true } });
  });

  done();
}
