import { BadgesService, TiersService } from "@loyaltyos/badges";
import { CampaignsService } from "@loyaltyos/campaigns";
import { PointsService } from "@loyaltyos/core";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { adaptPointsMetrics, getBusinessMetrics } from "../lib/business-metrics.js";
import { notificationsService } from "../lib/notifications-setup.js";

const pointsMetrics = adaptPointsMetrics(getBusinessMetrics());
const points = new PointsService(prisma, pointsMetrics);
const campaigns = new CampaignsService(prisma, points);
const badges = new BadgesService(prisma);
const tiers = new TiersService(prisma);

/** Fire a notification trigger asynchronously (fire-and-forget). */
async function triggerNotification(
  triggerEvent: string,
  memberId: string,
  programId: string,
  baseContext: Record<string, unknown>,
): Promise<void> {
  try {
    const member = await prisma.member.findFirst({
      where: { id: memberId },
      include: {
        pointAccount: true,
        memberTiers: { include: { tier: true } },
      },
    });
    const currentTier = member?.memberTiers.find((mt) => !mt.downgradedAt)?.tier.name;
    const context: Record<string, unknown> = {
      ...baseContext,
      member: {
        id: member?.id,
        email: member?.email,
        phone: member?.phone,
        firstName: member?.firstName,
        lastName: member?.lastName,
        currentTier,
      },
    };
    await notificationsService.sendTrigger(programId, triggerEvent, memberId, context);
  } catch (err) {
    // Fire-and-forget: never fail the main operation
    console.error(`[Notifications] Trigger ${triggerEvent} failed:`, err);
  }
}

const eventSchema = z.object({
  type: z.string().min(1),
  memberId: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

export function eventsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.post(
    "/events",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const idempotencyKey = request.headers["idempotency-key"] as string;
      if (!idempotencyKey) {
        return reply.status(400).send({
          error: { code: "MISSING_HEADER", message: "Idempotency-Key header is required" },
        });
      }

      const body = eventSchema.parse(request.body);

      // Deduplicate the event
      const existing = await prisma.event.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return reply.send({ data: existing, idempotent: true });
      }

      // Create event
      const programId = request.programId || (request.headers["x-program-id"] as string);
      const event = await prisma.event.create({
        data: {
          programId,
          type: body.type,
          memberId: body.memberId,
          payload: body.payload as Prisma.InputJsonValue,
          idempotencyKey,
          processed: false,
        },
      });

      // If the event is for a member and represents points-earning activity,
      // process it through the points engine
      if (body.memberId) {
        // Update lastActiveAt (fire-and-forget — don't block the event)
        void prisma.member
          .update({
            where: { id: body.memberId },
            data: { lastActiveAt: new Date() },
          })
          .catch(() => {
            /* best-effort */
          });

        try {
          // For "purchase" events, earn points
          if (body.type === "purchase") {
            const amount =
              body.payload && typeof body.payload === "object" && "amount" in body.payload
                ? Number((body.payload as Record<string, number>).amount)
                : 0;

            if (amount > 0) {
              const result = await points.earn({
                memberId: body.memberId,
                programId: programId,
                amount,
                source: `event:${body.type}`,
                idempotencyKey: `${idempotencyKey}-earn`,
                metadata: body.payload,
              });

              // Evaluate and apply eligible campaigns
              const evaluation = await campaigns.evaluateForEvent({
                type: body.type,
                memberId: body.memberId,
                programId: programId,
                amount,
                payload: body.payload,
              });

              const appliedCampaigns: unknown[] = [];
              for (const campaign of evaluation.applicable) {
                try {
                  const appResult = await campaigns.applyCampaign(
                    campaign.id,
                    {
                      type: body.type,
                      memberId: body.memberId,
                      programId: programId,
                      amount,
                      payload: body.payload,
                    },
                    `${idempotencyKey}-campaign-${campaign.id}`,
                  );
                  appliedCampaigns.push(appResult);
                } catch (err) {
                  request.log.warn({ err, campaignId: campaign.id }, "Failed to apply campaign");
                }
              }

              await prisma.event.update({
                where: { id: event.id },
                data: {
                  processed: true,
                  processedAt: new Date(),
                },
              });

              // Fire notification trigger (fire-and-forget)
              void triggerNotification("points.earned", body.memberId, programId, {
                points: result.amount,
                balance: result.balanceAfter,
                amount,
                transactionId: result.transactionId,
              });

              // Evaluate tier changes (fire-and-forget)
              void (async () => {
                try {
                  const tierResult = await tiers.evaluateMember(body.memberId!, programId);
                  if (tierResult.changed && tierResult.direction === "upgrade") {
                    void triggerNotification("tier.changed", body.memberId!, programId, {
                      previousTier: tierResult.previousTier?.name,
                      currentTier: tierResult.currentTier?.name,
                      direction: "upgrade",
                    });
                  }
                } catch (err) {
                  console.error("[Tiers] Evaluation failed:", err);
                }
              })();

              // Evaluate badges for this event (fire-and-forget)
              void (async () => {
                try {
                  const badgeResult = await badges.evaluateOnEvent({
                    type: body.type,
                    memberId: body.memberId!,
                    programId,
                    amount,
                    payload: body.payload,
                  });
                  for (const unlocked of badgeResult.unlocked) {
                    void triggerNotification("badge.unlocked", body.memberId!, programId, {
                      badgeId: unlocked.id,
                      badgeName: unlocked.name,
                      badgeType: unlocked.type,
                    });
                  }
                } catch (err) {
                  console.error("[Badges] Evaluation failed:", err);
                }
              })();

              return reply.status(201).send({
                data: { event, earnResult: result, appliedCampaigns },
              });
            }
          }

          // For "registration" events, grant sign-up bonus
          if (body.type === "registration") {
            const bonus = 500; // Default signup bonus
            const result = await points.earn({
              memberId: body.memberId,
              programId: programId,
              amount: bonus,
              source: "signup_bonus",
              idempotencyKey: `${idempotencyKey}-bonus`,
            });

            await prisma.event.update({
              where: { id: event.id },
              data: { processed: true, processedAt: new Date() },
            });

            // Fire notification trigger (fire-and-forget)
            void triggerNotification("registration", body.memberId, programId, {
              bonus,
              points: result.amount,
              balance: result.balanceAfter,
            });

            return reply.status(201).send({ data: { event, earnResult: result } });
          }
        } catch (err) {
          await prisma.event.update({
            where: { id: event.id },
            data: { error: String(err) },
          });
          throw err;
        }
      }

      return reply.status(201).send({ data: event });
    },
  );

  done();
}
