import { CampaignsService } from "@loyaltyos/campaigns";
import { PointsService } from "@loyaltyos/core";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { adaptPointsMetrics, getBusinessMetrics } from "../../lib/business-metrics.js";

const pointsMetrics = adaptPointsMetrics(getBusinessMetrics());
const points = new PointsService(prisma, pointsMetrics);
const campaigns = new CampaignsService(prisma, points);

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum([
    "BONUS_POINTS",
    "SPEND_AND_GET",
    "FREQUENCY",
    "MILESTONE",
    "REFERRAL",
    "BIRTHDAY",
    "ANNIVERSARY",
    "FLASH_SALE",
    "TIER_UPGRADE_BONUS",
  ]),
  conditions: z.record(z.unknown()).optional(),
  multiplier: z.number().min(0).optional(),
  maxBudget: z.number().int().optional(),
  maxUsesPerMember: z.number().int().optional(),
  isStackable: z.boolean().optional(),
  abTesting: z.boolean().optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  variants: z
    .array(
      z.object({
        name: z.string().min(1),
        trafficPct: z.number().min(0).max(100),
        config: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
});

const updateSchema = createSchema.partial();

const lifecycleSchema = z.object({
  action: z.enum(["activate", "pause", "archive"]),
});

export function adminCampaignsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // POST /admin/campaigns — Create campaign
  app.post("/admin/campaigns", async (request, reply) => {
    const body = createSchema.parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const campaign = await campaigns.create({
      ...body,
      programId,
    });
    return reply.status(201).send({ data: campaign });
  });

  // GET /admin/campaigns — List campaigns
  app.get("/admin/campaigns", async (request, reply) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
        isActive: z
          .enum(["true", "false"])
          .optional()
          .transform((v) => {
            if (v === "true") return true;
            if (v === "false") return false;
            return undefined;
          }),
      })
      .parse(request.query);

    const where: Prisma.CampaignWhereInput = {
      programId: request.programId,
      deletedAt: null,
    };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [items, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        include: { variants: true },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
      }),
      prisma.campaign.count({ where }),
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

  // GET /admin/campaigns/:id — Get campaign by id
  app.get("/admin/campaigns/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const campaign = await prisma.campaign.findFirst({
      where: { id, programId: request.programId },
      include: { variants: true, applications: true },
    });
    if (!campaign) {
      return reply
        .status(404)
        .send({ error: { code: "NOT_FOUND", message: "Campaign not found" } });
    }
    return reply.send({ data: campaign });
  });

  // PATCH /admin/campaigns/:id — Update campaign
  app.patch("/admin/campaigns/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    const campaign = await campaigns.update(id, body);
    return reply.send({ data: campaign });
  });

  // DELETE /admin/campaigns/:id — Soft delete campaign
  app.delete("/admin/campaigns/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await campaigns.archive(id);
    return reply.status(204).send();
  });

  // POST /admin/campaigns/estimate — Estimate impact before creation
  app.post("/admin/campaigns/estimate", async (request, reply) => {
    const body = z
      .object({
        type: z.string().optional(),
        multiplier: z.number().optional(),
        maxBudget: z.number().optional(),
      })
      .parse(request.body);

    const result = await campaigns.estimateImpact({
      programId: request.programId,
      multiplier: body.multiplier,
      maxBudget: body.maxBudget,
    });
    return reply.send({ data: result });
  });

  // POST /admin/campaigns/:id/estimate — Estimate campaign impact
  app.post("/admin/campaigns/:id/estimate", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const campaign = await prisma.campaign.findFirst({
      where: { id, programId: request.programId },
    });
    if (!campaign) {
      return reply
        .status(404)
        .send({ error: { code: "NOT_FOUND", message: "Campaign not found" } });
    }

    const result = await campaigns.estimateImpact({
      programId: campaign.programId,
      type: campaign.type,
      multiplier: campaign.multiplier,
      maxBudget: campaign.maxBudget ?? undefined,
    });
    return reply.send({ data: result });
  });

  // POST /admin/campaigns/:id/lifecycle — Manage campaign lifecycle
  app.post("/admin/campaigns/:id/lifecycle", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { action } = lifecycleSchema.parse(request.body);

    switch (action) {
      case "activate":
        await campaigns.activate(id);
        break;
      case "pause":
        await campaigns.pause(id);
        break;
      case "archive":
        await campaigns.archive(id);
        break;
    }

    return reply.send({ data: { id, action } });
  });

  done();
}
