import { BadgesService, TiersService } from "@loyaltyos/badges";
import { PointsService } from "@loyaltyos/core";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { adaptPointsMetrics, getBusinessMetrics } from "../lib/business-metrics.js";
import { LoyaltyError } from "../lib/errors.js";
import { notificationsService } from "../lib/notifications-setup.js";

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
  amount: z.number().int(),
  reason: z.string().min(1),
});

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
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
        search: z.string().optional(),
      })
      .parse(request.query);

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
  app.patch("/members/me", async (request, reply) => {
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
  });

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
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(request.query);

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

      const result = await points.adjust({
        memberId: id,
        programId: request.programId,
        amount: body.amount,
        reason: body.reason,
        adminUserId: "admin", // Will be replaced by real auth in Prompt 6
        idempotencyKey,
      });
      return reply.status(201).send({ data: result });
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

  done();
}
