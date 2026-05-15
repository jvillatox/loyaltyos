import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";

export function statsRoutes(app: FastifyInstance): void {
  app.get("/stats/dashboard", async (request, reply) => {
    const programId = request.programId;

    const [activeMembers, pointsAgg, recentTransactions] = await Promise.all([
      prisma.member.count({
        where: { programId, deletedAt: null },
      }),
      prisma.pointAccount.aggregate({
        where: { programId },
        _sum: { totalEarned: true, totalRedeemed: true },
      }),
      prisma.pointTransaction.count({
        where: {
          account: { programId },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const totalPointsIssued = pointsAgg._sum.totalEarned ?? 0;
    const totalPointsRedeemed = pointsAgg._sum.totalRedeemed ?? 0;

    return reply.send({
      data: {
        activeMembers,
        totalPointsIssued,
        totalPointsRedeemed,
        redemptionRatio: totalPointsIssued > 0 ? totalPointsRedeemed / totalPointsIssued : 0,
        recentTransactions,
      },
    });
  });
}
