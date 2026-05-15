import { PointsService } from "@loyaltyos/core";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";

const points = new PointsService(prisma);

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

export function membersRoutes(app: FastifyInstance): void {
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

  app.post("/members/:id/adjust", async (request, reply) => {
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
  });
}
