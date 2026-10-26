import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";

export function adminStatsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  /** GET /admin/stats/dashboard — program-level loyalty analytics */
  app.get("/admin/stats/dashboard", async (request, reply) => {
    const programId = request.programId;

    const [activeMembers, pointsAgg, recentTransactions, activeCampaigns, totalCampaigns] =
      await Promise.all([
        prisma.member.count({ where: { programId, deletedAt: null } }),
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
        prisma.campaign.count({ where: { programId, deletedAt: null, isActive: true } }),
        prisma.campaign.count({ where: { programId, deletedAt: null } }),
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
        activeCampaigns,
        totalCampaigns,
      },
    });
  });

  /** GET /admin/campaigns/:id/stats — per-campaign analytics */
  app.get("/admin/campaigns/:id/stats", async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);

    const campaign = await prisma.campaign.findFirst({
      where: { id, programId: request.programId, deletedAt: null },
      include: { variants: { select: { id: true, name: true } } },
    });
    if (!campaign) {
      return reply
        .status(404)
        .send({ error: { code: "NOT_FOUND", message: "Campaign not found" } });
    }

    const [applications, pointsAgg, memberGroups, variantRows] = await Promise.all([
      prisma.campaignApplication.count({ where: { campaignId: id } }),
      prisma.campaignApplication.aggregate({
        where: { campaignId: id },
        _sum: { pointsAwarded: true },
      }),
      prisma.campaignApplication.groupBy({
        by: ["memberId"],
        where: { campaignId: id },
      }),
      prisma.campaignApplication.groupBy({
        by: ["variantId"],
        where: { campaignId: id },
        _count: { _all: true },
        _sum: { pointsAwarded: true },
      }),
    ]);

    const uniqueMembers = memberGroups.length;
    const variantName = new Map(campaign.variants.map((v) => [v.id, v.name]));

    return reply.send({
      data: {
        applications,
        pointsAwarded: pointsAgg._sum.pointsAwarded ?? 0,
        uniqueMembers,
        variants: variantRows.map((row) => ({
          variantId: row.variantId,
          name: row.variantId ? (variantName.get(row.variantId) ?? null) : null,
          applications: row._count._all,
          pointsAwarded: row._sum.pointsAwarded ?? 0,
        })),
      },
    });
  });

  done();
}
