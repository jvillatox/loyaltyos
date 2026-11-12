import { memberListQuerySchema, memberTransactionsQuerySchema } from "@loyaltyos/api-contract";
import { BadgesService, TiersService } from "@loyaltyos/badges";
import { PointsService } from "@loyaltyos/core";
import { type PointAdjustmentRequest, Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { adaptPointsMetrics, getBusinessMetrics } from "../lib/business-metrics.js";
import { LoyaltyError } from "../lib/errors.js";
import {
  generateMemberToken,
  MEMBER_TOKEN_DEFAULT_TTL_SECONDS,
  MEMBER_TOKEN_MAX_TTL_SECONDS,
} from "../lib/member-session-token.js";
import { notificationsService } from "../lib/notifications-setup.js";
import {
  acquireAdjustmentLock,
  ADJUSTMENT_EXPIRY_DAYS,
  ADJUSTMENT_REASON_CATEGORIES,
  adjustmentLimits,
  type AdjustmentRequester,
  composeLedgerReason,
  decideAdjustment,
  directAdjustmentTotalToday,
  ledgerIdempotencyKey,
} from "../lib/point-adjustments.js";

const points = new PointsService(prisma, adaptPointsMetrics(getBusinessMetrics()));
const badges = new BadgesService(prisma);
const tiers = new TiersService(prisma);

const createMemberSchema = z.object({
  externalId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

const adjustSchema = z.object({
  amount: z
    .number()
    .int()
    .refine((amount) => amount !== 0, "amount must be non-zero"),
  reasonCategory: z.enum(ADJUSTMENT_REASON_CATEGORIES).optional(),
  // Deprecated alias: `reason` becomes reasonCategory=OTHER + comment=reason.
  reason: z.string().max(1000).optional(),
  comment: z.string().max(1000).optional(),
});

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Reuses a previously-recorded request for a repeated idempotency key. Recovers
 * the crash window where the APPROVED row committed but the points apply never
 * linked its transaction.
 */
async function handleExistingAdjustment(
  existing: PointAdjustmentRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (existing.status === "PENDING") {
    return reply.status(202).send({ data: { requestId: existing.id, status: "PENDING" } });
  }

  if (existing.status === "APPROVED") {
    if (existing.transactionId == null) {
      const result = await points.adjust({
        memberId: existing.memberId,
        programId: existing.programId,
        amount: existing.amount,
        reason: composeLedgerReason(existing.reasonCategory, existing.comment),
        adminUserId: existing.requestedById,
        idempotencyKey: ledgerIdempotencyKey(existing.id),
      });
      await prisma.pointAdjustmentRequest.update({
        where: { id: existing.id },
        data: { transactionId: result.transactionId },
      });
      return reply.status(201).send({
        data: {
          requestId: existing.id,
          status: "APPROVED",
          transactionId: result.transactionId,
          amount: result.amount,
          balanceAfter: result.balanceAfter,
        },
      });
    }
    return reply.status(201).send({
      data: {
        requestId: existing.id,
        status: "APPROVED",
        transactionId: existing.transactionId,
        amount: existing.amount,
      },
    });
  }

  // REJECTED or EXPIRED — the key is consumed in a terminal, non-applied state.
  return reply.status(409).send({ data: { requestId: existing.id, status: existing.status } });
}

export function membersRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.post("/members", async (request, reply) => {
    const body = createMemberSchema.parse(request.body);
    const member = await prisma.member.create({
      data: {
        ...body,
        metadata: body.metadata as Prisma.InputJsonValue,
        programId: request.programId,
      },
    });
    return reply.status(201).send({ data: member });
  });

  app.get("/members", async (request, reply) => {
    const query = memberListQuerySchema.parse(request.query);

    const where: Prisma.MemberWhereInput = {
      programId: request.programId,
      deletedAt: null,
    };

    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: "insensitive" } },
        { firstName: { contains: query.search, mode: "insensitive" } },
        { lastName: { contains: query.search, mode: "insensitive" } },
        { externalId: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.member.findMany({
        where,
        include: { pointAccount: { select: { balance: true } } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
      }),
      prisma.member.count({ where }),
    ]);

    return reply.send({
      data: {
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  });

  app.get("/members/me", async (request, reply) => {
    const memberId = request.memberId;
    if (!memberId) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    }

    const member = await prisma.member.findFirst({
      where: { id: memberId, deletedAt: null },
    });
    if (!member) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Member not found" } });
    }
    return reply.send({ data: member });
  });

  const patchMeSchema = z.object({
    locale: z.enum(["es-MX", "en-US"]),
  });

  /** PATCH /members/me — update authenticated member's locale */
  app.patch(
    "/members/me",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const memberId = request.memberId;
      if (!memberId) {
        throw new LoyaltyError("UNAUTHORIZED", 401);
      }

      const body = patchMeSchema.parse(request.body);

      const member = await prisma.member.findUnique({
        where: { id: memberId },
        include: { program: { select: { supportedLocales: true } } },
      });
      if (!member) {
        throw new LoyaltyError("NOT_FOUND", 404);
      }

      const programLocales = member.program.supportedLocales;
      if (!programLocales.includes(body.locale)) {
        throw new LoyaltyError("INVALID_INPUT", 400);
      }

      const updated = await prisma.member.update({
        where: { id: memberId },
        data: { locale: body.locale },
      });

      return reply.send({ data: updated });
    },
  );

  app.get("/members/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const member = await prisma.member.findFirst({
      where: { id, programId: request.programId },
    });
    if (!member) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Member not found" } });
    }
    return reply.send({ data: member });
  });

  const patchMemberSchema = z.object({
    locale: z.enum(["es-MX", "en-US"]).nullable().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    tags: z.array(z.string()).optional(),
  });

  /** PATCH /members/:id — update member fields including locale override */
  app.patch("/members/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = patchMemberSchema.parse(request.body);

    const data: Record<string, unknown> = {};
    if (body.locale !== undefined) data.locale = body.locale;
    if (body.firstName !== undefined) data.firstName = body.firstName;
    if (body.lastName !== undefined) data.lastName = body.lastName;
    if (body.tags !== undefined) data.tags = body.tags;
    if (body.metadata !== undefined) data.metadata = body.metadata;

    const existing = await prisma.member.findFirst({
      where: { id, programId: request.programId },
    });
    if (!existing) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Member not found" } });
    }

    const member = await prisma.member.update({
      where: { id },
      data: data as Prisma.MemberUpdateInput,
    });
    return reply.send({ data: member });
  });

  // GET /members/me/balance — authenticated member balance
  app.get("/members/me/balance", async (request, reply) => {
    const memberId = request.memberId;
    if (!memberId) {
      return reply
        .status(401)
        .send({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    }
    const result = await points.balance(memberId, request.programId);
    return reply.send({ data: result });
  });

  // GET /members/me/transactions — authenticated member transaction history
  app.get("/members/me/transactions", async (request, reply) => {
    const memberId = request.memberId;
    if (!memberId) {
      return reply
        .status(401)
        .send({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    }
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
        type: z.string().optional(),
      })
      .parse(request.query);

    const result = await points.history(memberId, request.programId, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return reply.send({ data: result });
  });

  // GET /members/me/badges — authenticated member badges
  app.get("/members/me/badges", async (request, reply) => {
    const memberId = request.memberId;
    if (!memberId) {
      return reply
        .status(401)
        .send({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    }
    const result = await badges.getMemberBadges(memberId);
    return reply.send({ data: result });
  });

  // GET /members/me/tier — authenticated member tier progress
  app.get("/members/me/tier", async (request, reply) => {
    const memberId = request.memberId;
    if (!memberId) {
      return reply
        .status(401)
        .send({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    }
    const result = await tiers.getMemberTier(memberId, request.programId);
    return reply.send({ data: result });
  });

  app.get("/members/:id/balance", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const result = await points.balance(id, request.programId);
    return reply.send({ data: result });
  });

  app.get("/members/:id/transactions", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const query = memberTransactionsQuerySchema.parse(request.query);

    const result = await points.history(id, request.programId, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return reply.send({ data: result });
  });

  app.post(
    "/members/:id/adjust",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = adjustSchema.parse(request.body);
      const idempotencyKey = request.headers["idempotency-key"] as string;
      if (!idempotencyKey) {
        return reply.status(400).send({
          error: { code: "MISSING_HEADER", message: "Idempotency-Key header is required" },
        });
      }

      // An admin session/PAT, or a SERVER-scope API key. MEMBER and CLIENT are
      // excluded by the route policy; ANALYST is read-only on non-admin routes.
      const requester: AdjustmentRequester =
        request.adminId != null
          ? {
              type: "ADMIN_USER",
              id: request.adminId,
              role: request.adminRole === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPERATOR",
            }
          : { type: "API_KEY", id: request.actor.id };

      // `reason` is a deprecated alias for reasonCategory=OTHER + comment=reason.
      let reasonCategory = body.reasonCategory;
      let comment = body.comment?.trim() ?? "";

      if (reasonCategory === undefined && body.reason !== undefined) {
        reasonCategory = "OTHER";
        comment = body.reason.trim();
        void reply.header("Deprecation", "true");
        request.log.warn(
          { memberId: id, programId: request.programId },
          "adjustment uses deprecated 'reason' field",
        );
      } else if (reasonCategory === undefined) {
        throw new LoyaltyError("INVALID_INPUT", 400);
      }

      // Admins must justify the adjustment; SERVER keys may omit the comment.
      if (requester.type === "ADMIN_USER" && comment.length < 10) {
        throw new LoyaltyError("ADJUST_COMMENT_REQUIRED", 400);
      }

      const member = await prisma.member.findFirst({
        where: { id, programId: request.programId, deletedAt: null },
      });
      if (!member) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Member not found" } });
      }

      const program = await prisma.program.findUniqueOrThrow({
        where: { id: request.programId },
      });
      const limits = adjustmentLimits(program);
      const expiresAt = new Date(Date.now() + ADJUSTMENT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      const existing = await prisma.pointAdjustmentRequest.findUnique({
        where: { programId_idempotencyKey: { programId: request.programId, idempotencyKey } },
      });
      if (existing) {
        return handleExistingAdjustment(existing, reply);
      }

      // A SERVER key over its per-transaction cap is a hard rejection — never pending.
      if (
        requester.type === "API_KEY" &&
        decideAdjustment(requester, body.amount, limits, 0) === "REJECT"
      ) {
        throw new LoyaltyError("ADJUST_LIMIT_EXCEEDED", 422);
      }

      let requestRow: PointAdjustmentRequest;

      if (requester.type === "ADMIN_USER" && requester.role === "OPERATOR") {
        // Serialize the daily-limit check with the request creation so two
        // concurrent adjustments from the same operator cannot both pass.
        const result = await prisma.$transaction(async (db) => {
          await acquireAdjustmentLock(db, request.programId, requester.id);
          const seen = await db.pointAdjustmentRequest.findUnique({
            where: { programId_idempotencyKey: { programId: request.programId, idempotencyKey } },
          });
          if (seen) return { seen };
          const dailyTotal = await directAdjustmentTotalToday(
            db,
            request.programId,
            requester.id,
            new Date(),
          );
          const decision = decideAdjustment(requester, body.amount, limits, dailyTotal);
          const created = await db.pointAdjustmentRequest.create({
            data: {
              programId: request.programId,
              memberId: id,
              amount: body.amount,
              reasonCategory: reasonCategory,
              comment,
              requestedById: requester.id,
              requestedByType: "ADMIN_USER",
              status: decision === "PENDING" ? "PENDING" : "APPROVED",
              idempotencyKey,
              expiresAt,
            },
          });
          return { created };
        });
        if (result.seen) {
          return handleExistingAdjustment(result.seen, reply);
        }
        requestRow = result.created;
      } else {
        // SUPER_ADMIN (direct) or SERVER key within its per-tx cap (direct).
        try {
          requestRow = await prisma.pointAdjustmentRequest.create({
            data: {
              programId: request.programId,
              memberId: id,
              amount: body.amount,
              reasonCategory: reasonCategory,
              comment,
              requestedById: requester.id,
              requestedByType: requester.type,
              status: "APPROVED",
              idempotencyKey,
              expiresAt,
            },
          });
        } catch (err) {
          if (isUniqueViolation(err)) {
            const winner = await prisma.pointAdjustmentRequest.findUnique({
              where: { programId_idempotencyKey: { programId: request.programId, idempotencyKey } },
            });
            if (winner) return handleExistingAdjustment(winner, reply);
          }
          throw err;
        }
      }

      if (requestRow.status === "PENDING") {
        await audit(
          request.programId,
          request.actor,
          "OTHER",
          "point_adjustment_request",
          requestRow.id,
          {
            action: "adjust.request",
            status: "PENDING",
            amount: body.amount,
            reasonCategory: reasonCategory,
            comment,
          },
        );
        return reply.status(202).send({ data: { requestId: requestRow.id, status: "PENDING" } });
      }

      // DIRECT: apply points (idempotent) and link the transaction.
      const result = await points.adjust({
        memberId: id,
        programId: request.programId,
        amount: body.amount,
        reason: composeLedgerReason(reasonCategory, comment),
        adminUserId: request.adminId ?? request.actor.id,
        idempotencyKey: ledgerIdempotencyKey(requestRow.id),
      });
      await prisma.pointAdjustmentRequest.update({
        where: { id: requestRow.id },
        data: { transactionId: result.transactionId },
      });

      await audit(request.programId, request.actor, "ADJUST_POINTS", "member", id, {
        amount: body.amount,
        reasonCategory: reasonCategory,
        comment,
      });

      return reply.status(201).send({
        data: {
          requestId: requestRow.id,
          status: "APPROVED",
          transactionId: result.transactionId,
          amount: result.amount,
          balanceAfter: result.balanceAfter,
        },
      });
    },
  );

  // GET /members/:id/badges — Get member badges with progress
  app.get("/members/:id/badges", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const result = await badges.getMemberBadges(id);
    return reply.send({ data: result });
  });

  // GET /members/:id/tier — Get member tier with progress to next
  app.get("/members/:id/tier", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const result = await tiers.getMemberTier(id, request.programId);
    return reply.send({ data: result });
  });

  // ═══ Member Devices ═══

  const deviceCreateSchema = z.object({
    token: z.string().min(1),
    platform: z.enum(["IOS", "ANDROID", "WEB"]),
  });

  // POST /members/:id/devices — idempotent upsert by token
  app.post("/members/:id/devices", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = deviceCreateSchema.parse(request.body);

    const device = await prisma.memberDevice.upsert({
      where: { token: body.token },
      create: {
        memberId: id,
        programId: request.programId,
        token: body.token,
        platform: body.platform,
        lastSeenAt: new Date(),
      },
      update: {
        lastSeenAt: new Date(),
        platform: body.platform,
      },
    });

    return reply.status(201).send({ data: device });
  });

  // DELETE /members/:id/devices/:deviceId
  app.delete("/members/:id/devices/:deviceId", async (request, reply) => {
    const { id, deviceId } = z
      .object({ id: z.string(), deviceId: z.string() })
      .parse(request.params);

    const device = await prisma.memberDevice.findFirst({
      where: { id: deviceId, memberId: id },
    });
    if (!device) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Device not found" } });
    }

    await prisma.memberDevice.delete({ where: { id: deviceId } });
    return reply.status(204).send();
  });

  // ═══ Notification Preferences ═══

  const preferenceUpdateSchema = z.object({
    channel: z.enum(["EMAIL", "SMS", "PUSH", "IN_APP"]),
    optedIn: z.boolean(),
  });

  // GET /members/:id/preferences
  app.get("/members/:id/preferences", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const prefs = await notificationsService.getMemberPreferences(id, request.programId);
    return reply.send({ data: prefs });
  });

  // PATCH /members/:id/preferences
  app.patch("/members/:id/preferences", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = preferenceUpdateSchema.parse(request.body);

    await notificationsService.upsertMemberPreference(
      id,
      request.programId,
      body.channel,
      body.optedIn,
    );

    // Return updated preferences
    const prefs = await notificationsService.getMemberPreferences(id, request.programId);
    return reply.send({ data: prefs });
  });

  // ═══ Member Session Tokens ═══

  const sessionTokenSchema = z.object({
    ttlSeconds: z.number().int().min(1).max(MEMBER_TOKEN_MAX_TTL_SECONDS).optional(),
  });

  // POST /members/:id/session-token — issue a short-lived member token (SERVER only)
  app.post("/members/:id/session-token", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = sessionTokenSchema.parse(request.body ?? {});

    const member = await prisma.member.findFirst({
      where: { id, programId: request.programId, deletedAt: null },
    });
    if (!member) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Member not found" } });
    }

    const ttlSeconds = body.ttlSeconds ?? MEMBER_TOKEN_DEFAULT_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const { token, tokenHash } = generateMemberToken();

    const record = await prisma.memberSessionToken.create({
      data: {
        memberId: member.id,
        programId: request.programId,
        tokenHash,
        readOnly: true,
        expiresAt,
      },
    });

    void reply.header("cache-control", "no-store");
    return reply.status(201).send({
      data: { token, expiresAt: record.expiresAt, memberId: record.memberId },
    });
  });

  // DELETE /members/:id/session-tokens — revoke all active member tokens (SERVER only)
  app.delete("/members/:id/session-tokens", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const member = await prisma.member.findFirst({
      where: { id, programId: request.programId, deletedAt: null },
    });
    if (!member) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Member not found" } });
    }

    const now = new Date();
    const result = await prisma.memberSessionToken.updateMany({
      where: {
        memberId: member.id,
        programId: request.programId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });

    await audit(request.programId, request.actor, "OTHER", "member_session_token", member.id, {
      revoked: result.count,
    });

    return reply.status(204).send();
  });

  done();
}
