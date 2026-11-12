import { PointsService } from "@loyaltyos/core";
import { type PointAdjustmentRequest, Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { adaptPointsMetrics, getBusinessMetrics } from "../../lib/business-metrics.js";
import { LoyaltyError } from "../../lib/errors.js";
import { composeLedgerReason } from "../../lib/point-adjustments.js";

const points = new PointsService(prisma, adaptPointsMetrics(getBusinessMetrics()));

const listQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]).optional(),
  memberId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const decisionSchema = z.object({
  decisionComment: z.string().max(1000).optional(),
});

/** Applies the points for an approved request, idempotently, keyed by the request id. */
async function applyPendingPoints(adjustment: PointAdjustmentRequest): Promise<void> {
  const approverId = adjustment.decidedById ?? adjustment.requestedById;
  const result = await points.adjust({
    memberId: adjustment.memberId,
    programId: adjustment.programId,
    amount: adjustment.amount,
    reason: composeLedgerReason(adjustment.reasonCategory, adjustment.comment),
    adminUserId: approverId,
    idempotencyKey: `adjust-${adjustment.id}`,
  });
  await prisma.pointAdjustmentRequest.update({
    where: { id: adjustment.id },
    data: { transactionId: result.transactionId },
  });
}

export function adminPointAdjustmentsRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  /** GET /admin/point-adjustments — list requests (filterable by status/member) */
  app.get("/admin/point-adjustments", async (request, reply) => {
    const query = listQuerySchema.parse(request.query);

    const where: Prisma.PointAdjustmentRequestWhereInput = {
      programId: request.programId,
    };
    if (query.status) where.status = query.status;
    if (query.memberId) where.memberId = query.memberId;

    const [items, total] = await Promise.all([
      prisma.pointAdjustmentRequest.findMany({
        where,
        include: {
          member: {
            select: { id: true, email: true, firstName: true, lastName: true, externalId: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.pointAdjustmentRequest.count({ where }),
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

  /** POST /admin/point-adjustments/:id/approve — SUPER_ADMIN approves a PENDING request */
  app.post("/admin/point-adjustments/:id/approve", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = decisionSchema.parse(request.body ?? {});
    const adminId = request.adminId;
    if (!adminId) throw new LoyaltyError("UNAUTHORIZED", 401);

    const adjustment = await prisma.pointAdjustmentRequest.findUnique({ where: { id } });
    if (!adjustment || adjustment.programId !== request.programId) {
      throw new LoyaltyError("NOT_FOUND", 404);
    }
    if (adjustment.requestedByType === "ADMIN_USER" && adjustment.requestedById === adminId) {
      throw new LoyaltyError("ADJUST_SELF_DECIDE", 403);
    }

    if (adjustment.status !== "PENDING") {
      // Double-click safe. Recover a crash window where the approval committed
      // but the points were never applied.
      if (adjustment.status === "APPROVED" && adjustment.transactionId == null) {
        await applyPendingPoints(adjustment);
      }
      return reply.send({ data: { requestId: adjustment.id, status: adjustment.status } });
    }

    const claimed = await prisma.pointAdjustmentRequest.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "APPROVED",
        decidedById: adminId,
        decidedAt: new Date(),
        decisionComment: body.decisionComment,
      },
    });

    if (claimed.count === 0) {
      const fresh = await prisma.pointAdjustmentRequest.findUniqueOrThrow({ where: { id } });
      if (fresh.status === "APPROVED" && fresh.transactionId == null) {
        await applyPendingPoints(fresh);
      }
      return reply.send({ data: { requestId: fresh.id, status: fresh.status } });
    }

    await applyPendingPoints({ ...adjustment, decidedById: adminId });

    await audit(request.programId, request.actor, "OTHER", "point_adjustment_request", id, {
      action: "adjust.approve",
      amount: adjustment.amount,
      reasonCategory: adjustment.reasonCategory,
      comment: adjustment.comment,
      decisionComment: body.decisionComment,
    });

    return reply.send({ data: { requestId: id, status: "APPROVED" } });
  });

  /** POST /admin/point-adjustments/:id/reject — SUPER_ADMIN rejects a PENDING request */
  app.post("/admin/point-adjustments/:id/reject", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = decisionSchema.parse(request.body ?? {});
    const adminId = request.adminId;
    if (!adminId) throw new LoyaltyError("UNAUTHORIZED", 401);

    const adjustment = await prisma.pointAdjustmentRequest.findUnique({ where: { id } });
    if (!adjustment || adjustment.programId !== request.programId) {
      throw new LoyaltyError("NOT_FOUND", 404);
    }
    if (adjustment.requestedByType === "ADMIN_USER" && adjustment.requestedById === adminId) {
      throw new LoyaltyError("ADJUST_SELF_DECIDE", 403);
    }

    if (adjustment.status !== "PENDING") {
      return reply.send({ data: { requestId: adjustment.id, status: adjustment.status } });
    }

    const claimed = await prisma.pointAdjustmentRequest.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "REJECTED",
        decidedById: adminId,
        decidedAt: new Date(),
        decisionComment: body.decisionComment,
      },
    });

    if (claimed.count === 0) {
      const fresh = await prisma.pointAdjustmentRequest.findUniqueOrThrow({ where: { id } });
      return reply.send({ data: { requestId: fresh.id, status: fresh.status } });
    }

    await audit(request.programId, request.actor, "OTHER", "point_adjustment_request", id, {
      action: "adjust.reject",
      amount: adjustment.amount,
      reasonCategory: adjustment.reasonCategory,
      comment: adjustment.comment,
      decisionComment: body.decisionComment,
    });

    return reply.send({ data: { requestId: id, status: "REJECTED" } });
  });

  done();
}
